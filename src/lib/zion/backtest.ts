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

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCexSpotPrices } from "@/lib/api/cex-spot";
import { parsePrice, normalizeSymbol } from "@/lib/zion/card-mapping";
import type { ActionCard } from "@/lib/zion/parse";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import type { ZionSuggestionRow } from "@/lib/supabase/types";

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

  const refPrice = refPriceBySymbol.get(base) ?? parsePrice(card.entryPrice ?? card.triggerPrice ?? "");
  if (!(refPrice > 0)) return null;

  const entry = parsePrice(card.entryPrice ?? card.triggerPrice ?? "") || null;
  const target = card.exits && card.exits[0] ? (parsePrice(card.exits[0].price) || null) : null;
  const stop  = parsePrice(card.stopLoss ?? "") || null;
  const prob  = parsePrice(card.probability ?? "") || null;

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

/**
 * Resolve open suggestions against the current price:
 *   - target hit (in the trade's direction) → hit_target
 *   - stop hit                              → hit_stop
 *   - past the horizon                      → directional win/loss/neutral
 * outcome_pct is the directional return vs ref_price (positive = ZION right).
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

  const symbols = [...new Set(open.map((r) => r.symbol))];
  const priceMap = await getCexSpotPrices(symbols);
  const nowMs = Date.now();
  let resolved = 0;

  for (const r of open) {
    const price = priceMap.get(r.symbol)?.priceUsd;
    if (!price || price <= 0) continue;
    const dir = r.side === "buy" ? 1 : -1;
    const ageH = (nowMs - Date.parse(r.created_at)) / 3_600_000;
    const outcomePct = ((price - r.ref_price) / r.ref_price) * 100 * dir;

    let status: string | null = null;
    if (r.target_price && ((dir > 0 && price >= r.target_price) || (dir < 0 && price <= r.target_price))) {
      status = "hit_target";
    } else if (r.stop_price && ((dir > 0 && price <= r.stop_price) || (dir < 0 && price >= r.stop_price))) {
      status = "hit_stop";
    } else if (ageH >= r.horizon_hours) {
      status = outcomePct > 0.5 ? "win" : outcomePct < -0.5 ? "loss" : "neutral";
    }
    if (!status) continue;

    try {
      await db.from("zion_suggestions").update({
        status,
        outcome_pct: Math.round(outcomePct * 100) / 100,
        resolved_price: price,
        resolved_at: new Date().toISOString(),
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
