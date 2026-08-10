/**
 * AS TRAVAS DA MESA DE LIQUIDEZ.
 *
 * ⚠️ A perda impermanente é o lugar onde esta família engana: o APR da taxa
 * está publicado em toda interface, e a metade que falta não está. Estes testes
 * protegem a metade que falta — e, principalmente, o SINAL dela.
 */

import { describe, it, expect } from "vitest";
import {
  perdaImpermanente, janelaPiscina, resumirLiquidez, vereditoLiquidez,
  ALVOS, MIN_PISCINAS, MARGEM_MINIMA_PCT, type AlvoPiscina, type JanelaPiscina,
} from "@/lib/lab/liquidez";

/** Helpers em escopo de MÓDULO — já escorreguei duas vezes prendendo em `describe`. */
const alvo = (over: Partial<AlvoPiscina> = {}): AlvoPiscina => ({
  id: "t", base: "ETH", cotacao: null, rotulo: "ETH / USDC",
  llama: { project: "p", symbol: "s", chain: "c" }, porque: "teste", ...over,
});

const janela = (over: Partial<JanelaPiscina> = {}): JanelaPiscina => ({
  alvo: alvo(), dias: 90, razao: 1, ilPct: 0, taxaPct: 5,
  vantagemPct: 5, lpPct: 5, segurarPct: 0,
  apyDe: "apyBase", apyAnualPct: 20, casada: null, ...over,
});

describe("perda impermanente — o sinal é a trava", () => {
  /**
   * ⚠️ A INVARIANTE DESTA FAMÍLIA. Estar na piscina não pode render MAIS que
   * segurar por efeito de preço: o ganho vem da taxa, que entra por fora. Um
   * valor positivo aqui é o mesmo defeito que "custo negativo" (nº 1) e "ida e
   * volta que ganha" (nº 2), com a roupa desta fase.
   */
  it("NUNCA é positiva, para nenhuma razão", () => {
    for (const r of [0.01, 0.5, 0.9, 1, 1.1, 2, 5, 100, 1e6]) {
      expect(perdaImpermanente(r), `razao=${r}`).toBeLessThanOrEqual(0);
    }
  });

  it("é exatamente zero quando os preços não divergem", () => {
    expect(perdaImpermanente(1)).toBe(0);
  });

  /** Dobrar de preço custa ~5,7% — o número de referência da literatura. */
  it("bate os pontos conhecidos da curva", () => {
    expect(perdaImpermanente(2) * 100).toBeCloseTo(-5.72, 1);
    expect(perdaImpermanente(4) * 100).toBeCloseTo(-20.0, 1);
    expect(perdaImpermanente(1.25) * 100).toBeCloseTo(-0.62, 1);
  });

  /**
   * ⚠️ SIMÉTRICA: subir 2× e cair para metade doem igual. Se der diferente, a
   * razão foi montada invertida em algum lado — e um par inteiro sairia com a
   * perda do outro.
   */
  it("é simétrica entre subir e cair na mesma proporção", () => {
    for (const r of [1.5, 2, 3, 10]) {
      expect(perdaImpermanente(r)).toBeCloseTo(perdaImpermanente(1 / r), 12);
    }
  });

  it("entrada inválida vira zero, não NaN", () => {
    for (const r of [0, -1, NaN, Infinity]) {
      expect(perdaImpermanente(r)).toBe(0);
    }
  });
});

describe("a janela de uma piscina", () => {
  const base = {
    alvo: alvo(), precoCotacaoIni: null, precoCotacaoFim: null,
    apyBase: 20, apyMean30d: null, dias: 365,
  };

  it("preço parado: perda zero, e a vantagem é a taxa inteira", () => {
    const j = janelaPiscina({ ...base, precoBaseIni: 2000, precoBaseFim: 2000 })!;
    expect(j.ilPct).toBe(0);
    expect(j.taxaPct).toBeCloseTo(20, 6);
    expect(j.vantagemPct).toBeCloseTo(20, 6);
    expect(j.lpPct).toBeCloseTo(20, 6);
    expect(j.segurarPct).toBeCloseTo(0, 6);
  });

  /**
   * ⚠️ ESTE TESTE ESTAVA ESCRITO AO CONTRÁRIO, E ERA O DEFEITO INTEIRO.
   *
   * Ele afirmava `liquidoPct < segurarPct` como se isso significasse "perde de
   * segurar". Não significa: `vantagemPct` JÁ É a comparação contra segurar,
   * porque a perda impermanente é medida em relação a ela. Comparar os dois era
   * pôr uma diferença contra um nível (invariante nº 3).
   *
   * Com taxa de 20% e perda de 5,7%, a piscina GANHA de segurar em 14 pontos —
   * o oposto do que o teste antigo afirmava, e ele passava.
   */
  it("ativo dobra: a taxa cobre a perda, e a mesa GANHA de segurar", () => {
    const j = janelaPiscina({ ...base, precoBaseIni: 2000, precoBaseFim: 4000 })!;
    expect(j.ilPct).toBeCloseTo(-5.72, 1);
    expect(j.segurarPct).toBeCloseTo(50, 6);        // metade parada, metade dobrou
    expect(j.vantagemPct).toBeGreaterThan(0);       // taxa 20% cobre a perda 5,7%
    // E o absoluto tem que bater o produto: segurar × vantagem.
    expect(j.lpPct).toBeCloseTo(((1.5) * (1 + j.vantagemPct / 100) - 1) * 100, 6);
    expect(j.lpPct).toBeGreaterThan(j.segurarPct);
  });

  /**
   * ⚠️ O CASO DA RODADA DE 09/08, virado em teste: mercado de QUEDA, a taxa NÃO
   * cobre a perda. A tela pintava isso de verde porque −7% "é maior que" −27%.
   */
  it("taxa minúscula em mercado de queda: PERDE de segurar, em absoluto também", () => {
    const j = janelaPiscina({
      ...base, precoBaseIni: 4000, precoBaseFim: 1800, apyBase: 0.25,
    })!;
    expect(j.segurarPct).toBeLessThan(0);
    expect(j.vantagemPct).toBeLessThan(0);          // a taxa não cobriu a perda
    // O que importa: o absoluto da piscina é PIOR que o de segurar.
    expect(j.lpPct).toBeLessThan(j.segurarPct);
  });

  /** Dois voláteis que andam JUNTOS quase não têm perda — a razão fica em 1. */
  it("dois voláteis correlacionados quase não perdem", () => {
    const j = janelaPiscina({
      ...base, alvo: alvo({ base: "BTC", cotacao: "ETH" }),
      precoBaseIni: 100, precoBaseFim: 150,
      precoCotacaoIni: 10, precoCotacaoFim: 15,
    })!;
    expect(j.razao).toBeCloseTo(1, 9);
    expect(j.ilPct).toBe(0);
  });

  /** A taxa é proporcional aos dias, e a tela diz que é proporcional. */
  it("a taxa acompanha o tamanho da janela", () => {
    const meio = janelaPiscina({ ...base, precoBaseIni: 1, precoBaseFim: 1, dias: 182.5 })!;
    expect(meio.taxaPct).toBeCloseTo(10, 6);
  });

  /**
   * ⚠️ APY AUSENTE NÃO É TAXA ZERO (invariante nº 6). A janela sai marcada, e
   * quem consome exclui — nunca conclui "a taxa não cobre".
   */
  it("sem APY nenhum, a janela sai MARCADA como ausente", () => {
    const j = janelaPiscina({
      ...base, precoBaseIni: 1, precoBaseFim: 1, apyBase: null, apyMean30d: null,
    })!;
    expect(j.apyDe).toBe("ausente");
    expect(j.apyAnualPct).toBeNull();
  });

  /**
   * ⚠️ ESTE TESTE AFIRMAVA A ORDEM INVERTIDA, e a ordem invertida era o defeito.
   *
   * A Fase 4 já tinha decidido `media30d > base` (`escolherApy`). Aqui eu
   * escrevi o contrário, e a rodada de 10/08 cobrou: a taxa do ETH/USDC saiu
   * +0,25%/ano num dia e +2,97%/ano no seguinte — doze vezes em 24 horas,
   * porque `apyBase` é foto do volume de ontem.
   */
  it("a MÉDIA DE 30 DIAS manda, e a foto de hoje é o segundo recurso", () => {
    const comAsDuas = janelaPiscina({
      ...base, precoBaseIni: 1, precoBaseFim: 1, apyBase: 99, apyMean30d: 7,
    })!;
    expect(comAsDuas.apyDe).toBe("apyMean30d");
    expect(comAsDuas.apyAnualPct).toBe(7);

    const soFoto = janelaPiscina({
      ...base, precoBaseIni: 1, precoBaseFim: 1, apyBase: 99, apyMean30d: null,
    })!;
    expect(soFoto.apyDe).toBe("apyBase");
    expect(soFoto.apyAnualPct).toBe(99);
  });

  it("preço faltando devolve null em vez de inventar janela", () => {
    expect(janelaPiscina({ ...base, precoBaseIni: 0, precoBaseFim: 100 })).toBeNull();
    expect(janelaPiscina({ ...base, precoBaseIni: 100, precoBaseFim: null })).toBeNull();
  });
});

describe("o resumo e o veredito", () => {
  /**
   * ⚠️ O CONTROLE NÃO ENTRA NAS MEDIANAS. Um par estável tem perda ≈0 e
   * entraria puxando o número para cima como se fosse mérito da estratégia.
   */
  it("o par de controle fica fora das medianas", () => {
    const r = resumirLiquidez([
      janela({ ilPct: -10, vantagemPct: -5 }),
      janela({ ilPct: -8,  vantagemPct: -3 }),
      janela({ alvo: alvo({ controle: true }), ilPct: 0, vantagemPct: 5 }),
    ]);
    expect(r.medidas).toHaveLength(2);
    expect(r.ilMedianoPct).toBeLessThan(0);
    expect(r.ganhouDeSegurar).toBe(0);   // vantagem negativa nas duas
    expect(r.janelas).toHaveLength(3);   // mas continua visível na tela
  });

  it("amostra abaixo do piso é CINZA, nunca reprovada", () => {
    const r = resumirLiquidez([janela(), janela()]);
    const v = vereditoLiquidez(r, MIN_PISCINAS);
    expect(v.status).toBe("cinza");
    expect(v.texto).toContain("inconclusivo não é reprovado");
  });

  it("vantagem negativa mata a mesa", () => {
    const r = resumirLiquidez([
      janela({ taxaPct: 3, ilPct: -10, vantagemPct: -7, segurarPct: -20, lpPct: -25.6 }),
      janela({ taxaPct: 3, ilPct: -9,  vantagemPct: -6, segurarPct: -20, lpPct: -24.8 }),
      janela({ taxaPct: 3, ilPct: -11, vantagemPct: -8, segurarPct: -20, lpPct: -26.4 }),
    ]);
    expect(vereditoLiquidez(r).status).toBe("morta");
  });

  /**
   * ⚠️ A REGRESSÃO DO DEFEITO DE 09/08, e é o teste mais importante do arquivo.
   *
   * Vantagem POSITIVA num mercado de ALTA forte: a mesa ganhou de segurar. O
   * veredito antigo comparava a vantagem (+13) contra o nível de segurar (+42),
   * concluía "perde de segurar" e marcava MORTA — reprovando ao contrário uma
   * mesa que venceu. Mercado de alta era o cenário em que o defeito mentia para
   * o lado caro.
   */
  it("vantagem positiva em mercado de ALTA continua VERDE", () => {
    const r = resumirLiquidez([
      janela({ vantagemPct: 12, segurarPct: 40, lpPct: 56.8 }),
      janela({ vantagemPct: 14, segurarPct: 45, lpPct: 65.3 }),
      janela({ vantagemPct: 13, segurarPct: 42, lpPct: 60.5 }),
    ]);
    const v = vereditoLiquidez(r);
    expect(v.status).toBe("verde");
    expect(v.texto).toContain("ACIMA de segurar");
  });

  /** E o simétrico: vantagem negativa em mercado de QUEDA continua morta. */
  it("vantagem negativa em mercado de QUEDA continua MORTA", () => {
    const r = resumirLiquidez([
      janela({ vantagemPct: -7.4, segurarPct: -27.4, lpPct: -32.6 }),
      janela({ vantagemPct: -0.4, segurarPct: -50.1, lpPct: -50.3 }),
      janela({ vantagemPct: -3.0, segurarPct: -20.0, lpPct: -22.4 }),
    ]);
    const v = vereditoLiquidez(r);
    expect(v.status).toBe("morta");
    expect(v.texto).toContain("ABAIXO de simplesmente segurar");
  });

  /**
   * ⚠️ A RODADA DE 10/08, virada em teste. Vantagem mediana de −0,01% EM UM ANO
   * saiu MORTA. Um centésimo de ponto não distingue "perde" de "empata", e está
   * inteiramente dentro do gás que a medição não inclui.
   */
  it("margem dentro do erro declarado é EMPATE, não reprovação", () => {
    const r = resumirLiquidez([
      janela({ vantagemPct: -0.01, segurarPct: -49.9, lpPct: -49.9 }),
      janela({ vantagemPct: -4.54, segurarPct: -27.3, lpPct: -30.6 }),
      janela({ vantagemPct: +0.38, segurarPct: -57.6, lpPct: -57.5 }),
    ]);
    const v = vereditoLiquidez(r);
    expect(v.status).toBe("cinza");
    expect(v.texto).toContain("EMPATE");
    // E diz POR QUE não dá para decidir — o gás, que não está na conta.
    expect(v.texto).toContain("GÁS");
  });

  /**
   * ⚠️ A faixa morta é SIMÉTRICA. Se ela só existisse do lado negativo, ela
   * viraria um amortecedor a favor da mesa — o oposto do que ela existe para
   * fazer.
   */
  it("a faixa morta vale para os DOIS lados", () => {
    const quaseVerde = resumirLiquidez([
      janela({ vantagemPct: 0.5 }), janela({ vantagemPct: 0.5 }), janela({ vantagemPct: 0.5 }),
    ]);
    expect(vereditoLiquidez(quaseVerde).status).toBe("cinza");
    expect(MARGEM_MINIMA_PCT).toBe(1);
  });

  it("cobre a perda e sobra: verde", () => {
    const r = resumirLiquidez([
      janela({ vantagemPct: 18, segurarPct: 5 }),
      janela({ vantagemPct: 20, segurarPct: 6 }),
      janela({ vantagemPct: 19, segurarPct: 4 }),
    ]);
    expect(vereditoLiquidez(r).status).toBe("verde");
  });

  /**
   * ⚠️ TODAS AS MEDIANAS SOBRE A MESMA AMOSTRA. A perda vinha de um conjunto e
   * a taxa de outro, e a tela mostrava os dois lado a lado como se fossem do
   * mesmo grupo (invariante nº 4).
   */
  it("a perda mediana ignora piscina sem taxa, igual às outras medianas", () => {
    const r = resumirLiquidez([
      janela({ ilPct: -2, vantagemPct: 1 }),
      janela({ ilPct: -3, vantagemPct: 1 }),
      janela({ ilPct: -90, vantagemPct: 0, apyDe: "ausente", apyAnualPct: null }),
    ]);
    expect(r.medidas).toHaveLength(2);
    expect(r.ilMedianoPct).toBeCloseTo(-2.5, 6);   // a de −90 NÃO entra
  });
});

describe("os alvos declarados", () => {
  it("tem grupo de controle, e é exatamente um", () => {
    expect(ALVOS.filter((a) => a.controle)).toHaveLength(1);
  });

  /** Piscina sem o porquê na tela vira constante que ninguém confere. */
  it("toda piscina declara por que está na lista", () => {
    for (const a of ALVOS) expect(a.porque.length, a.id).toBeGreaterThan(20);
  });

  /** Sem voláteis suficientes o piso de amostra nunca fecha. */
  it("há alvos não-controle bastantes para o piso", () => {
    expect(ALVOS.filter((a) => !a.controle).length).toBeGreaterThanOrEqual(MIN_PISCINAS);
  });
});
