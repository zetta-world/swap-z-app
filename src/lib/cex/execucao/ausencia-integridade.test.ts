/**
 * ⚠️⚠️ A125-ABSENCE (round 8, §54–§57) — INTEGRIDADE ANTES DO CANCELED.
 *
 * O defeito: o caminho `ausente_em_todos` concluía CANCELED sem nunca olhar o
 * histórico account-wide — e quando `externalOrderId` era null, o
 * `fetchMyTrades` podia NUNCA ter rodado. Uma conta com atividade externa
 * visível no histórico tinha a ordem cancelada mesmo assim.
 *
 * Agora: a ausência viaja COM o histórico (`buscarHistorico()` roda ANTES de
 * declarar a ausência), e o reconciliador julga a integridade da conta
 * PRIMEIRO: deriva → QUARANTINED; indeterminado → a política de sempre
 * (≥12 tentativas → QUARENTENA; senão RECONCILIATION_REQUIRED em dois passos);
 * só o `ok` libera idade → filled_qty → CANCELED (§57: A102 preservado).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  reconciliarIntent, TENTATIVAS_ATE_QUARENTENA,
} from "@/lib/cex/execucao/reconciliador";
import { lerOrdemNaVenue } from "@/lib/cex/execucao/venue-leitura";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { CexCredentials } from "@/lib/cex/types";

class OrderNotFound extends Error {}
class NotSupported extends Error {}

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

function tradeRaw(id: string | undefined, order: string | null, qty = 1, price = 100) {
  return { ...(id === undefined ? {} : { id }), order, symbol: "BTC/USDT",
           side: "buy", type: "market", amount: qty, price, cost: qty * price,
           fee: { cost: 0.01, currency: "USDT" }, timestamp: Date.now() };
}

function montarExchange(opts: {
  erroOrdem?: Error; trades?: unknown[]; erroTrades?: Error; fechadas?: unknown[];
}): ExchangeFalso {
  const ex: ExchangeFalso = {
    fetchOrder: opts.erroOrdem
      ? vi.fn(async () => { throw opts.erroOrdem; })
      : vi.fn(async () => { throw new OrderNotFound("não tem"); }),
    fetchMyTrades: opts.erroTrades
      ? vi.fn(async () => { throw opts.erroTrades; })
      : vi.fn(async () => opts.trades ?? []),
    fetchClosedOrders: vi.fn(async () => opts.fechadas ?? []),
    createOrder: vi.fn(async () => { throw new Error("PROIBIDO na reconciliação"); }),
  };
  hoisted.exchange = ex;
  return ex;
}

/** Intent velho (idade >> mínima) de conexão C1, sem fill no livro. */
function plantarIntent(b: BancoFalso, extra: Record<string, unknown> = {}): IntentRow {
  const linha = {
    id: `i${b.intents.length + 1}`, client_order_id: "zsABS",
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

/** Reconcilia com a `lerOrdemNaVenue` REAL contra a exchange mockada. */
function reconciliar(b: BancoFalso, intent: IntentRow) {
  return reconciliarIntent({ db: b.cliente, credenciais: async () => CREDS }, intent);
}

const estadoDe = (b: BancoFalso, id: string) =>
  String(b.intents.find((i) => i.id === id)?.state);

let ex: ExchangeFalso;
beforeEach(() => { ex = montarExchange({}); });

describe("A125-ABSENCE.1 — ausente + órfão no histórico → QUARANTINED, nunca CANCELED", () => {
  it("⚠️⚠️ a conta tem atividade externa à vista: a deriva fala ANTES do CANCELED", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ trades: [tradeRaw("T-ORFA", "ORD-DE-FORA", 2)] });

    const r = await reconciliar(b, i1);

    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT");
    expect(estadoDe(b, "i1")).toBe("QUARANTINED");
    expect(Number(b.intents[0].canceled_qty)).toBe(0);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125-ABSENCE.2 — ausente + histórico FALHOU → RECONCILIATION_REQUIRED (§56)", () => {
  it("⚠️⚠️ historico null NUNCA vira CANCELED — e a ausência mesmo assim se declarou com o destino conhecido", async () => {
    const b = bancoFalso();
    // externalOrderId null: o caminho 1 é pulado — é exatamente o cenário em
    // que o histórico nunca rodava. Os caminhos 2/3 negam; o buscarHistorico
    // final FALHA → ausente_em_todos com historico NULL.
    const i1 = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ erroTrades: new NotSupported("fetchMyTrades fora") });

    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsABS",
    });
    expect(leitura.tipo).toBe("ausente_em_todos");
    if (leitura.tipo !== "ausente_em_todos") throw new Error("inalcançável");
    expect(leitura.historico).toBeNull();

    const r = await reconciliar(b, i1);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("historico account-wide falhou");
    expect(estadoDe(b, "i1")).toBe("RECONCILIATION_REQUIRED");
    expect(Number(b.intents[0].canceled_qty)).toBe(0);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125-ABSENCE.3 — ausente + histórico LIMPO e confiável + velho + fill 0 → CANCELED (A102 preservado)", () => {
  it("⚠️⚠️ o cancelamento legítimo sobrevive: nada executou, provado com a conta inspecionada", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ trades: [] });   // [] com SUCESSO: histórico lido e vazio

    const r = await reconciliar(b, i1);

    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "i1")).toBe("CANCELED");
    expect(Number(b.intents[0].filled_qty)).toBe(0);
    expect(Number(b.intents[0].canceled_qty)).toBe(10);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125-ABSENCE.4 — ausente + trade sem orderId no histórico → INDETERMINADO (A128)", () => {
  it("⚠️⚠️ não acusa nem absolve: RECONCILIATION_REQUIRED, nunca CANCELED", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ trades: [tradeRaw("T-SEM-ORDEM", null, 3)] });

    const r = await reconciliar(b, i1);

    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("sem id de ordem");
    expect(estadoDe(b, "i1")).toBe("RECONCILIATION_REQUIRED");
    expect(Number(b.intents[0].canceled_qty)).toBe(0);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️ indeterminado persistente esgota as tentativas → QUARENTENA (fail-closed), nunca CANCELED", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b,
      { id: "i1", reconcile_attempts: TENTATIVAS_ATE_QUARENTENA - 1 });
    ex = montarExchange({ trades: [tradeRaw("T-SEM-ORDEM", null, 3)] });

    const r = await reconciliar(b, i1);

    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "i1")).toBe("QUARANTINED");
    expect(String(b.intents[0].state_reason)).toContain("atribuicao_indeterminada");
    expect(Number(b.intents[0].canceled_qty)).toBe(0);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125-ABSENCE.5 — ausente + raw inválido no histórico → INDETERMINADO (A129)", () => {
  it("⚠️⚠️ a venue devolveu linha que não lemos: RECONCILIATION_REQUIRED, nunca CANCELED", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ trades: [tradeRaw(undefined, "ORD-Q", 1)] }); // sem id

    const r = await reconciliar(b, i1);

    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("registro(s) invalidos");
    expect(estadoDe(b, "i1")).toBe("RECONCILIATION_REQUIRED");
    expect(Number(b.intents[0].canceled_qty)).toBe(0);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});
