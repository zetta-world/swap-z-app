/**
 * AS TRAVAS DO DEX ↔ CEX.
 *
 * ⚠️ ESTA FASE MEDE A ÚLTIMA ARBITRAGEM DO MAPA, E AS OUTRAS DUAS MORRERAM DO
 * MESMO JEITO: preço de tela batendo preço de tela, sem andar o livro.
 *
 * A mesa CEX↔CEX achou +0,451% de borda teórica e mediu −0,629% real em 4.085
 * amostras. O censo de profundidade confirmou: dispersão de 0,05% contra 1,1%
 * de custo para atravessar dois bid-asks.
 *
 * Aqui a régua é a MESMA — `vwapBuy`/`vwapSell`, a que reprovou aquela mesa — e
 * os dois lados são medidos para o MESMO notional. Se sair positivo, não pode
 * ser por causa da régua.
 */

import { describe, it, expect } from "vitest";
import {
  precoCex, precoDex, sentidos, melhorSentido, vereditoDexCex,
  TAXA_CEX_PCT, MIN_SIMBOLOS, PARES_EXCLUIDOS, enderecoLiFi, LIFI_NATIVO,
  idaEVoltaCoerente, converterCexParaUsdc, type LinhaDexCex,
} from "@/lib/lab/dex-cex";

/** Livro com N níveis de $1.000 cada, começando em `base`. */
const asks = (base: number, passo: number, n = 10): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [base + i * passo, 1000 / (base + i * passo)]);
const bids = (base: number, passo: number, n = 10): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [base - i * passo, 1000 / (base - i * passo)]);

describe("o preço da CEX ANDA o livro — não é o topo", () => {
  /**
   * ⚠️ O DEFEITO QUE MATOU A MESA ANTERIOR. O topo é o preço de UMA unidade; a
   * mesa quer operar $N. Comparar topo de CEX contra cotação de DEX (que já tem
   * impacto) enviesaria contra o DEX; o contrário, a favor.
   */
  it("notional grande paga mais caro que o topo", () => {
    const p1 = precoCex(asks(100, 0.5), bids(99, 0.5), 500)!;
    const p9 = precoCex(asks(100, 0.5), bids(99, 0.5), 9000)!;
    expect(p1.compraMedio).toBeGreaterThanOrEqual(100);
    expect(p9.compraMedio).toBeGreaterThan(p1.compraMedio);
  });

  it("livro raso devolve preenchimento incompleto, e isso é dado", () => {
    const p = precoCex(asks(100, 0.5, 2), bids(99, 0.5, 2), 50_000);
    expect(p).not.toBeNull();
    expect(p!.completo).toBe(false);
  });

  it("livro vazio devolve null, não um preço inventado", () => {
    expect(precoCex([], bids(99, 0.5), 1000)).toBeNull();
    expect(precoCex(asks(100, 0.5), [], 1000)).toBeNull();
  });
});

describe("o preço do DEX vem de DUAS cotações, não de uma espelhada", () => {
  /**
   * ⚠️ Poça com liquidez assimétrica cobra diferente nos dois sentidos. Assumir
   * simetria inventaria metade da medição.
   */
  it("ida e volta com preços diferentes produzem compra ≠ venda", () => {
    // $1.000 compram 9,8 tokens; esses 9,8 devolvem só $970.
    const p = precoDex(1000, 9.8, 970)!;
    expect(p.compraMedio).toBeCloseTo(1000 / 9.8, 6);
    expect(p.vendaMedio).toBeCloseTo(970 / 9.8, 6);
    expect(p.vendaMedio).toBeLessThan(p.compraMedio);
  });

  /**
   * ⚠️ O GÁS É PAGO FORA DO TOKEN, e esquecê-lo dá um preço que ninguém
   * executa — a família de erro que a Fase 4 pegou com o custo fixo.
   */
  it("o gás entra no preço, encarecendo a compra e barateando a venda", () => {
    const sem = precoDex(1000, 10, 990)!;
    const com = precoDex(1000, 10, 990, 2, 2)!;
    expect(com.compraMedio).toBeGreaterThan(sem.compraMedio);
    expect(com.vendaMedio).toBeLessThan(sem.vendaMedio);
    expect(com.compraMedio).toBeCloseTo(1002 / 10, 6);
    expect(com.vendaMedio).toBeCloseTo(988 / 10, 6);
  });

  /**
   * ⚠️ DUAS EXCLUSÕES QUE O PRÓPRIO REPO JUSTIFICA. WBTC é BTC embrulhado — a
   * diferença é o basis de custódia, negócio próprio com risco próprio.
   * MATIC/POL é o padrão que `arbiter.ts` documenta como fonte de spread falso:
   * ticker em migração cota o cadáver de um lado e o vivo do outro.
   */
  it("WBTC e MATIC/POL estão fora da lista de pares", () => {
    expect(PARES_EXCLUIDOS).toContain("WBTC");
    expect(PARES_EXCLUIDOS).toContain("MATIC");
    expect(PARES_EXCLUIDOS).toContain("POL");
  });

  it("cotação faltando devolve null, não zero", () => {
    expect(precoDex(1000, 0, 970)).toBeNull();
    expect(precoDex(0, 9.8, 970)).toBeNull();
    expect(precoDex(1000, 9.8, 0)).toBeNull();
  });
});

describe("os dois sentidos são calculados separadamente", () => {
  const dex = precoDex(1000, 10, 985)!;      // compra a 100, vende a 98,5
  const cex = { compraMedio: 101, vendaMedio: 100.5, completo: true };

  it("dex→cex e cex→dex usam preços DIFERENTES", () => {
    const [dc, cd] = sentidos(dex, cex);
    expect(dc.rota).toBe("dex→cex");
    // Comprar a 100 no DEX, vender a 100,5 na CEX → +0,5% bruto.
    expect(dc.brutaPct).toBeCloseTo(0.5, 6);
    // Comprar a 101 na CEX, vender a 98,5 no DEX → negativo.
    expect(cd.brutaPct).toBeLessThan(0);
    expect(dc.brutaPct).not.toBeCloseTo(cd.brutaPct, 3);
  });

  /** Há UMA perna de CEX em cada rota — cobrar duas seria a conta do funding. */
  it("a taxa de CEX entra UMA vez por rota", () => {
    const [dc] = sentidos(dex, cex);
    expect(dc.brutaPct - dc.liquidaPct).toBeCloseTo(TAXA_CEX_PCT, 10);
  });

  it("o melhor sentido é o de maior LÍQUIDO, não de maior bruto", () => {
    const m = melhorSentido([
      { rota: "dex→cex", brutaPct: 0.5, liquidaPct: 0.4 },
      { rota: "cex→dex", brutaPct: 0.6, liquidaPct: 0.3 },
    ]);
    expect(m.rota).toBe("dex→cex");
  });
});

/**
 * Uma linha de teste.
 *
 * ⚠️ NO ESCOPO DO MÓDULO de propósito. Eu já defini um helper assim dentro de
 * um `describe` e precisei levantá-lo depois, na Fase 5.1 — e repeti o mesmo
 * erro aqui, no arquivo seguinte. Fica no topo para o próximo `describe` não
 * tropeçar nele.
 */
const linha = (
  symbol: string, liq: number, completo = true, coerente = true,
): LinhaDexCex => ({
  symbol, cadeia: "base", venueCex: "binance", notionalUsd: 5000,
  melhorRota: "dex→cex", brutaPct: liq + TAXA_CEX_PCT, liquidaPct: liq,
  outraRotaPct: -liq, precoDexCompra: 100, precoDexVenda: 99,
  precoCexCompra: 101, precoCexVenda: 100.5, livroCompleto: completo,
  dexCoerente: coerente, usdtPorUsdc: 1.0003,
});

describe("o veredito", () => {

  it("sem par nenhum é inconclusivo, nunca reprovado", () => {
    const v = vereditoDexCex([]);
    expect(v.status).toBe("inconclusiva");
    expect(v.verdict).toContain("inconclusivo");
  });

  /**
   * ⚠️ PREENCHIMENTO PARCIAL MENTE A FAVOR: o preço médio de um livro que
   * acabou é melhor que o de um que aguenta o tamanho. Par incompleto não vira
   * número — vira contagem declarada.
   */
  it("livro raso não vira número, e a contagem aparece", () => {
    const v = vereditoDexCex([linha("A", 5, false), linha("B", 5, false)]);
    expect(v.status).toBe("inconclusiva");
    // ⚠️ A frase mudou em 09/08: agora são DUAS condições (livro fundo E ida e
    // volta coerente), então o texto cita as duas em vez de só a do livro.
    expect(v.verdict).toContain("duas condições");
    expect(v.verdict).toContain("livro fundo o bastante");
  });

  it("abaixo do piso de símbolos é INCONCLUSIVO", () => {
    const v = vereditoDexCex([linha("A", 1), linha("B", 1)]);
    expect(v.status).toBe("inconclusiva");
    expect(v.verdict).toContain(`piso de ${MIN_SIMBOLOS}`);
    expect(v.verdict).toContain("um par com borda é um par, não um terreno");
  });

  /**
   * O desfecho que as outras duas arbitragens tiveram. Se acontecer aqui, a
   * frase "único terreno com vantagem estrutural" cai.
   */
  it("mediana negativa REPROVA e diz que a janela existe sem dinheiro dentro", () => {
    const v = vereditoDexCex([linha("A", -0.3), linha("B", -0.2), linha("C", -0.1), linha("D", 0.05)]);
    expect(v.status).toBe("morta");
    expect(v.verdict).toContain("A janela de bloco existe e não sobra dinheiro nela");
    // E diz quantos ficaram positivos, para a reprovação ser conferível.
    expect(v.verdict).toContain("1 de 4");
  });

  /**
   * ⚠️ VERDE AQUI NÃO É "DÁ PARA OPERAR". MEV chega antes por construção, e o
   * veredito tem que dizer isso na mesma frase — senão alguém lê borda positiva
   * como dinheiro disponível.
   */
  it("mediana positiva aprova E declara que é TETO, não captura", () => {
    const v = vereditoDexCex([linha("A", 0.2), linha("B", 0.3), linha("C", 0.4), linha("D", 0.5)]);
    expect(v.status).toBe("verde");
    expect(v.verdict).toContain("TETO, não captura");
    expect(v.verdict).toContain("MEV");
  });

  it("os pares descartados por livro raso são contados na ressalva", () => {
    const v = vereditoDexCex([
      linha("A", 0.2), linha("B", 0.3), linha("C", 0.4), linha("D", 0.5),
      linha("E", 9, false),
    ]);
    expect(v.verdict).toContain("1 par(es) fora por livro raso");
  });

  /** A mediana manda: um par com poça quebrada não pode decidir o veredito. */
  it("um outlier gigante não vira o veredito", () => {
    const v = vereditoDexCex([
      linha("A", -0.3), linha("B", -0.2), linha("C", -0.1), linha("D", -0.05),
      linha("QUEBRADO", 400),
    ]);
    expect(v.status).toBe("morta");
  });
});

/**
 * ⚠️ O ATIVO NATIVO — O DEFEITO DA PRIMEIRA RODADA (09/08).
 *
 * `tokens.ts` guarda ETH e BNB como `address: "native"` — marca da interface,
 * não endereço. A LI.FI devolve 404 "Could not find token" para ela e espera
 * `0x0000…0000`.
 *
 * Isso derrubou QUATRO dos sete pares (ETH em três cadeias e BNB) e a medição
 * fechou INCONCLUSIVA por não bater o piso de quatro símbolos. O piso funcionou;
 * faltou o par chegar até ele.
 *
 * ⚠️ E eu já sabia: a rota do 🏦 importa `LIFI_NATIVE` e usa. Aqui escrevi
 * `token.address` direto, num arquivo do MESMO DIA. Não foi desconhecimento —
 * foi não reler o que eu mesmo tinha feito duas fases antes.
 */
describe("o ativo nativo precisa do sentinela, não da nossa marca", () => {
  it('traduz "native" para o endereço-zero que a LI.FI espera', () => {
    expect(enderecoLiFi("native")).toBe(LIFI_NATIVO);
    expect(LIFI_NATIVO).toMatch(/^0x0{40}$/);
  });

  it("endereço de verdade passa intacto", () => {
    const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    expect(enderecoLiFi(usdc)).toBe(usdc);
  });

  /**
   * A marca literal é o que a LI.FI recusa. Se alguém a passar direto de novo,
   * o par cai com 404 e some da amostra em silêncio — que foi exatamente o que
   * aconteceu.
   */
  it('nunca devolve a string "native"', () => {
    expect(enderecoLiFi("native")).not.toBe("native");
  });
});

/**
 * ⚠️⚠️ OS TRÊS DEFEITOS DA RODADA DE 09/08.
 *
 * O dono rodou o ⛓ com os 7 pares. Veredito MORTA, mediana −0,322% — a
 * conclusão certa. E três problemas por baixo, todos meus.
 */
describe("ida e volta na mesma poça não pode ganhar dinheiro", () => {
  /**
   * O que apareceu: ETH em ethereum e arbitrum com venda 1920,27 contra compra
   * 1917,44 — e eram EXATAMENTE as duas únicas positivas da tabela (+0,377% e
   * +0,359%). A borda vinha da cotação inconsistente, não do mercado.
   *
   * Eu construí a trava de "custo não pode ser negativo" na Fase 4 e não
   * construí a equivalente aqui. Mesma invariante, outro nome.
   */
  it("venda acima da compra na mesma poça é INCOERENTE", () => {
    expect(idaEVoltaCoerente({ compraMedio: 1917.44, vendaMedio: 1920.27, completo: true }))
      .toBe(false);
    expect(idaEVoltaCoerente({ compraMedio: 1930.86, vendaMedio: 1919.48, completo: true }))
      .toBe(true);
  });

  it("empate também é incoerente — taxa e impacto nunca são zero", () => {
    expect(idaEVoltaCoerente({ compraMedio: 100, vendaMedio: 100, completo: true })).toBe(false);
  });

  /**
   * A linha NÃO é corrigida: é marcada e tirada de todas as contas. Achatar
   * daria um número com cara de medição.
   */
  it("par incoerente sai da conta e aparece na ressalva", () => {
    const v = vereditoDexCex([
      linha("A", -0.3), linha("B", -0.2), linha("C", -0.1), linha("D", -0.05),
      linha("QUEBRADO", 0.38, true, false),
    ]);
    expect(v.status).toBe("morta");
    expect(v.verdict).toContain("ida e volta INCOERENTE");
    expect(v.verdict).toContain("1 par(es)");
    // E o positivo quebrado NÃO conta como positivo.
    expect(v.verdict).toContain("0 de 4");
  });

  it("todos incoerentes é INCONCLUSIVO, não reprovado", () => {
    const v = vereditoDexCex([linha("A", 1, true, false), linha("B", 1, true, false)]);
    expect(v.status).toBe("inconclusiva");
    expect(v.verdict).toContain("duas condições");
  });
});

describe("os dois lados na MESMA moeda", () => {
  /**
   * ⚠️ A CEX devolve BASE/USDT (todas as venues) e o DEX cota contra USDC. Sem
   * converter, o basis USDT/USDC entra na conta como se fosse borda.
   *
   * Na rodada de 09/08 o ETH aparecia a 1926,59 na CEX contra 1917–1920 no DEX:
   * ~0,35% de gap sistemático no ativo mais líquido do mercado — implausível
   * como ineficiência, plausível como basis de stablecoin.
   */
  it("converte o preço de USDT para USDC pela taxa da MESMA venue", () => {
    const emUsdt = { compraMedio: 1926.59, vendaMedio: 1926.58, completo: true };
    // USDT vale um pouco menos que USDC → preço em USDT é numericamente maior.
    const emUsdc = converterCexParaUsdc(emUsdt, 1.0035);
    expect(emUsdc.compraMedio).toBeLessThan(emUsdt.compraMedio);
    expect(emUsdc.compraMedio).toBeCloseTo(1926.59 / 1.0035, 6);
    // A conversão não inventa profundidade.
    expect(emUsdc.completo).toBe(true);
  });

  it("paridade exata deixa o preço intacto", () => {
    const p = { compraMedio: 100, vendaMedio: 99, completo: true };
    const c = converterCexParaUsdc(p, 1);
    expect(c.compraMedio).toBe(100);
    expect(c.vendaMedio).toBe(99);
  });

  /**
   * ⚠️ A conversão preserva a RELAÇÃO entre compra e venda — ela desloca os
   * dois pelo mesmo fator, então não pode criar nem destruir spread.
   */
  it("não cria nem destrói spread — desloca os dois pelo mesmo fator", () => {
    const p = { compraMedio: 100, vendaMedio: 99, completo: true };
    const c = converterCexParaUsdc(p, 1.0035);
    expect(c.compraMedio / c.vendaMedio).toBeCloseTo(p.compraMedio / p.vendaMedio, 12);
  });
});

describe("⚠️ o que o veredito precisa DIZER, e não só decidir (01/09)", () => {
  const linha = (o: Partial<LinhaDexCex> & { symbol: string }): LinhaDexCex => ({
    melhorRota: "dex→cex" as const, livroCompleto: true, dexCoerente: true, liquidaPct: 0.5,
    brutaPct: 0.6, custoPct: 0.1, notionalUsd: 5000,
    ...o,
  } as LinhaDexCex);

  /**
   * ⚠️ A frase vai inteira para `lab_results.verdict_text`. Ela descartava os
   * dois números que separam as causas: livro raso é o MERCADO; ida e volta
   * incoerente é a COTAÇÃO. As ações são opostas.
   */
  it("zero utilizáveis: a frase separa livro raso de ida-e-volta incoerente", () => {
    const v = vereditoDexCex([
      linha({ symbol: "A", livroCompleto: false }),
      linha({ symbol: "B", livroCompleto: false }),
      linha({ symbol: "C", dexCoerente: false }),
    ], 2);
    expect(v.status).toBe("inconclusiva");
    expect(v.verdict).toContain("2 fora por livro raso");
    expect(v.verdict).toContain("1 por ida e volta INCOERENTE");
    // ⚠️ a expressão que outro teste assere continua ali, ao pé da letra
    expect(v.verdict).toContain("livro fundo o bastante");
  });

  it("⚠️ a recusa da fonte aparece, e é dita como recusa", () => {
    const v = vereditoDexCex([linha({ symbol: "A", livroCompleto: false })], 2,
      { declarados: 7, recusados: 6 });
    expect(v.verdict).toContain("1 de 7 pares declarados");
    expect(v.verdict).toContain("6 foram RECUSADOS pela fonte");
    expect(v.verdict).toContain("não dizem nada sobre o mercado");
  });

  it("sem recusa, a frase não inventa ressalva", () => {
    const v = vereditoDexCex([linha({ symbol: "A", livroCompleto: false })], 2,
      { declarados: 1, recusados: 0 });
    expect(v.verdict).not.toContain("RECUSADOS");
  });

  /**
   * ⚠️⚠️ O piso é de SÍMBOLOS e comparava LINHAS. Três cotações do ETH dividem o
   * MESMO livro de CEX — contá-las como três símbolos limpava um piso que existe
   * para dizer "um par com borda é um par, não um terreno".
   */
  it("⚠️ três linhas do MESMO símbolo não limpam um piso de 2 símbolos", () => {
    const v = vereditoDexCex([
      linha({ symbol: "ETH", cadeia: "a" }),
      linha({ symbol: "ETH", cadeia: "b" }),
      linha({ symbol: "ETH", cadeia: "c" }),
    ], 2);
    expect(v.status).toBe("inconclusiva");
    expect(v.verdict).toContain("3 linha(s)");
    expect(v.verdict).toContain("1 símbolo(s) distinto(s)");
  });

  it("⚠️ mas dois símbolos DISTINTOS limpam o mesmo piso", () => {
    const v = vereditoDexCex([
      linha({ symbol: "ETH" }),
      linha({ symbol: "BTC" }),
    ], 2);
    expect(v.status).not.toBe("inconclusiva");
  });
});
