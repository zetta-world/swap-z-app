/**
 * ARBITER 2.0 — cross-CEX spread capture via SPOT + PERP SHORT, zero-LLM
 * (docs/PLANO-ARBITER-REAL.md).
 *
 * The 1.0 desk assumes inventory on both venues (coin to sell on the rich
 * one). Real clients arrive with USDT only — so 2.0 solves the cold-start:
 * buy spot on the cheap venue, SHORT the perp on the rich venue (1x, USDT
 * margin), which locks the spread with no coin held anywhere. The hedged
 * pair stays open until the venues converge (or a timeout), then both legs
 * close: profit = locked spread − full 4-leg cost + funding received while
 * short. Simulated against the REAL capital constraint the CEO set: the
 * wallet starts at $300 and each cycle locks 2×size (spot leg + 1x margin),
 * so at most 3 positions ride at once — exactly like the first real deposit.
 *
 * Declared approximation (paper only): the rich venue's PERP price ≈ its
 * SPOT price. Typical basis is <0.05% and ARB2_COST_PCT carries a buffer
 * for it; F2 (orderbook validation) measures the real thing before money.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { findArbs } from "@/lib/zion/arbiter";
import { recordEvent } from "@/lib/admin/track";

// Full-cycle cost: spot taker in/out (~0.2%) + perp taker in/out (~0.11%) +
// spot↔perp basis buffer (~0.14%). Deliberately fatter than 1.0's 0.4%.
const COST_PCT       = Number(process.env.ARB2_COST_PCT        ?? 0.45);
const MIN_NET_PCT    = Number(process.env.ARB2_MIN_NET_PCT     ?? 0.15);
const EXIT_SPREAD    = Number(process.env.ARB2_EXIT_SPREAD_PCT ?? 0.05); // converged when spread ≤ this
const MAX_HOLD_H     = Number(process.env.ARB2_MAX_HOLD_H      ?? 48);
const SIZE_USD       = Number(process.env.ARB2_SIZE_USD        ?? 50);   // per leg; cycle locks 2×
const STARTING_USD   = Number(process.env.ARB2_STARTING_USD    ?? 300);  // the CEO's real-seed scenario
const DAILY_CAP      = Number(process.env.ARB2_DAILY_CAP       ?? 20);
const COOLDOWN_MIN   = Number(process.env.ARB2_COOLDOWN_MIN    ?? 30);
const EXCLUDE_VENUES = (process.env.ARB_EXCLUDE_VENUES ?? "coinbase").split(",").map((s) => s.trim()).filter(Boolean);

// ── Pure math (unit-tested) ─────────────────────────────────────────────────

/** P&L of one hedged cycle: the spread narrowed from entry to exit (in %),
 *  minus the full 4-leg cost, plus funding collected while short. A timeout
 *  exit with a barely-narrowed spread can lose — the flywheel logs it. */
export function cycleProfit(entrySpreadPct: number, exitSpreadPct: number, sizeUsd: number, costPct = COST_PCT, fundingUsd = 0): number {
  return sizeUsd * ((entrySpreadPct - exitSpreadPct) / 100) - sizeUsd * (costPct / 100) + fundingUsd;
}

/** Funding collected by the short leg: rate per 8h period × periods held ×
 *  notional. Positive funding pays shorts; negative charges them. */
export function fundingAccrued(rate8h: number, heldHours: number, sizeUsd: number): number {
  if (!Number.isFinite(rate8h)) return 0;
  return rate8h * (heldHours / 8) * sizeUsd;
}

// ── Bybit funding (public, best-effort) ─────────────────────────────────────

async function fetchFundingRates(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", { next: { revalidate: 300 } });
    if (!res.ok) return out;
    const body = await res.json() as { result?: { list?: Array<{ symbol?: string; fundingRate?: string }> } };
    const want = new Set(symbols.map((s) => s.toUpperCase()));
    for (const r of body.result?.list ?? []) {
      const base = (r.symbol ?? "").replace(/USDT$/, "");
      if (!want.has(base)) continue;
      const f = parseFloat(r.fundingRate ?? "");
      if (Number.isFinite(f)) out.set(base, f);
    }
  } catch { /* no funding data → accrue 0 */ }
  return out;
}

// ── One tick ────────────────────────────────────────────────────────────────

export interface Arbiter2Result { closed: number; opened: number; skipped: string | null }

const ROUTE_RE = /^arb2 (\w+)→(\w+)/;

export async function runArbiter2Scan(): Promise<Arbiter2Result> {
  const db = getSupabaseAdmin();
  if (!db) return { closed: 0, opened: 0, skipped: "db" };

  const spot = await getMultiExchangeSpot([...CEX_TRACKED_SYMBOLS], { skipVenues: EXCLUDE_VENUES as CexSpotSource[] });
  const matrix = spot as unknown as Map<string, Map<string, { priceUsd: number }>>;
  for (const venues of matrix.values()) for (const v of EXCLUDE_VENUES) venues.delete(v);

  // Wallet (idempotent seed at the CEO's $300 real-deposit scenario).
  await db.from("paper_accounts").upsert(
    { source: "arbiter2", label: "Arbiter 2.0 ⚡ (futuros)", exchange: "multi-cex", starting_usd: STARTING_USD, cash_usd: STARTING_USD },
    { onConflict: "source", ignoreDuplicates: true },
  );
  const { data: acc } = await db.from("paper_accounts")
    .select("id, cash_usd, realized_pnl_usd, wins, losses").eq("source", "arbiter2").maybeSingle();
  if (!acc) return { closed: 0, opened: 0, skipped: "no_account" };

  // ① Resolve open hedges FIRST — freed capital can re-enter this same tick.
  const { data: openPos } = await db.from("paper_positions")
    .select("id, symbol, entry_price, target_price, cost_usd, exit_reason, opened_at")
    .eq("account_id", acc.id).eq("status", "open");
  const nowMs = Date.now();
  let closed = 0, cashDelta = 0, pnlDelta = 0, wins = 0, losses = 0;
  const funding = await fetchFundingRates([...new Set((openPos ?? []).map((p) => p.symbol))]);

  for (const p of openPos ?? []) {
    const m = ROUTE_RE.exec(p.exit_reason ?? "");
    if (!m) continue;
    const [, buyV, sellV] = m;
    const venues = matrix.get(p.symbol);
    const buyNow = venues?.get(buyV)?.priceUsd, sellNow = venues?.get(sellV)?.priceUsd;
    // No live price on either leg → do nothing this tick (fail-closed).
    if (!buyNow || !sellNow || !(buyNow > 0)) continue;

    const exitSpread = ((sellNow - buyNow) / buyNow) * 100;
    const heldH = (nowMs - Date.parse(p.opened_at)) / 3_600_000;
    const converged = exitSpread <= EXIT_SPREAD;
    if (!converged && heldH < MAX_HOLD_H) continue;

    const size = Number(p.cost_usd) / 2;
    const entrySpread = ((Number(p.target_price) - Number(p.entry_price)) / Number(p.entry_price)) * 100;
    const fund = fundingAccrued(funding.get(p.symbol) ?? 0, heldH, size);
    const pnl = cycleProfit(entrySpread, exitSpread, size, COST_PCT, fund);
    const { error } = await db.from("paper_positions").update({
      status: "closed", exit_price: buyNow,
      exit_reason: `${p.exit_reason} ${converged ? "conv" : "timeout"}`,
      pnl_usd: pnl, pnl_pct: (pnl / Number(p.cost_usd)) * 100,
      closed_at: new Date(nowMs).toISOString(),
    }).eq("id", p.id);
    if (error) continue;
    closed++; cashDelta += Number(p.cost_usd) + pnl; pnlDelta += pnl;
    if (pnl >= 0) wins++; else losses++;
    recordEvent("arb2_close", { meta: {
      symbol: p.symbol, route: `${buyV}→${sellV}`, held_h: Math.round(heldH * 10) / 10,
      entry_spread: Math.round(entrySpread * 100) / 100, exit_spread: Math.round(exitSpread * 100) / 100,
      funding_usd: Math.round(fund * 100) / 100, pnl_usd: Math.round(pnl * 100) / 100,
    } });
  }

  // ② New entries under the REAL capital constraint: cash after this tick's
  // closes, 2×size locked per cycle, daily cap, per-symbol cooldown.
  const all = findArbs(matrix, COST_PCT, MIN_NET_PCT);
  const arbs = all.filter((x) => !x.suspect);
  const openSymbols = new Set((openPos ?? []).map((p) => p.symbol));

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: today } = await db.from("paper_positions")
    .select("symbol, opened_at").eq("account_id", acc.id).gte("opened_at", dayStart.toISOString());
  const cooldownCut = nowMs - COOLDOWN_MIN * 60_000;
  const cooling = new Set((today ?? []).filter((r) => Date.parse(r.opened_at) > cooldownCut).map((r) => r.symbol));

  let opened = 0;
  let cashAvail = Number(acc.cash_usd) + cashDelta;
  let room = Math.max(0, DAILY_CAP - (today ?? []).length);
  for (const a of arbs) {
    if (room <= 0 || cashAvail < 2 * SIZE_USD) break;
    if (cooling.has(a.symbol) || openSymbols.has(a.symbol)) continue;
    const { error } = await db.from("paper_positions").insert({
      account_id: acc.id, suggestion_id: randomUUID(), source: "arbiter2",
      symbol: a.symbol, side: "buy", qty: SIZE_USD / a.buyPrice,
      entry_price: a.buyPrice, cost_usd: 2 * SIZE_USD,
      target_price: a.sellPrice, stop_price: null, horizon_hours: MAX_HOLD_H,
      status: "open", exit_reason: `arb2 ${a.buyVenue}→${a.sellVenue}`,
      opened_at: new Date(nowMs).toISOString(),
    });
    if (error) continue;
    opened++; room--; cashAvail -= 2 * SIZE_USD; cooling.add(a.symbol); openSymbols.add(a.symbol);
    recordEvent("arb2_open", { meta: {
      symbol: a.symbol, route: `${a.buyVenue}→${a.sellVenue}`,
      spread: Math.round(a.spreadPct * 100) / 100, net: Math.round(a.netPct * 100) / 100,
    } });
  }

  if (closed > 0 || opened > 0) {
    await db.from("paper_accounts").update({
      cash_usd: Number(acc.cash_usd) + cashDelta - opened * 2 * SIZE_USD,
      realized_pnl_usd: Number(acc.realized_pnl_usd) + pnlDelta,
      wins: Number(acc.wins) + wins, losses: Number(acc.losses) + losses,
      updated_at: new Date(nowMs).toISOString(),
    }).eq("id", acc.id);
  }
  return { closed, opened, skipped: null };
}
