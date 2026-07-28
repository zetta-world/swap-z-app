import { describe, it, expect } from "vitest";
import { vwapBuy, vwapSell, assessRealism, type Level } from "@/lib/zion/arb-realism";

describe("arb-realism — depth-walking (F2)", () => {
  it("vwapBuy: fills at top price when depth is deep", () => {
    const asks: Level[] = [[100, 1000], [101, 1000]]; // $100k available at 100
    const r = vwapBuy(asks, 5000); // buy $5k
    expect(r.avgPrice).toBeCloseTo(100);
    expect(r.baseFilled).toBeCloseTo(50);
    expect(r.fullyFilled).toBe(true);
  });

  it("vwapBuy: walks UP the book when the top level is thin", () => {
    const asks: Level[] = [[100, 10], [110, 1000]]; // only $1000 at 100, rest at 110
    const r = vwapBuy(asks, 5000); // $1000@100 (10 base) + $4000@110 (36.36 base)
    expect(r.avgPrice).toBeGreaterThan(100);
    expect(r.avgPrice).toBeLessThan(110);
    expect(r.fullyFilled).toBe(true);
  });

  it("vwapBuy: fullyFilled=false when the book can't cover the size", () => {
    const r = vwapBuy([[100, 1]], 5000); // only $100 of depth
    expect(r.fullyFilled).toBe(false);
  });

  it("assessRealism: deep book → realistic ≈ theoretical (little slippage)", () => {
    const asks: Level[] = [[100, 100000]];
    const bids: Level[] = [[100.5, 100000]];
    // theoretical spread 0.5%, cost 0.4%
    const a = assessRealism(asks, bids, 50, 0.5, 0.4);
    expect(a.fullyFilled).toBe(true);
    expect(a.realisticNetPct).toBeCloseTo(0.1, 2);
    expect(a.slippagePct).toBeCloseTo(0, 2);
  });

  it("assessRealism: THIN book turns a paper win into a real LOSS", () => {
    // Top-of-book says 0.8% spread, but depth is shallow: buying $50 walks the
    // asks up and selling walks the bids down → realistic spread collapses.
    const asks: Level[] = [[100, 0.2], [100.5, 0.2], [101.5, 5]];   // ~$20 then jumps
    const bids: Level[] = [[100.8, 0.2], [100.2, 0.2], [99, 5]];    // ~$20 then drops
    const a = assessRealism(asks, bids, 50, 0.8, 0.4);
    // paper (top-of-book) net was +0.4%; depth eats it
    expect(a.theoreticalNetPct).toBeCloseTo(0.4, 2);
    expect(a.realisticNetPct).toBeLessThan(a.theoreticalNetPct);
    expect(a.slippagePct).toBeGreaterThan(0);
  });
});
