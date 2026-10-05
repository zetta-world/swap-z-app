/**
 * RM-07 (audit remediation) — o Growth não transforma "não sei" em zero.
 * Cada caso tem o par: leitura boa → número; leitura ruim → null + motivo, nunca 0.
 */
import { describe, it, expect } from "vitest";
import { montarGrowth, type EntradasDoGrowth } from "@/lib/admin/growth";

const c = (count: number) => ({ count, error: null });
const falha = (m = "connection reset") => ({ count: null, error: { message: m } });
const ok = <T,>(linhas: T[]) => ({ linhas, erro: null, truncado: false, paginas: 1 });
const BOAS: EntradasDoGrowth = {
  total: c(10), dau: c(2), wau: c(5), mau: c(8), new1d: c(1), new7d: c(3),
  operacoes: ok([{ wallet_address: "a" }, { wallet_address: "a" }, { wallet_address: "b" }]),
  autopilot: ok([{ wallet_address: "a" }]),
  tiers: ok([{ tier: "pro" }, { tier: "free" }, { tier: "pilot" }]),
};

describe("RM-07 · Growth: erro ≠ zero, incompleto ≠ zero", () => {
  it("tudo medido → completo, com os números e as conversões", () => {
    const g = montarGrowth(BOAS);
    expect(g.estado).toBe("completo");
    expect(g.indisponiveis).toEqual([]);
    expect(g.funnel.map((f) => f.count)).toEqual([10, 2, 1, 2]);
    expect(g.funnel[1].conv).toBeCloseTo(0.2);
    expect(g.active).toEqual({ dau: 2, wau: 5, mau: 8, stickiness: 0.25 });
    expect(g.natureza).toBe("indicativo_nao_ledger");
  });

  it("⚠️⚠️ leitura paginada que FALHOU → null + motivo (antes: `linhas: []` → 0)", () => {
    const g = montarGrowth({ ...BOAS, operacoes: { linhas: [], erro: "statement timeout", truncado: false, paginas: 1 } });
    expect(g.funnel[1]).toEqual({ step: "traded", count: null, conv: null });
    expect(g.estado).toBe("parcial");
    expect(g.indisponiveis).toEqual([{ metrica: "traded", porque: "statement timeout" }]);
    // as outras continuam medidas
    expect(g.funnel[3].count).toBe(2);
  });

  it("⚠️ leitura CORTADA pelo teto → null (não um número menor apresentado como total)", () => {
    const g = montarGrowth({ ...BOAS, tiers: { linhas: [{ tier: "pro" }], erro: null, truncado: true, paginas: 200 } });
    expect(g.funnel[3].count).toBeNull();
    expect(g.indisponiveis[0].porque).toMatch(/cortada/);
  });

  it("⚠️ contagem com erro → null; a base nula derruba as conversões, sem dividir por 'zero'", () => {
    const g = montarGrowth({ ...BOAS, total: falha() });
    expect(g.funnel[0]).toEqual({ step: "signed up", count: null, conv: null });
    expect(g.funnel.every((f) => f.conv === null)).toBe(true);
    expect(g.funnel[1].count).toBe(2);   // o numerador medido continua aparecendo
  });

  it("stickiness só com DAU e MAU medidos e MAU > 0", () => {
    expect(montarGrowth({ ...BOAS, mau: falha() }).active.stickiness).toBeNull();
    expect(montarGrowth({ ...BOAS, mau: c(0), dau: c(0) }).active.stickiness).toBeNull();
    // zero MEDIDO continua sendo zero legítimo
    expect(montarGrowth({ ...BOAS, dau: c(0) }).active.dau).toBe(0);
  });

  it("nada medido → indisponivel (a rota responde 503, não um quadro de zeros)", () => {
    const ruim = { linhas: [], erro: "x", truncado: false, paginas: 1 };
    const g = montarGrowth({
      total: falha(), dau: falha(), wau: falha(), mau: falha(), new1d: falha(), new7d: falha(),
      operacoes: ruim, autopilot: ruim, tiers: ruim,
    });
    expect(g.estado).toBe("indisponivel");
    expect(g.indisponiveis).toHaveLength(9);
    expect(JSON.stringify(g)).not.toMatch(/"count":0/);
  });

  it("contagem ausente sem erro (resposta torta) também é 'não sei'", () => {
    expect(montarGrowth({ ...BOAS, wau: { count: null, error: null } }).active.wau).toBeNull();
  });
});
