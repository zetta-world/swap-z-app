import { describe, it, expect } from "vitest";
import { allProviders } from "@/lib/ai/registry";

describe("registry — provider sampling temperature", () => {
  // kimi-k2.6 returns 400 "invalid temperature: only 1 is allowed for this
  // model" for any temperature != 1. This pin is the fix; a regression here
  // silently kills Kimi in the tournament again.
  // In instant mode (thinking disabled) kimi-k2.6 requires temperature 0.6 —
  // sending 1 (the thinking-mode value) 400s. Locked so the two never drift apart.
  it("sets Kimi to temperature 0.6 (instant mode)", () => {
    expect(allProviders().kimi.temperature).toBe(0.6);
  });

  // kimi-k2.6 ships thinking ON (slow reasoning trace). We disable it for the
  // fast "instant" path — the exact Moonshot-native param. A regression here
  // brings back the 50s timeouts that kept Kimi out of the tournament.
  it("disables Kimi's thinking trace (instant mode)", () => {
    expect(allProviders().kimi.extraBody).toEqual({ thinking: { type: "disabled" } });
  });

  // Every other provider leaves temperature undefined so openaiCompatChat
  // applies its 0.6 default — changing that would shift their behaviour.
  it("leaves the other providers on the default (undefined)", () => {
    const p = allProviders();
    for (const id of ["deepseek", "mistral", "llama"]) {
      expect(p[id]?.temperature).toBeUndefined();
    }
  });
});
