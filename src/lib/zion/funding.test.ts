/**
 * A conta do funding, com as armadilhas que ela precisa não cair.
 *
 * Ver o cabeçalho de `funding.ts`. O resumo: é a única variante de arbitragem
 * da família que não depende de velocidade, e por isso a única que sobrou
 * depois de a spot-spot ser reprovada. Mas "não depende de velocidade" não é o
 * mesmo que "paga" — é isto que estes testes protegem.
 */

import { describe, it, expect } from "vitest";
import { fundingStats, fundingVerdict, PERIODS_PER_DAY } from "@/lib/zion/funding";

/** `n` períodos com a taxa dada, em % por 8h. */
const serie = (n: number, ratePct: number | ((i: number) => number)) =>
  Array.from({ length: n }, (_, i) => ({
    t: 1_700_000_000_000 + i * 28_800_000,
    ratePct: typeof ratePct === "function" ? ratePct(i) : ratePct,
  }));

describe("fundingStats", () => {
  it("amostra curta devolve null — não vira número pequeno", () => {
    expect(fundingStats("BTC", serie(5, 0.01))).toBeNull();
  });

  it("o funding típico de 0.01%/8h dá ~10.95% ao ano", () => {
    const s = fundingStats("BTC", serie(300, 0.01))!;
    expect(s.annualizedPct).toBeCloseTo(0.01 * PERIODS_PER_DAY * 365, 6);
    expect(s.annualizedPct).toBeCloseTo(10.95, 2);
  });

  /**
   * O NÚMERO QUE DECIDE. Anualizado bonito não paga corretagem: numa janela
   * curta, as 4 pernas comem o funding inteiro e sobra prejuízo.
   */
  it("janela curta: o anualizado é positivo mas o LÍQUIDO é negativo", () => {
    // 30 períodos = 10 dias a 0.01% → 0.30% bruto contra 0.45% de custo.
    const s = fundingStats("BTC", serie(30, 0.01), 0.45)!;
    expect(s.annualizedPct).toBeGreaterThan(10);
    expect(s.grossPct).toBeCloseTo(0.30, 6);
    expect(s.netPct).toBeCloseTo(-0.15, 6);
    expect(s.netPct).toBeLessThan(0);
  });

  it("o ponto de equilíbrio diz quantos dias só para pagar as pernas", () => {
    const s = fundingStats("BTC", serie(300, 0.01), 0.45)!;
    // 0.45% ÷ (0.01% × 3 por dia) = 15 dias.
    expect(s.breakEvenDays).toBeCloseTo(15, 6);
  });

  it("sem funding médio positivo NÃO existe equilíbrio — null, não um número enorme", () => {
    const s = fundingStats("BTC", serie(300, -0.005), 0.45)!;
    expect(s.breakEvenDays).toBeNull();
    expect(s.netPct).toBeLessThan(0);
  });

  it("bruto é SOMA, não composição — o menor dos dois quando há dúvida", () => {
    const s = fundingStats("BTC", serie(100, 0.01))!;
    expect(s.grossPct).toBeCloseTo(1.0, 6);       // 100 × 0.01, simples
    expect(s.grossPct).toBeLessThan(((1.0001 ** 100) - 1) * 100 + 1e-9);
  });

  it("mede a fração de períodos NEGATIVOS — é o que separa estrutura de regime", () => {
    // Um em cada quatro períodos negativo.
    const s = fundingStats("BTC", serie(400, (i) => (i % 4 === 0 ? -0.02 : 0.01)))!;
    expect(s.negativeShare).toBeCloseTo(0.25, 6);
  });

  /**
   * O TOMBO É O QUE FAZ ALGUÉM FECHAR NA HORA ERRADA. Uma média positiva pode
   * esconder semanas de sangria, e a média não é o que a pessoa vive.
   */
  it("a média positiva não esconde a sangria: tombo e sequência aparecem", () => {
    // 100 períodos bons, depois 60 ruins, depois 140 bons.
    const s = fundingStats("BTC", serie(300, (i) => (i >= 100 && i < 160 ? -0.03 : 0.02)))!;
    expect(s.meanPct).toBeGreaterThan(0);          // no agregado, positivo
    expect(s.maxDrawdownPct).toBeCloseTo(60 * 0.03, 6);   // e ainda assim −1.8%
    expect(s.worstNegativeStreak).toBe(60);
  });

  it("a mediana por período separa renda constante de um pico de mania", () => {
    // 299 períodos a zero e um único a 30% — a média mente, a mediana não.
    const s = fundingStats("BTC", serie(300, (i) => (i === 150 ? 30 : 0)))!;
    expect(s.meanPct).toBeCloseTo(0.1, 6);
    expect(s.medianPct).toBe(0);
  });
});

describe("fundingVerdict", () => {
  const bom = (sym: string) => fundingStats(sym, serie(600, 0.012), 0.45)!;      // 200 dias
  const curto = (sym: string) => fundingStats(sym, serie(60, 0.012), 0.45)!;     // 20 dias
  const regime = (sym: string) =>
    fundingStats(sym, serie(600, (i) => (i % 2 === 0 ? -0.02 : 0.05)), 0.45)!;   // 50% negativo

  it("amostra curta é INCONCLUSIVO, nunca aprovado", () => {
    const v = fundingVerdict([curto("BTC"), curto("ETH")], 60);
    expect(v.readable).toBe(false);
    expect(v.verdict).toContain("inconclusivo");
    expect(v.verdict).not.toContain("pagaram");
  });

  it("positivo com metade dos períodos negativos é RENDA DE REGIME, não aprovação", () => {
    const v = fundingVerdict([regime("BTC"), regime("ETH")], 60, 0.35);
    // O líquido é positivo…
    expect(regime("BTC").netPct).toBeGreaterThan(0);
    // …e mesmo assim o veredito recusa chamar de estrutura.
    expect(v.verdict).toContain("regime");
    expect(v.verdict).not.toContain("pagaram as 4 pernas COM");
  });

  it("aprova só quando paga as pernas E o negativo é raro", () => {
    const v = fundingVerdict([bom("BTC"), bom("ETH"), bom("SOL")], 60, 0.35);
    expect(v.readable).toBe(true);
    expect(v.verdict).toContain("pagaram as 4 pernas");
    // E ainda assim lembra que o anualizado não é a medida.
    expect(v.verdict).toContain("anualizado NÃO é a medida");
  });

  it("nenhum positivo: diz isso com a mediana, sem rodeio", () => {
    const ruim = fundingStats("BTC", serie(600, 0.0001), 0.45)!;
    const v = fundingVerdict([ruim], 60);
    expect(v.verdict).toContain("nenhum dos");
    expect(v.positivos).toBe(0);
  });
});
