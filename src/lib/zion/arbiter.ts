/**
 * ARBITER desk — cross-CEX arbitrage, polished by REMOVING the LLM.
 *
 * A spread between exchanges is arithmetic: (high − low) / low. A language
 * model adds nothing to arithmetic except cost and hallucination, so this desk
 * runs zero-token by design (docs/PLANO-MESA-AGENTES.md). It rides the radar's
 * 1-min tick, reads the public multi-exchange spot matrix, and books a
 * simulated INSTANT round-trip (buy the cheap venue, sell the rich one) into
 * the 'arbiter' paper wallet — realized P&L on the spot, equity curve for free.
 *
 * Honest caveat baked into the numbers: paper arb assumes both legs fill at
 * the observed price (no leg risk, no depth). ARB_COST_PCT carries a buffer
 * for that, and F2 validates against real orderbooks before anything real.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS } from "@/lib/api/cex-spot";
import { recordEvent } from "@/lib/admin/track";

const COST_PCT     = Number(process.env.ARB_COST_PCT     ?? 0.4);  // 2 taker legs + slippage buffer
const MIN_NET_PCT  = Number(process.env.ARB_MIN_NET_PCT  ?? 0.15); // floor to act
const DAILY_CAP    = Number(process.env.ARB_DAILY_CAP    ?? 20);   // round-trips per UTC day
const COOLDOWN_MIN = Number(process.env.ARB_COOLDOWN_MIN ?? 30);   // per-symbol re-entry wait
const SIZE_USD     = Number(process.env.ARB_SIZE_USD     ?? 50);   // per round-trip

export interface ArbOpportunity {
  symbol: string; buyVenue: string; sellVenue: string;
  buyPrice: number; sellPrice: number;
  spreadPct: number; netPct: number;
}

/** Pure detector: scan the venue matrix for spreads whose NET (after costs)
 *  clears the floor. Needs ≥2 venues quoting the symbol; fail-closed on junk. */
export function findArbs(
  spot: Map<string, Map<string, { priceUsd: number }>>,
  costPct = COST_PCT,
  minNetPct = MIN_NET_PCT,
): ArbOpportunity[] {
  const out: ArbOpportunity[] = [];
  for (const [symbol, venues] of spot) {
    if (venues.size < 2) continue;
    let lo: { v: string; p: number } | null = null, hi: { v: string; p: number } | null = null;
    for (const [v, { priceUsd }] of venues) {
      if (!(priceUsd > 0)) continue;
      if (!lo || priceUsd < lo.p) lo = { v, p: priceUsd };
      if (!hi || priceUsd > hi.p) hi = { v, p: priceUsd };
    }
    if (!lo || !hi || lo.v === hi.v) continue;
    const spreadPct = ((hi.p - lo.p) / lo.p) * 100;
    const netPct = spreadPct - costPct;
    if (netPct >= minNetPct) {
      out.push({ symbol, buyVenue: lo.v, sellVenue: hi.v, buyPrice: lo.p, sellPrice: hi.p, spreadPct, netPct });
    }
  }
  return out.sort((a, b) => b.netPct - a.netPct);
}

export interface ArbiterResult { detected: number; booked: number; skipped: string | null }

/** One arbiter tick: detect → cooldown/daily-cap gates → book instant paper
 *  round-trips into the 'arbiter' wallet. Zero LLM calls, best-effort. */
export async function runArbiterScan(): Promise<ArbiterResult> {
  const db = getSupabaseAdmin();
  if (!db) return { detected: 0, booked: 0, skipped: "db" };

  const spot = await getMultiExchangeSpot([...CEX_TRACKED_SYMBOLS]);
  const arbs = findArbs(spot as Map<string, Map<string, { priceUsd: number }>>);
  if (arbs.length === 0) return { detected: 0, booked: 0, skipped: null };

  // Wallet (seeded in admin_kv setup; upsert keeps this idempotent).
  await db.from("paper_accounts").upsert(
    { source: "arbiter", label: "Arbiter ⚖️", exchange: "multi-cex", starting_usd: 1000, cash_usd: 1000 },
    { onConflict: "source", ignoreDuplicates: true },
  );
  const { data: acc } = await db.from("paper_accounts")
    .select("id, cash_usd, realized_pnl_usd, wins, losses").eq("source", "arbiter").maybeSingle();
  if (!acc) return { detected: arbs.length, booked: 0, skipped: "no_account" };

  // Gates: per-symbol cooldown + daily cap (both from today's book — one query).
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: recent } = await db.from("paper_positions")
    .select("symbol, opened_at").eq("account_id", acc.id)
    .gte("opened_at", dayStart.toISOString());
  const today = recent ?? [];
  if (today.length >= DAILY_CAP) return { detected: arbs.length, booked: 0, skipped: "daily_cap" };
  const cooldownCut = Date.now() - COOLDOWN_MIN * 60_000;
  const cooling = new Set(today.filter((r) => Date.parse(r.opened_at) > cooldownCut).map((r) => r.symbol));

  let booked = 0, pnlSum = 0;
  const room = DAILY_CAP - today.length;
  for (const a of arbs) {
    if (booked >= room) break;
    if (cooling.has(a.symbol)) continue;
    const pnl = SIZE_USD * (a.netPct / 100);
    const now = new Date().toISOString();
    const { error } = await db.from("paper_positions").insert({
      account_id: acc.id, suggestion_id: randomUUID(), source: "arbiter",
      symbol: a.symbol, side: "buy", qty: SIZE_USD / a.buyPrice,
      entry_price: a.buyPrice, cost_usd: SIZE_USD,
      target_price: a.sellPrice, stop_price: null, horizon_hours: 0,
      status: "closed", exit_price: a.sellPrice,
      exit_reason: `arb ${a.buyVenue}→${a.sellVenue}`,
      pnl_usd: pnl, pnl_pct: a.netPct, opened_at: now, closed_at: now,
    });
    if (error) continue;
    booked++; pnlSum += pnl; cooling.add(a.symbol);
    recordEvent("arb_opportunity", { meta: {
      symbol: a.symbol, buy: a.buyVenue, sell: a.sellVenue,
      spreadPct: Math.round(a.spreadPct * 100) / 100, netPct: Math.round(a.netPct * 100) / 100,
    } });
  }

  if (booked > 0) {
    await db.from("paper_accounts").update({
      cash_usd: Number(acc.cash_usd) + pnlSum,
      realized_pnl_usd: Number(acc.realized_pnl_usd) + pnlSum,
      wins: Number(acc.wins) + booked, // net-positive by construction (floor > 0)
      updated_at: new Date().toISOString(),
    }).eq("id", acc.id);
  }
  return { detected: arbs.length, booked, skipped: null };
}
