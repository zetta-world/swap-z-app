import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCowOrder } from "@/lib/limit/cow";
import { mapCardToCexIntent } from "@/lib/zion/card-mapping";
import type { ActionCard } from "@/lib/zion/parse";

const ADDRESS = "0x0000000000000000000000000000000000000001" as const;
const OTHER = "0x0000000000000000000000000000000000000002" as const;

function buyLimit(amount: string, price = "2.000,00"): ActionCard {
  return {
    kind: "buy_limit",
    title: "locale-test",
    summary: "locale-test",
    chain: "ethereum",
    from: { symbol: "USDC", address: ADDRESS, amount },
    to: { symbol: "ETH", address: OTHER },
    triggerPrice: price,
    entryPrice: price,
  };
}

describe("PC-1 — locale financeiro nos caminhos executáveis", () => {
  it("CoW assina 0,5 USDC como 500000 unidades-base, nunca como 5 USDC", () => {
    const built = buildCowOrder({
      card: buyLimit("0,5"),
      maker: ADDRESS,
      sellToken: ADDRESS,
      buyToken: OTHER,
      sellDecimals: 6,
      buyDecimals: 18,
    });
    expect(built.message.sellAmount).toBe("500000");
    expect(built.message.buyAmount).toBe("250000000000000");
  });

  it("CoW preserva sellAmount E buyAmount acima de 2^53", () => {
    const built = buildCowOrder({
      card: buyLimit("9007199254740993", "2000,00"),
      maker: ADDRESS,
      sellToken: ADDRESS,
      buyToken: OTHER,
      sellDecimals: 6,
      buyDecimals: 18,
    });
    expect(built.message.sellAmount).toBe("9007199254740993000000");
    expect(built.message.buyAmount).toBe("4503599627370496500000000000000");
  });

  it("CoW falha fechado em quantia ambígua", () => {
    expect(() => buildCowOrder({
      card: buyLimit("3,420"),
      maker: ADDRESS,
      sellToken: ADDRESS,
      buyToken: OTHER,
      sellDecimals: 6,
      buyDecimals: 18,
    })).toThrow(/ambiguous|invalid/i);
  });

  it("ZION→CEX aceita vírgula decimal depois da normalização", () => {
    const intent = mapCardToCexIntent(buyLimit("0,5", "2000,00"));
    expect(intent).not.toBeNull();
    expect(intent?.notionalUsd).toBe(0.5);
    expect(intent?.amount).toBe(0.00025);
  });

  it("ZION→CEX recusa quantia ou preço ambíguos", () => {
    expect(mapCardToCexIntent(buyLimit("3,420", "2000,00"))).toBeNull();
    expect(mapCardToCexIntent(buyLimit("0,5", "3.420"))).toBeNull();
  });

  it("portal de Swap converte amountIn diretamente como string", () => {
    const source = readFileSync("src/components/swap/ExecuteSwapPortal.tsx", "utf8");
    expect(source).toContain("toBaseUnits(amountIn, fromToken.decimals)");
    expect(source).not.toContain("parseDecimalInput(amountIn)");
    expect(source).not.toMatch(/amt\.toString\(\)/);
  });
});
