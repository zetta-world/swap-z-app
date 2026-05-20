import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { validateAddress } from "@/lib/validate";
import { getPairDetail, type PairDetail } from "@/lib/api/dexscreener";
import { getTokenSecurity, isGoPlusSupported, type GoPlusTokenSecurity } from "@/lib/api/goplus";
import { getHoneypot, isHoneypotSupported, type HoneypotResponse } from "@/lib/api/honeypot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 60 };

// DexScreener uses lowercase chain slugs that don't always match our internal
// ChainId. Map our slugs → DexScreener's expected ones (most overlap, a few
// differ on edge chains).
const DS_CHAIN_ALIAS: Record<string, string> = {
  ethereum: "ethereum",
  bsc:      "bsc",
  polygon:  "polygon",
  base:     "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  avalanche:"avalanche",
  linea:    "linea",
  zksync:   "zksync",
  solana:   "solana",
};

interface PairAuditSummary {
  isHoneypot:  boolean;
  buyTax:      number | null;
  sellTax:     number | null;
  openSource:  boolean | null;
  proxy:       boolean | null;
  mintable:    boolean | null;
  topHolderPct: number | null;
  lpLockedPct:  number | null;
  honeypotRisk: "low" | "medium" | "high" | null;
  source:       ("goplus" | "honeypot")[];
}

export interface PairApiResponse {
  ok:        boolean;
  pair:      PairDetail | null;
  audit:     PairAuditSummary | null;
  /** Computed: how long ago the pair was created, in seconds (null if unknown). */
  ageSec:    number | null;
  /** Computed: 24h buy/sell composite scores (0-1, sum = 1). */
  pressure:  {
    txns:    { buy: number; sell: number };
    volume:  { buy: number; sell: number };
    wallets: { buy: number; sell: number } | null;
  };
  ts:        number;
}

/**
 * /api/pair?chain=ethereum&pair=0x...  (or chain=solana&pair=base58)
 *
 * The pair-detail page is fed entirely from this one endpoint: DexScreener
 * provides the bulk of stats (price, liquidity, FDV, deltas, txns split,
 * pooled balances, pair created at, socials) and GoPlus + Honeypot.is layer
 * the audit summary on top when the chain is supported.
 *
 * We deliberately do NOT proxy GeckoTerminal candles here — those go through
 * /api/ohlcv to keep payloads light and cache strategies decoupled.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`pair:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const params = req.nextUrl.searchParams;
  const chainParam = params.get("chain")?.toLowerCase() ?? "";
  const pairParam  = params.get("pair") ?? "";

  if (!chainParam || !DS_CHAIN_ALIAS[chainParam]) {
    return NextResponse.json({ ok: false, error: "invalid_chain" }, { status: 400 });
  }
  const pair = validateAddress(pairParam);
  if (!pair || pair === "native") {
    return NextResponse.json({ ok: false, error: "invalid_pair_address" }, { status: 400 });
  }
  const dsChain = DS_CHAIN_ALIAS[chainParam];

  // Fetch pair + audit in parallel. The audit calls are best-effort —
  // a 404 / network blip should never fail the whole response.
  const [detail, audit] = await Promise.all([
    getPairDetail(dsChain, pair),
    null as Promise<PairAuditSummary | null> | null,
  ]);

  let auditRes: PairAuditSummary | null = null;
  if (detail && detail.baseToken.address) {
    const supportsGoPlus    = isGoPlusSupported(chainParam);
    const supportsHoneypot  = isHoneypotSupported(chainParam);
    if (supportsGoPlus || supportsHoneypot) {
      const [sec, honey] = await Promise.all([
        supportsGoPlus    ? getTokenSecurity(chainParam, detail.baseToken.address).catch(() => null) : Promise.resolve(null),
        supportsHoneypot  ? getHoneypot(chainParam, detail.baseToken.address).catch(() => null)      : Promise.resolve(null),
      ]);
      auditRes = compactAudit(sec, honey);
    }
  }

  if (!detail) {
    return NextResponse.json(
      { ok: false, error: "pair_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Date.now();
  const ageSec = detail.pairCreatedAt > 0 ? Math.max(0, Math.floor((now - detail.pairCreatedAt) / 1000)) : null;

  const body: PairApiResponse = {
    ok: true,
    pair: detail,
    audit: auditRes,
    ageSec,
    pressure: computePressure(detail),
    ts: now,
  };

  return NextResponse.json(body, {
    headers: {
      // Pair details change quickly (txns, price); keep the edge cache short.
      "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
    },
  });
}

function compactAudit(s: GoPlusTokenSecurity | null, h: HoneypotResponse | null): PairAuditSummary | null {
  if (!s && !h) return null;
  const top10 = s?.holders
    ? s.holders.slice(0, 10).reduce((acc, x) => acc + parseFloat(x.percent || "0"), 0)
    : null;
  const locked = s?.lp_holders
    ? s.lp_holders.filter((x) => x.is_locked === 1)
        .reduce((acc, x) => acc + parseFloat(x.percent || "0"), 0)
    : null;
  const buyTax  = s?.buy_tax  ? parseFloat(s.buy_tax)  : null;
  const sellTax = s?.sell_tax ? parseFloat(s.sell_tax) : null;
  const honeypotResult = h?.honeypotResult?.isHoneypot ?? false;
  const goplusHp       = s?.is_honeypot === "1";
  return {
    isHoneypot:  !!(honeypotResult || goplusHp),
    buyTax,
    sellTax,
    openSource:  s?.is_open_source === undefined ? null : s.is_open_source === "1",
    proxy:       s?.is_proxy === undefined       ? null : s.is_proxy === "1",
    mintable:    s?.is_mintable === undefined    ? null : s.is_mintable === "1",
    topHolderPct: top10  !== null ? top10  * 100 : null,
    lpLockedPct:  locked !== null ? locked * 100 : null,
    honeypotRisk: h?.summary?.risk === "high" ? "high"
                : h?.summary?.risk === "medium" ? "medium"
                : h?.summary?.risk === "low"    ? "low"
                :                                  null,
    source: [
      ...(s ? ["goplus"]   as const : []),
      ...(h ? ["honeypot"] as const : []),
    ],
  };
}

function computePressure(p: PairDetail): PairApiResponse["pressure"] {
  const txBuys  = p.txns.h24.buys;
  const txSells = p.txns.h24.sells;
  const txTotal = txBuys + txSells;
  const txRatio = txTotal === 0
    ? { buy: 0.5, sell: 0.5 }
    : { buy: txBuys / txTotal, sell: txSells / txTotal };

  // DexScreener doesn't split volume buy/sell directly — approximate by tx
  // ratio (good enough for the visualization; user sees the breakdown in
  // the stats grid below the sphere).
  const volBuy  = p.volume.h24 * txRatio.buy;
  const volSell = p.volume.h24 * txRatio.sell;
  const volRatio = p.volume.h24 === 0
    ? { buy: 0.5, sell: 0.5 }
    : { buy: volBuy / p.volume.h24, sell: volSell / p.volume.h24 };

  return {
    txns:    txRatio,
    volume:  volRatio,
    wallets: null, // DexScreener public API doesn't expose unique wallets
  };
}
