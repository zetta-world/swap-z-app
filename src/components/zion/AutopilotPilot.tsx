"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ActionCard } from "@/lib/zion/parse";
import { useAutopilot } from "@/lib/store/autopilot";
import { useCexVault } from "@/lib/cex/vault";
import { useTxHistory } from "@/lib/store/txHistory";
import { useAutopilotPositions } from "@/lib/store/autopilotPositions";
import {
  mapCardToCexIntents, pickExchangeForIntent, fireAutopilotIntent,
  pollOrderUntilSettled,
  type AutopilotIntent,
} from "@/lib/zion/autopilot-bridge";
import type { CexId, CexOrder, CexCredentials } from "@/lib/cex/types";
import { cn } from "@/lib/cn";

/**
 * The autopilot "pilot" — a single banner above the ZION action cards
 * that watches the card stream, picks the next CEX-mappable card that
 * passes every rail, runs a countdown the user can cancel, and fires
 * the trade(s) through /api/cex/order when the countdown expires.
 *
 * A single card can produce one OR two intents:
 *   - One leg  → swap, buy_limit, sell_*, arbitrage_dex_cex (CEX side).
 *   - Two legs → arbitrage_cross_cex (BUY on cheap venue + SELL on
 *                expensive venue, atomic — both legs fire in parallel
 *                so price moves between them can't open one-sided
 *                directional risk).
 *
 * Why one banner instead of one per card: pros expect a clear single
 * "next action" they can intercept. Showing 5 simultaneous countdowns
 * is anxiety-inducing and easy to misclick.
 *
 * Cards are processed in the order ZION emitted them; once a card is
 * fired OR canceled it's added to the "consumed" set so the same card
 * never repeats. Re-running an analysis (new card list) resets state.
 */
export default function AutopilotPilot({ cards }: { cards: ActionCard[] }) {
  const a = useAutopilot();
  const vault = useCexVault();
  const { push: pushTxHistory } = useTxHistory();
  const recordEntry   = useAutopilotPositions((s) => s.recordEntry);
  const markExitArmed = useAutopilotPositions((s) => s.markExitArmed);
  const enabled = a.enabled;

  const consumedRef = useRef<Set<string>>(new Set());
  // Re-entrancy guard. setPhase is async, so two rapid effect runs (React
  // StrictMode double-invoke, a parent re-render landing on the same
  // expired countdown) could both call fire() before phase flips to
  // "firing". This ref flips synchronously and blocks the second call —
  // without it the same order could be sent to the exchange twice.
  const firingRef = useRef(false);
  const [activeIntent, setActiveIntent] = useState<{
    cardKey:   string;
    card:      ActionCard;
    intents:   AutopilotIntent[];  // 1 for single, 2 for cross-CEX
    expiresAt: number;
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "firing" | "done" | "errored">("idle");
  const [error, setError] = useState<string | null>(null);

  // Roll the daily counter on first interaction so the rails are accurate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { a.rolloverIfNewDay(); }, []);

  // Pick the next card to act on whenever the deck changes.
  const nextCandidate = useMemo(() => {
    if (!enabled || a.frozenUntilDay) return null;
    // The daily cap counts LEGS not cards — a cross-CEX card costs 2
    // toward the cap. Reject the candidate if it would push us over.
    for (const c of cards) {
      const key = `${c.kind}:${c.title ?? ""}:${c.from?.symbol ?? ""}>${c.to?.symbol ?? ""}`;
      if (!key || key.length < 4) continue;
      if (consumedRef.current.has(key)) continue;
      const intents = mapCardToCexIntents(c);
      if (!intents || intents.length === 0) continue;
      if (a.tradesToday + intents.length > a.maxTradesPerDay) continue;
      // Every leg has to clear the per-trade USD cap independently.
      if (intents.some((i) => i.notionalUsd > a.maxTradeUsd)) continue;
      // Every leg's base must be in the symbol whitelist.
      if (intents.some((i) => !a.allowedSymbols.includes(i.symbol.split("/")[0]))) continue;
      // Vault must be unlocked AND every leg's exchange must be
      // reachable (pinned for cross-CEX, picker for single-CEX).
      const live = vault.getActive();
      if (!live) continue;
      const allExchangesReady = intents.every((i) => {
        const ex = i.exchange ?? pickExchangeForIntent(a.allowedExchanges, live);
        if (!ex) return false;
        if (!a.allowedExchanges.includes(ex)) return false;
        if (!live[ex]) return false;
        return true;
      });
      if (!allExchangesReady) continue;
      return { key, card: c, intents };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, enabled, a.frozenUntilDay, a.tradesToday, a.maxTradesPerDay, a.maxTradeUsd, a.allowedSymbols, a.allowedExchanges, vault.creds]);

  // Bring the next candidate into the active slot when we're idle.
  useEffect(() => {
    if (phase !== "idle" || !nextCandidate) return;
    setActiveIntent({
      cardKey:   nextCandidate.key,
      card:      nextCandidate.card,
      intents:   nextCandidate.intents,
      expiresAt: Date.now() + a.countdownMs,
    });
    setPhase("countdown");
    setError(null);
  }, [phase, nextCandidate, a.countdownMs]);

  // Countdown timer.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== "countdown") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Fire when the countdown elapses.
  useEffect(() => {
    if (phase !== "countdown" || !activeIntent) return;
    if (now < activeIntent.expiresAt) return;
    void fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, activeIntent]);

  const cancel = () => {
    if (!activeIntent) return;
    consumedRef.current.add(activeIntent.cardKey);
    for (const intent of activeIntent.intents) {
      a.pushHistory({
        ts: Date.now(),
        exchange:  intent.exchange ?? "binance",
        symbol:    intent.symbol, side: intent.side, type: intent.type,
        amount:    intent.amount, price: intent.price,
        status:    "canceled",
        cardKind:  activeIntent.card.kind,
        cardTitle: activeIntent.card.title.slice(0, 80),
        reason:    "user canceled during countdown",
      });
    }
    setActiveIntent(null);
    setPhase("idle");
  };

  const fire = async () => {
    if (!activeIntent) return;
    if (firingRef.current) return;
    firingRef.current = true;

    const intents = activeIntent.intents;
    const cardKey = activeIntent.cardKey;
    const card    = activeIntent.card;

    const rejectAll = (reason: string, status: "rejected" | "errored" = "rejected") => {
      consumedRef.current.add(cardKey);
      for (const intent of intents) {
        a.pushHistory({
          ts: Date.now(),
          exchange:  intent.exchange ?? "binance",
          symbol:    intent.symbol, side: intent.side, type: intent.type,
          amount:    intent.amount, price: intent.price,
          status, cardKind: card.kind, cardTitle: card.title.slice(0, 80), reason,
        });
      }
      setActiveIntent(null);
      setPhase("idle");
      firingRef.current = false;
    };

    setPhase("firing");

    // ── Re-validate EVERY rail at fire time using FRESH store state ──
    // The countdown is a window in which the user could have tightened
    // a cap, the daily counter could have rolled, the vault could have
    // locked, or the loss-stop could have frozen autopilot. Select-time
    // check isn't enough; re-check against getState().
    const live = vault.getActive();
    if (!live) {
      rejectAll("vault re-locked before fire");
      toast.error("Autopilot: vault re-locked. Unlock to resume.");
      return;
    }
    useAutopilot.getState().rolloverIfNewDay();
    const fresh = useAutopilot.getState();
    if (!fresh.enabled)                                          return rejectAll("autopilot turned off during countdown");
    if (fresh.frozenUntilDay)                                    return rejectAll("autopilot frozen (daily stop)");
    if (fresh.tradesToday + intents.length > fresh.maxTradesPerDay)
                                                                 return rejectAll("daily trade cap would be exceeded");
    // Per-trade USD cap applies to BUYS only. A SELL reduces exposure (it's
    // exiting a position the user already holds) — capping it would block
    // legitimate take-profit exits whose notional naturally exceeds the
    // buy-side cap once the position has grown.
    if (intents.some((i) => i.side === "buy" && i.notionalUsd > fresh.maxTradeUsd))
                                                                 return rejectAll("exceeds per-trade cap (changed during countdown)");
    if (intents.some((i) => !fresh.allowedSymbols.includes(i.symbol.split("/")[0])))
                                                                 return rejectAll("symbol no longer allowed");

    // Resolve each leg's exchange (pinned for cross-CEX, picker otherwise).
    const resolved: { exchange: CexId; intent: AutopilotIntent }[] = [];
    for (const intent of intents) {
      const ex = intent.exchange ?? pickExchangeForIntent(fresh.allowedExchanges, live);
      if (!ex || !fresh.allowedExchanges.includes(ex) || !live[ex]) {
        return rejectAll(`exchange ${intent.exchange ?? "auto"} not connected/allowed`);
      }
      resolved.push({ exchange: ex, intent });
    }

    // ── Fire legs ──
    // Strategy depends on the card kind:
    //   * arbitrage_triangular → SEQUENTIAL. Leg N+1's amount was sized
    //     off leg N's expected fill, and the cycle is meaningless if a
    //     middle leg fails (no way to close it from the next leg). On
    //     any leg's failure we abort — remaining legs are NOT fired and
    //     show up as "skipped" in history so the user can see the
    //     partial position they need to unwind.
    //   * everything else (single-leg, cross-CEX) → PARALLEL. For
    //     cross-CEX in particular, parallel minimizes the price drift
    //     window between the two legs.
    const isTriangular = card.kind === "arbitrage_triangular";
    type LegResult = { status: "fulfilled"; value: CexOrder } | { status: "rejected"; reason: unknown } | { status: "skipped" };
    let results: LegResult[];
    if (isTriangular) {
      results = [];
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        try {
          const order = await fireAutopilotIntent(r.exchange, live[r.exchange]!, r.intent);
          results.push({ status: "fulfilled", value: order });
          // Between legs of a triangular, give the exchange a moment
          // to settle and the user's balance to reflect the new asset
          // before the next leg's "insufficient balance" check runs.
          if (i < resolved.length - 1) {
            await new Promise((res) => setTimeout(res, 1_500));
          }
        } catch (err) {
          results.push({ status: "rejected", reason: err });
          // Skip remaining legs — they would either fail with
          // "insufficient balance" or compound the partial position.
          for (let j = i + 1; j < resolved.length; j++) {
            results.push({ status: "skipped" });
          }
          break;
        }
      }
    } else {
      const settled = await Promise.allSettled(
        resolved.map((r) => fireAutopilotIntent(r.exchange, live[r.exchange]!, r.intent)),
      );
      results = settled.map((s) => s.status === "fulfilled"
        ? { status: "fulfilled", value: s.value }
        : { status: "rejected", reason: s.reason });
    }

    let allOk = true;
    const summaries: string[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const { exchange, intent } = resolved[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        a.recordTrade(intent.notionalUsd);
        a.pushHistory({
          ts: Date.now(), exchange,
          symbol: intent.symbol, side: intent.side, type: intent.type,
          amount: intent.amount, price: intent.price,
          status: "fired", orderId: result.value.id,
          cardKind: card.kind, cardTitle: card.title.slice(0, 80),
        });
        const [baseSymbol, quoteSymbol] = intent.symbol.split("/");
        pushTxHistory({
          type: "autopilot_cex",
          status: "confirmed",
          fromSymbol: intent.side === "buy" ? (quoteSymbol ?? "USDT") : (baseSymbol ?? intent.symbol),
          fromChain: exchange,
          fromAmount: intent.side === "buy"
            ? String((intent.notionalUsd).toFixed(6))
            : String(intent.amount),
          toSymbol: intent.side === "buy" ? (baseSymbol ?? intent.symbol) : (quoteSymbol ?? "USDT"),
          toChain: exchange,
          exchange,
          orderId: result.value.id,
          route: intent.type,
          notes: card.title.slice(0, 80),
          valueUsd: intent.notionalUsd,
        });
        // ── Position memory ──
        // A BUY opens a position we must later exit — remember it (price +
        // ZION's reasoning) so the next scan can arm a profitable sell even
        // after a disconnect. A SELL that matches an open position flags it
        // as exited so we stop proposing more exits for it.
        if (intent.side === "buy" && intent.price && intent.price > 0) {
          recordEntry({
            exchange,
            pair:       intent.symbol,
            entryPrice: intent.price,
            baseAmount: intent.amount,
            costUsd:    intent.notionalUsd,
            reasoning:  (card.summary ?? "").slice(0, 300),
            entryLabel: card.title.slice(0, 80),
          });
        } else if (intent.side === "sell") {
          markExitArmed(exchange, baseSymbol ?? intent.symbol.split("/")[0], result.value.id);
        }
        summaries.push(`${intent.side.toUpperCase()} ${intent.symbol} → ${exchange} ✓`);
      } else if (result.status === "skipped") {
        // Earlier leg failed; this one was never sent. Log as canceled
        // so the user can see the cycle aborted at the right spot.
        allOk = false;
        a.pushHistory({
          ts: Date.now(), exchange,
          symbol: intent.symbol, side: intent.side, type: intent.type,
          amount: intent.amount, price: intent.price,
          status: "canceled", cardKind: card.kind, cardTitle: card.title.slice(0, 80),
          reason: "triangular cycle aborted on earlier-leg failure",
        });
        summaries.push(`${intent.side.toUpperCase()} ${intent.symbol} → ${exchange} ⊘ skipped`);
      } else {
        allOk = false;
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        a.pushHistory({
          ts: Date.now(), exchange,
          symbol: intent.symbol, side: intent.side, type: intent.type,
          amount: intent.amount, price: intent.price,
          status: "errored", cardKind: card.kind, cardTitle: card.title.slice(0, 80), reason: msg,
        });
        summaries.push(`${intent.side.toUpperCase()} ${intent.symbol} → ${exchange} ✗ ${msg.slice(0, 60)}`);
      }
    }

    consumedRef.current.add(cardKey);

    if (allOk) {
      toast.success(`Autopilot fired ${intents.length === 1 ? "order" : "BOTH legs"}: ${summaries.join(" | ")}`);
      setPhase("done");
      setTimeout(() => { setActiveIntent(null); setPhase("idle"); firingRef.current = false; }, 2500);

      // ── Loss-stop activation ──
      // Cross-CEX arb and arbitrage_triangular both have closed-form
      // realized PnL once every leg settles: spread captured minus fees.
      // Single-leg cards (swap / buy_limit / sell_*) leave an open
      // position so we can't know realized PnL without tracking it to
      // close; we don't pretend. For the two arb kinds, kick off a
      // background poll — when fills settle, compute PnL and feed it
      // to the store, which trips the daily loss-stop if cumulative
      // loss crosses the threshold.
      if (intents.length === 2 && card.kind === "arbitrage_cross_cex") {
        const fulfilled: Array<{ orderId: string; leg: { exchange: CexId; intent: AutopilotIntent } }> = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") {
            fulfilled.push({ orderId: r.value.id, leg: resolved[i] });
          }
        }
        if (fulfilled.length === 2) {
          void settleCrossCexAndRecordPnl(fulfilled, live, a.recordPnl);
        }
      } else if (intents.length === 3 && card.kind === "arbitrage_triangular") {
        const fulfilled: Array<{ orderId: string; leg: { exchange: CexId; intent: AutopilotIntent } }> = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") {
            fulfilled.push({ orderId: r.value.id, leg: resolved[i] });
          }
        }
        if (fulfilled.length === 3) {
          void settleTriangularAndRecordPnl(fulfilled, live, a.recordPnl);
        }
      }
    } else if (intents.length > 1 && summaries.some((s) => s.includes("✓"))) {
      // Partial fill on a multi-leg arb is the worst case — directional
      // risk on whatever leg(s) filled. Surface loudly so the user goes
      // to close the orphan position manually. Wording adapts to the
      // card kind so the user knows it's a triangular partial (one mid
      // currency stranded) vs cross-CEX (one venue holds opposite side).
      const noun = card.kind === "arbitrage_triangular"
        ? "triangular cycle partial — stranded mid-cycle asset"
        : "PARTIAL FILL — one leg failed";
      const errMsg = `${noun}: ${summaries.join(" | ")}. Close the open position manually on the exchange.`;
      setError(errMsg);
      setPhase("errored");
      toast.error(errMsg, { duration: 12_000 });
      setTimeout(() => { setActiveIntent(null); setPhase("idle"); setError(null); firingRef.current = false; }, 8000);
    } else {
      const errMsg = summaries.join(" | ");
      setError(errMsg);
      setPhase("errored");
      toast.error(`Autopilot rejected: ${errMsg.slice(0, 160)}`);
      setTimeout(() => { setActiveIntent(null); setPhase("idle"); setError(null); firingRef.current = false; }, 4000);
    }
  };

  // Nothing to show when autopilot is OFF or there's no candidate cooking.
  if (!enabled || !activeIntent) return null;

  const remaining  = Math.max(0, activeIntent.expiresAt - now);
  const remainingS = Math.ceil(remaining / 1000);
  const progress   = Math.max(0, Math.min(1, 1 - remaining / a.countdownMs));
  const legCount   = activeIntent.intents.length;
  const isPair     = legCount > 1;
  const isTri      = legCount === 3 && activeIntent.card.kind === "arbitrage_triangular";
  const legNoun    = isTri ? "3 legs sequentially" : isPair ? "2 legs in parallel" : "order";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{    opacity: 0, y: -4 }}
        className={cn(
          "rounded-lg border p-3 space-y-2 mb-2",
          phase === "errored"
            ? "border-red/30 bg-red/[0.05]"
            : phase === "done"
              ? "border-green/30 bg-green/[0.05]"
              : isPair
                ? "border-green/40 bg-green/[0.06]"
                : "border-gold/30 bg-gold/[0.05]",
        )}
      >
        <div className="flex items-center gap-2">
          <Bot className={cn(
            "w-3.5 h-3.5 flex-shrink-0",
            phase === "errored" ? "text-red" : phase === "done" ? "text-green" : isPair ? "text-green" : "text-gold",
          )} />
          <span className={cn(
            "font-mono text-[10px] tracking-widest uppercase font-bold flex-1 min-w-0",
            phase === "errored" ? "text-red" : phase === "done" ? "text-green" : isPair ? "text-green" : "text-gold",
          )}>
            {phase === "errored" ? "Autopilot rejected"
              : phase === "done"  ? `Autopilot fired ${isTri ? "(3 legs)" : isPair ? "(2 legs)" : ""}`
              : phase === "firing" ? `Sending ${legNoun}…`
                                    : `Autopilot will fire${isTri ? " 3 legs" : isPair ? " 2 legs" : ""}`}
          </span>
          {phase === "countdown" && (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/15 bg-white/[0.04] font-mono text-[10px] tracking-widest uppercase text-ink-3 hover:bg-white/[0.08]"
            >
              <X className="w-2.5 h-2.5" />
              Cancel
            </button>
          )}
          {phase === "firing" && <Loader2 className="w-3.5 h-3.5 text-gold animate-spin" />}
          {phase === "done"   && <CheckCircle2 className="w-3.5 h-3.5 text-green" />}
          {phase === "errored" && <AlertTriangle className="w-3.5 h-3.5 text-red" />}
        </div>

        {/* Per-leg summary */}
        {activeIntent.intents.map((intent, i) => (
          <div key={i} className="font-mono text-[11px] text-ink tabular-nums">
            <span className={intent.side === "buy" ? "text-green" : "text-red"}>
              {intent.side.toUpperCase()}
            </span>
            {" "}
            <span className="text-ink">{intent.symbol}</span>
            {intent.exchange && <> <span className="text-ink-3">@ {intent.exchange}</span></>}
            {" · "}
            <span className="text-ink-2">{formatBase(intent.amount)} base</span>
            {intent.type === "limit" && intent.price && (
              <> · <span className="text-ink-2">@${intent.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span></>
            )}
            {" · "}
            <span className="text-ink-3">~${intent.notionalUsd.toFixed(2)}</span>
          </div>
        ))}

        {/* Countdown bar */}
        {phase === "countdown" && (
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gold transition-[width] duration-200 linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              {remainingS}s · click cancel to skip this one
            </div>
          </div>
        )}

        {error && (
          <div className="font-mono text-[10px] text-red/80 break-words">{error}</div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function formatBase(n: number): string {
  if (n >= 1)     return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (n >= 0.001) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return n.toExponential(2);
}

// ─── Cross-CEX realized-PnL settler ──────────────────────────────────────
//
// Fires after both arb legs were accepted by their exchanges. Polls each
// order until it reaches a terminal status, then computes PnL as:
//
//     pnl = (sell_avg_fill - buy_avg_fill) * filled_base
//           - fee_buy - fee_sell
//
// Skips PnL when either leg failed to fill (gets canceled / expires) —
// in that case the position is asymmetric and the user has to close
// the orphan leg manually. We deliberately don't auto-reverse.
async function settleCrossCexAndRecordPnl(
  arb: Array<{
    orderId: string;
    leg:     { exchange: CexId; intent: AutopilotIntent };
  }>,
  vault: Partial<Record<CexId, CexCredentials>>,
  recordPnl: (deltaUsd: number) => void,
): Promise<void> {
  try {
    const settled = await Promise.allSettled(arb.map((x) =>
      pollOrderUntilSettled(
        x.leg.exchange,
        vault[x.leg.exchange]!,
        x.orderId,
        x.leg.intent.symbol,
      ),
    ));
    // Any non-fulfilled poll → can't compute; skip silently.
    const fulfilledOrders: CexOrder[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") fulfilledOrders.push(s.value);
    }
    if (fulfilledOrders.length !== settled.length) return;

    const orders = fulfilledOrders;
    const buyIdx  = arb.findIndex((x) => x.leg.intent.side === "buy");
    const sellIdx = arb.findIndex((x) => x.leg.intent.side === "sell");
    if (buyIdx < 0 || sellIdx < 0) return;

    const buyOrder  = orders[buyIdx];
    const sellOrder = orders[sellIdx];
    const buyStatus  = buyOrder.status?.toLowerCase()  ?? "";
    const sellStatus = sellOrder.status?.toLowerCase() ?? "";
    const bothFilled = (buyStatus === "closed" || buyStatus === "filled")
                    && (sellStatus === "closed" || sellStatus === "filled");
    if (!bothFilled) return;          // orphan leg — user must close manually

    // Use the smaller filled base so we don't compute PnL on imaginary
    // size. In practice both should be equal (same limit qty on both
    // legs of an arb) but defensively cap to the lower number.
    const filledBase = Math.min(
      Number(buyOrder.filled  ?? 0),
      Number(sellOrder.filled ?? 0),
    );
    if (!(filledBase > 0)) return;

    const buyAvg  = Number(buyOrder.average  ?? 0);
    const sellAvg = Number(sellOrder.average ?? 0);
    if (!(buyAvg > 0) || !(sellAvg > 0)) return;

    const grossPnl = (sellAvg - buyAvg) * filledBase;
    const feeBuy   = Number(buyOrder.fee?.cost  ?? 0);
    const feeSell  = Number(sellOrder.fee?.cost ?? 0);
    const netPnl   = grossPnl - feeBuy - feeSell;
    if (!Number.isFinite(netPnl)) return;

    recordPnl(netPnl);
    if (netPnl < 0) {
      toast.error(`Autopilot arb settled at ${netPnl.toFixed(2)} USD (counts toward daily loss-stop)`, { duration: 8000 });
    } else {
      toast.success(`Autopilot arb settled at +${netPnl.toFixed(2)} USD net`, { duration: 6000 });
    }
  } catch (err) {
    // Don't surface poll-loop errors to the user — the orders themselves
    // already either succeeded (logged in history) or didn't (already
    // shown as errored). A failed PnL computation is a missing
    // accounting line, not a user-actionable event.
    console.warn("[autopilot] settle failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Triangular realized-PnL settler ─────────────────────────────────────
//
// Fires after all 3 legs of a single-CEX triangular cycle were accepted.
// Polls each order until terminal status, then accumulates a per-currency
// balance delta and converts the residual to USD.
//
// Cycle invariant: in a perfect close (USDT → BTC → ETH → USDT) every
// non-seed currency nets to ~0 and the seed currency's delta IS the PnL.
// In practice fees and slippage leak across multiple currencies, so we
// convert every non-zero delta to USD via a rough price reference (the
// limit prices ZION carried on the card) and sum.
//
// Rough by design — we don't pretend to mark-to-market exactly. The
// loss-stop only needs directionally correct USD signals to do its job.
async function settleTriangularAndRecordPnl(
  arb: Array<{
    orderId: string;
    leg:     { exchange: CexId; intent: AutopilotIntent };
  }>,
  vault: Partial<Record<CexId, CexCredentials>>,
  recordPnl: (deltaUsd: number) => void,
): Promise<void> {
  try {
    const settled = await Promise.allSettled(arb.map((x) =>
      pollOrderUntilSettled(
        x.leg.exchange,
        vault[x.leg.exchange]!,
        x.orderId,
        x.leg.intent.symbol,
      ),
    ));
    const orders: CexOrder[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") orders.push(s.value);
    }
    if (orders.length !== 3) return;
    if (orders.some((o) => {
      const s = o.status?.toLowerCase() ?? "";
      return s !== "closed" && s !== "filled";
    })) return; // any leg short-filled → orphan, skip recording

    // Per-currency balance delta in NATIVE units (BTC, USDT, …).
    const delta = new Map<string, number>();
    const bump  = (cur: string, x: number) => {
      if (!cur) return;
      const k = cur.toUpperCase();
      delta.set(k, (delta.get(k) ?? 0) + x);
    };

    // Approximate USD price index built from the limit prices on the
    // card itself, plus 1:1 for stable quotes. Good enough for the
    // residual-conversion step.
    const usdRef = new Map<string, number>();
    usdRef.set("USDT", 1); usdRef.set("USDC", 1); usdRef.set("BUSD", 1);
    usdRef.set("FDUSD", 1); usdRef.set("DAI", 1); usdRef.set("TUSD", 1); usdRef.set("USD", 1);
    for (let i = 0; i < arb.length; i++) {
      const intent = arb[i].leg.intent;
      const [base, quote] = intent.symbol.split("/");
      const price = intent.price ?? Number(orders[i].average ?? 0);
      if (price && Number.isFinite(price)) {
        // base price in quote-asset units. If quote is a stable that's
        // pinned to 1 USD, the base's USD price is just `price`.
        const quoteUsd = usdRef.get(quote.toUpperCase());
        if (quoteUsd) usdRef.set(base.toUpperCase(), price * quoteUsd);
      }
    }

    for (let i = 0; i < arb.length; i++) {
      const order  = orders[i];
      const intent = arb[i].leg.intent;
      const [base, quote] = intent.symbol.split("/");
      const filled = Number(order.filled ?? 0);
      // ccxt order.cost is the QUOTE-amount value of the fill
      // (filled × avgPrice). Falls back to amount × avgPrice when
      // missing (some exchanges omit it on partial fills).
      const cost = Number(order.cost ?? 0) || filled * Number(order.average ?? intent.price ?? 0);
      if (!(filled > 0) || !(cost > 0)) return;     // can't compute reliably
      if (intent.side === "buy") {
        bump(base,  +filled);
        bump(quote, -cost);
      } else {
        bump(base,  -filled);
        bump(quote, +cost);
      }
      // Fees are usually denominated in whichever currency the user
      // received (base on buys, quote on sells). ccxt reports it as
      // {cost, currency}; subtract from that currency's delta.
      const feeCost = Number(order.fee?.cost ?? 0);
      if (feeCost > 0 && order.fee?.currency) {
        bump(order.fee.currency, -feeCost);
      }
    }

    let netUsd = 0;
    for (const [cur, amt] of delta.entries()) {
      if (Math.abs(amt) < 1e-12) continue;
      const px = usdRef.get(cur) ?? 0;
      if (!px) {
        // Can't convert one of the residual currencies → bail rather
        // than record a half-truth.
        console.warn("[autopilot/triangular] no USD reference for", cur, "— skipping PnL record");
        return;
      }
      netUsd += amt * px;
    }
    if (!Number.isFinite(netUsd)) return;

    recordPnl(netUsd);
    if (netUsd < 0) {
      toast.error(`Autopilot triangular settled at ${netUsd.toFixed(2)} USD (counts toward daily loss-stop)`, { duration: 8000 });
    } else {
      toast.success(`Autopilot triangular settled at +${netUsd.toFixed(2)} USD net`, { duration: 6000 });
    }
  } catch (err) {
    console.warn("[autopilot/triangular] settle failed:", err instanceof Error ? err.message : err);
  }
}
