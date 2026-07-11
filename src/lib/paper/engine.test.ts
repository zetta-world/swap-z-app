import { describe, it, expect } from "vitest";
import { sizePosition, canEnter, computeExit, computeExitPath, convictionFactor } from "@/lib/paper/engine";

describe("paper engine — position sizing", () => {
  it("deploys 5% of starting capital, capped by available cash", () => {
    expect(sizePosition(1000, 1000)).toBeCloseTo(50);   // 5% of 1000
    expect(sizePosition(30, 1000)).toBeCloseTo(30);      // cash-limited
  });
  it("returns 0 when below the min-cash floor (out of capital)", () => {
    expect(sizePosition(10, 1000)).toBe(0);              // 10 < 25 floor
    expect(sizePosition(0, 1000)).toBe(0);
  });
});

describe("paper engine — entry guard", () => {
  it("enters a buy only when fill sits inside the bracket", () => {
    expect(canEnter("buy", 100, 110, 95)).toBe(true);    // stop < fill < target
    expect(canEnter("buy", 112, 110, 95)).toBe(false);   // already past target
    expect(canEnter("buy", 94,  110, 95)).toBe(false);   // already past stop
  });
  it("enters a sell (short) only when fill sits inside the inverted bracket", () => {
    expect(canEnter("sell", 100, 90, 105)).toBe(true);   // target < fill < stop
    expect(canEnter("sell", 88,  90, 105)).toBe(false);  // already past target
  });
  it("refuses without a bracket or with a non-positive fill", () => {
    expect(canEnter("buy", 100, null, 95)).toBe(false);
    expect(canEnter("buy", 0,   110, 95)).toBe(false);
  });
});

describe("paper engine — exit + P&L (net of cost, stop-first)", () => {
  const base = { side: "buy", entry_price: 100, cost_usd: 50, target_price: 110, stop_price: 95, opened_at: "2026-07-01T00:00:00Z", horizon_hours: 72 };
  const t0 = Date.parse("2026-07-01T00:00:00Z");

  it("books a win at target, net of round-trip cost", () => {
    const v = computeExit(base, 111, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
    expect(v.win).toBe(true);
    // gross +10%, net +9.8% on $50 = +$4.90
    expect(v.pnlUsd).toBeCloseTo(50 * (10 - 0.2) / 100, 6);
  });

  it("books a loss at stop", () => {
    const v = computeExit(base, 94, t0 + 3_600_000)!;
    expect(v.reason).toBe("stop");
    expect(v.win).toBe(false);
    expect(v.pnlUsd).toBeLessThan(0);
  });

  it("stop-first pessimism when a tick shows both crossed", () => {
    const v = computeExit(base, 90, t0 + 3_600_000)!; // below stop AND (if it were) — books stop
    expect(v.reason).toBe("stop");
  });

  it("expires at the current price after the horizon", () => {
    const v = computeExit(base, 103, t0 + 73 * 3_600_000)!;
    expect(v.reason).toBe("expired");
    expect(v.win).toBe(true); // +3% gross → net positive
  });

  it("stays in-flight (null) before any level or the horizon", () => {
    expect(computeExit(base, 103, t0 + 3_600_000)).toBeNull();
  });

  it("prices a short correctly (profit when price falls)", () => {
    const short = { ...base, side: "sell", target_price: 90, stop_price: 105 };
    const v = computeExit(short, 89, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
    expect(v.pnlUsd).toBeGreaterThan(0);
  });
});

describe("paper engine — conviction sizing (F3)", () => {
  it("scales the multiplier by probability, clamped to [0.5, 1.5]", () => {
    expect(convictionFactor(50)).toBeCloseTo(1.0);
    expect(convictionFactor(70)).toBeCloseTo(1.2);
    expect(convictionFactor(30)).toBeCloseTo(0.8);
    expect(convictionFactor(200)).toBe(1.5);   // clamp
    expect(convictionFactor(0)).toBe(0.5);     // clamp
    expect(convictionFactor(null)).toBeCloseTo(1.0); // neutral default
  });
  it("a high-conviction signal deploys more capital", () => {
    expect(sizePosition(1000, 1000, 1.4)).toBeCloseTo(70); // 5% × 1.4
    expect(sizePosition(1000, 1000, 0.8)).toBeCloseTo(40); // 5% × 0.8
  });
});

describe("paper engine — path-aware exit (F3)", () => {
  const base = { side: "buy", entry_price: 100, cost_usd: 50, target_price: 110, stop_price: 95, opened_at: "2026-07-01T00:00:00Z", horizon_hours: 72 };
  const t0 = Date.parse("2026-07-01T00:00:00Z");
  const candle = (min: number, high: number, low: number, close: number) => ({ t: t0 + min * 60_000, high, low, close });

  it("books the target when an intra-window candle wicks through it", () => {
    // spot is back at 102 now, but a candle at :20 wicked to 111 → target hit
    const v = computeExitPath(base, [candle(10, 105, 99, 104), candle(20, 111, 103, 106)], 102, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
  });

  it("stop-first when one candle straddles both levels", () => {
    const v = computeExitPath(base, [candle(10, 112, 94, 100)], 100, t0 + 3_600_000)!;
    expect(v.reason).toBe("stop");
  });

  it("falls back to the spot check when no candles are available", () => {
    const v = computeExitPath(base, [], 111, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
  });

  it("stays in-flight when no candle touched a level and horizon is open", () => {
    expect(computeExitPath(base, [candle(10, 104, 98, 101)], 101, t0 + 3_600_000)).toBeNull();
  });
});
