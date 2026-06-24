// DefiLlama API — free, no key
// https://defillama.com/docs/api
//
// We use the DEX overview endpoint purely for one honest, citable market
// metric: aggregate 24h on-chain DEX volume. This is MARKET data (the total
// addressable flow Z-SWAP routes against), not Z-SWAP's own volume — surfaces
// must label it as such.

const DEX_OVERVIEW_URL = "https://api.llama.fi/overview/dexs";

export interface DexMarketStats {
  /** Aggregate 24h volume across all tracked DEX protocols, in USD. */
  volume24h: number;
  /** Number of DEX protocols DefiLlama tracks. */
  protocols: number;
}

interface LlamaDexOverview {
  total24h?:        number;
  totalDataChart?:  unknown;
  protocols?:       unknown[];
}

/**
 * Fetch aggregate on-chain DEX market stats from DefiLlama.
 * Returns null on any failure so callers degrade gracefully (no fabricated
 * fallback numbers — a missing value renders as a dash, never a guess).
 */
export async function getDexMarketStats(): Promise<DexMarketStats | null> {
  try {
    const res = await fetch(DEX_OVERVIEW_URL, {
      headers: { accept: "application/json" },
      next:    { revalidate: 600 }, // 10 min ISR — market volume moves slowly
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LlamaDexOverview;
    const volume24h = typeof data.total24h === "number" ? data.total24h : null;
    if (volume24h === null) return null;
    return {
      volume24h,
      protocols: Array.isArray(data.protocols) ? data.protocols.length : 0,
    };
  } catch {
    return null;
  }
}
