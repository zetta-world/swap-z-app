import { describe, it, expect } from "vitest";
import {
  lancamentosDaAbertura, lancamentosDoFechamento, movimentoPct, deveFechar,
  conferir, TAXA_POR_PERNA_PCT, type Abertura,
} from "@/lib/celeiro/posicao";

/**
 * A POSIÇÃO — os testes que fazem os agentes OPERAREM em vez de só julgarem.
 *
 * ⚠️ Até 21/08 os agentes tinham `decidir()`, `deveCotar()` e
 * `portaoDeSobrevivencia()` e nada mais: cabeça sem mão. Este módulo é a mão, e
 * a invariante dele é a contabilidade — se a soma das causas não bate com o
 * dinheiro movido, o extrato mente e tudo que se apoia nele vira ficção.
 */

const COMPRA: Abertura = {
  agente: "maker_de_faixa", simbolo: "BTC", lado: "buy",
  usd: 1000, precoEntrada: 100, alvo: 104, stop: 98,
  derrapagemPct: 0.05, horasLimite: 8,
};
const VENDA: Abertura = { ...COMPRA, lado: "sell", alvo: 96, stop: 102 };

describe("o movimento de preço", () => {
  /**
   * ⚠️⚠️ VENDIDO GANHA QUANDO CAI. Usar sempre `(saida−entrada)` inverteria o
   * sinal de toda posição vendida — o extrato mostraria lucro como prejuízo, e o
   * Investigador proporia mutações para consertar um vazamento inexistente.
   */
  it("o sinal segue o LADO, não a direção do preço", () => {
    expect(movimentoPct("buy", 100, 104)).toBeCloseTo(4, 9);
    expect(movimentoPct("buy", 100, 96)).toBeCloseTo(-4, 9);
    expect(movimentoPct("sell", 100, 96)).toBeCloseTo(4, 9);
    expect(movimentoPct("sell", 100, 104)).toBeCloseTo(-4, 9);
  });

  it("preço inválido não vira movimento", () => {
    expect(movimentoPct("buy", 0, 104)).toBe(0);
    expect(movimentoPct("buy", 100, 0)).toBe(0);
  });
});

describe("os lançamentos", () => {
  /**
   * ⚠️ SÓ UMA PERNA NA ABERTURA. Cobrar as duas faria toda posição VIVA parecer
   * pior do que é — e uma posição que ainda não fechou não pagou a saída.
   */
  it("a abertura paga uma perna, não duas", () => {
    const l = lancamentosDaAbertura(COMPRA);
    const taxa = l.filter((x) => x.causa === "taxa");
    expect(taxa).toHaveLength(1);
    expect(taxa[0].usdt).toBeCloseTo(-(1000 * TAXA_POR_PERNA_PCT / 100), 9);
  });

  /**
   * ⚠️ A DERRAPAGEM É LINHA PRÓPRIA, nunca embutida no preço. Embutir diria "o
   * preço andou contra" quando o que houve foi o livro cobrar caro — e foi não
   * separar causas que impediu a arena antiga de explicar como uma mesa acerta
   * 70% e perde dinheiro.
   */
  it("a derrapagem sai separada da taxa e do preço", () => {
    const l = lancamentosDaAbertura(COMPRA);
    const d = l.find((x) => x.causa === "derrapagem");
    expect(d?.usdt).toBeCloseTo(-(1000 * 0.05 / 100), 9);

    // Sem derrapagem, a linha não é criada — extrato não guarda zero.
    expect(lancamentosDaAbertura({ ...COMPRA, derrapagemPct: 0 })
      .some((x) => x.causa === "derrapagem")).toBe(false);
  });

  it("o fechamento traz o movimento e a segunda perna", () => {
    const l = lancamentosDoFechamento(COMPRA, { precoSaida: 104, motivo: "alvo" });
    expect(l.find((x) => x.causa === "preco")?.usdt).toBeCloseTo(40, 9);
    expect(l.find((x) => x.causa === "taxa")?.usdt).toBeCloseTo(-(1000 * TAXA_POR_PERNA_PCT / 100), 9);
  });
});

describe("quando fechar", () => {
  /**
   * ⚠️⚠️ STOP ANTES DO ALVO. Numa vela que tocou os dois, assumir o alvo
   * contaria como ganho um caminho que pode ter passado pelo stop primeiro — o
   * viés otimista clássico de backtest, que infla resultado sem nenhum erro
   * aparecer na tela. Na dúvida, o pior caso.
   */
  it("tocando os dois, o stop vence", () => {
    // Preço abaixo do stop E acima do alvo é impossível num instante, mas o
    // teste força a ordem de verificação com um preço que satisfaz ambos.
    const ambiguo: Abertura = { ...COMPRA, alvo: 99, stop: 101 };
    const f = deveFechar(ambiguo, 100, 1);
    expect(f?.motivo).toBe("stop");
  });

  it("compra fecha no alvo acima e no stop abaixo", () => {
    expect(deveFechar(COMPRA, 104, 1)?.motivo).toBe("alvo");
    expect(deveFechar(COMPRA, 97, 1)?.motivo).toBe("stop");
    expect(deveFechar(COMPRA, 101, 1)).toBeNull();
  });

  /** Vendida é o espelho: alvo ABAIXO, stop ACIMA. */
  it("venda fecha no alvo abaixo e no stop acima", () => {
    expect(deveFechar(VENDA, 96, 1)?.motivo).toBe("alvo");
    expect(deveFechar(VENDA, 103, 1)?.motivo).toBe("stop");
    expect(deveFechar(VENDA, 99, 1)).toBeNull();
  });

  /**
   * ⚠️ POR TEMPO SAI NO PREÇO CORRENTE, não no alvo nem no stop. É o único caso
   * em que o preço de saída não foi escolhido por nós — fingir o contrário
   * inventaria resultado.
   */
  it("por tempo sai no preço de mercado", () => {
    const f = deveFechar(COMPRA, 101.37, 8);
    expect(f?.motivo).toBe("tempo");
    expect(f?.precoSaida).toBeCloseTo(101.37, 9);
  });
});

describe("a conferência da contabilidade", () => {
  /**
   * ⚠️⚠️ A GUARDA DE TUDO. Se a soma das causas não reproduz o dinheiro movido,
   * o extrato mente — e ranking, comparação com o controle e o Investigador
   * passam a raciocinar sobre ficção.
   *
   * Conta no papel, compra que bate o alvo: preço +40,00 · duas pernas −2,25 ·
   * derrapagem −0,50 = **+37,25**.
   */
  it("compra no alvo: as causas reproduzem o P&L", () => {
    const c = conferir(COMPRA, { precoSaida: 104, motivo: "alvo" });
    expect(c.bate).toBe(true);
    expect(c.somaDosLancamentos).toBeCloseTo(40 - 2.25 - 0.5, 9);
    expect(c.somaDosLancamentos).toBeCloseTo(37.25, 9);
  });

  /**
   * ⚠️ E FECHA TAMBÉM NO LADO VENDIDO, que é onde o sinal inverte. Um teste só
   * com compra deixaria passar a troca de sinal em toda posição vendida.
   */
  it("venda no alvo: as causas reproduzem o P&L", () => {
    const c = conferir(VENDA, { precoSaida: 96, motivo: "alvo" });
    expect(c.bate).toBe(true);
    expect(c.somaDosLancamentos).toBeCloseTo(40 - 2.25 - 0.5, 9);
  });

  /** No stop a conta também tem de fechar — inclusive perdendo. */
  it("no stop, o prejuízo também é decomposto sem sobra", () => {
    const c = conferir(COMPRA, { precoSaida: 98, motivo: "stop" });
    expect(c.bate).toBe(true);
    expect(c.somaDosLancamentos).toBeCloseTo(-20 - 2.25 - 0.5, 9);
  });

  /**
   * ⚠️ O CASO QUE PROVA QUE A CONFERÊNCIA NÃO É DECORATIVA. Se a taxa fosse
   * cobrada só uma vez, a soma daria 0,5625 a mais que o esperado — e `bate`
   * teria de virar false. Aqui verifico que o esperado NÃO é a soma ingênua.
   */
  it("o esperado inclui as DUAS pernas, não uma", () => {
    const c = conferir(COMPRA, { precoSaida: 104, motivo: "alvo" });
    const umaPernaSo = 40 - (1000 * TAXA_POR_PERNA_PCT / 100) - 0.5;
    expect(c.esperado).not.toBeCloseTo(umaPernaSo, 6);
    expect(umaPernaSo - c.esperado).toBeCloseTo(1000 * TAXA_POR_PERNA_PCT / 100, 9);
  });
});
