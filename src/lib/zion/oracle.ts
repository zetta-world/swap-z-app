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
import { openaiCompatChat } from "@/lib/ai/provider";
import { configuredProviders, type ProviderConfig } from "@/lib/ai/registry";
import { isTripped, recordResult } from "@/lib/ai/circuit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { recordEvent, logError } from "@/lib/admin/track";
import { ZION_FOUNDATION, ZION_FOUNDATION_VERSION } from "@/lib/zion/foundation";
import { extractCards, extractSuggestion } from "@/lib/zion/backtest";
import { getMacroContext } from "@/lib/api/macro";
import { fetchFundingContext, fetchFearGreed } from "@/lib/api/market-context";
import { getActiveLessons, lessonsBlock } from "@/lib/zion/retro";
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

// Context inputs live in src/lib/api/market-context.ts (shared with the
// relit scanners since 25/07).

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
  // ⚠️ PAGINADO: alimenta o retrato que o Oráculo lê antes de decidir. Truncado,
  // ele decide com metade da própria história e não tem como saber disso.
  // inclui-arquivadas: o histórico de acerto da mesa É o dado; filtrar
  // arquivadas apagaria justamente as rodadas antigas que dão base à conta.
  const histRows = await selectAllRows<{ source: string; symbol: string; side: string; status: string; outcome_pct: number | null; created_at: string; resolved_at: string | null }>(
    (from, to) => db.from("zion_suggestions")
      .select("source, symbol, side, status, outcome_pct, created_at, resolved_at")
      .like("source", "oracle%")
      .or(`status.eq.open,resolved_at.gte.${since}`)
      .order("id", { ascending: true }).range(from, to));
  const openBy = new Map<string, number>();
  const ownOpenBy = new Map<string, Set<string>>();
  const deskOpenBySym = new Map<string, number>();
  // DESK-WIDE cooldown (27/07). The per-model version shipped 25/07 had a
  // hole the data found immediately: 5 of the desk's first 6 losses were the
  // SAME ARB long, bought by three different models — Kimi entered it two
  // days after DeepSeek and Mistral were already stopped there, because Kimi
  // itself had never been stopped on ARB. A stop is evidence about the
  // SYMBOL, not about the model that took it, so one stop now blocks the
  // symbol for the whole desk. (Kimi's own Auto-Retro asked for exactly this:
  // "impose a 48h asset-specific cooling-off period after any stop-out".)
  const deskCooldown = new Set<string>();
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
      if (r.status === "hit_stop") deskCooldown.add(r.symbol);
    }
    memoryBy.set(r.source, mem);
  }
  const cooled = [...deskCooldown];
  const memoryFor = (source: string): string => {
    const mem = memoryBy.get(source) ?? [];
    const lines = [
      "Your desk's record (last 7 days). An INVALIDATED thesis stays dead unless",
      "the world produced NEW evidence — re-buying the same falling knife the",
      "day after a stop is how this desk lost money before you.",
      ...mem,
    ];
    if (cooled.length) {
      lines.push(
        `DESK COOLDOWN (${STOP_COOLDOWN_D}d) — a stop by ANY analyst on this desk,`,
        "not just you, blocks the symbol for everyone: the stop is evidence about",
        "the SYMBOL. The ledger REJECTS new theses on: " + cooled.join(", ") + ".",
      );
    }
    return mem.length || cooled.length ? lines.join("\n") : "";
  };

  // Bail early when there are no usable indicators this tick.
  if (!buildThesisInstruction(marketData, macro, funding, fng, "")) return { sources: 0, logged: 0 };

  // oracle_self (Claude) RETIRED 27/07 — with Agent A gone and Agent B off
  // Anthropic, this desk was the last Anthropic seat in the flywheel, and the
  // thesis cohort showed no separation between the expensive brain and the
  // cheap ones. Its 3 open theses still resolve (resolution is free and
  // source-agnostic), so the data it already produced is not lost.
  const runs: Array<{ source: string; exec: (instruction: string) => Promise<ActionCard[]> }> = [];
  for (const p of configuredProviders()) {
    runs.push({ source: `oracle_${p.id}`, exec: (instruction) => runOracleForProvider(instruction, p) });
  }

  // Auto-Retro lessons: each model's own distilled reflections ride along
  // with its desk memory (context, never permission).
  const lessons = await getActiveLessons(runs.map((r) => r.source));

  let logged = 0;
  await Promise.all(runs.map(async ({ source, exec }) => {
    // Each model gets ITS OWN memory + lessons block — reflection is per-desk.
    const memory = [memoryFor(source), lessonsBlock(lessons.get(source))].filter(Boolean).join("\n\n");
    const instruction = buildThesisInstruction(marketData, macro, funding, fng, memory);
    if (!instruction) return;
    const cards = await exec(instruction).catch(() => [] as ActionCard[]);
    const room = Math.max(0, MAX_OPEN - (openBy.get(source) ?? 0));
    const ownOpen = ownOpenBy.get(source) ?? new Set<string>();
    const rows = [];
    for (const card of cards.slice(0, MAX_THESES)) {
      if (rows.length >= room) break;
      if (!invalidationGate(card.summary)) continue; // no invalidation, no trade
      const s = extractSuggestion(card, refBy, regimeBy, THESIS_OPTS);
      if (!s) continue;
      if (!symbolAllowed(s.symbol, { cooldown: deskCooldown, ownOpen, deskOpenCount: deskOpenBySym.get(s.symbol) ?? 0 })) continue;
      rows.push({ ...s, source, horizon_hours: HORIZON_H });
      ownOpen.add(s.symbol);
      deskOpenBySym.set(s.symbol, (deskOpenBySym.get(s.symbol) ?? 0) + 1);
    }
    if (rows.length === 0) return;
    // O cliente do Supabase NÃO lança em erro de banco: resolve com
    // `{ error }`. Um `try/catch` aqui nunca dispararia, e a contagem devolvida
    // seria uma MENTIRA — linhas "gravadas" que não existem. Foi essa mesma
    // suposição que fez as carteiras de paper vazarem capital (ver
    // `paper/engine.ts`). Aqui o estrago é de medição, não de dinheiro, mas uma
    // mesa que relata trades inexistentes envenena o experimento igual.
    const { error } = await db.from("zion_suggestions").insert(rows);
    if (!error) logged += rows.length;
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
