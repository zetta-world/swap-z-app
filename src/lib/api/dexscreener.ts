// DexScreener API — free, no key
// https://docs.dexscreener.com/api/reference

interface DSPair {
  chainId?:    string;
  dexId?:      string;
  url?:        string;
  pairAddress?: string;
  baseToken?:  { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceNative?: string;
  priceUsd?:   string;
  liquidity?:  { usd?: number; base?: number; quote?: number };
  volume?:     { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number; m5?: number };
  fdv?:        number;
  marketCap?:  number;
  pairCreatedAt?: number;
  info?:       { imageUrl?: string };
}

export interface TrendingPair {
  chain:     string;
  dex:       string;
  symbol:    string;
  baseSymbol: string;
  quoteSymbol: string;
  priceUsd:  number;
  change24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  url:       string;
  baseAddress: string;
  pairAddress: string;
}

function pairToTrending(p: DSPair): TrendingPair {
  return {
    chain:       p.chainId ?? "",
    dex:         p.dexId ?? "",
    symbol:      `${p.baseToken?.symbol ?? ""}/${p.quoteToken?.symbol ?? ""}`,
    baseSymbol:  p.baseToken?.symbol ?? "",
    quoteSymbol: p.quoteToken?.symbol ?? "",
    priceUsd:    parseFloat(p.priceUsd ?? "0") || 0,
    change24h:   Number(p.priceChange?.h24) || 0,
    volume24h:   Number(p.volume?.h24) || 0,
    liquidity:   Number(p.liquidity?.usd) || 0,
    marketCap:   Number(p.marketCap) || 0,
    url:         p.url ?? "",
    baseAddress: p.baseToken?.address ?? "",
    pairAddress: p.pairAddress ?? "",
  };
}

/**
 * DexScreener doesn't expose a /trending endpoint publicly. We fetch a curated
 * set of well-known active pairs and rank by 24h volume. For broader trending,
 * we also use search queries for common active tokens.
 */
export async function getTrending(limit = 12): Promise<TrendingPair[]> {
  // Use the search endpoint with terms that surface active pairs
  const queries = ["wif", "pepe", "doge", "shib"];
  const all: TrendingPair[] = [];
  await Promise.all(
    queries.map(async (q) => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {
          headers: { Accept: "application/json" },
          next: { revalidate: 60 },
        });
        if (!res.ok) return;
        const data = await res.json() as { pairs?: DSPair[] };
        (data.pairs ?? []).slice(0, 4).forEach((p) => all.push(pairToTrending(p)));
      } catch {
        /* swallow */
      }
    }),
  );
  // Dedupe by pairAddress
  const seen = new Set<string>();
  const dedup = all.filter((p) => {
    if (!p.pairAddress || seen.has(p.pairAddress)) return false;
    seen.add(p.pairAddress);
    return true;
  });
  // Rank by 24h volume desc
  return dedup.sort((a, b) => b.volume24h - a.volume24h).slice(0, limit);
}

export async function getPairsForToken(chainName: string, tokenAddress: string): Promise<TrendingPair[]> {
  if (!tokenAddress || tokenAddress === "native") return [];
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { pairs?: DSPair[] };
    return (data.pairs ?? []).filter((p) => p.chainId === chainName).map(pairToTrending);
  } catch {
    return [];
  }
}
