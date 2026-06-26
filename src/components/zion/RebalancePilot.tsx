"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Banknote, X, Loader2, CheckCircle2, AlertTriangle, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ActionCard } from "@/lib/zion/parse";
import { useAutopilot } from "@/lib/store/autopilot";
import { useCexVault } from "@/lib/cex/vault";
import {
  mapCardToWithdrawIntent,
  resolveWithdrawDestination,
  fireAutopilotWithdraw,
  type AutopilotWithdrawIntent,
} from "@/lib/zion/autopilot-bridge";
import { cn } from "@/lib/cn";
import { useT, type MessageKey } from "@/lib/i18n";

/**
 * Auto-rebalance pilot — sibling to AutopilotPilot, but for the new
 * `rebalance` card kind (CEX → wallet withdrawal). Separate component
 * so the trade pilot's logic stays tight and so the user can opt-in to
 * one without the other.
 *
 * Threat model:
 *   - Off by default. Master toggle is `autoRebalanceEnabled` in the
 *     autopilot store, NOT persisted across reloads (same as `enabled`).
 *   - Per-rebalance USD cap (default $200) + per-day count cap
 *     (default 2). Both enforced at select time AND re-checked at fire
 *     time against fresh store state.
 *   - Destination address is the user's CONNECTED WALLET, never the
 *     value from the card itself. Network selects which wallet:
 *     SOL → Phantom, EVM (ERC20/BSC/POLYGON/…) → MetaMask. If the
 *     matching wallet isn't connected, the card is skipped (we never
 *     withdraw to an address we can't verify).
 *   - The autopilot loss-stop freezes BOTH this and the trade pilot
 *     if it trips. Funds movement is paused along with trading.
 *   - 30-second cancel window before the withdrawal actually fires.
 *
 * v1 deliberately does NOT auto-deposit the funds into the destination
 * CEX after withdrawal — that requires a wallet signature we can't
 * perform. The card carries `toExchange` as a hint and the toast
 * surfaces it for the user to act on manually.
 */
export default function RebalancePilot({ cards }: { cards: ActionCard[] }) {
  const t = useT();
  const a = useAutopilot();
  const vault = useCexVault();
  const { address: evmAddress } = useAccount();
  const sol = useWallet();
  const solAddress = sol.publicKey?.toBase58() ?? null;

  const consumedRef = useRef<Set<string>>(new Set());
  const firingRef = useRef(false);

  const [active, setActive] = useState<{
    cardKey:     string;
    card:        ActionCard;
    intent:      AutopilotWithdrawIntent;
    destination: string;
    expiresAt:   number;
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "countdown" | "firing" | "done" | "errored">("idle");
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { a.rolloverIfNewDay(); }, []);

  // Pick the next rebalance card. Mirrors AutopilotPilot's candidate
  // loop but checks rebalance-specific rails.
  useEffect(() => {
    if (phase !== "idle") return;
    if (!a.autoRebalanceEnabled || a.frozenUntilDay) return;
    if (a.rebalancesToday >= a.maxRebalancesPerDay) return;

    const live = vault.getActive();
    if (!live) return;

    for (const c of cards) {
      const key = `rebalance:${c.title ?? ""}:${c.rebalance?.fromExchange ?? ""}:${c.rebalance?.currency ?? ""}:${c.rebalance?.amount ?? ""}`;
      if (consumedRef.current.has(key)) continue;
      const intent = mapCardToWithdrawIntent(c);
      if (!intent) continue;
      // USD cap.
      if (intent.notionalUsd > a.maxRebalanceUsd) continue;
      // Source CEX must be on the user's allowed-exchanges list AND
      // currently connected. We reuse `allowedExchanges` rather than
      // adding a parallel list — if the user has whitelisted a venue
      // for trading, they've already trusted it.
      if (!a.allowedExchanges.includes(intent.exchange)) continue;
      if (!live[intent.exchange]) continue;
      // Destination wallet has to be connected for the picked network.
      const dest = resolveWithdrawDestination(intent.network, evmAddress, solAddress);
      if (!dest) continue;

      setActive({
        cardKey:     key,
        card:        c,
        intent,
        destination: dest,
        expiresAt:   Date.now() + a.countdownMs,
      });
      setPhase("countdown");
      setError(null);
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cards, a.autoRebalanceEnabled, a.frozenUntilDay, a.rebalancesToday, a.maxRebalancesPerDay, a.maxRebalanceUsd, a.allowedExchanges, vault.creds, evmAddress, solAddress, a.countdownMs]);

  // Countdown tick.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== "countdown") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);

  // Fire when countdown elapses.
  useEffect(() => {
    if (phase !== "countdown" || !active) return;
    if (now < active.expiresAt) return;
    void fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, active]);

  const cancel = () => {
    if (!active) return;
    consumedRef.current.add(active.cardKey);
    a.pushHistory({
      ts:        Date.now(),
      exchange:  active.intent.exchange,
      symbol:    active.intent.currency,
      side:      "sell",      // rebalance = funds LEAVING the CEX
      type:      "market",
      amount:    active.intent.amount,
      status:    "canceled",
      cardKind:  "rebalance",
      cardTitle: active.intent.cardTitle,
      reason:    "user canceled during countdown",
    });
    setActive(null);
    setPhase("idle");
  };

  const fire = async () => {
    if (!active) return;
    if (firingRef.current) return;
    firingRef.current = true;

    const reject = (reason: string, status: "rejected" | "errored" = "rejected") => {
      consumedRef.current.add(active.cardKey);
      a.pushHistory({
        ts:        Date.now(),
        exchange:  active.intent.exchange,
        symbol:    active.intent.currency,
        side:      "sell",
        type:      "market",
        amount:    active.intent.amount,
        status,
        cardKind:  "rebalance",
        cardTitle: active.intent.cardTitle,
        reason,
      });
      setActive(null);
      setPhase("idle");
      firingRef.current = false;
    };

    setPhase("firing");

    // Re-validate against FRESH store state (matches AutopilotPilot's
    // pattern). The countdown is a window in which the user could have
    // tightened a cap, locked the vault, or hit the daily stop.
    const live = vault.getActive();
    if (!live) {
      reject("vault re-locked before fire");
      toast.error("Auto-rebalance: vault re-locked. Unlock to resume.");
      return;
    }
    useAutopilot.getState().rolloverIfNewDay();
    const fresh = useAutopilot.getState();
    if (!fresh.autoRebalanceEnabled)                                 return reject("auto-rebalance turned off during countdown");
    if (fresh.frozenUntilDay)                                        return reject("autopilot frozen (daily loss stop)");
    if (fresh.rebalancesToday >= fresh.maxRebalancesPerDay)          return reject("daily rebalance cap would be exceeded");
    if (active.intent.notionalUsd > fresh.maxRebalanceUsd)           return reject("exceeds per-rebalance cap (changed during countdown)");
    if (!fresh.allowedExchanges.includes(active.intent.exchange))    return reject("source exchange no longer allowed");
    if (!live[active.intent.exchange])                               return reject("source exchange no longer connected");

    // Re-resolve destination — the user could have disconnected the
    // matching wallet during the countdown.
    const dest = resolveWithdrawDestination(active.intent.network, evmAddress, solAddress);
    if (!dest) return reject("destination wallet disconnected during countdown");
    if (dest !== active.destination) return reject("destination wallet changed during countdown");

    try {
      const receipt = await fireAutopilotWithdraw(
        active.intent.exchange,
        live[active.intent.exchange]!,
        active.intent,
        dest,
        fresh.maxRebalanceUsd,
      );
      a.recordRebalance(active.intent.notionalUsd);
      a.pushHistory({
        ts:        Date.now(),
        exchange:  active.intent.exchange,
        symbol:    active.intent.currency,
        side:      "sell",
        type:      "market",
        amount:    active.intent.amount,
        status:    "fired",
        orderId:   receipt.id,
        cardKind:  "rebalance",
        cardTitle: active.intent.cardTitle,
        reason:    active.intent.toExchange
          ? `→ wallet; next: deposit to ${active.intent.toExchange}`
          : `→ wallet`,
      });
      consumedRef.current.add(active.cardKey);

      const nextStep = active.intent.toExchange
        ? ` · then re-deposit to ${active.intent.toExchange}`
        : "";
      toast.success(
        `Auto-rebalance fired: withdraw ${active.intent.amount} ${active.intent.currency} from ${active.intent.exchange} to your wallet${nextStep}`,
        { duration: 12_000 },
      );
      setPhase("done");
      setTimeout(() => { setActive(null); setPhase("idle"); firingRef.current = false; }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      a.pushHistory({
        ts:        Date.now(),
        exchange:  active.intent.exchange,
        symbol:    active.intent.currency,
        side:      "sell",
        type:      "market",
        amount:    active.intent.amount,
        status:    "errored",
        cardKind:  "rebalance",
        cardTitle: active.intent.cardTitle,
        reason:    msg,
      });
      consumedRef.current.add(active.cardKey);
      setError(msg);
      setPhase("errored");
      toast.error(`Auto-rebalance rejected: ${msg.slice(0, 200)}`, { duration: 10_000 });
      setTimeout(() => { setActive(null); setPhase("idle"); setError(null); firingRef.current = false; }, 4500);
    }
  };

  if (!a.autoRebalanceEnabled || !active) return null;

  const remaining  = Math.max(0, active.expiresAt - now);
  const remainingS = Math.ceil(remaining / 1000);
  const progress   = Math.max(0, Math.min(1, 1 - remaining / a.countdownMs));
  const destShort  = active.destination.slice(0, 6) + "…" + active.destination.slice(-4);

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
              : "border-violet/40 bg-violet/[0.06]",
        )}
      >
        <div className="flex items-center gap-2">
          <Banknote className={cn(
            "w-3.5 h-3.5 flex-shrink-0",
            phase === "errored" ? "text-red" : phase === "done" ? "text-green" : "text-violet",
          )} />
          <span className={cn(
            "font-mono text-[10px] tracking-widest uppercase font-bold flex-1 min-w-0",
            phase === "errored" ? "text-red" : phase === "done" ? "text-green" : "text-violet",
          )}>
            {phase === "errored" ? t("zion.rebalancePilotRejected" as MessageKey)
              : phase === "done"  ? t("zion.rebalancePilotFired" as MessageKey)
              : phase === "firing" ? t("zion.rebalancePilotSending" as MessageKey)
                                    : t("zion.rebalancePilotWillFire" as MessageKey)}
          </span>
          {phase === "countdown" && (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/15 bg-white/[0.04] font-mono text-[10px] tracking-widest uppercase text-ink-3 hover:bg-white/[0.08]"
            >
              <X className="w-2.5 h-2.5" />
              {t("common.cancel")}
            </button>
          )}
          {phase === "firing"  && <Loader2 className="w-3.5 h-3.5 text-violet animate-spin" />}
          {phase === "done"    && <CheckCircle2 className="w-3.5 h-3.5 text-green" />}
          {phase === "errored" && <AlertTriangle className="w-3.5 h-3.5 text-red" />}
        </div>

        <div className="font-mono text-[11px] text-ink tabular-nums">
          <span className="text-red">{t("zion.rebalancePilotWithdraw" as MessageKey)}</span>
          {" "}
          <span className="text-ink-2">{active.intent.amount} {active.intent.currency}</span>
          {" · "}
          <span className="text-ink-3">{active.intent.exchange}</span>
          {" → "}
          <span className="inline-flex items-center gap-1 text-violet">
            <Wallet className="w-3 h-3" /> {destShort}
          </span>
          {" · "}
          <span className="text-ink-3">{active.intent.network}</span>
          {active.intent.toExchange && (
            <> · <span className="text-ink-3">{t("zion.rebalancePilotThenDeposit" as MessageKey, { exchange: active.intent.toExchange })}</span></>
          )}
        </div>

        {phase === "countdown" && (
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-violet transition-[width] duration-200 linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              {`${remainingS}s · ${t("zion.pilotSkipHint" as MessageKey)}`}
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
