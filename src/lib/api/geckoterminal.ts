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

// ─── OHLCV (chart candles) ───────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

const TF_MAP: Record<Timeframe, { timeframe: string; aggregate: number }> = {
  "1m":  { timeframe: "minute", aggregate: 1  },
  "5m":  { timeframe: "minute", aggregate: 5  },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h":  { timeframe: "hour",   aggregate: 1  },
  "4h":  { timeframe: "hour",   aggregate: 4  },
  "1d":  { timeframe: "day",    aggregate: 1  },
};

export interface Candle {
  time:   number;   // unix seconds
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

/**
 * Fetch OHLCV candles for a specific pool from GeckoTerminal.
 * Returns candles sorted ascending (oldest first) for lightweight-charts.
 */
export async function getOHLCV(
  chainName: string,
  poolAddress: string,
  tf: Timeframe,
  limit = 200,
): Promise<Candle[]> {
  const network = NETWORK_IDS[chainName];
  if (!network || !poolAddress) return [];
  const cfg = TF_MAP[tf];
  if (!cfg) return [];

  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress.toLowerCase()}/ohlcv/${cfg.timeframe}?aggregate=${cfg.aggregate}&limit=${Math.min(limit, 1000)}&currency=usd`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const rows = data.data?.attributes?.ohlcv_list ?? [];
    return rows
      .map((r) => ({
        time:   Math.floor(r[0]),
        open:   Number(r[1]),
        high:   Number(r[2]),
        low:    Number(r[3]),
        close:  Number(r[4]),
        volume: Number(r[5] ?? 0),
      }))
      .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

// ─── Recent trades on a pool ─────────────────────────────────────────

export interface Trade {
  ts:        number;     // unix seconds
  kind:      "buy" | "sell";
  priceUsd:  number;
  amountIn:  number;
  amountOut: number;
  txHash:    string;
}

interface GTTradeAttrs {
  block_number?:               number;
  block_timestamp?:             string;
  tx_hash?:                    string;
  tx_from_address?:             string;
  from_token_amount?:            string;
  to_token_amount?:              string;
  price_to_in_currency_token?:  string;
  price_from_in_currency_token?: string;
  price_from_in_usd?:           string;
  price_to_in_usd?:             string;
  kind?:                       string;        // "buy" | "sell"
  volume_in_usd?:               string;
}

export async function getRecentTrades(
  chainName: string,
  poolAddress: string,
  limit = 25,
): Promise<Trade[]> {
  const network = NETWORK_IDS[chainName];
  if (!network || !poolAddress) return [];
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress.toLowerCase()}/trades?trade_volume_in_usd_greater_than=0`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { attributes: GTTradeAttrs }[] };
    return (data.data ?? []).slice(0, limit).map((t) => {
      const a = t.attributes;
      const ts = a.block_timestamp ? Math.floor(new Date(a.block_timestamp).getTime() / 1000) : 0;
      const isBuy = (a.kind ?? "").toLowerCase() === "buy";
      return {
        ts,
        kind:      isBuy ? "buy" as const : "sell" as const,
        priceUsd:  Number(a.price_from_in_usd ?? a.price_to_in_usd ?? 0),
        amountIn:  Number(a.from_token_amount ?? 0),
        amountOut: Number(a.to_token_amount   ?? 0),
        txHash:    a.tx_hash ?? "",
      };
    }).filter((t) => t.ts > 0);
  } catch {
    return [];
  }
}
