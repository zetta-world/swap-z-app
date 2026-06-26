import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AutopilotSessionRow, AutopilotRunRow } from "@/lib/supabase/types";
import { encryptJson, decryptJson } from "@/lib/crypto/secretbox";
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
