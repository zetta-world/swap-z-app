/**
 * Per-provider circuit breaker (P2.11). A model whose key is broken or whose
 * endpoint is down (the exact Grok/Kimi "auth rejected" the CEO saw) shouldn't
 * be hammered every tick — it just wastes latency and floods alerts. After N
 * consecutive failures a provider is TRIPPED and skipped for a cooldown, then
 * given one probe again. A single success resets it.
 *
 * State lives in admin_kv (key `cb:<providerId>`) so it survives across
 * serverless invocations. Best-effort: any DB hiccup fails OPEN (treats the
 * provider as usable) so the breaker can never itself take the flywheel down.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTelegram } from "@/lib/admin/track";

const THRESHOLD   = Number(process.env.AI_CB_THRESHOLD ?? 3);              // consecutive fails to trip
const COOLDOWN_MS = Number(process.env.AI_CB_COOLDOWN_MIN ?? 60) * 60_000; // skip window once tripped

interface CBState { fails: number; trippedUntil: number | null }

function keyFor(id: string): string { return `cb:${id}`; }

async function read(id: string): Promise<CBState> {
  const db = getSupabaseAdmin();
  if (!db) return { fails: 0, trippedUntil: null };
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", keyFor(id)).maybeSingle();
    if (data?.value) {
      const s = JSON.parse(data.value) as Partial<CBState>;
      return { fails: Number(s.fails) || 0, trippedUntil: s.trippedUntil ?? null };
    }
  } catch { /* fail open */ }
  return { fails: 0, trippedUntil: null };
}

async function write(id: string, state: CBState): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("admin_kv").upsert(
      { key: keyFor(id), value: JSON.stringify(state), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  } catch { /* best-effort */ }
}

/** True while the provider is in its cooldown window — callers should skip it. */
export async function isTripped(id: string): Promise<boolean> {
  const s = await read(id);
  return s.trippedUntil != null && Date.now() < s.trippedUntil;
}

/** Record the outcome of one call. Success resets; the Nth consecutive failure
 *  trips the breaker and pages once. */
export async function recordResult(id: string, label: string, ok: boolean): Promise<void> {
  const s = await read(id);
  if (ok) {
    if (s.fails !== 0 || s.trippedUntil != null) await write(id, { fails: 0, trippedUntil: null });
    return;
  }
  const fails = s.fails + 1;
  const alreadyTripped = s.trippedUntil != null && Date.now() < s.trippedUntil;
  if (fails >= THRESHOLD && !alreadyTripped) {
    await write(id, { fails, trippedUntil: Date.now() + COOLDOWN_MS });
    notifyTelegram(`🔌 <b>Circuit breaker</b> — ${label} tripped after ${fails} straight failures. Skipping for ${Math.round(COOLDOWN_MS / 60_000)}min. Fix the key or it'll keep re-tripping.`);
  } else {
    await write(id, { fails, trippedUntil: s.trippedUntil });
  }
}
