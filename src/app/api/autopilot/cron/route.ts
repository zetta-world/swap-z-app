import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  listRunnableSessions, decryptSessionCreds, patchSession, recordRuns, utcDayKey,
} from "@/lib/autopilot/sessions";
import { runAutopilotCexScan } from "@/lib/autopilot/scan";
import { mapCardToCexIntents } from "@/lib/zion/card-mapping";
import { fetchCexBalance, placeCexOrder } from "@/lib/cex/server";
import { getCexSpotPrices } from "@/lib/api/cex-spot";
import { checkRealNotional } from "@/lib/autopilot/price-guard";
import type { AutopilotSessionRow, AutopilotRunRow } from "@/lib/supabase/types";
import type { CexId, CexCredentials } from "@/lib/cex/types";

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
    }
  }

  return NextResponse.json({ ok: true, processed: sessions.length, summary });
}

interface ProcessResult { fired: number; note: string; }

async function processSession(s: AutopilotSessionRow): Promise<ProcessResult> {
  const nowIso = new Date().toISOString();
  const today = utcDayKey();

  // ── 1. Daily rollover ──
  let tradesToday = s.trades_today;
  let frozenUntil = s.frozen_until_day;
  if (s.last_reset_day !== today) {
    tradesToday = 0;
    frozenUntil = frozenUntil === today ? frozenUntil : null;
    await patchSession(s.id, { trades_today: 0, pnl_today: 0, last_reset_day: today, frozen_until_day: frozenUntil });
  }

  // ── 2. Freeze / cap gates ──
  if (frozenUntil === today) {
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    return { fired: 0, note: "frozen (daily loss-stop)" };
  }
  if (tradesToday >= s.max_trades_per_day) {
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    return { fired: 0, note: "daily trade cap reached" };
  }

  // ── 3. Decrypt creds + read live balance ──
  const creds: CexCredentials = decryptSessionCreds(s);
  const exchange = s.exchange_id as CexId;

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
    await patchSession(s.id, { last_scan_at: nowIso, last_error: `balance read failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) });
    return { fired: 0, note: "balance read failed" };
  }

  // ── 4. Recompute a BOUNDED per-trade cap from live balance ──
  // Can only shrink relative to what the user armed (never grow) — a safety
  // bias so a balance spike can't enlarge autonomous order sizes.
  const pct = RISK_PCT[s.risk_mode] ?? 0.20;
  const dynamicMax = Math.max(2, Math.round(totalUsd * pct));
  const effectiveMaxTradeUsd = Math.min(dynamicMax, s.max_trade_usd);

  // ── 5. Scan ──
  const scan = await runAutopilotCexScan({
    exchangeId:     s.exchange_id,
    riskMode:       s.risk_mode,
    marketType:     s.market_type,
    maxTradeUsd:    effectiveMaxTradeUsd,
    allowedSymbols: s.allowed_symbols,
    balanceContext,
    lang:           s.lang,
  });

  if (scan.error) {
    await patchSession(s.id, { last_scan_at: nowIso, last_error: `scan: ${scan.error}`.slice(0, 300) });
    await recordRuns([{ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, status: "scan_error", reason: scan.error.slice(0, 200) }]);
    return { fired: 0, note: "scan error" };
  }
  if (scan.cards.length === 0) {
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    await recordRuns([{ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, status: "scan_empty", reason: "no actionable setup" }]);
    return { fired: 0, note: "no setup" };
  }

  // ── 6. Background firing is SPOT-ONLY ──
  // Autonomous leverage while the user is away can liquidate the whole margin
  // with no one watching the countdown. Futures/margin sessions still scan
  // (so the user sees the thesis in the run log) but we don't auto-fire them.
  if (s.market_type !== "spot") {
    await patchSession(s.id, { last_scan_at: nowIso, last_error: null });
    await recordRuns([{
      session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id,
      status: "skipped", card_kind: s.market_type,
      reason: "background mode fires spot only; futures/margin need you present",
    }]);
    return { fired: 0, note: `${s.market_type} scan-only (spot-only firing in background)` };
  }

  // ── 7. Fire eligible intents ──
  // Fresh reference prices for the real-notional guard (C1/C4). The intent's
  // own notional came from LLM text and can't be the cap basis; we recompute
  // baseAmount × referencePrice and reject oversized buys.
  const refPrices = await getCexSpotPrices(s.allowed_symbols);
  const runRows: Array<Partial<AutopilotRunRow> & { wallet_address: string; exchange_id: string; status: string }> = [];
  let fired = 0;
  let remainingTrades = s.max_trades_per_day - tradesToday;

  outer:
  for (const card of scan.cards) {
    if (fired >= MAX_ORDERS_PER_RUN || remainingTrades <= 0) break;
    const intents = mapCardToCexIntents(card);
    if (!intents) continue;

    for (const intent of intents) {
      if (fired >= MAX_ORDERS_PER_RUN || remainingTrades <= 0) break outer;

      const base = intent.symbol.split("/")[0];
      // Cap + whitelist re-checks at fire time (defensive — the scan should
      // already respect these, but never trust the model with real money).
      if (!s.allowed_symbols.includes(base)) {
        runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: intent.notionalUsd, status: "rejected", card_kind: card.kind, reason: "symbol not allowed" });
        continue;
      }
      // Real-price notional guard (C1/C4): recompute notional from a fresh
      // reference price instead of trusting the LLM-supplied number, and
      // reject oversized buys / anything over the hard ceiling / unpriceable.
      const refPrice = refPrices.get(base.toUpperCase())?.priceUsd ?? null;
      const guard = checkRealNotional({ side: intent.side, baseAmount: intent.amount, refPrice, maxTradeUsd: effectiveMaxTradeUsd });
      if (!guard.ok) {
        runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: guard.realNotionalUsd ?? intent.notionalUsd, status: "rejected", card_kind: card.kind, reason: guard.reason ?? "notional guard" });
        continue;
      }
      // Background fires only BUYS — never an unattended market/limit SELL of
      // a holding the user may not intend to part with. Sells/stops are left
      // for the in-browser pilot where the user sees the countdown.
      if (intent.side !== "buy") {
        runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: intent.notionalUsd, status: "skipped", card_kind: card.kind, reason: "background fires buys only" });
        continue;
      }

      try {
        const { order } = await placeCexOrder(exchange, creds, {
          symbol: intent.symbol,
          side:   intent.side,
          type:   intent.type,
          amount: intent.amount,
          price:  intent.price,
        });
        fired++;
        remainingTrades--;
        runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: intent.notionalUsd, status: "fired", order_id: order.id, card_kind: card.kind });
      } catch (e) {
        runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: intent.notionalUsd, status: "errored", card_kind: card.kind, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      }
    }
  }

  await recordRuns(runRows);
  await patchSession(s.id, {
    trades_today: tradesToday + fired,
    last_scan_at: nowIso,
    last_error:   null,
  });

  return { fired, note: fired > 0 ? `fired ${fired}` : "nothing eligible" };
}
