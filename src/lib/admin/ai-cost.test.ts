import { describe, it, expect } from "vitest";
import { estimateCost, priceForModel } from "@/lib/admin/ai-cost";

describe("ai-cost — model-aware estimation", () => {
  it("prices Opus at the real $5/$25 tier (not the old $15/$75)", () => {
    const p = priceForModel("claude-opus-4-8");
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  it("matches models by substring regardless of version suffix", () => {
    expect(priceForModel("claude-sonnet-4-6").input).toBe(3);
    expect(priceForModel("claude-haiku-4-5-20251001").input).toBe(1);
    expect(priceForModel("kimi-k2.6").input).toBe(0.6);
    expect(priceForModel("mistral-large-latest").input).toBe(2);
  });

  it("applies the standard cache multipliers (1.25x write, 0.1x read)", () => {
    const p = priceForModel("claude-sonnet-4-6");
    expect(p.cacheWrite5m).toBeCloseTo(3 * 1.25);
    expect(p.cacheRead).toBeCloseTo(0.3);
  });

  it("computes a full usage record end-to-end", () => {
    // 1M in + 1M out on Sonnet = $3 + $15
    expect(estimateCost({ model: "claude-sonnet-4-6", inTokens: 1_000_000, outTokens: 1_000_000 })).toBeCloseTo(18);
    // cache-heavy: 1M cache-read on Sonnet = $0.30
    expect(estimateCost({ model: "claude-sonnet-4-6", cachedTokens: 1_000_000 })).toBeCloseTo(0.3);
  });

  it("falls back to Sonnet pricing for unknown/legacy events", () => {
    expect(priceForModel(undefined).input).toBe(3);
    expect(priceForModel("mystery-model").output).toBe(15);
  });
});
