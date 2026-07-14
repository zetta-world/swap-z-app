import { describe, it, expect } from "vitest";
import { trendGate, rrGate, budgetLeft } from "@/lib/zion/sniper";

describe("sniper — trend gate (with-trend only, both directions)", () => {
  it("allows a buy only in a confirmed uptrend", () => {
    expect(trendGate("buy", "TRENDING_UP")).toBe(true);
    expect(trendGate("buy", "TRENDING_DOWN")).toBe(false);
    expect(trendGate("buy", "RANGING")).toBe(false);
    expect(trendGate("buy", "TRANSITIONING")).toBe(false);
  });
  it("allows a sell only in a confirmed downtrend (symmetric — no long bias)", () => {
    expect(trendGate("sell", "TRENDING_DOWN")).toBe(true);
    expect(trendGate("sell", "TRENDING_UP")).toBe(false);
    expect(trendGate("sell", "RANGING")).toBe(false);
  });
  it("rejects when the regime is unknown (fail closed)", () => {
    expect(trendGate("buy", null)).toBe(false);
    expect(trendGate("sell", undefined)).toBe(false);
  });
});

describe("sniper — R:R gate (full bracket, >= 1.5)", () => {
  it("accepts a clean 2:1 long and rejects a 1.2:1", () => {
    expect(rrGate("buy", 100, 110, 95)).toBe(true);   // reward 10 / risk 5 = 2
    expect(rrGate("buy", 100, 106, 95)).toBe(false);  // 6/5 = 1.2 < 1.5
  });
  it("prices a short symmetrically", () => {
    expect(rrGate("sell", 100, 90, 105)).toBe(true);  // reward 10 / risk 5 = 2
    expect(rrGate("sell", 100, 97, 105)).toBe(false); // 3/5 = 0.6
  });
  it("fails closed without a full bracket or with broken geometry", () => {
    expect(rrGate("buy", 100, null, 95)).toBe(false);   // no target
    expect(rrGate("buy", 100, 110, null)).toBe(false);  // no stop
    expect(rrGate("buy", null, 110, 95)).toBe(false);   // no entry
    expect(rrGate("buy", 100, 95, 90)).toBe(false);     // target below entry
    expect(rrGate("buy", 100, 110, 105)).toBe(false);   // stop above entry
  });
});

describe("sniper — monthly budget (scarcity is the strategy)", () => {
  it("counts shots left and floors at zero", () => {
    expect(budgetLeft(0, 30)).toBe(30);
    expect(budgetLeft(29, 30)).toBe(1);
    expect(budgetLeft(30, 30)).toBe(0);
    expect(budgetLeft(45, 30)).toBe(0);  // over-used never goes negative
    expect(budgetLeft(-3, 30)).toBe(30); // garbage input clamped
  });
});
