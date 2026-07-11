/**
 * Paper-trading engine — the autonomous Gate.io simulation agent.
 *
 * Reads the flywheel's signals (zion_suggestions, READ-ONLY) and executes them
 * as SIMULATED trades, filled against Gate.io's LIVE public price. One virtual
 * wallet per signal source, so we get a portfolio equity curve per AI agent:
 * not just "was the signal right?" but "would this agent have MADE money?".
 *
 * ISOLATION: never imports the live autopilot / placeCexOrder / any exchange
 * key. No real order is ever sent. Fully self-contained: its only writes are to
 * paper_accounts / paper_positions; zion_suggestions is only ever SELECTed.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Round-trip execution cost (fees + slippage, both legs) — mirrors the flywheel
// so paper P&L is net, not gross. Default 0.2%.
const COST_PCT     = Number(process.env.BACKTEST_COST_PCT   ?? 0.2);
const POSITION_PCT = Number(process.env.PAPER_POSITION_PCT  ?? 0.05); // deploy 5% of starting capital per signal
const STARTING_USD = Number(process.env.PAPER_STARTING_USD  ?? 1000);
const MIN_CASH_USD = Number(process.env.PAPER_MIN_CASH_USD  ?? 25);   // floor to open a position (out-of-capital below this)

/** The flywheel sources that get their own paper wallet — the tournament, at
 *  the portfolio level. */
export const PAPER_SOURCES = ["self_scan", "hybrid_scan", "mistral_scan", "grok_scan", "deepseek_scan", "kimi_scan", "radar"] as const;
export type PaperSource = (typeof PAPER_SOURCES)[number];

const LABELS: Record<string, string> = {
  self_scan: "Claude (self)", hybrid_scan: "Ferrari (hybrid)", mistral_scan: "Mistral",
  grok_scan: "Grok", deepseek_scan: "DeepSeek", kimi_scan: "Kimi", radar: "Radar",
};

// ── Pure helpers (unit-tested — no DB, no network) ────────────────────────

/** Capital to deploy on one signal: a fixed slice of STARTING capital, capped
 *  by cash actually available. Returns 0 when out of capital (below the floor)
 *  — that "ran out of money" state is exactly the portfolio insight we want. */
export function sizePosition(cashAvail: number, startingUsd: number): number {
  const size = Math.min(cashAvail, startingUsd * POSITION_PCT);
  return size >= MIN_CASH_USD ? size : 0;
}

/** A trade can only be ENTERED if the live fill sits on the correct side of the
 *  bracket — you can't market-enter a signal that already reached its target or
 *  stop (a stale signal). buy: stop < fill < target. sell(short): target < fill < stop. */
export function canEnter(side: string, fill: number, target: number | null, stop: number | null): boolean {
  if (!(fill > 0)) return false;
  if (target == null || stop == null) return false;
  return side === "buy"
    ? fill > stop && fill < target
    : fill < stop && fill > target;
}

export interface ExitVerdict { exit: number; reason: "target" | "stop" | "expired"; netPct: number; pnlUsd: number; win: boolean; }

/** Decide a paper position's fate against the current live price. Stop-first
 *  pessimism (mirrors the flywheel): if the tick shows BOTH crossed we book the
 *  stop. Returns null while still in-flight. P&L is net of round-trip cost. */
export function computeExit(
  pos: { side: string; entry_price: number; cost_usd: number; target_price: number | null; stop_price: number | null; opened_at: string; horizon_hours: number },
  cur: number, nowMs: number,
): ExitVerdict | null {
  if (!(cur > 0)) return null;
  const dir = pos.side === "buy" ? 1 : -1;
  const horizonMs = Date.parse(pos.opened_at) + pos.horizon_hours * 3_600_000;
  const hitStop   = pos.stop_price   != null && (dir > 0 ? cur <= pos.stop_price   : cur >= pos.stop_price);
  const hitTarget = pos.target_price != null && (dir > 0 ? cur >= pos.target_price : cur <= pos.target_price);

  let exit: number, reason: ExitVerdict["reason"];
  if (hitStop)               { exit = pos.stop_price!;   reason = "stop"; }
  else if (hitTarget)        { exit = pos.target_price!; reason = "target"; }
  else if (nowMs >= horizonMs) { exit = cur;            reason = "expired"; }
  else return null;

  const grossPct = ((exit - pos.entry_price) / pos.entry_price) * dir * 100;
  const netPct   = grossPct - COST_PCT;
  const pnlUsd   = pos.cost_usd * (netPct / 100);
  const win      = reason === "target" || (reason === "expired" && pnlUsd > 0);
  return { exit, reason, netPct, pnlUsd, win };
}

// ── Gate.io live spot (public, no key) ────────────────────────────────────

/** One call to Gate.io's public tickers; returns base→USDT last price for the
 *  wanted symbols. Best-effort: a symbol missing from the map simply won't be
 *  filled/resolved this tick (fail-closed — no price, no trade). */
export async function gateioSpot(symbols: string[]): Promise<Map<string, number>> {
  const want = new Set(symbols.map((s) => s.toUpperCase()));
  const out = new Map<string, number>();
  if (want.size === 0) return out;
  try {
    const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers", { cache: "no-store" });
    if (!res.ok) return out;
    const rows = await res.json() as Array<{ currency_pair?: string; last?: string }>;
    for (const r of rows) {
      const pair = r.currency_pair ?? "";
      if (!pair.endsWith("_USDT")) continue;
      const base = pair.replace(/_USDT$/, "").toUpperCase();
      if (!want.has(base)) continue;
      const px = parseFloat(r.last ?? "");
      if (Number.isFinite(px) && px > 0) out.set(base, px);
    }
  } catch { /* best-effort */ }
  return out;
}

// ── DB orchestration ──────────────────────────────────────────────────────

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/** Idempotent seed of the per-agent wallets. Never resets an existing wallet
 *  (ignoreDuplicates) — so re-running can't wipe collected paper history. */
export async function ensurePaperAccounts(db: Db): Promise<void> {
  const rows = PAPER_SOURCES.map((s) => ({
    source: s, label: LABELS[s] ?? s, exchange: "gateio",
    starting_usd: STARTING_USD, cash_usd: STARTING_USD,
  }));
  try { await db.from("paper_accounts").upsert(rows, { onConflict: "source", ignoreDuplicates: true }); }
  catch { /* best-effort */ }
}

interface PaperAccount { id: string; source: string; starting_usd: number; cash_usd: number; realized_pnl_usd: number; wins: number; losses: number; }

/** Open new positions: each wallet market-enters its source's still-open signals
 *  (with a bracket) that it hasn't taken yet, at the live Gate.io fill, sized by
 *  available cash. Returns how many were opened. */
export async function openPaperPositions(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  await ensurePaperAccounts(db);

  const { data: accounts } = await db.from("paper_accounts").select("id, source, starting_usd, cash_usd, realized_pnl_usd, wins, losses");
  if (!accounts?.length) return 0;
  const accBySource = new Map<string, PaperAccount>(accounts.map((a) => [a.source, a as PaperAccount]));

  const { data: sugg } = await db.from("zion_suggestions")
    .select("id, symbol, side, target_price, stop_price, horizon_hours, source, status, created_at")
    .in("source", PAPER_SOURCES as unknown as string[])
    .eq("status", "open")
    .not("target_price", "is", null)
    .not("stop_price", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (!sugg?.length) return 0;

  const { data: held } = await db.from("paper_positions").select("account_id, suggestion_id");
  const taken = new Set((held ?? []).map((h) => `${h.account_id}:${h.suggestion_id}`));

  const px = await gateioSpot([...new Set(sugg.map((s) => s.symbol))]);
  const spent = new Map<string, number>(); // account_id → cash deployed this tick
  type PaperInsert = {
    account_id: string; suggestion_id: string; source: string; symbol: string;
    side: "buy" | "sell"; qty: number; entry_price: number; cost_usd: number;
    target_price: number | null; stop_price: number | null; horizon_hours: number;
  };
  const inserts: PaperInsert[] = [];

  for (const s of sugg) {
    const acc = accBySource.get(s.source);
    if (!acc) continue;
    if (taken.has(`${acc.id}:${s.id}`)) continue;
    const fill = px.get(s.symbol.toUpperCase());
    if (fill == null || !canEnter(s.side, fill, s.target_price, s.stop_price)) continue;
    const cashAvail = Number(acc.cash_usd) - (spent.get(acc.id) ?? 0);
    const size = sizePosition(cashAvail, Number(acc.starting_usd));
    if (size <= 0) continue; // out of capital
    inserts.push({
      account_id: acc.id, suggestion_id: s.id, source: s.source, symbol: s.symbol, side: s.side,
      qty: size / fill, entry_price: fill, cost_usd: size,
      target_price: s.target_price, stop_price: s.stop_price, horizon_hours: s.horizon_hours ?? 72,
    });
    spent.set(acc.id, (spent.get(acc.id) ?? 0) + size);
    taken.add(`${acc.id}:${s.id}`);
  }

  if (inserts.length === 0) return 0;
  try { await db.from("paper_positions").insert(inserts); } catch { return 0; }
  for (const [accId, cash] of spent) {
    const acc = accounts.find((a) => a.id === accId)!;
    await db.from("paper_accounts").update({ cash_usd: Number(acc.cash_usd) - cash, updated_at: new Date().toISOString() }).eq("id", accId);
  }
  return inserts.length;
}

/** Resolve open positions against the live Gate.io price: close on target/stop
 *  touch or horizon, realize P&L back to the wallet's cash. Returns closed count. */
export async function resolvePaperPositions(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { data: openFull } = await db.from("paper_positions")
    .select("id, account_id, symbol, side, entry_price, cost_usd, target_price, stop_price, horizon_hours, opened_at")
    .eq("status", "open").limit(1000);
  if (!openFull?.length) return 0;
  const prices = await gateioSpot([...new Set(openFull.map((p) => p.symbol))]);

  const nowMs = Date.now();
  const delta = new Map<string, { cash: number; pnl: number; wins: number; losses: number }>();
  let closed = 0;

  for (const p of openFull) {
    const cur = prices.get(p.symbol.toUpperCase());
    if (cur == null) continue;
    const v = computeExit(p, cur, nowMs);
    if (!v) continue;
    try {
      await db.from("paper_positions").update({
        status: "closed", exit_price: v.exit, exit_reason: v.reason,
        pnl_usd: v.pnlUsd, pnl_pct: v.netPct, closed_at: new Date().toISOString(),
      }).eq("id", p.id);
    } catch { continue; }
    const d = delta.get(p.account_id) ?? { cash: 0, pnl: 0, wins: 0, losses: 0 };
    d.cash += Number(p.cost_usd) + v.pnlUsd; // return deployed capital + P&L to cash
    d.pnl  += v.pnlUsd;
    if (v.win) d.wins++; else d.losses++;
    delta.set(p.account_id, d);
    closed++;
  }

  for (const [accId, d] of delta) {
    const { data: acc } = await db.from("paper_accounts").select("cash_usd, realized_pnl_usd, wins, losses").eq("id", accId).maybeSingle();
    if (!acc) continue;
    await db.from("paper_accounts").update({
      cash_usd: Number(acc.cash_usd) + d.cash,
      realized_pnl_usd: Number(acc.realized_pnl_usd) + d.pnl,
      wins: Number(acc.wins) + d.wins, losses: Number(acc.losses) + d.losses,
      updated_at: new Date().toISOString(),
    }).eq("id", accId);
  }
  return closed;
}

/** One paper-agent tick: resolve first (free cash), then open new positions. */
export async function runPaperAgent(): Promise<{ opened: number; closed: number }> {
  const closed = await resolvePaperPositions().catch(() => 0);
  const opened = await openPaperPositions().catch(() => 0);
  return { opened, closed };
}
