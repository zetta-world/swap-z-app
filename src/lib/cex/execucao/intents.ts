/**
 * O REPOSITÓRIO DO INTENT DURÁVEL — achados A80, A100, A101, A108, A109.
 *
 * ⚠️ TUDO QUE MUDA `filled_qty` PASSA POR RPC, sem exceção. Somar um fill exige
 * ler o total e escrever o novo; duas passadas concorrentes leriam o mesmo
 * total e perderiam um fill. As RPCs da migration 0051 rodam sob `for update`
 * numa transação só. Este arquivo é só o transporte.
 *
 * ⚠️ E ELE NÃO ENGOLE ERRO. `supabase-js` RESOLVE com `{ error }` — não lança —
 * então todo retorno é conferido e sobe como resultado legível. Um caminho de
 * dinheiro que devolve `void` é o que o achado A80 encontrou em toda parte.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { gerarClientOrderId } from "@/lib/cex/execucao/client-order-id";
import { PRECISAM_RECONCILIAR, type EstadoDoIntent } from "@/lib/cex/execucao/estados";

export interface IntentRow {
  id: string;
  client_order_id: string;
  wallet_address: string | null;
  origin: string;
  autonomous: boolean;
  session_id: string | null;
  plan_id: string | null;
  cycle_number: number | null;
  conexao_id: string | null;
  strategy_id: string | null;
  strategy_version: number | null;
  /** ⚠️ O hash dos parâmetros, DURÁVEL desde a 0060 (A110 round 3): a
   *  autorização final o lê DAQUI, nunca de parâmetro do caller. */
  strategy_hash: string | null;
  certificate_id: string | null;
  exchange_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_type: "market" | "limit";
  requested_qty: number;
  limit_price: number | null;
  requested_notional_usd: number | null;
  simulated: boolean;
  state: EstadoDoIntent;
  state_reason: string | null;
  external_order_id: string | null;
  filled_qty: number;
  filled_quote: number;
  fee_total: number | null;
  fee_currency: string | null;
  canceled_qty: number;
  created_at: string;
  submitted_at: string | null;
  last_reconciled_at: string | null;
  reconcile_attempts: number;
}

/** O que quem chama precisa passar para abrir um intent. */
export interface PedidoDeIntent {
  origin: string;
  autonomous: boolean;
  exchangeId: string;
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  requestedQty: number;
  limitPrice?: number | null;
  requestedNotionalUsd?: number | null;
  simulated?: boolean;
  walletAddress?: string | null;
  sessionId?: string | null;
  planId?: string | null;
  cycleNumber?: number | null;
  conexaoId?: string | null;
  strategyId?: string | null;
  strategyVersion?: number | null;
  /** O hash dos parâmetros — persistido na linha (A110 round 3). */
  strategyHash?: string | null;
  certificateId?: string | null;
}

export type ResultadoDeIntent =
  | { ok: true; intent: IntentRow }
  | { ok: false; porque: string; jaExiste?: boolean };

/**
 * Grava o intent ANTES de qualquer efeito externo.
 *
 * ⚠️⚠️ ESTA ESCRITA É A PRÓPRIA CORREÇÃO DO A80. Se ela falhar, NADA pode ser
 * enviado — sem ela não há como descobrir depois que a ordem existiu. É por
 * isso que ela devolve resultado conferível e nunca `void`.
 */
export async function abrirIntent(
  db: SupabaseClient<Database>, p: PedidoDeIntent,
): Promise<ResultadoDeIntent> {
  if (!(p.requestedQty > 0) || !Number.isFinite(p.requestedQty)) {
    return { ok: false, porque: "quantidade pedida invalida" };
  }
  if (p.orderType === "limit" && !(Number(p.limitPrice) > 0)) {
    return { ok: false, porque: "ordem limitada exige preco positivo" };
  }

  const { data, error } = await db.from("cex_execution_intents").insert({
    client_order_id: gerarClientOrderId(),
    origin: p.origin,
    autonomous: p.autonomous,
    exchange_id: p.exchangeId,
    symbol: p.symbol,
    side: p.side,
    order_type: p.orderType,
    requested_qty: p.requestedQty,
    limit_price: p.orderType === "limit" ? p.limitPrice : null,
    requested_notional_usd: p.requestedNotionalUsd ?? null,
    simulated: p.simulated ?? false,
    wallet_address: p.walletAddress ?? null,
    session_id: p.sessionId ?? null,
    plan_id: p.planId ?? null,
    cycle_number: p.cycleNumber ?? null,
    conexao_id: p.conexaoId ?? null,
    strategy_id: p.strategyId ?? null,
    strategy_version: p.strategyVersion ?? null,
    strategy_hash: p.strategyHash ?? null,
    certificate_id: p.certificateId ?? null,
  }).select("*").limit(1);

  if (error) {
    // ⚠️ A trava `idx_cex_intent_um_vivo_por_ciclo` bate aqui quando já existe
    // um intent vivo para o mesmo ciclo de DCA. NÃO é erro: é a trava fazendo
    // o trabalho dela, e quem chama precisa distinguir isso de falha de banco.
    const jaExiste = /duplicate key|unique constraint/i.test(error.message);
    return { ok: false, porque: error.message.slice(0, 200), jaExiste };
  }
  const row = (data ?? [])[0] as IntentRow | undefined;
  if (!row) return { ok: false, porque: "insert sem linha de volta" };
  return { ok: true, intent: row };
}

export type ResultadoDeTransicao =
  | { ok: true; de: EstadoDoIntent; para: EstadoDoIntent; noop: boolean }
  | { ok: false; porque: string };

/** Transição de estado. A legalidade é decidida pelo banco. */
export async function transicionar(
  db: SupabaseClient<Database>, intentId: string, para: EstadoDoIntent,
  motivo?: string | null, externalOrderId?: string | null,
): Promise<ResultadoDeTransicao> {
  const { data, error } = await db.rpc("cex_transicionar", {
    p_intent_id: intentId, p_para: para,
    p_motivo: motivo ?? null, p_external_order_id: externalOrderId ?? null,
  });
  if (error) return { ok: false, porque: error.message.slice(0, 200) };
  const r = data as { ok?: boolean; de?: string; para?: string; noop?: boolean; porque?: string } | null;
  if (!r || r.ok !== true) {
    return { ok: false, porque: r?.porque ?? "transicao recusada pelo banco" };
  }
  return {
    ok: true, de: r.de as EstadoDoIntent, para: r.para as EstadoDoIntent,
    noop: r.noop === true,
  };
}

export interface TradeParaIngerir {
  tradeId: string;
  qty: number;
  price: number;
  quote: number;
  fee?: number | null;
  feeCurrency?: string | null;
  executedAt?: string | null;
}

export type ResultadoDeIngestao =
  | { ok: true; inseridos: number; filledQty: number; state: EstadoDoIntent }
  | { ok: false; porque: string };

/**
 * Ingestão nível-TRADE: identidade de verdade, dedupe por id de trade.
 *
 * ⚠️ TODOS OS TRADES DA ORDEM DE UMA VEZ. A RPC apaga os sintéticos daquela
 * ordem na mesma transação; mandar um trade por chamada deixaria o total
 * transitoriamente MENOR que a verdade.
 */
export async function ingerirTrades(
  db: SupabaseClient<Database>, intentId: string, externalOrderId: string | null,
  trades: TradeParaIngerir[],
): Promise<ResultadoDeIngestao> {
  for (const t of trades) {
    if (!t.tradeId) return { ok: false, porque: "trade sem id — use o snapshot de ordem" };
    if (!(t.qty > 0) || !(t.price > 0)) {
      return { ok: false, porque: `trade ${t.tradeId} sem quantidade ou preco positivos` };
    }
  }
  const { data, error } = await db.rpc("cex_ingest_trades", {
    p_intent_id: intentId,
    p_external_order_id: externalOrderId,
    p_trades: trades.map((t) => ({
      trade_id: t.tradeId, qty: t.qty, price: t.price, quote: t.quote,
      fee: t.fee ?? null, fee_currency: t.feeCurrency ?? null,
      executed_at: t.executedAt ?? null,
    })),
  });
  if (error) return { ok: false, porque: error.message.slice(0, 200) };
  const r = data as { inseridos?: number; filled_qty?: number; state?: string } | null;
  return {
    ok: true, inseridos: Number(r?.inseridos ?? 0),
    filledQty: Number(r?.filled_qty ?? 0), state: (r?.state ?? "UNKNOWN") as EstadoDoIntent,
  };
}

export type ResultadoDeSnapshot =
  | { ok: true; inseridos: number; regrediu: boolean; filledQty?: number; state?: EstadoDoIntent }
  | { ok: false; porque: string };

/**
 * Ingestão nível-ORDEM: só o acumulado, sem id de trade.
 *
 * ⚠️ `regrediu` É SINAL DE DIVERGÊNCIA, não ruído. A corretora reportar MENOS
 * do que o livro já tem significa que alguém está errado — e ninguém
 * "desexecuta" um trade. Quem chama leva o intent a RECONCILIATION_REQUIRED.
 */
export async function ingerirSnapshotDaOrdem(
  db: SupabaseClient<Database>, intentId: string, externalOrderId: string | null,
  s: { cumulativeQty: number; avgPrice: number; cumulativeQuote: number;
       fee?: number | null; feeCurrency?: string | null; executedAt?: string | null },
): Promise<ResultadoDeSnapshot> {
  const { data, error } = await db.rpc("cex_ingest_order_snapshot", {
    p_intent_id: intentId,
    p_external_order_id: externalOrderId,
    p_cumulative_qty: s.cumulativeQty,
    p_avg_price: s.avgPrice,
    p_cumulative_quote: s.cumulativeQuote,
    p_fee: s.fee ?? null,
    p_fee_currency: s.feeCurrency ?? null,
    p_executed_at: s.executedAt ?? null,
  });
  if (error) return { ok: false, porque: error.message.slice(0, 200) };
  const r = data as { inseridos?: number; regrediu?: boolean; filled_qty?: number; state?: string } | null;
  return {
    ok: true, inseridos: Number(r?.inseridos ?? 0), regrediu: r?.regrediu === true,
    filledQty: r?.filled_qty === undefined ? undefined : Number(r.filled_qty),
    state: r?.state as EstadoDoIntent | undefined,
  };
}

/** Um intent pelo id. `undefined` = falha de leitura; `null` = não existe. */
export async function intentPorId(
  db: SupabaseClient<Database>, id: string,
): Promise<IntentRow | null | undefined> {
  const { data, error } = await db.from("cex_execution_intents")
    .select("*").eq("id", id).limit(1);
  if (error) return undefined;
  return ((data ?? [])[0] as IntentRow | undefined) ?? null;
}

/**
 * Os intents que o recuperador precisa reabrir (INVARIANTE 7).
 *
 * ⚠️ `undefined` É FALHA DE LEITURA, e não "nenhum pendente". O recuperador que
 * não distingue os dois conclui "está tudo reconciliado" num banco fora do ar —
 * a regra nº 33 desta casa: não medimos ≠ medimos zero.
 */
export async function intentsParaReconciliar(
  db: SupabaseClient<Database>, limite = 100,
): Promise<IntentRow[] | undefined> {
  const { data, error } = await db.from("cex_execution_intents")
    .select("*")
    .in("state", [...PRECISAM_RECONCILIAR])
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) return undefined;
  return (data ?? []) as IntentRow[];
}

/**
 * O intent NÃO-TERMINAL de um plano de DCA, se houver.
 *
 * ⚠️⚠️ É A PRIMEIRA PERGUNTA DA PASSADA (A105). Enquanto existir um intent vivo
 * para este plano, NENHUMA ordem nova pode ser enviada e o plano NÃO avança —
 * senão a dúvida de um ciclo vira compra dobrada no ciclo seguinte.
 *
 * ⚠️ `undefined` é falha de leitura, `null` é "não há". Um caminho de dinheiro
 * que trata os dois igual conclui "nada pendente" com o banco fora do ar.
 */
export async function intentVivoDoPlano(
  db: SupabaseClient<Database>, planId: string,
): Promise<IntentRow | null | undefined> {
  const { data, error } = await db.from("cex_execution_intents")
    .select("*")
    .eq("plan_id", planId)
    .in("state", [...PRECISAM_RECONCILIAR, "QUARANTINED"])
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return undefined;
  return ((data ?? [])[0] as IntentRow | undefined) ?? null;
}

/**
 * As ordens externas que NÓS criamos nesta corretora e símbolo, na janela.
 *
 * ⚠️ É o denominador da deriva (A103): trade da corretora cuja ordem NÃO está
 * aqui é atividade que a Z-SWAP não consegue explicar.
 *
 * ⚠️ `undefined` é falha de leitura, e ela NÃO pode virar "não conheço nenhuma
 * ordem" — isso acusaria o cliente de deriva toda vez que o banco piorasse.
 */
export async function ordensConhecidas(
  db: SupabaseClient<Database>, exchangeId: string, symbol: string, desdeIso: string,
): Promise<Set<string> | undefined> {
  const { data, error } = await db.from("cex_execution_intents")
    .select("external_order_id")
    .eq("exchange_id", exchangeId).eq("symbol", symbol)
    .gte("created_at", desdeIso)
    .not("external_order_id", "is", null)
    .limit(1000);
  if (error) return undefined;
  return new Set((data ?? [])
    .map((r) => String((r as { external_order_id: string }).external_order_id)));
}

/** Os ids de trade que o livro já tem para esta corretora. */
export async function tradesNoLivro(
  db: SupabaseClient<Database>, exchangeId: string, desdeIso: string,
): Promise<Set<string> | undefined> {
  const { data, error } = await db.from("cex_fills")
    .select("external_trade_id")
    .eq("exchange_id", exchangeId).gte("created_at", desdeIso)
    .not("external_trade_id", "is", null)
    .limit(1000);
  if (error) return undefined;
  return new Set((data ?? [])
    .map((r) => String((r as { external_trade_id: string }).external_trade_id)));
}

/** Marca que a reconciliação passou por aqui — para o ritmo e o diagnóstico. */
export async function marcarReconciliado(
  db: SupabaseClient<Database>, intentId: string, tentativas: number,
): Promise<boolean> {
  const { error } = await db.from("cex_execution_intents")
    .update({ last_reconciled_at: new Date().toISOString(),
              reconcile_attempts: tentativas + 1 })
    .eq("id", intentId);
  return !error;
}
