"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, Zap, AlertCircle, Bot, ShieldX, ArrowDownToLine,
  ArrowUpFromLine, Crosshair, Target, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  listPendingOrders, deletePendingOrder, updatePendingOrder, isImmediateCard,
  type PendingOrder,
} from "@/lib/zion/orders";
import { useSwap } from "@/lib/store/swap";
import { findToken, type Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import { cn } from "@/lib/cn";

const KIND_META: Record<string, {
  Icon:  React.ComponentType<{ className?: string }>;
  label: string;
  tone:  "cyan" | "violet" | "gold" | "green" | "red";
}> = {
  swap:                  { Icon: Zap,             label: "Swap",          tone: "cyan"   },
  bridge:                { Icon: Zap,             label: "Bridge",        tone: "cyan"   },
  arbitrage:             { Icon: TrendingUp,      label: "Arb",           tone: "violet" },
  arbitrage_same_chain:  { Icon: TrendingUp,      label: "Arb · DEX",     tone: "violet" },
  arbitrage_cross_chain: { Icon: TrendingUp,      label: "Arb · Chain",   tone: "violet" },
  sniper_watch:          { Icon: Crosshair,       label: "Sniper",        tone: "gold"   },
  buy_limit:             { Icon: ArrowDownToLine, label: "Buy limit",     tone: "cyan"   },
  sell_safe:             { Icon: ArrowUpFromLine, label: "Sell · Safe",   tone: "green"  },
  sell_medium:           { Icon: Target,          label: "Sell · Med",    tone: "gold"   },
  sell_aggressive:       { Icon: TrendingUp,      label: "Sell · Stretch", tone: "violet" },
  stop_loss:             { Icon: ShieldX,         label: "Stop loss",     tone: "red"    },
  limit:                 { Icon: Bot,             label: "Limit",         tone: "violet" },
};

const TONE_BORDER: Record<string, string> = {
  cyan:   "border-cyan/20",
  violet: "border-violet/20",
  gold:   "border-gold/20",
  green:  "border-green/20",
  red:    "border-red/20",
};

const FALLBACK_DECIMALS: Record<string, number> = {
  USDC: 6, USDT: 6, DAI: 18, BUSD: 18, FRAX: 18,
  WETH: 18, ETH: 18, WBNB: 18, BNB: 18,
  SOL: 9,  USDC_SPL: 6,
};

/**
 * Lists ZION-proposed orders persisted in this browser's localStorage by
 * `savePendingOrder()`. The user can fire one manually (immediate cards
 * route through the global ExecuteSwap portal) or delete it.
 *
 * No backend involved — these orders live entirely client-side. Future
 * iterations may sync to a wallet-scoped server store; today this keeps
 * the "advisory only" posture intact and avoids any custody.
 */
export default function ZionOrdersList() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const { setFromToken, setToToken, setAmountIn, setExecuteOpen, setSelectedSource } = useSwap();

  // Hydrate from localStorage on mount + when the browser focuses back
  const refresh = useCallback(() => {
    setOrders(listPendingOrders());
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const onDelete = (id: string) => {
    deletePendingOrder(id);
    refresh();
    toast.success("Order removed.");
  };

  const onFireNow = (o: PendingOrder) => {
    const { card } = o;
    const chain = card.chain as ChainId;

    if (!isImmediateCard(card.kind)) {
      toast.error(
        "This is a conditional order — fire-now isn't supported yet. Use the swap card manually when the trigger price hits.",
      );
      return;
    }

    const fromToken = resolveToken(chain, card.from?.symbol, card.from?.address);
    const toToken   = resolveToken(chain, card.to?.symbol,   card.to?.address);
    if (!fromToken || !toToken) {
      toast.error("Missing token info on the original proposal — can't fire automatically.");
      return;
    }

    setFromToken(fromToken);
    setToToken(toToken);
    if (card.from?.amount) setAmountIn(card.from.amount);
    setSelectedSource(null);
    updatePendingOrder(o.id, { status: "fired", lastError: undefined });
    refresh();

    // Tiny delay so the user sees the toast first
    toast.success("Pair loaded — opening execution…");
    setTimeout(() => setExecuteOpen(true), 220);
  };

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 glass-pane p-5 text-center">
        <Sparkles className="w-5 h-5 text-gold mx-auto mb-2" />
        <div className="font-display font-bold text-sm text-ink mb-1">
          No ZION orders saved
        </div>
        <p className="font-sans text-xs text-ink-3 max-w-sm mx-auto">
          When ZION suggests a buy_limit, stop_loss, or sniper_watch and you click
          Save in the proposal modal, it shows up here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-wrap gap-2">
        <span className="font-display font-bold text-sm text-ink inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-gold" />
          ZION saved orders
        </span>
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
          {orders.length} saved · {orders.filter((o) => o.status === "pending").length} pending
        </span>
      </div>
      <AnimatePresence initial={false}>
        <div className="divide-y divide-white/[0.04]">
          {orders.map((o) => (
            <motion.div
              key={o.id}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y:  0 }}
              exit={{    opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
              className="px-4 py-3"
            >
              <OrderRow order={o} onDelete={() => onDelete(o.id)} onFire={() => onFireNow(o)} />
            </motion.div>
          ))}
        </div>
      </AnimatePresence>

      <div className="px-4 py-3 border-t border-white/5 bg-bg-1/30 flex items-start gap-2">
        <AlertCircle className="w-3 h-3 text-ink-3 flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          Conditional orders (limit / stop / sniper) DON&apos;T auto-execute.
          You watch the market — when conditions match, hit Fire now to load the
          pair into the swap card.
        </p>
      </div>
    </div>
  );
}

function OrderRow({
  order, onDelete, onFire,
}: {
  order:    PendingOrder;
  onDelete: () => void;
  onFire:   () => void;
}) {
  const { card } = order;
  const meta = KIND_META[card.kind] ?? KIND_META.swap;
  const Icon = meta.Icon;
  const immediate = isImmediateCard(card.kind);

  const statusCfg = {
    pending:   "text-gold border-gold/30 bg-gold/5",
    fired:     "text-cyan border-cyan/30 bg-cyan/5",
    expired:   "text-ink-3 border-white/10 bg-white/[0.02]",
    cancelled: "text-ink-3 border-white/10 bg-white/[0.02]",
  }[order.status] ?? "text-ink-3 border-white/10 bg-white/[0.02]";

  const age = Date.now() - order.createdAt;
  const ageLabel =
    age < 60_000      ? `${Math.round(age / 1_000)}s`
    : age < 3_600_000 ? `${Math.round(age / 60_000)}m`
    : age < 86_400_000? `${Math.round(age / 3_600_000)}h`
                       : `${Math.round(age / 86_400_000)}d`;

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3", TONE_BORDER[meta.tone])}>
      <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5 text-ink-2" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", statusCfg)}>
            {order.status}
          </span>
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
            {meta.label} · {card.chain}
          </span>
          <span className="font-mono text-[9px] text-ink-4 tracking-widest">
            saved {ageLabel} ago
          </span>
        </div>
        <div className="font-display font-bold text-xs text-ink leading-snug break-words">
          {card.title}
        </div>
        {card.summary && (
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed mt-0.5 break-words line-clamp-2">
            {card.summary}
          </p>
        )}

        <div className="mt-2 grid grid-cols-2 gap-1.5 min-w-0">
          {card.from && (
            <Field label="From" value={`${card.from.amount ?? ""} ${card.from.symbol}`.trim()} />
          )}
          {card.to && (
            <Field label="To" value={card.to.symbol} />
          )}
          {card.triggerPrice && (
            <Field label="Trigger" value={card.triggerPrice} tone="violet" />
          )}
          {card.targetReturn && (
            <Field label={card.kind === "stop_loss" ? "Max loss" : "Target"} value={card.targetReturn} tone={card.kind === "stop_loss" ? "red" : "green"} />
          )}
        </div>

        {order.lastError && (
          <div className="mt-2 rounded-md border border-red/20 bg-red/[0.04] px-2 py-1 font-mono text-[10px] text-red">
            {order.lastError}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onFire}
            disabled={!immediate}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-mono text-[10px] tracking-widest uppercase transition-colors",
              immediate
                ? "border-cyan/30 bg-cyan/[0.06] text-cyan hover:bg-cyan/[0.10]"
                : "border-white/10 bg-white/[0.02] text-ink-4 cursor-not-allowed",
            )}
            title={immediate ? "Load the pair and open execution" : "Conditional orders need manual fire when trigger hits"}
          >
            <Zap className="w-3 h-3" />
            Fire now
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.02] text-ink-3 hover:text-red hover:border-red/30 font-mono text-[10px] tracking-widest uppercase"
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "green" | "violet" | "red" }) {
  if (!value || !value.trim()) return null;
  const cls =
    tone === "green"  ? "text-green"  :
    tone === "violet" ? "text-violet" :
    tone === "red"    ? "text-red"    :
                        "text-ink";
  return (
    <div className="rounded-md border border-white/5 bg-bg-1/30 px-2 py-1 min-w-0">
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{label}</div>
      <div className={cn("font-mono text-[11px] truncate tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function resolveToken(chain: ChainId, symbol?: string, address?: string): Token | undefined {
  if (!symbol && !address) return undefined;
  if (symbol) {
    const bySym = findToken(chain, symbol);
    if (bySym) return bySym;
  }
  if (address) {
    const byAddr = findToken(chain, address);
    if (byAddr) return byAddr;
  }
  if (!symbol || !address) return undefined;
  const decimals = FALLBACK_DECIMALS[symbol.toUpperCase()] ?? 18;
  return { chain, symbol, name: symbol, address, decimals };
}
