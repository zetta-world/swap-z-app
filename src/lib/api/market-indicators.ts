/**
 * Market technical indicators for ZION.
 *
 * Computes RSI(14), MACD(12,26,9), EMA(20), EMA(50) from Binance public
 * klines (1h candles, 100 bars). Fetches top-5 order book levels from the
 * Binance public depth API. Fetches the Fear & Greed Index from alternative.me.
 *
 * All functions are server-safe — no "use client", no auth required.
 * Next.js fetch revalidation: klines 60s, depth 15s, Fear & Greed 1h.
 */

// ─── Pure math: EMA, RSI, MACD ──────────────────────────────────────────

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  // Seed with SMA over the first `period` bars
  out.push(closes.slice(0, period).reduce((a, b) => a + b, 0) / period);
  for (let i = period; i < closes.length; i++) {
    out.push(closes[i] * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 2) return null;
  // Prime the pump with a simple avg over the first `period` diffs
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  // Wilder's smoothing over the rest
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

interface MACDResult {
  macd:      number;
  signal:    number;
  histogram: number;
  histPrev:  number | null; // previous bar's histogram — shows momentum direction
}

function calcMACD(closes: number[], fast = 12, slow = 26, sig = 9): MACDResult | null {
  if (closes.length < slow + sig + 2) return null;
  const fastEma = calcEMA(closes, fast);
  const slowEma = calcEMA(closes, slow);
  // Align: fastEma has (closes.length - fast + 1) bars, slowEma has (closes.length - slow + 1)
  // slowEma is shorter; trim the start of fastEma to match
  const offset = fastEma.length - slowEma.length;
  const macdLine = slowEma.map((v, i) => fastEma[i + offset] - v);
  const sigLine  = calcEMA(macdLine, sig);
  if (sigLine.length < 2) return null;
  const last  = sigLine.length - 1;
  const macd  = macdLine[macdLine.length - 1];
  const signal = sigLine[last];
  const histogram = macd - signal;
  // Previous histogram — macdLine offset mirrors sigLine offset
  const prevMacd    = macdLine[macdLine.length - 2];
  const prevSignal  = sigLine[last - 1];
  const histPrev    = prevMacd - prevSignal;
  return { macd, signal, histogram, histPrev };
}

// ─── Interfaces ──────────────────────────────────────────────────────────

export interface SymbolIndicators {
  symbol:   string;
  rsi14:    number | null;
  ema20:    number | null;
  ema50:    number | null;
  macd:     MACDResult | null;
  /** Composite trend label derived from RSI + EMA position. */
  trend:    "bullish" | "bearish" | "neutral" | "overbought" | "oversold";
}

export interface OrderBookSnapshot {
  symbol:       string;
  spreadPct:    number;
  bestBid:      number;
  bestAsk:      number;
  bidDepthUsd:  number; // sum of top-5 bid levels (price × qty)
  askDepthUsd:  number; // sum of top-5 ask levels
  imbalance:    "BUY" | "SELL" | "NEUTRAL";
  imbalancePct: number; // (bid - ask) / total × 100
}

export interface FearGreedData {
  value:          number;        // 0-100
  classification: string;        // "Extreme Fear" … "Extreme Greed"
}

export interface MarketIndicatorsResult {
  indicators: SymbolIndicators[];
  orderBooks: OrderBookSnapshot[];
  fearGreed:  FearGreedData | null;
}

// ─── Data fetchers ────────────────────────────────────────────────────────

async function fetchKlines(symbol: string): Promise<number[]> {
  // 100 hourly closes → enough headroom for EMA50 + MACD(26+9) + RSI(14)
  // with Wilder's smoothing well-stabilised before the last bar.
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1h&limit=100`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>;
    return data.map((row) => parseFloat(row[4])); // index 4 = close
  } catch {
    return [];
  }
}

async function fetchOrderBook(symbol: string): Promise<OrderBookSnapshot | null> {
  try {
    const url = `https://api.binance.com/api/v3/depth?symbol=${symbol}USDT&limit=5`;
    const res = await fetch(url, { next: { revalidate: 15 } });
    if (!res.ok) return null;
    const data = await res.json() as {
      bids?: Array<[string, string]>;
      asks?: Array<[string, string]>;
    };
    if (!data.bids?.length || !data.asks?.length) return null;
    const bestBid = parseFloat(data.bids[0][0]);
    const bestAsk = parseFloat(data.asks[0][0]);
    if (!(bestBid > 0) || !(bestAsk > 0)) return null;
    const spreadPct = ((bestAsk - bestBid) / bestBid) * 100;
    let bidDepthUsd = 0, askDepthUsd = 0;
    for (const [p, q] of data.bids) bidDepthUsd += parseFloat(p) * parseFloat(q);
    for (const [p, q] of data.asks) askDepthUsd += parseFloat(p) * parseFloat(q);
    const total = bidDepthUsd + askDepthUsd;
    const imbalancePct = total > 0 ? ((bidDepthUsd - askDepthUsd) / total) * 100 : 0;
    const imbalance: "BUY" | "SELL" | "NEUTRAL" =
      imbalancePct > 8 ? "BUY" : imbalancePct < -8 ? "SELL" : "NEUTRAL";
    return { symbol, spreadPct, bestBid, bestAsk, bidDepthUsd, askDepthUsd, imbalance, imbalancePct };
  } catch {
    return null;
  }
}

export async function getFearGreedIndex(): Promise<FearGreedData | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      next: { revalidate: 3600 }, // updates once per day — 1h cache is plenty
    });
    if (!res.ok) return null;
    const body = await res.json() as {
      data?: Array<{ value?: string; value_classification?: string }>;
    };
    const item = body.data?.[0];
    if (!item) return null;
    const value = parseInt(item.value ?? "0", 10);
    if (!(value >= 0) || !(value <= 100)) return null;
    return { value, classification: item.value_classification ?? "Unknown" };
  } catch {
    return null;
  }
}

async function getSymbolIndicators(symbol: string): Promise<SymbolIndicators> {
  const closes = await fetchKlines(symbol);
  if (closes.length < 52) {
    return { symbol, rsi14: null, ema20: null, ema50: null, macd: null, trend: "neutral" };
  }
  const rsi14   = calcRSI(closes, 14);
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const macd    = calcMACD(closes);
  const ema20   = ema20Arr.length > 0 ? ema20Arr[ema20Arr.length - 1] : null;
  const ema50   = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : null;
  const lastClose = closes[closes.length - 1];
  let trend: SymbolIndicators["trend"] = "neutral";
  if (rsi14 !== null && rsi14 > 70) trend = "overbought";
  else if (rsi14 !== null && rsi14 < 30) trend = "oversold";
  else if (ema20 && ema50 && lastClose > ema20 && ema20 > ema50) trend = "bullish";
  else if (ema20 && ema50 && lastClose < ema20 && ema20 < ema50) trend = "bearish";
  return { symbol, rsi14, ema20, ema50, macd, trend };
}

// ─── Main export ──────────────────────────────────────────────────────────

export async function getMarketIndicators(symbols: string[]): Promise<MarketIndicatorsResult> {
  const [indicators, rawBooks, fearGreed] = await Promise.all([
    Promise.all(symbols.map((s) => getSymbolIndicators(s.toUpperCase()))),
    Promise.all(symbols.map((s) => fetchOrderBook(s.toUpperCase()))),
    getFearGreedIndex(),
  ]);
  return {
    indicators,
    orderBooks: rawBooks.filter((b): b is OrderBookSnapshot => b !== null),
    fearGreed,
  };
}

// ─── Prompt formatter ─────────────────────────────────────────────────────

/** Format results into a compact text block for injection into the ZION prompt. */
export function formatIndicatorsForPrompt(result: MarketIndicatorsResult): string {
  const lines: string[] = [];

  // Fear & Greed
  if (result.fearGreed) {
    const { value, classification } = result.fearGreed;
    let note = "";
    if (value >= 75)      note = " — mercado superaquecido, risco de correção elevado";
    else if (value >= 60) note = " — sentimento aquecido, monitore os stops";
    else if (value <= 25) note = " — capitulação, possível zona de acumulação contrária";
    else if (value <= 40) note = " — sentimento negativo, exija mais confirmação na entrada";
    lines.push(`MARKET SENTIMENT: Fear & Greed Index = ${value} (${classification})${note}`);
    lines.push("");
  }

  // Technical indicators
  const validIndicators = result.indicators.filter((i) => i.rsi14 !== null);
  if (validIndicators.length > 0) {
    lines.push("TECHNICAL INDICATORS (1h candles, Binance):");
    for (const ind of validIndicators) {
      if (ind.rsi14 === null) continue;
      const rsi = ind.rsi14.toFixed(1);
      const rsiLabel =
        ind.rsi14 > 70 ? "[OVERBOUGHT]" :
        ind.rsi14 < 30 ? "[OVERSOLD]" :
        ind.rsi14 > 55 ? "[bullish zone]" :
        ind.rsi14 < 45 ? "[bearish zone]" : "[neutral]";

      // Format EMA relative to price
      const px = ind.ema20; // rough price proxy
      const decimals = px && px < 1 ? 6 : px && px < 100 ? 4 : 2;
      const fmt = (n: number | null) =>
        n !== null ? `$${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : "n/a";

      let macdStr = "n/a";
      if (ind.macd) {
        const { histogram, histPrev } = ind.macd;
        const histDir =
          histPrev === null ? "" :
          histogram > histPrev ? " ↑growing" :
          histogram < histPrev ? " ↓fading" : " →flat";
        const histSign = histogram >= 0 ? "+" : "";
        const histDisplay = Math.abs(histogram) > 0.01
          ? `${histSign}${histogram.toFixed(4)}`
          : `${histSign}${histogram.toExponential(2)}`;
        macdStr = `hist=${histDisplay}${histDir}`;
      }

      lines.push(
        `  ${ind.symbol}/USDT: RSI=${rsi} ${rsiLabel} | MACD ${macdStr} | EMA20=${fmt(ind.ema20)} EMA50=${fmt(ind.ema50)} | trend=${ind.trend}`
      );
    }
    lines.push("");
  }

  // Order book
  if (result.orderBooks.length > 0) {
    lines.push("ORDER BOOK DEPTH (top-5 Binance levels):");
    for (const ob of result.orderBooks) {
      const bidK = (ob.bidDepthUsd / 1000).toFixed(0);
      const askK = (ob.askDepthUsd / 1000).toFixed(0);
      const pct  = (ob.imbalancePct > 0 ? "+" : "") + ob.imbalancePct.toFixed(1);
      const flagStr = ob.imbalance === "BUY" ? `BUY PRESSURE (${pct}%)` :
                      ob.imbalance === "SELL" ? `SELL PRESSURE (${pct}%)` : `balanced (${pct}%)`;
      lines.push(
        `  ${ob.symbol}/USDT: spread=${ob.spreadPct.toFixed(3)}% | bid_depth=$${bidK}K | ask_depth=$${askK}K | ${flagStr}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
