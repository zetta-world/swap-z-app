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
    db.from("zion_suggestions").select("status, outcome_pct, regime, entry_price, target_price, stop_price"),
    db.from("zion_suggestions")
      .select("symbol, side, status, outcome_pct, probability, regime, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  let open = 0, wins = 0, losses = 0, neutral = 0, resolved = 0, sum = 0;
  let winSum = 0, lossSum = 0;          // for avg win / avg loss + profit factor
  let rrSum = 0, rrCount = 0;           // mean planned reward:risk
  const byRegime: Record<string, { wins: number; losses: number }> = {};
  for (const r of all ?? []) {
    // Planned R:R is a property of the suggestion regardless of outcome.
    if (r.entry_price != null && r.target_price != null && r.stop_price != null) {
      const risk = Math.abs(r.entry_price - r.stop_price);
      if (risk > 0) { rrSum += Math.abs(r.target_price - r.entry_price) / risk; rrCount++; }
    }
    if (r.status === "open") { open++; continue; }
    resolved++;
    const oc = typeof r.outcome_pct === "number" ? r.outcome_pct : 0;
    sum += oc;
    const win  = r.status === "win"  || r.status === "hit_target";
    const loss = r.status === "loss" || r.status === "hit_stop";
    if (win)  { wins++;   winSum  += oc; }
    else if (loss) { losses++; lossSum += oc; }   // lossSum is negative
    else neutral++;
    const rg = r.regime ?? "—";
    (byRegime[rg] ??= { wins: 0, losses: 0 });
    if (win) byRegime[rg].wins++; else if (loss) byRegime[rg].losses++;
  }
  const decided = wins + losses;

  return NextResponse.json({
    total: (all ?? []).length, open, resolved, wins, losses, neutral,
    winRate:    decided  > 0 ? wins / decided : null,
    // Expectancy = mean directional outcome per resolved trade — THE headline:
    // it bakes in both how often ZION is right AND how big wins are vs losses.
    expectancy: resolved > 0 ? sum / resolved : null,
    avgOutcome: resolved > 0 ? sum / resolved : null, // kept for back-compat
    avgWin:     wins   > 0 ? winSum  / wins   : null,
    avgLoss:    losses > 0 ? lossSum / losses : null,  // negative
    // Profit factor = gross gains / gross losses. >1 = net profitable.
    profitFactor: lossSum < 0 ? winSum / Math.abs(lossSum) : null,
    avgRR:      rrCount > 0 ? rrSum / rrCount : null,
    byRegime,
    recent: recent ?? [],
    fetchedAt: new Date().toISOString(),
  });
}
