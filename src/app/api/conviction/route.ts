import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { validateAddress } from "@/lib/validate";
import { getPairDetail } from "@/lib/api/dexscreener";
import { getTokenSecurity, isGoPlusSupported, type GoPlusTokenSecurity } from "@/lib/api/goplus";
import { getHoneypot, isHoneypotSupported, type HoneypotResponse } from "@/lib/api/honeypot";
import { computeConviction, type ConvictionAudit } from "@/lib/conviction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 60 };

const DS_CHAIN_ALIAS: Record<string, string> = {
  ethereum: "ethereum", bsc: "bsc", polygon: "polygon", base: "base",
  arbitrum: "arbitrum", optimism: "optimism", avalanche: "avalanche",
  linea: "linea", zksync: "zksync", solana: "solana",
};

/**
 * /api/conviction?chain=ethereum&pair=0x...  (or chain=solana&pair=base58)
 *
 * Composite 0-100 conviction score for a pair, computed deterministically
 * from DexScreener + GoPlus + Honeypot.is. Same formula the PairView shows
 * inline; this endpoint exists for headless embeds, ZION cards, and the
 * Radar's drill-down request.
 *
 * Returns the score, band, color, one-line summary, and the full factor
 * breakdown that contributed.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`conv:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const params     = req.nextUrl.searchParams;
  const chainParam = params.get("chain")?.toLowerCase() ?? "";
  const pairParam  = params.get("pair") ?? "";

  if (!chainParam || !DS_CHAIN_ALIAS[chainParam]) {
    return NextResponse.json({ ok: false, error: "invalid_chain" }, { status: 400 });
  }
  const pair = validateAddress(pairParam);
  if (!pair || pair === "native") {
    return NextResponse.json({ ok: false, error: "invalid_pair_address" }, { status: 400 });
  }

  const detail = await getPairDetail(DS_CHAIN_ALIAS[chainParam], pair);
  if (!detail) {
    return NextResponse.json(
      { ok: false, error: "pair_not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Audit (best-effort)
  let audit: ConvictionAudit | null = null;
  if (detail.baseToken.address) {
    const supportsGoPlus    = isGoPlusSupported(chainParam);
    const supportsHoneypot  = isHoneypotSupported(chainParam);
    if (supportsGoPlus || supportsHoneypot) {
      const [sec, honey] = await Promise.all([
        supportsGoPlus    ? getTokenSecurity(chainParam, detail.baseToken.address).catch(() => null) : Promise.resolve(null),
        supportsHoneypot  ? getHoneypot(chainParam, detail.baseToken.address).catch(() => null)      : Promise.resolve(null),
      ]);
      audit = compactAudit(sec, honey);
    }
  }

  const txTotal = detail.txns.h24.buys + detail.txns.h24.sells;
  const txRatio = txTotal === 0
    ? { buy: 0.5, sell: 0.5 }
    : { buy: detail.txns.h24.buys / txTotal, sell: detail.txns.h24.sells / txTotal };

  const ageSec = detail.pairCreatedAt > 0
    ? Math.max(0, Math.floor((Date.now() - detail.pairCreatedAt) / 1000))
    : null;

  const result = computeConviction({
    audit,
    pressureTxns:   txRatio,
    pressureVolume: txRatio,   // approximate (DS doesn't return volume buy/sell)
    liquidityUsd:   detail.liquidity.usd,
    volume24hUsd:   detail.volume.h24,
    ageSec,
    change24hPct:   detail.priceChange.h24,
  });

  return NextResponse.json(
    {
      ok:    true,
      chain: chainParam,
      pair,
      symbol: `${detail.baseToken.symbol}/${detail.quoteToken.symbol}`,
      conviction: result,
      ts:    Date.now(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}

function compactAudit(s: GoPlusTokenSecurity | null, h: HoneypotResponse | null): ConvictionAudit | null {
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
  return {
    isHoneypot:   !!(h?.honeypotResult?.isHoneypot || s?.is_honeypot === "1"),
    buyTax,
    sellTax,
    openSource:   s?.is_open_source === undefined ? null : s.is_open_source === "1",
    proxy:        s?.is_proxy === undefined       ? null : s.is_proxy === "1",
    mintable:     s?.is_mintable === undefined    ? null : s.is_mintable === "1",
    topHolderPct: top10  !== null ? top10  * 100 : null,
    lpLockedPct:  locked !== null ? locked * 100 : null,
    honeypotRisk: h?.summary?.risk === "high"   ? "high"
                : h?.summary?.risk === "medium" ? "medium"
                : h?.summary?.risk === "low"    ? "low"
                :                                  null,
  };
}
