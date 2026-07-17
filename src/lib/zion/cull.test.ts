import { describe, it, expect } from "vitest";
import { decideCull, type SourceStat } from "@/lib/zion/cull";

const stat = (source: string, decided: number, expectancyNet: number | null): SourceStat =>
  ({ source, decided, resolved: decided, expectancyNet });

describe("decideCull — tournament cut factory (alavanca 3)", () => {
  it("culls only agents at minimum sample with negative net expectancy", () => {
    const { cull } = decideCull([
      stat("grok_scan", 120, -0.8),   // judged, negative → cull
      stat("kimi_scan", 40, -2.5),    // sub-sample: a bad streak is not a verdict
      stat("mistral_scan", 150, 0.3), // judged, positive → survives
    ], 100);
    expect(cull).toEqual(["grok_scan"]);
  });

  it("champion = best POSITIVE net expectancy at minimum sample", () => {
    const { champion } = decideCull([
      stat("mistral_scan", 150, 0.3),
      stat("self_scan", 200, 0.9),
      stat("deepseek_scan", 90, 5.0),  // sub-sample: lucky streak, not a champion
    ], 100);
    expect(champion).toBe("self_scan");
  });

  it("no champion when nobody is net-positive at sample (honesty over hope)", () => {
    const { champion, cull } = decideCull([
      stat("grok_scan", 120, -0.8),
      stat("self_scan", 110, -0.1),
    ], 100);
    expect(champion).toBeNull();
    expect(cull).toEqual(expect.arrayContaining(["grok_scan", "self_scan"]));
  });

  it("null expectancy (nothing resolved) is never judged", () => {
    const { cull, champion } = decideCull([stat("kimi_scan", 150, null)], 100);
    expect(cull).toEqual([]);
    expect(champion).toBeNull();
  });
});
