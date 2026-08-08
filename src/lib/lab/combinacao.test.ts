/**
 * AS TRAVAS DA COMBINAÇÃO.
 *
 * ⚠️ ESTA FASE MEDE UMA HIPÓTESE MINHA, e isso muda o rigor exigido.
 *
 * Fui eu que propus combinar as verdes, com o argumento de que a correlação de
 * 7% do funding provava que diversificar é a alavanca. Hipótese própria é
 * exatamente onde eu já errei duas vezes: o clima e o filtro de regime, as duas
 * levantadas por mim e derrubadas pela minha própria medição — a segunda
 * INVERTIDA.
 *
 * Então os testes aqui protegem principalmente contra a conclusão que me
 * favorece: que combinar é bom.
 */

import { describe, it, expect } from "vitest";
import {
  alinhar, matrizCorrelacao, correlacaoMedia, estatisticas, carteiraIgual,
  vereditoCombinacao, melhorParte, diaUtc, MIN_DIAS_COMUNS, MIN_FLUXOS,
  type Fluxo,
} from "@/lib/lab/combinacao";

const fluxo = (slug: string, dias: Record<string, number>, custo = 0.4): Fluxo => ({
  slug, nome: slug, motor: "teste",
  porDia: new Map(Object.entries(dias)), idaEVoltaPct: custo,
});

describe("alinhamento por DATA, não por posição", () => {
  /**
   * ⚠️ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA NÃO REPETIR.
   *
   * `meanPairwiseRateCorrelation` corta os N últimos de cada série. Se os
   * fluxos terminam em dias diferentes, isso casa segunda-feira de um com
   * quinta-feira do outro — e devolve um número plausível.
   */
  it("casa os dias iguais mesmo quando as séries terminam diferente", () => {
    const a = fluxo("a", { "2026-01-01": 1, "2026-01-02": 2, "2026-01-03": 3 });
    const b = fluxo("b", { "2026-01-02": 20, "2026-01-03": 30, "2026-01-04": 40 });
    const { dias, matriz } = alinhar([a, b]);
    expect(dias).toEqual(["2026-01-02", "2026-01-03"]);
    expect(matriz[0]).toEqual([2, 3]);
    expect(matriz[1]).toEqual([20, 30]);
  });

  /**
   * Alinhar por posição pegaria [2,3] contra [30,40] — o dia 3 de um contra o
   * dia 4 do outro. Este teste é a diferença entre as duas implementações.
   */
  it("NÃO casa o último com o último quando as datas não batem", () => {
    const a = fluxo("a", { "2026-01-01": 1, "2026-01-02": 2, "2026-01-03": 3 });
    const b = fluxo("b", { "2026-01-02": 20, "2026-01-03": 30, "2026-01-04": 40 });
    const { matriz } = alinhar([a, b]);
    // Se fosse por posição, o último de `a` (3) casaria com o de `b` (40).
    const ultimoA = matriz[0][matriz[0].length - 1];
    const ultimoB = matriz[1][matriz[1].length - 1];
    expect([ultimoA, ultimoB]).toEqual([3, 30]);
  });

  /**
   * Preencher buraco com zero inventa um dia sem renda; com o último valor,
   * inventa persistência. Perder dia é honesto; inventar não é.
   */
  it("dia que falta em UM fluxo sai de TODOS — nada é preenchido", () => {
    const a = fluxo("a", { d1: 1, d2: 2, d3: 3 });
    const b = fluxo("b", { d1: 1, d3: 3 });
    const { dias } = alinhar([a, b]);
    expect(dias).toEqual(["d1", "d3"]);
  });

  it("sem dia em comum devolve vazio, não uma série inventada", () => {
    const a = fluxo("a", { d1: 1 });
    const b = fluxo("b", { d2: 2 });
    expect(alinhar([a, b]).dias).toEqual([]);
  });

  it("o dia UTC sai do carimbo, não do fuso de quem roda", () => {
    expect(diaUtc(Date.UTC(2026, 0, 15, 23, 59))).toBe("2026-01-15");
    expect(diaUtc(Date.UTC(2026, 0, 16, 0, 1))).toBe("2026-01-16");
  });
});

describe("correlação", () => {
  it("a diagonal é 1 e a matriz é simétrica", () => {
    const m = matrizCorrelacao([[1, 2, 3, 4], [2, 4, 6, 8], [4, 3, 2, 1]]);
    expect(m[0][0]).toBe(1);
    expect(m[1][1]).toBe(1);
    expect(m[0][1]).toBeCloseTo(m[1][0], 10);
  });

  it("séries idênticas dão 1; opostas dão −1", () => {
    const m = matrizCorrelacao([[1, 2, 3, 4], [2, 4, 6, 8], [4, 3, 2, 1]]);
    expect(m[0][1]).toBeCloseTo(1, 6);
    expect(m[0][2]).toBeCloseTo(-1, 6);
  });

  /** A diagonal puxaria a média para 1 e esconderia a correlação real. */
  it("a média ignora a diagonal", () => {
    const m = matrizCorrelacao([[1, 2, 3, 4], [4, 3, 2, 1]]);
    expect(correlacaoMedia(m)).toBeCloseTo(-1, 6);
  });
});

describe("estatísticas do fluxo", () => {
  it("fluxo constante tem vol zero e nenhum tombo", () => {
    const e = estatisticas(Array(100).fill(0.01))!;
    expect(e.volAnualPct).toBeCloseTo(0, 10);
    expect(e.tomboPct).toBeCloseTo(0, 10);
    expect(e.diasNegativos).toBe(0);
    expect(e.anualizadoPct).toBeCloseTo(3.65, 6);
  });

  it("o tombo é pico-a-vale da curva acumulada, não o pior dia", () => {
    // Sobe 5, cai 3 em três dias: o pior dia é −2, o tombo é 3.
    const e = estatisticas([5, -1, -1, -1, 2])!;
    expect(e.tomboPct).toBeCloseTo(3, 6);
  });

  it("um dia só não vira estatística", () => {
    expect(estatisticas([1])).toBeNull();
  });
});

describe("a carteira cobra a entrada de CADA fluxo", () => {
  /**
   * ⚠️ A TESE DESTA FASE APANHANDO DA FASE 4. Dividir $1.000 em quatro não paga
   * um custo de entrada, paga quatro. Sem isto a combinação pareceria de graça
   * e a conclusão sairia enviesada a favor da minha própria hipótese.
   */
  it("o custo da carteira é a média dos custos, não o de um fluxo", () => {
    const a = fluxo("a", { d1: 1, d2: 1 }, 0.2);
    const b = fluxo("b", { d1: 1, d2: 1 }, 1.0);
    const { matriz } = alinhar([a, b]);
    expect(carteiraIgual([a, b], matriz).custoEntradaPct).toBeCloseTo(0.6, 6);
  });

  it("a carteira de peso igual é a média dia a dia", () => {
    const a = fluxo("a", { d1: 2, d2: 4 });
    const b = fluxo("b", { d1: 0, d2: 0 });
    const { matriz } = alinhar([a, b]);
    expect(carteiraIgual([a, b], matriz).retornosDiarios).toEqual([1, 2]);
  });

  /** Fluxos anticorrelacionados: a carteira tem vol menor que as duas partes. */
  it("anticorrelação derruba a vol da carteira abaixo das partes", () => {
    const serieA = [2, -2, 2, -2, 2, -2, 2, -2];
    const serieB = [-2, 2, -2, 2, -2, 2, -2, 2];
    const dias = Object.fromEntries(serieA.map((v, i) => [`d${i}`, v]));
    const diasB = Object.fromEntries(serieB.map((v, i) => [`d${i}`, v]));
    const a = fluxo("a", dias), b = fluxo("b", diasB);
    const { matriz } = alinhar([a, b]);
    const { retornosDiarios } = carteiraIgual([a, b], matriz);
    expect(estatisticas(retornosDiarios)!.volAnualPct).toBeCloseTo(0, 6);
    expect(estatisticas(serieA)!.volAnualPct).toBeGreaterThan(1);
  });
});

describe("o veredito compara contra a MELHOR PARTE, não contra a média", () => {
  const carteira = { anualizadoPct: 2.3, volAnualPct: 1, tomboPct: 0.5, diasNegativos: 0.1, dias: 90 };

  it("um fluxo só não é carteira", () => {
    const v = vereditoCombinacao({
      fluxos: 1, diasComuns: 200, carteira, carteiraLiquidaPct: 2,
      melhorParteNome: "x", melhorParteLiquidaPct: 3, melhorParteTomboPct: 1, rhoMedio: 0,
    });
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("não uma carteira");
    expect(MIN_FLUXOS).toBe(2);
  });

  it("interseção curta é INCONCLUSIVO, com o número na frente", () => {
    const v = vereditoCombinacao({
      fluxos: 3, diasComuns: 20, carteira, carteiraLiquidaPct: 2,
      melhorParteNome: "x", melhorParteLiquidaPct: 3, melhorParteTomboPct: 1, rhoMedio: 0,
    });
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain(`piso de ${MIN_DIAS_COMUNS}`);
    expect(v.verdict).toContain("20 dias");
  });

  /**
   * ⚠️ O CASO QUE EU ESPERO, E ELE NÃO PODE VIRAR "VERDE" NEM "MORTA".
   *
   * A média de 3,40% e 1,18% é 2,29% — a carteira rende MENOS que a melhor
   * parte por aritmética, não por descoberta. Se isso saísse verde pelo Sharpe,
   * o painel estaria escondendo que o dono ganharia menos.
   */
  it("render menos com tombo menor é TROCA, não ganho — e não é verde", () => {
    const v = vereditoCombinacao({
      fluxos: 4, diasComuns: 90, carteira, carteiraLiquidaPct: 2.29,
      melhorParteNome: "empréstimo", melhorParteLiquidaPct: 3.40,
      melhorParteTomboPct: 1.2, rhoMedio: 0.1,
    });
    expect(v.status).toBe("cinza");
    expect(v.status).not.toBe("verde");
    expect(v.verdict).toContain("rende MENOS");
    expect(v.verdict).toContain("troca de retorno por sono");
    // E os dois números aparecem, para a escolha ser do dono.
    expect(v.verdict).toContain("2.29%");
    expect(v.verdict).toContain("3.40%");
  });

  it("perder nas duas pontas REPROVA e manda concentrar", () => {
    const v = vereditoCombinacao({
      fluxos: 4, diasComuns: 90,
      carteira: { ...carteira, tomboPct: 2 }, carteiraLiquidaPct: 2.29,
      melhorParteNome: "empréstimo", melhorParteLiquidaPct: 3.40,
      melhorParteTomboPct: 1.2, rhoMedio: 0.9,
    });
    expect(v.status).toBe("morta");
    expect(v.verdict).toContain("concentrar");
  });

  it("render MAIS que a melhor parte é o único caminho para verde", () => {
    const v = vereditoCombinacao({
      fluxos: 4, diasComuns: 90, carteira, carteiraLiquidaPct: 3.9,
      melhorParteNome: "empréstimo", melhorParteLiquidaPct: 3.40,
      melhorParteTomboPct: 1.2, rhoMedio: 0.05,
    });
    expect(v.status).toBe("verde");
    expect(v.verdict).toContain("rende MAIS");
  });

  /** Comparar carteira contra a MÉDIA das partes é tautologia: ela É a média. */
  it("a melhor parte é a de maior líquido, e nula quando não há nenhuma", () => {
    expect(melhorParte([
      { nome: "a", liquidoPct: 1 }, { nome: "b", liquidoPct: 3 }, { nome: "c", liquidoPct: null },
    ])!.nome).toBe("b");
    expect(melhorParte([{ nome: "a", liquidoPct: null }])).toBeNull();
  });
});
