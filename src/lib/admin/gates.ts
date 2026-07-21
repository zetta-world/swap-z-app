/**
 * Flywheel runtime gates — operator on/off switches for the AI backtest stack,
 * stored in admin_kv (same table as the platform kill-switches) so the CEO can
 * pause spend from the admin panel WITHOUT a redeploy. Read on every backtest
 * cron tick and by the watchdog.
 *
 *   pause_backtest   — master OFF: no scan runs (resolution still closes open
 *                      trades, since it's free and keeps the ledger honest).
 *   pause_agent_a    — skip Agent A (ZION / Sonnet self_scan) only.
 *   pause_agent_b    — skip Agent B (Ferrari hybrid) only.
 *   pause_tournament — skip the per-provider tournament (the direct model stack
 *                      — Mistral/DeepSeek/Kimi/Llama/Grok) only. This is the one
 *                      that spends on the non-Anthropic providers.
 *   pause_paper      — skip the Gate.io paper-trading agent (simulated execution
 *                      of the flywheel's signals). Independent of the scans; it
 *                      spends NO tokens (public price only).
 *   pause_radar      — skip the radar's LLM brain-wake on price triggers (the
 *                      only radar stage that spends tokens). Trigger DETECTION
 *                      and the cron heartbeat keep running — they're free and
 *                      the watchdog would page "cron stalled" otherwise.
 *   pause_sniper     — skip the SNIPER agent (event-driven, budgeted,
 *                      objective-gated — docs/PLANO-AGENTE-SNIPER.md). Rides
 *                      the same radar triggers as its control group.
 *   pause_arbiter    — skip the ARBITER desk (cross-CEX spread detector —
 *                      zero-LLM, paper-booked; docs/PLANO-MESA-AGENTES.md).
 *   pause_oracle     — skip the ORÁCULO thesis desk (daily, context-driven,
 *                      multi-model; docs/PLANO-ORACULO-ANALISTA.md).
 *   pause_arbiter2   — skip the ARBITER 2.0 desk (spot+perp hedged spread
 *                      capture, $300 real-seed sim; docs/PLANO-ARBITER-REAL.md).
 *
 * Everything defaults to running (all gates false) — a missing/empty admin_kv
 * never accidentally pauses the flywheel.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type FlywheelGateKey = "pause_backtest" | "pause_agent_a" | "pause_agent_b" | "pause_tournament" | "pause_paper" | "pause_radar" | "pause_sniper" | "pause_arbiter" | "pause_oracle" | "pause_arbiter2";
export const FLYWHEEL_GATE_KEYS: FlywheelGateKey[] = ["pause_backtest", "pause_agent_a", "pause_agent_b", "pause_tournament", "pause_paper", "pause_radar", "pause_sniper", "pause_arbiter", "pause_oracle", "pause_arbiter2"];

export type FlywheelGates = Record<FlywheelGateKey, boolean>;

export async function getFlywheelGates(): Promise<FlywheelGates> {
  const gates: FlywheelGates = { pause_backtest: false, pause_agent_a: false, pause_agent_b: false, pause_tournament: false, pause_paper: false, pause_radar: false, pause_sniper: false, pause_arbiter: false, pause_oracle: false, pause_arbiter2: false };
  const db = getSupabaseAdmin();
  if (!db) return gates;
  try {
    const { data } = await db.from("admin_kv").select("key, value").in("key", FLYWHEEL_GATE_KEYS);
    for (const r of data ?? []) {
      if ((FLYWHEEL_GATE_KEYS as string[]).includes(r.key)) gates[r.key as FlywheelGateKey] = r.value === "true";
    }
  } catch { /* table may not exist yet — all gates stay false (running) */ }
  return gates;
}
