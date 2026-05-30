"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ActionCard } from "@/lib/zion/parse";
import { useAutopilot } from "@/lib/store/autopilot";
import { useCexVault } from "@/lib/cex/vault";
import {
  mapCardToCexIntent, pickExchangeForIntent, fireAutopilotIntent,
  type AutopilotIntent,
} from "@/lib/zion/autopilot-bridge";
import { cn } from "@/lib/cn";

/**
 * The autopilot "pilot" — a single banner above the ZION action cards
 * that watches the card stream, picks the next CEX-mappable card that
 * passes every rail, runs a countdown the user can cancel, and fires
 * the trade through /api/cex/order when the countdown expires.
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

  // Track consumed card identities so we don't re-fire after navigation
  // or re-render. Identity = first 64 chars of title — Claude-emitted
  // titles are deterministic per card / pair.
  const consumedRef = useRef<Set<string>>(new Set());
  const [activeIntent, setActiveIntent] = useState<{
    cardKey:  string;
    card:     ActionCard;
    intent:   AutopilotIntent;
    expiresAt: number;
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "firing" | "done" | "errored">("idle");
  const [error, setError] = useState<string | null>(null);

  // Roll the daily counter on first interaction so the rails are accurate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { a.rolloverIfNewDay(); }, []);

  // Pick the next card to act on whenever the deck changes.
  const nextCandidate = useMemo(() => {
    if (!enabled || a.frozenUntilDay || a.tradesToday >= a.maxTradesPerDay) return null;
    for (const c of cards) {
      const key = (c.title || "").slice(0, 64);
      if (!key) continue;
      if (consumedRef.current.has(key)) continue;
      const intent = mapCardToCexIntent(c);
      if (!intent) continue;
      // Rail checks
      if (intent.notionalUsd > a.maxTradeUsd) continue;
      const base = intent.symbol.split("/")[0];
      if (!a.allowedSymbols.includes(base)) continue;
      // Vault + exchange
      const live = vault.getActive();
      if (!live) continue;
      const exchange = pickExchangeForIntent(a.allowedExchanges, live);
      if (!exchange) continue;
      return { key, card: c, intent };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, enabled, a.frozenUntilDay, a.tradesToday, a.maxTradesPerDay, a.maxTradeUsd, a.allowedSymbols, a.allowedExchanges, vault.creds]);

  // Bring the next candidate into the active slot when we're idle.
  useEffect(() => {
    if (phase !== "idle" || !nextCandidate) return;
    setActiveIntent({
      cardKey:  nextCandidate.key,
      card:     nextCandidate.card,
      intent:   nextCandidate.intent,
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
    a.pushHistory({
      ts:        Date.now(),
      exchange:  "binance", // placeholder; the real exchange lives in fired entries
      symbol:    activeIntent.intent.symbol,
      side:      activeIntent.intent.side,
      type:      activeIntent.intent.type,
      amount:    activeIntent.intent.amount,
      price:     activeIntent.intent.price,
      status:    "canceled",
      cardKind:  activeIntent.card.kind,
      cardTitle: activeIntent.card.title.slice(0, 80),
      reason:    "user canceled during countdown",
    });
    setActiveIntent(null);
    setPhase("idle");
  };

  const fire = async () => {
    if (!activeIntent) return;
    setPhase("firing");
    const live = vault.getActive();
    if (!live) {
      consumedRef.current.add(activeIntent.cardKey);
      a.pushHistory({
        ts:        Date.now(),
        exchange:  "binance",
        symbol:    activeIntent.intent.symbol,
        side:      activeIntent.intent.side,
        type:      activeIntent.intent.type,
        amount:    activeIntent.intent.amount,
        price:     activeIntent.intent.price,
        status:    "rejected",
        cardKind:  activeIntent.card.kind,
        cardTitle: activeIntent.card.title.slice(0, 80),
        reason:    "vault re-locked before fire",
      });
      setActiveIntent(null);
      setPhase("idle");
      toast.error("Autopilot: vault re-locked. Unlock to resume.");
      return;
    }
    const exchange = pickExchangeForIntent(a.allowedExchanges, live);
    if (!exchange) {
      consumedRef.current.add(activeIntent.cardKey);
      setActiveIntent(null);
      setPhase("idle");
      return;
    }
    try {
      const order = await fireAutopilotIntent(exchange, live[exchange]!, activeIntent.intent);
      a.recordTrade(activeIntent.intent.notionalUsd);
      a.pushHistory({
        ts:        Date.now(),
        exchange,
        symbol:    activeIntent.intent.symbol,
        side:      activeIntent.intent.side,
        type:      activeIntent.intent.type,
        amount:    activeIntent.intent.amount,
        price:     activeIntent.intent.price,
        status:    "fired",
        orderId:   order.id,
        cardKind:  activeIntent.card.kind,
        cardTitle: activeIntent.card.title.slice(0, 80),
      });
      toast.success(`Autopilot ${activeIntent.intent.side.toUpperCase()} ${activeIntent.intent.symbol} sent to ${exchange}.`);
      consumedRef.current.add(activeIntent.cardKey);
      setPhase("done");
      setTimeout(() => { setActiveIntent(null); setPhase("idle"); }, 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      consumedRef.current.add(activeIntent.cardKey);
      a.pushHistory({
        ts:        Date.now(),
        exchange,
        symbol:    activeIntent.intent.symbol,
        side:      activeIntent.intent.side,
        type:      activeIntent.intent.type,
        amount:    activeIntent.intent.amount,
        price:     activeIntent.intent.price,
        status:    "errored",
        cardKind:  activeIntent.card.kind,
        cardTitle: activeIntent.card.title.slice(0, 80),
        reason:    msg,
      });
      setError(msg);
      setPhase("errored");
      toast.error(`Autopilot rejected: ${msg.slice(0, 120)}`);
      setTimeout(() => { setActiveIntent(null); setPhase("idle"); setError(null); }, 4000);
    }
  };

  // Nothing to show when autopilot is OFF or there's no candidate cooking.
  if (!enabled || !activeIntent) return null;

  const remaining = Math.max(0, activeIntent.expiresAt - now);
  const remainingS = Math.ceil(remaining / 1000);
  const progress = Math.max(0, Math.min(1, 1 - remaining / a.countdownMs));

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
              : "border-gold/30 bg-gold/[0.05]",
        )}
      >
        <div className="flex items-center gap-2">
          <Bot className={cn(
            "w-3.5 h-3.5 flex-shrink-0",
            phase === "errored" ? "text-red" : phase === "done" ? "text-green" : "text-gold",
          )} />
          <span className={cn(
            "font-mono text-[10px] tracking-widest uppercase font-bold flex-1 min-w-0",
            phase === "errored" ? "text-red" : phase === "done" ? "text-green" : "text-gold",
          )}>
            {phase === "errored" ? "Autopilot rejected"
              : phase === "done"  ? "Autopilot fired"
              : phase === "firing" ? "Sending order…"
                                    : "Autopilot will fire"}
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

        {/* Order summary */}
        <div className="font-mono text-[11px] text-ink tabular-nums">
          <span className={activeIntent.intent.side === "buy" ? "text-green" : "text-red"}>
            {activeIntent.intent.side.toUpperCase()}
          </span>
          {" "}
          <span className="text-ink">{activeIntent.intent.symbol}</span>
          {" · "}
          <span className="text-ink-2">{formatBase(activeIntent.intent.amount)} base</span>
          {activeIntent.intent.type === "limit" && activeIntent.intent.price && (
            <> · <span className="text-ink-2">@${activeIntent.intent.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span></>
          )}
          {" · "}
          <span className="text-ink-3">~${activeIntent.intent.notionalUsd.toFixed(2)}</span>
        </div>

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
