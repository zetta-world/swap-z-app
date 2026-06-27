import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Cron heartbeat (System Health / Phase 1). Each cron stamps a heartbeat every
 * run REGARDLESS of whether it did work, so the health panel can tell "the
 * cron is alive" even when there are zero sessions/suggestions. GitHub Actions
 * schedules are flaky, so a stale heartbeat is the early-warning signal that a
 * cron stopped firing. Best-effort, never throws.
 */
export async function setCronHeartbeat(name: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const nowIso = new Date().toISOString();
  try {
    await db.from("admin_kv").upsert(
      { key: `cron:${name}:last`, value: nowIso, updated_at: nowIso },
      { onConflict: "key" },
    );
  } catch { /* heartbeat must never break the cron */ }
}

/** Read the last-seen timestamps for the known crons. */
export async function getCronHeartbeats(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = { autopilot: null, backtest: null };
  const db = getSupabaseAdmin();
  if (!db) return out;
  try {
    const { data } = await db.from("admin_kv").select("key, value").like("key", "cron:%");
    for (const r of data ?? []) {
      const m = /^cron:(.+):last$/.exec(r.key);
      if (m) out[m[1]] = r.value;
    }
  } catch { /* ignore */ }
  return out;
}
