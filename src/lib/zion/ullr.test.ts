import { describe, it, expect } from "vitest";
import { isWorthAShot, buildShot, poolAgeHours, TARGET_PCT, STOP_PCT } from "@/lib/zion/ullr";
import type { PoolSummary } from "@/lib/api/geckoterminal";

const NOW = Date.parse("2026-07-29T12:00:00Z");
const H = 3_600_000;

const pool = (over: Partial<PoolSummary> = {}): PoolSummary => ({
  id: "p", dex: "uniswap", name: "TOKEN/WETH", network: "base",
  tvlUsd: 200_000, volume24h: 150_000, change24h: 12, priceUsd: 0.05,
  baseSymbol: "TOKEN", quoteSymbol: "WETH", address: "0xpool",
  createdAtMs: NOW - 6 * H,
  ...over,
});

describe("poolAgeHours", () => {
  it("calcula a idade em horas", () => {
    expect(poolAgeHours({ createdAtMs: NOW - 5 * H }, NOW)).toBeCloseTo(5);
  });
  it("devolve null sem data de criação", () => {
    expect(poolAgeHours({ createdAtMs: undefined }, NOW)).toBeNull();
  });
});

describe("isWorthAShot — o arqueiro não atira em tudo", () => {
  it("aceita um lançamento assentado, líquido e com fluxo", () => {
    expect(isWorthAShot(pool(), NOW)).toBe(true);
  });

  it("REJEITA pool jovem demais (ainda no caos do primeiro bloco)", () => {
    expect(isWorthAShot(pool({ createdAtMs: NOW - 0.5 * H }), NOW)).toBe(false);
  });

  it("REJEITA pool velho — não é mais lançamento, é mercado", () => {
    expect(isWorthAShot(pool({ createdAtMs: NOW - 200 * H }), NOW)).toBe(false);
  });

  it("REJEITA idade desconhecida (fail-closed no terreno mais perigoso)", () => {
    expect(isWorthAShot(pool({ createdAtMs: undefined }), NOW)).toBe(false);
  });

  it("REJEITA liquidez insuficiente — a saída não existe", () => {
    expect(isWorthAShot(pool({ tvlUsd: 5_000 }), NOW)).toBe(false);
  });

  it("REJEITA sem volume — não há para quem vender", () => {
    expect(isWorthAShot(pool({ volume24h: 1_000 }), NOW)).toBe(false);
  });

  it("REJEITA o que já subiu demais (pagar a festa dos outros)", () => {
    expect(isWorthAShot(pool({ change24h: 140 }), NOW)).toBe(false);
  });

  it("REJEITA o que está despencando (quem entrou já está saindo)", () => {
    expect(isWorthAShot(pool({ change24h: -60 }), NOW)).toBe(false);
  });

  it("REJEITA preço inválido", () => {
    expect(isWorthAShot(pool({ priceUsd: 0 }), NOW)).toBe(false);
  });
});

describe("buildShot — long-only, assimetria declarada", () => {
  it("compra a mercado com alvo acima e stop abaixo", () => {
    const s = buildShot(pool({ priceUsd: 1 }), "base", 6);
    expect(s.entry).toBe(1);
    expect(s.target).toBeCloseTo(1 + TARGET_PCT / 100);
    expect(s.stop).toBeCloseTo(1 - STOP_PCT / 100);
  });

  it("o alvo é SEMPRE acima e o stop SEMPRE abaixo — nunca um short", () => {
    for (const price of [0.000_001, 0.05, 3.2, 1840]) {
      const s = buildShot(pool({ priceUsd: price }), "base", 6);
      expect(s.target).toBeGreaterThan(s.entry);
      expect(s.stop).toBeLessThan(s.entry);
    }
  });

  it("a assimetria favorece o ganho (alvo maior que o risco)", () => {
    const s = buildShot(pool({ priceUsd: 1 }), "base", 6);
    expect(s.target - s.entry).toBeGreaterThan(s.entry - s.stop);
  });

  it("carrega chain e pool — sem isso não preencheria nem resolveria", () => {
    const s = buildShot(pool(), "solana", 6);
    expect(s.chain).toBe("solana");
    expect(s.pool).toBe("0xpool");
  });
});
