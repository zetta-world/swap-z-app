/**
 * A MEDIANA DO CORTE DE OUTLIER — a conta, e a DIREÇÃO do erro.
 *
 * Ver a nota grande em `arbiter.ts`. O resumo: `s[Math.floor(n / 2)]` não é
 * mediana com `n` par, e aqui isso não mente num relatório — decide onde a mesa
 * compra.
 *
 * Estes testes existem para duas coisas:
 *
 *  1. Fixar que o PADRÃO ainda é a conta antiga. Se alguém trocar sem medir, o
 *     CI avisa. É o oposto do normal — o teste protege o comportamento que eu
 *     já sei estar errado, porque trocá-lo é decisão de dinheiro, não de
 *     aritmética.
 *
 *  2. Provar a DIREÇÃO: a conta errada corta preferencialmente as cotações
 *     baratas, e barata é a ponta onde a mesa compra. Isso é o que torna a
 *     troca um afrouxamento de portão em vez de um conserto neutro.
 */

import { describe, it, expect } from "vitest";
import { dropOutliers, upperMiddle, trueMedian, findArbs } from "@/lib/zion/arbiter";

const q = (pares: Array<[string, number]>) => pares.map(([v, p]) => ({ v, p }));

describe("as duas contas", () => {
  it("com contagem ÍMPAR elas coincidem — por isso o quórum de 3 esconde o defeito", () => {
    const xs = [100, 101, 102];
    expect(upperMiddle(xs)).toBe(trueMedian(xs));
  });

  it("com contagem PAR o de-cima-do-meio fica acima da mediana", () => {
    const xs = [100, 101, 103, 104];
    expect(trueMedian(xs)).toBe(102);
    expect(upperMiddle(xs)).toBe(103);
  });
});

describe("a direção do erro no corte", () => {
  /**
   * Quatro venues. A barata está 2.4% abaixo da mediana verdadeira — dentro da
   * tolerância de 2% contada a partir dela? Não: 2.4 > 2, então a mediana certa
   * também a corta. Preciso de um caso onde a faixa deslocada decide sozinha.
   *
   * Com mediana verdadeira 102 e tolerância 2%, a faixa é [99.96, 104.04].
   * Com o de-cima-do-meio 103, a faixa é [100.94, 105.06].
   *
   * Uma cotação a 100.5 fica DENTRO da faixa certa e FORA da errada.
   */
  const quatro = q([["binance", 100.5], ["okx", 101], ["bybit", 103], ["mexc", 104]]);

  it("a conta antiga corta a cotação BARATA que a correta mantém", () => {
    const antes = dropOutliers(quatro, 2, upperMiddle).map((x) => x.v);
    const depois = dropOutliers(quatro, 2, trueMedian).map((x) => x.v);

    expect(antes).not.toContain("binance");
    expect(depois).toContain("binance");
    // E a devolvida é exatamente a ponta de COMPRA.
    expect(Math.min(...dropOutliers(quatro, 2, trueMedian).map((x) => x.p)))
      .toBeLessThan(Math.min(...dropOutliers(quatro, 2, upperMiddle).map((x) => x.p)));
  });

  it("por isso a troca AUMENTA o spread detectado — afrouxa, não aperta", () => {
    const sp = (qs: Array<{ p: number }>) => {
      const lo = Math.min(...qs.map((x) => x.p)), hi = Math.max(...qs.map((x) => x.p));
      return ((hi - lo) / lo) * 100;
    };
    expect(sp(dropOutliers(quatro, 2, trueMedian)))
      .toBeGreaterThan(sp(dropOutliers(quatro, 2, upperMiddle)));
  });

  it("no caso acima a troca devolve UMA cotação — 3 sobreviventes viram 4", () => {
    expect(dropOutliers(quatro, 2, upperMiddle)).toHaveLength(3);
    expect(dropOutliers(quatro, 2, trueMedian)).toHaveLength(4);
  });

  /**
   * O caso que importa de verdade: com DUAS baratas fora da faixa deslocada, a
   * conta antiga derruba o símbolo inteiro por quórum.
   *
   *   antiga  → de-cima-do-meio 103   → faixa [100.94, 105.06] → sobram 2 ✗
   *   correta → mediana 101.75        → faixa [ 99.72, 103.79] → sobram 3 ✓
   *
   * Aqui a diferença não é o tamanho do spread: é o símbolo existir ou não.
   */
  it("com duas baratas, a conta antiga REPROVA o símbolo por quórum", () => {
    const duasBaratas = q([
      ["binance", 99.8], ["okx", 100.5], ["bybit", 103], ["mexc", 104],
    ]);
    const antes = dropOutliers(duasBaratas, 2, upperMiddle);
    const depois = dropOutliers(duasBaratas, 2, trueMedian);

    expect(antes).toHaveLength(2);
    expect(antes.length).toBeLessThan(3);          // abaixo do quórum → símbolo morre
    expect(depois).toHaveLength(3);                // sobrevive
    expect(depois.map((x) => x.v)).toEqual(["binance", "okx", "bybit"]);
    // E a correta corta a CARA (104), que a antiga mantinha.
    expect(antes.map((x) => x.v)).toContain("mexc");
    expect(depois.map((x) => x.v)).not.toContain("mexc");
  });

  it("com menos de três cotações o corte NÃO roda — não há testemunha", () => {
    const duas = q([["binance", 100], ["okx", 130]]);
    expect(dropOutliers(duas, 2, trueMedian)).toHaveLength(2);
    expect(dropOutliers(duas, 2, upperMiddle)).toHaveLength(2);
  });
});

describe("o padrão de produção", () => {
  it("dropOutliers ainda usa a conta ANTIGA por padrão — trocar exige medir", () => {
    const quatro = q([["binance", 100.5], ["okx", 101], ["bybit", 103], ["mexc", 104]]);
    expect(dropOutliers(quatro, 2).map((x) => x.v))
      .toEqual(dropOutliers(quatro, 2, upperMiddle).map((x) => x.v));
    expect(dropOutliers(quatro, 2).map((x) => x.v)).not.toContain("binance");
  });

  it("findArbs também — o padrão injetado é o de-cima-do-meio", () => {
    // Spread grande o bastante para virar oportunidade nas duas contas, mas com
    // a ponta barata só sobrevivendo na correta.
    const matriz = new Map([["FOO", new Map([
      ["binance", { priceUsd: 100.5 }],
      ["okx", { priceUsd: 101 }],
      ["bybit", { priceUsd: 103 }],
      ["mexc", { priceUsd: 104 }],
    ])]]);

    const padrao = findArbs(matriz, 0.4, 0.15, 100, 2, 3);
    const corrigido = findArbs(matriz, 0.4, 0.15, 100, 2, 3, trueMedian);

    expect(padrao[0].buyPrice).toBe(101);
    expect(corrigido[0].buyPrice).toBe(100.5);
    expect(corrigido[0].spreadPct).toBeGreaterThan(padrao[0].spreadPct);
  });
});
