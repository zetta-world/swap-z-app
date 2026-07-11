import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { gateioSpot } from "@/lib/paper/engine";

export const dynamic = "force-dynamic";

/** Paper-trading dashboard: per-agent Gate.io simulation wallets — equity
 *  (marked-to-market on the LIVE Gate.io price), realized + unrealized P&L,
 *  win-rate and the open book. This is the tournament at the PORTFOLIO level. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: accounts }, open] = await Promise.all([
    db.from("paper_accounts").select("*"),
    selectAllRows<{ account_id: string; source: string; symbol: string; side: string; cost_usd: number; entry_price: number }>(
      (from, to) => db.from("paper_positions")
        .select("account_id, source, symbol, side, cost_usd, entry_price")
        .eq("status", "open").order("opened_at", { ascending: true }).range(from, to)),
  ]);
  if (!accounts) return NextResponse.json({ error: "no_accounts" }, { status: 500 });

  const prices = await gateioSpot([...new Set(open.map((p) => p.symbol))]);

  // Unrealized P&L per account, marked to the live Gate.io price.
  const unreal = new Map<string, number>();
  const openCount = new Map<string, number>();
  for (const p of open) {
    openCount.set(p.account_id, (openCount.get(p.account_id) ?? 0) + 1);
    const cur = prices.get(p.symbol.toUpperCase());
    if (cur == null) continue;
    const dir = p.side === "buy" ? 1 : -1;
    const pnl = Number(p.cost_usd) * (((cur - Number(p.entry_price)) / Number(p.entry_price)) * dir);
    unreal.set(p.account_id, (unreal.get(p.account_id) ?? 0) + pnl);
  }

  const rows = accounts.map((a) => {
    const realized = Number(a.realized_pnl_usd);
    const unrealized = unreal.get(a.id) ?? 0;
    const equity = Number(a.starting_usd) + realized + unrealized;
    const decided = Number(a.wins) + Number(a.losses);
    return {
      source: a.source, label: a.label,
      startingUsd: Number(a.starting_usd),
      cashUsd: Number(a.cash_usd),
      equity,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      returnPct: (equity / Number(a.starting_usd) - 1) * 100,
      wins: Number(a.wins), losses: Number(a.losses),
      winRate: decided > 0 ? (Number(a.wins) / decided) * 100 : null,
      openPositions: openCount.get(a.id) ?? 0,
    };
  }).sort((x, y) => y.equity - x.equity);

  const totals = {
    startingUsd: rows.reduce((s, r) => s + r.startingUsd, 0),
    equity:      rows.reduce((s, r) => s + r.equity, 0),
    openPositions: rows.reduce((s, r) => s + r.openPositions, 0),
  };

  return NextResponse.json({ rows, totals, fetchedAt: new Date().toISOString() });
}
