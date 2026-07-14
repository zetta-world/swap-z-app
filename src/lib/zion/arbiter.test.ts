import { describe, it, expect } from "vitest";
import { findArbs } from "@/lib/zion/arbiter";

const matrix = (entries: Record<string, Record<string, number>>) => {
  const m = new Map<string, Map<string, { priceUsd: number }>>();
  for (const [sym, venues] of Object.entries(entries)) {
    m.set(sym, new Map(Object.entries(venues).map(([v, p]) => [v, { priceUsd: p }])));
  }
  return m;
};

describe("arbiter — pure spread detector", () => {
  it("books only spreads whose NET clears the floor", () => {
    const arbs = findArbs(matrix({
      // 1% gross − 0.4% cost = 0.6% net → passes
      SOL: { binance: 100, gateio: 101 },
      // 0.4% gross − 0.4% = 0% net → fails the 0.15 floor
      ETH: { binance: 1000, okx: 1004 },
    }), 0.4, 0.15);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].symbol).toBe("SOL");
    expect(arbs[0].buyVenue).toBe("binance");
    expect(arbs[0].sellVenue).toBe("gateio");
    expect(arbs[0].netPct).toBeCloseTo(0.6, 5);
  });

  it("picks the widest venue pair when three quote the symbol", () => {
    const arbs = findArbs(matrix({ BTC: { kraken: 60000, binance: 60300, mexc: 60900 } }), 0.4, 0.15);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].buyVenue).toBe("kraken");
    expect(arbs[0].sellVenue).toBe("mexc");
    expect(arbs[0].spreadPct).toBeCloseTo(1.5, 5);
  });

  it("sorts opportunities best-net-first", () => {
    const arbs = findArbs(matrix({
      A: { x: 100, y: 100.7 },   // 0.7 gross → 0.3 net
      B: { x: 100, y: 102 },     // 2.0 gross → 1.6 net
    }), 0.4, 0.15);
    expect(arbs.map((a) => a.symbol)).toEqual(["B", "A"]);
  });

  it("fails closed: single venue, equal venues, or junk prices book nothing", () => {
    expect(findArbs(matrix({ SOL: { binance: 100 } }))).toHaveLength(0);          // 1 venue
    expect(findArbs(matrix({ SOL: { binance: 100, okx: 100 } }))).toHaveLength(0); // no spread
    expect(findArbs(matrix({ SOL: { binance: 0, okx: -5 } }))).toHaveLength(0);    // junk
  });
});
