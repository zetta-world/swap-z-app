import { describe, expect, it, vi } from "vitest";
import { avaliarSaldoLivreDca, comSaldoLivreDca } from "@/lib/dca/saldo";
import type { CexBalance } from "@/lib/cex/types";

const b = (asset: string, free: number, total: number): CexBalance => ({ asset, free, used: total - free, total });

describe("Batch 2 / A97 — precheck usa FREE", () => {
  it("free suficiente passa", () => {
    expect(avaliarSaldoLivreDca([b("USDT", 120, 120)], "USDT", 100)).toEqual({ ok: true, free: 120 });
  });

  it("TOTAL suficiente mas FREE insuficiente recusa", () => {
    expect(avaliarSaldoLivreDca([b("USDT", 20, 500)], "USDT", 100)).toEqual({
      ok: false, motivo: "saldo_livre_insuficiente", free: 20,
    });
  });

  it("free abaixo do necessário recusa", () => {
    expect(avaliarSaldoLivreDca([b("USDC", 99.99, 99.99)], "USDC", 100).ok).toBe(false);
  });

  it("quote ausente é diferente de erro de leitura", () => {
    expect(avaliarSaldoLivreDca([b("BTC", 1, 1)], "USDT", 100)).toEqual({ ok: false, motivo: "quote_ausente" });
  });

  it("zero FREE é saldo lido e insuficiente, não erro de transporte", () => {
    expect(avaliarSaldoLivreDca([b("USDT", 0, 100)], "USDT", 10)).toEqual({
      ok: false, motivo: "saldo_livre_insuficiente", free: 0,
    });
  });
});

describe("Batch 2 revisão / A97 — falha de balance não alcança reserva/execução", () => {
  it("fetchBalance lança => fail-closed e callback downstream não roda", async () => {
    const reservar = vi.fn(async () => "reservado");
    const executar = vi.fn(async () => "executado");
    const downstream = vi.fn(async () => {
      await reservar();
      await executar();
      return "ok";
    });

    const r = await comSaldoLivreDca({
      quote: "USDT",
      necessario: 100,
      ler: async () => { throw new Error("venue offline"); },
      continuar: downstream,
    });

    expect(r).toEqual({ ok: false, motivo: "leitura_falhou", detalhe: "venue offline" });
    expect(downstream).not.toHaveBeenCalled();
    expect(reservar).not.toHaveBeenCalled();
    expect(executar).not.toHaveBeenCalled();
  });

  it("FREE zero/insuficiente => zero downstream", async () => {
    const downstream = vi.fn(async () => "nunca");
    const zero = await comSaldoLivreDca({
      quote: "USDT", necessario: 10,
      ler: async () => ({ balances: [b("USDT", 0, 100)] }),
      continuar: downstream,
    });
    expect(zero).toEqual({ ok: false, motivo: "saldo_livre_insuficiente", free: 0 });
    expect(downstream).not.toHaveBeenCalled();

    const pouco = await comSaldoLivreDca({
      quote: "USDT", necessario: 100,
      ler: async () => ({ balances: [b("USDT", 20, 500)] }),
      continuar: downstream,
    });
    expect(pouco).toEqual({ ok: false, motivo: "saldo_livre_insuficiente", free: 20 });
    expect(downstream).not.toHaveBeenCalled();
  });

  it("FREE suficiente permite que o caminho posterior prossiga", async () => {
    const downstream = vi.fn(async () => "reservado");
    const r = await comSaldoLivreDca({
      quote: "USDC", necessario: 100,
      ler: async () => ({ balances: [b("USDC", 120, 120)] }),
      continuar: downstream,
    });
    expect(r).toEqual({ ok: true, free: 120, valor: "reservado" });
    expect(downstream).toHaveBeenCalledTimes(1);
  });
});
