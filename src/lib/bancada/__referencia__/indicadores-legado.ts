/**
 * ⚠️ REFERÊNCIA CONGELADA — `computeIndicators` e seus cálculos puros como
 * estavam em `src/lib/api/market-indicators.ts` na base `0afa841`.
 *
 * NÃO É USADO EM PRODUÇÃO. Existe para o teste diferencial do modo mesa
 * (`indicadores-por-prefixo.equivalencia.test.ts`) provar que o retrato
 * pré-calculado (`RetratoPorPrefixo`) é IDÊNTICO, campo a campo e barra a
 * barra, ao que `computeIndicators` devolvia sobre o prefixo — e o benchmark
 * medir antes × depois na mesma execução.
 *
 * Copiado byte a byte (linhas 131–469, 645–657 e 684–780 da base). Únicas
 * diferenças: `computeIndicators` virou `computeIndicatorsLegado`, os `export`
 * das funções auxiliares caíram e os tipos públicos vêm do módulo original.
 * Não "consertar" nada aqui: o valor dele é ser o antes.
 */
import type { Candle, SymbolIndicators, MarketRegime, TimeframeTrend } from "@/lib/api/market-indicators";

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

function calcRSIArray(closes: number[], period = 14): number[] {
  if (closes.length < period + 2) return [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  const result: number[] = [];
  // result[j] corresponds to closes[j + period]
  result.push(avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    result.push(avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcRSI(closes: number[], period = 14): number | null {
  const arr = calcRSIArray(closes, period);
  return arr.length > 0 ? arr[arr.length - 1] : null;
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

/**
 * ATR como SÉRIE, alinhada às velas — o mesmo Wilder do `calcATR`.
 *
 * ⚠️ POR QUE UMA SÉRIE, e não chamar `calcATR` num laço (14/08).
 *
 * O motor de tendência precisa do ATR **de cada dia** para dimensionar o stop
 * daquele dia. Chamar `calcATR(velas.slice(0, i))` para cada `i` daria o número
 * certo e seria quadrático — 1.000 velas viram 500.000 iterações de suavização.
 * Pior: seriam DUAS definições do mesmo conceito vivendo lado a lado, que é o
 * que a invariante nº 7 existe para impedir. Aqui a suavização é a mesma, o
 * `trueRanges` é o mesmo, e só o que se devolve muda.
 *
 * ⚠️ ALINHAMENTO: `tr[i]` descreve a vela `i+1` (True Range precisa do
 * fechamento anterior). A semente é a média dos `period` primeiros TRs, e ela
 * descreve a vela de índice `period`. Antes disso o ATR **não existe** e o
 * valor é `null` — não zero. ATR zero é uma vela sem amplitude, e um stop
 * calculado sobre ele seria colado no preço; `null` obriga quem lê a pular o
 * dia, que é o comportamento correto durante o aquecimento.
 */
function calcATRSerie(candles: Candle[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr = trueRanges(candles);
  if (tr.length < period) return out;

  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i + 1] = atr;
  }
  return out;
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

// ─── OBV (On-Balance Volume) ────────────────────────────────────────────

/**
 * Returns the last OBV value and a trend label derived from comparing the
 * mean of the last 10 bars against the 10 bars before that. The absolute
 * value is meaningless across symbols; only the trend direction matters.
 */
function calcOBV(candles: Candle[]): { obv: number; trend: "rising" | "falling" | "flat" } | null {
  if (candles.length < 20) return null;
  const series: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = series[i - 1];
    if      (candles[i].close > candles[i - 1].close) series.push(prev + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) series.push(prev - candles[i].volume);
    else                                               series.push(prev);
  }
  const last = series[series.length - 1];
  const w = Math.min(10, Math.floor(series.length / 3));
  const recentAvg = series.slice(-w).reduce((a, b) => a + b, 0) / w;
  const priorAvg  = series.slice(-w * 2, -w).reduce((a, b) => a + b, 0) / w;
  // Normalise by range so near-zero OBV doesn't produce false signals.
  const range = Math.max(Math.abs(last), Math.abs(priorAvg), 1);
  const ratio = (recentAvg - priorAvg) / range;
  const trend: "rising" | "falling" | "flat" =
    ratio >  0.01 ? "rising" :
    ratio < -0.01 ? "falling" : "flat";
  return { obv: last, trend };
}

// ─── Relative Volume ─────────────────────────────────────────────────────

function calcRelativeVolume(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 1) return null;
  const current = candles[candles.length - 1].volume;
  const avgVol = candles.slice(-period - 1, -1).reduce((a, c) => a + c.volume, 0) / period;
  if (avgVol <= 0) return null;
  return current / avgVol; // e.g. 2.5 = 2.5× average
}

// ─── RSI Divergence Detection ────────────────────────────────────────────

function detectRSIDivergence(
  closes: number[],
  rsiArray: number[],  // rsiArray[j] corresponds to closes[j + period]
  period = 14,
): "bullish_rsi" | "bearish_rsi" | null {
  const left = 4, right = 4;
  const minSwingPct = 1.5; // minimum % between two consecutive pivots

  const priceHighs: Array<{ price: number; rsi: number }> = [];
  const priceLows:  Array<{ price: number; rsi: number }> = [];

  // Scan last 60 candles, leave right-side buffer
  const scanStart = Math.max(period + left, closes.length - 60);
  const scanEnd   = closes.length - right;

  for (let i = scanStart; i < scanEnd; i++) {
    let isHigh = true, isLow = true;
    for (let k = -left; k <= right; k++) {
      if (k === 0) continue;
      if (closes[i + k] >= closes[i]) isHigh = false;
      if (closes[i + k] <= closes[i]) isLow  = false;
    }
    const rsiIdx = i - period;
    if (rsiIdx < 0 || rsiIdx >= rsiArray.length) continue;
    if (isHigh) priceHighs.push({ price: closes[i], rsi: rsiArray[rsiIdx] });
    if (isLow)  priceLows.push( { price: closes[i], rsi: rsiArray[rsiIdx] });
  }

  // Bearish divergence: price higher high + RSI lower high
  if (priceHighs.length >= 2) {
    const [a, b] = priceHighs.slice(-2);
    if ((b.price - a.price) / a.price * 100 > minSwingPct && b.rsi < a.rsi - 2) {
      return "bearish_rsi";
    }
  }

  // Bullish divergence: price lower low + RSI higher low
  if (priceLows.length >= 2) {
    const [a, b] = priceLows.slice(-2);
    if ((a.price - b.price) / a.price * 100 > minSwingPct && b.rsi > a.rsi + 2) {
      return "bullish_rsi";
    }
  }

  return null;
}

// ─── Support / Resistance + Daily Pivots ─────────────────────────────────

function calcSupportResistance(
  candles: Candle[],
  price: number,
  leftRight = 5,
): { supports: number[]; resistances: number[] } {
  if (candles.length < leftRight * 2 + 5) return { supports: [], resistances: [] };

  const swingHighs: number[] = [];
  const swingLows:  number[] = [];

  for (let i = leftRight; i < candles.length - leftRight; i++) {
    let isHigh = true, isLow = true;
    for (let k = -leftRight; k <= leftRight; k++) {
      if (k === 0) continue;
      if (candles[i + k].high >= candles[i].high) isHigh = false;
      if (candles[i + k].low  <= candles[i].low)  isLow  = false;
    }
    if (isHigh) swingHighs.push(candles[i].high);
    if (isLow)  swingLows.push(candles[i].low);
  }

  // Cluster levels within 0.5% of each other
  const cluster = (levels: number[]): number[] => {
    if (!levels.length) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const out: number[] = [];
    let group: number[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i] - sorted[i - 1]) / sorted[i - 1] < 0.005) {
        group.push(sorted[i]);
      } else {
        out.push(group.reduce((a, b) => a + b, 0) / group.length);
        group = [sorted[i]];
      }
    }
    out.push(group.reduce((a, b) => a + b, 0) / group.length);
    return out;
  };

  const clusteredHighs = cluster(swingHighs);
  const clusteredLows  = cluster(swingLows);

  const supports    = clusteredLows.filter(l => l < price * 0.999).sort((a, b) => b - a).slice(0, 3);
  const resistances = clusteredHighs.filter(h => h > price * 1.001).sort((a, b) => a - b).slice(0, 3);

  return { supports, resistances };
}

function calcDailyPivots(
  dailyCandles: Candle[],
): { pp: number; r1: number; r2: number; s1: number; s2: number } | null {
  // Use the second-to-last candle (last FULLY closed day)
  if (dailyCandles.length < 2) return null;
  const prev = dailyCandles[dailyCandles.length - 2];
  const pp = (prev.high + prev.low + prev.close) / 3;
  return {
    pp,
    r1: 2 * pp - prev.low,
    r2: pp + (prev.high - prev.low),
    s1: 2 * pp - prev.high,
    s2: pp - (prev.high - prev.low),
  };
}

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

export function computeIndicatorsLegado(symbol: string, c1h: Candle[], c4h: Candle[], c1d: Candle[], c1w: Candle[]): SymbolIndicators {
  const empty: SymbolIndicators = {
    symbol, price: null, rsi14: null, ema20: null, ema50: null, macd: null,
    atr14: null, atrPct: null, adx: null, regime: "TRANSITIONING",
    trend: "neutral", htf4h: null, htf1d: null, htf1w: null, alignment: "mixed",
    obv: null, obvTrend: null, confidenceScore: null,
    relVol: null, divergence: null, supports: [], resistances: [], pivotLevels: null,
    rsiTrajectory: [], yearHigh: null, yearLow: null, rangePct: null, distFromYearHighPct: null,
  };
  if (c1h.length < 52) return empty;

  const closes = c1h.map((c) => c.close);
  const rsiArray = calcRSIArray(closes, 14);
  const rsi14   = rsiArray.length > 0 ? rsiArray[rsiArray.length - 1] : null;
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

  // Higher-timeframe trends (now including the weekly for cycle context).
  const htf4h = timeframeTrend(c4h.map((c) => c.close));
  const htf1d = timeframeTrend(c1d.map((c) => c.close));
  const htf1w = timeframeTrend(c1w.map((c) => c.close));

  // ── Long-range position + trajectory (Z1/Z2) ──
  // Where does price sit inside its 1-year range, and is it near the cycle
  // top/bottom? This is the "look back months/years" context ZION lacked.
  let yearHigh: number | null = null;
  let yearLow:  number | null = null;
  let rangePct: number | null = null;
  let distFromYearHighPct: number | null = null;
  if (c1d.length >= 30) {
    yearHigh = Math.max(...c1d.map((c) => c.high));
    yearLow  = Math.min(...c1d.map((c) => c.low));
    if (yearHigh > yearLow) {
      rangePct = ((price - yearLow) / (yearHigh - yearLow)) * 100;
      distFromYearHighPct = ((price - yearHigh) / yearHigh) * 100;
    }
  }
  // Recent RSI path (oldest→newest) so ZION sees momentum DIRECTION, not just
  // the current value frozen in time.
  const rsiTrajectory = rsiArray.slice(-4).map((v) => Math.round(v * 10) / 10);

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

  const obvResult = calcOBV(c1h);
  const relVol = calcRelativeVolume(c1h, 20);
  const divergence = detectRSIDivergence(closes, rsiArray);
  const srLevels = price !== null ? calcSupportResistance(c1h, price, 5) : { supports: [], resistances: [] };
  const pivotLevels = calcDailyPivots(c1d);

  return {
    symbol, price, rsi14, ema20, ema50, macd, atr14, atrPct,
    adx: adxRes?.adx ?? null, regime, trend, htf4h, htf1d, htf1w, alignment,
    obv:      obvResult?.obv      ?? null,
    obvTrend: obvResult?.trend    ?? null,
    confidenceScore: null, // filled by getMarketIndicators after ob + f&g are available
    relVol,
    divergence,
    supports:    srLevels.supports,
    resistances: srLevels.resistances,
    pivotLevels,
    rsiTrajectory, yearHigh, yearLow, rangePct, distFromYearHighPct,
  };
}
