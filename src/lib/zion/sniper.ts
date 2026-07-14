/**
 * SNIPER agent — the profitability experiment distilled from 1,870 decided
 * flywheel trades (docs/PLANO-AGENTE-SNIPER.md):
 *
 *   · event-driven beats timer-driven — the radar was the ONLY net-positive
 *     agent (+1.22%), every 30-min scanner lost;
 *   · the model's STATED probability is INVERTED (70%+ confidence trades were
 *     the worst, −1.91%) — so every quality gate here is OBJECTIVE, the
 *     self-reported probability is logged but never trusted;
 *   · forced coverage manufactures losers — here an empty answer is VALID;
 *   · scarcity: a monthly trade budget (mirrors a Trader-plan allowance), so
 *     the agent "saves bullets" for the best setups.
 *
 * Runs ONLY on radar price triggers, analyzes ONLY the triggered symbols, and
 * refuses anything counter-trend, weak-R:R, bracket-less, or over budget.
 * Suggestions log as source='sniper' → the existing resolution engine, paper
 * wallet, tournament and digest all measure it automatically.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { openaiCompatChat } from "@/lib/ai/provider";
import { hybridBrain } from "@/lib/ai/registry";
import { isTripped, recordResult } from "@/lib/ai/circuit";
import { recordEvent, logError } from "@/lib/admin/track";
import { ZION_FOUNDATION, ZION_FOUNDATION_VERSION } from "@/lib/zion/foundation";
import { extractCards, extractSuggestion } from "@/lib/zion/backtest";
import { formatIndicatorsForPrompt, type MarketIndicatorsResult } from "@/lib/api/market-indicators";
import type { RadarTrigger } from "@/lib/zion/radar";

const MONTHLY_BUDGET = Number(process.env.SNIPER_MONTHLY_BUDGET ?? 30); // ≈ Trader plan, ~1/day
const MIN_RR         = Number(process.env.SNIPER_MIN_RR ?? 1.5);
const MAX_CARDS      = 2; // per wake — a sniper doesn't spray

// ── Pure gates (unit-tested; objective by design — never the model's word) ──

/** With-trend only, in BOTH directions: buys need a confirmed uptrend, sells a
 *  confirmed downtrend. RANGING/TRANSITIONING → no trade (validated on 1,870
 *  decided: with-trend won 70-92% in bull AND bear windows). */
export function trendGate(side: "buy" | "sell", regime: string | null | undefined): boolean {
  return side === "buy" ? regime === "TRENDING_UP" : regime === "TRENDING_DOWN";
}

/** Full bracket required + reward:risk ≥ MIN_RR (stricter than the ledger's
 *  ≥1). A sniper never enters without knowing exactly where it's wrong. */
export function rrGate(
  side: "buy" | "sell",
  entry: number | null | undefined,
  target: number | null | undefined,
  stop: number | null | undefined,
  minRR = MIN_RR,
): boolean {
  if (entry == null || target == null || stop == null || !(entry > 0)) return false;
  const dir = side === "buy" ? 1 : -1;
  const reward = (target - entry) * dir;
  const risk   = (entry - stop) * dir;
  return reward > 0 && risk > 0 && reward / risk >= minRR;
}

/** Shots left this calendar month. The scarcity is the strategy. */
export function budgetLeft(usedThisMonth: number, budget = MONTHLY_BUDGET): number {
  return Math.max(0, budget - Math.max(0, usedThisMonth));
}

// ── The wake ────────────────────────────────────────────────────────────────

function sniperInstruction(marketData: MarketIndicatorsResult, triggers: RadarTrigger[]): string {
  const trig = triggers.map((t) => `${t.symbol} ${t.movePct > 0 ? "+" : ""}${t.movePct}%`).join(", ");
  return [
    "You are ZION's SNIPER desk. A price event just fired: " + trig + ".",
    "You have a LIMITED monthly trade budget, so you only take setups you would",
    "risk real money on. You are NOT required to trade:",
    '  · If nothing qualifies, respond {"cards": []} — that is a GOOD answer.',
    `  · At most ${MAX_CARDS} cards, only on the triggered symbols.`,
    "  · Trade WITH the prevailing trend only (long in an uptrend, short in a",
    "    downtrend). Counter-trend and ranging setups are automatic passes.",
    "  · Every card needs entryPrice (current price), ONE take-profit rung and a",
    `    stopLoss with reward:risk >= ${MIN_RR} — target realistic for ~72h (never`,
    "    a multiple of the price), stop just beyond structure.",
    "  · probability = your honest confidence (it is logged, not obeyed).",
    "",
    "OUTPUT — a SINGLE JSON object, nothing else:",
    '{"cards": [{"kind": "buy_limit"|"sell_safe", "title": "...", "summary": "...",',
    '"chain": "...", "from": {"symbol": "...", "address": ""}, "to": {"symbol": "...",',
    '"address": ""}, "entryPrice": "...", "exits": [{"label": "TP1", "price": "...",',
    '"profitPct": "..."}], "stopLoss": "...", "probability": "..."}]}',
    "Machine-format every number (dot decimal, no separators).",
    "",
    "<market>",
    formatIndicatorsForPrompt(marketData).trim(),
    "</market>",
  ].join("\n");
}

export interface SniperResult { fired: number; passed: number; skipped: string | null }

/** One sniper wake: budget → cheap brain (license to refuse) → objective gates
 *  → ledger. Best-effort throughout; never throws into the radar cron. */
export async function runSniperScan(marketData: MarketIndicatorsResult, triggers: RadarTrigger[]): Promise<SniperResult> {
  const db = getSupabaseAdmin();
  if (!db) return { fired: 0, passed: 0, skipped: "db" };

  // ① Budget — count this calendar month's sniper entries.
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("zion_suggestions")
    .select("*", { count: "exact", head: true })
    .eq("source", "sniper").gte("created_at", monthStart.toISOString());
  const left = budgetLeft(count ?? 0);
  if (left === 0) return { fired: 0, passed: 0, skipped: "budget" };

  // ② The cheap brain, breaker-aware.
  const brain = hybridBrain();
  if (!brain?.apiKey) return { fired: 0, passed: 0, skipped: "no_brain" };
  if (await isTripped(brain.id)) return { fired: 0, passed: 0, skipped: "breaker" };

  let cards;
  try {
    const r = await openaiCompatChat(
      { model: brain.model, system: ZION_FOUNDATION, user: sniperInstruction(marketData, triggers),
        maxTokens: 1200, timeoutMs: brain.timeoutMs ?? 30_000, temperature: brain.temperature, extraBody: brain.extraBody },
      { apiKey: brain.apiKey, baseUrl: brain.baseUrl },
    );
    await recordResult(brain.id, brain.label, true);
    recordEvent("zion_analysis", { meta: { op: "sniper", model: r.model, source: "sniper", promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
    cards = extractCards(r.text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await recordResult(brain.id, brain.label, false, reason);
    logError(`sniper:${brain.id}`, reason, { model: brain.model, source: "sniper" });
    return { fired: 0, passed: 0, skipped: "llm_error" };
  }

  // ③ Objective gates on top of the ledger's own sanity gates.
  const refBy = new Map<string, number>(), regimeBy = new Map<string, string>();
  for (const ind of marketData.indicators) {
    const sym = ind.symbol.toUpperCase();
    if (ind.price != null && ind.price > 0) refBy.set(sym, ind.price);
    if (ind.regime) regimeBy.set(sym, ind.regime);
  }
  const rows = [];
  for (const card of cards.slice(0, MAX_CARDS)) {
    const s = extractSuggestion(card, refBy, regimeBy); // scale/geometry/clamp gates
    if (!s) continue;
    if (!trendGate(s.side, regimeBy.get(s.symbol))) continue;
    if (!rrGate(s.side, s.entry_price, s.target_price, s.stop_price)) continue;
    rows.push({ ...s, source: "sniper" });
    if (rows.length >= left) break; // never overshoot the month's budget
  }

  if (rows.length > 0) {
    try { await db.from("zion_suggestions").insert(rows); }
    catch { return { fired: cards.length, passed: 0, skipped: "insert_error" }; }
  }
  return { fired: cards.length, passed: rows.length, skipped: null };
}
