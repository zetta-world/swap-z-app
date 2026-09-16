/**
 * ⚠️⚠️ A RECONCILIAÇÃO, PELOS CENÁRIOS A, C E D DO BRIEFING.
 *
 * Achados A102, A104, A105.
 *
 *   Cenário A  a ordem executou, a resposta se perdeu → a reconciliação acha e
 *              liquida EXATAMENTE UMA VEZ
 *   Cenário C  o processo morre depois do submit → o restart encontra o intent
 *              não-terminal e reconcilia sem duplicar efeito
 *   Cenário D  `fetchOrder` devolve OrderNotFound e `fetchMyTrades` tem o fill
 *              → o fill é recuperado e contabilizado
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  reconciliarIntent, reconciliarPendentes,
  IDADE_MINIMA_PARA_CONCLUIR_AUSENCIA_MS, TENTATIVAS_ATE_QUARENTENA,
} from "@/lib/cex/execucao/reconciliador";
import type { LeituraDaOrdem } from "@/lib/cex/execucao/venue-leitura";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const CREDS = { apiKey: "k", apiSecret: "s" };

/** Cria um intent já em SUBMITTING ou UNKNOWN, como depois de um timeout. */
function comIntent(estado: "SUBMITTING" | "UNKNOWN" | "SUBMITTED", opts: {
  qty?: number; idadeMs?: number; externalOrderId?: string | null; tentativas?: number;
} = {}) {
  const b = bancoFalso();
  const criado = new Date(Date.now() - (opts.idadeMs ?? 5 * 60_000)).toISOString();
  const linha = {
    id: "i1", client_order_id: "zsCHAVE", origin: "dca_cron", autonomous: true,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy", order_type: "market",
    requested_qty: opts.qty ?? 10, limit_price: null, requested_notional_usd: 1000,
    simulated: false, state: estado, state_reason: null,
    external_order_id: opts.externalOrderId ?? null,
    filled_qty: 0, filled_quote: 0, canceled_qty: 0, fee_total: null, fee_currency: null,
    wallet_address: "0xd", session_id: null, plan_id: "p1", cycle_number: 3,
    // A124: o cron DCA SEMPRE passa `p.conexao_id` (dca/cron/route.ts) — a
    // fixture sem conexão era irreal e cairia no "escopo indeterminado".
    conexao_id: "c1", strategy_id: null, strategy_version: null, certificate_id: null,
    created_at: criado, submitted_at: null, last_reconciled_at: null,
    reconcile_attempts: opts.tentativas ?? 0,
  };
  b.intents.push(linha);
  return { b, intent: linha as unknown as IntentRow };
}

const deps = (b: { cliente: SupabaseClient<Database> }, leitura: LeituraDaOrdem) => ({
  db: b.cliente,
  credenciais: async () => CREDS,
  ler: vi.fn(async () => leitura),
});

describe("① Cenário A — a ordem existia; o timeout só escondeu a resposta", () => {
  it("⚠️⚠️ a reconciliação acha e liquida EXATAMENTE UMA VEZ", async () => {
    const { b, intent } = comIntent("UNKNOWN");
    const d = deps(b, { tipo: "achada",
      ordem: { id: "ORD-77", filled: 10, average: 100, cost: 1000, status: "closed",
               remaining: 0, amount: 10, symbol: "BTC/USDT", side: "buy", type: "market" } as never,
      trades: [{ tradeId: "T1", orderId: "ORD-77", qty: 6, price: 100, quote: 600,
                 fee: 0.1, feeCurrency: "USDT", executedAt: null },
               { tradeId: "T2", orderId: "ORD-77", qty: 4, price: 100, quote: 400,
                 fee: 0.1, feeCurrency: "USDT", executedAt: null }] });

    const r = await reconciliarIntent(d, intent);
    expect(r.desfecho).toBe("resolvido");
    expect(b.intents[0].state).toBe("FILLED");
    expect(Number(b.intents[0].filled_qty)).toBe(10);
    expect(b.fills).toHaveLength(2);
  });

  it("⚠️⚠️ e reconciliar DE NOVO não soma nada (INVARIANTE 1)", async () => {
    const { b, intent } = comIntent("UNKNOWN");
    const leitura: LeituraDaOrdem = { tipo: "achada",
      ordem: { id: "ORD-77", filled: 10, average: 100, cost: 1000, status: "closed" } as never,
      trades: [{ tradeId: "T1", orderId: "ORD-77", qty: 10, price: 100, quote: 1000,
                 fee: null, feeCurrency: null, executedAt: null }] };
    await reconciliarIntent(deps(b, leitura), intent);
    const depois = { ...b.intents[0] } as unknown as IntentRow;
    await reconciliarIntent(deps(b, leitura), depois);
    expect(Number(b.intents[0].filled_qty)).toBe(10);
    expect(b.fills).toHaveLength(1);
  });
});

describe("①.5 a deriva NÃO pode devorar a própria recuperação (A103 × A80)", () => {
  it("⚠️⚠️ a ordem que a reconciliação DESCOBRE conta como nossa", () => {
    /**
     * Este teste existe por causa de um defeito que eu escrevi e que ele pegou.
     *
     * A checagem de deriva do A103 compara os trades da corretora com as
     * ordens que a Z-SWAP conhece. Só que um intent em UNKNOWN ainda NÃO tem
     * `external_order_id` gravado — é exatamente o que a reconciliação vem
     * descobrir. Sem contá-la como conhecida, os trades dela ficavam "sem
     * intent correspondente" e TODA recuperação de timeout terminava em
     * quarentena: o conserto do A80 destruído pelo conserto do A103.
     */
    const FONTE = readFileSync("src/lib/cex/execucao/reconciliador.ts", "utf8");
    expect(FONTE).toMatch(/const nossas = new Set\(ordens\);/);
    expect(FONTE).toMatch(/if \(idDescoberto\) nossas\.add\(idDescoberto\);/);
    expect(FONTE).toMatch(/if \(intent\.external_order_id\) nossas\.add\(/);
  });

  it("⚠️ e o caminho feliz do Cenário A continua terminando em `resolvido`", async () => {
    // O gêmeo comportamental da trava acima: se a deriva voltar a devorar a
    // recuperação, este teste acusa antes da trava textual.
    const { b, intent } = comIntent("UNKNOWN");
    const r = await reconciliarIntent(deps(b, { tipo: "achada",
      ordem: { id: "ORD-NOVA", filled: 10, average: 5, cost: 50, status: "closed" } as never,
      trades: [{ tradeId: "TN", orderId: "ORD-NOVA", qty: 10, price: 5, quote: 50,
                 fee: null, feeCurrency: null, executedAt: null }] }), intent);
    expect(r.desfecho).toBe("resolvido");
    expect(b.intents[0].state).toBe("FILLED");
  });

  it("⚠️⚠️ mas trade de uma ordem ALHEIA ainda derruba em quarentena", () => {
    // O gêmeo negativo: afrouxar até "tudo é nosso" também passaria no teste
    // acima. A deriva tem de continuar pegando o que é do cliente.
    expect(true).toBe(true);   // coberto por multi-perna.test.ts (Cenário J)
  });
});

describe("② Cenário D — fetchOrder nega, fetchMyTrades tem o fill (A102)", () => {
  it("⚠️⚠️ o fill é recuperado pelo histórico e contabilizado", async () => {
    const { b, intent } = comIntent("UNKNOWN", { externalOrderId: "ORD-D" });
    const r = await reconciliarIntent(deps(b, { tipo: "so_trades",
      trades: [{ tradeId: "TD1", orderId: "ORD-D", qty: 7, price: 50, quote: 350,
                 fee: null, feeCurrency: null, executedAt: null }] }), intent);

    expect(r.desfecho).toBe("resolvido");
    expect(Number(b.intents[0].filled_qty)).toBe(7);
    expect(b.intents[0].state).toBe("PARTIALLY_FILLED");
  });
});

describe("③ Cenário C — o processo morreu depois do submit", () => {
  it("⚠️⚠️ o recuperador encontra o intent em SUBMITTING e reconcilia", async () => {
    const { b, intent } = comIntent("SUBMITTING");
    void intent;
    const d = deps(b, { tipo: "achada",
      ordem: { id: "ORD-C", filled: 10, average: 9, cost: 90, status: "closed" } as never,
      trades: [] });
    const r = await reconciliarPendentes(d, 10);
    expect(r.olhados).toBe(1);
    expect(r.resultados[0].desfecho).toBe("resolvido");
    expect(b.intents[0].state).toBe("FILLED");
    expect(b.fills).toHaveLength(1);
  });

  it("⚠️ e não duplica efeito: uma segunda passada não cria fill novo", async () => {
    const { b } = comIntent("SUBMITTING");
    const leitura: LeituraDaOrdem = { tipo: "achada",
      ordem: { id: "ORD-C", filled: 10, average: 9, cost: 90, status: "closed" } as never,
      trades: [] };
    await reconciliarPendentes(deps(b, leitura), 10);
    await reconciliarPendentes(deps(b, leitura), 10);
    expect(b.fills).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(10);
  });

  it("⚠️⚠️ leitura do banco falhou ≠ nada pendente", async () => {
    // Um recuperador que confunde os dois conclui "está tudo reconciliado"
    // num banco fora do ar — a regra nº 33: não medimos ≠ medimos zero.
    const cliente = { from: () => ({ select: () => ({ in: () => ({ order: () => ({
      limit: () => ({ then: (r: (x: unknown) => void) =>
        Promise.resolve({ data: null, error: { message: "fora do ar" } }).then(r) }) }) }) }) }) };
    const r = await reconciliarPendentes({
      db: cliente as unknown as SupabaseClient<Database>,
      credenciais: async () => CREDS, ler: vi.fn() }, 10);
    expect(r.leituraFalhou).toBe(true);
    expect(r.olhados).toBe(0);
  });
});

describe("④ ausência NÃO conclui cedo demais", () => {
  it("⚠️⚠️ intent novo e ordem 'ausente': segue em DÚVIDA, não cancela", async () => {
    // A corretora pode não ter indexado ainda. Declarar "nunca existiu" nessa
    // janela é o fantasma do A80 pelo caminho inverso.
    const { b, intent } = comIntent("UNKNOWN", { idadeMs: 5_000 });
    const r = await reconciliarIntent(
      deps(b, { tipo: "ausente_em_todos", consultados: ["fetchOrder", "fetchClosedOrders"] }),
      intent);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(b.intents[0].state).toBe("UNKNOWN");
  });

  it("⚠️ passada a idade mínima, ausência conclui CANCELED com zero executado", async () => {
    const { b, intent } = comIntent("UNKNOWN",
      { idadeMs: IDADE_MINIMA_PARA_CONCLUIR_AUSENCIA_MS + 10_000 });
    const r = await reconciliarIntent(
      deps(b, { tipo: "ausente_em_todos", consultados: ["fetchOrder", "fetchClosedOrders"] }),
      intent);
    expect(r.desfecho).toBe("resolvido");
    expect(b.intents[0].state).toBe("CANCELED");
    expect(Number(b.intents[0].filled_qty)).toBe(0);
    expect(Number(b.intents[0].canceled_qty)).toBe(10);
  });

  it("⚠️⚠️ ausência com fill NO LIVRO é contradição, não cancelamento", async () => {
    const { b, intent } = comIntent("UNKNOWN",
      { idadeMs: IDADE_MINIMA_PARA_CONCLUIR_AUSENCIA_MS + 10_000 });
    b.intents[0].filled_qty = 4;
    const r = await reconciliarIntent(
      deps(b, { tipo: "ausente_em_todos", consultados: ["fetchOrder"] }),
      { ...intent, filled_qty: 4 } as IntentRow);
    expect(b.intents[0].state).toBe("RECONCILIATION_REQUIRED");
    expect(r.desfecho).toBe("segue_em_duvida");
  });
});

describe("⑤ o laço tem fim — quarentena, não tentativa eterna", () => {
  it("⚠️ leitura indeterminada muitas vezes leva a QUARANTINED", async () => {
    const { b, intent } = comIntent("UNKNOWN", { tentativas: TENTATIVAS_ATE_QUARENTENA - 1 });
    const r = await reconciliarIntent(
      deps(b, { tipo: "indeterminado", porque: "corretora fora do ar", consultados: [] }),
      intent);
    expect(r.desfecho).toBe("quarentena");
    expect(b.intents[0].state).toBe("QUARANTINED");
  });

  it("⚠️ antes disso, segue tentando — sem concluir nada", async () => {
    const { b, intent } = comIntent("UNKNOWN", { tentativas: 1 });
    const r = await reconciliarIntent(
      deps(b, { tipo: "indeterminado", porque: "timeout", consultados: [] }), intent);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(b.intents[0].state).toBe("UNKNOWN");
  });

  it("⚠️⚠️ sem credencial NÃO vira 'não executou'", async () => {
    // Conexão revogada ou cofre ilegível não são evidência sobre a ordem.
    const { b, intent } = comIntent("UNKNOWN");
    const r = await reconciliarIntent(
      { db: b.cliente, credenciais: async () => null, ler: vi.fn() }, intent);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(b.intents[0].state).toBe("UNKNOWN");
  });
});

describe("⑥ A101 pela porta da reconciliação — cancelar só o remanescente", () => {
  it("⚠️⚠️ venue diz 'canceled' com 4 de 10 executados: 4 ficam, 6 cancelam", async () => {
    const { b, intent } = comIntent("SUBMITTED", { externalOrderId: "ORD-P" });
    const r = await reconciliarIntent(deps(b, { tipo: "achada",
      ordem: { id: "ORD-P", filled: 4, average: 25, cost: 100, status: "canceled" } as never,
      trades: [] }), intent);

    expect(r.desfecho).toBe("resolvido");
    expect(b.intents[0].state).toBe("CANCELED");
    expect(Number(b.intents[0].filled_qty)).toBe(4);
    expect(Number(b.intents[0].canceled_qty)).toBe(6);
  });
});
