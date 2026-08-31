import { describe, it, expect } from "vitest";
import { lerParticipacao, idadeDaPool, TRADES_POR_CARTEIRA_CONCENTRADO } from "@/lib/pro/participacao";

/**
 * ⚠️⚠️ O CAMPO MAIS VALIOSO DO TERMINAL VINHA DE GRAÇA E ERA JOGADO FORA.
 *
 * `GTPoolAttrs` declara `transactions.h24 { buys, sells, buyers, sellers }`. O
 * `fetch` traz, o `JSON.parse` materializa, e `getPoolMeta` descartava.
 *
 * ⚠️ E ELE RESPONDE UMA PERGUNTA QUE NENHUM OUTRO PAINEL RESPONDE. O `ORDER
 * FLOW` mostrava "$626 de compra contra $2,99K de venda" — volume não distingue
 * MIL CARTEIRAS vendendo um pouco de UMA carteira vendendo muito, e as duas
 * dizem o oposto sobre o que está acontecendo.
 */

const cheio = (o: Partial<Parameters<typeof lerParticipacao>[0]> = {}) => ({
  compradores24h: 100, vendedores24h: 100, compras24h: 150, vendas24h: 150, ...o,
} as NonNullable<Parameters<typeof lerParticipacao>[0]>);

describe("⚠️ ausência nunca vira leitura", () => {
  it("meta nula não inventa participação", () => {
    const p = lerParticipacao(null);
    expect(p.classe).toBe("sem_dado");
    expect(p.fracaoCompradores).toBe(null);
  });

  it("⚠️⚠️ faltando UM campo, não se calcula nada", () => {
    // Completar com zero faria "nenhum vendedor" — a leitura mais otimista
    // possível a partir de nenhuma informação, e a mais cara quando errada.
    for (const falta of ["compradores24h", "vendedores24h", "compras24h", "vendas24h"] as const) {
      const p = lerParticipacao(cheio({ [falta]: null }));
      expect(p.classe, falta).toBe("sem_dado");
      expect(p.tradesPorComprador, falta).toBe(null);
    }
  });

  it("pool sem ninguém operando diz isso, e não 50/50", () => {
    const p = lerParticipacao(cheio({ compradores24h: 0, vendedores24h: 0, compras24h: 0, vendas24h: 0 }));
    expect(p.classe).toBe("sem_dado");
    expect(p.leitura).toContain("nenhuma carteira operou");
  });
});

describe("⚠️⚠️ a distinção que o volume não faz", () => {
  it("mil carteiras comprando é AMPLO", () => {
    const p = lerParticipacao(cheio({ compradores24h: 800, vendedores24h: 200, compras24h: 900, vendas24h: 220 }));
    expect(p.classe).toBe("amplo");
    expect(p.leitura).toContain("800 carteiras compraram");
  });

  it("⚠️ UMA carteira comprando mil vezes é CONCENTRADO — mesmo com volume idêntico", () => {
    // Este é o caso que o ORDER FLOW mostrava igual ao de cima.
    const p = lerParticipacao(cheio({ compradores24h: 3, vendedores24h: 200, compras24h: 900, vendas24h: 220 }));
    expect(p.classe).toBe("concentrado");
    expect(p.tradesPorComprador).toBe(300);
    expect(p.leitura).toContain("poucas carteiras repetindo");
  });

  it("o limiar de concentração é 3 trades por carteira", () => {
    expect(TRADES_POR_CARTEIRA_CONCENTRADO).toBe(3);
    const abaixo = lerParticipacao(cheio({ compradores24h: 100, compras24h: 299 }));
    const acima  = lerParticipacao(cheio({ compradores24h: 100, compras24h: 300 }));
    expect(abaixo.classe).not.toBe("concentrado");
    expect(acima.classe).toBe("concentrado");
  });

  it("⚠️ a concentração olha os DOIS lados — vendedor concentrado também conta", () => {
    const p = lerParticipacao(cheio({ vendedores24h: 2, vendas24h: 400 }));
    expect(p.classe).toBe("concentrado");
    expect(p.tradesPorVendedor).toBe(200);
  });

  it("participação parelha é equilibrada, e a frase não finge veredito", () => {
    const p = lerParticipacao(cheio({ compradores24h: 105, vendedores24h: 100 }));
    expect(p.classe).toBe("equilibrado");
    expect(p.leitura).toContain("105 compradores e 100 vendedores");
  });
});

describe("a idade da pool", () => {
  const T = Date.parse("2026-08-31T12:00:00Z");
  it("⚠️ sinal de risco de primeira ordem — e o dado já chegava", () => {
    expect(idadeDaPool(T - 3 * 3_600_000, T)).toBe("3h");
    expect(idadeDaPool(T - 20 * 86_400_000, T)).toBe("20d");
    expect(idadeDaPool(T - 200 * 86_400_000, T)).toBe("7mes");
    // A pool WBNB/USDT da PancakeSwap nasceu em 23/04/2021.
    expect(idadeDaPool(Date.parse("2021-04-23T05:47:25Z"), T)).toBe("5.4a");
  });

  it("ausência devolve `null`, não '0h'", () => {
    expect(idadeDaPool(null)).toBe(null);
    expect(idadeDaPool(Number.NaN)).toBe(null);
  });

  it("data no futuro não vira idade negativa", () => {
    expect(idadeDaPool(T + 86_400_000, T)).toBe(null);
  });
});
