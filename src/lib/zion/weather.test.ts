import { describe, it, expect } from "vitest";
import {
  breadth, weatherFromBreadth, weatherFromSeries, shouldTrade, weatherNote,
  BREADTH_GOOD, BREADTH_BAD,
} from "@/lib/zion/weather";

/**
 * O FILTRO DE REGIME — e o que os dados realmente sustentam.
 *
 * A mesma biblioteca, as mesmas travas, três janelas de 174 dias:
 *
 *   hoje         mercado −18.49%   biblioteca −0.619%/trade   0 positivos (n≥30)
 *   180d atrás   mercado −56.50%   biblioteca −0.505%/trade   1 positivo
 *   360d atrás   mercado  −2.76%   biblioteca −0.132%/trade   3 positivos
 *
 * A janela neutra foi cinco vezes melhor que a pior. E `trend_continuation` foi
 * a PIOR estratégia numa (−0.81%) e a MELHOR na outra (+0.16%, n=103) — não é
 * ruído, é uma estratégia de tendência precisando de tendência.
 *
 * ⚠️ O QUE ESTES TESTES NÃO AFIRMAM: que os limiares estão calibrados. Três
 * janelas não calibram nada, e a relação nem é monotônica — o mercado de −56%
 * rendeu MELHOR que o de −18%. Os limiares são palpite declarado, como a coluna
 * `priority` era, e o `byWeather` do backtest existe para substituí-los.
 */

describe("amplitude — quantos símbolos estão a favor", () => {
  it("mede a fração, não o BTC sozinho", () => {
    // Na janela de 12 meses o BTC subiu 20% enquanto OP caía 33%. Uma
    // referência única teria chamado aquele mercado de favorável para TODOS.
    expect(breadth([true, true, false, false])).toBe(0.5);
  });

  it("sem símbolo nenhum devolve null, não zero", () => {
    // Zero seria lido como "ninguém está em alta" — um veredito. Null é a
    // ausência de leitura, e ela leva a "misto", não a "adverso".
    expect(breadth([])).toBeNull();
  });
});

describe("o clima, em três estados", () => {
  it("amplitude alta é mar a favor", () => {
    expect(weatherFromBreadth(BREADTH_GOOD + 0.01)).toBe("favoravel");
  });

  it("amplitude baixa é mar contra", () => {
    expect(weatherFromBreadth(BREADTH_BAD - 0.01)).toBe("adverso");
  });

  it("o meio é MISTO — e misto OPERA", () => {
    // Foi no terreno misto que os três positivos apareceram. Barrar o misto
    // calaria a mesa quase sempre: cripto raramente tem 55% dos majors em alta
    // ao mesmo tempo.
    const meio = (BREADTH_GOOD + BREADTH_BAD) / 2;
    expect(weatherFromBreadth(meio)).toBe("misto");
    expect(shouldTrade("misto")).toBe(true);
  });

  it("SEM leitura é misto — ausência não vira permissão nem veto", () => {
    // Chamar de adverso calaria a mesa por falta de medição; chamar de
    // favorável liberaria pelo mesmo motivo. As duas seriam decisões tomadas
    // por um buraco no dado.
    expect(weatherFromBreadth(null)).toBe("misto");
  });

  it("só o mar CONTRA para a mesa", () => {
    expect(shouldTrade("favoravel")).toBe(true);
    expect(shouldTrade("adverso")).toBe(false);
  });
});

describe("o clima a partir de uma série de referência", () => {
  const serie = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

  it("acima da média E a média subindo = favorável", () => {
    expect(weatherFromSeries(serie(120, (i) => 100 + i))).toBe("favoravel");
  });

  it("abaixo da média E a média caindo = adverso", () => {
    expect(weatherFromSeries(serie(120, (i) => 200 - i))).toBe("adverso");
  });

  it("preço acima de uma média que DESABA não é alta — é topo de queda", () => {
    // A inclinação importa tanto quanto o nível. Sem ela, um repique dentro de
    // uma tendência de baixa passaria por mar a favor, que é exatamente o
    // momento em que uma mesa long-only mais se machuca.
    const queda = serie(110, (i) => 200 - i * 1.5);
    const repique = [...queda, ...serie(6, (i) => queda[queda.length - 1] + i * 8)];
    expect(weatherFromSeries(repique)).not.toBe("favoravel");
  });

  it("série curta demais é MISTO, não um chute", () => {
    expect(weatherFromSeries([100, 101, 102])).toBe("misto");
  });
});

describe("a nota que vai para o log e para a tela", () => {
  it("no mar contra, diz POR QUE a mesa ficou de fora", () => {
    // Uma mesa que para sem dizer o motivo é indistinguível de uma mesa
    // quebrada — foi assim que o vazamento de caixa passou três semanas.
    const n = weatherNote("adverso", 0.2);
    expect(n).toContain("20%");
    expect(n).toContain("nenhum playbook ficou positivo");
  });

  it("sem amplitude, diz que não mediu", () => {
    expect(weatherNote("misto", null)).toContain("sem amplitude");
  });
});
