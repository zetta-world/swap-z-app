/**
 * Public CEX spot-price feed — used by ZION ARBITRAGE mode to compare
 * DEX pool prices against a real CEX spot reference. No authentication
 * required; we hit Binance's public /ticker/price for the curated set
 * of major symbols. Fallback to Kraken when Binance is geo-blocked on
 * the upstream serverless region (rare but happens on EU/US edges).
 *
 * Returned map is keyed by BASE symbol (uppercased). Quote is always
 * USDT; the model treats it as the dollar reference.
 */

const BINANCE_URL = "https://api.binance.com/api/v3/ticker/price";
const KRAKEN_URL  = "https://api.kraken.com/0/public/Ticker";

// Curated whitelist of symbols ZION can reason about as DEX-vs-CEX arbs.
// Trimmed to symbols listed on the majority of CEXs to avoid the model
// suggesting an arb on a token only some venues quote.
export const CEX_TRACKED_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "AVAX", "MATIC", "LINK", "UNI", "AAVE",
  "ARB", "OP", "ATOM", "ADA", "DOGE", "PEPE", "WIF", "DOT", "LDO",
  "TON", "TRX", "XRP", "NEAR", "SUI", "APT", "SHIB", "INJ", "RNDR",
  "FET", "TAO", "GRT",
] as const;

// Kraken uses a different ticker naming. Map our symbol → Kraken pair.
const KRAKEN_PAIR: Record<string, string> = {
  BTC: "XBTUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", BNB: "BNBUSDT",
  AVAX: "AVAXUSDT", MATIC: "MATICUSDT", LINK: "LINKUSDT", UNI: "UNIUSDT",
  AAVE: "AAVEUSDT", ARB: "ARBUSDT", OP: "OPUSDT", ATOM: "ATOMUSDT",
  ADA: "ADAUSDT", DOGE: "DOGEUSDT", DOT: "DOTUSDT", LDO: "LDOUSDT",
  XRP: "XRPUSDT", NEAR: "NEARUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
};

export interface CexSpotPrice {
  symbol:    string;     // base, e.g. "ETH"
  priceUsd:  number;
  source:    "binance" | "kraken";
}

/**
 * Fetch spot prices for the given base symbols. Returns a map keyed by
 * uppercased base symbol. Symbols missing from the result simply weren't
 * available on either CEX — the prompt path will treat their absence as
 * "no CEX reference; skip the DEX-CEX arb judgment for this row".
 */
export async function getCexSpotPrices(symbols: string[]): Promise<Map<string, CexSpotPrice>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))]
    .filter((s) => (CEX_TRACKED_SYMBOLS as readonly string[]).includes(s));
  if (wanted.length === 0) return new Map();

  const result = new Map<string, CexSpotPrice>();

  // ─── 1. Binance bulk endpoint ─────────────────────────────────────
  try {
    const symbolsArg = JSON.stringify(wanted.map((s) => `${s}USDT`));
    const res = await fetch(`${BINANCE_URL}?symbols=${encodeURIComponent(symbolsArg)}`, {
      next: { revalidate: 30 },
    });
    if (res.ok) {
      const data = await res.json() as Array<{ symbol: string; price: string }>;
      for (const row of data) {
        const base = row.symbol.replace(/USDT$/, "").toUpperCase();
        const px = parseFloat(row.price);
        if (Number.isFinite(px) && px > 0) {
          result.set(base, { symbol: base, priceUsd: px, source: "binance" });
        }
      }
    }
  } catch (err) {
    console.warn("[cex-spot] binance failed:", err instanceof Error ? err.message : err);
  }

  // ─── 2. Kraken fallback for whatever Binance didn't return ───────
  const missing = wanted.filter((s) => !result.has(s) && KRAKEN_PAIR[s]);
  if (missing.length > 0) {
    try {
      const pairsArg = missing.map((s) => KRAKEN_PAIR[s]).join(",");
      const res = await fetch(`${KRAKEN_URL}?pair=${pairsArg}`, {
        next: { revalidate: 30 },
      });
      if (res.ok) {
        const data = await res.json() as {
          result?: Record<string, { c?: [string, string] }>;
        };
        const entries = Object.entries(data.result ?? {});
        for (const [pair, payload] of entries) {
          const closePrice = parseFloat(payload?.c?.[0] ?? "");
          if (!Number.isFinite(closePrice) || closePrice <= 0) continue;
          // Kraken sometimes normalizes pair names (XBTUSDT → XXBTUSDT, etc).
          // Reverse-lookup whichever base symbol asked for this pair.
          for (const base of missing) {
            const expected = KRAKEN_PAIR[base];
            if (pair === expected || pair === `X${expected}` || pair.endsWith(expected)) {
              if (!result.has(base)) {
                result.set(base, { symbol: base, priceUsd: closePrice, source: "kraken" });
              }
              break;
            }
          }
        }
      }
    } catch (err) {
      console.warn("[cex-spot] kraken failed:", err instanceof Error ? err.message : err);
    }
  }

  return result;
}
