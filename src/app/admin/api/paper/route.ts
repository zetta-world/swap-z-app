import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { gateioSpot } from "@/lib/paper/engine";

export const dynamic = "force-dynamic";

/** Realized equity curve (index 100 = starting) from closed positions in close
 *  order, downsampled to ≤40 points. */
function equityCurve(startingUsd: number, pts: Array<{ t: number; pnl: number }>, maxPts = 40): number[] {
  if (pts.length === 0 || !(startingUsd > 0)) return [];
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const eq: number[] = []; let cash = startingUsd;
  for (const p of sorted) { cash += p.pnl; eq.push((cash / startingUsd) * 100); }
  if (eq.length <= maxPts) return eq.map((v) => Math.round(v * 10) / 10);
  const step = (eq.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => Math.round(eq[Math.round(i * step)] * 10) / 10);
}

/**
 * Paper-trading dashboard — the Gate.io simulation at portfolio level, premium.
 * Per agent: equity marked-to-market on the LIVE Gate.io price, realized +
 * unrealized P&L, return, win-rate, avg win/loss, profit factor, best/worst
 * trade, open exposure + open book, and a realized equity curve.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: accounts }, open, closed] = await Promise.all([
    db.from("paper_accounts").select("*"),
    selectAllRows<{ account_id: string; source: string; symbol: string; side: string; cost_usd: number; entry_price: number }>(
      (from, to) => db.from("paper_positions").select("account_id, source, symbol, side, cost_usd, entry_price")
        .eq("status", "open").is("archived_at", null).order("opened_at", { ascending: true }).range(from, to)),
    selectAllRows<{ account_id: string; pnl_usd: number | null; closed_at: string | null }>(
      (from, to) => db.from("paper_positions").select("account_id, pnl_usd, closed_at")
        .eq("status", "closed").is("archived_at", null).order("closed_at", { ascending: true }).range(from, to)),
  ]);
  if (!accounts) return NextResponse.json({ error: "no_accounts" }, { status: 500 });

  const prices = await gateioSpot([...new Set(open.map((p) => p.symbol))]);

  // Open book + unrealized (mark-to-market) + exposure per account.
  type OpenPos = { symbol: string; side: string; costUsd: number; unrealized: number };
  const unreal = new Map<string, number>(), exposure = new Map<string, number>(), openCount = new Map<string, number>();
  const openBook = new Map<string, OpenPos[]>();
  for (const p of open) {
    openCount.set(p.account_id, (openCount.get(p.account_id) ?? 0) + 1);
    exposure.set(p.account_id, (exposure.get(p.account_id) ?? 0) + Number(p.cost_usd));
    const cur = prices.get(p.symbol.toUpperCase());
    const u = cur == null ? 0 : Number(p.cost_usd) * (((cur - Number(p.entry_price)) / Number(p.entry_price)) * (p.side === "buy" ? 1 : -1));
    unreal.set(p.account_id, (unreal.get(p.account_id) ?? 0) + u);
    const book = openBook.get(p.account_id) ?? []; book.push({ symbol: p.symbol, side: p.side, costUsd: Number(p.cost_usd), unrealized: u }); openBook.set(p.account_id, book);
  }

  // Closed-trade stats + curve points per account.
  type Closed = { pnls: number[]; pts: Array<{ t: number; pnl: number }> };
  const closedBy = new Map<string, Closed>();
  for (const c of closed) {
    const cb = closedBy.get(c.account_id) ?? { pnls: [], pts: [] };
    const pnl = Number(c.pnl_usd) || 0;
    cb.pnls.push(pnl); cb.pts.push({ t: Date.parse(c.closed_at ?? ""), pnl });
    closedBy.set(c.account_id, cb);
  }

  const rows = accounts.map((a) => {
    const starting = Number(a.starting_usd);
    const realized = Number(a.realized_pnl_usd);
    const unrealized = unreal.get(a.id) ?? 0;
    const equity = starting + realized + unrealized;
    const decided = Number(a.wins) + Number(a.losses);
    const cb = closedBy.get(a.id) ?? { pnls: [], pts: [] };
    const wins = cb.pnls.filter((p) => p > 0), losses = cb.pnls.filter((p) => p < 0);
    const sumWin = wins.reduce((s, p) => s + p, 0), sumLoss = losses.reduce((s, p) => s + p, 0);
    return {
      source: a.source, label: a.label,
      startingUsd: starting, cashUsd: Number(a.cash_usd), equity,
      realizedPnl: realized, unrealizedPnl: unrealized,
      returnPct: (equity / starting - 1) * 100,
      wins: Number(a.wins), losses: Number(a.losses),
      winRate: decided > 0 ? (Number(a.wins) / decided) * 100 : null,
      avgWin:  wins.length   ? sumWin / wins.length   : null,
      avgLoss: losses.length ? sumLoss / losses.length : null,
      profitFactor: sumLoss < 0 ? sumWin / Math.abs(sumLoss) : null,
      best:  cb.pnls.length ? Math.max(...cb.pnls) : null,
      worst: cb.pnls.length ? Math.min(...cb.pnls) : null,
      closedTrades: cb.pnls.length,
      openPositions: openCount.get(a.id) ?? 0,
      exposure: exposure.get(a.id) ?? 0,
      openBook: (openBook.get(a.id) ?? []).sort((x, y) => y.costUsd - x.costUsd).slice(0, 6),
      curve: equityCurve(starting, cb.pts),
    };
  }).sort((x, y) => y.equity - x.equity);

  const totals = {
    startingUsd:   rows.reduce((s, r) => s + r.startingUsd, 0),
    equity:        rows.reduce((s, r) => s + r.equity, 0),
    realizedPnl:   rows.reduce((s, r) => s + r.realizedPnl, 0),
    openPositions: rows.reduce((s, r) => s + r.openPositions, 0),
    exposure:      rows.reduce((s, r) => s + r.exposure, 0),
    closedTrades:  rows.reduce((s, r) => s + r.closedTrades, 0),
  };

  return NextResponse.json({ rows, totals, fetchedAt: new Date().toISOString() });
}
