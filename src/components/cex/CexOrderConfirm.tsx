"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import {
  AlertTriangle, X, ShieldAlert, CheckCircle2, Loader2, TrendingUp, TrendingDown, ArrowRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  CEX_META, type CexId, type CexCredentials, type CexOrder, type CexOrderResponse, type CexOrderSide,
} from "@/lib/cex/types";
import { cn } from "@/lib/cn";

const COOLDOWN_SECONDS = 3;

interface Props {
  open:           boolean;
  onClose:        () => void;
  exchangeId:     CexId;
  credentials:    CexCredentials;
  symbol:         string;
  side:           CexOrderSide;
  amount:         number;
  referencePrice: number;
  baseAsset:      string;
  quoteAsset:     string;
  onConfirmed:    (order: CexOrder, filledImmediately: boolean) => void;
}

/**
 * Final guard before a real CEX order hits the exchange. Shows the full
 * trade summary, a 3-second cooldown timer (button disabled during),
 * and only then enables the submit. On submit, sends the literal
 * "I-CONFIRM-REAL-ORDER" payload that the /api/cex/order route
 * cross-checks before forwarding to ccxt.
 */
export default function CexOrderConfirm({
  open, onClose, exchangeId, credentials, symbol, side, amount, referencePrice,
  baseAsset, quoteAsset, onConfirmed,
}: Props) {
  const meta = CEX_META[exchangeId];
  const [secondsLeft, setSecondsLeft] = useState(COOLDOWN_SECONDS);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Reset state every time the modal opens; tick the cooldown down each
  // second until 0.
  useEffect(() => {
    if (!open) return;
    setSecondsLeft(COOLDOWN_SECONDS);
    setError(null);
    setSubmitting(false);
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1_000);
    return () => clearInterval(id);
  }, [open]);

  const estCost = amount * referencePrice;
  const isBuy   = side === "buy";

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cex/order", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   exchangeId,
          symbol,
          side,
          type:       "market",
          amount,
          confirm:    "I-CONFIRM-REAL-ORDER",
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
        }),
      });
      const body = await res.json() as CexOrderResponse & { error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(humanError(body.error ?? `HTTP ${res.status}`));
      }
      onConfirmed(body.order, body.filledImmediately);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="aurora-border p-px">
            <div className={cn(
              "rounded-[20px] glass-strong p-5 sm:p-6",
              isBuy ? "shadow-glow-green" : "shadow-glow-red",
            )}>
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="font-display font-extrabold text-base text-ink">
                  Confirm real order
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    disabled={submitting}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5 disabled:opacity-30"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Real-funds warning */}
              <div className="rounded-xl border border-red/30 bg-red/[0.06] p-3 flex items-start gap-2 mb-4">
                <ShieldAlert className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[11px] text-ink-2 leading-relaxed">
                  This places a <b>real market order</b> on {meta.label}. Funds will move now —
                  no further confirmation, no undo.
                </p>
              </div>

              {/* Order summary */}
              <div className="rounded-xl border border-white/5 bg-bg-1/40 p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 font-display font-extrabold text-sm tracking-wide",
                    isBuy ? "text-green" : "text-red",
                  )}>
                    {isBuy ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {side.toUpperCase()} · MARKET
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-md border font-mono text-[10px] tracking-widest uppercase"
                    style={{ borderColor: `${meta.color}55`, color: meta.color, background: `${meta.color}1A` }}
                  >
                    {meta.label}
                  </span>
                </div>

                <div className="flex items-center gap-2 min-w-0 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
                      {isBuy ? "Spend ≈" : "Sell"}
                    </div>
                    <div className="font-display font-bold text-lg text-ink truncate tabular-nums">
                      {isBuy
                        ? `${estCost.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quoteAsset}`
                        : `${amount} ${baseAsset}`}
                    </div>
                  </div>
                  <ArrowRight className={cn("w-4 h-4 flex-shrink-0", isBuy ? "text-green" : "text-red")} />
                  <div className="flex-1 min-w-0 text-right">
                    <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
                      {isBuy ? "Receive ≈" : "Receive ≈"}
                    </div>
                    <div className="font-display font-bold text-lg text-ink truncate tabular-nums">
                      {isBuy
                        ? `${amount} ${baseAsset}`
                        : `${estCost.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quoteAsset}`}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Cell label="Symbol" value={symbol} />
                  <Cell label="Reference" value={`${referencePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${quoteAsset}`} />
                </div>
              </div>

              {/* Slippage hint */}
              <p className="font-mono text-[10px] text-ink-3 leading-relaxed mb-4">
                Market orders fill at the next available book levels. Actual fill price
                can differ from the reference — especially on illiquid pairs.
              </p>

              {error && (
                <div className="rounded-md border border-red/30 bg-red/[0.05] p-2.5 mb-3 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-red flex-shrink-0 mt-0.5" />
                  <p className="font-mono text-[11px] text-red leading-relaxed">{error}</p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 btn btn-secondary text-xs disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={submitting || secondsLeft > 0}
                  className={cn(
                    "flex-1 py-2 rounded-lg font-display font-extrabold text-xs tracking-wide flex items-center justify-center gap-2 transition-all",
                    isBuy
                      ? "bg-green text-bg hover:opacity-90"
                      : "bg-red text-bg hover:opacity-90",
                    (submitting || secondsLeft > 0) && "opacity-60 cursor-not-allowed",
                  )}
                >
                  {submitting
                    ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Placing…</>)
                    : secondsLeft > 0
                      ? (<>Wait {secondsLeft}s</>)
                      : (<><CheckCircle2 className="w-3.5 h-3.5" /> Place {side.toUpperCase()}</>)}
                </button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-bg-1/30 px-2.5 py-1.5 min-w-0">
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{label}</div>
      <div className="font-mono text-[11px] text-ink truncate tabular-nums">{value}</div>
    </div>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "auth_failed":           return "Authentication rejected — keys may have expired.";
    case "insufficient_balance":  return "Not enough balance on the exchange for this order.";
    case "below_minimum":         return "Below the exchange's minimum order size.";
    case "above_maximum":         return "Above the exchange's per-order limit.";
    case "missing_confirmation":  return "Confirmation guard failed — close and retry.";
    case "permission_denied":     return "API key lacks trading permission.";
    case "symbol_not_found":      return "Symbol not listed on this exchange.";
    case "timeout":               return "Exchange timed out — order may or may not have placed. Check open orders.";
    case "rate_limited":          return "Rate-limited — wait a few seconds and retry.";
    default:                      return code;
  }
}
