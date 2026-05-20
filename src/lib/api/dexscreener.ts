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
  txns?:       { h24?: { buys?: number; sells?: number }; h6?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number }; m5?: { buys?: number; sells?: number } };
  fdv?:        number;
  marketCap?:  number;
  pairCreatedAt?: number;
  info?:       { imageUrl?: string; websites?: { url?: string }[]; socials?: { type?: string; url?: string }[] };
}

export interface PairDetail {
  chainId:     string;
  dex:         string;
  url:         string;
  pairAddress: string;
  baseToken:   { address: string; name: string; symbol: string };
  quoteToken:  { address: string; name: string; symbol: string };
  priceUsd:    number;
  priceNative: number;
  liquidity:   { usd: number; base: number; quote: number };
  volume:      { h24: number; h6: number; h1: number; m5: number };
  priceChange: { h24: number; h6: number; h1: number; m5: number };
  txns:        { h24: { buys: number; sells: number }; h6: { buys: number; sells: number }; h1: { buys: number; sells: number }; m5: { buys: number; sells: number } };
  fdv:         number;
  marketCap:   number;
  pairCreatedAt: number;
  imageUrl?:   string;
  websites:    string[];
  socials:     { type: string; url: string }[];
}

function pairToDetail(p: DSPair): PairDetail {
  return {
    chainId:     p.chainId ?? "",
    dex:         p.dexId ?? "—",
    url:         p.url ?? "",
    pairAddress: p.pairAddress ?? "",
    baseToken:   {
      address: p.baseToken?.address ?? "",
      name:    p.baseToken?.name    ?? "",
      symbol:  p.baseToken?.symbol  ?? "",
    },
    quoteToken:  {
      address: p.quoteToken?.address ?? "",
      name:    p.quoteToken?.name    ?? "",
      symbol:  p.quoteToken?.symbol  ?? "",
    },
    priceUsd:    Number(p.priceUsd)    || 0,
    priceNative: Number(p.priceNative) || 0,
    liquidity: {
      usd:   Number(p.liquidity?.usd)   || 0,
      base:  Number(p.liquidity?.base)  || 0,
      quote: Number(p.liquidity?.quote) || 0,
    },
    volume: {
      h24: Number(p.volume?.h24) || 0,
      h6:  Number(p.volume?.h6)  || 0,
      h1:  Number(p.volume?.h1)  || 0,
      m5:  Number(p.volume?.m5)  || 0,
    },
    priceChange: {
      h24: Number(p.priceChange?.h24) || 0,
      h6:  Number(p.priceChange?.h6)  || 0,
      h1:  Number(p.priceChange?.h1)  || 0,
      m5:  Number(p.priceChange?.m5)  || 0,
    },
    txns: {
      h24: { buys: Number(p.txns?.h24?.buys) || 0, sells: Number(p.txns?.h24?.sells) || 0 },
      h6:  { buys: Number(p.txns?.h6?.buys)  || 0, sells: Number(p.txns?.h6?.sells)  || 0 },
      h1:  { buys: Number(p.txns?.h1?.buys)  || 0, sells: Number(p.txns?.h1?.sells)  || 0 },
      m5:  { buys: Number(p.txns?.m5?.buys)  || 0, sells: Number(p.txns?.m5?.sells)  || 0 },
    },
    fdv:           Number(p.fdv)         || 0,
    marketCap:     Number(p.marketCap)   || 0,
    pairCreatedAt: Number(p.pairCreatedAt) || 0,
    imageUrl:      p.info?.imageUrl,
    websites:      (p.info?.websites ?? []).map((w) => w.url ?? "").filter(Boolean),
    socials:       (p.info?.socials  ?? [])
      .map((s) => ({ type: s.type ?? "", url: s.url ?? "" }))
      .filter((s) => s.url),
  };
}

/**
 * Fetch full detail for one pair: /latest/dex/pairs/{chainId}/{pairAddress}.
 * Returns null when the pair isn't found or the API fails.
 */
export async function getPairDetail(chainName: string, pairAddress: string): Promise<PairDetail | null> {
  if (!chainName || !pairAddress) return null;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainName)}/${encodeURIComponent(pairAddress)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { pair?: DSPair | null; pairs?: DSPair[] | null };
    const first = data.pair ?? (data.pairs ?? [])[0];
    if (!first) return null;
    return pairToDetail(first);
  } catch {
    return null;
  }
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
