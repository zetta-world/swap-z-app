import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTelegram } from "@/lib/admin/track";
import { getCronHeartbeats } from "@/lib/admin/health";

/**
 * Alert watchdog — the platform's autonomous monitor. Runs every cron tick
 * (~5 min) and pages the operator on Telegram for anything worth knowing,
 * across security, money, infra and business. Persistent per-alert dedup
 * (admin_kv) keeps it from repeating. Best-effort: never throws into the cron.
 *
 * Thresholds are env-overridable; the defaults suit a small/launch platform.
 */
const ERROR_SPIKE  = Number(process.env.ALERT_ERROR_SPIKE   ?? 10);  // errors / 10min
const SEC_FLOOD    = Number(process.env.ALERT_SEC_FLOOD     ?? 5);   // high-sev / 10min
const AI_BUDGET    = Number(process.env.ALERT_AI_BUDGET_USD ?? 20);  // $ / 24h
const LARGE_OP     = Number(process.env.ALERT_LARGE_OP_USD  ?? 5000);// $ single op
const CRON_STALE_MIN: Record<string, number> = { autopilot: 12, backtest: 75 };
const PRICE = { input: 3, output: 15, cacheRead: 0.30 };

const tokenCost = (i: number, o: number, c: number) => (i * PRICE.input + o * PRICE.output + c * PRICE.cacheRead) / 1e6;

/** Persistent dedup: returns true (and stamps) only if `key` hasn't fired
 *  within `windowMs`. Survives across cron invocations/instances via admin_kv. */
async function dedupOk(key: string, windowMs: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return true;
  const k = `alertdedup:${key}`;
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", k).maybeSingle();
    if (data?.value) {
      const last = Date.parse(data.value);
      if (Number.isFinite(last) && Date.now() - last < windowMs) return false;
    }
    await db.from("admin_kv").upsert({ key: k, value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
    return true;
  } catch { return true; }
}

async function pingOk(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try { const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" }); return r.ok; }
  catch { return false; }
  finally { clearTimeout(t); }
}

export async function runAlertWatchdog(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = Date.now();
  const ago10m = new Date(now - 600_000).toISOString();
  const ago24h = new Date(now - 86_400_000).toISOString();

  try {
    const [errs, secs, aiRows, largeOps, heartbeats] = await Promise.all([
      db.from("platform_events").select("created_at").eq("event_type", "error").gte("created_at", ago10m),
      db.from("platform_events").select("metadata").eq("event_type", "security").gte("created_at", ago10m),
      db.from("platform_events").select("metadata").eq("event_type", "zion_analysis").gte("created_at", ago24h),
      db.from("operations").select("pair, volume_usd, wallet_address").gte("created_at", ago10m).gt("volume_usd", LARGE_OP),
      getCronHeartbeats(),
    ]);

    // 1. Error spike
    const errCount = (errs.data ?? []).length;
    if (errCount >= ERROR_SPIKE && await dedupOk("error_spike", 1_800_000)) {
      notifyTelegram(`🐛 <b>Error spike</b> — ${errCount} errors in the last 10 min.`);
    }

    // 2. Security flood
    const highSec = (secs.data ?? []).filter((r) => (r.metadata as { severity?: string } | null)?.severity === "high").length;
    if (highSec >= SEC_FLOOD && await dedupOk("sec_flood", 1_800_000)) {
      notifyTelegram(`🔴 <b>Security flood</b> — ${highSec} high-severity events in 10 min. Possible attack.`);
    }

    // 3. Stale crons
    for (const [name, mins] of Object.entries(CRON_STALE_MIN)) {
      const last = heartbeats[name];
      const stale = !last || (now - Date.parse(last)) / 60_000 > mins;
      if (stale && await dedupOk(`stale_${name}`, 3_600_000)) {
        notifyTelegram(`⏰ <b>Cron stalled</b> — "${name}" hasn't run ${last ? `since ${new Date(last).toLocaleString()}` : "(never seen)"}.`);
      }
    }

    // 4. AI cost over budget
    let aiCost = 0;
    for (const r of aiRows.data ?? []) {
      const m = (r.metadata ?? {}) as { inTokens?: number; outTokens?: number; cachedTokens?: number };
      aiCost += tokenCost(m.inTokens ?? 0, m.outTokens ?? 0, m.cachedTokens ?? 0);
    }
    if (aiCost > AI_BUDGET && await dedupOk("ai_budget", 86_400_000)) {
      notifyTelegram(`💸 <b>AI cost</b> in 24h is $${aiCost.toFixed(2)} — over the $${AI_BUDGET} budget.`);
    }

    // 5. Large operations
    const ops = largeOps.data ?? [];
    if (ops.length > 0 && await dedupOk("large_op", 900_000)) {
      const top = ops.reduce((m, o) => (Number(o.volume_usd) > Number(m.volume_usd) ? o : m), ops[0]);
      notifyTelegram(`🐋 <b>Large operation</b> — ${ops.length} trade(s) over $${LARGE_OP} in 10 min. Top: ${top.pair ?? "?"} $${Math.round(Number(top.volume_usd)).toLocaleString()}.`);
    }

    // 6. Dependency down
    // data-api.binance.vision: Binance public mirror that is NOT geo-blocked
    // from US serverless IPs (api.binance.com returns 451 from Vercel iad1,
    // which used to fire a permanent false "Binance down" alert).
    const deps: Array<[string, string]> = [["Binance", "https://data-api.binance.vision/api/v3/ping"], ["CoinGecko", "https://api.coingecko.com/api/v3/ping"]];
    for (const [name, url] of deps) {
      if (!(await pingOk(url)) && await dedupOk(`dep_${name}`, 1_800_000)) {
        notifyTelegram(`🌐 <b>Dependency down</b> — ${name} not responding.`);
      }
    }

    // 7. Daily digest (once / 24h)
    if (await dedupOk("daily_digest", 86_400_000)) {
      await sendDailyDigest();
    }
  } catch { /* watchdog must never break the cron */ }
}

async function sendDailyDigest(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const ago24h = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: users }, { count: active24h }, { data: ops }, { data: sess }, { data: sugg }, { data: positions }] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago24h),
    db.from("operations").select("volume_usd, pnl_usd, created_at"),
    db.from("autopilot_sessions").select("pnl_today, is_active"),
    db.from("zion_suggestions").select("status"),
    db.from("autopilot_positions").select("cost_usd").neq("status", "closed"),
  ]);

  let vol24 = 0, pnlAll = 0;
  for (const o of ops ?? []) { pnlAll += Number(o.pnl_usd) || 0; if (o.created_at >= ago24h) vol24 += Number(o.volume_usd) || 0; }
  let apPnl = 0, apActive = 0;
  for (const s of sess ?? []) { apPnl += Number(s.pnl_today) || 0; if (s.is_active) apActive++; }
  let exposure = 0;
  for (const p of positions ?? []) exposure += Number(p.cost_usd) || 0;
  let wins = 0, losses = 0;
  for (const s of sugg ?? []) { if (s.status === "win" || s.status === "hit_target") wins++; else if (s.status === "loss" || s.status === "hit_stop") losses++; }
  const wr = wins + losses > 0 ? `${((wins / (wins + losses)) * 100).toFixed(0)}%` : "—";
  const m = (n: number) => `$${Math.round(n).toLocaleString()}`;

  notifyTelegram(
    `☀️ <b>Z-SWAP daily digest</b>\n` +
    `👥 Users: ${users ?? 0} (${active24h ?? 0} active 24h)\n` +
    `📊 Volume 24h: ${m(vol24)}\n` +
    `💰 Realized P&L (all): ${pnlAll >= 0 ? "+" : ""}${m(pnlAll)}\n` +
    `🤖 Autopilot: ${apActive} active · today ${apPnl >= 0 ? "+" : ""}${m(apPnl)} · exposure ${m(exposure)}\n` +
    `🎯 ZION win-rate: ${wr}`,
  );
}
