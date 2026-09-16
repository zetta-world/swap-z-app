import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AutopilotSessionRow, AutopilotRunRow } from "@/lib/supabase/types";
import { guardarConexao, lerConexaoPorId, decifrarConexao } from "@/lib/cex/conexoes";
import { recordEvent } from "@/lib/admin/track";
import type { CexCredentials } from "@/lib/cex/types";

/**
 * Server-only data layer for background autopilot sessions. Since the T3
 * (A115), credentials live ONLY in the vault (`cex_conexoes`) — the session
 * stores just the `conexao_id` link. Exposes the small surface the
 * arm/disarm API and the cron worker need. Every function tolerates an
 * unconfigured backend by returning null/empty rather than throwing, matching
 * the rest of the app's degrade-gracefully posture.
 */

export function utcDayKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export interface ArmSessionInput {
  walletAddress:     string;
  exchangeId:        string;
  riskMode:          "conservador" | "moderado" | "agressivo";
  marketType:        "spot" | "futures" | "margin";
  maxTradeUsd:       number;
  dailyLossStopUsd:  number;
  maxTradesPerDay:   number;
  allowedSymbols:    string[];
  lang:              string;
  credentials:       CexCredentials;
  /** How long the session may run unattended before auto-expiring (hours). */
  ttlHours:          number;
  /**
   * ⚠️ O VEREDITO DA CHAVE, obrigatório (Fase 7). Não é opcional de propósito:
   * opcional viraria "quem esqueceu de passar grava NULL", e NULL aqui significa
   * "nunca verificada". Quem chama tem que ter perguntado à corretora antes.
   */
  keyPermission:       "so_negocia" | "pode_sacar" | "nao_verificavel";
  keyPermissionDetail: string;
}

/**
 * Arm (or re-arm) a background session for this wallet+exchange. Writes the
 * credentials to the vault FIRST and THROWS if the vault fails (T3/A115: no
 * vault, no session — there is no local copy to degrade to). Returns the
 * session id, or null when the backend is unconfigured.
 */
export async function armSession(input: ArmSessionInput): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  /**
   * ⚠️⚠️⚠️ O SEGREDO TEM UM LUGAR SÓ — T3 do cofre concluído (achado A115).
   *
   * A versão T2 gravava a credencial DUAS VEZES: aqui (em `creds_cipher`) e
   * no cofre (`cex_conexoes`). Duas cópias é duas revogações necessárias,
   * dois lugares para vazar, e um fallback que valia justamente quando o
   * banco estava ruim. A coluna saiu na migration 0056 (produção medida com
   * 0 sessões): a sessão guarda SÓ o elo `conexao_id`.
   *
   * ⚠️⚠️ FALHA DO COFRE = SESSÃO NÃO ARMA. Antes isto degradava: armava com
   * `conexao_id` nulo e segredo local. Não existe mais local para onde
   * degradar — e não existiria nem se quiséssemos, porque `creds_cipher` não
   * existe mais. Se a credencial não entrou no cofre, NENHUMA sessão nasce
   * apontando para segredo nenhum. Falha fechado, como o botão de parar.
   */
  const cofre = await guardarConexao({
    walletAddress: input.walletAddress,
    exchangeId:    input.exchangeId,
    credentials:   input.credentials,
  });
  if (!cofre.ok) {
    await recordEvent("cofre_nao_gravou", { meta: {
      severity: "high",
      why: "T3: cofre falhou → sessão NÃO armada (não existe mais cópia local para degradar)",
      exchange: input.exchangeId, erro: cofre.erro,
    } });
    throw new Error(`armSession: cofre nao gravou — sessao nao armada (${cofre.erro})`);
  }
  const today = utcDayKey();
  const expiresAt = new Date(Date.now() + input.ttlHours * 3600_000).toISOString();

  const { data, error } = await db
    .from("autopilot_sessions")
    .upsert({
      wallet_address:      input.walletAddress,
      exchange_id:         input.exchangeId,
      risk_mode:           input.riskMode,
      market_type:         input.marketType,
      max_trade_usd:       input.maxTradeUsd,
      daily_loss_stop_usd: input.dailyLossStopUsd,
      max_trades_per_day:  input.maxTradesPerDay,
      allowed_symbols:     input.allowedSymbols,
      lang:                input.lang,
      conexao_id:          cofre.id,
      key_permission:        input.keyPermission,
      key_permission_detail: input.keyPermissionDetail.slice(0, 300),
      key_checked_at:        new Date().toISOString(),
      is_active:           true,
      expires_at:          expiresAt,
      // Reset counters on (re-)arm so a fresh session starts clean.
      trades_today:        0,
      pnl_today:           0,
      last_reset_day:      today,
      frozen_until_day:    null,
      last_error:          null,
      updated_at:          new Date().toISOString(),
    }, { onConflict: "wallet_address,exchange_id" })
    .select("id")
    .single();

  if (error) throw new Error(`armSession failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * O botão de PARAR do autopilot.
 *
 * ⚠️⚠️ ELE DEVOLVIA `Promise<void>` — e isso é o defeito, não um detalhe de
 * assinatura (achado A11 da auditoria externa, 14/09).
 *
 * `supabase-js` RESOLVE com `{ data, error }` e NÃO lança (invariante nº 1
 * desta casa). Sem `const { error } =`, um UPDATE recusado — banco fora,
 * PostgREST 5xx, rede — era indistinguível de sucesso. A rota respondia
 * `{ ok: true }`, a tela dizia "desligado, ele para de operar imediatamente",
 * e `is_active` continuava `true`: o cron de 5 minutos seguia negociando com a
 * credencial cifrada que ESTÁ no servidor. Dinheiro REAL na corretora do
 * cliente, no botão que existe para parar.
 *
 * ⚠️ E `Promise<void>` era o que tornava a conferência IMPOSSÍVEL para quem
 * chama. A trava `escritas-conferidas.test.ts` já proíbe exatamente isso — só
 * que ela lia `positions-server.ts` e o cron, e nunca este arquivo.
 *
 * ⚠️ O padrão certo existe duas pastas ao lado: `revogarConexao`
 * (`lib/cex/conexoes.ts`) é a MESMA classe de escrita e devolve `!error`.
 *
 * ⚠️ `linhas === 0` NÃO é falha: é idempotência — já estava desarmado, ou nunca
 * houve sessão. Tratar isso como erro faria um segundo clique parecer quebra.
 */
export async function disarmSession(
  walletAddress: string, exchangeId: string,
): Promise<{ ok: boolean; linhas: number }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, linhas: 0 };
  const { data, error } = await db
    .from("autopilot_sessions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId)
    // ⚠️ `.select()` para SABER quantas linhas casaram. Sem ele, "gravou" e
    // "não achou nada para gravar" voltam idênticos.
    .select("id");
  return { ok: !error, linhas: data?.length ?? 0 };
}

/** Read the public-safe view of a session (NO decrypted credentials). */
export async function getSessionStatus(
  walletAddress: string,
  exchangeId: string,
): Promise<AutopilotSessionRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  /**
   * ⚠️⚠️ FALHA DE LEITURA NÃO PODE VIRAR "NÃO HÁ SESSÃO" (14/09).
   *
   * Esta função devolvia `null` tanto para "não existe sessão" quanto para "não
   * consegui ler" — e o painel faz `isArmed = !!status?.is_active`. Numa queda
   * de banco, a escrita do desarme falha E a leitura falha juntas: a tela mostra
   * DESARMADO enquanto a linha continua `is_active = true`, e o cron retoma as
   * ordens na invocação seguinte, com o banco já de volta.
   *
   * Ausência continua ausência; erro agora LANÇA, e quem chama decide. É a mesma
   * escolha que `listRunnableSessions` logo abaixo já fazia.
   */
  const { data, error } = await db
    .from("autopilot_sessions")
    .select("*")
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId)
    .maybeSingle();
  if (error) throw new Error(`getSessionStatus failed: ${error.message}`);
  // Não há mais segredo na linha (T3): a visão pública É a linha.
  return data ?? null;
}

/** All active, non-expired sessions — the cron's work queue. */
export async function listRunnableSessions(): Promise<AutopilotSessionRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("autopilot_sessions")
    .select("*")
    .eq("is_active", true)
    .gt("expires_at", nowIso);
  if (error) throw new Error(`listRunnableSessions failed: ${error.message}`);
  return data ?? [];
}

/** De onde a credencial veio nesta leitura. T3: existe UM lugar — o cofre. */
export type OrigemCredencial = "cofre";

/**
 * ⚠️⚠️⚠️ O COFRE É A ÚNICA FONTE — achado A115, o T3 concluído (Round 2).
 *
 * A versão T2 tinha um FALLBACK: sessão sem elo no cofre lia o segredo de
 * `creds_cipher`, a segunda cópia guardada na própria sessão. O Round 1 já
 * tinha fechado o fallback PARA SESSÃO COM ELO; esta rodada removeu o ramo
 * inteiro — e a coluna (migration 0056, produção medida com 0 sessões).
 *
 * Agora NÃO EXISTE outro caminho, para nenhuma sessão:
 *
 *     sem conexao_id     ERRO EXPLÍCITO (sessão pré-cofre não existe mais)
 *     revogada           BLOQUEIA
 *     não existe         BLOQUEIA
 *     não deu para ler   BLOQUEIA
 *     cofre ilegível     BLOQUEIA (o `decifrarConexao` lança, e deve lançar)
 *
 * ⚠️ SE ALGUÉM REINTRODUZIR UM "CAMINHO ALTERNATIVO" aqui, o grep-guard de
 * `cofre-t3.test.ts` quebra o build. Um lugar para revogar que tem outro
 * lugar atrás dele não é um lugar para revogar.
 */
export async function credenciaisDaSessao(
  row: AutopilotSessionRow,
): Promise<{ creds: CexCredentials; origem: OrigemCredencial }> {
  if (!row.conexao_id) {
    throw new Error(
      "sessão sem elo com o cofre (conexao_id nulo) — a segunda cópia do segredo foi removida no T3; rearma a sessão");
  }
  const c = await lerConexaoPorId(row.conexao_id);
  if (c === undefined) {
    throw new Error("cofre: nao deu para ler a conexao — nenhuma ordem sai sobre duvida de credencial");
  }
  if (c === null) {
    throw new Error("cofre: conexao inexistente para esta sessao — vinculo quebrado");
  }
  if (!c.is_active) {
    throw new Error("cofre: conexão revogada pelo dono");
  }
  // ⚠️ `decifrarConexao` LANÇA em adulteração ou chave ausente. Não se
  // captura aqui de propósito: cofre ilegível é bloqueio, não motivo para
  // procurar o segredo em outro lugar.
  return { creds: decifrarConexao(c), origem: "cofre" };
}

/** Patch a session's mutable fields (counters, freeze, last_scan_at, error). */
/**
 * ⚠⚠ POR QUE ISTO DEIXOU DE SER `Promise<void>` (achado A11, segunda parte).
 *
 * As nove chamadas no cron não são iguais. Oito são telemetria
 * (`last_scan_at`, `last_error`): falhar ali envelhece a tela e nada mais.
 *
 * A NONA É A VIRADA DO DIA — `trades_today: 0, pnl_today: 0, last_reset_day`.
 * E ela decide dinheiro: o cron zera o contador NA MEMÓRIA e calcula
 * `remainingTrades = max_trades_per_day - tradesToday` a partir do valor local.
 * Se a gravação for recusada, `last_reset_day` continua em ontem, a passada
 * seguinte vê de novo "é outro dia", zera de novo na memória — e o limite
 * diário que o usuário configurou vira limite POR PASSADA, a cada 5 minutos.
 *
 * Com `Promise<void>` não havia o que conferir: `supabase-js` resolve com
 * `{ error }` e não lança, então recusa e sucesso eram indistinguíveis.
 *
 * ⚠️ `sem banco` também é `ok: false`. Antes o `return` cedo devolvia o mesmo
 * `undefined` do caminho feliz — ausente e gravado liam igual.
 */
export async function patchSession(
  id: string,
  patch: Partial<Pick<AutopilotSessionRow,
    "trades_today" | "pnl_today" | "last_reset_day" | "frozen_until_day" |
    "last_scan_at" | "last_error" | "is_active" |
    /** ⚠️ O carimbo do plano, revalidado com prazo pelo worker (achado A111). */
    "tier_snapshot" | "tier_checked_at">>,
): Promise<{ ok: boolean; erro?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "supabase nao configurado" };
  const { error } = await db
    .from("autopilot_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, erro: error.message.slice(0, 200) } : { ok: true };
}

/**
 * Atomically acquire the per-session lock (A2). Returns true only if this
 * caller won the lock — i.e. it was free (null) or its TTL had expired. The
 * conditional UPDATE is serialized by Postgres, so of two overlapping cron
 * runs exactly one acquires and the other sees zero rows updated.
 */
export async function tryLockSession(id: string, ttlMs: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const nowIso     = new Date().toISOString();
  const lockUntil  = new Date(Date.now() + ttlMs).toISOString();
  const { data, error } = await db
    .from("autopilot_sessions")
    .update({ locked_until: lockUntil, updated_at: nowIso })
    .eq("id", id)
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .select("id");
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Atomically add to a session's trades_today (A1 write-back). Lets the browser
 * publish its own fires so the server counter reflects BOTH channels and can
 * be read back as the single authoritative daily count. No-op if no session
 * exists for the wallet+exchange.
 */
/**
 * ⚠️⚠️ DEVOLVE SE CONTOU — e antes engolia a falha (auditoria 23/08).
 *
 * Este contador E o limite de trades por dia que o usuario configurou. O cron
 * ja o incrementa LOGO APOS a ordem existir, de proposito, para sobreviver a
 * um timeout no meio da execucao — esse raciocinio estava certo.
 *
 * Mas o RPC era disparado sem conferir `error`, e o cliente do Supabase
 * RESOLVE com `{ error }` em vez de lancar. Se ele falhasse, o contador nao
 * subia e o limite diario simplesmente DEIXAVA DE EXISTIR, em silencio, pelo
 * resto do dia — a mesma classe do `engine.ts`, agora em dinheiro real.
 *
 * ⚠️ Nao da para desfazer a ordem que ja foi. O que da e nao mentir sobre ela
 * ter sido contada: quem chama trata o `false` como "perdi a conta", e o
 * caminho do dinheiro falha FECHADO a partir dali.
 */
export async function bumpSessionTrades(walletAddress: string, exchangeId: string, n: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  if (n <= 0) return true;
  const { error } = await db.rpc("bump_session_trades", { p_wallet: walletAddress, p_exchange: exchangeId, p_n: n });
  return !error;
}

/** Release the per-session lock so the next cron run can pick it up. */
export async function releaseLock(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("autopilot_sessions")
    .update({ locked_until: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Append one (or more) run-log rows. Best-effort — swallows DB errors. */
export async function recordRuns(rows: Array<Partial<AutopilotRunRow> & {
  wallet_address: string; exchange_id: string; status: string;
}>): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db || rows.length === 0) return;
  try {
    await db.from("autopilot_runs").insert(rows);
  } catch { /* logging must never break the worker */ }
}

/** Recent run-log rows for a wallet (for the UI to show what ran while away). */
export async function listRecentRuns(walletAddress: string, limit = 50): Promise<AutopilotRunRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("autopilot_runs")
    .select("*")
    .eq("wallet_address", walletAddress)
    .order("ran_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
