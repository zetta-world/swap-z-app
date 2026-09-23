import { describe, expect, it } from "vitest";
import { buildCowOrder } from "@/lib/limit/cow";
import type { ActionCard } from "@/lib/zion/parse";

const MAKER = "0x0000000000000000000000000000000000000001" as const;
const SELL = "0x0000000000000000000000000000000000000002" as const;
const BUY = "0x0000000000000000000000000000000000000003" as const;

function card(kind: "buy_limit" | "sell_safe", amount: string, price: string): ActionCard {
  const isBuy = kind === "buy_limit";
  return {
    kind,
    title: "cow-exact-test",
    summary: "cow-exact-test",
    chain: "ethereum",
    from: { symbol: isBuy ? "USDC" : "ETH", address: SELL, amount },
    to: { symbol: isBuy ? "ETH" : "USDC", address: BUY },
    triggerPrice: price,
    entryPrice: price,
  };
}

function build(
  kind: "buy_limit" | "sell_safe",
  amount: string,
  price: string,
  sellDecimals: number,
  buyDecimals: number,
) {
  return buildCowOrder({
    card: card(kind, amount, price),
    maker: MAKER,
    sellToken: SELL,
    buyToken: BUY,
    sellDecimals,
    buyDecimals,
  });
}

describe("PC-1 R2 — CoW buyAmount exato no payload EIP-712", () => {
  it("COW-P1 — 0,5 preserva sellAmount real do payload", () => {
    const built = build("buy_limit", "0,5", "2000,00", 6, 18);
    expect(built.message.sellAmount).toBe("500000");
    expect(built.message.buyAmount).toBe("250000000000000");
  });

  it("COW-P2 — preço 3.420,50 é normalizado exatamente", () => {
    const built = build("sell_safe", "1", "3.420,50", 18, 6);
    expect(built.message.sellAmount).toBe("1000000000000000000");
    expect(built.message.buyAmount).toBe("3420500000");
  });

  it("COW-P3 — acima de 2^53 mantém sellAmount e buyAmount matematicamente exatos", () => {
    const built = build("sell_safe", "9007199254740993", "2", 0, 0);
    expect(built.message.sellAmount).toBe("9007199254740993");
    expect(built.message.buyAmount).toBe("18014398509481986");
  });

  it("COW-P4 — 18 casas sobrevivem até o payload", () => {
    const built = build("sell_safe", "0.123456789012345678", "2", 18, 18);
    expect(built.message.sellAmount).toBe("123456789012345678");
    expect(built.message.buyAmount).toBe("246913578024691356");
  });

  it("COW-P5 — preço decimal longo é multiplicado por razão BigInt exata", () => {
    const built = build("sell_safe", "1", "2000.123456789012345678", 18, 18);
    expect(built.message.sellAmount).toBe("1000000000000000000");
    expect(built.message.buyAmount).toBe("2000123456789012345678");
  });

  it("COW-P6 — BUY LIMIT calcula quote / price exatamente", () => {
    const built = build("buy_limit", "1000", "4", 6, 18);
    expect(built.message.sellAmount).toBe("1000000000");
    expect(built.message.buyAmount).toBe("250000000000000000000");
  });

  it("COW-P7 — SELL LIMIT calcula base × price exatamente", () => {
    const built = build("sell_safe", "2,5", "3420,50", 18, 6);
    expect(built.message.sellAmount).toBe("2500000000000000000");
    expect(built.message.buyAmount).toBe("8551250000");
  });

  it("COW-P8 — CEIL mantém o mínimo assinado acima do floor", () => {
    // 10 / 3 = 3.333...; para kind=sell, buyAmount é MINIMUM RECEIVE.
    // floor=3 relaxaria o limite; o payload correto precisa assinar 4.
    const built = build("buy_limit", "10", "3", 0, 0);
    expect(built.message.sellAmount).toBe("10");
    expect(built.message.buyAmount).toBe("4");
    expect(10n / 3n).toBe(3n); // prova explícita de que floor seria menor.
  });

  it("COW-P9 — separador único de três casas continua fail-closed", () => {
    for (const price of ["3,420", "3.420"]) {
      expect(() => build("sell_safe", "1", price, 18, 6)).toThrow(/invalid|ambiguous/i);
    }
    for (const amount of ["3,420", "3.420"]) {
      expect(() => build("sell_safe", amount, "2", 18, 6)).toThrow(/invalid|ambiguous/i);
    }
  });

  it("COW-P10 — zero, expoente, inválido e lixo continuam fail-closed", () => {
    for (const amount of ["0", "1e3", "abc", "--1"]) {
      expect(() => build("sell_safe", amount, "2", 18, 6)).toThrow();
    }
    for (const price of ["0", "1e3", "abc2000", "2/1"]) {
      expect(() => build("sell_safe", "1", price, 18, 6)).toThrow();
    }
  });
});
