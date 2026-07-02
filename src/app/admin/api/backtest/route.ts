import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Round-trip execution cost (taker fee + slippage, both legs) netted out of
// expectancy so the panel shows the edge a user actually keeps, not the gross
// paper edge (P0.1). Mirrors BACKTEST_COST_PCT in backtest.ts. Default 0.2%.
const ROUND_TRIP_COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);
const MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100);

/** Shadow-Flywheel stats for the admin Backtest panel: win-rate, expectancy,
 *  breakdown by regime, and the most recent suggestions. Optional `?source=`
 *  filter (R2.4) so the headline can be read PER AGENT (self_scan /
 *  hybrid_scan / <provider>_scan / radar) instead of everything blended. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  // Whitelist shape (letters/digits/underscore, short) — never pass raw user
  // input into a filter, even behind requireAdmin.
  const rawSource = req.nextUrl.searchParams.get("source") ?? "";
  const source = /^[a-z0-9_]{1,32}$/.test(rawSource) ? rawSource : null;

  let allQ = db.from("zion_suggestions").select("status, outcome_pct, regime, entry_price, target_price, stop_price");
  let recentQ = db.from("zion_suggestions")
    .select("symbol, side, status, outcome_pct, probability, regime, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  if (source) { allQ = allQ.eq("source", source); recentQ = recentQ.eq("source", source); }

  const [{ data: all }, { data: recent }] = await Promise.all([allQ, recentQ]);

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
  const gross = resolved > 0 ? sum / resolved : null;

  return NextResponse.json({
    total: (all ?? []).length, open, resolved, wins, losses, neutral,
    expired: neutral, // alias: horizon-elapsed / no-touch (kept `neutral` for back-compat)
    winRate:    decided  > 0 ? wins / decided : null,
    // Expectancy = mean directional outcome per resolved trade — THE headline:
    // it bakes in both how often ZION is right AND how big wins are vs losses.
    expectancy: gross,
    // NET of round-trip fees + slippage — what the user actually keeps (P0.1).
    expectancyNet: gross === null ? null : gross - ROUND_TRIP_COST_PCT,
    // Only trust the numbers once the decided sample clears the noise floor.
    sufficientSample: decided >= MIN_SAMPLE,
    signalRate: resolved > 0 ? decided / resolved : null, // decided / all resolved
    avgOutcome: gross, // kept for back-compat
    avgWin:     wins   > 0 ? winSum  / wins   : null,
    avgLoss:    losses > 0 ? lossSum / losses : null,  // negative
    // Profit factor = gross gains / gross losses. >1 = net profitable.
    profitFactor: lossSum < 0 ? winSum / Math.abs(lossSum) : null,
    avgRR:      rrCount > 0 ? rrSum / rrCount : null,
    byRegime,
    recent: recent ?? [],
    source, // null = all agents blended
    fetchedAt: new Date().toISOString(),
  });
}
