import { describe, it, expect } from "vitest";
import { maxDrawdownPct, buyHoldReturnPct, evaluate, MIN_DECIDED } from "@/lib/admin/launch-gate";

const base = {
  source: "strat_mech", startingUsd: 1000, usdt: 1200,
  decided: MIN_DECIDED, regimes: new Set(["TRENDING_UP", "RANGING"]),
  drawdownPct: 5, buyHoldPct: 5, netExpectancy: 0.4,
};

describe("maxDrawdownPct — o número que define o tamanho de posição", () => {
  it("curva só subindo não tem queda", () => {
    expect(maxDrawdownPct([1000, 1100, 1200])).toBe(0);
  });
  it("mede a maior queda a partir do PICO, não do início", () => {
    // sobe pra 2000, cai pra 1000 = 50% do pico (não 0% por ter voltado ao início)
    expect(maxDrawdownPct([1000, 2000, 1000, 1500])).toBe(50);
  });
  it("curva vazia ou de um ponto não inventa número", () => {
    expect(maxDrawdownPct([])).toBe(0);
    expect(maxDrawdownPct([1000])).toBe(0);
  });
});

describe("buyHoldReturnPct — o competidor honesto", () => {
  it("média das pernas, peso igual", () => {
    expect(buyHoldReturnPct([{ first: 100, last: 110 }, { first: 100, last: 90 }])).toBe(0);
  });
  it("devolve null sem perna válida — não finge que o hold rendeu zero", () => {
    expect(buyHoldReturnPct([])).toBeNull();
    expect(buyHoldReturnPct([{ first: 0, last: 100 }])).toBeNull();
  });
});

describe("evaluate — conjunção, e pendente nunca aprova", () => {
  it("os 5 critérios batendo → passa", () => {
    const v = evaluate(base);
    expect(v.passed).toBe(true);
    expect(v.criteria.every((c) => c.pass)).toBe(true);
  });

  it("4 de 5 REPROVA — não é média ponderada", () => {
    // amostra ótima, drawdown ótimo, regimes ok, líquido positivo...
    // mas perde do buy-and-hold. Reprova.
    const v = evaluate({ ...base, usdt: 1050, buyHoldPct: 20 });
    expect(v.passed).toBe(false);
    expect(v.criteria.filter((c) => c.pass)).toHaveLength(4);
  });

  it("PENDENTE não conta como aprovado, mesmo com o resto perfeito", () => {
    // Sem preço de referência, 'bate o hold' fica pendente — e pendente
    // aprovar seria exatamente como uma auditoria mente sem mentir.
    const v = evaluate({ ...base, buyHoldPct: null });
    expect(v.passed).toBe(false);
    expect(v.pending).toBe(1);
    expect(v.criteria.find((c) => c.id === "beats_hold")!.pending).toBe(true);
  });

  it("amostra insuficiente reprova por mais bonita que seja a curva", () => {
    const v = evaluate({ ...base, decided: 12, usdt: 3000 });
    expect(v.passed).toBe(false);
    expect(v.criteria.find((c) => c.id === "sample")!.pass).toBe(false);
  });

  it("um regime só reprova — coincidência de estação não é estratégia", () => {
    const v = evaluate({ ...base, regimes: new Set(["RANGING"]) });
    expect(v.passed).toBe(false);
    expect(v.criteria.find((c) => c.id === "regimes")!.pass).toBe(false);
  });

  it("drawdown acima do teto reprova mesmo com lucro no fim", () => {
    const v = evaluate({ ...base, usdt: 1400, drawdownPct: 42 });
    expect(v.passed).toBe(false);
    expect(v.criteria.find((c) => c.id === "drawdown")!.pass).toBe(false);
  });

  it("expectancy líquida negativa reprova — bruto que a taxa come não é lucro", () => {
    const v = evaluate({ ...base, netExpectancy: -0.05 });
    expect(v.passed).toBe(false);
  });

  it("mesa zerada fica pendente, não reprovada por engano", () => {
    const v = evaluate({ ...base, decided: 0, netExpectancy: null, buyHoldPct: null, regimes: new Set<string>() });
    expect(v.passed).toBe(false);
    expect(v.pending).toBeGreaterThan(0);
  });

  /**
   * ⚠️ O CASO QUE ESCAPOU, E POR QUE ESCAPOU (05/08).
   *
   * O teste acima usa `decided: 0` JUNTO com `netExpectancy: null`. Nunca
   * exercitou a combinação que o painel produziu de verdade: zero decididos e
   * uma expectancy NÃO-nula, vinda de posições não resolvidas.
   *
   * O dono viu antes de mim, no cartão da FREYJA:
   *
   *   ✗ Amostra ≥ 100 decididos ......... 0/100 decididos
   *   ✓ Expectancy líquida positiva ..... +0.290% por trade, líquido
   *
   * Dois critérios no mesmo cartão, um dizendo que não há amostra e o outro
   * aprovando uma média dessa amostra inexistente. O de drawdown, no mesmo
   * arquivo, sempre teve a guarda `decided === 0`; o de expectancy não.
   *
   * Fixture com os números reais da FREYJA para não voltar.
   */
  it("expectancy com ZERO decididos fica PENDENTE, nunca aprova — o caso da FREYJA", () => {
    const v = evaluate({
      ...base, decided: 0, netExpectancy: 0.29,
      buyHoldPct: null, regimes: new Set(["RANGING", "TRENDING_UP"]),
    });
    const c = v.criteria.find((x) => x.id === "net_positive")!;
    expect(c.pass).toBe(false);
    expect(c.pending).toBe(true);
    expect(c.detail).toContain("amostra vazia");
    expect(v.passed).toBe(false);
  });

  it("a mesma guarda do drawdown vale para a expectancy — simetria entre critérios", () => {
    const zerada = evaluate({ ...base, decided: 0, netExpectancy: 5 });
    const dd = zerada.criteria.find((x) => x.id === "drawdown")!;
    const exp = zerada.criteria.find((x) => x.id === "net_positive")!;
    // Um critério não pode julgar o que o outro declara não existir.
    expect(dd.pending).toBe(exp.pending);
  });

  it("com amostra, a expectancy positiva volta a aprovar normalmente", () => {
    const v = evaluate({ ...base, decided: MIN_DECIDED, netExpectancy: 0.29 });
    const c = v.criteria.find((x) => x.id === "net_positive")!;
    expect(c.pending).toBe(false);
    expect(c.pass).toBe(true);
  });
});
