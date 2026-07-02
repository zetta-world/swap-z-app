import { describe, it, expect } from "vitest";
import { calcEMA, calcRSI, calcMACD, calcATR, calcADX, type Candle } from "@/lib/api/market-indicators";
import { checkRealNotional, NOTIONAL_TOLERANCE, AUTOPILOT_HARD_CEILING_USD } from "@/lib/autopilot/price-guard";

/**
 * Sanity properties for the indicator math that feeds every ZION decision.
 * These aren't precision tests against a vendor — they pin the mathematical
 * INVARIANTS that, if broken by a refactor, would silently corrupt every
 * signal downstream (regime detection, confidence score, the flywheel).
 */

const rising  = (n: number, start = 100, step = 1) => Array.from({ length: n }, (_, i) => start + i * step);
const falling = (n: number, start = 100, step = 1) => Array.from({ length: n }, (_, i) => start - i * step);
const candle  = (close: number, range = 2): Candle => ({ high: close + range / 2, low: close - range / 2, close, volume: 1000 });

describe("calcRSI (Wilder)", () => {
  it("approaches 100 on a strictly rising series", () => {
    expect(calcRSI(rising(50))!).toBeGreaterThan(95);
  });
  it("approaches 0 on a strictly falling series", () => {
    expect(calcRSI(falling(50, 200))!).toBeLessThan(5);
  });
  it("stays within [0, 100] on mixed data", () => {
    const mixed = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const v = calcRSI(mixed)!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
  it("returns null with insufficient data", () => {
    expect(calcRSI(rising(10))).toBeNull();
  });
});

describe("calcEMA", () => {
  it("is constant on a constant series", () => {
    const ema = calcEMA(Array(30).fill(50), 10);
    expect(ema[ema.length - 1]).toBeCloseTo(50);
  });
  it("lags below the last price on a rising series (and above on falling)", () => {
    const up = calcEMA(rising(30), 10);
    expect(up[up.length - 1]).toBeLessThan(129);       // < last close
    expect(up[up.length - 1]).toBeGreaterThan(100);    // > first close
  });
});

describe("calcMACD", () => {
  it("is positive in a sustained uptrend (fast EMA above slow)", () => {
    const m = calcMACD(rising(80))!;
    expect(m.macd).toBeGreaterThan(0);
  });
  it("is negative in a sustained downtrend", () => {
    const m = calcMACD(falling(80, 500, 2))!;
    expect(m.macd).toBeLessThan(0);
  });
});

describe("calcATR (Wilder)", () => {
  it("equals the constant true range when every candle has the same range", () => {
    // Consecutive closes equal → TR = high - low = 2 exactly.
    const candles = Array.from({ length: 40 }, () => candle(100, 2));
    expect(calcATR(candles)!).toBeCloseTo(2, 5);
  });
  it("returns null with insufficient candles", () => {
    expect(calcATR(Array.from({ length: 10 }, () => candle(100)))).toBeNull();
  });
});

describe("calcADX (Wilder)", () => {
  it("reads a strong steady trend as trending (ADX > 25)", () => {
    const candles = rising(80, 100, 2).map((c) => candle(c, 1));
    const a = calcADX(candles)!;
    expect(a.adx).toBeGreaterThan(25);
    expect(a.plusDI).toBeGreaterThan(a.minusDI); // and it knows the DIRECTION
  });
});

// ─── price-guard: the last gate before real money moves ─────────────────────

describe("checkRealNotional (autopilot money guard)", () => {
  const base = { side: "buy" as const, baseAmount: 1, refPrice: 100, maxTradeUsd: 100 };

  it("fails safe when no reference price exists", () => {
    expect(checkRealNotional({ ...base, refPrice: null }).ok).toBe(false);
    expect(checkRealNotional({ ...base, refPrice: 0 }).ok).toBe(false);
  });

  it("passes a buy within cap × tolerance and rejects above it", () => {
    // cap 100 × 1.5 tolerance = 150 ceiling
    expect(checkRealNotional({ ...base, baseAmount: 1.4 }).ok).toBe(true);   // $140
    expect(checkRealNotional({ ...base, baseAmount: 1.6 }).ok).toBe(false);  // $160
    expect(NOTIONAL_TOLERANCE).toBe(1.5);
  });

  it("lets sells pass the per-trade cap (they reduce exposure)…", () => {
    expect(checkRealNotional({ ...base, side: "sell", baseAmount: 50 }).ok).toBe(true); // $5000 sell, cap $100
  });

  it("…but nothing passes the absolute hard ceiling", () => {
    const over = AUTOPILOT_HARD_CEILING_USD / 100 + 1;
    expect(checkRealNotional({ ...base, side: "sell", baseAmount: over }).ok).toBe(false);
    expect(checkRealNotional({ ...base, side: "buy",  baseAmount: over, maxTradeUsd: 10_000_000 }).ok).toBe(false);
  });

  it("rejects non-finite notionals (the 1000x-parse blast radius)", () => {
    expect(checkRealNotional({ ...base, baseAmount: Infinity }).ok).toBe(false);
    expect(checkRealNotional({ ...base, baseAmount: -5 }).ok).toBe(false);
  });
});
