/**
 * Shadow Flywheel (Z5/Z6) — log every ZION suggestion and measure how it
 * played out, so "ZION works" becomes a number instead of an opinion.
 *
 *   logSuggestions()       — record tradeable cards with the market price now.
 *   resolveOpenSuggestions() — check open rows against current price: target/
 *                              stop hit, or a directional outcome at horizon.
 *   getBacktestStats()     — aggregate win-rate / expectancy.
 *
 * Server-only. Best-effort: a DB hiccup never breaks the caller.
 */

import { anthropicChat, openaiCompatChat } from "@/lib/ai/provider";
import { roleProvider, type ProviderConfig } from "@/lib/ai/registry";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCexSpotPrices } from "@/lib/api/cex-spot";
import { parsePrice, normalizeSymbol } from "@/lib/zion/card-mapping";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import { recordEvent } from "@/lib/admin/track";
import { modelChain } from "@/lib/zion/model";
import { ZION_FOUNDATION, ZION_FOUNDATION_VERSION } from "@/lib/zion/foundation";
import { formatIndicatorsForPrompt, type SymbolIndicators, type MarketIndicatorsResult } from "@/lib/api/market-indicators";
import { getMacroContext } from "@/lib/api/macro";
import type { ZionSuggestionRow } from "@/lib/supabase/types";

/**
 * Generate scored predictions for the backtester (Z6). Unlike the autopilot
 * scan (deliberately "do nothing unless high-confidence"), this asks ZION for
 * a directional call on EVERY symbol it has a lean on — so the ledger fills
 * with a steady stream of predictions to measure. Non-streaming, one call.
 */
/** Build the backtest scan instruction (shared by every model in the A/B).
 *  Returns null when there are no usable indicators this tick. */
async function buildScanInstruction(marketData: MarketIndicatorsResult): Promise<string | null> {
  const indicatorsText = formatIndicatorsForPrompt(marketData).trim();
  if (!indicatorsText) return null;
  const macroText = await getMacroContext().catch(() => "");
  return [
    "You are ZION's prediction engine running in BACKTEST mode. Every call you",
    "make here is logged and scored later against real price action, so honesty",
    "and coverage matter — this is how we prove your edge.",
    "",
    "For EACH symbol in the market data below, decide your directional bias NOW",
    "and emit ONE ACTION CARD:",
    "  • bullish → kind \"buy_limit\" (side buy)",
    "  • bearish → kind \"sell_safe\" (side sell)",
    "Each card MUST include: from/to (USDT and the asset), entryPrice (use the",
    "current price), one exits[] rung with a realistic take-profit price,",
    "stopLoss, and probability (your HONEST confidence 0-100). Use the regime,",
    "trajectory and 1Y-cycle context to choose direction and targets.",
    "",
    "OUTPUT FORMAT — REQUIRED. Emit each card as a [[ACTION]] ... [[/ACTION]]",
    "block with valid JSON inside (the standard card schema). Keep prose to an",
    "absolute minimum — your value here is the cards, not commentary. A response",
    "with no [[ACTION]] blocks is a failed run.",
    "",
    "RISK DISCIPLINE — this sets your LEVELS, it is NOT a reason to skip. For",
    "every symbol you have a lean on, CONSTRUCT the target and stop so that",
    "reward:risk >= 1.5 — i.e. |target-entry| >= 1.5 * |entry-stop|. Put the",
    "stop just beyond recent volatility/structure, then place the target far",
    "enough to satisfy the ratio (never within 0.3% of entry). You always have",
    "this freedom, so you should almost always be able to emit a card.",
    "Skip a symbol ONLY if you genuinely have no directional lean at all.",
    "Cover as many symbols as you can — coverage is the point of backtest mode.",
    "Machine-format every number (dot decimal, no separators, no symbols).",
    "",
    "<market>",
    macroText ? `${macroText}\n` : "",
    indicatorsText,
    "</market>",
  ].join("\n");
}

export async function runBacktestScan(marketData: MarketIndicatorsResult): Promise<ActionCard[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const instruction = await buildScanInstruction(marketData);
  if (!instruction) return [];

  try {
    // 504 guard. The backtest scan is heavy and runs inside a 60s Vercel
    // function. A single attempt at 40s fits the budget (indicators ~3s + LLM
    // ≤40s + resolve ~5s); stacking the N1 fallback chain would risk two
    // timeouts = >60s. Best-effort — the next 30-min tick retries. (The real-
    // money autopilot keeps the full fallback chain.) Prompt caching on the
    // foundation via cacheSystem. Goes through the provider seam so the hybrid
    // branch can swap this model without touching the flywheel logic.
    const r = await anthropicChat(
      { model: modelChain()[0], system: ZION_FOUNDATION, user: instruction, maxTokens: 2200, timeoutMs: 40_000, cacheSystem: true },
      apiKey,
    );
    recordEvent("zion_analysis", { meta: { op: "backtest", model: r.model, source: "backtest", promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
    return parseZionStream(r.text).cards;
  } catch {
    return [];
  }
}

/**
 * A/B variant — runs the SAME backtest scan through one configured direct
 * provider (DeepSeek / Kimi / Mistral / Llama) so its expectancy can be
 * measured against Claude on identical market data. Logs source
 * `backtest_<providerId>`. The route runs this for EVERY provider that has a
 * key set, so the flywheel compares all models head-to-head. Dormant per
 * provider until its key exists.
 */
export async function runBacktestScanForProvider(
  marketData: MarketIndicatorsResult,
  provider: ProviderConfig,
): Promise<ActionCard[]> {
  if (!provider.apiKey) return [];
  const instruction = await buildScanInstruction(marketData);
  if (!instruction) return [];
  try {
    const r = await openaiCompatChat(
      { model: provider.model, system: ZION_FOUNDATION, user: instruction, maxTokens: 2200, timeoutMs: 40_000 },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    recordEvent("zion_analysis", { meta: { op: "backtest", model: r.model, source: `backtest_${provider.id}`, promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
    return parseZionStream(r.text).cards;
  } catch {
    return [];
  }
}

/** Run one specialist (OpenAI-compatible). Returns "" if no provider or on
 *  failure. Logs cost under source "hybrid" with the role in `op`. */
async function runSpecialist(role: string, provider: ProviderConfig | null, user: string, maxTokens: number, timeoutMs: number, extraBody?: Record<string, unknown>): Promise<string> {
  if (!provider?.apiKey) return "";
  try {
    const r = await openaiCompatChat(
      { model: provider.model, system: ZION_FOUNDATION, user, maxTokens, timeoutMs, extraBody },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    recordEvent("zion_analysis", { meta: { op: `hybrid_${role}`, model: r.model, source: "hybrid", promptVersion: ZION_FOUNDATION_VERSION, ...r.usage } });
    return r.text;
  } catch { return ""; }
}

/** xAI live-search body — turns Grok from a blind text model into a real-time
 *  X/news reader for the SENTIMENT seat. Only attached when the sentiment
 *  provider is actually Grok; other providers ignore/reject unknown fields, so
 *  we gate it. `mode:"auto"` lets Grok decide when to search; sources scope it
 *  to X + news (the crowd + the tape), which is exactly the sentiment desk's
 *  job. Without this, the Grok seat adds noise the CEO has to filter (P0.2). */
const GROK_SEARCH_BODY: Record<string, unknown> = {
  search_parameters: { mode: "auto", sources: [{ type: "x" }, { type: "news" }] },
};

const MACRO_PROMPT = (macroText: string) => [
  "You are the MACRO analyst on ZION's desk. From the macro context below, give a",
  "TIGHT read (max 5 bullets): overall risk-on/risk-off, BTC/ETH dominance drift,",
  "liquidity (stablecoin supply), and any macro cross-asset signal (DXY, S&P).",
  "No trade calls — just the macro backdrop the desk should trade WITH.",
  "", "<macro>", macroText || "(no macro data this tick)", "</macro>",
].join("\n");

const SENTIMENT_PROMPT = (symbolsCsv: string) => [
  "You are the SENTIMENT analyst on ZION's desk, natively connected to X / social.",
  "Give a TIGHT read (max 5 bullets) of current crypto market sentiment: fear vs",
  "greed, notable narratives/rotations, and any whale/news flow you can see for:",
  `  ${symbolsCsv}.`,
  "No trade calls — just the crowd's mood the desk should factor in.",
].join("\n");

/** CEO synthesis prompt — Opus fuses the three specialist reads + the technical
 *  draft into the FINAL cards. */
function buildCeoPrompt(indicatorsText: string, macro: string, sentiment: string, technical: string): string {
  return [
    "You are ZION's CEO — the final decision-maker. Your desk's specialists each",
    "produced a report below. SYNTHESIZE them into the FINAL set of ACTION CARDS:",
    "  • Weigh the TECHNICAL draft against the MACRO backdrop and the SENTIMENT.",
    "  • Confirm strong setups; refine entry/target/stop (reward:risk >= 1.5, target",
    "    never within 0.3% of entry, use the real current price); DROP the weak ones",
    "    or ones fighting the macro/sentiment. Quality over coverage.",
    "Output ONLY the final cards as [[ACTION]] ... [[/ACTION]] JSON blocks. Machine-format numbers.",
    "",
    "<technical_draft>", technical || "(none)", "</technical_draft>",
    "",
    "<macro_report>", macro || "(none)", "</macro_report>",
    "",
    "<sentiment_report>", sentiment || "(none)", "</sentiment_report>",
    "",
    "<market>", indicatorsText, "</market>",
  ].join("\n");
}

/**
 * AGENT B — the TRUE Ferrari: each model in its strongest area, fused by a CEO.
 *   • Kimi     → MACRO digest (big context)
 *   • Grok     → SENTIMENT (native to X)
 *   • DeepSeek → TECHNICAL/quant brain (the draft)   [roleProvider("brain")]
 *   • Opus     → CEO that SYNTHESIZES all into the final cards
 * The three specialists run in PARALLEL; Opus then fuses them. Every stage logs
 * cost under source "hybrid"; the caller logs the final suggestions as
 * "hybrid_scan". Needs the brain key + ANTHROPIC_API_KEY with live credits
 * (Opus/CEO) — dormant until both exist (wakes itself after the 11/07 top-up).
 * Missing specialist keys degrade gracefully (that report is just "(none)").
 */
export async function runHybridScan(marketData: MarketIndicatorsResult): Promise<ActionCard[]> {
  // Master switch — OFF by default so Agent B doesn't spend on the specialists
  // while the CEO (Opus) has no credits. Flip HYBRID_B_ENABLED=true after the
  // 11/07 Anthropic top-up to wake the full Ferrari.
  if (process.env.HYBRID_B_ENABLED !== "true") return [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const brain = roleProvider("brain");
  if (!anthropicKey || !brain?.apiKey) return [];
  const indicatorsText = formatIndicatorsForPrompt(marketData).trim();
  if (!indicatorsText) return [];
  const macroText = await getMacroContext().catch(() => "");
  const scanInstruction = await buildScanInstruction(marketData);
  if (!scanInstruction) return [];
  const symbolsCsv = marketData.indicators.map((i) => i.symbol).join(", ");
  const sentimentProvider = roleProvider("sentiment");

  // Three specialists in PARALLEL — each in its strongest area. When the
  // sentiment seat is Grok, attach xAI live-search so it reads the real X/news
  // tape instead of hallucinating a mood (P0.2).
  const [technical, macro, sentiment] = await Promise.all([
    runSpecialist("brain",     brain,             scanInstruction,             2200, 18_000),
    runSpecialist("macro",     roleProvider("macro"), MACRO_PROMPT(macroText), 600,  15_000),
    runSpecialist("sentiment", sentimentProvider, SENTIMENT_PROMPT(symbolsCsv), 600, 15_000,
      sentimentProvider?.id === "grok" ? GROK_SEARCH_BODY : undefined),
  ]);
  if (!technical.trim()) return []; // no draft to synthesize

  // CEO fuses everything into the final cards. Opus is the primary synthesizer,
  // but it's a SINGLE point of failure — an Opus timeout/error would waste all
  // three specialist calls and return nothing. So on failure we fall back to
  // Sonnet (same key, always has credits when Anthropic is up) for the exact
  // same synthesis (P0.3). Only if BOTH fail do we give up.
  const ceoPrompt = buildCeoPrompt(indicatorsText, macro, sentiment, technical);
  const primaryModel  = process.env.HYBRID_ORCH_MODEL ?? "claude-opus-4-8";
  const fallbackModel = process.env.HYBRID_ORCH_FALLBACK_MODEL ?? modelChain()[0];
  for (const [model, role] of [[primaryModel, "hybrid_ceo"], [fallbackModel, "hybrid_ceo_fallback"]] as const) {
    try {
      const o = await anthropicChat(
        { model, system: ZION_FOUNDATION, user: ceoPrompt, maxTokens: 2200, timeoutMs: 25_000, cacheSystem: true },
        anthropicKey,
      );
      recordEvent("zion_analysis", { meta: { op: role, model: o.model, source: "hybrid", promptVersion: ZION_FOUNDATION_VERSION, ...o.usage } });
      return parseZionStream(o.text).cards;
    } catch {
      if (model === fallbackModel) return []; // both CEO attempts failed
    }
  }
  return [];
}

const STABLES = new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDP", "USD", "USDE", "PYUSD"]);
const TRADEABLE_KINDS = new Set(["swap", "buy_limit", "sell_safe", "sell_medium", "sell_aggressive"]);

type NewSuggestion = Partial<ZionSuggestionRow> & { symbol: string; kind: string; side: "buy" | "sell"; ref_price: number };

/** Turn a card into a ledger row, or null when it isn't a trackable directional trade. */
export function extractSuggestion(
  card: ActionCard,
  refPriceBySymbol: Map<string, number>,
  regimeBySymbol: Map<string, string>,
): NewSuggestion | null {
  if (!TRADEABLE_KINDS.has(card.kind)) return null;

  let side: "buy" | "sell";
  let base: string;
  if (card.kind === "buy_limit") {
    side = "buy";
    base = normalizeSymbol(card.to?.symbol ?? "");
  } else if (card.kind.startsWith("sell")) {
    side = "sell";
    base = normalizeSymbol(card.from?.symbol ?? "");
  } else {
    // swap: stable→asset is a buy, asset→stable is a sell.
    const fromSym = normalizeSymbol(card.from?.symbol ?? "");
    const toSym   = normalizeSymbol(card.to?.symbol ?? "");
    if (STABLES.has(fromSym) && !STABLES.has(toSym))      { side = "buy";  base = toSym; }
    else if (!STABLES.has(fromSym) && STABLES.has(toSym)) { side = "sell"; base = fromSym; }
    else return null;
  }
  if (!base || STABLES.has(base)) return null;

  // ref_price MUST be a real market price from the indicators — never fall
  // back to the card's entryPrice, which can be an LLM hallucination (e.g.
  // ADA logged at $700 instead of $0.70) that would corrupt the win-rate.
  // If we couldn't price the symbol this run, skip it rather than log garbage.
  const refPrice = refPriceBySymbol.get(base);
  if (!refPrice || !(refPrice > 0)) return null;

  const entry = parsePrice(card.entryPrice ?? card.triggerPrice ?? "") || null;
  const target = card.exits && card.exits[0] ? (parsePrice(card.exits[0].price) || null) : null;
  const stop  = parsePrice(card.stopLoss ?? "") || null;
  const prob  = parsePrice(card.probability ?? "") || null;

  // Scale sanity: the prompt says entryPrice = the CURRENT price, so it must be
  // within a sane band of the real ref_price. The model sometimes emits the
  // whole card at the wrong scale (LINK at 7323 vs real 7.32, DOT at 816 vs
  // 0.816 — a 1000x slip). Geometry stays internally consistent so the R:R
  // check passes, but the target/stop then resolve against a garbage level and
  // blow up outcome_pct (−97000%!). Reject when entry is >25% off the real
  // price — it's a mis-scaled hallucination, not a tradeable setup.
  if (entry && entry > 0 && Math.abs(entry / refPrice - 1) > 0.25) return null;

  // Geometry gate: when the card carries a full target+stop, reject anything
  // structurally broken before it pollutes the ledger / win-rate —
  //   · target on the WRONG side of entry (reward <= 0),
  //   · stop on the wrong side (risk <= 0),
  //   · target essentially AT entry (the AVAX 6.288→6.2873 "0.01%" bug),
  //   · reward:risk below 1 (stop wider than target = negative-EV by design).
  // A directional call without explicit target/stop still passes (it resolves
  // at horizon), so coverage isn't hurt — only losing-by-construction cards die.
  if (entry && entry > 0 && target && stop) {
    const dir = side === "buy" ? 1 : -1;
    const reward = (target - entry) * dir;
    const risk   = (entry - stop) * dir;
    const targetPct = (Math.abs(target - entry) / entry) * 100;
    if (!(reward > 0) || !(risk > 0) || targetPct < 0.15 || reward / risk < 1) return null;
  }

  return {
    symbol: base, kind: card.kind, side, ref_price: refPrice,
    entry_price: entry, target_price: target, stop_price: stop,
    probability: prob, regime: regimeBySymbol.get(base) ?? null,
  };
}

/** Log all tradeable cards from one analysis. Uses the indicators for the
 *  reference price + regime context. Returns how many were logged. */
export async function logSuggestions(cards: ActionCard[], indicators: SymbolIndicators[], source: string): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db || cards.length === 0) return 0;
  const refBy = new Map<string, number>();
  const regimeBy = new Map<string, string>();
  for (const ind of indicators) {
    const sym = ind.symbol.toUpperCase();
    if (ind.price != null && ind.price > 0) refBy.set(sym, ind.price);
    if (ind.regime) regimeBy.set(sym, ind.regime);
  }
  const rows = cards
    .map((c) => extractSuggestion(c, refBy, regimeBy))
    .filter((r): r is NewSuggestion => r !== null)
    .map((r) => ({ ...r, source }));
  if (rows.length === 0) return 0;
  try { await db.from("zion_suggestions").insert(rows); return rows.length; }
  catch { return 0; }
}

export interface ResolveResult { checked: number; resolved: number; }

const BINANCE_DATA = "https://data-api.binance.vision";
interface Kline { t: number; high: number; low: number; close: number; }

// 5-minute candles (not 1h) for higher intra-bar fidelity in resolution — a
// target hit at :05 and a stop at :45 of the same hour are now distinguished
// (was a false stop on the 1h bar). At 5m, limit=1000 covers ~83h from
// startMs, which spans the 72h suggestion horizon. Zero extra token cost.
const RESOLVE_INTERVAL = process.env.BACKTEST_RESOLVE_INTERVAL ?? "5m";

/** Candles for [startMs, endMs] from Binance's non-geoblocked mirror.
 *  Empty array on any failure — the caller falls back to a spot check. */
async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Kline[]> {
  try {
    const url = `${BINANCE_DATA}/api/v3/klines?symbol=${symbol}USDT&interval=${RESOLVE_INTERVAL}`
      + `&startTime=${Math.floor(startMs)}&endTime=${Math.ceil(endMs)}&limit=1000`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const rows = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>;
    return rows.map((r) => ({ t: r[0], high: parseFloat(r[2]), low: parseFloat(r[3]), close: parseFloat(r[4]) }));
  } catch { return []; }
}

interface Verdict { status: string; outcomePct: number; price: number; }

/**
 * Decide one suggestion's fate. PATH-AWARE: replays the hourly candles from
 * the suggestion's creation to min(now, horizon) and returns the FIRST level
 * touched in time — not just where price sits now. When a single candle
 * straddles BOTH target and stop we assume the STOP hit first (the honest,
 * pessimistic convention — never over-credit a win we can't prove). Falls back
 * to a single current-spot check when candles aren't available.
 */
function resolveOne(r: ZionSuggestionRow, klines: Kline[], spot: number | undefined, nowMs: number): Verdict | null {
  const dir = r.side === "buy" ? 1 : -1;
  const createdMs = Date.parse(r.created_at);
  const horizonMs = createdMs + r.horizon_hours * 3_600_000;
  const tp = r.target_price, sp = r.stop_price;
  const pct = (p: number) => ((p - r.ref_price) / r.ref_price) * 100 * dir;

  // Only candles that OPENED at/after creation (ignore the partial creation
  // candle so pre-entry price action can't trigger a phantom touch).
  const window = klines.filter((k) => k.t >= createdMs && k.t <= Math.min(nowMs, horizonMs));
  if (window.length > 0) {
    for (const k of window) {
      const hitStop   = sp != null && (dir > 0 ? k.low  <= sp : k.high >= sp);
      const hitTarget = tp != null && (dir > 0 ? k.high >= tp : k.low  <= tp);
      if (hitStop   && sp != null) return { status: "hit_stop",   outcomePct: pct(sp), price: sp };
      if (hitTarget && tp != null) return { status: "hit_target", outcomePct: pct(tp), price: tp };
    }
    // Horizon elapsed, NO level touched → "expired" (a real outcome_pct at the
    // close, but NOT a target/stop hit). Kept separate from wins/losses so the
    // win-rate isn't inflated by trades that merely drifted (Kimi's point).
    if (nowMs >= horizonMs) {
      const close = window[window.length - 1].close;
      return { status: "expired", outcomePct: pct(close), price: close };
    }
    return null; // in-flight: no level touched yet, horizon not elapsed
  }

  // Fallback — no candles: single current-spot check (legacy behaviour).
  if (spot == null || spot <= 0) return null;
  if (tp != null && (dir > 0 ? spot >= tp : spot <= tp)) return { status: "hit_target", outcomePct: pct(tp), price: tp };
  if (sp != null && (dir > 0 ? spot <= sp : spot >= sp)) return { status: "hit_stop",   outcomePct: pct(sp), price: sp };
  if (nowMs >= horizonMs) return { status: "expired", outcomePct: pct(spot), price: spot };
  return null;
}

/**
 * Resolve open suggestions by REPLAYING the price path (hourly candles) since
 * each was logged — first target/stop touch wins; horizon elapsed → directional
 * win/loss/neutral. One klines fetch per symbol (parallel), reused across that
 * symbol's rows; spot prices are a fallback. outcome_pct is the directional
 * return vs ref_price (positive = ZION right).
 */
export async function resolveOpenSuggestions(limit = 200): Promise<ResolveResult> {
  const db = getSupabaseAdmin();
  if (!db) return { checked: 0, resolved: 0 };
  const { data: open } = await db
    .from("zion_suggestions")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (!open || open.length === 0) return { checked: 0, resolved: 0 };

  const nowMs = Date.now();
  const symbols = [...new Set(open.map((r) => r.symbol))];

  // One candle fetch per symbol, in parallel, covering that symbol's oldest
  // open suggestion → now. Spot map is the per-symbol fallback.
  const klinesBySymbol = new Map<string, Kline[]>();
  await Promise.all(symbols.map(async (sym) => {
    const earliest = Math.min(...open.filter((r) => r.symbol === sym).map((r) => Date.parse(r.created_at)));
    klinesBySymbol.set(sym, await fetchKlines(sym, earliest, nowMs));
  }));
  const spot = await getCexSpotPrices(symbols).catch(() => new Map());

  let resolved = 0;
  for (const r of open) {
    const verdict = resolveOne(r, klinesBySymbol.get(r.symbol) ?? [], spot.get(r.symbol)?.priceUsd, nowMs);
    if (!verdict) continue;
    try {
      await db.from("zion_suggestions").update({
        status:         verdict.status,
        outcome_pct:    Math.round(verdict.outcomePct * 100) / 100,
        resolved_price: verdict.price,
        resolved_at:    new Date().toISOString(),
      }).eq("id", r.id);
      resolved++;
    } catch { /* skip */ }
  }
  return { checked: open.length, resolved };
}

// Round-trip execution cost subtracted from gross expectancy so the reported
// edge is NET of fees + slippage (Gemini/DeepSeek). Default ≈ 0.1% taker × 2
// legs = 0.2%. Override with BACKTEST_COST_PCT.
const ROUND_TRIP_COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);
const MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100); // ≥100 to trust a comparison

export interface BacktestStats {
  total:       number;
  open:        number;
  resolved:    number;   // decided (target/stop) + expired
  wins:        number;   // hit_target (+ legacy "win")
  losses:      number;   // hit_stop (+ legacy "loss")
  expired:     number;   // horizon elapsed, no level touched
  winRate:     number | null;   // wins / (wins + losses) — decided only
  avgOutcome:  number | null;   // GROSS mean outcome_pct over all resolved
  expectancyNet: number | null; // NET of round-trip cost — THE headline
  signalRate:  number | null;   // decided / (decided + expired)
  sufficientSample: boolean;    // decided >= MIN_SAMPLE (else it's noise)
}

/** Aggregate win-rate + NET expectancy across resolved suggestions. */
export async function getBacktestStats(): Promise<BacktestStats> {
  const empty: BacktestStats = { total: 0, open: 0, resolved: 0, wins: 0, losses: 0, expired: 0, winRate: null, avgOutcome: null, expectancyNet: null, signalRate: null, sufficientSample: false };
  const db = getSupabaseAdmin();
  if (!db) return empty;
  const { data } = await db.from("zion_suggestions").select("status, outcome_pct");
  if (!data) return empty;

  let open = 0, wins = 0, losses = 0, expired = 0, sum = 0, resolvedCount = 0;
  for (const r of data) {
    if (r.status === "open") { open++; continue; }
    resolvedCount++;
    if (typeof r.outcome_pct === "number") sum += r.outcome_pct;
    if      (r.status === "hit_target" || r.status === "win")  wins++;
    else if (r.status === "hit_stop"   || r.status === "loss") losses++;
    else expired++; // "expired" / legacy "neutral"
  }
  const decided = wins + losses;
  const gross = resolvedCount > 0 ? sum / resolvedCount : null;
  return {
    total: data.length, open, resolved: resolvedCount, wins, losses, expired,
    winRate:    decided > 0 ? wins / decided : null,
    avgOutcome: gross,
    expectancyNet: gross === null ? null : gross - ROUND_TRIP_COST_PCT,
    signalRate: resolvedCount > 0 ? decided / resolvedCount : null,
    sufficientSample: decided >= MIN_SAMPLE,
  };
}
