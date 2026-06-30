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

import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCexSpotPrices } from "@/lib/api/cex-spot";
import { parsePrice, normalizeSymbol } from "@/lib/zion/card-mapping";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import { recordEvent } from "@/lib/admin/track";
import { modelChain } from "@/lib/zion/model";
import { ZION_FOUNDATION } from "@/lib/zion/foundation";
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
    // 504 guard. The backtest scan is heavy (14 symbols, 3500 tokens) and runs
    // inside a 60s Vercel function. A single attempt at 40s fits the budget
    // (indicators ~3s + LLM ≤40s + resolve ~5s); stacking the N1 fallback chain
    // would risk two timeouts = >60s = FUNCTION_INVOCATION_TIMEOUT. The backtest
    // is best-effort, so we use ONE model and let the next 30-min tick retry,
    // rather than failing the whole function. (The real-money autopilot path
    // keeps the full fallback chain.) maxRetries:0 avoids SDK backoff eating the
    // budget; 25s was too tight and aborted the scan mid-generation → 0 cards.
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 40_000 });
    const params = {
      // 6-symbol window → ~6 cards; 2200 tokens is plenty and caps worst-case
      // generation time so the call finishes inside the 40s timeout.
      max_tokens: 2200,
      system: [{ type: "text" as const, text: ZION_FOUNDATION, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: instruction }],
    };
    const usedModel = modelChain()[0];
    const msg = await client.messages.create({ model: usedModel, ...params });
    const u = msg.usage;
    recordEvent("zion_analysis", { meta: {
      op: "backtest", model: usedModel, source: "backtest",
      inTokens: u.input_tokens, outTokens: u.output_tokens,
      cachedTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    } });
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parseZionStream(text).cards;
  } catch {
    return [];
  }
}

/**
 * A/B variant — runs the SAME backtest scan through Kimi (Moonshot's
 * OpenAI-compatible endpoint) so its expectancy can be measured against Claude
 * on identical market data. Dormant until KIMI_API_KEY is set. No SDK needed —
 * it's a plain chat/completions POST. Model + base URL are env-overridable
 * because Moonshot ships new Kimi versions often (set KIMI_MODEL from your
 * Moonshot console, e.g. the current Kimi K2 id).
 */
export async function runBacktestScanKimi(marketData: MarketIndicatorsResult): Promise<ActionCard[]> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) return [];
  const baseUrl = (process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/+$/, "");
  const model   = process.env.KIMI_MODEL ?? "kimi-k2-0711-preview";
  const instruction = await buildScanInstruction(marketData);
  if (!instruction) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens:  2200,
        temperature: 0.6,
        messages: [
          { role: "system", content: ZION_FOUNDATION },
          { role: "user",   content: instruction },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?:   { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    recordEvent("zion_analysis", { meta: {
      op: "backtest", model, source: "backtest_kimi",
      inTokens:  data.usage?.prompt_tokens ?? 0,
      outTokens: data.usage?.completion_tokens ?? 0,
      cachedTokens: 0, cacheWriteTokens: 0,
    } });
    return parseZionStream(text).cards;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
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

/** Hourly candles for [startMs, endMs] from Binance's non-geoblocked mirror.
 *  Empty array on any failure — the caller falls back to a spot check. */
async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Kline[]> {
  try {
    const url = `${BINANCE_DATA}/api/v3/klines?symbol=${symbol}USDT&interval=1h`
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
    if (nowMs >= horizonMs) {
      const close = window[window.length - 1].close;
      const op = pct(close);
      return { status: op > 0.5 ? "win" : op < -0.5 ? "loss" : "neutral", outcomePct: op, price: close };
    }
    return null; // in-flight: no level touched yet, horizon not elapsed
  }

  // Fallback — no candles: single current-spot check (legacy behaviour).
  if (spot == null || spot <= 0) return null;
  if (tp != null && (dir > 0 ? spot >= tp : spot <= tp)) return { status: "hit_target", outcomePct: pct(tp), price: tp };
  if (sp != null && (dir > 0 ? spot <= sp : spot >= sp)) return { status: "hit_stop",   outcomePct: pct(sp), price: sp };
  if (nowMs >= horizonMs) {
    const op = pct(spot);
    return { status: op > 0.5 ? "win" : op < -0.5 ? "loss" : "neutral", outcomePct: op, price: spot };
  }
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

export interface BacktestStats {
  total:       number;
  open:        number;
  resolved:    number;
  wins:        number;   // hit_target or win
  losses:      number;   // hit_stop or loss
  neutral:     number;
  winRate:     number | null;   // wins / (wins + losses)
  avgOutcome:  number | null;   // mean directional outcome_pct of resolved
}

/** Aggregate win-rate + expectancy across resolved suggestions. */
export async function getBacktestStats(): Promise<BacktestStats> {
  const empty: BacktestStats = { total: 0, open: 0, resolved: 0, wins: 0, losses: 0, neutral: 0, winRate: null, avgOutcome: null };
  const db = getSupabaseAdmin();
  if (!db) return empty;
  const { data } = await db.from("zion_suggestions").select("status, outcome_pct");
  if (!data) return empty;

  let open = 0, wins = 0, losses = 0, neutral = 0, sum = 0, resolvedCount = 0;
  for (const r of data) {
    if (r.status === "open") { open++; continue; }
    resolvedCount++;
    if (typeof r.outcome_pct === "number") sum += r.outcome_pct;
    if (r.status === "win" || r.status === "hit_target") wins++;
    else if (r.status === "loss" || r.status === "hit_stop") losses++;
    else neutral++;
  }
  const decided = wins + losses;
  return {
    total: data.length, open, resolved: resolvedCount, wins, losses, neutral,
    winRate: decided > 0 ? wins / decided : null,
    avgOutcome: resolvedCount > 0 ? sum / resolvedCount : null,
  };
}
