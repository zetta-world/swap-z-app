"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListChecks, RefreshCw, X, AlertCircle, Loader2, Activity,
} from "lucide-react";
import { toast } from "sonner";
import {
  type CexId, type CexCredentials, type CexOrder,
} from "@/lib/cex/types";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const POLL_MS = 8_000;

interface Props {
  exchangeId:  CexId;
  credentials: CexCredentials;
}

/**
 * Live list of open orders on the selected CEX. Polls every 8 seconds.
 * Each row has a Cancel button — clicking it calls /api/cex/order/cancel
 * with confirmation toast on success/failure. No 3-second cooldown here
 * because cancel is "safer" than place — but we still gate behind a
 * confirm() prompt for the user.
 */
export default function CexOpenOrdersPanel({ exchangeId, credentials }: Props) {
  const [orders,  setOrders]  = useState<CexOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cex/orders/open", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   exchangeId,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
        }),
      });
      const body = await res.json() as { ok: boolean; orders?: CexOrder[]; error?: string };
      if (!res.ok || !body.ok) throw new Error(humanError(body.error ?? `HTTP ${res.status}`));
      setOrders(body.orders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [exchangeId, credentials]);

  // Initial fetch + interval
  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const onCancel = async (order: CexOrder) => {
    if (!confirm(`Cancel ${order.side.toUpperCase()} ${order.amount} on ${order.symbol}?`)) return;
    setCancelling(order.id);
    try {
      const res = await fetch("/api/cex/order/cancel", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   exchangeId,
          orderId:    order.id,
          symbol:     order.symbol,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
        }),
      });
      const body = await res.json() as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(humanError(body.error ?? `HTTP ${res.status}`));
      toast.success("Order cancelled.");
      // Optimistically remove the row; the next poll re-syncs
      setOrders((o) => o.filter((x) => x.id !== order.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 min-w-0">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-violet" />
          <span className="section-label">Open orders</span>
          {orders.length > 0 && (
            <span className="font-mono text-[10px] text-violet tracking-widest uppercase">
              · {orders.length} live
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-3 hover:text-violet tracking-widest uppercase"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          {loading ? "fetching…" : "refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red/20 bg-red/[0.05] p-2.5 mb-2 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 text-red flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[11px] text-red leading-relaxed">{error}</p>
        </div>
      )}

      {!error && orders.length === 0 && !loading && (
        <div className="rounded-xl border border-white/5 bg-bg-1/30 p-5 text-center">
          <Activity className="w-4 h-4 text-ink-3 mx-auto mb-1" />
          <p className="font-mono text-[11px] text-ink-3">
            No open orders right now. Limit orders sit here until matched or cancelled.
          </p>
        </div>
      )}

      {orders.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-bg-1/30 divide-y divide-white/[0.04] overflow-hidden">
          <AnimatePresence initial={false}>
            {orders.map((o) => (
              <motion.div
                key={o.id}
                layout
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x:  0 }}
                exit={{    opacity: 0, x: 6, height: 0, paddingTop: 0, paddingBottom: 0 }}
                className="flex items-center gap-2 px-3 py-2.5 min-w-0"
              >
                <OrderRow order={o} />
                <button
                  type="button"
                  onClick={() => onCancel(o)}
                  disabled={cancelling === o.id}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 rounded-md border font-mono text-[10px] tracking-widest uppercase flex-shrink-0 transition-colors",
                    "border-red/30 bg-red/[0.04] text-red hover:bg-red/[0.10]",
                    cancelling === o.id && "opacity-60 cursor-wait",
                  )}
                  title="Cancel this order"
                >
                  {cancelling === o.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <X className="w-3 h-3" />}
                  cancel
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: CexOrder }) {
  const isBuy   = order.side === "buy";
  const filledPct = order.amount > 0 ? (order.filled / order.amount) * 100 : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap mb-0.5">
        <span className={cn(
          "font-mono text-[10px] tracking-widest uppercase font-bold",
          isBuy ? "text-green" : "text-red",
        )}>
          {order.side}
        </span>
        <span className="font-display font-bold text-xs text-ink truncate">{order.symbol}</span>
        <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
          · {order.type}
        </span>
      </div>
      <div className="font-mono text-[10px] text-ink-3 tabular-nums truncate">
        {compactNumber(order.amount)} @ {order.price ? `${order.price.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "market"}
        {filledPct > 0 && filledPct < 100 && ` · ${filledPct.toFixed(1)}% filled`}
      </div>
    </div>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "auth_failed":           return "Authentication rejected.";
    case "order_not_found":       return "Order no longer exists on the exchange.";
    case "order_already_closed":  return "Order already filled or cancelled.";
    case "permission_denied":     return "API key lacks the required permission.";
    case "timeout":               return "Exchange timed out.";
    case "rate_limited":          return "Rate-limited — wait a few seconds.";
    case "upstream_failed":       return "Exchange call failed.";
    default:                      return code;
  }
}
