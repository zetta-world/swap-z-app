/**
 * Server-side autopilot position memory (A5) — the cron's equivalent of the
 * browser store in src/lib/store/autopilotPositions.ts.
 *
 * The background cron records what it BUYS here so it can later inject open
 * positions into the ZION scan (model proposes exits), arm those exits, and
 * settle realized P&L back into the session's daily loss-stop.
 *
 * Server-only: imports the service-role Supabase client. Never import from a
 * client component.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AutopilotPositionRow } from "@/lib/supabase/types";

/** All non-closed positions for a session (the held bag the cron manages). */
export async function getOpenServerPositions(sessionId: string): Promise<AutopilotPositionRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("autopilot_positions")
    .select("*")
    .eq("session_id", sessionId)
    .neq("status", "closed");
  if (error) return [];
  return data ?? [];
}

/**
 * Record (or average into) an entry after a BUY fills. Mirrors the browser
 * store's average-in: a second buy of the same base folds into one row at the
 * blended average cost.
 */
export async function recordServerEntry(p: {
  sessionId:     string;
  walletAddress: string;
  exchangeId:    string;
  pair:          string;
  entryPrice:    number;
  baseAmount:    number;
  costUsd:       number;
  reasoning?:    string;
  entryLabel?:   string;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const base = p.pair.split("/")[0].toUpperCase();

  const { data: prev } = await db
    .from("autopilot_positions")
    .select("*")
    .eq("session_id", p.sessionId)
    .eq("base", base)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  if (prev && prev.status !== "closed") {
    const totalBase = Number(prev.base_amount) + p.baseAmount;
    const totalCost = Number(prev.cost_usd) + p.costUsd;
    const avgPrice  = totalBase > 0 ? totalCost / totalBase : p.entryPrice;
    await db.from("autopilot_positions").update({
      entry_price: avgPrice,
      base_amount: totalBase,
      cost_usd:    totalCost,
      reasoning:   p.reasoning ?? prev.reasoning,
      entry_label: p.entryLabel ?? prev.entry_label,
      status:      "open",       // re-open if it had an exit armed
      updated_at:  nowIso,
    }).eq("id", prev.id);
    return;
  }

  // Fresh position (or replacing a closed one).
  await db.from("autopilot_positions").upsert({
    session_id:     p.sessionId,
    wallet_address: p.walletAddress,
    exchange_id:    p.exchangeId,
    base,
    pair:           p.pair.toUpperCase(),
    entry_price:    p.entryPrice,
    base_amount:    p.baseAmount,
    cost_usd:       p.costUsd,
    reasoning:      p.reasoning ?? null,
    entry_label:    p.entryLabel ?? null,
    status:         "open",
    exit_order_id:  null,
    exit_armed_at:  null,
    entry_ts:       nowIso,
    updated_at:     nowIso,
  }, { onConflict: "session_id,base" });
}

/** Flag that an exit order is resting for this position. */
export async function markServerExitArmed(sessionId: string, base: string, orderId: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("autopilot_positions").update({
    status:        "exit_armed",
    exit_order_id: orderId,
    exit_armed_at: new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }).eq("session_id", sessionId).eq("base", base.toUpperCase());
}

/** Reopen a position whose armed exit was canceled/expired so it can re-arm. */
export async function reopenServerPosition(sessionId: string, base: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("autopilot_positions").update({
    status:        "open",
    exit_order_id: null,
    exit_armed_at: null,
    updated_at:    new Date().toISOString(),
  }).eq("session_id", sessionId).eq("base", base.toUpperCase());
}

/** Remove a position once it's exited / no longer held. */
export async function closeServerPosition(sessionId: string, base: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("autopilot_positions")
    .delete()
    .eq("session_id", sessionId)
    .eq("base", base.toUpperCase());
}

/**
 * Atomically add realized P&L to the session's pnl_today and trip the freeze
 * if the daily loss-stop is crossed (apply_session_pnl does both in one
 * statement). `today` is the UTC day key set as frozen_until_day.
 */
export async function applySessionPnl(sessionId: string, deltaUsd: number, today: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.rpc("apply_session_pnl", { p_id: sessionId, p_delta: deltaUsd, p_today: today });
}
