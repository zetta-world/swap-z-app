import { describe, it, expect } from "vitest";
import { formatRegimeContext } from "@/lib/autopilot/scan";

describe("executor — regime context for the autopilot scan (D3)", () => {
  it("formats one line per symbol with regime and RSI", () => {
    const out = formatRegimeContext([
      { symbol: "btc", regime: "TRENDING_UP", rsi14: 61.4 },
      { symbol: "SOL", regime: "RANGING", rsi14: null },
    ]);
    expect(out).toBe("  - BTC: TRENDING_UP | RSI14 61\n  - SOL: RANGING");
  });

  it("drops symbols with no regime (fail-quiet in the payload; the hard gate fails closed)", () => {
    const out = formatRegimeContext([
      { symbol: "ETH", regime: null },
      { symbol: "BTC", regime: "TRENDING_DOWN" },
    ]);
    expect(out).toBe("  - BTC: TRENDING_DOWN");
  });

  it("returns an empty string with no usable indicators", () => {
    expect(formatRegimeContext([])).toBe("");
  });
});
