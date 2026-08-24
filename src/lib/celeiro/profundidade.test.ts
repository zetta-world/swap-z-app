import { describe, it, expect } from "vitest";
import {
  andarOLivro, portaoDeProfundidade, derrapagemEmUsdt, converterLivro,
  TETO_DE_DERRAPAGEM_PCT, type Nivel,
} from "@/lib/celeiro/profundidade";

/**
 * O PORTÃO DE PROFUNDIDADE — os testes que impedem o cadáver de voltar.
 *
 * ⚠️ A arbitragem da arena antiga contabilizou lucro por semanas lendo o TOPO
 * do livro. Andando a profundidade, em 4.085 medições: teórico +0,451%,
 * realista −0,629%, e só 17 sobreviventes. A sonda existia e não bloqueava
 * nada. Estes testes são o que transforma a sonda em portão.
 */

/** Livro com níveis que encarecem — o formato normal de um book de venda. */
const LIVRO: Nivel[] = [
  { preco: 100, quantidade: 1 },   // 100 USD no topo
  { preco: 101, quantidade: 1 },   // +101
  { preco: 110, quantidade: 10 },  // +1100, bem mais caro
];

describe("andar o livro", () => {
  /**
   * ⚠️ O CASO QUE SEPARA COTAÇÃO DE LIQUIDEZ. Pedindo 100 USD, o topo basta e o
   * preço médio É o preço do topo. Pedindo 201, consome dois níveis e o médio
   * sobe. Se alguém trocar o preço médio ponderado pelo preço do topo, o
   * primeiro caso continua verde e o segundo quebra — é por isso que os dois
   * estão aqui.
   */
  it("dentro do topo, o médio é o topo; passando dele, encarece", () => {
    const so100 = andarOLivro(LIVRO, 100);
    expect(so100.preencheu).toBe(true);
    expect(so100.precoMedio).toBeCloseTo(100, 9);

    const ate201 = andarOLivro(LIVRO, 201);
    expect(ate201.preencheu).toBe(true);
    // 1 unidade a 100 + 1 a 101 = 201 USD por 2 unidades = 100,50
    expect(ate201.precoMedio).toBeCloseTo(100.5, 9);
    expect(ate201.precoDoTopo).toBe(100);
  });

  /**
   * ⚠️ LIVRO FINO É UMA RESPOSTA, NÃO UMA FALHA. Significa que o preço de topo
   * não existe no tamanho pedido. `preencheu: false` com o quanto cobriu é o
   * que permite ao portão dizer POR QUE recusou.
   */
  it("tamanho maior que o livro não preenche, e diz quanto cobriu", () => {
    const c = andarOLivro(LIVRO, 5000);
    expect(c.preencheu).toBe(false);
    expect(c.usdPreenchido).toBeCloseTo(100 + 101 + 1100, 9);
  });

  it("níveis inválidos são ignorados, não consertados", () => {
    const sujo: Nivel[] = [
      { preco: 0, quantidade: 5 },
      { preco: 100, quantidade: -1 },
      { preco: 100, quantidade: 1 },
    ];
    const c = andarOLivro(sujo, 100);
    expect(c.preencheu).toBe(true);
    expect(c.precoMedio).toBeCloseTo(100, 9);
    expect(c.precoDoTopo).toBe(100);
  });

  it("livro vazio ou alvo inválido não preenche nada", () => {
    expect(andarOLivro([], 100).preencheu).toBe(false);
    expect(andarOLivro(LIVRO, 0).preencheu).toBe(false);
    expect(andarOLivro(LIVRO, -5).precoMedio).toBeNull();
  });
});

describe("o portão", () => {
  /**
   * ⚠️⚠️ O TESTE MAIS IMPORTANTE DO ARQUIVO. Livro não lido REPROVA. A
   * alternativa é abrir posição na ausência de evidência — exatamente o hábito
   * que produziu o cadáver. `inconclusivo ≠ aprovado`.
   */
  it("livro não lido reprova, e não passa por omissão", () => {
    const v = portaoDeProfundidade(null, 100);
    expect(v.passa).toBe(false);
    expect(v.derrapagemPct).toBeNull();
    expect(v.porque).toContain("não medido não é aprovado");
  });

  it("livro sem profundidade para o tamanho reprova", () => {
    const v = portaoDeProfundidade(LIVRO, 5000);
    expect(v.passa).toBe(false);
    expect(v.porque).toContain("sem profundidade");
  });

  /**
   * ⚠️ O MESMO LIVRO APROVA UM TAMANHO E REPROVA OUTRO — é a razão de o ranking
   * ser separado por faixa de capital. 100 USD passam com 0% de derrapagem; 800
   * USD atravessam o nível de 110 e estouram o teto. Se o portão ignorasse o
   * tamanho, os dois teriam o mesmo veredito.
   */
  it("o veredito depende do TAMANHO, não só do livro", () => {
    const pequeno = portaoDeProfundidade(LIVRO, 100);
    expect(pequeno.passa).toBe(true);
    expect(pequeno.derrapagemPct).toBeCloseTo(0, 9);

    const grande = portaoDeProfundidade(LIVRO, 800);
    expect(grande.passa).toBe(false);
    expect(grande.derrapagemPct).toBeGreaterThan(TETO_DE_DERRAPAGEM_PCT);
    expect(grande.porque).toContain("acima do teto");
  });

  /** O teto é parâmetro: afrouxá-lo é uma decisão explícita, não um acidente. */
  it("teto afrouxado deixa passar o que o teto padrão recusa", () => {
    expect(portaoDeProfundidade(LIVRO, 800, 0.15).passa).toBe(false);
    expect(portaoDeProfundidade(LIVRO, 800, 50).passa).toBe(true);
  });
});

describe("a derrapagem no extrato", () => {
  /**
   * ⚠️ SEMPRE NEGATIVA — é uma SAÍDA de USDT. E vira linha própria, separada de
   * `taxa` e de `preco`: foi não separar as causas que impediu a arena antiga
   * de explicar como uma mesa acerta 70% e perde dinheiro.
   */
  it("devolve valor negativo, proporcional ao tamanho", () => {
    expect(derrapagemEmUsdt(1000, 0.5)).toBeCloseTo(-5, 9);
    expect(derrapagemEmUsdt(2000, 0.5)).toBeCloseTo(-10, 9);
  });

  it("sem derrapagem ou sem tamanho, não lança linha", () => {
    expect(derrapagemEmUsdt(1000, 0)).toBe(0);
    expect(derrapagemEmUsdt(0, 0.5)).toBe(0);
    expect(derrapagemEmUsdt(1000, Number.NaN)).toBe(0);
  });
});

describe("a conversão do livro da Gate.io", () => {
  it("lê o formato [[preço, quantidade], ...]", () => {
    const n = converterLivro([["100.5", "2"], ["101", "3"]]);
    expect(n).toEqual([{ preco: 100.5, quantidade: 2 }, { preco: 101, quantidade: 3 }]);
  });

  /**
   * ⚠️ `null` E NUNCA `[]`. Lista vazia passaria por "livro sem ofertas", que o
   * portão trataria como medição; `null` é o que ele trata como ausência de
   * medição — e a diferença entre os dois é abrir ou não abrir posição.
   */
  it("resposta ruim devolve null, não lista vazia", () => {
    expect(converterLivro(null)).toBeNull();
    expect(converterLivro({})).toBeNull();
    expect(converterLivro([])).toBeNull();
    expect(converterLivro([["abacaxi", "2"]])).toBeNull();
    // E o null que sai daqui tem de reprovar no portão, fechando o circuito.
    expect(portaoDeProfundidade(converterLivro([]), 100).passa).toBe(false);
  });
});
