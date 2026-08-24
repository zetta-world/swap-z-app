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
  ALVOS, MIN_PISCINAS, MARGEM_MINIMA_PCT, custoGasPct, GAS_TOTAL_LP,
  type AlvoPiscina, type JanelaPiscina,
} from "@/lib/lab/liquidez";

/** Helpers em escopo de MÓDULO — já escorreguei duas vezes prendendo em `describe`. */
const alvo = (over: Partial<AlvoPiscina> = {}): AlvoPiscina => ({
  id: "t", base: "ETH", cotacao: null, rotulo: "ETH / USDC",
  llama: { project: "p", symbol: "s", chain: "c" }, porque: "teste", ...over,
});

const janela = (over: Partial<JanelaPiscina> = {}): JanelaPiscina => ({
  alvo: alvo(), dias: 90, razao: 1, ilPct: 0, taxaPct: 5,
  vantagemPct: 5, lpPct: 5, segurarPct: 0,
  apyDe: "apyBase", apyAnualPct: 20, desacordoTaxaPct: null, gasPct: 0, gasDe: "medido",
  casada: null, ...over,
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
    apyBase: 20, apyMean30d: null, dias: 365, gasPct: 0,
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

  it("amostra abaixo do piso é INCONCLUSIVA, nunca reprovada", () => {
    const r = resumirLiquidez([janela(), janela()]);
    const v = vereditoLiquidez(r, MIN_PISCINAS);
    expect(v.status).toBe("inconclusiva");
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
    expect(v.status).toBe("empate");
    expect(v.texto).toContain("EMPATE");
    // E diz POR QUE não dá para decidir, com o número da faixa.
    expect(v.texto).toContain("±1.00%");
  });

  /**
   * ⚠️ A FAIXA CRESCE COM O DESACORDO DA FONTE, e é MEDIDA.
   *
   * A justificativa original do ±1 era "o gás não está na conta". Depois da
   * 8.1.1 o gás entrou e mediu 0,01% — a justificativa evaporou. A incerteza
   * não: mudou para a taxa, onde as duas estimativas da própria fonte para a
   * MESMA piscina discordaram em mais de 3 pontos.
   */
  it("a faixa cresce com o desacordo MEDIDO da fonte", () => {
    const r = resumirLiquidez([
      janela({ vantagemPct: 0.56, desacordoTaxaPct: 3.4 }),
      janela({ vantagemPct: 0.56, desacordoTaxaPct: 0.4 }),
      janela({ vantagemPct: 0.56, desacordoTaxaPct: 0.1 }),
    ]);
    // O MÁXIMO, não a mediana: a mediana (0,4) deixaria +0,56% virar VERDE.
    expect(r.incertezaTaxaPct).toBe(3.4);
    const v = vereditoLiquidez(r);
    expect(v.status).toBe("empate");
    expect(v.texto).toContain("±3.40%");
    expect(v.texto).toContain("discordam");
  });

  /**
   * ⚠️ E O TEXTO NÃO PODE DIZER QUE O GÁS ESTÁ FORA quando ele está dentro.
   * Foi o defeito da tela de 10/08: a frase descrevia a versão anterior da
   * medição enquanto uma coluna GÁS aparecia ao lado.
   */
  it("o texto do empate NÃO afirma que o gás está fora da conta", () => {
    const r = resumirLiquidez([
      janela({ vantagemPct: 0.1, gasPct: 0.01 }),
      janela({ vantagemPct: 0.1, gasPct: 0.01 }),
      janela({ vantagemPct: 0.1, gasPct: 0.01 }),
    ]);
    const t = vereditoLiquidez(r).texto;
    expect(t).not.toContain("não está na conta");
    expect(t).toContain("JÁ está na conta");
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
    expect(vereditoLiquidez(quaseVerde).status).toBe("empate");
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

describe("as medianas são por COLUNA, e não se combinam", () => {
  /**
   * ⚠️ ACHADO DE 10/08, conferindo a rodada no BANCO.
   *
   * Com n ímpar cada mediana vem de uma piscina diferente: taxa 2,57% (ETH),
   * perda −0,49% (BTC), vantagem +0,56% (LINK). A tela convidava a conferir
   * `taxa − perda ≈ vantagem` — 2,08 contra 0,56. Não é conta errada: são três
   * observações distintas apresentadas como se fossem uma linha.
   */
  it("aponta QUAL piscina é a mediana pela régua", () => {
    const r = resumirLiquidez([
      janela({ alvo: alvo({ id: "eth" }),  taxaPct: 2.57, ilPct: -7.70, vantagemPct: -5.33 }),
      janela({ alvo: alvo({ id: "btc" }),  taxaPct: 3.80, ilPct: -0.49, vantagemPct:  3.29 }),
      janela({ alvo: alvo({ id: "link" }), taxaPct: 0.75, ilPct: -0.19, vantagemPct:  0.56 }),
    ]);
    // Cada mediana vem de uma piscina diferente — é isso que a marca resolve.
    expect(r.taxaMedianaPct).toBeCloseTo(2.57, 6);      // do eth
    expect(r.ilMedianoPct).toBeCloseTo(-0.49, 6);       // do btc
    expect(r.vantagemMedianaPct).toBeCloseTo(0.56, 6);  // do link
    expect(r.piscinaMediana).toBe("link");
  });

  /**
   * ⚠️ COM AMOSTRA PAR A MEDIANA NÃO É UMA LINHA. Apontar uma seria inventar
   * uma observação que não existe.
   */
  it("amostra par não aponta piscina nenhuma", () => {
    const r = resumirLiquidez([
      janela({ alvo: alvo({ id: "a" }), vantagemPct: 1 }),
      janela({ alvo: alvo({ id: "b" }), vantagemPct: 3 }),
    ]);
    expect(r.piscinaMediana).toBeNull();
  });
});

describe("o gás — o custo que a piscina tem A MAIS que segurar", () => {
  /**
   * ⚠️ A TROCA PARA MONTAR A CESTA NÃO ENTRA, e isso é decisão, não omissão.
   * Quem vai SEGURAR 50/50 paga a mesma troca na entrada e na saída — cobrá-la
   * só do lado da piscina compararia montagens diferentes (invariante nº 3).
   * O que entra é só o gás de piscina, que quem segura não paga.
   */
  it("são duas aprovações, um depósito e um saque", () => {
    expect(GAS_TOTAL_LP).toBe(46_000 * 2 + 180_000 + 160_000);
  });

  it("o custo cai quando o capital sobe — é custo FIXO em dólar", () => {
    const caro   = custoGasPct(500,    0.00004)!;
    const barato = custoGasPct(50_000, 0.00004)!;
    expect(caro).toBeGreaterThan(barato * 50);
    expect(barato).toBeGreaterThan(0);
  });

  /** ⚠️ Preço de gás ausente NÃO vira gás zero (cicatriz de 06/08). */
  it("sem preço de gás devolve null, nunca zero", () => {
    expect(custoGasPct(2_000, 0)).toBeNull();
    expect(custoGasPct(2_000, NaN)).toBeNull();
    expect(custoGasPct(0, 0.00004)).toBeNull();
  });

  it("a janela marca gás AUSENTE quando não recebe o número", () => {
    const semGas = janelaPiscina({
      alvo: alvo(), precoBaseIni: 1, precoBaseFim: 1,
      precoCotacaoIni: null, precoCotacaoFim: null,
      apyBase: 20, apyMean30d: null, dias: 365, gasPct: null,
    })!;
    expect(semGas.gasDe).toBe("ausente");
    expect(semGas.gasPct).toBe(0);   // não contamina a conta, mas fica marcado
  });

  /**
   * ⚠️ O GÁS TEM QUE DERRUBAR A VANTAGEM. Sem esta trava, um erro de sinal
   * faria o custo PAGAR a mesa — a família do "custo não pode ser negativo".
   */
  it("o gás só piora a vantagem, nunca melhora", () => {
    const comum = { alvo: alvo(), precoBaseIni: 2000, precoBaseFim: 2000,
      precoCotacaoIni: null, precoCotacaoFim: null,
      apyBase: 5, apyMean30d: null, dias: 365 };
    const semGas = janelaPiscina({ ...comum, gasPct: 0 })!;
    const comGas = janelaPiscina({ ...comum, gasPct: 2 })!;
    expect(comGas.vantagemPct).toBeLessThan(semGas.vantagemPct);
    expect(comGas.lpPct).toBeLessThan(semGas.lpPct);
  });

  /**
   * ⚠️ O CASO QUE DECIDE C14: taxa que empata com a perda, e o gás vira o sinal.
   * Foi exatamente a leitura da rodada de 10/08 — "empata antes do gás".
   */
  it("um empate antes do gás fica NEGATIVO depois dele", () => {
    const comum = { alvo: alvo(), precoBaseIni: 2000, precoBaseFim: 2000,
      precoCotacaoIni: null, precoCotacaoFim: null,
      apyBase: 0.5, apyMean30d: null, dias: 365 };
    expect(janelaPiscina({ ...comum, gasPct: 0 })!.vantagemPct).toBeGreaterThan(0);
    expect(janelaPiscina({ ...comum, gasPct: 2 })!.vantagemPct).toBeLessThan(0);
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
