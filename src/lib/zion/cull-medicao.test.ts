import { describe, expect, it } from "vitest";
import { aggregateCullStats, decideCull } from "./cull";
import { CUSTO_IDA_E_VOLTA_PCT as custo } from "./custo";

describe("corte só julga desfechos medidos", () => {
  it("um backlog sem preço não transforma mesa lucrativa em cortada", () => {
    const base = Array.from({ length: 100 }, () => ({
      source: "hybrid_scan", status: "hit_target", outcome_pct: custo + 0.1,
    }));
    const backlog = Array.from({ length: 1000 }, () => ({
      source: "hybrid_scan", status: "unresolvable", outcome_pct: null,
    }));
    const antes = aggregateCullStats(base);
    const depois = aggregateCullStats([...base, ...backlog]);
    expect(depois).toEqual(antes);
    expect(decideCull(depois, 100, [])).toEqual({
      cull: [], champion: "hybrid_scan", poupadas: [],
    });
  });

  it("preserva zero observado e expiração, sem inventar a amostra decidida", () => {
    const [s] = aggregateCullStats([
      { source: "x", status: "hit_target", outcome_pct: 1 },
      { source: "x", status: "expired", outcome_pct: 0 },
    ]);
    expect(s).toEqual({ source: "x", decided: 1, resolved: 2, expectancyNet: 0.5 - custo });
    expect(decideCull([s], 2, []).champion).toBeNull();
  });

  it("preserva o desfecho neutral legado como expiração com preço", () => {
    const wins = Array.from({ length: 100 }, () => ({
      source: "hybrid_scan", status: "win", outcome_pct: 1,
    }));
    const neutral = Array.from({ length: 100 }, () => ({
      source: "hybrid_scan", status: "neutral", outcome_pct: -1,
    }));
    const stats = aggregateCullStats([...wins, ...neutral]);
    expect(stats).toEqual([{
      source: "hybrid_scan", decided: 100, resolved: 200, expectancyNet: -custo,
    }]);
    expect(decideCull(stats, 100, []).champion).toBeNull();
  });

  it("recusa null, NaN, infinito, abertos e status desconhecido", () => {
    expect(aggregateCullStats([
      { source: "x", status: "hit_stop", outcome_pct: null },
      { source: "x", status: "hit_target", outcome_pct: NaN },
      { source: "x", status: "expired", outcome_pct: Infinity },
      { source: "x", status: "unresolvable", outcome_pct: 99 },
      { source: "x", status: "open", outcome_pct: 99 },
      { source: "x", status: "unknown", outcome_pct: 99 },
    ])).toEqual([]);
  });
});
