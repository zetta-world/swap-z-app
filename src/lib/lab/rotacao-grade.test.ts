/**
 * AS TRAVAS DAS DUAS MESAS MECÂNICAS.
 *
 * ⚠️ Cada uma tem UM jeito característico de mentir, e os testes atacam esses:
 *
 *  · ROTAÇÃO mente por LOOKAHEAD — ordenar pelo retorno que já aconteceu e
 *    aplicá-lo ao próprio período faz qualquer ranking parecer genial.
 *  · GRADE mente por OMISSÃO DO ESTOQUE — contar só os degraus fechados e
 *    ignorar o que ficou preso no fundo transforma ruína em renda constante.
 */

import { describe, it, expect } from "vitest";
import {
  rodarRotacao, rodarGrade, vereditoRotacao, vereditoGrade,
  MIN_REBALANCES, MIN_SIMBOLOS_GRADE, perdeuParaOCaixa,
  type PontoRotacao, type ResultadoGrade,
} from "@/lib/lab/rotacao-grade";

/** Helpers em escopo de MÓDULO — já escorreguei duas vezes prendendo em `describe`. */
function serie(precos: number[], inicio = "2026-01-01"): Map<string, number> {
  const m = new Map<string, number>();
  const d0 = new Date(inicio + "T00:00:00Z").getTime();
  precos.forEach((p, i) => m.set(new Date(d0 + i * 86_400_000).toISOString().slice(0, 10), p));
  return m;
}
const rampa = (n: number, taxaDiaria: number, p0 = 100) =>
  Array.from({ length: n }, (_, i) => p0 * (1 + taxaDiaria) ** i);

const ponto = (over: Partial<PontoRotacao> = {}): PontoRotacao =>
  ({ dia: "2026-01-01", escolhidos: ["A"], retornoPct: 1, segurarPct: 0, ...over });
const grade = (over: Partial<ResultadoGrade> = {}): ResultadoGrade => ({
  simbolo: "X", totalPct: 5, realizadoPct: 5, estoquePct: 0,
  fills: 10, rompeu: "nao", segurarPct: 0, ...over,
});

describe("rotação por momento", () => {
  /**
   * ⚠️ A TRAVA CONTRA LOOKAHEAD. Se o retorno passado fosse aplicado ao próprio
   * período, um ativo que subiu forte no período de olhada apareceria ganhando
   * de novo naquele MESMO período. Aqui a série sobe e DEPOIS desaba: uma
   * rotação honesta compra o topo e toma a queda.
   */
  it("o sinal vale para o período SEGUINTE — quem subiu e desabou perde", () => {
    // 120 dias subindo, depois 60 despencando.
    const precos = [...rampa(120, 0.01), ...rampa(60, -0.02, 100 * 1.01 ** 119)];
    const series = new Map([
      ["SOBE_E_CAI", serie(precos)],
      ["PARADO",     serie(precos.map(() => 100))],
      ["SOBE_POUCO", serie(precos.map((_, i) => 100 * 1.001 ** i))],
    ]);
    const pontos = rodarRotacao(series, { olharDias: 30, topoN: 1, rebalanceDias: 30 });
    expect(pontos.length).toBeGreaterThan(2);
    // Em algum rebalanceamento ele escolheu o que subiu e comeu a queda.
    expect(pontos.some((p) => p.escolhidos[0] === "SOBE_E_CAI" && p.retornoPct < 0)).toBe(true);
  });

  /** O calendário é a INTERSEÇÃO: símbolo curto não injeta zero como retorno. */
  it("símbolo com histórico curto não vira retorno zero", () => {
    const series = new Map([
      ["LONGO", serie(rampa(200, 0.001))],
      ["CURTO", serie(rampa(20, 0.001))],
    ]);
    // A interseção é de 20 dias — curta demais para qualquer rebalanceamento.
    expect(rodarRotacao(series, { olharDias: 30, topoN: 1, rebalanceDias: 30 })).toHaveLength(0);
  });

  /**
   * ⚠️ O CUSTO É POR TROCA, NÃO POR REBALANCEAMENTO. Uma carteira que não muda
   * não paga nada — cobrar por evento inventaria custo onde não houve giro.
   */
  it("carteira que não muda não paga custo", () => {
    const series = new Map([
      ["A", serie(rampa(300, 0.002))],   // sempre o melhor
      ["B", serie(rampa(300, 0.0001))],
    ]);
    const comCusto = rodarRotacao(series, { olharDias: 30, topoN: 1, rebalanceDias: 30, custoPct: 5 });
    const semCusto = rodarRotacao(series, { olharDias: 30, topoN: 1, rebalanceDias: 30, custoPct: 0 });
    // Depois do primeiro, ninguém gira: os retornos têm que ser idênticos.
    expect(comCusto.slice(1).map((p) => p.retornoPct))
      .toEqual(semCusto.slice(1).map((p) => p.retornoPct));
  });

  it("cada ponto carrega QUEM foi escolhido — agregado sem parcela não audita", () => {
    const series = new Map([
      ["A", serie(rampa(300, 0.002))], ["B", serie(rampa(300, 0.001))], ["C", serie(rampa(300, 0.0005))],
    ]);
    const pontos = rodarRotacao(series, { olharDias: 30, topoN: 2, rebalanceDias: 30 });
    expect(pontos[0].escolhidos).toHaveLength(2);
  });

  it("amostra abaixo do piso é INCONCLUSIVA, e o piso é em DECISÕES", () => {
    const v = vereditoRotacao([ponto(), ponto()], MIN_REBALANCES);
    expect(v.status).toBe("inconclusiva");
    expect(v.texto).toContain("DECISÕES");
  });

  it("perder de segurar todos MATA a mesa", () => {
    const pontos = Array.from({ length: 10 }, () => ponto({ retornoPct: 1, segurarPct: 3 }));
    const v = vereditoRotacao(pontos);
    expect(v.status).toBe("morta");
    expect(v.texto).toContain("ABAIXO de não escolher nada");
  });

  it("bater segurar todos com LUCRO deixa a mesa verde", () => {
    const pontos = Array.from({ length: 10 }, () => ponto({ retornoPct: 4, segurarPct: 1 }));
    expect(vereditoRotacao(pontos).status).toBe("verde");
  });

  /**
   * ⚠️ A RODADA DE 10/08, virada em teste. A rotação saiu VERDE perdendo 3,01%
   * por período, porque segurar perdeu 5,47%. Pela régua declarada estava
   * certo; para quem lê a tela estava absurdo.
   *
   * Faltava o TERCEIRO competidor: ficar em CAIXA, que sempre está disponível,
   * não custa nada e bateu as duas com folga naquele ano.
   */
  it("bater o índice PERDENDO dinheiro não é verde — o caixa bateu os dois", () => {
    const pontos = Array.from({ length: 9 }, () => ponto({ retornoPct: -3.01, segurarPct: -5.47 }));
    const v = vereditoRotacao(pontos);
    /**
     * ⚠️ ERA `cinza` ATÉ A FASE 10, e esse era o resto do mesmo defeito. O
     * teste acertou em recusar VERDE e não tinha para onde ir: "não medida" foi
     * o menos errado dos três estados que existiam. Resultado — `momentum_
     * rotation` ficou marcada como se ninguém tivesse olhado, tendo perdido
     * 3,01% por período numa medição que rodou.
     */
    expect(v.status).toBe("morta");
    expect(v.texto).toContain("CAIXA");
    // E não pode esconder que ela ganhou do índice — as duas coisas são verdade.
    expect(v.texto).toContain("bateu segurar todos");
  });
});

describe("grade", () => {
  /**
   * ⚠️ A MENTIRA CARACTERÍSTICA DA GRADE: o preço despenca e sai da faixa. Os
   * degraus fechados mostram lucro, e o estoque preso no fundo mostra a ruína.
   * Julgar pelo realizado seria transformar prejuízo em renda constante.
   */
  it("preço que despenca deixa ESTOQUE preso, e o total sabe disso", () => {
    const r = rodarGrade([100, ...rampa(60, -0.03, 100)])!;
    expect(r.rompeu).toBe("abaixo");
    expect(r.totalPct).toBeLessThan(0);
    // O sintoma: o total é MUITO pior que o realizado dos degraus.
    expect(r.totalPct).toBeLessThan(r.realizadoPct);
  });

  /** Mercado que oscila dentro da faixa é onde a grade deveria ganhar. */
  it("oscilação dentro da faixa produz preenchimentos e lucro realizado", () => {
    const onda = Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.12 * Math.sin(i / 6)));
    const r = rodarGrade(onda)!;
    expect(r.fills).toBeGreaterThan(4);
    expect(r.realizadoPct).toBeGreaterThan(0);
  });

  /** Preço parado não preenche nada — e não inventa lucro. */
  it("preço parado não gera preenchimento nem lucro", () => {
    const r = rodarGrade(Array.from({ length: 100 }, () => 100))!;
    expect(r.fills).toBe(0);
    expect(r.totalPct).toBeCloseTo(0, 6);
  });

  /** ⚠️ Custo maior nunca pode MELHORAR o resultado. */
  it("mais custo nunca melhora a grade", () => {
    const onda = Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.12 * Math.sin(i / 6)));
    const barato = rodarGrade(onda, { custoPct: 0 })!;
    const caro   = rodarGrade(onda, { custoPct: 1 })!;
    expect(caro.totalPct).toBeLessThanOrEqual(barato.totalPct);
  });

  /**
   * ⚠️ AS PARCELAS TÊM QUE FECHAR COM O TOTAL — e na rodada de 10/08 não
   * fechavam em nenhuma das dez linhas, porque `estoquePct` era algebricamente
   * o próprio total disfarçado (`estoque − gasto + recebido`). As duas colunas
   * saíam IDÊNTICAS na tela.
   */
  it("realizado + estoque === total, sempre", () => {
    const casos = [
      Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.12 * Math.sin(i / 6))),  // oscila
      [100, ...rampa(60, -0.03, 100)],                                            // despenca
      rampa(200, 0.01),                                                           // só sobe
      Array.from({ length: 100 }, () => 100),                                     // parado
    ];
    for (const closes of casos) {
      const r = rodarGrade(closes)!;
      expect(r.realizadoPct + r.estoquePct).toBeCloseTo(r.totalPct, 3);
    }
  });

  /** E o estoque não pode ser uma cópia do total quando houve venda. */
  it("com degraus fechados, estoque e total são números DIFERENTES", () => {
    const onda = Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.12 * Math.sin(i / 6)));
    const r = rodarGrade(onda)!;
    expect(r.realizadoPct).not.toBe(0);
    expect(r.estoquePct).not.toBeCloseTo(r.totalPct, 6);
  });

  it("série curta ou inválida devolve null em vez de inventar", () => {
    expect(rodarGrade([100])).toBeNull();
    expect(rodarGrade([0, 100])).toBeNull();
  });

  it("amostra abaixo do piso é INCONCLUSIVA", () => {
    expect(vereditoGrade([grade(), grade()], MIN_SIMBOLOS_GRADE).status).toBe("inconclusiva");
  });

  /**
   * ⚠️ O TESTE QUE IMPORTA: realizado bonito, total ruim. É a forma exata em
   * que a grade é vendida, e o veredito tem que julgar pelo TOTAL.
   */
  it("degraus lucrativos com estoque afundado MATAM a mesa", () => {
    const rs = Array.from({ length: 5 }, () => grade({
      realizadoPct: 8, estoquePct: -40, totalPct: -32, segurarPct: -20, rompeu: "abaixo",
    }));
    const v = vereditoGrade(rs);
    expect(v.status).toBe("morta");
    expect(v.texto).toContain("não cobre o estoque preso");
  });

  it("bater segurar com LUCRO deixa verde", () => {
    const rs = Array.from({ length: 5 }, () => grade({ totalPct: 12, realizadoPct: 12, segurarPct: 3 }));
    expect(vereditoGrade(rs).status).toBe("verde");
  });

  /**
   * ⚠️ O CASO MAIS ABSURDO DA RODADA DE 10/08: a grade saiu VERDE tendo
   * perdido 54,11% do capital, porque segurar perdeu 64,55%.
   */
  it("perder metade do capital não é verde, por mais que o índice caia mais", () => {
    const rs = Array.from({ length: 10 }, () => grade({
      totalPct: -54.11, realizadoPct: 1.48, estoquePct: -55.59, segurarPct: -64.55, rompeu: "abaixo",
    }));
    const v = vereditoGrade(rs);
    /** ⚠️ Idem: perder metade do capital é MORTA, não "não medida". */
    expect(v.status).toBe("morta");
    expect(v.texto).toContain("CAIXA");
    expect(v.texto).toContain("PERDEU");
  });

  /** A regra do caixa é uma só, e vale para as duas mesas. */
  it("o teste do caixa é o mesmo para as duas mesas", () => {
    expect(perdeuParaOCaixa(-0.01)).toBe(true);
    expect(perdeuParaOCaixa(0)).toBe(true);
    expect(perdeuParaOCaixa(0.01)).toBe(false);
  });
});
