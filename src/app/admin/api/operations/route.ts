import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Live autopilot operations for the admin panel: open positions (the bag the
 *  bot holds right now) + the most recent fired/rejected runs. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: positions }, { data: runs }] = await Promise.all([
    db.from("autopilot_positions")
      .select("base, pair, base_amount, cost_usd, entry_price, status, exit_order_id, entry_ts, exchange_id")
      .neq("status", "closed")
      .order("entry_ts", { ascending: false })
      .limit(50),
    db.from("autopilot_runs")
      .select("ran_at, symbol, side, order_type, notional_usd, status, reason, exchange_id")
      .order("ran_at", { ascending: false })
      .limit(40),
  ]);

  let openExposure = 0;
  for (const p of positions ?? []) openExposure += Number(p.cost_usd) || 0;

  return NextResponse.json({
    positions: positions ?? [],
    runs:      runs ?? [],
    openExposure,
    fetchedAt: new Date().toISOString(),
  });
}
