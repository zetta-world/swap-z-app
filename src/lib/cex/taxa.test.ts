/**
 * A TAXA DA ORDEM EM DÓLARES — item A5 da auditoria do autopilot.
 *
 * ⚠️ A versão anterior era uma linha: taxa fora de stablecoin virava ZERO. E o
 * desdobramento não é cosmético — taxa ignorada faz o P&L realizado sair MAIOR
 * do que foi, o stop de perda conta as perdas a MENOS, e ele dispara mais tarde
 * do que deveria. Um erro que AFROUXA o freio.
 */

import { describe, it, expect } from "vitest";
import { taxaEmUsd } from "@/lib/cex/taxa";
import type { CexOrder } from "@/lib/cex/types";

const ordem = (moeda: string, valor: number) =>
  ({ fee: { currency: moeda, cost: valor } } as unknown as CexOrder);

describe("taxa em stablecoin", () => {
  it("vale o próprio número", () => {
    const r = taxaEmUsd(ordem("USDT", 1.25), 1000, 10, "BTC/USDT");
    expect(r.usd).toBeCloseTo(1.25, 9);
    expect(r.naoPrecificada).toBeNull();
  });

  it("aceita as várias stables, sem depender de caixa", () => {
    for (const m of ["usdt", "USDC", "DAI", "FDUSD"]) {
      expect(taxaEmUsd(ordem(m, 2), 1000, 10, "BTC/USDT").usd).toBe(2);
    }
  });
});

describe("taxa na moeda BASE do par", () => {
  /**
   * ⚠️ RESOLVIDO SEM CONSULTAR PREÇO NENHUM: a venda que acabou de acontecer JÁ
   * é a cotação. `proceeds / filledQty` é o preço realizado. Uma consulta a
   * menos é uma fonte de erro a menos — a mesma razão pela qual o custo de ida
   * e volta do laboratório deixou de depender de dois preços concordarem.
   */
  it("é precificada pelo preço realizado da própria venda", () => {
    // Vendeu 10 BTC por 1.000 → preço realizado 100. Taxa de 0,01 BTC = $1.
    const r = taxaEmUsd(ordem("BTC", 0.01), 1000, 10, "BTC/USDT");
    expect(r.usd).toBeCloseTo(1, 9);
    expect(r.naoPrecificada).toBeNull();
  });

  it("não confunde a base com o par inteiro", () => {
    expect(taxaEmUsd(ordem("ETH", 0.01), 1000, 10, "BTC/USDT").naoPrecificada).not.toBeNull();
  });
});

describe("o que NÃO dá para precificar", () => {
  /**
   * ⚠️ Continuar subtraindo zero é a única saída — inventar preço seria pior.
   * Mas ela para de ser INVISÍVEL: o campo devolve a moeda e o valor para quem
   * chama gravar o evento. É a invariante nº 6: "não medi" tem que ser
   * distinguível de "medi zero".
   */
  it("taxa em BNB num par que não é BNB volta sinalizada, não zerada em silêncio", () => {
    const r = taxaEmUsd(ordem("BNB", 0.002), 1000, 10, "BTC/USDT");
    expect(r.usd).toBe(0);
    expect(r.naoPrecificada).toEqual({ moeda: "BNB", valor: 0.002 });
  });

  it("ausência de taxa não é o mesmo que taxa impossível de precificar", () => {
    const semTaxa = taxaEmUsd({} as CexOrder, 1000, 10, "BTC/USDT");
    expect(semTaxa.usd).toBe(0);
    expect(semTaxa.naoPrecificada).toBeNull();
  });

  it("taxa zero ou negativa não sinaliza nada", () => {
    expect(taxaEmUsd(ordem("BNB", 0), 1000, 10, "BTC/USDT").naoPrecificada).toBeNull();
    expect(taxaEmUsd(ordem("BNB", -1), 1000, 10, "BTC/USDT").naoPrecificada).toBeNull();
  });

  it("par malformado não explode", () => {
    expect(() => taxaEmUsd(ordem("BNB", 1), 1000, 10, "")).not.toThrow();
    expect(taxaEmUsd(ordem("BNB", 1), 1000, 10, "").usd).toBe(0);
  });
});
