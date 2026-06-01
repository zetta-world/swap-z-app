"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ActionCard } from "@/lib/zion/parse";
import { useAutopilot } from "@/lib/store/autopilot";
import { useCexVault } from "@/lib/cex/vault";
import {
  mapCardToCexIntents, pickExchangeForIntent, fireAutopilotIntent,
  type AutopilotIntent,
} from "@/lib/zion/autopilot-bridge";
import type { CexId } from "@/lib/cex/types";
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
    if (intents.some((i) => i.notionalUsd > fresh.maxTradeUsd))  return rejectAll("exceeds per-trade cap (changed during countdown)");
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

    // ── Fire all legs in PARALLEL ──
    // For cross-CEX: parallel minimizes the price drift window between
    // the two legs. If one fails the other still runs — that leaves the
    // user with directional exposure on whichever filled. We log clearly
    // so the user can manually close the orphan leg.
    const results = await Promise.allSettled(
      resolved.map((r) => fireAutopilotIntent(r.exchange, live[r.exchange]!, r.intent)),
    );

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
        summaries.push(`${intent.side.toUpperCase()} ${intent.symbol} → ${exchange} ✓`);
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
    } else if (intents.length > 1 && summaries.some((s) => s.includes("✓"))) {
      // Partial fill on cross-CEX is the worst case — directional risk.
      // Surface loudly so the user goes to close the orphan leg manually.
      const errMsg = `PARTIAL FILL — one leg failed: ${summaries.join(" | ")}. Close the open leg manually on the exchange.`;
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
  const isPair     = activeIntent.intents.length > 1;

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
              : phase === "done"  ? `Autopilot fired ${isPair ? "(2 legs)" : ""}`
              : phase === "firing" ? `Sending ${isPair ? "2 legs in parallel…" : "order…"}`
                                    : `Autopilot will fire${isPair ? " 2 legs" : ""}`}
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
