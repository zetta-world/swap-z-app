import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AutopilotSessionRow, AutopilotRunRow } from "@/lib/supabase/types";
import { encryptJson, decryptJson } from "@/lib/crypto/secretbox";
import { guardarConexao, lerConexaoPorId, decifrarConexao } from "@/lib/cex/conexoes";
import { recordEvent } from "@/lib/admin/track";
import type { CexCredentials } from "@/lib/cex/types";

/**
 * Server-only data layer for background autopilot sessions. Encrypts CEX
 * credentials on write, decrypts on read, and exposes the small surface the
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
 * Arm (or re-arm) a background session for this wallet+exchange. Encrypts the
 * credentials and upserts the row. Returns the session id, or null when the
 * backend is unconfigured.
 */
export async function armSession(input: ArmSessionInput): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const credsCipher = encryptJson({
    apiKey:     input.credentials.apiKey,
    apiSecret:  input.credentials.apiSecret,
    passphrase: input.credentials.passphrase ?? null,
  });

  /**
   * ⚠️⚠️ ESCRITA DUPLA — T2 da virada do cofre (`docs/PLANO-DCA-AUTOMATICO.md`).
   *
   * A chave passa a viver TAMBÉM em `cex_conexoes`, que é o cofre que o DCA já
   * usa. Sem isto, uma chave ROTACIONADA aqui deixaria o cofre desatualizado e
   * o DCA operaria com a credencial velha — o pior tipo de bug, porque só
   * aparece quando a corretora recusa e ninguém sabe por quê.
   *
   * ⚠️ FALHA DEGRADA, NÃO DERRUBA. Se o cofre não gravar, a sessão é armada do
   * mesmo jeito com `conexao_id` nulo, e a leitura cai no `creds_cipher` — que
   * é exatamente o caminho antigo, ainda intacto. Derrubar o armar do
   * autopilot por causa de uma tabela que nada lê ainda seria trocar um
   * problema pequeno por um grande.
   */
  const cofre = await guardarConexao({
    walletAddress: input.walletAddress,
    exchangeId:    input.exchangeId,
    credentials:   input.credentials,
  });
  if (!cofre.ok) {
    await recordEvent("cofre_nao_gravou", { meta: {
      why: "sessão armada SEM elo com o cofre — leitura vai cair no creds_cipher",
      exchange: input.exchangeId, erro: cofre.erro,
    } });
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
      creds_cipher:        credsCipher,
      // `null` quando o cofre falhou: a leitura sabe cair no campo acima.
      conexao_id:          cofre.ok ? cofre.id : null,
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

/** Disarm — flip is_active false. The cron skips inactive rows. */
export async function disarmSession(walletAddress: string, exchangeId: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("autopilot_sessions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId);
}

/** Read the public-safe view of a session (NO decrypted credentials). */
export async function getSessionStatus(
  walletAddress: string,
  exchangeId: string,
): Promise<Omit<AutopilotSessionRow, "creds_cipher"> | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("autopilot_sessions")
    .select("*")
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId)
    .maybeSingle();
  if (!data) return null;
  const { creds_cipher: _omit, ...safe } = data;
  void _omit;
  return safe;
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

/** Decrypt a session's stored credentials. Throws on tamper / missing key. */
export function decryptSessionCreds(row: AutopilotSessionRow): CexCredentials {
  const obj = decryptJson<{ apiKey: string; apiSecret: string; passphrase: string | null }>(row.creds_cipher);
  return {
    apiKey:     obj.apiKey,
    apiSecret:  obj.apiSecret,
    passphrase: obj.passphrase ?? undefined,
  };
}

/** De onde a credencial veio nesta leitura. É o que o contador do T2 mede. */
export type OrigemCredencial = "cofre" | "sessao";

/**
 * ⚠️⚠️ LEITURA DUPLA — T2 da virada do cofre.
 *
 * Prefere `cex_conexoes` quando a sessão tem elo; cai em `creds_cipher` quando
 * não tem, ou quando o cofre não devolve linha utilizável. Devolve DE ONDE
 * veio, porque é isso que autoriza o T3.
 *
 * ⚠️ O CONTADOR NÃO É ENFEITE. Sem ele, remover o `creds_cipher` é chute — e a
 * invariante nº 33 diz que "ninguém usou o caminho velho" e "meu contador está
 * quebrado" não podem ser a mesma tela.
 *
 * ⚠️ E A CONEXÃO REVOGADA NÃO CAI PARA TRÁS. Se o dono desligou a conexão no
 * cofre, a leitura FALHA em vez de usar a cópia antiga da sessão — senão
 * revogar não revogaria nada, que é o oposto do ponto do cofre.
 */
export async function credenciaisDaSessao(
  row: AutopilotSessionRow,
): Promise<{ creds: CexCredentials; origem: OrigemCredencial }> {
  if (row.conexao_id) {
    const c = await lerConexaoPorId(row.conexao_id);
    if (c && !c.is_active) {
      throw new Error("cofre: conexão revogada pelo dono");
    }
    if (c) return { creds: decifrarConexao(c), origem: "cofre" };
  }
  return { creds: decryptSessionCreds(row), origem: "sessao" };
}

/** Patch a session's mutable fields (counters, freeze, last_scan_at, error). */
export async function patchSession(
  id: string,
  patch: Partial<Pick<AutopilotSessionRow,
    "trades_today" | "pnl_today" | "last_reset_day" | "frozen_until_day" |
    "last_scan_at" | "last_error" | "is_active">>,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("autopilot_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
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
