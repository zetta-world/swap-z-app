import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  listRunnableSessions, decryptSessionCreds, patchSession, recordRuns, utcDayKey,
  tryLockSession, releaseLock, bumpSessionTrades,
} from "@/lib/autopilot/sessions";
import { runAutopilotCexScan, formatRegimeContext } from "@/lib/autopilot/scan";
import { mapCardToCexIntents } from "@/lib/zion/card-mapping";
import { fetchCexBalance, placeCexOrder, fetchCexOrderStatus } from "@/lib/cex/server";
import { getCexSpotPrices, type CexSpotPrice } from "@/lib/api/cex-spot";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { trendGate } from "@/lib/zion/sniper";
import { checkRealNotional } from "@/lib/autopilot/price-guard";
import { logOperation, notifyTelegram } from "@/lib/admin/track";
import { setCronHeartbeat } from "@/lib/admin/health";
import { runAlertWatchdog } from "@/lib/admin/watchdog";
import {
  getOpenServerPositions, recordServerEntry, markServerExitArmed,
  closeServerPosition, reopenServerPosition, applySessionPnl,
} from "@/lib/autopilot/positions-server";
import type { AutopilotSessionRow, AutopilotRunRow, AutopilotPositionRow } from "@/lib/supabase/types";
import type { CexId, CexCredentials, CexOrder } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/autopilot/cron — the background-autopilot worker.
 *
 * Hit by a GitHub Actions schedule (see .github/workflows/autopilot-cron.yml)
 * every few minutes. Authenticated with a bearer == CRON_SECRET. For each
 * active, non-expired session it:
 *   1. rolls the daily counters over at UTC midnight,
 *   2. honors the daily loss-stop freeze,
 *   3. reads live balance → recomputes a bounded per-trade cap,
 *   4. runs a ZION scan,
 *   5. fires the resulting SPOT orders (futures/margin are scan-only in
 *      background — autonomous leverage unattended is too dangerous),
 *   6. records every outcome to autopilot_runs and updates counters.
 *
 * It NEVER throws to the caller — one bad session can't abort the batch.
 */

// Same risk→% mapping the in-browser UI uses to size trades off live balance.
const RISK_PCT: Record<string, number> = {
  conservador: 0.20,
  moderado:    0.40,
  agressivo:   0.65,
};
const MAX_ORDERS_PER_RUN = 4;

// Server-side total open-exposure cap per risk mode (mirrors the browser
// presets in store/autopilot.ts). The cron never lets the sum of open
// position cost exceed this (A4 server side).
const RISK_EXPOSURE_USD: Record<string, number> = { conservador: 75, moderado: 200, agressivo: 400 };

type RunRowT = Partial<AutopilotRunRow> & { wallet_address: string; exchange_id: string; status: string };

const STABLE_FEE = new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDP", "USD"]);

/** Realized USD P&L of a filled SELL against a position's average cost. */
function realizedFromSell(order: CexOrder, pos: AutopilotPositionRow): number | null {
  const filledQty = Number(order.filled ?? 0);
  if (!(filledQty > 0)) return null;
  const proceeds = Number(order.cost) > 0 ? Number(order.cost) : filledQty * Number(order.average ?? 0);
  if (!(proceeds > 0)) return null;
  const avgCost = Number(pos.base_amount) > 0 ? Number(pos.cost_usd) / Number(pos.base_amount) : 0;
  if (!(avgCost > 0)) return null;
  const costRemoved = avgCost * filledQty;
  const feeCost = Number(order.fee?.cost ?? 0);
  const feeCur  = (order.fee?.currency ?? "").toUpperCase();
  const fee = feeCost > 0 && STABLE_FEE.has(feeCur) ? feeCost : 0;
  const realized = proceeds - costRemoved - fee;
  return Number.isFinite(realized) ? realized : null;
}

/**
 * Settle exits armed on a PRIOR run (A5): poll each exit_armed position's
 * order; a filled exit realizes P&L (fed atomically to the loss-stop) and
 * closes the position; a canceled/expired one reopens so a later scan can
 * re-arm. Returns the run-log rows and the total realized delta.
 */
async function settleArmedExits(
  s: AutopilotSessionRow, creds: CexCredentials, exchange: CexId, today: string,
): Promise<{ rows: RunRowT[]; realizedDelta: number }> {
  const rows: RunRowT[] = [];
  let realizedDelta = 0;
  const armed = (await getOpenServerPositions(s.id)).filter((p) => p.status === "exit_armed" && p.exit_order_id);
  for (const pos of armed) {
    try {
      const order = await fetchCexOrderStatus(exchange, creds, pos.exit_order_id!, pos.pair);
      const st = order.status?.toLowerCase() ?? "";
      if (st === "closed" || st === "filled") {
        const realized = realizedFromSell(order, pos);
        if (realized !== null) {
          realizedDelta += realized;
          await applySessionPnl(s.id, realized, today);
        }
        await closeServerPosition(s.id, pos.base);
        logOperation({ walletAddress: s.wallet_address, kind: "autopilot_cex", chain: s.exchange_id, pair: pos.pair, side: "sell", volumeUsd: Number(pos.cost_usd) || null, pnlUsd: realized, status: "settled", route: "cron", ref: `${exchange}:${pos.exit_order_id}` });
        rows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: pos.pair, side: "sell", order_type: "limit", status: "settled", order_id: pos.exit_order_id, notional_usd: realized ?? null, reason: realized !== null ? `exit settled, realized $${realized.toFixed(2)}` : "exit settled" });
      } else if (st === "canceled" || st === "cancelled" || st === "expired") {
        await reopenServerPosition(s.id, pos.base);
        rows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: pos.pair, side: "sell", status: "skipped", order_id: pos.exit_order_id, reason: "armed exit canceled/expired — reopened" });
      }
      // still open → leave it armed for the next run
    } catch { /* transient — retry next run */ }
  }
  return { rows, realizedDelta };
}

/** Compact "held=… entry=… now=… unrealized=…" context so ZION proposes exits. */
function buildPositionsContext(positions: AutopilotPositionRow[], refPrices: Map<string, CexSpotPrice>): string {
  const open = positions.filter((p) => p.status !== "closed");
  if (open.length === 0) return "";
  return open.map((p) => {
    const now = refPrices.get(p.base.toUpperCase())?.priceUsd ?? null;
    const entry = Number(p.entry_price);
    const unreal = now && entry > 0 ? ((now - entry) / entry) * 100 : null;
    const armed = p.status === "exit_armed" ? "yes" : "no";
    return `  - ${p.pair} | held=${Number(p.base_amount)} | entry=$${entry} | now=${now != null ? `$${now}` : "n/a"}`
      + `${unreal != null ? ` | unrealized=${unreal >= 0 ? "+" : ""}${unreal.toFixed(2)}%` : ""}`
      + ` | exit_armed=${armed}${p.entry_label ? ` | reason='${String(p.entry_label).slice(0, 60)}'` : ""}`;
  }).join("\n");
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await setCronHeartbeat("autopilot");

  let sessions: AutopilotSessionRow[];
  try {
    sessions = await listRunnableSessions();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "session_query_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const summary: Array<{ exchange: string; wallet: string; fired: number; skipped: string }> = [];

  for (const s of sessions) {
    // A2: acquire the per-session lock so a still-running prior cron pass can't
    // double-process this session. TTL (3min) auto-releases a crashed/timed-out
    // run well before the next scheduled tick (every ~5min).
    const locked = await tryLockSession(s.id, 3 * 60_000);
    if (!locked) {
      summary.push({ exchange: s.exchange_id, wallet: `${s.wallet_address.slice(0, 6)}…`, fired: 0, skipped: "locked (already running)" });
      continue;
    }
    try {
      const result = await processSession(s);
      summary.push({
        exchange: s.exchange_id,
        wallet: `${s.wallet_address.slice(0, 6)}…`,
        fired: result.fired,
        skipped: result.note,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchSession(s.id, { last_error: msg.slice(0, 300), last_scan_at: new Date().toISOString() });
      summary.push({ exchange: s.exchange_id, wallet: `${s.wallet_address.slice(0, 6)}…`, fired: 0, skipped: `error: ${msg.slice(0, 80)}` });
    } finally {
      await releaseLock(s.id);
    }
  }

  // Platform-wide watchdog — error/security spikes, stale crons, AI budget,
  // large ops, dependency health, daily digest. Runs every tick (~5 min).
  await runAlertWatchdog();

  return NextResponse.json({ ok: true, processed: sessions.length, summary });
}

interface ProcessResult { fired: number; note: string; }

async function processSession(s: AutopilotSessionRow): Promise<ProcessResult> {
  const nowIso = new Date().toISOString();
  const today = utcDayKey();
  const wasFrozen = s.frozen_until_day === today;
  const alertIfNewlyFrozen = () => {
    if (!wasFrozen) {
      notifyTelegram(`📉 <b>Autopilot frozen</b> — daily loss-stop hit.\nwallet ${s.wallet_address.slice(0, 8)}… · ${s.exchange_id}`, { dedupKey: `freeze:${s.id}` });
    }
  };

  // ── 1. Daily rollover ──
  let tradesToday = s.trades_today;
  let frozenUntil = s.frozen_until_day;
  let pnlToday    = s.pnl_today;
  if (s.last_reset_day !== today) {
    tradesToday = 0;
    pnlToday    = 0;
    frozenUntil = frozenUntil === today ? frozenUntil : null;
    await patchSession(s.id, { trades_today: 0, pnl_today: 0, last_reset_day: today, frozen_until_day: frozenUntil });
  }

  // ── 2. Decrypt creds ──
  const creds: CexCredentials = decryptSessionCreds(s);
  const exchange = s.exchange_id as CexId;

  // ── 3. Settle exits armed on a prior run (A5). A filled exit realizes P&L
  //      (fed atomically to the loss-stop) and can trip the freeze. ──
  const runRows: RunRowT[] = [];
  try {
    const settle = await settleArmedExits(s, creds, exchange, today);
    runRows.push(...settle.rows);
    pnlToday += settle.realizedDelta;
    if (pnlToday <= -s.daily_loss_stop_usd) frozenUntil = today;
  } catch { /* settle failure must not abort the session */ }

  // ── 4. Freeze / cap gates (AFTER settling — a settle can trip the freeze) ──
  if (frozenUntil === today) {
    alertIfNewlyFrozen();
    if (runRows.length) await recordRuns(runRows);
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    return { fired: 0, note: "frozen (daily loss-stop)" };
  }
  if (tradesToday >= s.max_trades_per_day) {
    if (runRows.length) await recordRuns(runRows);
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    return { fired: 0, note: "daily trade cap reached" };
  }

  // ── 5. Read live balance ──
  let totalUsd = 0;
  let balanceContext = "";
  try {
    const { balances, totalUsd: tu } = await fetchCexBalance(exchange, creds, true);
    totalUsd = tu;
    const nonZero = balances
      .filter((b) => b.total > 0)
      .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
      .slice(0, 10);
    const parts = nonZero
      .map((b) => `${b.asset}: ${b.total}${b.usdValue ? ` (~$${b.usdValue.toFixed(2)})` : ""}`)
      .join(", ");
    balanceContext = `total: $${totalUsd.toFixed(2)} | ${parts}`;
  } catch (e) {
    if (runRows.length) await recordRuns(runRows);
    await patchSession(s.id, { last_scan_at: nowIso, last_error: `balance read failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) });
    return { fired: 0, note: "balance read failed" };
  }

  // ── 6. Bounded per-trade cap (can only shrink vs the armed cap) ──
  const pct = RISK_PCT[s.risk_mode] ?? 0.20;
  const dynamicMax = Math.max(2, Math.round(totalUsd * pct));
  const effectiveMaxTradeUsd = Math.min(dynamicMax, s.max_trade_usd);

  // ── 7. Open positions + reference prices (guard + position context + cap) ──
  const refPrices     = await getCexSpotPrices(s.allowed_symbols);
  const openPositions = await getOpenServerPositions(s.id);
  // D3 Executor: ADX trend regime per symbol — feeds the scan's context AND
  // the hard entry gate below. Fail-closed: if the fetch fails, the map stays
  // empty and every BUY is rejected (exits are never gated).
  const marketInd = await getMarketIndicators(s.allowed_symbols).catch(() => null);
  const regimeBy = new Map<string, string>();
  for (const ind of marketInd?.indicators ?? []) if (ind.regime) regimeBy.set(ind.symbol.toUpperCase(), ind.regime);
  let   exposureUsd   = openPositions.reduce((sum, p) => sum + Number(p.cost_usd || 0), 0);
  const maxExposureUsd = RISK_EXPOSURE_USD[s.risk_mode] ?? 200;
  const ownedBases    = new Set(openPositions.map((p) => p.base.toUpperCase()));

  // ── 8. Scan (with open positions so ZION proposes exits) ──
  const scan = await runAutopilotCexScan({
    exchangeId:     s.exchange_id,
    riskMode:       s.risk_mode,
    marketType:     s.market_type,
    maxTradeUsd:    effectiveMaxTradeUsd,
    allowedSymbols: s.allowed_symbols,
    balanceContext,
    openPositionsContext: buildPositionsContext(openPositions, refPrices),
    remainingTradesToday: Math.max(0, s.max_trades_per_day - tradesToday),
    regimeContext:  marketInd ? formatRegimeContext(marketInd.indicators) : "",
    lang:           s.lang,
  });

  if (scan.error) {
    if (runRows.length) await recordRuns(runRows);
    await patchSession(s.id, { last_scan_at: nowIso, last_error: `scan: ${scan.error}`.slice(0, 300) });
    await recordRuns([{ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, status: "scan_error", reason: scan.error.slice(0, 200) }]);
    return { fired: 0, note: "scan error" };
  }
  if (scan.cards.length === 0) {
    if (runRows.length) await recordRuns(runRows);
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    await recordRuns([{ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, status: "scan_empty", reason: "no actionable setup" }]);
    return { fired: 0, note: "no setup" };
  }

  // ── 9. Background firing is SPOT-ONLY (no unattended leverage) ──
  if (s.market_type !== "spot") {
    if (runRows.length) await recordRuns(runRows);
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    await recordRuns([{
      session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id,
      status: "skipped", card_kind: s.market_type,
      reason: "background mode fires spot only; futures/margin need you present",
    }]);
    return { fired: 0, note: `${s.market_type} scan-only (spot-only firing in background)` };
  }

  // ── 10. Fire eligible intents ──
  let fired = 0;
  let remainingTrades = s.max_trades_per_day - tradesToday;

  const pushRow = (intent: { symbol: string; side: string; type: string; amount: number; price?: number; notionalUsd: number }, status: string, cardKind: string, extra: Partial<AutopilotRunRow> = {}) =>
    runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: intent.notionalUsd, status, card_kind: cardKind, ...extra });

  outer:
  for (const card of scan.cards) {
    if (fired >= MAX_ORDERS_PER_RUN || remainingTrades <= 0) break;
    if (frozenUntil === today) break;             // a sell may have tripped the freeze mid-run
    const intents = mapCardToCexIntents(card);
    if (!intents) continue;

    for (const intent of intents) {
      if (fired >= MAX_ORDERS_PER_RUN || remainingTrades <= 0) break outer;
      if (frozenUntil === today) break outer;

      // A3 (money-path audit): multi-venue cards (cross-CEX arb) pin each leg
      // to a specific exchange. A background session runs ONE venue — firing a
      // pinned leg here would execute at another market's price. Skip it.
      if (intent.exchange && intent.exchange !== s.exchange_id) {
        pushRow(intent, "rejected", card.kind, { reason: `leg pinned to ${intent.exchange}; session venue is ${s.exchange_id}` });
        continue;
      }

      const base = intent.symbol.split("/")[0].toUpperCase();
      if (!s.allowed_symbols.includes(intent.symbol.split("/")[0])) {
        pushRow(intent, "rejected", card.kind, { reason: "symbol not allowed" });
        continue;
      }
      const refPrice = refPrices.get(base)?.priceUsd ?? null;
      const guard = checkRealNotional({ side: intent.side, baseAmount: intent.amount, refPrice, maxTradeUsd: effectiveMaxTradeUsd });
      if (!guard.ok) {
        pushRow(intent, "rejected", card.kind, { notional_usd: guard.realNotionalUsd ?? intent.notionalUsd, reason: guard.reason ?? "notional guard" });
        continue;
      }

      // ── SELL (A5): only sell a base the bot actually holds — never dump an
      //    unrelated user holding. Market sell settles P&L now; a limit sell
      //    is armed and settled on a later run. ──
      if (intent.side === "sell") {
        const pos = openPositions.find((p) => p.base.toUpperCase() === base);
        if (!pos || !ownedBases.has(base)) {
          pushRow(intent, "skipped", card.kind, { reason: "no open autopilot position for this base" });
          continue;
        }
        try {
          const { order } = await placeCexOrder(exchange, creds, { symbol: intent.symbol, side: "sell", type: intent.type, amount: intent.amount, price: intent.price });
          fired++; remainingTrades--;
          if (intent.type === "market") {
            const realized = realizedFromSell(order, pos);
            if (realized !== null) {
              pnlToday += realized;
              await applySessionPnl(s.id, realized, today);
              if (pnlToday <= -s.daily_loss_stop_usd) frozenUntil = today;
            }
            await closeServerPosition(s.id, pos.base);
            ownedBases.delete(base);
            exposureUsd = Math.max(0, exposureUsd - Number(pos.cost_usd || 0));
            logOperation({ walletAddress: s.wallet_address, kind: "autopilot_cex", chain: s.exchange_id, pair: intent.symbol, side: "sell", volumeUsd: Number(pos.cost_usd) || null, pnlUsd: realized, status: "filled", route: "cron", ref: `${exchange}:${order.id}` });
            pushRow(intent, "fired", card.kind, { order_id: order.id, notional_usd: realized ?? intent.notionalUsd, reason: realized !== null ? `exit filled, realized $${realized.toFixed(2)}` : "exit filled" });
          } else {
            await markServerExitArmed(s.id, pos.base, order.id);
            pushRow(intent, "fired", card.kind, { order_id: order.id, reason: "exit armed (limit)" });
          }
        } catch (e) {
          pushRow(intent, "errored", card.kind, { reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        }
        continue;
      }

      // ── BUY: D3 trend gate FIRST — entries only WITH a confirmed uptrend
      //    (evidence: with-trend won 70-92% in bull AND bear windows; the
      //    model's own confidence is inverted). Fail-closed: no regime data =
      //    no entry. Exits (sells) are never gated. ──
      const regime = regimeBy.get(base) ?? null;
      if (!trendGate("buy", regime)) {
        pushRow(intent, "rejected", card.kind, { reason: `trend gate: regime ${regime ?? "unavailable"} (entries need TRENDING_UP)` });
        continue;
      }

      // ── then the total-exposure cap (A4 server side), fire, and record the
      //    entry server-side (A5). ──
      const buyNotional = guard.realNotionalUsd ?? intent.notionalUsd;
      if (exposureUsd + buyNotional > maxExposureUsd) {
        pushRow(intent, "rejected", card.kind, { reason: `total exposure cap $${maxExposureUsd} would be exceeded` });
        continue;
      }
      try {
        const { order } = await placeCexOrder(exchange, creds, { symbol: intent.symbol, side: "buy", type: intent.type, amount: intent.amount, price: intent.price });
        fired++; remainingTrades--;
        // Record the entry with REAL fill data (fall back to the limit price).
        const fillPrice = Number(order.average) > 0 ? Number(order.average) : (intent.price && intent.price > 0 ? intent.price : (refPrice ?? 0));
        const filledQty = Number(order.filled)  > 0 ? Number(order.filled)  : intent.amount;
        const spentUsd  = Number(order.cost)    > 0 ? Number(order.cost)    : (fillPrice > 0 ? fillPrice * filledQty : buyNotional);
        if (fillPrice > 0 && filledQty > 0) {
          await recordServerEntry({
            sessionId: s.id, walletAddress: s.wallet_address, exchangeId: s.exchange_id,
            pair: intent.symbol, entryPrice: fillPrice, baseAmount: filledQty, costUsd: spentUsd,
            reasoning: card.summary?.slice(0, 300), entryLabel: card.title?.slice(0, 80),
          });
          exposureUsd += spentUsd;
          ownedBases.add(base);
        }
        logOperation({ walletAddress: s.wallet_address, kind: "autopilot_cex", chain: s.exchange_id, pair: intent.symbol, side: "buy", volumeUsd: buyNotional, pnlUsd: null, status: "fired", route: "cron", ref: `${exchange}:${order.id}` });
        pushRow(intent, "fired", card.kind, { order_id: order.id, notional_usd: buyNotional });
      } catch (e) {
        pushRow(intent, "errored", card.kind, { reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      }
    }
  }

  if (frozenUntil === today) alertIfNewlyFrozen(); // a sell may have tripped it mid-run
  await recordRuns(runRows);
  // A4 (money-path audit): bump the daily counter RELATIVELY via the same
  // atomic RPC the browser uses. An absolute write here would overwrite (and
  // lose) any browser fire that landed while this run was in flight.
  if (fired > 0) await bumpSessionTrades(s.wallet_address, s.exchange_id, fired);
  await patchSession(s.id, {
    last_scan_at: nowIso,
    last_error:   null,
  });

  return { fired, note: fired > 0 ? `fired ${fired}` : "nothing eligible" };
}
