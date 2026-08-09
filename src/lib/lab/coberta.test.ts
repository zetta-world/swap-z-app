/**
 * AS TRAVAS DA CALL COBERTA.
 *
 * ⚠️ ESTA FASE NÃO É MEDIÇÃO, É SIMULAÇÃO — e a diferença precisa de teste.
 *
 * A 5.1 mediu o prêmio de variância com dado real. Aqui o prêmio é de
 * Black-Scholes: DVOL é índice, não livro, e não há histórico gratuito de preço
 * de opção. O que é MEDIDO é o retorno do BTC (velas reais) e "quantas vezes ele
 * passou do teto" — que é o lado da conta que mais decide.
 */

import { describe, it, expect } from "vitest";
import {
  normalCdf, precoCall, janelaCoberta, resumirCoberta, vereditoCoberta,
  STRIKES, MARGEM_MINIMA_PCT,
} from "@/lib/lab/coberta";

describe("a normal acumulada", () => {
  it("vale 0,5 no zero e é simétrica", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 6);
  });

  it("bate os valores de tabela", () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.645)).toBeCloseTo(0.05, 3);
  });
});

describe("o preço da call — de MODELO, e a conta confere", () => {
  /** No dinheiro, 30 dias, vol 50%: ~5,7% do spot. Confere na mão. */
  it("call no dinheiro com vol 50% e 30 dias custa ~5,7% do spot", () => {
    const p = precoCall(100, 100, 0.5, 30 / 365);
    expect(p).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(0.065);
  });

  it("strike mais alto custa menos — sempre", () => {
    const a = precoCall(100, 100, 0.5, 30 / 365);
    const b = precoCall(100, 110, 0.5, 30 / 365);
    const c = precoCall(100, 120, 0.5, 30 / 365);
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThan(b);
  });

  it("mais volatilidade custa mais", () => {
    expect(precoCall(100, 110, 0.8, 30 / 365))
      .toBeGreaterThan(precoCall(100, 110, 0.3, 30 / 365));
  });

  /** Entrada inválida devolve zero, não NaN — NaN viraria "—" e passaria por
   *  "sem prêmio", que é o oposto de "não sei calcular". */
  it("entrada inválida vira zero, nunca NaN", () => {
    for (const p of [precoCall(0, 100, 0.5, 0.1), precoCall(100, 0, 0.5, 0.1),
                     precoCall(100, 100, 0, 0.1), precoCall(100, 100, 0.5, 0)]) {
      expect(p).toBe(0);
      expect(Number.isFinite(p)).toBe(true);
    }
  });
});

describe("a conta da coberta é a DEFINIÇÃO, não uma aproximação", () => {
  /**
   * ⚠️ MEDIR SÓ O PRÊMIO SERIA MEDIR UMA CALL DESCOBERTA E CHAMAR DE COBERTA —
   * o erro que o Mapa do Lucro convidava ao falar em "prêmio mais gordo".
   */
  it("moeda abaixo do teto: fica com a moeda E com o prêmio", () => {
    const j = janelaCoberta("d", 100, 103, 0.5, 1.1, 30 / 365);
    expect(j.exercida).toBe(false);
    expect(j.segurarPct).toBeCloseTo(3, 6);
    expect(j.cobertaPct).toBeCloseTo(3 + j.premioPct, 4);
    // E a coberta GANHA de segurar, nesse caso.
    expect(j.cobertaPct).toBeGreaterThan(j.segurarPct);
  });

  it("moeda acima do teto: o ganho para no teto, o prêmio continua seu", () => {
    const j = janelaCoberta("d", 100, 140, 0.5, 1.1, 30 / 365);
    expect(j.exercida).toBe(true);
    expect(j.segurarPct).toBeCloseTo(40, 6);
    // Travou em +10, não em +40.
    expect(j.cobertaPct).toBeCloseTo(10 + j.premioPct, 4);
    // ⚠️ E PERDE FEIO de segurar — é aqui que a conta se decide.
    expect(j.segurarPct - j.cobertaPct).toBeGreaterThan(20);
  });

  it("moeda em queda: o prêmio amortece, mas não protege", () => {
    const j = janelaCoberta("d", 100, 70, 0.5, 1.1, 30 / 365);
    expect(j.cobertaPct).toBeLessThan(0);
    // Melhor que segurar pelo prêmio, e só.
    expect(j.cobertaPct - j.segurarPct).toBeCloseTo(j.premioPct, 4);
  });

  it("os strikes são DECLARADOS, e o do dinheiro está entre eles", () => {
    expect(STRIKES).toContain(1.0);
    expect([...STRIKES].every((s) => s >= 1)).toBe(true);
  });
});

describe("o veredito — a maioria das janelas diz uma coisa e a média diz outra", () => {
  /**
   * ⚠️ O FORMATO REAL DA ESTRATÉGIA, e o motivo desta fase existir.
   *
   * Dezenove janelas de alta modesta (a coberta ganha o prêmio) e uma de alta
   * violenta (o teto morde). A coberta "ganha em 95% das vezes" e PERDE na
   * média. Um painel que mostrasse só a taxa de acerto venderia a estratégia
   * com um número verdadeiro e enganoso.
   */
  const janelas = [
    ...Array.from({ length: 19 }, (_, i) => janelaCoberta(`d${i}`, 100, 102, 0.5, 1.1, 30 / 365)),
    janelaCoberta("boom", 100, 180, 0.5, 1.1, 30 / 365),
  ];

  it("ganha na maioria e perde na média — e o veredito diz os dois", () => {
    const r = resumirCoberta(janelas, 1.1)!;
    expect(r.fracaoGanhou).toBeGreaterThan(0.9);
    expect(r.vantagemPct).toBeLessThan(0);

    const v = vereditoCoberta([r]);
    expect(v.status).toBe("morta");
    expect(v.verdict).toContain("custa MAIS que o prêmio");
    expect(v.verdict).toContain("ganhou em 95%");
    expect(v.verdict).toContain("SIMULAÇÃO");
  });

  /**
   * ⚠️ MARGEM MÍNIMA POR CAUSA DO MODELO. O sorriso subestima o prêmio e a
   * cauda subestima o risco, para lados opostos. Aprovar por 0,2 ponto seria
   * afirmar precisão que a simulação não tem.
   */
  it("vantagem menor que a margem é INCONCLUSIVO, não aprovado", () => {
    const r = {
      strikeFrac: 1.1, n: 200, cobertaMediaPct: 2.4, segurarMediaPct: 2.0,
      vantagemPct: 0.4, cobertaMedianaPct: 3, segurarMedianaPct: 1,
      fracaoGanhou: 0.8, fracaoExercida: 0.15, premioMedioPct: 3,
      piorCobertaPct: -20, piorSegurarPct: -25,
    };
    const v = vereditoCoberta([r]);
    expect(v.status).toBe("cinza");
    expect(v.readable).toBe(false);
    expect(v.verdict).toContain(`margem de ${MARGEM_MINIMA_PCT}`);
    expect(v.verdict).toContain("lados opostos");
  });

  it("vantagem acima da margem aprova — declarando que é simulação", () => {
    const r = {
      strikeFrac: 1.1, n: 200, cobertaMediaPct: 4.5, segurarMediaPct: 2.0,
      vantagemPct: 2.5, cobertaMedianaPct: 4, segurarMedianaPct: 1,
      fracaoGanhou: 0.8, fracaoExercida: 0.15, premioMedioPct: 3,
      piorCobertaPct: -20, piorSegurarPct: -25,
    };
    const v = vereditoCoberta([r]);
    expect(v.status).toBe("verde");
    expect(v.verdict).toContain("SIMULAÇÃO");
    expect(v.verdict).toContain("custo de execução continua fora");
  });

  it("escolhe o MELHOR teto, e diz qual foi", () => {
    const base = {
      n: 100, cobertaMedianaPct: 1, segurarMedianaPct: 1, fracaoGanhou: 0.5,
      fracaoExercida: 0.2, premioMedioPct: 3, piorCobertaPct: -10, piorSegurarPct: -10,
      cobertaMediaPct: 1, segurarMediaPct: 1,
    };
    const v = vereditoCoberta([
      { ...base, strikeFrac: 1.0, vantagemPct: -2 },
      { ...base, strikeFrac: 1.2, vantagemPct: 3 },
      { ...base, strikeFrac: 1.05, vantagemPct: 1.5 },
    ]);
    expect(v.verdict).toContain("+20%");
    expect(v.status).toBe("verde");
  });

  it("sem janela nenhuma é inconclusivo, nunca reprovado", () => {
    expect(vereditoCoberta([]).status).toBe("cinza");
    expect(resumirCoberta([], 1.1)).toBeNull();
  });
});
