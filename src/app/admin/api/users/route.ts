import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

/**
 * USERS workspace — the "information is gold" drill-down. Without ?wallet → a
 * leaderboard (volume / net P&L / activity per wallet). With ?wallet=X → the
 * full X-ray for one wallet: money in/out, gross win vs gross loss, win-rate,
 * volume by chain and by op-kind, autopilot P&L + open exposure, and the pages
 * they actually browsed.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const wallet = req.nextUrl.searchParams.get("wallet")?.trim();

  // ── DETAIL ──────────────────────────────────────────────────────────────
  if (wallet) {
    const [{ data: tier }, { data: user }, { data: sessions }, { data: positions }, ops, { data: recentOps }, { data: events }] = await Promise.all([
      db.from("tier_cache").select("tier, source").eq("wallet_address", wallet).maybeSingle(),
      db.from("users").select("wallet_chain, created_at, last_seen_at").eq("wallet_address", wallet).maybeSingle(),
      db.from("autopilot_sessions").select("exchange_id, risk_mode, market_type, is_active, trades_today, pnl_today, frozen_until_day, last_scan_at").eq("wallet_address", wallet),
      db.from("autopilot_positions").select("cost_usd, status").eq("wallet_address", wallet),
      selectAllRows<{ kind: string; chain: string | null; pnl_usd: number | null; volume_usd: number | null; status: string }>(
        (from, to) => db.from("operations").select("kind, chain, pnl_usd, volume_usd, status").eq("wallet_address", wallet).order("created_at", { ascending: false }).range(from, to)),
      db.from("operations").select("kind, chain, pair, side, volume_usd, pnl_usd, status, created_at").eq("wallet_address", wallet).order("created_at", { ascending: false }).limit(40),
      db.from("platform_events").select("event_type, path, created_at").eq("wallet_address", wallet).order("created_at", { ascending: false }).limit(200),
    ]);

    // Financials from the FULL operations set.
    let volume = 0, grossWin = 0, grossLoss = 0, winOps = 0, lossOps = 0;
    const byChain = new Map<string, { volume: number; pnl: number; ops: number }>();
    const byKind  = new Map<string, { count: number; volume: number; pnl: number }>();
    for (const o of ops) {
      const v = Number(o.volume_usd) || 0, p = Number(o.pnl_usd) || 0;
      volume += v;
      if (p > 0) { grossWin += p; winOps++; } else if (p < 0) { grossLoss += p; lossOps++; }
      const ch = o.chain ?? "—";
      const c = byChain.get(ch) ?? { volume: 0, pnl: 0, ops: 0 }; c.volume += v; c.pnl += p; c.ops++; byChain.set(ch, c);
      const k = byKind.get(o.kind) ?? { count: 0, volume: 0, pnl: 0 }; k.count++; k.volume += v; k.pnl += p; byKind.set(o.kind, k);
    }
    const decided = winOps + lossOps;

    // Autopilot exposure (open positions) + P&L today.
    let openExposure = 0, openPositions = 0;
    for (const p of positions ?? []) if (p.status !== "closed") { openExposure += Number(p.cost_usd) || 0; openPositions++; }
    const apPnlToday = (sessions ?? []).reduce((s, x) => s + (Number(x.pnl_today) || 0), 0);

    // Browsing: page-view timeline + which pages, from the events.
    const pageViews = (events ?? []).filter((e) => e.event_type === "page_view");
    const byPath = new Map<string, number>();
    for (const e of pageViews) byPath.set(e.path ?? "?", (byPath.get(e.path ?? "?") ?? 0) + 1);

    return NextResponse.json({
      wallet,
      tier: tier?.tier ?? "free", tierSource: tier?.source ?? null,
      chain: user?.wallet_chain ?? null,
      firstSeen: user?.created_at ?? null, lastSeen: user?.last_seen_at ?? null,
      financials: {
        volume, netPnl: grossWin + grossLoss, grossWin, grossLoss,
        winOps, lossOps, winRate: decided > 0 ? (winOps / decided) * 100 : null,
        totalOps: ops.length,
      },
      byChain: [...byChain.entries()].map(([chain, v]) => ({ chain, ...v })).sort((a, b) => b.volume - a.volume),
      byKind:  [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.count - a.count),
      autopilot: { activeSessions: (sessions ?? []).filter((s) => s.is_active).length, sessions: sessions ?? [], pnlToday: apPnlToday, openPositions, openExposure },
      browsing: { pageViews: pageViews.length, byPath: [...byPath.entries()].map(([path, n]) => ({ path, n })).sort((a, b) => b.n - a.n).slice(0, 12) },
      operations: recentOps ?? [],
      events: events ?? [],
      fetchedAt: new Date().toISOString(),
    });
  }

  // ── LIST (leaderboard) ────────────────────────────────────────────────────
  const [{ data: opsRows }, { data: tiers }, { data: users }, { data: pv }, { data: apSessions }] = await Promise.all([
    db.from("operations").select("wallet_address, volume_usd, pnl_usd, created_at").not("wallet_address", "is", null).order("created_at", { ascending: false }).limit(5000),
    db.from("tier_cache").select("wallet_address, tier"),
    db.from("users").select("wallet_address, created_at"),
    db.from("platform_events").select("wallet_address").eq("event_type", "page_view").not("wallet_address", "is", null).limit(5000),
    db.from("autopilot_sessions").select("wallet_address, is_active"),
  ]);

  const tierBy = new Map<string, string>((tiers ?? []).map((t) => [t.wallet_address, t.tier]));
  const firstBy = new Map<string, string>((users ?? []).map((u) => [u.wallet_address, u.created_at]));
  const pvBy = new Map<string, number>(); for (const r of pv ?? []) pvBy.set(r.wallet_address as string, (pvBy.get(r.wallet_address as string) ?? 0) + 1);
  const apBy = new Map<string, boolean>(); for (const s of apSessions ?? []) if (s.is_active) apBy.set(s.wallet_address, true);

  const agg = new Map<string, { wallet: string; ops: number; volume: number; win: number; loss: number; lastSeen: string }>();
  for (const o of opsRows ?? []) {
    const w = o.wallet_address as string;
    const cur = agg.get(w) ?? { wallet: w, ops: 0, volume: 0, win: 0, loss: 0, lastSeen: o.created_at };
    cur.ops++; cur.volume += Number(o.volume_usd) || 0;
    const p = Number(o.pnl_usd) || 0; if (p > 0) cur.win += p; else cur.loss += p;
    if (o.created_at > cur.lastSeen) cur.lastSeen = o.created_at;
    agg.set(w, cur);
  }

  // Wallets that only browsed (no ops yet) still matter — surface them too.
  for (const w of pvBy.keys()) if (!agg.has(w)) agg.set(w, { wallet: w, ops: 0, volume: 0, win: 0, loss: 0, lastSeen: firstBy.get(w) ?? "" });

  const wallets = [...agg.values()]
    .map((a) => ({
      wallet: a.wallet, ops: a.ops, volume: a.volume, pnl: a.win + a.loss, grossWin: a.win, grossLoss: a.loss,
      tier: tierBy.get(a.wallet) ?? "free", firstSeen: firstBy.get(a.wallet) ?? null, lastSeen: a.lastSeen,
      pageViews: pvBy.get(a.wallet) ?? 0, autopilot: apBy.get(a.wallet) ?? false,
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, 80);

  return NextResponse.json({ wallets, fetchedAt: new Date().toISOString() });
}
