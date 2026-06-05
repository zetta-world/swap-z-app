"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, Zap, AlertCircle, Bot, ShieldX, ArrowDownToLine,
  ArrowUpFromLine, Crosshair, Target, TrendingUp, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  listPendingOrders, deletePendingOrder, updatePendingOrder, updateCowStatus,
  isImmediateCard, type PendingOrder,
} from "@/lib/zion/orders";
import { fetchCowOrderStatus } from "@/lib/limit/cow";
import { useSwap } from "@/lib/store/swap";
import { findToken, type Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import { useT, type MessageKey } from "@/lib/i18n";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

const KIND_META: Record<string, {
  Icon:     React.ComponentType<{ className?: string }>;
  labelKey: MessageKey;
  tone:     "cyan" | "violet" | "gold" | "green" | "red";
}> = {
  swap:                  { Icon: Zap,             labelKey: "zion.cardKindSwap",     tone: "cyan"   },
  bridge:                { Icon: Zap,             labelKey: "zion.cardKindBridge",   tone: "cyan"   },
  arbitrage:             { Icon: TrendingUp,      labelKey: "zion.cardKindArb",      tone: "violet" },
  arbitrage_same_chain:  { Icon: TrendingUp,      labelKey: "zion.cardKindArbDex",   tone: "violet" },
  arbitrage_cross_chain: { Icon: TrendingUp,      labelKey: "zion.cardKindArbChain", tone: "violet" },
  sniper_watch:          { Icon: Crosshair,       labelKey: "zion.cardKindSniper",   tone: "gold"   },
  buy_limit:             { Icon: ArrowDownToLine, labelKey: "zion.cardKindBuyLimit", tone: "cyan"   },
  sell_safe:             { Icon: ArrowUpFromLine, labelKey: "zion.cardKindSellSafe", tone: "green"  },
  sell_medium:           { Icon: Target,          labelKey: "zion.cardKindSellMed",  tone: "gold"   },
  sell_aggressive:       { Icon: TrendingUp,      labelKey: "zion.cardKindSellAggr", tone: "violet" },
  stop_loss:             { Icon: ShieldX,         labelKey: "zion.cardKindStop",     tone: "red"    },
  limit:                 { Icon: Bot,             labelKey: "zion.cardKindLimit",    tone: "violet" },
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
  const t = useT();
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

  // Refresh CoW status for every pre-signed order on mount + every 60s.
  // Each request is per-order so partial failures don't block the rest.
  // We skip orders we checked in the last 30s to keep traffic low.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const list = listPendingOrders();
      const stale = list.filter((o) =>
        o.cow && (!o.cow.lastChecked || Date.now() - o.cow.lastChecked > 30_000),
      );
      for (const o of stale) {
        if (cancelled || !o.cow) continue;
        try {
          const st = await fetchCowOrderStatus(o.cow.chain, o.cow.orderUid);
          if (cancelled) break;
          updateCowStatus(o.id, st.status);
        } catch { /* leave previous status; will retry next tick */ }
      }
      if (!cancelled) refresh();
    };
    void tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [refresh]);

  const onDelete = (id: string) => {
    deletePendingOrder(id);
    refresh();
    toast.success(t("orders.orderRemovedToast"));
  };

  const onFireNow = (o: PendingOrder) => {
    const { card } = o;
    const chain = card.chain as ChainId;

    if (!isImmediateCard(card.kind)) {
      toast.error(t("orders.notImmediateToast"));
      return;
    }

    const fromToken = resolveToken(chain, card.from?.symbol, card.from?.address);
    const toToken   = resolveToken(chain, card.to?.symbol,   card.to?.address);
    if (!fromToken || !toToken) {
      toast.error(t("orders.missingTokenToast"));
      return;
    }

    setFromToken(fromToken);
    setToToken(toToken);
    if (card.from?.amount) setAmountIn(card.from.amount);
    setSelectedSource(null);
    updatePendingOrder(o.id, { status: "fired", lastError: undefined });
    refresh();

    // Tiny delay so the user sees the toast first
    toast.success(t("orders.pairLoadedToast"));
    setTimeout(() => setExecuteOpen(true), 220);
  };

  if (orders.length === 0) {
    return (
      <EmptyState
        Icon={Sparkles}
        title={t("zion.orderNone")}
        body={t("zion.orderNoneHint")}
        tone="gold"
        density="compact"
      />
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-wrap gap-2">
        <span className="font-display font-bold text-sm text-ink inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-gold" />
          {t("zion.orderTitle")}
        </span>
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
          {t("zion.orderSavedCount", {
            n: orders.length,
            pending: orders.filter((o) => o.status === "pending").length,
          })}
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
          {t("orders.conditionalHint")}
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
  const t = useT();
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
            {order.status === "pending"   ? t("common.pending") :
             order.status === "cancelled" ? t("common.failed") :
             order.status}
          </span>
          {order.cow && <CowStatusBadge cow={order.cow} />}
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
            {t(meta.labelKey)} · {card.chain}
          </span>
          <span className="font-mono text-[9px] text-ink-4 tracking-widest">
            {ageLabel}
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
            <Field label={t("common.from")} value={`${card.from.amount ?? ""} ${card.from.symbol}`.trim()} />
          )}
          {card.to && (
            <Field label={t("common.to")} value={card.to.symbol} />
          )}
          {card.triggerPrice && (
            <Field label={t("zion.triggerLabel")} value={card.triggerPrice} tone="violet" />
          )}
          {card.targetReturn && (
            <Field
              label={card.kind === "stop_loss" ? t("zion.maxLossLabel") : t("zion.targetLabel")}
              value={card.targetReturn}
              tone={card.kind === "stop_loss" ? "red" : "green"}
            />
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
            title={immediate ? t("orders.pairLoadedToast") : t("orders.conditionalHint")}
          >
            <Zap className="w-3 h-3" />
            {t("zion.fireNow")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.02] text-ink-3 hover:text-red hover:border-red/30 font-mono text-[10px] tracking-widest uppercase"
          >
            <Trash2 className="w-3 h-3" />
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CowStatusBadge({ cow }: { cow: NonNullable<PendingOrder["cow"]> }) {
  const status = cow.lastStatus ?? "open";
  const cfg = {
    open:      { cls: "text-cyan border-cyan/30 bg-cyan/[0.05]",     label: "AUTOPILOT · ARMED" },
    fulfilled: { cls: "text-green border-green/30 bg-green/[0.05]",  label: "AUTOPILOT · FILLED" },
    cancelled: { cls: "text-ink-3 border-white/15 bg-white/[0.02]",  label: "AUTOPILOT · CANCELED" },
    expired:   { cls: "text-ink-3 border-white/15 bg-white/[0.02]",  label: "AUTOPILOT · EXPIRED" },
    unknown:   { cls: "text-ink-4 border-white/10 bg-white/[0.02]",  label: "AUTOPILOT · CHECKING…" },
  }[status] ?? { cls: "text-ink-4 border-white/10 bg-white/[0.02]", label: "AUTOPILOT" };
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", cfg.cls)}>
      <ShieldCheck className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
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
