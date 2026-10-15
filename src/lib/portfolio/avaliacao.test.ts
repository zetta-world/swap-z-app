import { describe, expect, it } from "vitest";
import { avaliar, linhasDaCarteira, porValorDesc, temPreco } from "./avaliacao";
import { chaveDePreco, enderecoCanonico } from "@/lib/precos/chave";

describe("A32 · avaliar separa zero conhecido, sem preço e indisponível", () => {
  it("temPreco: número finito ≥ 0 sim; null/undefined/NaN/∞/negativo não", () => {
    expect([0, 1, 0.5].map(temPreco)).toEqual([true, true, true]);
    expect([null, undefined, NaN, Infinity, -1].map(temPreco)).toEqual([false, false, false, false, false]);
  });

  it("soma só o que tem preço; conta o resto; completo só sem faltas", () => {
    expect(avaliar([100, 0, 50])).toEqual({ totalUsd: 150, semPreco: 0, indisponiveis: 0, completo: true });
    expect(avaliar([100, null, undefined])).toEqual({ totalUsd: 100, semPreco: 2, indisponiveis: 0, completo: false });
    expect(avaliar([100], 1)).toEqual({ totalUsd: 100, semPreco: 0, indisponiveis: 1, completo: false });
    expect(avaliar([])).toEqual({ totalUsd: 0, semPreco: 0, indisponiveis: 0, completo: true });
  });

  it("ordem: maior valor primeiro, sem preço no fim (não é 'o menor')", () => {
    expect([null, 5, 0, 20, undefined].sort(porValorDesc)).toEqual([20, 5, 0, null, undefined]);
  });

  it("resumo para o ZION: 'price unavailable' em vez de ~$0.00, e total marcado parcial", () => {
    const l = linhasDaCarteira([
      { symbol: "USDC", chain: "solana", amount: "100", usdValue: null },
      { symbol: "ETH", chain: "ethereum", amount: "1", usdValue: 2000 },
    ], 10);
    expect(l[0]).toBe("  total_portfolio_usd: 2000.00 (partial: 1 asset(s) without price excluded)");
    expect(l[1]).toBe("  - ETH on ethereum: 1 (~$2000.00)");
    expect(l[2]).toBe("  - USDC on solana: 100 (price unavailable)");
    expect(l.join("\n")).not.toContain("~$0.00");
  });

  it("resumo completo não ganha marca de parcial; zero legítimo continua $0.00", () => {
    const l = linhasDaCarteira([{ symbol: "X", chain: "bsc", amount: "5", usdValue: 0 }], 10);
    expect(l).toEqual(["  total_portfolio_usd: 0.00", "  - X on bsc: 5 (~$0.00)"]);
  });
});

describe("A31 · a fronteira de normalização de endereço", () => {
  it("hex EVM vai para minúsculas (checksum é apresentação)", () => {
    expect(enderecoCanonico("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    // id de pool v4 (32 bytes) também é hex
    expect(enderecoCanonico("0xABCDEF" + "0".repeat(58))).toBe("0xabcdef" + "0".repeat(58));
  });

  it("base58 Solana e 'native' passam EXATAMENTE", () => {
    for (const a of ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "So11111111111111111111111111111111111111112", "native"]) {
      expect(enderecoCanonico(a)).toBe(a);
    }
  });

  it("chave: chain em minúsculas, endereço canônico", () => {
    expect(chaveDePreco("Solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(chaveDePreco("ethereum", "0xAbC0000000000000000000000000000000000001")).toBe("ethereum:0xabc0000000000000000000000000000000000001");
    expect(chaveDePreco("ethereum", "native")).toBe("ethereum:native");
  });

  it("não-hex que começa com 0x NÃO é tratado como EVM (não corrompe)", () => {
    expect(enderecoCanonico("0xZZ")).toBe("0xZZ");
  });
});
