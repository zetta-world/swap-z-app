import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { deskFor } from "@/lib/zion/desks";
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
    selectAllRows<{ account_id: string; symbol: string; side: string; pnl_usd: number | null; pnl_pct: number | null; exit_reason: string | null; closed_at: string | null }>(
      (from, to) => db.from("paper_positions").select("account_id, symbol, side, pnl_usd, pnl_pct, exit_reason, closed_at")
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
    // arbiter2 cycles are hedged (long spot + short perp): directional MTM is
    // ~zero by construction — showing spot drift would invent P&L.
    const u = p.source === "arbiter2" || cur == null ? 0 : Number(p.cost_usd) * (((cur - Number(p.entry_price)) / Number(p.entry_price)) * (p.side === "buy" ? 1 : -1));
    unreal.set(p.account_id, (unreal.get(p.account_id) ?? 0) + u);
    const book = openBook.get(p.account_id) ?? []; book.push({ symbol: p.symbol, side: p.side, costUsd: Number(p.cost_usd), unrealized: u }); openBook.set(p.account_id, book);
  }

  // Closed-trade stats + curve points + recent fills per account. The recent
  // list is what makes the arbiter legible: its round-trips open and close in
  // the same instant, so the "open book" is (correctly) always empty — the
  // executed orders live here, route included (exit_reason "arb binance→okx").
  type RecentTrade = { symbol: string; side: string; pnlUsd: number; pnlPct: number | null; route: string | null; closedAt: string | null };
  type Closed = { pnls: number[]; pts: Array<{ t: number; pnl: number }>; recent: RecentTrade[] };
  const closedBy = new Map<string, Closed>();
  for (const c of closed) {
    const cb = closedBy.get(c.account_id) ?? { pnls: [], pts: [], recent: [] };
    const pnl = Number(c.pnl_usd) || 0;
    cb.pnls.push(pnl); cb.pts.push({ t: Date.parse(c.closed_at ?? ""), pnl });
    cb.recent.push({ symbol: c.symbol, side: c.side, pnlUsd: pnl, pnlPct: c.pnl_pct == null ? null : Number(c.pnl_pct), route: c.exit_reason, closedAt: c.closed_at });
    closedBy.set(c.account_id, cb);
  }

  const rows = accounts.map((a) => {
    const starting = Number(a.starting_usd);
    const realized = Number(a.realized_pnl_usd);
    const unrealized = unreal.get(a.id) ?? 0;
    /**
     * ⚠️⚠️ ESTE NÚMERO NÃO É O CAIXA, E A TELA DIZIA QUE ERA (05/08).
     *
     * `equity = capital + realizado + não-realizado` é a conta CONTÁBIL: o que
     * a carteira DEVERIA ter se nada tivesse vazado. A coluna `cash_usd` é o
     * que ela REALMENTE tem.
     *
     * Nas carteiras aposentadas as duas divergem brutalmente, e a tela mostrava
     * só a primeira:
     *
     *   oracle_mistral   equity exibido $1.001   ·   cash_usd real  $9,80
     *   deepseek_scan    equity exibido   $998   ·   cash_usd real  $0,40
     *   grok_scan        equity exibido   $994   ·   cash_usd real  $0,00
     *
     * O total do painel dizia PATRIMÔNIO $20.842. A soma real de `cash_usd` nas
     * 23 carteiras é ≈ $11.491. Nove mil e trezentos dólares de diferença, numa
     * tela que trazia um ✓ verde dizendo "caixa bate com os trades".
     *
     * O ✓ não estava mentindo por si: ele vem de `planRepair`, que por decisão
     * de 04/08 só olha as carteiras VIVAS. Nessas, bate mesmo. Só que ele era
     * exibido acima de uma lista com as 23, e lido como afirmação sobre todas.
     *
     * As aposentadas estarem furadas é DELIBERADO — é a cicatriz preservada do
     * vazamento de julho, e recreditá-las apagaria o registro. O defeito nunca
     * foi o buraco: foi a tela mostrar o valor contábil no lugar do caixa e
     * carimbar de "confere".
     *
     * Agora as duas viajam juntas, e o buraco é uma coluna.
     */
    const equity = starting + realized + unrealized;
    const cash = Number(a.cash_usd);
    // O que os trades justificam ter em caixa AGORA (posições abertas travam
    // capital, então elas saem da conta).
    const cashEsperado = starting + realized;
    const buracoUsd = cash - cashEsperado;
    const decided = Number(a.wins) + Number(a.losses);
    const cb = closedBy.get(a.id) ?? { pnls: [], pts: [], recent: [] };
    const wins = cb.pnls.filter((p) => p > 0), losses = cb.pnls.filter((p) => p < 0);
    const sumWin = wins.reduce((s, p) => s + p, 0), sumLoss = losses.reduce((s, p) => s + p, 0);
    return {
      source: a.source, label: a.label,
      startingUsd: starting, cashUsd: cash, equity,
      /**
       * ⚠️ APOSENTADA? — decisão do dono, 05/08: "mesa aposentada vira arquivo".
       *
       * Elas ocupavam 10 das 23 linhas e apareciam em vermelho como se
       * tivessem perdido operando, quando o buraco delas é a cicatriz
       * PRESERVADA do vazamento de julho. Mesa fora do registro conta como
       * VIVA: o desconhecido não ganha dispensa.
       */
      retired: deskFor(a.source)?.status === "valhalla",
      /** O caixa que os trades justificam, e o buraco entre ele e o real. */
      cashEsperadoUsd: cashEsperado,
      buracoUsd: Math.abs(buracoUsd) < 0.01 ? 0 : buracoUsd,
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
      recentTrades: cb.recent.slice(-8).reverse(), // newest first
      curve: equityCurve(starting, cb.pts),
    };
  // Rank by RETURN %, not absolute equity — wallets start with different
  // capital (arbiter2 seeds at the real-deposit $300 vs $1000 elsewhere), and
  // absolute equity would pin a smaller-seeded desk to the bottom forever.
  }).sort((x, y) => y.returnPct - x.returnPct || y.equity - x.equity);

  const totals = {
    startingUsd:   rows.reduce((s, r) => s + r.startingUsd, 0),
    equity:        rows.reduce((s, r) => s + r.equity, 0),
    /**
     * ⚠️ O CAIXA REAL SOMADO, ao lado do contábil (05/08).
     *
     * `equity` somava $20.842 enquanto o caixa real somava ≈$11.491, e só o
     * primeiro aparecia — sob um ✓ verde de "caixa bate". Um total que ignora a
     * coluna do caixa não pode ser o único total de um painel de carteiras.
     */
    cashUsd:       rows.reduce((s, r) => s + r.cashUsd, 0),
    buracoUsd:     rows.reduce((s, r) => s + r.buracoUsd, 0),
    /** Quantas carteiras têm buraco — o número que resume a honestidade da tela. */
    comBuraco:     rows.filter((r) => r.buracoUsd < -0.01).length,
    realizedPnl:   rows.reduce((s, r) => s + r.realizedPnl, 0),
    openPositions: rows.reduce((s, r) => s + r.openPositions, 0),
    exposure:      rows.reduce((s, r) => s + r.exposure, 0),
    closedTrades:  rows.reduce((s, r) => s + r.closedTrades, 0),
  };

  return NextResponse.json({ rows, totals, fetchedAt: new Date().toISOString() });
}
