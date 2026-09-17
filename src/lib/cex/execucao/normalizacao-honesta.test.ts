/**
 * ⚠️⚠️ A129 (round 8, §45–§47) — A NORMALIZAÇÃO HONESTA DO HISTÓRICO.
 *
 * O defeito: `normalizarTrade` devolvia `null` e o pipeline fazia
 * `.filter(t => t !== null)` — a linha malformada DESAPARECIA em silêncio: nem
 * trade, nem evidência, e o veredito "sem drift" saía sobre um histórico
 * parcialmente ilegível.
 *
 * Agora: o inválido NUNCA entra em `historico.trades` (o settlement está
 * protegido por construção), mas é CONTADO E CLASSIFICADO em
 * `registrosInvalidos` — e no reconciliador, inválidos > 0 sem órfão é
 * INDETERMINADO; com órfão à vista, a DERIVA vence (precedência §40).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import {
  lerOrdemNaVenue, normalizarTrade,
} from "@/lib/cex/execucao/venue-leitura";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { CexCredentials } from "@/lib/cex/types";

class OrderNotFound extends Error {}

interface ExchangeFalso {
  fetchOrder: ReturnType<typeof vi.fn>;
  fetchMyTrades: ReturnType<typeof vi.fn>;
  fetchClosedOrders: ReturnType<typeof vi.fn>;
  createOrder: ReturnType<typeof vi.fn>;
}

const hoisted = vi.hoisted(() => ({ exchange: null as ExchangeFalso | null }));

vi.mock("@/lib/cex/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cex/server")>();
  return {
    ...real,
    instanciarExchange: vi.fn(async () => {
      if (!hoisted.exchange) throw new Error("exchange falsa não montada");
      return hoisted.exchange;
    }),
  };
});

const CREDS: CexCredentials = { apiKey: "k", apiSecret: "s" };
const VELHO = new Date(Date.now() - 10 * 60_000).toISOString();

function ordemRaw(id: string, filled: number, status = "closed") {
  return { id, symbol: "BTC/USDT", side: "buy", type: "market", status,
           amount: 10, filled, remaining: Math.max(0, 10 - filled),
           average: 100, cost: filled * 100, timestamp: Date.now() };
}

function tradeRaw(id: string, order: string | null, qty = 1, price = 100) {
  return { id, order, symbol: "BTC/USDT", side: "buy", type: "market",
           amount: qty, price, cost: qty * price,
           fee: { cost: 0.01, currency: "USDT" }, timestamp: Date.now() };
}

function montarExchange(opts: {
  ordem?: ReturnType<typeof ordemRaw>; trades?: unknown[]; fechadas?: unknown[];
}): ExchangeFalso {
  const ex: ExchangeFalso = {
    fetchOrder: vi.fn(async () => opts.ordem ?? ordemRaw("ORD-Z", 10)),
    fetchMyTrades: vi.fn(async () => opts.trades ?? []),
    fetchClosedOrders: vi.fn(async () => opts.fechadas ?? []),
    createOrder: vi.fn(async () => { throw new Error("PROIBIDO na reconciliação"); }),
  };
  hoisted.exchange = ex;
  return ex;
}

function plantarIntent(b: BancoFalso, extra: Record<string, unknown> = {}): IntentRow {
  const linha = {
    id: `i${b.intents.length + 1}`, client_order_id: "zsA129",
    origin: "dca_cron", autonomous: true,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 10, limit_price: null,
    requested_notional_usd: 100, simulated: false, state: "UNKNOWN",
    state_reason: null, external_order_id: null,
    filled_qty: 0, filled_quote: 0, canceled_qty: 0,
    fee_total: null, fee_currency: null,
    wallet_address: null, session_id: null, plan_id: null, cycle_number: null,
    conexao_id: "C1", strategy_id: null, strategy_version: null,
    strategy_hash: null, certificate_id: null, credential_fingerprint: null,
    created_at: VELHO, submitted_at: null, last_reconciled_at: null,
    reconcile_attempts: 0,
    ...extra,
  };
  b.intents.push(linha);
  return linha as unknown as IntentRow;
}

let ex: ExchangeFalso;
beforeEach(() => { ex = montarExchange({}); });

describe("A129.0 — `normalizarTrade` discriminado, exercitável sem a venue (§46)", () => {
  it("id ausente → trade_id_ausente; qty não positiva → qty_invalida; price não positivo → price_invalido", () => {
    expect(normalizarTrade({ order: "O", amount: 1, price: 100 }))
      .toEqual({ ok: false, motivo: "trade_id_ausente" });
    expect(normalizarTrade({ id: "T", order: "O", amount: 0, price: 100 }))
      .toEqual({ ok: false, motivo: "qty_invalida" });
    expect(normalizarTrade({ id: "T", order: "O", amount: -2, price: 100 }))
      .toEqual({ ok: false, motivo: "qty_invalida" });
    expect(normalizarTrade({ id: "T", order: "O", amount: "abc", price: 100 }).ok)
      .toBe(false);
    expect(normalizarTrade({ id: "T", order: "O", amount: 1, price: 0 }))
      .toEqual({ ok: false, motivo: "price_invalido" });
    expect(normalizarTrade({ id: "T", order: "O", amount: 1, price: null }))
      .toEqual({ ok: false, motivo: "price_invalido" });
    const bom = normalizarTrade(tradeRaw("T1", "O1", 2, 50));
    expect(bom.ok).toBe(true);
    if (bom.ok) {
      expect(bom.trade.tradeId).toBe("T1");
      expect(bom.trade.orderId).toBe("O1");
      expect(bom.trade.qty).toBe(2);
    }
  });
});

describe("A129.1 — raw sem id: NÃO entra em trades, é contado, e o veredito é indeterminado", () => {
  it("⚠️⚠️ pipeline: o inválido some do histórico mas NÃO da contabilidade — RECONCILIATION_REQUIRED", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    const semId = { order: "ORD-Z", symbol: "BTC/USDT", amount: 1, price: 100,
                    cost: 100, timestamp: Date.now() };
    ex = montarExchange({ trades: [tradeRaw("TZ", "ORD-Z", 10), semId] });

    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsA129",
    });
    if (leitura.tipo !== "achada") throw new Error("esperava achada");
    // ⚠️ O inválido NUNCA entra em `trades` — settlement protegido por construção.
    expect(leitura.historico?.trades.map((t) => t.tradeId)).toEqual(["TZ"]);
    expect(leitura.historico?.registrosInvalidos)
      .toEqual({ total: 1, porMotivo: { trade_id_ausente: 1 } });

    const r = await reconciliarIntent({
      db: b.cliente, credenciais: async () => CREDS }, i1);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("registro(s) invalidos");
    // E NADA foi liquidado por cima da leitura parcialmente ilegível.
    expect(b.fills).toHaveLength(0);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A129.2 — qty inválida → qty_invalida classificada, trade fora do histórico", () => {
  it("⚠️ amount 0 e NaN são contados como qty_invalida", async () => {
    ex = montarExchange({ trades: [
      tradeRaw("TZ", "ORD-Z", 10),
      { ...tradeRaw("T-Q0", "ORD-Z"), amount: 0 },
      { ...tradeRaw("T-QN", "ORD-Z"), amount: undefined },
    ] });
    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsA129",
    });
    if (leitura.tipo !== "achada") throw new Error("esperava achada");
    expect(leitura.historico?.trades.map((t) => t.tradeId)).toEqual(["TZ"]);
    expect(leitura.historico?.registrosInvalidos)
      .toEqual({ total: 2, porMotivo: { qty_invalida: 2 } });
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A129.3 — price inválido → price_invalido classificado, trade fora do histórico", () => {
  it("⚠️ price 0 e null são contados como price_invalido", async () => {
    ex = montarExchange({ trades: [
      tradeRaw("TZ", "ORD-Z", 10),
      { ...tradeRaw("T-P0", "ORD-Z"), price: 0 },
      { ...tradeRaw("T-PN", "ORD-Z"), price: null },
    ] });
    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsA129",
    });
    if (leitura.tipo !== "achada") throw new Error("esperava achada");
    expect(leitura.historico?.trades.map((t) => t.tradeId)).toEqual(["TZ"]);
    expect(leitura.historico?.registrosInvalidos)
      .toEqual({ total: 2, porMotivo: { price_invalido: 2 } });
  });
});

describe("A129.4 — órfão válido + registro inválido na MESMA página → DERIVA (precedência §40)", () => {
  it("⚠️⚠️ a deriva comprovada vence os inválidos: QUARANTENA com o órfão nomeado", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    const semId = { order: null, symbol: "BTC/USDT", amount: 1, price: 100,
                    cost: 100, timestamp: Date.now() };
    ex = montarExchange({ trades: [tradeRaw("TZ", "ORD-Z", 10),
                                   tradeRaw("TM", "MANUAL-1", 2), semId] });

    const r = await reconciliarIntent({
      db: b.cliente, credenciais: async () => CREDS }, i1);

    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT: 1 trade(s)");
    expect(String(b.intents[0].state)).toBe("QUARANTINED");
    expect(b.fills).toHaveLength(0);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});
