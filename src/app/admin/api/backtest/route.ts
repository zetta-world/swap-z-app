import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Shadow-Flywheel stats for the admin Backtest panel: win-rate, expectancy,
 *  breakdown by regime, and the most recent suggestions. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: all }, { data: recent }] = await Promise.all([
    db.from("zion_suggestions").select("status, outcome_pct, regime"),
    db.from("zion_suggestions")
      .select("symbol, side, status, outcome_pct, probability, regime, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  let open = 0, wins = 0, losses = 0, neutral = 0, resolved = 0, sum = 0;
  const byRegime: Record<string, { wins: number; losses: number }> = {};
  for (const r of all ?? []) {
    if (r.status === "open") { open++; continue; }
    resolved++;
    if (typeof r.outcome_pct === "number") sum += r.outcome_pct;
    const win  = r.status === "win"  || r.status === "hit_target";
    const loss = r.status === "loss" || r.status === "hit_stop";
    if (win) wins++; else if (loss) losses++; else neutral++;
    const rg = r.regime ?? "—";
    (byRegime[rg] ??= { wins: 0, losses: 0 });
    if (win) byRegime[rg].wins++; else if (loss) byRegime[rg].losses++;
  }
  const decided = wins + losses;

  return NextResponse.json({
    total: (all ?? []).length, open, resolved, wins, losses, neutral,
    winRate:    decided  > 0 ? wins / decided : null,
    avgOutcome: resolved > 0 ? sum / resolved : null,
    byRegime,
    recent: recent ?? [],
    fetchedAt: new Date().toISOString(),
  });
}
