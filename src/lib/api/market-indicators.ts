/**
 * Market technical indicators for ZION.
 *
 * Computes, from Binance public klines, a multi-timeframe technical picture:
 *   - 1h:  RSI(14), MACD(12,26,9), EMA(20/50), ATR(14), ADX(14) + regime
 *   - 4h:  trend (EMA20 vs EMA50) + RSI — higher-timeframe confirmation
 *   - 1D:  trend (EMA20 vs EMA50) + RSI — primary-trend confirmation
 * Plus order book depth (spread + imbalance + effective-fill estimate) and
 * the Fear & Greed Index.
 *
 * WHY multi-timeframe: a 1h-only read is "market myopia" — RSI can say buy on
 * 1h while the daily is breaking down. The higher timeframes act as a trend
 * filter so ZION stops trading against the primary tide.
 *
 * WHY ATR: fixed-percent stops are wrong in crypto — too tight in high vol
 * (stopped by noise), too loose in low vol. ATR sizes stops to live volatility.
 *
 * WHY ADX/regime: RSI works badly in ranging markets. ADX > 25 means a real
 * trend (don't fade RSI extremes); ADX < 20 means chop (RSI extremes mean
 * revert). The regime flips how the oscillators should be read.
 *
 * NOTE on order book: the instantaneous imbalance is HFT-timescale data and
 * goes stale during the multi-second LLM round-trip, so it is advisory only.
 * The spread and depth are latency-tolerant and also feed a slippage estimate.
 *
 * All functions are server-safe — no "use client", no auth required.
 * Next.js fetch revalidation: 1h klines 60s, 4h/1D klines 300s, depth 15s,
 * Fear & Greed 1h.
 */

// ─── Candle type + fetch ────────────────────────────────────────────────

interface Candle {
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

async function fetchCandles(symbol: string, interval: string, limit: number, revalidate: number): Promise<Candle[]> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) return [];
    const data = await res.json() as Array<[number, string, string, string, string, string, ...unknown[]]>;
    // Binance kline indices: [2]=high, [3]=low, [4]=close, [5]=volume
    return data.map((row) => ({
      high:   parseFloat(row[2]),
      low:    parseFloat(row[3]),
      close:  parseFloat(row[4]),
      volume: parseFloat(row[5]),
    }));
  } catch {
    return [];
  }
}

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
  // Edge cases: no losses → 100 (pure uptrend); but a fully flat market
  // (no gains AND no losses) is undefined — return neutral 50, not 100.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
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

// ─── ATR (Average True Range, Wilder) ───────────────────────────────────

/** True Range series from OHLC candles. TR needs the prior close. */
function trueRanges(candles: Candle[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    ));
  }
  return tr;
}

function calcATR(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 2) return null;
  const tr = trueRanges(candles);
  if (tr.length < period) return null;
  // Seed: SMA of first `period` true ranges
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  // Wilder smoothing over the rest
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// ─── ADX (Average Directional Index, Wilder) ────────────────────────────

interface ADXResult {
  adx:     number;
  plusDI:  number;
  minusDI: number;
}

function calcADX(candles: Candle[], period = 14): ADXResult | null {
  if (candles.length < period * 2 + 2) return null;
  const len = candles.length;
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < len; i++) {
    const h = candles[i].high, l = candles[i].low;
    const ph = candles[i - 1].high, pl = candles[i - 1].low, pc = candles[i - 1].close;
    const up = h - ph;
    const down = pl - l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (tr.length < period * 2) return null;

  // Wilder-smoothed accumulators (seed = sum of first `period`)
  let trN    = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let plusN  = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let minusN = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxs: number[] = [];
  const pushDX = () => {
    const pDI = trN === 0 ? 0 : (plusN / trN) * 100;
    const mDI = trN === 0 ? 0 : (minusN / trN) * 100;
    const denom = pDI + mDI;
    dxs.push(denom === 0 ? 0 : (Math.abs(pDI - mDI) / denom) * 100);
    return { pDI, mDI };
  };
  let last = pushDX();
  for (let i = period; i < tr.length; i++) {
    trN    = trN    - trN    / period + tr[i];
    plusN  = plusN  - plusN  / period + plusDM[i];
    minusN = minusN - minusN / period + minusDM[i];
    last = pushDX();
  }
  // ADX = Wilder average of the DX series over `period`
  if (dxs.length < period) return null;
  let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    adx = (adx * (period - 1) + dxs[i]) / period;
  }
  return { adx, plusDI: last.pDI, minusDI: last.mDI };
}

// ─── Interfaces ──────────────────────────────────────────────────────────

export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "TRANSITIONING";

/** Compact higher-timeframe read used as a trend filter. */
export interface TimeframeTrend {
  rsi:   number | null;
  trend: "bullish" | "bearish" | "neutral";
}

export interface SymbolIndicators {
  symbol:   string;
  price:    number | null;  // last close (1h)
  rsi14:    number | null;
  ema20:    number | null;
  ema50:    number | null;
  macd:     MACDResult | null;
  atr14:    number | null;  // absolute ATR in quote currency
  atrPct:   number | null;  // ATR as % of price — volatility normalised
  adx:      number | null;
  regime:   MarketRegime;
  /** Composite trend label derived from RSI + EMA position (1h). */
  trend:    "bullish" | "bearish" | "neutral" | "overbought" | "oversold";
  /** Higher-timeframe confirmation. */
  htf4h:    TimeframeTrend | null;
  htf1d:    TimeframeTrend | null;
  /** Alignment of 1h direction with 4h+1D. */
  alignment: "aligned_bull" | "aligned_bear" | "conflict" | "mixed";
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
  /** Effective buy price for a notional sweep through the asks (latency-tolerant). */
  slip1kBps:    number | null; // slippage in bps to buy ~$1k at market
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

async function fetchOrderBook(symbol: string): Promise<OrderBookSnapshot | null> {
  try {
    // 20 levels: top-5 drive the imbalance read, the full ladder feeds the
    // slippage estimate (a $1k sweep can cross several levels on thin books).
    const url = `https://api.binance.com/api/v3/depth?symbol=${symbol}USDT&limit=20`;
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

    // Imbalance on the top-5 only (the actionable near-touch liquidity).
    let bidDepthUsd = 0, askDepthUsd = 0;
    for (const [p, q] of data.bids.slice(0, 5)) bidDepthUsd += parseFloat(p) * parseFloat(q);
    for (const [p, q] of data.asks.slice(0, 5)) askDepthUsd += parseFloat(p) * parseFloat(q);
    const total = bidDepthUsd + askDepthUsd;
    const imbalancePct = total > 0 ? ((bidDepthUsd - askDepthUsd) / total) * 100 : 0;
    const imbalance: "BUY" | "SELL" | "NEUTRAL" =
      imbalancePct > 8 ? "BUY" : imbalancePct < -8 ? "SELL" : "NEUTRAL";

    // Slippage: sweep $1k through the ask ladder, compute volume-weighted fill
    // price vs best ask. Latency-tolerant: tells ZION how much a market buy
    // really costs on this book regardless of the millisecond imbalance.
    let remaining = 1000;
    let filledUsd = 0, filledBase = 0;
    for (const [p, q] of data.asks) {
      const price = parseFloat(p), qty = parseFloat(q);
      const levelUsd = price * qty;
      const take = Math.min(remaining, levelUsd);
      filledBase += take / price;
      filledUsd  += take;
      remaining  -= take;
      if (remaining <= 0) break;
    }
    let slip1kBps: number | null = null;
    if (remaining <= 0 && filledBase > 0) {
      const avgFill = filledUsd / filledBase;
      slip1kBps = ((avgFill - bestAsk) / bestAsk) * 10_000;
    }

    return { symbol, spreadPct, bestBid, bestAsk, bidDepthUsd, askDepthUsd, imbalance, imbalancePct, slip1kBps };
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

/** Compact trend read for a higher timeframe — EMA alignment + RSI. */
function timeframeTrend(closes: number[]): TimeframeTrend | null {
  if (closes.length < 52) return null;
  const rsi = calcRSI(closes, 14);
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const ema20 = ema20Arr.length ? ema20Arr[ema20Arr.length - 1] : null;
  const ema50 = ema50Arr.length ? ema50Arr[ema50Arr.length - 1] : null;
  const last = closes[closes.length - 1];
  let trend: TimeframeTrend["trend"] = "neutral";
  if (ema20 && ema50 && last > ema20 && ema20 > ema50) trend = "bullish";
  else if (ema20 && ema50 && last < ema20 && ema20 < ema50) trend = "bearish";
  return { rsi, trend };
}

async function getSymbolIndicators(symbol: string): Promise<SymbolIndicators> {
  // Fetch all three timeframes in parallel.
  const [c1h, c4h, c1d] = await Promise.all([
    fetchCandles(symbol, "1h", 100, 60),
    fetchCandles(symbol, "4h", 100, 300),
    fetchCandles(symbol, "1d", 100, 300),
  ]);

  const empty: SymbolIndicators = {
    symbol, price: null, rsi14: null, ema20: null, ema50: null, macd: null,
    atr14: null, atrPct: null, adx: null, regime: "TRANSITIONING",
    trend: "neutral", htf4h: null, htf1d: null, alignment: "mixed",
  };
  if (c1h.length < 52) return empty;

  const closes = c1h.map((c) => c.close);
  const rsi14   = calcRSI(closes, 14);
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const macd    = calcMACD(closes);
  const atr14   = calcATR(c1h, 14);
  const adxRes  = calcADX(c1h, 14);
  const ema20   = ema20Arr.length > 0 ? ema20Arr[ema20Arr.length - 1] : null;
  const ema50   = ema50Arr.length > 0 ? ema50Arr[ema50Arr.length - 1] : null;
  const price   = closes[closes.length - 1];
  const atrPct  = atr14 !== null && price > 0 ? (atr14 / price) * 100 : null;

  // 1h composite trend label
  let trend: SymbolIndicators["trend"] = "neutral";
  if (rsi14 !== null && rsi14 > 70) trend = "overbought";
  else if (rsi14 !== null && rsi14 < 30) trend = "oversold";
  else if (ema20 && ema50 && price > ema20 && ema20 > ema50) trend = "bullish";
  else if (ema20 && ema50 && price < ema20 && ema20 < ema50) trend = "bearish";

  // Regime from ADX + directional bias
  let regime: MarketRegime = "TRANSITIONING";
  if (adxRes) {
    if (adxRes.adx >= 25) {
      regime = adxRes.plusDI >= adxRes.minusDI ? "TRENDING_UP" : "TRENDING_DOWN";
    } else if (adxRes.adx < 20) {
      regime = "RANGING";
    }
  }

  // Higher-timeframe trends
  const htf4h = timeframeTrend(c4h.map((c) => c.close));
  const htf1d = timeframeTrend(c1d.map((c) => c.close));

  // Alignment of the 1h directional bias with the higher timeframes.
  const dirOf = (t: SymbolIndicators["trend"] | TimeframeTrend["trend"]): 1 | -1 | 0 =>
    t === "bullish" ? 1 : t === "bearish" ? -1 : 0;
  const base1h = dirOf(trend === "overbought" ? "bullish" : trend === "oversold" ? "bearish" : trend);
  const dirs = [base1h, htf4h ? dirOf(htf4h.trend) : 0, htf1d ? dirOf(htf1d.trend) : 0];
  const bulls = dirs.filter((d) => d === 1).length;
  const bears = dirs.filter((d) => d === -1).length;
  let alignment: SymbolIndicators["alignment"] = "mixed";
  if (bulls >= 2 && bears === 0) alignment = "aligned_bull";
  else if (bears >= 2 && bulls === 0) alignment = "aligned_bear";
  else if (bulls > 0 && bears > 0) alignment = "conflict";

  return { symbol, price, rsi14, ema20, ema50, macd, atr14, atrPct, adx: adxRes?.adx ?? null, regime, trend, htf4h, htf1d, alignment };
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
    lines.push("TECHNICAL INDICATORS (primary timeframe 1h, Binance):");
    for (const ind of validIndicators) {
      if (ind.rsi14 === null) continue;
      const rsi = ind.rsi14.toFixed(1);
      const rsiLabel =
        ind.rsi14 > 70 ? "[OVERBOUGHT]" :
        ind.rsi14 < 30 ? "[OVERSOLD]" :
        ind.rsi14 > 55 ? "[bullish zone]" :
        ind.rsi14 < 45 ? "[bearish zone]" : "[neutral]";

      const px = ind.price ?? ind.ema20;
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

      const atrStr = ind.atr14 !== null && ind.atrPct !== null
        ? `ATR=${fmt(ind.atr14)} (${ind.atrPct.toFixed(2)}%)`
        : "ATR=n/a";
      const adxStr = ind.adx !== null ? `ADX=${ind.adx.toFixed(0)}` : "ADX=n/a";

      lines.push(
        `  ${ind.symbol}/USDT: price=${fmt(ind.price)} | RSI=${rsi} ${rsiLabel} | MACD ${macdStr} | EMA20=${fmt(ind.ema20)} EMA50=${fmt(ind.ema50)} | ${atrStr} | ${adxStr} | regime=${ind.regime} | trend1h=${ind.trend}`
      );

      // Multi-timeframe confirmation line
      const tf = (t: TimeframeTrend | null) =>
        t ? `${t.trend}${t.rsi !== null ? ` RSI${t.rsi.toFixed(0)}` : ""}` : "n/a";
      lines.push(
        `      ↳ MTF: 4h=${tf(ind.htf4h)} · 1D=${tf(ind.htf1d)} → alignment=${ind.alignment}`
      );
    }
    lines.push("");
  }

  // Order book
  if (result.orderBooks.length > 0) {
    lines.push("ORDER BOOK DEPTH (Binance — imbalance is advisory/latency-sensitive, slippage is actionable):");
    for (const ob of result.orderBooks) {
      const bidK = (ob.bidDepthUsd / 1000).toFixed(0);
      const askK = (ob.askDepthUsd / 1000).toFixed(0);
      const pct  = (ob.imbalancePct > 0 ? "+" : "") + ob.imbalancePct.toFixed(1);
      const flagStr = ob.imbalance === "BUY" ? `BUY PRESSURE (${pct}%)` :
                      ob.imbalance === "SELL" ? `SELL PRESSURE (${pct}%)` : `balanced (${pct}%)`;
      const slipStr = ob.slip1kBps !== null
        ? ` | slippage_$1k≈${ob.slip1kBps.toFixed(1)}bps`
        : ` | slippage_$1k=thin_book`;
      lines.push(
        `  ${ob.symbol}/USDT: spread=${ob.spreadPct.toFixed(3)}% | bid_depth=$${bidK}K | ask_depth=$${askK}K | ${flagStr}${slipStr}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
