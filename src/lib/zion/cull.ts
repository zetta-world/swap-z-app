/**
 * Tournament cull — alavanca 3 of docs/PLANO-LUCRATIVIDADE.md.
 *
 * The tournament is a cut factory, not a museum: once an agent closes the
 * minimum sample IN THE LIVE ROUND with NEGATIVE net expectancy, it stops
 * earning token spend — the cron skips its scan from the next tick on. The
 * best net-positive agent (same sample bar) is marked champion, and the paper
 * engine concentrates capital on it (PAPER_CHAMPION_MULT sizing).
 *
 * Honest-flywheel rules apply: NET of cost, decided = target/stop only
 * (expired is neither), minimum sample before any verdict, and the whole
 * check reads ONLY the live round (archived_at IS NULL) — an archived round
 * can never cull a reformed agent.
 *
 * A cull is a standing admin_kv flag (`culled:<source>`), so the operator can
 * lift it from the panel / SQL by deleting the key or setting "false" — and a
 * round archive (which resets the measurement) is the natural amnesty point.
 * TOURNAMENT_CULL=off disables the automatic verdicts entirely.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { recordEvent } from "@/lib/admin/track";

const CULL_ON    = (process.env.TOURNAMENT_CULL ?? "on") !== "off";
const MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100);
const COST_PCT   = Number(process.env.BACKTEST_COST_PCT ?? 0.2);

/** Scan agents subject to the cull. Radar and sniper stay out: they are the
 *  event-driven control group / scarcity-budgeted desk, not 30-min spenders. */
export const CULL_SOURCES = ["self_scan", "hybrid_scan", "mistral_scan", "grok_scan", "deepseek_scan", "kimi_scan"] as const;

export interface SourceStat { source: string; decided: number; resolved: number; expectancyNet: number | null }

/** Pure verdict: who gets culled, who is champion. Sub-sample agents are
 *  untouchable either way — a lucky/unlucky streak is not a verdict. */
export function decideCull(stats: SourceStat[], minSample = MIN_SAMPLE): { cull: string[]; champion: string | null } {
  const judged = stats.filter((s) => s.decided >= minSample && s.expectancyNet != null);
  const cull = judged.filter((s) => s.expectancyNet! < 0).map((s) => s.source);
  const champion = judged
    .filter((s) => s.expectancyNet! > 0)
    .sort((a, b) => b.expectancyNet! - a.expectancyNet!)[0]?.source ?? null;
  return { cull, champion };
}

/** admin_kv `culled:<source>` flags currently standing. */
export async function getCulledSources(): Promise<Set<string>> {
  const out = new Set<string>();
  const db = getSupabaseAdmin();
  if (!db) return out;
  try {
    const { data } = await db.from("admin_kv").select("key, value").like("key", "culled:%");
    for (const r of data ?? []) if (r.value === "true") out.add(r.key.slice("culled:".length));
  } catch { /* best-effort — nobody culled on a KV hiccup */ }
  return out;
}

/** One cull tick (cron, after resolution): live-round stats per agent →
 *  standing verdicts. Idempotent — flags flip once, events fire once. */
export async function runTournamentCull(): Promise<{ culled: string[]; champion: string | null }> {
  const none = { culled: [] as string[], champion: null };
  if (!CULL_ON) return none;
  const db = getSupabaseAdmin();
  if (!db) return none;

  const rows = await selectAllRows<{ source: string | null; status: string; outcome_pct: number | null }>((from, to) =>
    db.from("zion_suggestions").select("source, status, outcome_pct")
      .in("source", CULL_SOURCES as unknown as string[])
      .is("archived_at", null) // live round only — the archive is history, not evidence
      .order("created_at", { ascending: true }).range(from, to),
  );

  const agg = new Map<string, { decided: number; resolved: number; sum: number }>();
  for (const r of rows) {
    if (!r.source || r.status === "open") continue;
    const a = agg.get(r.source) ?? { decided: 0, resolved: 0, sum: 0 };
    a.resolved++; a.sum += Number(r.outcome_pct) || 0;
    if (r.status === "hit_target" || r.status === "win" || r.status === "hit_stop" || r.status === "loss") a.decided++;
    agg.set(r.source, a);
  }
  const stats: SourceStat[] = [...agg.entries()].map(([source, a]) => ({
    source, decided: a.decided, resolved: a.resolved,
    expectancyNet: a.resolved > 0 ? a.sum / a.resolved - COST_PCT : null,
  }));

  const verdict = decideCull(stats);
  const already = await getCulledSources();
  const now = new Date().toISOString();

  for (const source of verdict.cull) {
    if (already.has(source)) continue; // standing verdict — don't re-announce
    try {
      await db.from("admin_kv").upsert({ key: `culled:${source}`, value: "true", updated_at: now }, { onConflict: "key" });
      const s = stats.find((x) => x.source === source);
      recordEvent("tournament_cull", { meta: {
        source, decided: s?.decided ?? 0,
        expectancyNet: s?.expectancyNet != null ? Math.round(s.expectancyNet * 100) / 100 : null,
      } });
    } catch { /* best-effort — next tick retries */ }
  }

  try {
    const { data: cur } = await db.from("admin_kv").select("value").eq("key", "tournament_champion").maybeSingle();
    const prev = cur?.value ?? null;
    const next = verdict.champion ?? "";
    if (verdict.champion && prev !== next) {
      await db.from("admin_kv").upsert({ key: "tournament_champion", value: next, updated_at: now }, { onConflict: "key" });
      const s = stats.find((x) => x.source === verdict.champion);
      recordEvent("tournament_champion", { meta: {
        source: verdict.champion, previous: prev,
        expectancyNet: s?.expectancyNet != null ? Math.round(s.expectancyNet * 100) / 100 : null,
      } });
    }
  } catch { /* best-effort */ }

  return { culled: verdict.cull, champion: verdict.champion };
}
