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

// data-api.binance.vision is Binance's public market-data mirror. Unlike
// api.binance.com it is NOT geo-blocked from US serverless IPs (Vercel
// iad1/sfo1 return 451 there), so the Binance leg of the spot/arb matrix
// actually resolves instead of silently falling through to Kraken.
const BINANCE_URL = "https://data-api.binance.vision/api/v3/ticker/price";
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

// ─── Multi-exchange spot matrix ────────────────────────────────────────
//
// For cross-CEX arbitrage detection, we need BASE prices on every CEX
// the user might own simultaneously, not just the first one that
// answers. Returns a 2D map: BASE -> CexId -> price. ZION reads this
// to spot price dispersion ("BTC: binance $80,012 · coinbase $80,041
// · gateio $79,998 → 0.054% spread, buy on gateio, sell on coinbase")
// and emits arbitrage_cross_cex cards the autopilot can fire on BOTH
// legs because both venues are CEXes the user holds keys for.
//
// Sources used (all public, no auth):
//   - binance.com /api/v3/ticker/price?symbols=[...]    (bulk)
//   - coinbase.com /api/v3/brokerage/market/products    (bulk)
//   - gate.io /api/v4/spot/tickers                      (bulk; no filter avail)
//   - okx.com /api/v5/market/tickers?instType=SPOT      (bulk; no filter avail)
//   - bybit.com /v5/market/tickers?category=spot        (bulk; no filter avail)
//   - kraken.com /0/public/Ticker                       (per-symbol mapping)
//   - mexc.com /api/v3/ticker/price?symbol=...          (per-symbol)
//
// Failures per-source are swallowed — a missing CEX just means ZION
// has one fewer venue for that symbol; the others still spot the arb.
// Server-cached 30s via next.revalidate so a rapid ZION re-run doesn't
// re-hit the upstreams.

export interface MultiSpotPrice {
  /** Last/mid USD price reported by this CEX for this base symbol. */
  priceUsd: number;
}

/** Same return shape across all CEX adapters so the matrix is uniform. */
type MultiSpotMap = Map<string, Map<CexSpotSource, MultiSpotPrice>>;

export type CexSpotSource =
  | "binance"
  | "coinbase"
  | "gateio"
  | "okx"
  | "bybit"
  | "kraken"
  | "mexc";

/** Pre-compute "BASE/USDT"-ish pair names that we expect to find on every CEX. */
function setEntry(map: MultiSpotMap, base: string, source: CexSpotSource, priceUsd: number) {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
  const row = map.get(base) ?? new Map<CexSpotSource, MultiSpotPrice>();
  row.set(source, { priceUsd });
  map.set(base, row);
}

export async function getMultiExchangeSpot(symbols: string[]): Promise<MultiSpotMap> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))]
    .filter((s) => (CEX_TRACKED_SYMBOLS as readonly string[]).includes(s));
  if (wanted.length === 0) return new Map();

  const out: MultiSpotMap = new Map();
  const wantedSet = new Set(wanted);

  // Fire all sources in parallel. Each adapter handles its own failures
  // and contributes whatever it managed to fetch.
  await Promise.all([
    fetchBinance(wanted, out),
    fetchCoinbase(wanted, out),
    fetchGateIo(wantedSet, out),
    fetchOkx(wantedSet, out),
    fetchBybit(wantedSet, out),
    fetchKrakenMulti(wanted, out),
    fetchMexc(wanted, out),
  ]);

  return out;
}

// ─── Per-source adapters ────────────────────────────────────────────────

async function fetchBinance(wanted: string[], out: MultiSpotMap): Promise<void> {
  try {
    const arg = JSON.stringify(wanted.map((s) => `${s}USDT`));
    const res = await fetch(`${BINANCE_URL}?symbols=${encodeURIComponent(arg)}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return;
    const rows = await res.json() as Array<{ symbol: string; price: string }>;
    for (const r of rows) {
      const base = r.symbol.replace(/USDT$/, "").toUpperCase();
      setEntry(out, base, "binance", parseFloat(r.price));
    }
  } catch (err) {
    console.warn("[cex-spot/multi] binance failed:", err instanceof Error ? err.message : err);
  }
}

async function fetchCoinbase(wanted: string[], out: MultiSpotMap): Promise<void> {
  // Coinbase Advanced Trade exposes per-product spot via the Brokerage API.
  // The public endpoint accepts a product_id per call; doing 30 in parallel
  // is acceptable but we use a smaller curated batch to keep budget tight.
  // Returns {price} as a string. Pair format is "BASE-USD" (not USDT).
  await Promise.all(wanted.map(async (base) => {
    try {
      const res = await fetch(`https://api.coinbase.com/v2/prices/${base}-USD/spot`, {
        next: { revalidate: 30 },
      });
      if (!res.ok) return;
      const body = await res.json() as { data?: { amount?: string } };
      const px = parseFloat(body?.data?.amount ?? "");
      setEntry(out, base, "coinbase", px);
    } catch { /* per-symbol failure → just skip */ }
  }));
}

async function fetchGateIo(wantedSet: Set<string>, out: MultiSpotMap): Promise<void> {
  try {
    const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers", {
      next: { revalidate: 30 },
    });
    if (!res.ok) return;
    const rows = await res.json() as Array<{ currency_pair?: string; last?: string }>;
    for (const r of rows) {
      const pair = r.currency_pair ?? "";
      if (!pair.endsWith("_USDT")) continue;
      const base = pair.replace(/_USDT$/, "").toUpperCase();
      if (!wantedSet.has(base)) continue;
      setEntry(out, base, "gateio", parseFloat(r.last ?? ""));
    }
  } catch (err) {
    console.warn("[cex-spot/multi] gate.io failed:", err instanceof Error ? err.message : err);
  }
}

async function fetchOkx(wantedSet: Set<string>, out: MultiSpotMap): Promise<void> {
  try {
    const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT", {
      next: { revalidate: 30 },
    });
    if (!res.ok) return;
    const body = await res.json() as { data?: Array<{ instId?: string; last?: string }> };
    const rows = body.data ?? [];
    for (const r of rows) {
      const id = r.instId ?? "";
      if (!id.endsWith("-USDT")) continue;
      const base = id.replace(/-USDT$/, "").toUpperCase();
      if (!wantedSet.has(base)) continue;
      setEntry(out, base, "okx", parseFloat(r.last ?? ""));
    }
  } catch (err) {
    console.warn("[cex-spot/multi] okx failed:", err instanceof Error ? err.message : err);
  }
}

async function fetchBybit(wantedSet: Set<string>, out: MultiSpotMap): Promise<void> {
  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot", {
      next: { revalidate: 30 },
    });
    if (!res.ok) return;
    const body = await res.json() as { result?: { list?: Array<{ symbol?: string; lastPrice?: string }> } };
    const rows = body.result?.list ?? [];
    for (const r of rows) {
      const sym = r.symbol ?? "";
      if (!sym.endsWith("USDT")) continue;
      const base = sym.replace(/USDT$/, "").toUpperCase();
      if (!wantedSet.has(base)) continue;
      setEntry(out, base, "bybit", parseFloat(r.lastPrice ?? ""));
    }
  } catch (err) {
    console.warn("[cex-spot/multi] bybit failed:", err instanceof Error ? err.message : err);
  }
}

async function fetchKrakenMulti(wanted: string[], out: MultiSpotMap): Promise<void> {
  const pairable = wanted.filter((s) => KRAKEN_PAIR[s]);
  if (pairable.length === 0) return;
  try {
    const pairs = pairable.map((s) => KRAKEN_PAIR[s]).join(",");
    const res = await fetch(`${KRAKEN_URL}?pair=${pairs}`, { next: { revalidate: 30 } });
    if (!res.ok) return;
    const body = await res.json() as { result?: Record<string, { c?: [string, string] }> };
    const entries = Object.entries(body.result ?? {});
    for (const [pair, payload] of entries) {
      const px = parseFloat(payload?.c?.[0] ?? "");
      if (!(px > 0)) continue;
      for (const base of pairable) {
        const expected = KRAKEN_PAIR[base];
        if (pair === expected || pair === `X${expected}` || pair.endsWith(expected)) {
          setEntry(out, base, "kraken", px);
          break;
        }
      }
    }
  } catch (err) {
    console.warn("[cex-spot/multi] kraken failed:", err instanceof Error ? err.message : err);
  }
}

async function fetchMexc(wanted: string[], out: MultiSpotMap): Promise<void> {
  // MEXC's bulk ticker is the largest payload of the bunch; we batch per-
  // symbol to keep response time predictable and to dodge a rare-but-real
  // CDN truncation we've seen on the all-tickers route.
  await Promise.all(wanted.map(async (base) => {
    try {
      const res = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${base}USDT`, {
        next: { revalidate: 30 },
      });
      if (!res.ok) return;
      const body = await res.json() as { price?: string };
      setEntry(out, base, "mexc", parseFloat(body?.price ?? ""));
    } catch { /* skip silently */ }
  }));
}
