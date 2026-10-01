import { describe, expect, it } from "vitest";
import { unidadeDca } from "@/lib/dca/unidade";

describe("Batch 2 / A96 — unidade DCA honesta", () => {
  it.each([
    ["BTC/USDT", "BTC", "USDT"],
    ["ETH/USDC", "ETH", "USDC"],
    ["SOL/USD", "SOL", "USD"],
  ])("aceita %s", (symbol, base, quote) => {
    expect(unidadeDca(symbol)).toEqual({ ok: true, base, quote });
  });

  it.each(["ETH/BTC", "SOL/ETH", "BTC/DAI", "ETH/EUR"])("recusa quote não allowlisted: %s", (symbol) => {
    const r = unidadeDca(symbol);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("quote_nao_usd_like");
  });

  it.each(["BTC", "BTC/", "/USDT", "BTC/USDT/EXTRA", "?"])("recusa par inválido: %s", (symbol) => {
    expect(unidadeDca(symbol)).toEqual({ ok: false, motivo: "par_invalido" });
  });
});
