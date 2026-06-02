import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import {
  createTransakWidgetUrl,
  TransakConfigError,
  TransakUpstreamError,
} from "@/lib/onramp/transak-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pin to a stable non-US region so Transak's IP allowlist has a fixed
// target to whitelist (Vercel's default pool rotates per-request). Same
// rationale as the /api/cex/* routes.
export const preferredRegion = ["gru1", "fra1"];

// Generous — the browser hits this once per widget open. 20/min/IP is
// plenty for legitimate use and tight enough to blunt abuse.
const RL_OPTS = { windowMs: 60_000, max: 20 };

interface BodyShape {
  product:        string;   // "BUY" | "SELL"
  network:        string;   // transak slug
  cryptoCurrency: string;   // symbol
  walletAddress:  string;
  fiatAmount?:    number;
  cryptoAmount?:  number;
}

/**
 * POST /api/onramp/transak/session
 *
 * Server-side mint of a one-time Transak widget URL. The browser sends
 * the user's selections (token, network, wallet, amount); we attach the
 * partner credentials + referrerDomain and return the authenticated
 * widgetUrl for the iframe.
 *
 * Nothing user-identifying is stored or logged beyond what's needed to
 * debug an upstream failure. The API secret never leaves the server.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = rateLimit(`transak_session:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: BodyShape;
  try {
    body = await req.json() as BodyShape;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const product = String(body.product || "").toUpperCase();
  if (product !== "BUY" && product !== "SELL") {
    return NextResponse.json({ ok: false, error: "invalid_product" }, { status: 400 });
  }
  if (typeof body.network !== "string" || !/^[a-z0-9_]{2,32}$/i.test(body.network)) {
    return NextResponse.json({ ok: false, error: "invalid_network" }, { status: 400 });
  }
  if (typeof body.cryptoCurrency !== "string" || !/^[A-Z0-9.]{2,20}$/i.test(body.cryptoCurrency)) {
    return NextResponse.json({ ok: false, error: "invalid_crypto" }, { status: 400 });
  }
  if (typeof body.walletAddress !== "string" || body.walletAddress.length < 10 || body.walletAddress.length > 120) {
    return NextResponse.json({ ok: false, error: "invalid_wallet" }, { status: 400 });
  }
  if (body.fiatAmount !== undefined && (typeof body.fiatAmount !== "number" || !Number.isFinite(body.fiatAmount) || body.fiatAmount < 0 || body.fiatAmount > 1_000_000)) {
    return NextResponse.json({ ok: false, error: "invalid_fiat_amount" }, { status: 400 });
  }
  if (body.cryptoAmount !== undefined && (typeof body.cryptoAmount !== "number" || !Number.isFinite(body.cryptoAmount) || body.cryptoAmount < 0)) {
    return NextResponse.json({ ok: false, error: "invalid_crypto_amount" }, { status: 400 });
  }

  // referrerDomain MUST match the origin the iframe is embedded on, or
  // Transak rejects the session at runtime. Derive it from the request
  // origin, with an env override for custom-domain deployments.
  const referrerDomain = resolveReferrerDomain(req);
  if (!referrerDomain) {
    return NextResponse.json({ ok: false, error: "cannot_resolve_referrer" }, { status: 400 });
  }

  try {
    const widgetUrl = await createTransakWidgetUrl({
      product:        product as "BUY" | "SELL",
      network:        body.network.toLowerCase(),
      cryptoCurrency: body.cryptoCurrency.toUpperCase(),
      walletAddress:  body.walletAddress,
      referrerDomain,
      fiatAmount:     body.fiatAmount,
      cryptoAmount:   body.cryptoAmount,
    });
    return NextResponse.json(
      { ok: true, widgetUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof TransakConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured", detail: err.message }, { status: 503 });
    }
    if (err instanceof TransakUpstreamError) {
      const detail = err.message.slice(0, 240);
      console.warn("[onramp/transak/session] upstream failed:", err.status, detail);
      return NextResponse.json(
        { ok: false, error: "upstream_failed", detail },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[onramp/transak/session] error:", msg.slice(0, 200));
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

/**
 * Resolve the domain the widget is embedded on. Priority:
 *   1. TRANSAK_REFERRER_DOMAIN env (explicit override for custom domains)
 *   2. The Origin header host
 *   3. The Host header
 * Returns a bare host (no scheme, no path) — what Transak expects.
 */
function resolveReferrerDomain(req: NextRequest): string | null {
  const override = process.env.TRANSAK_REFERRER_DOMAIN;
  if (override) return override.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  const origin = req.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host; } catch { /* fall through */ }
  }
  const host = req.headers.get("host");
  if (host) return host;
  return null;
}
