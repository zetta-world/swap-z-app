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
// Auditoria 25/07: the desk's five losses were near-identical ARB longs —
// including a re-buy the DAY AFTER being stopped (stateless daily calls have
// no memory), and 6 of 14 desk theses piled on one symbol. Three locks:
const STOP_COOLDOWN_D = Number(process.env.ORACLE_STOP_COOLDOWN_D ?? 7); // days a model waits after a stop on that symbol
const MAX_PER_SYMBOL  = Number(process.env.ORACLE_MAX_PER_SYMBOL  ?? 2); // desk-wide open theses per symbol (all models)

// ── Pure gate (unit-tested) ─────────────────────────────────────────────────

/** A thesis without declared invalidation evidence is a vibe, not a thesis.
 *  The prompt demands "Invalida se: <evidência>" inside the card summary. */
export function invalidationGate(summary: string | undefined | null): boolean {
  return /invalida/i.test(summary ?? "");
}

/** Symbol-level locks (auditoria 25/07). A thesis is allowed only if the
 *  model isn't re-buying a knife it was just stopped on (cooldown), doesn't
 *  already hold a thesis on the symbol, and the DESK isn't piled on it. */
export function symbolAllowed(
  symbol: string,
  ctx: { cooldown: Set<string>; ownOpen: Set<string>; deskOpenCount: number },
  maxPerSymbol = MAX_PER_SYMBOL,
): boolean {
  if (ctx.cooldown.has(symbol)) return false;
  if (ctx.ownOpen.has(symbol)) return false;
  return ctx.deskOpenCount < maxPerSymbol;
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

function buildThesisInstruction(marketData: MarketIndicatorsResult, macro: string, funding: string, fng: string, memory: string): string | null {
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
    memory ? `<your_desk_memory>\n${memory}\n</your_desk_memory>\n` : "",
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

  const refBy = new Map<string, number>(), regimeBy = new Map<string, string>();
  for (const ind of marketData.indicators) {
    const sym = ind.symbol.toUpperCase();
    if (ind.price != null && ind.price > 0) refBy.set(sym, ind.price);
    if (ind.regime) regimeBy.set(sym, ind.regime);
  }

  // Desk memory (auditoria 25/07): open theses + last-7-days outcomes, per
  // source. Feeds the per-model prompt (no more stateless amnesia) AND the
  // symbol locks: post-stop cooldown, one-thesis-per-symbol-per-model,
  // desk-wide concentration cap.
  const since = new Date(Date.now() - STOP_COOLDOWN_D * 86_400_000).toISOString();
  const { data: histRows } = await db.from("zion_suggestions")
    .select("source, symbol, side, status, outcome_pct, created_at, resolved_at")
    .like("source", "oracle%")
    .or(`status.eq.open,resolved_at.gte.${since}`);
  const openBy = new Map<string, number>();
  const ownOpenBy = new Map<string, Set<string>>();
  const deskOpenBySym = new Map<string, number>();
  const cooldownBy = new Map<string, Set<string>>();
  const memoryBy = new Map<string, string[]>();
  for (const r of histRows ?? []) {
    const mem = memoryBy.get(r.source) ?? [];
    if (r.status === "open") {
      openBy.set(r.source, (openBy.get(r.source) ?? 0) + 1);
      (ownOpenBy.get(r.source) ?? ownOpenBy.set(r.source, new Set()).get(r.source)!).add(r.symbol);
      deskOpenBySym.set(r.symbol, (deskOpenBySym.get(r.symbol) ?? 0) + 1);
      mem.push(`OPEN: ${r.side} ${r.symbol} (since ${r.created_at?.slice(0, 10)}) — still standing, do NOT re-emit it.`);
    } else {
      const out = typeof r.outcome_pct === "number" ? `${r.outcome_pct > 0 ? "+" : ""}${r.outcome_pct.toFixed(1)}%` : "?";
      mem.push(`${r.status.toUpperCase()}: ${r.side} ${r.symbol} → ${out} (resolved ${r.resolved_at?.slice(0, 10)}).`);
      if (r.status === "hit_stop") {
        (cooldownBy.get(r.source) ?? cooldownBy.set(r.source, new Set()).get(r.source)!).add(r.symbol);
      }
    }
    memoryBy.set(r.source, mem);
  }
  const memoryFor = (source: string): string => {
    const mem = memoryBy.get(source) ?? [];
    const cooled = [...(cooldownBy.get(source) ?? [])];
    const lines = [
      "Your desk's record (last 7 days). An INVALIDATED thesis stays dead unless",
      "the world produced NEW evidence — re-buying the same falling knife the",
      "day after a stop is how this desk lost money before you.",
      ...mem,
    ];
    if (cooled.length) lines.push(`On your post-stop cooldown (${STOP_COOLDOWN_D}d) — the ledger REJECTS new theses on: ${cooled.join(", ")}.`);
    return mem.length || cooled.length ? lines.join("\n") : "";
  };

  // Bail early when there are no usable indicators this tick.
  if (!buildThesisInstruction(marketData, macro, funding, fng, "")) return { sources: 0, logged: 0 };

  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const runs: Array<{ source: string; exec: (instruction: string) => Promise<ActionCard[]> }> = [];
  if (claudeKey) {
    runs.push({ source: "oracle_self", exec: async (instruction) => {
      const r = await anthropicChat(
        { model: modelChain()[0], system: ZION_FOUNDATION, user: instruction, maxTokens: 2200, timeoutMs: 40_000, cacheSystem: true, jsonSchema: SCAN_CARDS_SCHEMA },
        claudeKey,
      );
      recordEvent("zion_analysis", { meta: { op: "oracle", model: r.model, source: "oracle_self", promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
      return extractCards(r.text);
    } });
  }
  for (const p of configuredProviders()) {
    runs.push({ source: `oracle_${p.id}`, exec: (instruction) => runOracleForProvider(instruction, p) });
  }

  let logged = 0;
  await Promise.all(runs.map(async ({ source, exec }) => {
    // Each model gets ITS OWN memory block — the amnesia fix is per-desk.
    const instruction = buildThesisInstruction(marketData, macro, funding, fng, memoryFor(source));
    if (!instruction) return;
    const cards = await exec(instruction).catch(() => [] as ActionCard[]);
    const room = Math.max(0, MAX_OPEN - (openBy.get(source) ?? 0));
    const cooldown = cooldownBy.get(source) ?? new Set<string>();
    const ownOpen = ownOpenBy.get(source) ?? new Set<string>();
    const rows = [];
    for (const card of cards.slice(0, MAX_THESES)) {
      if (rows.length >= room) break;
      if (!invalidationGate(card.summary)) continue; // no invalidation, no trade
      const s = extractSuggestion(card, refBy, regimeBy, THESIS_OPTS);
      if (!s) continue;
      if (!symbolAllowed(s.symbol, { cooldown, ownOpen, deskOpenCount: deskOpenBySym.get(s.symbol) ?? 0 })) continue;
      rows.push({ ...s, source, horizon_hours: HORIZON_H });
      ownOpen.add(s.symbol);
      deskOpenBySym.set(s.symbol, (deskOpenBySym.get(s.symbol) ?? 0) + 1);
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
