/**
 * A MESA MAKER — e os testes que impedem ela de fabricar lucro.
 *
 * Ver o cabeçalho de `maker.ts`. O resumo: simular ordem limitada é o jeito
 * mais fácil que existe de inventar dinheiro no papel — basta assumir que a
 * ordem encheu. Foi exatamente assim que os +34% do arbiter nasceram.
 *
 * Estes testes existem para que cada otimismo tenha que passar por eles.
 */

import { describe, it, expect } from "vitest";
import {
  fillsBuy, fillsSell, simulateMakerCycle, summarizeMaker, type MakerCycle,
} from "@/lib/zion/maker";
import type { Candle } from "@/lib/api/market-indicators";

const bar = (low: number, high: number, close = (low + high) / 2): Candle =>
  ({ high, low, close, volume: 1 } as Candle);

describe("preenchimento", () => {
  it("compra só enche se a MÍNIMA passou pelo preço", () => {
    expect(fillsBuy(100, bar(99.9, 101))).toBe(true);
    expect(fillsBuy(100, bar(100.0, 101))).toBe(true);   // tocou exatamente
    expect(fillsBuy(100, bar(100.1, 101))).toBe(false);  // chegou perto ≠ encheu
  });

  it("venda só enche se a MÁXIMA passou pelo preço", () => {
    expect(fillsSell(100, bar(99, 100.1))).toBe(true);
    expect(fillsSell(100, bar(99, 99.9))).toBe(false);
  });
});

describe("ciclo maker", () => {
  const P = { buyLimit: 99, sellLimit: 101, feePct: 0.02, ttlBars: 5, stopPct: 0.5 };

  it("as duas pernas: captura o spread menos DUAS taxas maker", () => {
    // Uma barra que passa pelos dois preços.
    const barras = [bar(98.5, 101.5)];
    const c = simulateMakerCycle(barras, barras, P);
    expect(c.outcome).toBe("hedged");
    // (101 − 99)/99 = 2.0202% bruto, menos 0.04 de taxa.
    expect(c.netPct).toBeCloseTo(2.0202 - 0.04, 3);
    expect(c.adversePct).toBe(0);
  });

  it("NADA encheu é o desfecho mais comum, e não custa nem rende", () => {
    const parado = [bar(99.5, 100.5), bar(99.5, 100.5), bar(99.5, 100.5)];
    const c = simulateMakerCycle(parado, parado, P);
    expect(c.outcome).toBe("unfilled");
    expect(c.netPct).toBe(0);
    expect(c.filledBuy).toBe(false);
    expect(c.filledSell).toBe(false);
  });

  /**
   * O CASO QUE JUSTIFICA O PEDIDO DO DONO: "stop com ordem limitada".
   * Perna solta é aposta direcional, e sem stop ela é aposta sem limite.
   */
  it("perna solta que anda contra leva STOP, e o stop paga a mercado", () => {
    // A compra enche na barra 0; depois o preço desaba e a venda nunca enche.
    const compra = [bar(98.5, 99.5), bar(98.0, 99.0), bar(98.0, 98.6)];
    const venda = [bar(98.5, 99.5), bar(98.0, 99.0), bar(98.0, 98.6)];
    const c = simulateMakerCycle(compra, venda, P);
    expect(c.filledBuy).toBe(true);
    expect(c.filledSell).toBe(false);
    expect(c.outcome).toBe("stopped");
    // −0.5 de stop e ainda a taxa da perna que existiu.
    expect(c.netPct).toBeCloseTo(-0.52, 6);
    expect(c.adversePct).toBe(0.5);
  });

  it("perna solta VENDIDA morre na alta, não na queda", () => {
    // Só a venda enche, e o preço sobe contra ela.
    const barras = [bar(100.5, 101.5), bar(101.0, 102.0)];
    const c = simulateMakerCycle(barras, barras, { ...P, buyLimit: 90 });
    expect(c.filledSell).toBe(true);
    expect(c.filledBuy).toBe(false);
    expect(c.outcome).toBe("stopped");
  });

  it("TTL com perna solta desmonta a mercado e paga UMA taxa, não duas", () => {
    // Compra enche (mínima 98.6 ≤ 99); o stop fica em 98.505 e NÃO é tocado; a
    // venda a 101 nunca enche; e o fechamento (98.775) está abaixo da entrada,
    // então o desmonte sai no prejuízo.
    //
    // A primeira versão deste fixture usava bar(98.9, 99.4), cujo fechamento é
    // 99.15 — ACIMA da entrada. O desmonte dava lucro e a asserção de prejuízo
    // falhou. O teste estava errado, não o código.
    const barras = [bar(98.6, 98.95), bar(98.6, 98.95)];
    const c = simulateMakerCycle(barras, barras, { ...P, ttlBars: 2 });
    expect(c.outcome).toBe("unwound");
    expect(c.filledBuy).toBe(true);
    // Saiu no fechamento da última barra, abaixo da entrada → prejuízo.
    expect(c.netPct).toBeLessThan(0);
    // E o preço andou CONTRA — é isso que `adversePct` mede.
    expect(c.adversePct).toBeGreaterThan(0);
  });

  it("o stop NÃO dispara em barra anterior ao fill — não havia posição", () => {
    // Barra 0 despenca (abaixo do stop) mas TAMBÉM enche a venda; a compra
    // nunca enche. Um stop contado antes do fill inventaria uma perda.
    const barras = [bar(101.0, 101.5), bar(100.8, 101.2)];
    const c = simulateMakerCycle(barras, barras, { ...P, buyLimit: 50 });
    expect(c.filledBuy).toBe(false);
    expect(c.filledSell).toBe(true);
    expect(c.outcome).not.toBe("stopped");
  });

  /**
   * ⚠️ O ÚNICO OTIMISMO DECLARADO DO MÓDULO.
   *
   * Se mínima e máxima passaram pelos dois limites na MESMA barra, não dá para
   * saber a ordem dentro dela. Assume-se o caso bom. Fixado em teste para que
   * seja uma escolha visível, não um acidente que ninguém sabe que existe.
   */
  it("os dois limites na mesma barra contam como HEDGED — otimismo declarado", () => {
    const c = simulateMakerCycle([bar(90, 110)], [bar(90, 110)], P);
    expect(c.outcome).toBe("hedged");
  });
});

describe("resumo", () => {
  const ciclo = (o: MakerCycle["outcome"], net: number, adv = 0): MakerCycle => ({
    outcome: o, netPct: net, bars: 1,
    filledBuy: o !== "unfilled", filledSell: o === "hedged", adversePct: adv,
  });

  it("o líquido por ciclo INCLUI os que não encheram — é ele que descreve a mesa", () => {
    const s = summarizeMaker([
      ciclo("hedged", 2), ciclo("unfilled", 0), ciclo("unfilled", 0), ciclo("unfilled", 0),
    ]);
    expect(s.netPerCyclePct).toBeCloseTo(0.5, 6);   // 2 dividido por 4
    expect(s.netPerFilledPct).toBeCloseTo(2, 6);    // a pergunta que sempre parece boa
    expect(s.hedgeRate).toBeCloseTo(0.25, 6);
  });

  /**
   * O CENÁRIO QUE MATA A MESA, e o resumo tem que deixá-lo visível: encher
   * pouco e, quando enche, encher errado. É a seleção adversa em estado puro —
   * você é preenchido justamente quando o mercado está indo contra.
   */
  it("taxa de hedge baixa com stops frequentes vira líquido NEGATIVO", () => {
    const s = summarizeMaker([
      ciclo("hedged", 0.1), ciclo("stopped", -0.52, 0.5), ciclo("stopped", -0.52, 0.5),
      ciclo("unfilled", 0), ciclo("unfilled", 0),
    ]);
    expect(s.netPerCyclePct).toBeLessThan(0);
    expect(s.avgAdversePct).toBeCloseTo(0.5, 6);
    // E a mesa "acerta" 1 de 5, o que sozinho não diz nada sem o tamanho.
    expect(s.hedgeRate).toBeCloseTo(0.2, 6);
  });

  it("amostra vazia não vira número", () => {
    const s = summarizeMaker([]);
    expect(s.cycles).toBe(0);
    expect(s.netPerCyclePct).toBe(0);
  });
});
