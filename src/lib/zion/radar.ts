import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCexSpotPrices } from "@/lib/api/cex-spot";

/**
 * Price Radar (T3) — the cheap, NO-AI watcher. Runs every ~1 min (cron-job.org)
 * and only "wakes" the LLM when price crosses a critical trigger, instead of
 * paying tokens on a blind timer. State lives in admin_kv (a per-symbol
 * reference price); a move of RADAR_TRIGGER_PCT since the reference fires a
 * trigger and resets the reference. Cheap: one batch price fetch + KV reads,
 * zero LLM cost until something actually moves.
 */

const RADAR_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "UNI", "DOGE", "MATIC", "ADA", "XRP", "DOT"];
const TRIGGER_PCT   = Number(process.env.RADAR_TRIGGER_PCT ?? 1.5); // % move since the reference
const REF_MAX_AGE_MS = 6 * 3_600_000;                              // refresh a reference this stale

export interface RadarTrigger { symbol: string; price: number; refPrice: number; movePct: number; }

interface Ref { price: number; ts: number }

async function readRef(db: ReturnType<typeof getSupabaseAdmin>, key: string): Promise<Ref | null> {
  if (!db) return null;
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", key).maybeSingle();
    if (data?.value) { const r = JSON.parse(data.value) as Ref; if (r?.price > 0) return r; }
  } catch { /* ignore */ }
  return null;
}

async function writeRef(db: ReturnType<typeof getSupabaseAdmin>, key: string, price: number, ts: number): Promise<void> {
  if (!db) return;
  try {
    await db.from("admin_kv").upsert(
      { key, value: JSON.stringify({ price, ts }), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  } catch { /* best-effort */ }
}

/**
 * One radar tick: fetch current prices, compare each to its stored reference,
 * and return the symbols whose move since the reference crossed the trigger.
 * References are reset on a trigger (so the next move measures fresh) and
 * refreshed when stale. No LLM here — this is the cheap watcher.
 */
export async function detectTriggers(): Promise<RadarTrigger[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const prices = await getCexSpotPrices(RADAR_SYMBOLS).catch(() => new Map());
  const now = Date.now();
  const triggers: RadarTrigger[] = [];

  for (const sym of RADAR_SYMBOLS) {
    const price = prices.get(sym)?.priceUsd;
    if (!price || price <= 0) continue;
    const key = `radar:${sym}`;
    const ref = await readRef(db, key);
    if (!ref) { await writeRef(db, key, price, now); continue; } // bootstrap

    const movePct = ((price - ref.price) / ref.price) * 100;
    if (Math.abs(movePct) >= TRIGGER_PCT) {
      triggers.push({ symbol: sym, price, refPrice: ref.price, movePct: Math.round(movePct * 100) / 100 });
      await writeRef(db, key, price, now);            // reset after a trigger
    } else if (now - ref.ts > REF_MAX_AGE_MS) {
      await writeRef(db, key, price, now);            // refresh a stale reference
    }
  }
  return triggers;
}
