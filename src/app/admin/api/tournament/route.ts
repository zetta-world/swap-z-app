import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

// Round-trip execution cost netted out of expectancy (mirrors backtest.ts /
// the Backtest panel) so the tournament ranks agents by the edge a user KEEPS,
// not the gross paper edge. Default 0.2%.
const ROUND_TRIP_COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);
const MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100);

// source (how the suggestion was logged) → human agent name + kind. Keeps the
// ranking readable instead of showing raw "mistral_scan" strings.
const AGENTS: Record<string, { name: string; kind: string }> = {
  self_scan:     { name: "Agent A · ZION (Sonnet)",   kind: "agent" },
  hybrid_scan:   { name: "Agent B · Ferrari (Opus CEO)", kind: "agent" },
  radar:         { name: "Radar T3 (trigger wake)",   kind: "agent" },
  deepseek_scan: { name: "DeepSeek",                   kind: "model" },
  kimi_scan:     { name: "Kimi (Moonshot)",           kind: "model" },
  mistral_scan:  { name: "Mistral",                    kind: "model" },
  llama_scan:    { name: "Llama (Meta)",               kind: "model" },
  grok_scan:     { name: "Grok (xAI)",                 kind: "model" },
};
function labelFor(source: string): { name: string; kind: string } {
  return AGENTS[source] ?? { name: source, kind: "other" };
}

type Agg = {
  source: string; name: string; kind: string;
  total: number; open: number; resolved: number;
  wins: number; losses: number; expired: number;
  sum: number; winSum: number; lossSum: number;
  rrSum: number; rrCount: number;
  probSum: number; probCount: number;   // stated-confidence calibration
  form: string[];                        // recent decided outcomes ("W"/"L")
  curvePts: Array<{ t: number; net: number }>; // resolved trades for the equity curve
};

/** Compound an equity curve (index 100) from resolved trades in resolution
 *  order, then downsample to at most `maxPts` for a lean sparkline payload. */
function equityCurve(pts: Array<{ t: number; net: number }>, maxPts = 40): number[] {
  if (pts.length === 0) return [];
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const eq: number[] = []; let e = 100;
  for (const p of sorted) { e *= 1 + p.net / 100; eq.push(e); }
  if (eq.length <= maxPts) return eq.map((v) => Math.round(v * 10) / 10);
  const step = (eq.length - 1) / (maxPts - 1);
  const out: number[] = [];
  for (let i = 0; i < maxPts; i++) out.push(Math.round(eq[Math.round(i * step)] * 10) / 10);
  return out;
}

/** Tournament ranking: every logging source (Agent A / Agent B / each raw
 *  tournament model / radar) scored head-to-head on the SAME market, ranked by
 *  NET expectancy. This is the leaderboard that decides which brain wins. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  // Paginated full read (A1): PostgREST caps a plain select at 1000 rows with
  // no error — a truncated ledger would rank the agents on stale data.
  type TourRow = { source: string | null; status: string; outcome_pct: number | null; probability: number | null; entry_price: number | null; target_price: number | null; stop_price: number | null; created_at: string; resolved_at: string | null };
  const rows = await selectAllRows<TourRow>((from, to) =>
    db.from("zion_suggestions")
      .select("source, status, outcome_pct, probability, entry_price, target_price, stop_price, created_at, resolved_at")
      .order("created_at", { ascending: true }).range(from, to),
  );

  const by = new Map<string, Agg>();
  const get = (source: string): Agg => {
    let a = by.get(source);
    if (!a) {
      const { name, kind } = labelFor(source);
      a = { source, name, kind, total: 0, open: 0, resolved: 0, wins: 0, losses: 0, expired: 0, sum: 0, winSum: 0, lossSum: 0, rrSum: 0, rrCount: 0, probSum: 0, probCount: 0, form: [], curvePts: [] };
      by.set(source, a);
    }
    return a;
  };

  for (const r of rows) {
    const a = get(r.source ?? "user");
    a.total++;
    if (typeof r.probability === "number") { a.probSum += r.probability; a.probCount++; }
    if (r.entry_price != null && r.target_price != null && r.stop_price != null) {
      const risk = Math.abs(r.entry_price - r.stop_price);
      if (risk > 0) { a.rrSum += Math.abs(r.target_price - r.entry_price) / risk; a.rrCount++; }
    }
    if (r.status === "open") { a.open++; continue; }
    a.resolved++;
    const oc = typeof r.outcome_pct === "number" ? r.outcome_pct : 0;
    a.sum += oc;
    // Equity-curve point: this trade's NET return, at its resolution time.
    a.curvePts.push({ t: Date.parse(r.resolved_at ?? r.created_at), net: oc - ROUND_TRIP_COST_PCT });
    if (r.status === "win" || r.status === "hit_target")      { a.wins++;   a.winSum  += oc; a.form.push("W"); }
    else if (r.status === "loss" || r.status === "hit_stop")  { a.losses++; a.lossSum += oc; a.form.push("L"); }
    else a.expired++;
  }

  const agents = [...by.values()].map((a) => {
    const decided = a.wins + a.losses;
    const gross = a.resolved > 0 ? a.sum / a.resolved : null;
    const winRate = decided > 0 ? a.wins / decided : null;
    const avgConfidence = a.probCount > 0 ? a.probSum / a.probCount : null;
    return {
      source: a.source, name: a.name, kind: a.kind,
      total: a.total, open: a.open, resolved: a.resolved,
      wins: a.wins, losses: a.losses, expired: a.expired,
      winRate,
      expectancy:    gross,                                   // gross, per resolved
      expectancyNet: gross === null ? null : gross - ROUND_TRIP_COST_PCT,
      avgWin:        a.wins   > 0 ? a.winSum  / a.wins   : null,
      avgLoss:       a.losses > 0 ? a.lossSum / a.losses : null,
      profitFactor:  a.lossSum < 0 ? a.winSum / Math.abs(a.lossSum) : null,
      avgRR:         a.rrCount > 0 ? a.rrSum / a.rrCount : null,
      avgConfidence,                                          // mean stated probability
      // Calibration: actual win% minus stated confidence. + = under-confident
      // (better than it claims), − = over-confident (worse than it claims).
      calibration:   winRate != null && avgConfidence != null ? winRate * 100 - avgConfidence : null,
      form:          a.form.slice(-12),                       // recent W/L streak
      curve:         equityCurve(a.curvePts),                 // compounded equity (index 100)
      sufficientSample: decided >= MIN_SAMPLE,
      sampleProgress: Math.min(1, decided / MIN_SAMPLE),
    };
  });

  // Rank by NET expectancy (nulls last), then by decided-sample as tiebreak so
  // a well-tested agent outranks a lucky one-shot with the same headline.
  agents.sort((x, y) => {
    const xn = x.expectancyNet, yn = y.expectancyNet;
    if (xn === null && yn === null) return (y.wins + y.losses) - (x.wins + x.losses);
    if (xn === null) return 1;
    if (yn === null) return -1;
    if (yn !== xn) return yn - xn;
    return (y.wins + y.losses) - (x.wins + x.losses);
  });

  return NextResponse.json({ agents, minSample: MIN_SAMPLE, fetchedAt: new Date().toISOString() });
}
