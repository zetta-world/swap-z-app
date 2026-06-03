import { NextRequest, NextResponse } from "next/server";

/**
 * Live USD price feed for tokens across every chain the platform tracks.
 *
 * Query:
 *   GET /api/prices?tokens=ethereum:native,ethereum:0xa0b8...,solana:native
 *
 * Response:
 *   { ok: true, prices: { "ethereum:native": 3450.12, ... }, ts: 1716... }
 *
 * Internals:
 *   - Native tokens (address === "native") map to a CoinGecko coin id
 *     and are batched into a single /simple/price call. Free-tier rate
 *     limits are generous (~30 req/min); we hit it at most once per
 *     unique chain-set per 60 s thanks to next.revalidate.
 *   - ERC-20 / SPL tokens map to GeckoTerminal's multi-token endpoint
 *     (https://api.geckoterminal.com/api/v2/networks/{net}/tokens/multi/
 *     {addr1,addr2,…}), capped at 30 addresses per call.
 *   - Cache: next.revalidate = 60 s per upstream call; the route itself
 *     uses s-maxage = 60 / stale-while-revalidate = 120 on the response.
 *
 * Failure mode is silent: any token that the upstream can't price comes
 * back as `null` — the frontend is expected to fall back gracefully
 * (hide USD, show token amount only). We NEVER substitute a fabricated
 * fallback price.
 */

export const runtime = "nodejs";

// internal ChainId → GeckoTerminal network slug
const GECKO_NETWORK: Record<string, string> = {
  ethereum:  "eth",
  bsc:       "bsc",
  polygon:   "polygon_pos",
  base:      "base",
  arbitrum:  "arbitrum",
  optimism:  "optimism",
  avalanche: "avax",
  zksync:    "zksync",
  linea:     "linea",
  solana:    "solana",
};

// Native token → CoinGecko coin id (free tier /simple/price)
const COINGECKO_NATIVE_ID: Record<string, string> = {
  ethereum:  "ethereum",
  bsc:       "binancecoin",
  polygon:   "polygon-ecosystem-token",
  base:      "ethereum",
  arbitrum:  "ethereum",
  optimism:  "ethereum",
  avalanche: "avalanche-2",
  zksync:    "ethereum",
  linea:     "ethereum",
  solana:    "solana",
};

// Cap how many tokens we'll resolve per request — defensive against an
// upstream caller spamming us with thousands of addresses. The portfolio
// page tracks 17, the swap card 2; anything > 80 is suspicious.
const MAX_TOKENS = 80;

interface ParsedTok { chain: string; addr: string; key: string }

function parseQuery(raw: string): ParsedTok[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: ParsedTok[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const [chainRaw, addrRaw] = trimmed.split(":");
    if (!chainRaw || !addrRaw) continue;
    const chain = chainRaw.toLowerCase();
    const addr  = addrRaw === "native" ? "native" : addrRaw.toLowerCase();
    const key   = `${chain}:${addr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chain, addr, key });
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

// Rate limit defense-in-depth: the response is CDN-cacheable per unique
// `tokens` query but a malicious caller can sidestep the cache by adding
// dummy params or rotating the token list. 90 req/min/IP is generous
// for legitimate use (the swap card re-quotes on every input keystroke).
const RL_OPTS = { windowMs: 60_000, max: 90 };

export async function GET(req: NextRequest) {
  const { rateLimit, getClientId } = await import("@/lib/rate-limit");
  const rl = rateLimit(`prices:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const tokens = parseQuery(req.nextUrl.searchParams.get("tokens") || "");

  if (tokens.length === 0) {
    return NextResponse.json({ ok: true, prices: {} as Record<string, number | null>, ts: Date.now() });
  }

  // Split into native vs contract. Natives go to CoinGecko by coin id;
  // contracts go to GeckoTerminal grouped by chain.
  const natives:    ParsedTok[]                              = [];
  const byChain:    Record<string, ParsedTok[]>              = {};
  for (const t of tokens) {
    if (t.addr === "native") natives.push(t);
    else (byChain[t.chain] ||= []).push(t);
  }

  const result: Record<string, number | null> = {};
  for (const t of tokens) result[t.key] = null; // default to "unknown" so the caller can tell

  // ─── Natives (CoinGecko) ────────────────────────────────────────────
  if (natives.length > 0) {
    const ids = [...new Set(
      natives.map((n) => COINGECKO_NATIVE_ID[n.chain]).filter((id): id is string => !!id),
    )];
    if (ids.length > 0) {
      try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
        const res = await fetch(url, { next: { revalidate: 60 } });
        if (res.ok) {
          const body = await res.json() as Record<string, { usd?: number }>;
          for (const n of natives) {
            const id = COINGECKO_NATIVE_ID[n.chain];
            const px = id ? body[id]?.usd : undefined;
            if (typeof px === "number" && Number.isFinite(px)) result[n.key] = px;
          }
        }
      } catch (err) {
        console.warn("[prices] coingecko failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  // ─── Contracts (GeckoTerminal multi-token, per chain, ≤30 per call) ─
  await Promise.all(
    Object.entries(byChain).map(async ([chain, list]) => {
      const network = GECKO_NETWORK[chain];
      if (!network) return;
      for (let i = 0; i < list.length; i += 30) {
        const batch = list.slice(i, i + 30);
        const addrs = batch.map((b) => b.addr).join(",");
        const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/multi/${addrs}`;
        try {
          const res = await fetch(url, {
            headers: { Accept: "application/json;version=20230302" },
            next: { revalidate: 60 },
          });
          if (!res.ok) continue;
          const body = await res.json() as { data?: Array<{ attributes?: { address?: string; price_usd?: string } }> };
          const items = body.data ?? [];
          for (const item of items) {
            const attrs = item.attributes;
            if (!attrs?.address) continue;
            const px = attrs.price_usd ? parseFloat(attrs.price_usd) : NaN;
            if (!Number.isFinite(px)) continue;
            // GeckoTerminal returns lowercase addresses, our keys match
            result[`${chain}:${attrs.address.toLowerCase()}`] = px;
          }
        } catch (err) {
          console.warn("[prices] geckoterminal failed:", err instanceof Error ? err.message : err);
        }
      }
    }),
  );

  return NextResponse.json(
    { ok: true, prices: result, ts: Date.now() },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
