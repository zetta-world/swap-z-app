// GeckoTerminal API v2 — free, no key
// https://api.geckoterminal.com/docs/index.html

const NETWORK_IDS: Record<string, string> = {
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

interface GTRel<T = string> { data: { id: T; type: string } }
interface GTPoolAttrs {
  name?:                      string;
  address?:                   string;
  base_token_price_usd?:      string;
  quote_token_price_usd?:     string;
  reserve_in_usd?:            string;
  fdv_usd?:                   string;
  market_cap_usd?:            string;
  pool_created_at?:           string;
  price_change_percentage?:   { h1?: string; h24?: string };
  volume_usd?:                { h1?: string; h24?: string };
  transactions?:              { h24?: { buys?: number; sells?: number; buyers?: number; sellers?: number } };
}
interface GTPool {
  id:         string;
  type:       string;
  attributes: GTPoolAttrs;
  relationships?: {
    base_token?:  GTRel;
    quote_token?: GTRel;
    network?:     GTRel;
    dex?:         GTRel;
  };
}

export interface PoolSummary {
  id:         string;
  dex:        string;
  name:       string;
  network:    string;
  tvlUsd:     number;
  volume24h:  number;
  change24h:  number;
  priceUsd:   number;
  baseSymbol: string;
  quoteSymbol: string;
  address:    string;
}

function attrNumber(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function poolToSummary(pool: GTPool, networkSlug: string): PoolSummary {
  const a = pool.attributes;
  const [base, quote] = (a.name ?? " / ").split(" / ");
  const dexId = pool.relationships?.dex?.data?.id ?? "—";
  return {
    id:          pool.id,
    dex:         dexId.replace(/_/g, " "),
    name:        a.name ?? "",
    network:     networkSlug,
    tvlUsd:      attrNumber(a.reserve_in_usd),
    volume24h:   attrNumber(a.volume_usd?.h24),
    change24h:   attrNumber(a.price_change_percentage?.h24),
    priceUsd:    attrNumber(a.base_token_price_usd),
    baseSymbol:  base?.trim() ?? "",
    quoteSymbol: quote?.trim() ?? "",
    address:     a.address ?? "",
  };
}

export async function getTopPools(chainName: string, limit = 8): Promise<PoolSummary[]> {
  const network = NETWORK_IDS[chainName];
  if (!network) return [];

  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools?page=1&include=dex`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: GTPool[] };
    return (data.data ?? []).slice(0, limit).map((p) => poolToSummary(p, network));
  } catch {
    return [];
  }
}

export async function getTrendingPools(limit = 12): Promise<PoolSummary[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1&include=dex`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: GTPool[] };
    return (data.data ?? []).slice(0, limit).map((p) => {
      const networkId = p.relationships?.network?.data?.id ?? "";
      return poolToSummary(p, networkId);
    });
  } catch {
    return [];
  }
}

export interface TokenInfo {
  symbol?:    string;
  name?:      string;
  address:    string;
  priceUsd?:  number;
  mcapUsd?:   number;
  fdvUsd?:    number;
  volume24h?: number;
  holders?:   number;
  totalSupply?: number;
}

interface GTTokenAttrs {
  address?:         string;
  name?:            string;
  symbol?:          string;
  decimals?:        number;
  price_usd?:       string;
  fdv_usd?:         string;
  market_cap_usd?:  string;
  volume_usd?:      { h24?: string };
  total_supply?:    string;
}

export async function getTokenInfo(chainName: string, address: string): Promise<TokenInfo | null> {
  const network = NETWORK_IDS[chainName];
  if (!network || !address || address === "native") return null;
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address.toLowerCase()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { attributes: GTTokenAttrs } };
    const a = data.data?.attributes;
    if (!a) return null;
    return {
      address:    a.address ?? address,
      name:       a.name,
      symbol:     a.symbol,
      priceUsd:   attrNumber(a.price_usd),
      mcapUsd:    attrNumber(a.market_cap_usd),
      fdvUsd:     attrNumber(a.fdv_usd),
      volume24h:  attrNumber(a.volume_usd?.h24),
      totalSupply: attrNumber(a.total_supply),
    };
  } catch {
    return null;
  }
}

export function geckoNetworkId(chainName: string): string | undefined {
  return NETWORK_IDS[chainName];
}
