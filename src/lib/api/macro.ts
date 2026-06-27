/**
 * Macro backdrop (Z4) — the market-wide context ZION was blind to. It used to
 * see a token in isolation; now it also knows whether the dollar is bid, where
 * capital sits (BTC vs alts), whether fresh stablecoin capital is entering, and
 * how TradFi risk is leaning.
 *
 * Every source is INDEPENDENT and best-effort: any one failing just omits its
 * line. All free, no API key. Cached 30 min (macro moves slowly and we don't
 * want to hammer the upstreams on every ZION call).
 */

const REVALIDATE = 1800; // 30 min

interface CoinGeckoGlobal {
  data?: {
    total_market_cap?: { usd?: number };
    market_cap_percentage?: { btc?: number; eth?: number };
    market_cap_change_percentage_24h_usd?: number;
  };
}

/** BTC/ETH dominance + total crypto mcap (CoinGecko /global). The core crypto-
 *  macro signal: where capital sits and whether the whole market is growing. */
async function fetchCryptoGlobal(): Promise<string | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global", { next: { revalidate: REVALIDATE } });
    if (!res.ok) return null;
    const body = await res.json() as CoinGeckoGlobal;
    const d = body.data;
    if (!d) return null;
    const btcDom = d.market_cap_percentage?.btc;
    const ethDom = d.market_cap_percentage?.eth;
    const totalUsd = d.total_market_cap?.usd;
    const chg24 = d.market_cap_change_percentage_24h_usd;
    if (btcDom == null && totalUsd == null) return null;

    const parts: string[] = [];
    if (btcDom != null) {
      const domNote = btcDom >= 56 ? " (high → capital defensive in BTC, alts pressured)"
                    : btcDom <= 48 ? " (low → risk-on, capital rotating into alts)" : "";
      parts.push(`BTC dominance ${btcDom.toFixed(1)}%${ethDom != null ? ` · ETH ${ethDom.toFixed(1)}%` : ""}${domNote}`);
    }
    if (totalUsd != null) {
      const t = totalUsd >= 1e12 ? `$${(totalUsd / 1e12).toFixed(2)}T` : `$${(totalUsd / 1e9).toFixed(0)}B`;
      const chgNote = chg24 != null ? ` (Δ24h ${chg24 >= 0 ? "+" : ""}${chg24.toFixed(2)}%)` : "";
      parts.push(`total crypto mcap ${t}${chgNote}`);
    }
    return parts.join(" | ");
  } catch {
    return null;
  }
}

/** Total stablecoin supply + 7-day trend (DefiLlama). Rising supply = fresh
 *  dry powder entering crypto; falling = capital leaving. */
async function fetchStablecoinSupply(): Promise<string | null> {
  try {
    const res = await fetch("https://stablecoins.llama.fi/stablecoincharts/all", { next: { revalidate: REVALIDATE } });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ totalCirculatingUSD?: { peggedUSD?: number } }>;
    if (!Array.isArray(rows) || rows.length < 8) return null;
    const last = rows[rows.length - 1]?.totalCirculatingUSD?.peggedUSD;
    const weekAgo = rows[rows.length - 8]?.totalCirculatingUSD?.peggedUSD;
    if (!last || !(last > 0)) return null;
    const t = `$${(last / 1e9).toFixed(1)}B`;
    if (!weekAgo || !(weekAgo > 0)) return `stablecoin supply ${t}`;
    const chg = ((last - weekAgo) / weekAgo) * 100;
    const note = chg >= 0.5 ? " — capital flowing IN (bullish backdrop)"
               : chg <= -0.5 ? " — capital leaving (bearish backdrop)" : " — flat";
    return `stablecoin supply ${t} (Δ7d ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%${note})`;
  } catch {
    return null;
  }
}

interface YahooChart {
  chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }> };
}

/** A TradFi index level + day change via Yahoo. Best-effort — Yahoo sometimes
 *  blocks datacenter IPs, in which case this simply returns null. */
async function fetchYahoo(symbol: string, label: string, hint: (chgPct: number) => string): Promise<string | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
      next: { revalidate: REVALIDATE },
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const body = await res.json() as YahooChart;
    const meta = body.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose ?? meta?.previousClose;
    if (price == null || !(price > 0)) return null;
    if (prev == null || !(prev > 0)) return `${label} ${price.toFixed(2)}`;
    const chg = ((price - prev) / prev) * 100;
    return `${label} ${price.toFixed(2)} (Δ ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%${hint(chg)})`;
  } catch {
    return null;
  }
}

/**
 * Build the macro context block for the ZION prompt. Returns "" when nothing
 * could be fetched (so callers can safely append it unconditionally).
 */
export async function getMacroContext(): Promise<string> {
  const [crypto, stables, dxy, spx] = await Promise.all([
    fetchCryptoGlobal(),
    fetchStablecoinSupply(),
    fetchYahoo("DX-Y.NYB", "DXY", (c) => c > 0.2 ? " → dollar strength, headwind for risk" : c < -0.2 ? " → dollar weakness, tailwind for risk" : ""),
    fetchYahoo("%5EGSPC", "S&P 500", (c) => c > 0.3 ? " → risk-on" : c < -0.3 ? " → risk-off" : ""),
  ]);

  const lines: string[] = [];
  if (crypto)  lines.push(`  ${crypto}`);
  if (stables) lines.push(`  ${stables}`);
  const tradfi = [dxy, spx].filter(Boolean).join(" | ");
  if (tradfi)  lines.push(`  TradFi: ${tradfi}`);

  if (lines.length === 0) return "";
  return ["MACRO CONTEXT (market-wide backdrop — weigh against the per-asset read):", ...lines].join("\n");
}
