/**
 * A TAXA DA CORRETORA versus a que o laboratório SUPÕE — P0.
 *
 * ⚠️ Todo resultado direcional deste laboratório é líquido de um custo que NÓS
 * escolhemos (0,2% por perna). Se essa premissa estiver errada em qualquer
 * direção, três vereditos mudam: a Grade reprovou com custo de 54,27%, e a LP
 * (+0,82%) e a DEX↔CEX (+0,019%) ficaram positivas por margens MENORES que a
 * incerteza do próprio custo.
 */

import { describe, it, expect } from "vitest";
import { medianaDeTaxas, compararCusto, type TaxaDoPar } from "@/lib/cex/taxa-gateio";

const par = (simbolo: string, taxaPct: number): TaxaDoPar =>
  ({ par: `${simbolo}_USDT`, simbolo, taxaPct });

describe("medianaDeTaxas", () => {
  /**
   * ⚠️ MEDIANA, NÃO MÉDIA. Um par exótico com taxa alta puxaria a média para um
   * número que nenhuma mesa paga.
   */
  it("um par caro NÃO desloca a mediana", () => {
    expect(medianaDeTaxas([0.2, 0.2, 0.2, 0.2, 5.0])).toBe(0.2);
  });

  it("com número par de itens, tira a média dos dois do meio", () => {
    expect(medianaDeTaxas([0.1, 0.2, 0.3, 0.4])).toBeCloseTo(0.25, 9);
  });

  it("lista vazia é null, nunca zero", () => {
    expect(medianaDeTaxas([])).toBeNull();
    expect(medianaDeTaxas([Number.NaN])).toBeNull();
  });

  it("taxa negativa é descartada em vez de baixar a mediana", () => {
    expect(medianaDeTaxas([-1, 0.2, 0.2])).toBe(0.2);
  });
});

describe("compararCusto — a leitura é a SOBRA, não a taxa", () => {
  /**
   * ⚠️ O CASO QUE MUDARIA TUDO. Se a taxa publicada já passa do orçamento, todo
   * resultado líquido gravado até hoje está otimista.
   */
  it("taxa acima do modelo → o modelo é INSUFICIENTE só com a taxa", () => {
    const c = compararCusto([par("BTC", 0.3), par("ETH", 0.3)], 0.2);
    expect(c.sobraParaDerrapagemPct).toBeCloseTo(-0.1, 9);
    expect(c.veredito).toContain("INSUFICIENTE");
    expect(c.veredito).toContain("otimista");
  });

  /**
   * ⚠️ O caso do 0x, transposto: taxa 0,15% dentro de um orçamento de 0,2%
   * deixa 0,05 ponto para impacto de preço e gás. É pouco, e a tela precisa
   * dizer isso — não basta "cabe".
   */
  it("sobra menor que o piso de derrapagem → SOBRA APERTADA", () => {
    const c = compararCusto([par("BTC", 0.16), par("ETH", 0.16)], 0.2);
    expect(c.veredito).toContain("APERTADA");
    expect(c.veredito).toContain("otimistas");
  });

  it("sobra confortável diz POSSÍVEL, e recusa dizer CORRETO", () => {
    const c = compararCusto([par("BTC", 0.1), par("ETH", 0.1)], 0.2);
    expect(c.sobraParaDerrapagemPct).toBeCloseTo(0.1, 9);
    expect(c.veredito).toContain("POSSÍVEL");
    expect(c.veredito).toContain("não quer dizer correto");
  });

  /**
   * ⚠️ FONTE MUDA NÃO É TAXA ZERO. Se a Gate.io recusar e devolvermos 0, o
   * laboratório inteiro seria recalibrado para baixo por uma falha de rede.
   */
  it("nenhum par respondeu → NÃO vira taxa zero", () => {
    const c = compararCusto([], 0.2);
    expect(c.taxaPublicadaPct).toBeNull();
    expect(c.sobraParaDerrapagemPct).toBeNull();
    expect(c.veredito).toContain("NÃO é o mesmo que");
  });

  it("a contagem de pares viaja junto — sem ela o número não pode ser julgado", () => {
    expect(compararCusto([par("BTC", 0.2)], 0.2).pares).toBe(1);
  });

  it("o limiar exato de piso conta como apertado, não como confortável", () => {
    // sobra == 0,05 → ainda apertado (o piso é mínimo exigido, não alcançado)
    const c = compararCusto([par("BTC", 0.15)], 0.2);
    expect(c.sobraParaDerrapagemPct).toBeCloseTo(0.05, 9);
    expect(c.veredito).toContain("POSSÍVEL");
  });
});
