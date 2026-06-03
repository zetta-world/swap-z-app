/**
 * Transak server-side session builder.
 *
 * Transak deprecated the old "apiKey in the query string" widget URL in
 * favor of a mandatory API-based flow (see their migration notice). The
 * new flow is strictly server-side:
 *
 *   1. Exchange API_KEY + API_SECRET for a short-lived Partner Access
 *      Token (valid ~7 days; only ONE token valid per partner at a time).
 *   2. POST the desired widgetParams + the access token to the session
 *      endpoint → receive a one-time `widgetUrl` carrying a sessionId
 *      JWT. The URL expires 5 minutes after creation and is single-use.
 *   3. The browser embeds THAT url in the iframe.
 *
 * This file runs ONLY on the server (imported by the /api route). The
 * API secret never reaches the client. The browser only ever sees the
 * final, already-authenticated widgetUrl.
 *
 * IP whitelisting note: Transak's session endpoint is "to be called from
 * the partner backend with whitelisted IPs". Vercel serverless egress IP
 * is dynamic, so the /api route that imports this is pinned to a stable
 * region (gru1/fra1) — but the partner must still either (a) set the
 * dashboard IP allowlist to permit those ranges, or (b) request Transak
 * to whitelist Vercel. We surface the upstream error verbatim so the
 * partner knows which case they're in.
 */

const TRANSAK_API_BASE = "https://api.transak.com";          // refresh-token, partners API
const TRANSAK_GATEWAY_BASE = "https://api-gateway.transak.com"; // session creation, widget infra

/* Confirmed from Transak docs + search index examples:
 *
 *   Production:
 *     POST https://api.transak.com/partners/api/v2/refresh-token        ← partner auth
 *     POST https://api-gateway.transak.com/api/v2/auth/session          ← widget session
 *
 *   Staging (for reference, not used here):
 *     POST https://api-stg.transak.com/partners/api/v2/refresh-token
 *     POST https://api-gateway-stg.transak.com/api/v2/auth/session
 *
 * The previous version pointed BOTH calls at api-gateway.transak.com,
 * which 404'd on the refresh-token side — the partners API lives on a
 * different host than the session/widget gateway.
 */

interface CachedToken {
  accessToken: string;
  /** Unix ms when we should refresh (before the real 7-day expiry). */
  refreshAt:   number;
}

// Module-level cache. On a warm Vercel instance this avoids re-minting a
// token on every widget open. Cold starts re-mint, which is fine — the
// "only one token valid" rule means the freshest token always wins and
// we use it immediately after minting.
let tokenCache: CachedToken | null = null;

export class TransakConfigError extends Error {}
export class TransakUpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function getCreds(): { apiKey: string; apiSecret: string } {
  const apiKey    = process.env.TRANSAK_API_KEY;
  const apiSecret = process.env.TRANSAK_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new TransakConfigError(
      "Transak não configurado: defina TRANSAK_API_KEY e TRANSAK_API_SECRET no servidor.",
    );
  }
  return { apiKey, apiSecret };
}

/**
 * Mint (or reuse) a Partner Access Token. Tokens last ~7 days; we
 * refresh when within 24h of our cached refreshAt to avoid using one
 * that's about to expire mid-flight.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.refreshAt > now) {
    return tokenCache.accessToken;
  }

  const { apiKey, apiSecret } = getCreds();
  const res = await fetch(`${TRANSAK_API_BASE}/partners/api/v2/refresh-token`, {
    method:  "POST",
    headers: {
      "accept":       "application/json",
      "content-type": "application/json",
      "api-secret":   apiSecret,
    },
    body: JSON.stringify({ apiKey }),
    // Never cache an auth call.
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new TransakUpstreamError(
      `refresh-token failed: ${text.slice(0, 200)}`,
      res.status,
    );
  }

  let parsed: {
    data?: { accessToken?: string; expiresAt?: number | string };
    accessToken?: string;
    expiresAt?: number | string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new TransakUpstreamError("refresh-token returned non-JSON", 502);
  }

  // Transak wraps the payload under `data` per their spec, but tolerate a
  // flat shape too in case the gateway ever changes the envelope.
  const accessToken = parsed.data?.accessToken ?? parsed.accessToken;
  if (!accessToken) {
    throw new TransakUpstreamError("refresh-token response missing accessToken", 502);
  }

  // expiresAt may come back as a unix-seconds number or ISO string.
  // Default to 6 days out (one day before the documented 7-day expiry)
  // when we can't parse it, so we always refresh with margin.
  let refreshAt = now + 6 * 24 * 3600 * 1000;
  const exp = parsed.data?.expiresAt ?? parsed.expiresAt;
  if (typeof exp === "number" && Number.isFinite(exp)) {
    const expMs = exp > 1e12 ? exp : exp * 1000; // tolerate s or ms
    refreshAt = Math.max(now + 60_000, expMs - 24 * 3600 * 1000);
  } else if (typeof exp === "string") {
    const expMs = Date.parse(exp);
    if (Number.isFinite(expMs)) refreshAt = Math.max(now + 60_000, expMs - 24 * 3600 * 1000);
  }

  tokenCache = { accessToken, refreshAt };
  return accessToken;
}

export interface TransakSessionParams {
  /** "BUY" (fiat→crypto) or "SELL" (crypto→fiat). */
  product:        "BUY" | "SELL";
  /** Transak network slug, e.g. "bsc", "ethereum", "polygon". */
  network:        string;
  /** Symbol Transak knows, e.g. "WBNB", "ETH", "USDC". */
  cryptoCurrency: string;
  /** Destination (BUY) / source (SELL) wallet address. */
  walletAddress:  string;
  /** Must match the domain the iframe is embedded on. */
  referrerDomain: string;
  /** BRL amount for BUY (optional). */
  fiatAmount?:    number;
  /** Crypto amount for SELL (optional). */
  cryptoAmount?:  number;
  /** Hex color w/o '#'. */
  themeColor?:    string;
}

/**
 * Build an authenticated, one-time widget URL for the browser to embed.
 * Throws TransakConfigError when env vars are missing, TransakUpstreamError
 * when Transak rejects the request (bad referrerDomain, IP not whitelisted,
 * invalid currency/network, etc.) — the route maps these to clean HTTP codes.
 */
export async function createTransakWidgetUrl(p: TransakSessionParams): Promise<string> {
  const { apiKey } = getCreds();
  const accessToken = await getAccessToken();

  // widgetParams encapsulates the same fields the legacy query string
  // used, plus the now-mandatory referrerDomain.
  const widgetParams: Record<string, unknown> = {
    apiKey,
    referrerDomain:            p.referrerDomain,
    productsAvailed:           p.product,
    defaultCryptoCurrency:     p.cryptoCurrency,
    cryptoCurrencyCode:        p.cryptoCurrency,
    network:                   p.network,
    walletAddress:             p.walletAddress,
    disableWalletAddressForm:  true,
    cryptoCurrencyLock:        true,
    networkLock:               true,
    fiatCurrency:              "BRL",
    countryCode:               "BR",
    defaultPaymentMethod:      "pix",
    paymentMethod:             "pix",
    themeColor:                p.themeColor ?? "00E8FF",
    hideMenu:                  true,
  };
  if (p.product === "BUY" && p.fiatAmount && p.fiatAmount > 0) {
    widgetParams.fiatAmount = p.fiatAmount;
  }
  if (p.product === "SELL" && p.cryptoAmount && p.cryptoAmount > 0) {
    widgetParams.cryptoAmount = p.cryptoAmount;
  }

  const res = await fetch(`${TRANSAK_GATEWAY_BASE}/api/v2/auth/session`, {
    method:  "POST",
    headers: {
      "accept":       "application/json",
      "content-type": "application/json",
      "access-token": accessToken,
    },
    body: JSON.stringify({ widgetParams }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    // 401 here usually means a stale access token — clear the cache so the
    // next call re-mints. Surface the upstream message either way.
    if (res.status === 401) tokenCache = null;
    throw new TransakUpstreamError(
      `session failed: ${text.slice(0, 240)}`,
      res.status,
    );
  }

  let parsed: { data?: { widgetUrl?: string }; widgetUrl?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new TransakUpstreamError("session returned non-JSON", 502);
  }

  const widgetUrl = parsed.data?.widgetUrl ?? parsed.widgetUrl;
  if (!widgetUrl || typeof widgetUrl !== "string" || !widgetUrl.startsWith("http")) {
    throw new TransakUpstreamError("session response missing widgetUrl", 502);
  }
  return widgetUrl;
}
