/**
 * Market Brain (Z3) — persistent per-symbol memory.
 *
 * ZION was stateless: each analysis re-derived everything from a snapshot, so
 * it never knew how LONG the current regime had held or whether volatility was
 * unusual for THIS symbol. This module reads a stored brain per symbol, detects
 * regime changes (stamping when the current one began), maintains an EWMA
 * volatility baseline, upserts the new state, and returns a compact context
 * block to append to the prompt.
 *
 * Server-only and strictly best-effort: any DB hiccup just returns the base
 * text unchanged — the brain is an enhancement, never a hard dependency.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import type { MarketBrainRow } from "@/lib/supabase/types";

const DAY_MS = 86_400_000;

/** Append a "MARKET MEMORY" block to `baseText`, updating the brain as a side
 *  effect. Never throws. */
export async function appendMarketBrain(baseText: string, indicators: SymbolIndicators[]): Promise<string> {
  try {
    const block = await updateAndDescribe(indicators);
    return block ? `${baseText}\n\nMARKET MEMORY (how long the regime has held + volatility vs this symbol's own baseline):\n${block}` : baseText;
  } catch {
    return baseText;
  }
}

async function updateAndDescribe(indicators: SymbolIndicators[]): Promise<string> {
  const db = getSupabaseAdmin();
  if (!db) return "";
  const usable = indicators.filter((i) => i.regime && i.price !== null);
  if (usable.length === 0) return "";

  const symbols = usable.map((i) => i.symbol.toUpperCase());
  const { data: prevRows } = await db.from("market_brain").select("*").in("symbol", symbols);
  const prevBySym = new Map<string, MarketBrainRow>((prevRows ?? []).map((r) => [r.symbol, r]));

  const nowIso = new Date().toISOString();
  const nowMs  = Date.parse(nowIso);
  const upserts: Array<Partial<MarketBrainRow> & { symbol: string }> = [];
  const lines: string[] = [];

  for (const ind of usable) {
    const sym  = ind.symbol.toUpperCase();
    const prev = prevBySym.get(sym);
    const regime = ind.regime;
    const atrPct = ind.atrPct ?? null;

    // Regime persistence: stamp regime_since only when it actually changes.
    let regimeSince = prev?.regime_since ?? nowIso;
    let prevRegime  = prev?.prev_regime ?? null;
    if (!prev || prev.regime !== regime) {
      regimeSince = nowIso;
      prevRegime  = prev?.regime ?? null;
    }

    // EWMA volatility baseline.
    const volAvg = atrPct === null
      ? (prev?.vol_avg ?? null)
      : prev?.vol_avg != null
        ? prev.vol_avg * 0.9 + atrPct * 0.1
        : atrPct;

    upserts.push({
      symbol: sym, regime, regime_since: regimeSince, prev_regime: prevRegime,
      atr_pct: atrPct, vol_avg: volAvg, range_pct: ind.rangePct ?? null, updated_at: nowIso,
    });

    // Describe.
    const days = Math.max(0, Math.round((nowMs - Date.parse(regimeSince)) / DAY_MS));
    const heldFor = days >= 1 ? `${days}d` : "today";
    const prevNote = prevRegime ? ` (prev ${prevRegime})` : "";
    let volNote = "";
    if (atrPct !== null && volAvg != null && volAvg > 0) {
      const ratio = atrPct / volAvg;
      const tag = ratio >= 1.4 ? "ELEVATED" : ratio <= 0.7 ? "low" : "normal";
      volNote = ` | vol ${atrPct.toFixed(2)}% vs avg ${volAvg.toFixed(2)}% (${tag})`;
    }
    lines.push(`  ${sym}: regime ${regime} for ${heldFor}${prevNote}${volNote}`);
  }

  // Best-effort write — don't let a failed upsert blank the context we built.
  try { await db.from("market_brain").upsert(upserts, { onConflict: "symbol" }); } catch { /* ignore */ }

  return lines.join("\n");
}
