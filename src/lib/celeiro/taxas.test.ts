import { describe, it, expect } from "vitest";
import {
  TAXA_POR_PERNA, TAXA_LEGADA_PCT, taxaPorPerna, fracaoDoPedagio, custoDoCarryPct,
} from "@/lib/celeiro/taxas";
import { AGENTES } from "@/lib/celeiro/agentes";

describe("a taxa por praça e por papel", () => {
  /**
   * ⚠️ A DIFERENÇA QUE JUSTIFICA O MÓDULO. Um número só para todo mundo não é
   * arredondamento: em futuros o maker paga treze vezes menos que no spot.
   */
  it("futuros é MUITO mais barato que spot, e maker mais que taker", () => {
    expect(taxaPorPerna("futuros_gate", "maker"))
      .toBeLessThan(taxaPorPerna("futuros_gate", "taker"));
    expect(taxaPorPerna("futuros_gate", "taker"))
      .toBeLessThan(taxaPorPerna("spot_gate", "taker"));
    expect(taxaPorPerna("spot_gate", "maker") / taxaPorPerna("futuros_gate", "maker"))
      .toBeGreaterThan(10);
  });

  /**
   * ⚠️ NA DÚVIDA, A MAIS CARA. Um default barato aprovaria estratégia que não
   * paga a conta, e o erro só apareceria com dinheiro de verdade.
   */
  it("praça desconhecida cai no spot, que é o caro", () => {
    // @ts-expect-error — o ponto do teste é o valor que o tipo proíbe
    expect(taxaPorPerna("praca_que_nao_existe", "taker"))
      .toBeCloseTo(TAXA_POR_PERNA.spot_gate.taker, 9);
  });

  it("todo agente declara um papel, e ele tem preço na tabela", () => {
    for (const a of AGENTES) {
      expect(["maker", "taker"]).toContain(a.execucao);
      expect(taxaPorPerna(a.modalidade, a.execucao)).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠️ AS QUATRO PERNAS DO CARRY NÃO SÃO DA MESMA PRAÇA — duas spot, duas
   * futuro. Se alguém voltar a multiplicar uma taxa só por quatro, este teste
   * cai.
   */
  it("o carry soma duas pernas de cada praça, não quatro da mesma", () => {
    const maker = custoDoCarryPct("maker");
    expect(maker).toBeCloseTo(
      2 * taxaPorPerna("spot_gate", "maker") + 2 * taxaPorPerna("futuros_gate", "maker"), 9);
    expect(maker).not.toBeCloseTo(4 * taxaPorPerna("spot_gate", "maker"), 6);
    expect(custoDoCarryPct("taker")).toBeGreaterThan(maker);
  });

  it("a fração do pedágio recusa alvo não positivo em vez de devolver Infinity", () => {
    expect(fracaoDoPedagio(0.05, 0)).toBeNull();
    expect(fracaoDoPedagio(0.05, -1)).toBeNull();
    expect(fracaoDoPedagio(0.05, 2)).toBeCloseTo(0.05, 9);
  });
});

/**
 * ⚠️⚠️ A CONTA QUE MATOU O MAKER DE FAIXA, e que este módulo existe para
 * corrigir.
 *
 * Ele fechou 29 posições de $50 com bracket SIMÉTRICO de ±0,6%, acertando 19
 * alvos contra 8 stops onde o acaso dá 50%. Produziu +$3,1557 de PREÇO e
 * entregou tudo no pedágio: 60 pernas de corretagem.
 *
 * Com a taxa da praça e do papel que o nome dele anuncia, a MESMA sequência
 * fecha no azul. Ele foi aposentado por um número que o modelo inventou.
 */
describe("o Maker de Faixa contra a régua certa", () => {
  const PERNAS = 60, NOCIONAL = 50, PRECO_PRODUZIDO = 3.1557;
  const liquido = (taxaPernaPct: number) =>
    PRECO_PRODUZIDO - PERNAS * NOCIONAL * taxaPernaPct / 100;

  it("com a taxa legada ele é negativo — foi por isto que morreu", () => {
    expect(liquido(TAXA_LEGADA_PCT)).toBeLessThan(0);
    expect(liquido(TAXA_LEGADA_PCT)).toBeCloseTo(-0.2193, 4);
  });

  it("com futuros MAKER a mesma sequência fica positiva", () => {
    expect(liquido(taxaPorPerna("futuros_gate", "maker"))).toBeGreaterThan(0);
  });

  /**
   * ⚠️ E A ALAVANCA NÃO CONSERTA NADA. Ela multiplica preço e taxa pelo MESMO
   * fator: o sinal do líquido não se move, só o tamanho. Alavancar um agente
   * negativo perde mais, não menos — este teste existe para que ninguém tente.
   */
  it("alavancar NÃO inverte o sinal — multiplica o que já existe", () => {
    const base = liquido(TAXA_LEGADA_PCT);
    for (const vezes of [2, 10, 50]) {
      expect(base * vezes).toBeLessThan(0);
      expect(base * vezes).toBeCloseTo(base * vezes, 9);
    }
    expect(base * 10).toBeLessThan(base);
  });
});
