import { describe, it, expect } from "vitest";
import { cycleProfit, fundingAccrued } from "@/lib/zion/arbiter2";

describe("Arbiter 2.0 — hedged cycle math", () => {
  it("converged cycle: locked spread minus full cost, on the LEG size", () => {
    // Entered at 0.80% spread, converged to 0.05%, $50 leg, 0.45% cost:
    // 50×(0.75%) − 50×(0.45%) = 0.375 − 0.225 = +$0.15
    expect(cycleProfit(0.8, 0.05, 50, 0.45)).toBeCloseTo(0.15, 5);
  });

  it("timeout with barely-narrowed spread can LOSE — honest flywheel", () => {
    // 0.60% → 0.50% only: 50×0.10% − 50×0.45% = −$0.175
    expect(cycleProfit(0.6, 0.5, 50, 0.45)).toBeCloseTo(-0.175, 5);
  });

  it("funding adds to (or drains from) the cycle", () => {
    expect(cycleProfit(0.8, 0.05, 50, 0.45, 0.1)).toBeCloseTo(0.25, 5);
    expect(cycleProfit(0.8, 0.05, 50, 0.45, -0.1)).toBeCloseTo(0.05, 5);
  });

  it("fundingAccrued: rate per 8h × periods held × notional; short receives positive", () => {
    // +0.01% per 8h, held 24h (3 periods), $50 → +$0.015
    expect(fundingAccrued(0.0001, 24, 50)).toBeCloseTo(0.015, 6);
    // negative funding charges the short
    expect(fundingAccrued(-0.0002, 16, 50)).toBeCloseTo(-0.02, 6);
    // junk rate → 0 (never NaN into a wallet)
    expect(fundingAccrued(NaN, 24, 50)).toBe(0);
  });
});
