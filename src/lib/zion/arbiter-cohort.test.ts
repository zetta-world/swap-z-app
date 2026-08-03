import { describe, it, expect } from "vitest";
import {
  flagNeverLoses, flagGateTruncated, flagVenueDominance, flagTailUnsampled,
  flagLeverageIsDenominator, auditCohort, cohortReadable, realismBySymbol,
  type CohortDesk, type Leg,
} from "@/lib/zion/arbiter-cohort";

/**
 * "O ARBITER COM MULTIPLICADOR ESTÁ INDO BEM MESMO OU É SÓ ILUSÃO?"
 *
 * O ledger de 03/08 dizia: 661 ciclos, ZERO perdas, +34% em 13 dias no 1×.
 * Nenhuma estratégia real ganha sempre — o que ganha sempre é um modelo sem
 * caminho de perda. Estas verificações são as que separam as duas coisas, e
 * existem para que a próxima mesa boa demais para ser verdade seja pega no dia,
 * e não depois de virar decisão de dinheiro real.
 */

const desk = (over: Partial<CohortDesk> = {}): CohortDesk => ({
  source: "arbiter2", label: "JÖRMUNGANDR", leverage: 1, startingUsd: 300,
  cycles: 100, losses: 0, realizedUsd: 17, avgPnlUsd: 0.17,
  marginPerCycleUsd: 100, hoursLive: 312, ...over,
});

const legs = (pares: Array<[string, string, number]>): Leg[] =>
  pares.flatMap(([b, s, n]) => Array.from({ length: n }, () => ({ buyVenue: b, sellVenue: s })));

describe("nunca perder — o sinal mais forte de que não dá para perder", () => {
  it("acusa amostra grande sem UMA perda", () => {
    // Com acerto verdadeiro de 95%, 200 seguidas sem perda tem chance de
    // ~0.003%. Ver isso é ver um caminho de perda que não existe no código.
    const f = flagNeverLoses(200, 0)!;
    expect(f.level).toBe("fatal");
  });

  it("NÃO acusa amostra pequena — 10 seguidas acontece por acaso", () => {
    // Alarme falso treina o operador a ignorar o alarme verdadeiro.
    expect(flagNeverLoses(10, 0)).toBeNull();
  });

  it("uma perda basta para o caminho existir", () => {
    expect(flagNeverLoses(500, 1)).toBeNull();
  });
});

describe("o portão cortando a distribuição", () => {
  it("acusa quando o menor spread encosta no gatilho de entrada", () => {
    // Medido: menor spread 0.6001% contra portão de 0.60% (custo 0.45 +
    // líquido mínimo 0.15). A mesa vê só a cauda que passou do gatilho.
    const f = flagGateTruncated(0.6001, 0.6, 600)!;
    expect(f.level).toBe("fatal");
    expect(f.finding).toContain("0.6001");
  });

  it("não acusa quando existe folga real acima do gatilho", () => {
    // Oportunidade de verdade às vezes aparece bem acima do mínimo, e a mesa
    // passa períodos sem achar nada.
    expect(flagGateTruncated(1.4, 0.6, 600)).toBeNull();
  });

  it("sem amostra não acusa", () => {
    expect(flagGateTruncated(0.6001, 0.6, 5)).toBeNull();
  });
});

describe("a venue dos dois lados", () => {
  it("acusa quando a mesma venue compra E vende em proporção parecida", () => {
    // Medido: gateio em ~90% das pernas, nos dois sentidos. Venue barata
    // apareceria só na compra; nos dois lados é preço oscilando.
    const f = flagVenueDominance(legs([
      ["binance", "gateio", 136], ["gateio", "binance", 102],
      ["mexc", "gateio", 110], ["gateio", "mexc", 91],
    ]))!;
    expect(f.level).toBe("fatal");
    expect(f.title).toContain("gateio");
  });

  it("concentração de UM lado só é aviso, não veredito", () => {
    // Pode ser praça genuinamente mais barata. Merece checagem, não condenação.
    const f = flagVenueDominance(legs([["barata", "binance", 90], ["mexc", "okx", 10]]))!;
    expect(f.level).toBe("aviso");
  });

  it("pernas espalhadas não acusam nada", () => {
    expect(flagVenueDominance(legs([
      ["a", "b", 25], ["b", "c", 25], ["c", "d", 25], ["d", "a", 25],
    ]))).toBeNull();
  });
});

describe("a cauda que a alavanca cria e a amostra não viu", () => {
  it("acusa gêmeo alavancado com horas de vida", () => {
    // Medido: 7,5 horas, zero liquidações. Liquidação a 5× exige movimento
    // adverso de ~20%, que acontece algumas vezes por ANO.
    const f = flagTailUnsampled(5, 7.5, 0)!;
    expect(f.level).toBe("fatal");
    expect(f.finding).toContain("7.5 horas");
  });

  it("o 1× não tem esse risco em grau nenhum — não é versão menor, é outra coisa", () => {
    expect(flagTailUnsampled(1, 7.5, 0)).toBeNull();
  });

  it("liquidação observada já é amostra do risco", () => {
    expect(flagTailUnsampled(5, 7.5, 1)).toBeNull();
  });

  it("janela longa o bastante deixa de acusar", () => {
    expect(flagTailUnsampled(5, 120 * 24, 0)).toBeNull();
  });
});

describe("a alavanca encolhe o denominador, não aumenta o ganho", () => {
  it("reconhece lucro por ciclo IGUAL em dólar entre alavancagens", () => {
    // Medido: $0.167 (1×), $0.202 (3×), $0.203 (5×). A perna é de $50 nos três.
    const f = flagLeverageIsDenominator([
      desk({ leverage: 1, avgPnlUsd: 0.167 }),
      desk({ leverage: 3, avgPnlUsd: 0.202, marginPerCycleUsd: 66.67 }),
      desk({ leverage: 5, avgPnlUsd: 0.203, marginPerCycleUsd: 60 }),
    ])!;
    expect(f.level).toBe("ok");
    expect(f.meaning).toContain("mesmo");
  });

  it("se o ganho por ciclo DIFERE de verdade, não afirma a equivalência", () => {
    // Aí há algo além da divisão acontecendo, e dizer "é só denominador"
    // esconderia justamente a diferença que importa investigar.
    expect(flagLeverageIsDenominator([
      desk({ leverage: 1, avgPnlUsd: 0.10 }),
      desk({ leverage: 5, avgPnlUsd: 0.90 }),
    ])).toBeNull();
  });

  it("mesa sem amostra não entra na comparação", () => {
    expect(flagLeverageIsDenominator([
      desk({ leverage: 1, avgPnlUsd: 0.17 }), desk({ leverage: 5, cycles: 3, avgPnlUsd: 0.17 }),
    ])).toBeNull();
  });
});

describe("o veredito da coorte", () => {
  const coorte = [
    desk({ source: "arbiter2", leverage: 1, cycles: 613, avgPnlUsd: 0.167 }),
    desk({ source: "arbiter2_3x", leverage: 3, cycles: 31, avgPnlUsd: 0.202, hoursLive: 7.5 }),
    desk({ source: "arbiter2_5x", leverage: 5, cycles: 15, avgPnlUsd: 0.203, hoursLive: 7.5 }),
  ];
  const pernas = legs([["binance", "gateio", 136], ["gateio", "binance", 102], ["mexc", "gateio", 110]]);

  it("a coorte real de 03/08 NÃO é legível como desempenho", () => {
    const flags = auditCohort(coorte, pernas, 0.6001, 0.6, 0);
    expect(cohortReadable(flags)).toBe(false);
    expect(flags.filter((f) => f.level === "fatal").length).toBeGreaterThanOrEqual(3);
  });

  it("as marcas saem em ordem — fatal antes de aviso antes de ok", () => {
    const flags = auditCohort(coorte, pernas, 0.6001, 0.6, 0);
    const níveis = flags.map((f) => f.level);
    expect(níveis).toEqual([...níveis].sort((a, b) =>
      ({ fatal: 0, aviso: 1, ok: 2 })[a] - ({ fatal: 0, aviso: 1, ok: 2 })[b]));
  });

  it("coorte saudável passa — a verificação não reprova por reprovar", () => {
    // Sem isto, o módulo seria um carimbo de "não confie" que ninguém lê.
    const sã = [
      desk({ leverage: 1, cycles: 400, losses: 120, hoursLive: 200 * 24 }),
      desk({ leverage: 3, cycles: 380, losses: 110, hoursLive: 200 * 24, avgPnlUsd: 0.17 }),
    ];
    const flags = auditCohort(sã, legs([["a", "b", 20], ["b", "a", 20], ["c", "d", 20], ["d", "c", 20]]), 1.4, 0.6, 2);
    expect(cohortReadable(flags)).toBe(true);
  });
});

/**
 * AS 17 SOBREVIVENTES — e o que elas eram de verdade.
 *
 * Das 4.085 medições de orderbook, 17 deram líquido real positivo. Fui olhar
 * quais: TODAS eram GRT, e dezesseis estavam entre +0.016% e +0.021% — zero
 * dentro do arredondamento, menos de um centavo num ciclo de $50. Só UMA
 * passaria do mínimo de 0.15% que a mesa exige.
 *
 * "Positiva" e "operável" não são a mesma coisa, e contar as 17 como
 * sobreviventes repetiria, dentro da verificação, exatamente o otimismo que ela
 * existe para pegar.
 *
 * O achado maior está na comparação entre símbolos:
 *
 *   GRT    145 medições ·  17 positivas · slippage 0.379%
 *   MANA 2.122 medições ·   0 positivas · slippage 1.255%
 *
 * MANA era o símbolo MAIS operado (298 ciclos) e é o de pior profundidade;
 * GRT é o único com sobrevivência e é o de melhor. A seleção da mesa era
 * ANTI-CORRELACIONADA com a viabilidade: ela buscava o maior spread aparente,
 * e spread aparente grande é sintoma de livro FINO — é o livro fino que produz
 * a cotação descolada. Era um detector de iliquidez chamado de arbitragem.
 */
describe("as 17 sobreviventes, olhadas de perto", () => {
  const m = (symbol: string, realisticNet: number, slippage: number) => ({ symbol, realisticNet, slippage });

  it("separa POSITIVA de OPERÁVEL — 16 das 17 não passariam do mínimo", () => {
    const rows = [
      m("GRT", 0.189, 0.511),                                  // a única de verdade
      ...Array.from({ length: 16 }, () => m("GRT", 0.019, 0.14)), // zero com enfeite
    ];
    const [grt] = realismBySymbol(rows, 0.15);
    expect(grt.positive).toBe(17);
    expect(grt.passesGate).toBe(1);
  });

  it("ordena pela PROFUNDIDADE, não pelo volume", () => {
    // Ordenar por amostra repetiria na tela o mesmo viés que a mesa tinha na
    // seleção: MANA apareceria primeiro por ser a mais operada, quando é
    // justamente a pior.
    const rows = [
      ...Array.from({ length: 2122 }, () => m("MANA", -0.705, 1.255)),
      ...Array.from({ length: 145 }, () => m("GRT", -0.163, 0.379)),
    ];
    expect(realismBySymbol(rows, 0.15)[0].symbol).toBe("GRT");
  });

  it("o símbolo mais operado é o de pior livro e ZERO positivas", () => {
    // O diagnóstico só aparece com as duas colunas lado a lado. Separadas,
    // "MANA foi a mais operada" e "MANA tem o pior livro" são dois fatos soltos.
    const rows = [
      ...Array.from({ length: 100 }, () => m("MANA", -0.705, 1.255)),
      ...Array.from({ length: 10 }, () => m("GRT", 0.02, 0.379)),
    ];
    const porSimbolo = realismBySymbol(rows, 0.15);
    const mana = porSimbolo.find((s) => s.symbol === "MANA")!;
    expect(mana.positive).toBe(0);
    expect(mana.avgSlippagePct).toBeGreaterThan(porSimbolo[0].avgSlippagePct);
  });

  it("medição inválida não entra na conta", () => {
    expect(realismBySymbol([m("X", NaN, 1)], 0.15)).toEqual([]);
  });

  it("sem amostra devolve lista vazia, não linha zerada", () => {
    // Linha com zeros na tela seria lida como "medimos e deu zero".
    expect(realismBySymbol([], 0.15)).toEqual([]);
  });
});
