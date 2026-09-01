import { describe, it, expect } from "vitest";
import {
  impactoNoLivro, mediana, vereditoPorTamanho, leituraDaDerrapagem,
  TAMANHOS_USD, type LivroDeOfertas, type ImpactoNoTamanho,
} from "@/lib/cex/derrapagem-gateio";
import type { Level } from "@/lib/zion/arb-realism";

/**
 * ⚠️ O BURACO QUE ISTO FECHA (17/08). Todo resultado direcional do laboratório
 * é líquido de 0,2% por perna. A consulta de 15/08 mostrou que a taxa publicada
 * da Gate.io é 0,2% por ordem — a taxa consome o orçamento INTEIRO e sobra ZERO
 * para impacto de preço. Faltava o outro lado: quanto o impacto custa.
 */

/** Livro com degraus previsíveis, para a conta poder ser feita à mão. */
function livro(asks: Level[], bids: Level[]): LivroDeOfertas {
  return { simbolo: "TEST", asks, bids };
}

describe("impacto — a conta contra o topo do livro", () => {
  it("ordem que cabe no primeiro nível tem impacto ZERO", () => {
    // Topo fundo o bastante: preenche tudo a 100 / 99, sem andar.
    const l = livro([[100, 1000]], [[99, 1000]]);
    const r = impactoNoLivro(l, 1000);
    expect(r.compraPct).toBeCloseTo(0, 9);
    expect(r.vendaPct).toBeCloseTo(0, 9);
    expect(r.idaEVoltaPct).toBeCloseTo(0, 9);
    expect(r.livroAcabou).toBe(false);
  });

  it("ordem que anda o livro paga mais caro, e a conta fecha", () => {
    // $150: $100 a 100 (1 unidade) + $50 a 110 (0,4545 un) → VWAP ≈ 103,125
    const l = livro([[100, 1], [110, 10]], [[99, 100]]);
    const r = impactoNoLivro(l, 150);
    expect(r.compraPct).toBeGreaterThan(0);
    expect(r.compraPct!).toBeCloseTo(3.125, 2);
  });

  /**
   * ⚠️ O CASO QUE MAIS IMPORTA. Livro curto significa que o resto da ordem
   * preencheria em preços que nem estão no retrato — o número medido é um
   * PISO. Errar para o lado otimista aqui seria dizer "cabe" sobre um tamanho
   * que a corretora não atende.
   */
  it("livro que acaba antes do tamanho é MARCADO, nunca silencioso", () => {
    const l = livro([[100, 0.5]], [[99, 0.5]]);   // só $50 de cada lado
    const r = impactoNoLivro(l, 10_000);
    expect(r.livroAcabou).toBe(true);
  });

  it("impacto CRESCE com o tamanho — é a propriedade que a tabela existe para mostrar", () => {
    const l = livro([[100, 1], [101, 1], [105, 1], [130, 100]], [[99, 1], [98, 1], [94, 1], [70, 100]]);
    const pequeno = impactoNoLivro(l, 80);
    const grande  = impactoNoLivro(l, 5_000);
    expect(grande.idaEVoltaPct!).toBeGreaterThan(pequeno.idaEVoltaPct!);
  });

  it("livro vazio ou tamanho absurdo devolve null, não zero", () => {
    // ⚠️ Zero significaria "medimos e não há impacto". Null significa "não
    // medimos". Confundir os dois recalibraria o laboratório por causa de uma
    // falha de rede — invariante nº 33.
    expect(impactoNoLivro(livro([], []), 100).idaEVoltaPct).toBeNull();
    expect(impactoNoLivro(livro([[100, 1]], [[99, 1]]), 0).idaEVoltaPct).toBeNull();
    expect(impactoNoLivro(livro([[100, 1]], [[99, 1]]), -5).idaEVoltaPct).toBeNull();
  });
});

describe("mediana — o par típico, não o exótico", () => {
  it("ímpar, par, e ignora buracos", () => {
    expect(mediana([1, 3, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([null, 5, null, 1])).toBe(3);
  });

  /**
   * ⚠️ ESTE CASO EXISTE PORQUE A MUTAÇÃO PASSOU. Trocar a mediana por média
   * não derrubava nada: em `[1,3,2]` e `[1,2,3,4]` as duas dão o MESMO número,
   * e eu tinha escrito três asserções que não distinguiam as duas funções.
   * Teste que não separa o certo do errado é asserção vazia com aparência de
   * cobertura.
   *
   * E o caso assimétrico é justamente a razão de ser da mediana aqui: um par
   * fino, com impacto de 20%, não pode arrastar o número que descreve o par
   * que as mesas de fato operam.
   */
  it("um par exótico NÃO arrasta o número — mediana ≠ média", () => {
    const comExotico = [0.02, 0.03, 0.04, 0.05, 20];
    expect(mediana(comExotico)).toBe(0.04);
    const media = comExotico.reduce((a, b) => a + b, 0) / comExotico.length;
    expect(media).toBeGreaterThan(3);          // a média mentiria por 100×
    expect(mediana(comExotico)).toBeLessThan(media);
  });
  it("tudo nulo devolve null — sem dado não há mediana", () => {
    expect(mediana([null, null])).toBeNull();
    expect(mediana([])).toBeNull();
  });
});

describe("veredito — impacto SOMADO à taxa, que é o que decide", () => {
  const imp = (idaEVolta: number | null, curto = false): ImpactoNoTamanho => ({
    usd: 50, compraPct: 0, vendaPct: 0, idaEVoltaPct: idaEVolta, livroAcabou: curto,
  });

  /**
   * ⚠️ O CASO REAL DE HOJE: taxa de 0,2%/perna contra orçamento de 0,2%/perna.
   * A taxa sozinha já consome tudo, então QUALQUER impacto positivo estoura.
   */
  it("com a taxa medida da Gate.io, qualquer derrapagem já não cabe", () => {
    const v = vereditoPorTamanho(50, [imp(0.05)], 0.2, 0.2);
    expect(v.sobraPct).toBeCloseTo(-0.05, 6);   // 0,4 − 0,4 − 0,05
    expect(v.cabe).toBe(false);
  });

  it("com taxa menor, sobra espaço e o veredito muda", () => {
    const v = vereditoPorTamanho(50, [imp(0.05)], 0.1, 0.2);
    expect(v.sobraPct).toBeCloseTo(0.15, 6);    // 0,4 − 0,2 − 0,05
    expect(v.cabe).toBe(true);
  });

  /**
   * ⚠️⚠️ O DEFEITO DE 31/08, VIRADO TESTE. A rota chamava com `taxaPorPernaPct ?? 0`
   * três linhas abaixo de um comentário que dizia "SEM TAXA MEDIDA, O VEREDITO NÃO
   * É INVENTADO". Com 429 na Gate a mediana saía `null`, o `?? 0` a virava zero, e
   * a sobra de 0,4 APROVAVA $50 numa rodada em que a taxa nunca foi lida.
   */
  it("⚠️ TAXA não medida anula a sobra — e nunca aprova", () => {
    const v = vereditoPorTamanho(50, [imp(0.05)], null, 0.2);
    expect(v.sobraPct).toBeNull();
    expect(v.cabe).toBe(false);
  });

  it("⚠️ e o zero que significa 'a corretora cobra zero' continua sendo medição", () => {
    const v = vereditoPorTamanho(50, [imp(0.05)], 0, 0.2);
    expect(v.sobraPct).toBeCloseTo(0.35, 6);   // 0,4 − 0 − 0,05
    expect(v.cabe).toBe(true);
  });

  it("⚠️ o tamanho é PARÂMETRO — não colapsa em 0 quando nenhum livro responde", () => {
    const v = vereditoPorTamanho(5000, [], 0.2, 0.2);
    expect(v.usd).toBe(5000);          // não 0
    expect(v.idaEVoltaPct).toBeNull();
    expect(v.cabe).toBe(false);
  });

  it("SEM medição nunca é 'cabe' — ausência não vira aprovação", () => {
    const v = vereditoPorTamanho(50, [imp(null)], 0.2, 0.2);
    expect(v.idaEVoltaPct).toBeNull();
    expect(v.sobraPct).toBeNull();
    expect(v.cabe).toBe(false);
  });

  it("conta quantos pares tiveram livro curto — o número é piso quando há algum", () => {
    const v = vereditoPorTamanho(50, [imp(0.1), imp(0.2, true), imp(0.3, true)], 0.2, 0.2);
    expect(v.paresComLivroCurto).toBe(2);
    expect(v.pares).toBe(3);
    expect(leituraDaDerrapagem(v)).toContain("MAIOR que este");
  });
});

describe("a leitura da tela diz o que o número SIGNIFICA", () => {
  it("estourou: nomeia a margem e diz que o gravado está otimista", () => {
    const t = leituraDaDerrapagem(vereditoPorTamanho(5000, [{ usd: 5000, compraPct: 0, vendaPct: 0, idaEVoltaPct: 0.9, livroAcabou: false }], 0.2, 0.2));
    expect(t).toContain("faltam");
    expect(t).toContain("OTIMISTA");
    expect(t).toContain("$5k");
  });

  it("sem dado NÃO vira derrapagem zero", () => {
    const t = leituraDaDerrapagem(vereditoPorTamanho(50, [{ usd: 50, compraPct: null, vendaPct: null, idaEVoltaPct: null, livroAcabou: true }], 0.2, 0.2));
    expect(t).toContain("NÃO é o mesmo que derrapagem zero");
  });
});

describe("os tamanhos medidos", () => {
  /**
   * ⚠️ $50 É O QUE AS MESAS OPERAM HOJE (`cost_usd` = 49,99 nas posições
   * abertas). Sem ele a tabela responderia sobre um laboratório que não é o
   * nosso; sem os grandes, não responderia "até quanto posso crescer?".
   */
  it("cobre o tamanho REAL de hoje e os degraus de crescimento", () => {
    expect(TAMANHOS_USD).toContain(50);
    expect(Math.max(...TAMANHOS_USD)).toBeGreaterThanOrEqual(25_000);
    expect([...TAMANHOS_USD]).toEqual([...TAMANHOS_USD].sort((a, b) => a - b));
  });
});
