import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The operations ledger for the admin OPERATIONS panel: every client action
 *  with wallet, type, pair, volume and realized P&L. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: all, count }, { data: recent }] = await Promise.all([
    db.from("operations").select("kind, volume_usd, pnl_usd", { count: "exact" }),
    db.from("operations")
      .select("wallet_address, kind, pair, side, volume_usd, pnl_usd, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  let totalVolume = 0, totalPnl = 0;
  const byKind: Record<string, { count: number; volume: number; pnl: number }> = {};
  for (const r of all ?? []) {
    totalVolume += Number(r.volume_usd) || 0;
    totalPnl    += Number(r.pnl_usd)    || 0;
    (byKind[r.kind] ??= { count: 0, volume: 0, pnl: 0 });
    byKind[r.kind].count++;
    byKind[r.kind].volume += Number(r.volume_usd) || 0;
    byKind[r.kind].pnl    += Number(r.pnl_usd)    || 0;
  }

  return NextResponse.json({
    total: count ?? (all ?? []).length,
    totalVolume,
    totalPnl,
    byKind,
    recent: recent ?? [],
    fetchedAt: new Date().toISOString(),
  });
}
