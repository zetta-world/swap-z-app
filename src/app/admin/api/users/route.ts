import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * USERS workspace. Without ?wallet → a leaderboard of recently-active wallets
 * (aggregated from the operations ledger + tier). With ?wallet=X → the full
 * drill-down for one wallet: tier, autopilot sessions, operations and events.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const wallet = req.nextUrl.searchParams.get("wallet")?.trim();

  // ── Detail ──
  if (wallet) {
    const [{ data: tier }, { data: sessions }, { data: operations }, { data: events }] = await Promise.all([
      db.from("tier_cache").select("tier, source").eq("wallet_address", wallet).maybeSingle(),
      db.from("autopilot_sessions").select("exchange_id, risk_mode, market_type, is_active, trades_today, pnl_today, frozen_until_day, last_scan_at").eq("wallet_address", wallet),
      db.from("operations").select("kind, pair, side, volume_usd, pnl_usd, status, created_at").eq("wallet_address", wallet).order("created_at", { ascending: false }).limit(40),
      db.from("platform_events").select("event_type, metadata, created_at").eq("wallet_address", wallet).order("created_at", { ascending: false }).limit(25),
    ]);

    let volume = 0, pnl = 0;
    for (const o of operations ?? []) { volume += Number(o.volume_usd) || 0; pnl += Number(o.pnl_usd) || 0; }

    return NextResponse.json({
      wallet,
      tier:       tier?.tier ?? "free",
      tierSource: tier?.source ?? null,
      sessions:   sessions ?? [],
      operations: operations ?? [],
      events:     events ?? [],
      totals:     { ops: (operations ?? []).length, volume, pnl },
      fetchedAt:  new Date().toISOString(),
    });
  }

  // ── List (leaderboard) ──
  const [{ data: ops }, { data: tiers }] = await Promise.all([
    db.from("operations").select("wallet_address, volume_usd, pnl_usd, created_at").not("wallet_address", "is", null).order("created_at", { ascending: false }).limit(3000),
    db.from("tier_cache").select("wallet_address, tier"),
  ]);

  const tierBy = new Map<string, string>((tiers ?? []).map((t) => [t.wallet_address, t.tier]));
  const agg = new Map<string, { wallet: string; ops: number; volume: number; pnl: number; lastSeen: string }>();
  for (const o of ops ?? []) {
    const w = o.wallet_address as string;
    const cur = agg.get(w) ?? { wallet: w, ops: 0, volume: 0, pnl: 0, lastSeen: o.created_at };
    cur.ops++;
    cur.volume += Number(o.volume_usd) || 0;
    cur.pnl    += Number(o.pnl_usd)    || 0;
    if (o.created_at > cur.lastSeen) cur.lastSeen = o.created_at;
    agg.set(w, cur);
  }
  const wallets = [...agg.values()]
    .map((a) => ({ ...a, tier: tierBy.get(a.wallet) ?? "free" }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, 60);

  return NextResponse.json({ wallets, fetchedAt: new Date().toISOString() });
}
