import { describe, it, expect } from "vitest";
import { isTradeablePool } from "@/lib/zion/ragnarok-dex";

const pool = (over: Partial<Parameters<typeof isTradeablePool>[0]> = {}) => ({
  address: "0xpool", baseSymbol: "TOKEN", tvlUsd: 1_000_000, volume24h: 500_000, ...over,
});

describe("isTradeablePool — liquidez antes de análise técnica", () => {
  it("aceita um pool fundo e movimentado", () => {
    expect(isTradeablePool(pool())).toBe(true);
  });

  it("REJEITA pool raso — o preço existe, a saída não", () => {
    expect(isTradeablePool(pool({ tvlUsd: 10_000 }))).toBe(false);
  });

  it("REJEITA pool sem volume — indicador bonito em mercado morto", () => {
    expect(isTradeablePool(pool({ volume24h: 500 }))).toBe(false);
  });

  it("REJEITA pool parado (giro irrisório contra o TVL)", () => {
    // $50M de TVL girando $150k/dia = 0.3% — ninguém está negociando ali.
    expect(isTradeablePool(pool({ tvlUsd: 50_000_000, volume24h: 150_000 }))).toBe(false);
  });

  it("REJEITA giro absurdo (cheiro de wash trading)", () => {
    // $300k de TVL girando $60M/dia = 200× — não é mercado, é encenação.
    expect(isTradeablePool(pool({ tvlUsd: 300_000, volume24h: 60_000_000 }))).toBe(false);
  });

  it("REJEITA pool sem endereço ou sem símbolo (linha inútil no ledger)", () => {
    expect(isTradeablePool(pool({ address: "" }))).toBe(false);
    expect(isTradeablePool(pool({ baseSymbol: "" }))).toBe(false);
  });

  it("aceita exatamente no piso (limite inclusivo, sem surpresa)", () => {
    expect(isTradeablePool(pool({ tvlUsd: 250_000, volume24h: 100_000 }))).toBe(true);
  });
});
