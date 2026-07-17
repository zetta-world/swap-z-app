/**
 * ORÁCULO desk — frontier models doing ANALYST work, not day-trader-bot work
 * (docs/PLANO-ORACULO-ANALISTA.md).
 *
 * The CEO's diagnosis, confirmed by round-1 data: feed a frontier LLM bot
 * inputs (1h oscillators) and demand bot outputs (a bracket every 30min) and
 * it performs exactly like a bot — every model within ~1pt of every other.
 * The Oráculo flips the question: CONTEXT in (macro, funding, fear&greed,
 * high-timeframe structure), 1-3 weekly THESES out — each with the evidence
 * that would invalidate it, a 7-14 day horizon, and a stop parked outside the
 * noise band. Zero theses is a valid answer.
 *
 * Every configured model runs the SAME thesis question (source `oracle_<id>`,
 * Claude = `oracle_self`) so the tournament measures the format head-to-head
 * against the paused scanner baseline. Same card schema, same ledger, same
 * resolution/panels/cull — the flywheel doesn't know it's a new species.
 */
import { anthropicChat, openaiCompatChat } from "@/lib/ai/provider";
import { configuredProviders, type ProviderConfig } from "@/lib/ai/registry";
import { isTripped, recordResult } from "@/lib/ai/circuit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordEvent, logError } from "@/lib/admin/track";
import { modelChain } from "@/lib/zion/model";
import { ZION_FOUNDATION, ZION_FOUNDATION_VERSION } from "@/lib/zion/foundation";
import { extractCards, extractSuggestion, SCAN_CARDS_SCHEMA } from "@/lib/zion/backtest";
import { getMacroContext } from "@/lib/api/macro";
import { formatIndicatorsForPrompt, type MarketIndicatorsResult } from "@/lib/api/market-indicators";
import type { ActionCard } from "@/lib/zion/parse";

const HORIZON_H     = Number(process.env.ORACLE_HORIZON_H     ?? 240); // 10 days
const MIN_STOP_PCT  = Number(process.env.ORACLE_MIN_STOP_PCT  ?? 4);   // outside daily noise
const MIN_RR        = Number(process.env.ORACLE_MIN_RR        ?? 1.5); // thesis edge is the call, not the geometry
const MAX_OPEN      = Number(process.env.ORACLE_MAX_OPEN      ?? 3);   // per source — scarcity is the strategy
const MAX_THESES    = 3;                                               // per wake

// ── Pure gate (unit-tested) ─────────────────────────────────────────────────

/** A thesis without declared invalidation evidence is a vibe, not a thesis.
 *  The prompt demands "Invalida se: <evidência>" inside the card summary. */
export function invalidationGate(summary: string | undefined | null): boolean {
  return /invalida/i.test(summary ?? "");
}

// ── Context inputs (all public/free, all best-effort) ───────────────────────

/** Crowded-positioning read from Bybit's public linear tickers: the funding
 *  extremes among our tracked majors. Persistent positive funding = longs pay
 *  to stay = crowded long (squeeze fuel), and vice versa. */
async function fetchFundingContext(): Promise<string> {
  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", { next: { revalidate: 300 } });
    if (!res.ok) return "";
    const body = await res.json() as { result?: { list?: Array<{ symbol?: string; fundingRate?: string }> } };
    const rows = (body.result?.list ?? [])
      .filter((r) => (r.symbol ?? "").endsWith("USDT"))
      .map((r) => ({ sym: (r.symbol ?? "").replace(/USDT$/, ""), f: parseFloat(r.fundingRate ?? "") }))
      .filter((r) => Number.isFinite(r.f) && r.sym.length <= 6)
      .sort((a, b) => Math.abs(b.f) - Math.abs(a.f))
      .slice(0, 8);
    if (rows.length === 0) return "";
    const fmt = rows.map((r) => `${r.sym} ${(r.f * 100).toFixed(3)}%`).join(" · ");
    return `Funding extremes (8h, Bybit linear — positive = crowded longs): ${fmt}`;
  } catch { return ""; }
}

/** Crypto Fear & Greed index (alternative.me, free). */
async function fetchFearGreed(): Promise<string> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=7", { next: { revalidate: 3600 } });
    if (!res.ok) return "";
    const body = await res.json() as { data?: Array<{ value?: string; value_classification?: string }> };
    const d = body.data ?? [];
    if (d.length === 0) return "";
    const today = d[0], weekAgo = d[d.length - 1];
    return `Fear & Greed: ${today.value} (${today.value_classification}) — 7d ago: ${weekAgo?.value} (${weekAgo?.value_classification})`;
  } catch { return ""; }
}

// ── The thesis question ─────────────────────────────────────────────────────

function buildThesisInstruction(marketData: MarketIndicatorsResult, macro: string, funding: string, fng: string): string | null {
  const indicatorsText = formatIndicatorsForPrompt(marketData).trim();
  if (!indicatorsText) return null;
  return [
    "You are ZION's ORÁCULO — the thesis analyst desk. You are NOT a scanner",
    "and NOT a day-trading bot: your value is reading CONTEXT (macro, funding,",
    "sentiment, weekly structure) and forming a small number of week-scale",
    "convictions. This call runs once a day. Every thesis is logged and scored",
    "against real price action.",
    "",
    `Emit AT MOST ${MAX_THESES} theses — and ZERO is a respectable answer when the`,
    "context is genuinely unclear. A thesis is NOT 'RSI is oversold'. A thesis",
    "is a causal story: what is mispriced, WHY, what unwinds it, and roughly",
    "when. Positioning (funding), sentiment extremes, macro shifts and weekly",
    "structure are your raw material; the 1h indicators below are background,",
    "not signal.",
    "",
    "Rules per thesis card:",
    `  · Horizon is ~${Math.round(HORIZON_H / 24)} DAYS: entryPrice = current price; the take-profit is`,
    "    where the THESIS pays (typically 8-25% away), the stopLoss is where the",
    `    thesis is WRONG — at least ${MIN_STOP_PCT}% from entry, beyond weekly structure,`,
    "    never inside daily noise.",
    `  · reward:risk >= ${MIN_RR}.`,
    "  · The summary MUST contain the sentence \"Invalida se: <the concrete",
    "    evidence that kills the thesis>\" — no invalidation, no trade.",
    "  · Counter-trend is ALLOWED here (that's the point of a reversal thesis)",
    "    but the invalidation evidence must be explicit and observable.",
    "  · probability = honest confidence (logged for calibration, never obeyed).",
    "",
    "OUTPUT — a SINGLE JSON object, nothing else:",
    '{"cards": [{"kind": "buy_limit"|"sell_safe", "title": "...", "summary": "...',
    'Invalida se: ...", "chain": "...", "from": {"symbol": "...", "address": ""},',
    '"to": {"symbol": "...", "address": ""}, "entryPrice": "...", "exits":',
    '[{"label": "TP1", "price": "...", "profitPct": "..."}], "stopLoss": "...",',
    '"probability": "..."}]}',
    'When nothing qualifies: {"cards": []}.',
    "Machine-format every number (dot decimal, no separators, no symbols).",
    "",
    "<context>",
    macro ? `${macro}\n` : "",
    funding ? `${funding}\n` : "",
    fng ? `${fng}\n` : "",
    "</context>",
    "<market>",
    indicatorsText,
    "</market>",
  ].join("\n");
}

// ── The wake ────────────────────────────────────────────────────────────────

const THESIS_OPTS = { minRR: MIN_RR, regimeFilter: false, minStopPct: MIN_STOP_PCT };

export interface OracleResult { sources: number; logged: number }

/** One Oráculo wake (daily): build the thesis question once, run it through
 *  Claude + every configured provider in parallel, gate each answer through
 *  the thesis funnel, log under oracle_<id>. Best-effort throughout. */
export async function runOracleScan(marketData: MarketIndicatorsResult): Promise<OracleResult> {
  const db = getSupabaseAdmin();
  if (!db) return { sources: 0, logged: 0 };

  const [macro, funding, fng] = await Promise.all([
    getMacroContext().catch(() => ""),
    fetchFundingContext(),
    fetchFearGreed(),
  ]);
  const instruction = buildThesisInstruction(marketData, macro, funding, fng);
  if (!instruction) return { sources: 0, logged: 0 };

  const refBy = new Map<string, number>(), regimeBy = new Map<string, string>();
  for (const ind of marketData.indicators) {
    const sym = ind.symbol.toUpperCase();
    if (ind.price != null && ind.price > 0) refBy.set(sym, ind.price);
    if (ind.regime) regimeBy.set(sym, ind.regime);
  }

  // Open-thesis counts per source (scarcity: max MAX_OPEN standing theses).
  const { data: openRows } = await db.from("zion_suggestions")
    .select("source").like("source", "oracle%").eq("status", "open");
  const openBy = new Map<string, number>();
  for (const r of openRows ?? []) openBy.set(r.source, (openBy.get(r.source) ?? 0) + 1);

  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const runs: Array<{ source: string; exec: () => Promise<ActionCard[]> }> = [];
  if (claudeKey) {
    runs.push({ source: "oracle_self", exec: async () => {
      const r = await anthropicChat(
        { model: modelChain()[0], system: ZION_FOUNDATION, user: instruction, maxTokens: 2200, timeoutMs: 40_000, cacheSystem: true, jsonSchema: SCAN_CARDS_SCHEMA },
        claudeKey,
      );
      recordEvent("zion_analysis", { meta: { op: "oracle", model: r.model, source: "oracle_self", promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
      return extractCards(r.text);
    } });
  }
  for (const p of configuredProviders()) {
    runs.push({ source: `oracle_${p.id}`, exec: () => runOracleForProvider(instruction, p) });
  }

  let logged = 0;
  await Promise.all(runs.map(async ({ source, exec }) => {
    const cards = await exec().catch(() => [] as ActionCard[]);
    const room = Math.max(0, MAX_OPEN - (openBy.get(source) ?? 0));
    const rows = [];
    for (const card of cards.slice(0, MAX_THESES)) {
      if (rows.length >= room) break;
      if (!invalidationGate(card.summary)) continue; // no invalidation, no trade
      const s = extractSuggestion(card, refBy, regimeBy, THESIS_OPTS);
      if (!s) continue;
      rows.push({ ...s, source, horizon_hours: HORIZON_H });
    }
    if (rows.length === 0) return;
    try { await db.from("zion_suggestions").insert(rows); logged += rows.length; }
    catch { /* best-effort — tomorrow retries */ }
  }));

  return { sources: runs.length, logged };
}

async function runOracleForProvider(instruction: string, provider: ProviderConfig): Promise<ActionCard[]> {
  if (!provider.apiKey) return [];
  if (await isTripped(provider.id)) return [];
  try {
    const r = await openaiCompatChat(
      { model: provider.model, system: ZION_FOUNDATION, user: instruction, maxTokens: 2200, timeoutMs: provider.timeoutMs ?? 40_000, temperature: provider.temperature, extraBody: provider.extraBody },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    await recordResult(provider.id, provider.label, true);
    recordEvent("zion_analysis", { meta: { op: "oracle", model: r.model, source: `oracle_${provider.id}`, promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
    return extractCards(r.text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await recordResult(provider.id, provider.label, false, reason);
    logError(`oracle:${provider.id}`, reason, { model: provider.model, source: `oracle_${provider.id}` });
    return [];
  }
}
