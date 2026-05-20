/**
 * Unified quote model — same shape regardless of which aggregator produced
 * it. Used by the quote comparison panel and the execute flow.
 */

import type { ZxQuoteResponse, ZxPriceResponse, ZxFill } from "./zerox";
import type { LfQuote }                                  from "./lifi";

export type QuoteSource = "0x" | "lifi";

export interface NormalizedQuote {
  source:         QuoteSource;
  /** Friendly source label e.g. "0x Settler", "LiFi · via Stargate" */
  label:          string;
  /** Approximate execution time in seconds (cross-chain bridges add minutes) */
  durationSec:    number;
  isCrossChain:   boolean;
  fromChainId:    number;
  toChainId:      number;

  // Amounts (base units, big-int strings)
  sellAmount:     string;
  buyAmount:      string;
  minBuyAmount:   string;

  // Display approximations
  buyAmountUsd?:  number;
  gasUsd?:        number;

  // Routing
  routeSummary:   string;       // e.g. "Uniswap V3 → Curve" or "Stargate (bridge) → 1inch (Base)"
  hops:           { protocol: string; share: number; color?: string }[];

  // Raw payload (for execution; type-erased to keep the union flat)
  raw:            ZxQuoteResponse | ZxPriceResponse | LfQuote;

  // Useful flags
  isFirm:         boolean;      // true = with calldata ready (0x quote mode, LiFi)
  isIndicative:   boolean;      // true = price-only (0x price mode)
}

// ─── 0x normalizers ─────────────────────────────────────────────────

const ZEROX_DEX_LABEL: Record<string, { name: string; color: string }> = {
  uniswap_v2:     { name: "Uniswap V2",     color: "#FF007A" },
  uniswap_v3:     { name: "Uniswap V3",     color: "#FF007A" },
  uniswap_v4:     { name: "Uniswap V4",     color: "#FF007A" },
  pancakeswap:    { name: "PancakeSwap",    color: "#F3BA2F" },
  pancakeswap_v3: { name: "PancakeSwap V3", color: "#F3BA2F" },
  curve:          { name: "Curve",          color: "#3676FF" },
  curve_v2:       { name: "Curve V2",       color: "#3676FF" },
  balancer:       { name: "Balancer",       color: "#FF6B00" },
  balancer_v2:    { name: "Balancer V2",    color: "#FF6B00" },
  sushiswap:      { name: "SushiSwap",      color: "#FA52A0" },
  aerodrome:      { name: "Aerodrome",      color: "#5046E5" },
  velodrome:      { name: "Velodrome",      color: "#FF0420" },
  trader_joe:     { name: "Trader Joe",     color: "#E84142" },
  maverick:       { name: "Maverick",       color: "#FF5C8A" },
  zeroex:         { name: "0x RFQ",         color: "#00E8FF" },
};

function zeroXHopFromFill(f: ZxFill) {
  const key = f.source.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  const meta = ZEROX_DEX_LABEL[key] ?? { name: f.source, color: "#9F5FFF" };
  return { protocol: meta.name, share: f.proportionBps / 10_000, color: meta.color };
}

export function normalizeZeroX(
  q: ZxQuoteResponse | ZxPriceResponse,
  chainId: number,
  isFirm: boolean,
): NormalizedQuote {
  const hops = (q.route?.fills ?? []).map(zeroXHopFromFill).sort((a, b) => b.share - a.share);
  const routeSummary = hops.length
    ? hops.slice(0, 3).map((h) => h.protocol).join(" · ") + (hops.length > 3 ? " …" : "")
    : "0x aggregator";
  const gasUsd = q.totalNetworkFee
    ? Number(q.totalNetworkFee) / 1e18 * 1   // approximate, 0x doesn't always return native price
    : undefined;
  return {
    source:        "0x",
    label:         "0x Settler",
    durationSec:   12,                       // 1 block on most chains
    isCrossChain:  false,
    fromChainId:   chainId,
    toChainId:     chainId,
    sellAmount:    q.sellAmount,
    buyAmount:     q.buyAmount,
    minBuyAmount:  q.minBuyAmount,
    routeSummary,
    hops,
    raw:           q,
    isFirm,
    isIndicative:  !isFirm,
    gasUsd,
  };
}

// ─── LiFi normalizer ────────────────────────────────────────────────

export function normalizeLiFi(q: LfQuote): NormalizedQuote {
  const steps  = q.includedSteps ?? [];
  const isCC   = q.action.fromChainId !== q.action.toChainId;
  const top    = (q.toolDetails?.name ?? q.tool ?? "LiFi").trim();
  const stepsLabel = steps
    .map((s) => s.toolDetails?.name ?? s.tool)
    .filter((x): x is string => !!x)
    .slice(0, 4)
    .join(" → ");
  const routeSummary = stepsLabel || top;
  const hops = steps.map((s) => ({
    protocol: s.toolDetails?.name ?? s.tool,
    share:    1 / Math.max(steps.length, 1),
    color:    s.type === "cross" ? "#9F5FFF" : "#00E8FF",
  }));
  const gasUsd = (q.estimate.gasCosts ?? []).reduce(
    (acc, g) => acc + (g.amountUSD ? parseFloat(g.amountUSD) : 0),
    0,
  );
  return {
    source:        "lifi",
    label:         isCC ? `LiFi · ${top}` : `LiFi · ${top}`,
    durationSec:   q.estimate.executionDuration,
    isCrossChain:  isCC,
    fromChainId:   q.action.fromChainId,
    toChainId:     q.action.toChainId,
    sellAmount:    q.estimate.fromAmount,
    buyAmount:     q.estimate.toAmount,
    minBuyAmount:  q.estimate.toAmountMin,
    routeSummary,
    hops,
    raw:           q,
    isFirm:        true,
    isIndicative:  false,
    gasUsd:        gasUsd || undefined,
  };
}

/**
 * Rank quotes by best output. Prefer minBuyAmount (worst-case guarantee);
 * fall back to buyAmount when the source returns only a price-mode response
 * with no minimum — otherwise indicative quotes would unfairly rank last.
 */
export function rankQuotes(quotes: NormalizedQuote[]): NormalizedQuote[] {
  const score = (q: NormalizedQuote) => {
    const min = q.minBuyAmount && q.minBuyAmount !== "0" ? q.minBuyAmount : null;
    return BigInt(min ?? q.buyAmount ?? "0");
  };
  return [...quotes].sort((a, b) => {
    const aS = score(a);
    const bS = score(b);
    if (aS > bS) return -1;
    if (aS < bS) return  1;
    return a.durationSec - b.durationSec;
  });
}
