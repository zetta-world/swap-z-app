import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireAdmin();

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const now = new Date();
  const ago7d  = new Date(now.getTime() - 7  * 86_400_000).toISOString();
  const ago30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const [
    { count: totalWallets },
    { count: active7d },
    { count: active30d },
    { data: chainRows },
    { data: tierRows },
    { count: apSessions },
    { count: apSessionsActive },
    { count: apRuns },
    { data: apSessData },
    { data: apRunsData },
    { data: exchangeRows },
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago7d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago30d),
    db.from("users").select("wallet_chain"),
    db.from("tier_cache").select("tier"),
    db.from("autopilot_sessions").select("*", { count: "exact", head: true }),
    db.from("autopilot_sessions").select("*", { count: "exact", head: true }).eq("is_active", true),
    db.from("autopilot_runs").select("*", { count: "exact", head: true }),
    db.from("autopilot_sessions").select("pnl_today"),
    db.from("autopilot_runs").select("notional_usd"),
    db.from("autopilot_sessions").select("exchange_id, is_active"),
  ]);

  // Chain split
  const chainSplit: Record<string, number> = {};
  for (const r of chainRows ?? []) {
    chainSplit[r.wallet_chain] = (chainSplit[r.wallet_chain] ?? 0) + 1;
  }

  // Tier distribution
  const tierDist: Record<string, number> = {};
  for (const r of tierRows ?? []) {
    tierDist[r.tier] = (tierDist[r.tier] ?? 0) + 1;
  }

  // Autopilot PnL (from sessions) and volume (from runs)
  let totalPnl = 0;
  let totalVolume = 0;
  for (const r of apSessData ?? []) totalPnl    += r.pnl_today    ?? 0;
  for (const r of apRunsData ?? []) totalVolume += r.notional_usd ?? 0;

  // CEX sessions per exchange
  const cexMap: Record<string, { total: number; active: number }> = {};
  for (const r of exchangeRows ?? []) {
    if (!cexMap[r.exchange_id]) cexMap[r.exchange_id] = { total: 0, active: 0 };
    cexMap[r.exchange_id].total++;
    if (r.is_active) cexMap[r.exchange_id].active++;
  }

  return NextResponse.json({
    wallets: {
      total:    totalWallets ?? 0,
      active7d: active7d    ?? 0,
      active30d: active30d  ?? 0,
      chainSplit,
    },
    tiers: { distribution: tierDist },
    autopilot: {
      sessions:       apSessions       ?? 0,
      sessionsActive: apSessionsActive ?? 0,
      totalRuns:      apRuns           ?? 0,
      pnlToday:       totalPnl,
      volumeTotal:    totalVolume,
    },
    cex: { byExchange: cexMap },
    fetchedAt: now.toISOString(),
  });
}
