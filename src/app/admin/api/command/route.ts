import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCronHeartbeats } from "@/lib/admin/health";

export const dynamic = "force-dynamic";

const PRICE = { input: 3, output: 15, cacheRead: 0.30 };
const CRON_STALE_MIN: Record<string, number> = { autopilot: 12, backtest: 75 };

/** Consolidated top-line KPIs for the COMMAND overview — one screen pulling
 *  from every workspace. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const now = Date.now();
  const ago24h = new Date(now - 86_400_000).toISOString();

  const [
    { count: users },
    { count: active24h },
    { data: ops },
    { data: ai },
    { count: apActive },
    { data: apSess },
    { data: positions },
    { data: suggestions },
    { data: security },
    heartbeats,
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago24h),
    db.from("operations").select("volume_usd, pnl_usd, created_at"),
    db.from("platform_events").select("metadata").eq("event_type", "zion_analysis").gte("created_at", ago24h),
    db.from("autopilot_sessions").select("*", { count: "exact", head: true }).eq("is_active", true),
    db.from("autopilot_sessions").select("pnl_today"),
    db.from("autopilot_positions").select("cost_usd").neq("status", "closed"),
    db.from("zion_suggestions").select("status"),
    db.from("platform_events").select("metadata").eq("event_type", "security").gte("created_at", ago24h),
    getCronHeartbeats(),
  ]);

  let vol24h = 0, pnlAll = 0;
  for (const o of ops ?? []) { pnlAll += Number(o.pnl_usd) || 0; if (o.created_at >= ago24h) vol24h += Number(o.volume_usd) || 0; }

  let aiCost24h = 0;
  for (const r of ai ?? []) {
    const m = (r.metadata ?? {}) as { inTokens?: number; outTokens?: number; cachedTokens?: number };
    aiCost24h += ((m.inTokens ?? 0) * PRICE.input + (m.outTokens ?? 0) * PRICE.output + (m.cachedTokens ?? 0) * PRICE.cacheRead) / 1e6;
  }

  let apPnlToday = 0;
  for (const s of apSess ?? []) apPnlToday += Number(s.pnl_today) || 0;
  let exposure = 0;
  for (const p of positions ?? []) exposure += Number(p.cost_usd) || 0;

  let wins = 0, losses = 0;
  for (const s of suggestions ?? []) {
    if (s.status === "win" || s.status === "hit_target") wins++;
    else if (s.status === "loss" || s.status === "hit_stop") losses++;
  }
  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

  let highSec24h = 0;
  for (const r of security ?? []) if ((r.metadata as { severity?: string } | null)?.severity === "high") highSec24h++;

  const staleCrons = Object.entries(CRON_STALE_MIN).filter(([name, mins]) => {
    const last = heartbeats[name];
    if (!last) return true;
    return (now - Date.parse(last)) / 60_000 > mins;
  }).map(([name]) => name);

  return NextResponse.json({
    users: users ?? 0,
    active24h: active24h ?? 0,
    volume24h: vol24h,
    pnlAll,
    aiCost24h,
    autopilot: { activeSessions: apActive ?? 0, pnlToday: apPnlToday, openPositions: (positions ?? []).length, exposure },
    backtest: { winRate, decided: wins + losses },
    alerts: { highSecurity24h: highSec24h, staleCrons },
    fetchedAt: new Date().toISOString(),
  });
}
