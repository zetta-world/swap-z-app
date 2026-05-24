"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import {
  CheckCircle2, X, ArrowRight, AlertTriangle, Bot, Bell, Zap, ExternalLink,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ActionCard } from "@/lib/zion/parse";
import { isImmediateCard, savePendingOrder } from "@/lib/zion/orders";
import { useSwap } from "@/lib/store/swap";
import { useUI } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { findToken, type Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import { cn } from "@/lib/cn";

interface Props {
  card:    ActionCard | null;
  onClose: () => void;
}

/**
 * Routes a ZION ActionCard to one of two real outcomes — no more demo
 * setTimeout, no more "Sprint 3" toast:
 *
 *   1. `swap` / `bridge` / `arbitrage_*` / `approve`
 *      → maps card.from/card.to → Token objects → writes them into the
 *        swap store → flips executeOpen=true → closes the drawer. The
 *        global ExecuteSwapPortal picks it up and runs the real on-chain
 *        flow (0x Permit2 / LiFi / Jupiter).
 *
 *   2. `buy_limit` / `sell_safe|medium|aggressive` / `stop_loss` /
 *      `sniper_watch` / `limit`
 *      → persists to the local pending-orders store (localStorage) and
 *        points the user at /orders, where they can fire manually or
 *        delete. We never silently "execute later" — every fire is
 *        explicit, because we still don't have an on-chain limit-order
 *        relay or a sniper bot.
 */
export default function ZionExecuteRouter({ card, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const { setFromToken, setToToken, setAmountIn, setExecuteOpen, setSelectedSource } = useSwap();
  const { setZion } = useUI();
  const t = useT();

  if (!card) return null;

  const isImmediate = isImmediateCard(card.kind);
  const chain = card.chain as ChainId;

  const onConfirm = async () => {
    setBusy(true);
    try {
      if (isImmediate) {
        const fromToken = resolveToken(chain, card.from?.symbol, card.from?.address);
        const toToken   = resolveToken(chain, card.to?.symbol,   card.to?.address);

        if (!fromToken || !toToken) {
          toast.error(t("orders.missingTokenToast"));
          setBusy(false);
          return;
        }

        setFromToken(fromToken);
        setToToken(toToken);
        if (card.from?.amount) setAmountIn(card.from.amount);
        // Let the portal auto-pick the best aggregator
        setSelectedSource(null);

        // Close the ZION drawer and open the real execute modal
        setZion(false);
        // Tiny delay so the drawer close animation doesn't compete with the
        // modal open — feels smoother on mobile.
        setTimeout(() => setExecuteOpen(true), 220);
        onClose();
      } else {
        // Conditional / watch — save as a pending order
        savePendingOrder(card);
        toast.success(t("toast.saved"), {
          description: t("orders.saveNowBody"),
          action: {
            label: t("common.open"),
            onClick: () => { window.location.href = "/orders"; },
          },
          duration: 6000,
        });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const Icon  = isImmediate ? Zap : Bell;
  const tone  = isImmediate ? "cyan" : "violet";
  const toneClass = tone === "cyan"
    ? "text-cyan border-cyan/30 bg-cyan/[0.04]"
    : "text-violet border-violet/30 bg-violet/[0.04]";
  const cta = isImmediate ? t("zion.routerCtaImmediate") : t("zion.routerCtaConditional");

  return (
    <Dialog.Root open={!!card} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="aurora-border p-px">
            <div className="rounded-[20px] glass-strong p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="font-display font-extrabold text-base text-ink">
                  {t("zion.routerTitle")}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Kind chip + chain */}
              <div className={cn("rounded-xl border p-3 mb-3 flex items-start gap-2.5", toneClass)}>
                <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm leading-snug">{card.title}</div>
                  <div className="font-sans text-xs text-ink-2 leading-relaxed mt-1">{card.summary}</div>
                </div>
              </div>

              {/* Pair line */}
              {(card.from || card.to) && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 min-w-0 mb-3">
                  {card.from && (
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("zion.pay")}</div>
                      <div className="font-display font-bold text-base text-ink truncate">
                        {card.from.amount && <span>{card.from.amount} </span>}
                        {card.from.symbol}
                      </div>
                    </div>
                  )}
                  <ArrowRight className="w-4 h-4 text-cyan flex-shrink-0" />
                  {card.to && (
                    <div className="flex-1 min-w-0 text-right">
                      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("zion.receive")}</div>
                      <div className="font-display font-bold text-base text-ink truncate">{card.to.symbol}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {card.estCost   && <Cell label={t("common.cost")}   value={card.estCost} />}
                {card.estReturn && <Cell label={t("common.return")} value={card.estReturn} tone="green" />}
                {card.triggerPrice && <Cell label={t("zion.triggerLabel")} value={card.triggerPrice} tone="violet" />}
                {card.targetReturn && <Cell label={t("zion.targetLabel")} value={card.targetReturn} tone="green" />}
                <Cell label={t("common.chain")} value={card.chain} />
                {card.confidence && <Cell label={t("zion.confidence", { level: card.confidence })} value={card.confidence} />}
              </div>

              {/* Mode notice */}
              {isImmediate ? (
                <div className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3 flex items-start gap-2 mb-3">
                  <Bot className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
                  <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
                    {t("zion.routerImmediate")}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-violet/20 bg-violet/[0.04] p-3 flex items-start gap-2 mb-3">
                  <Bell className="w-3.5 h-3.5 text-violet flex-shrink-0 mt-0.5" />
                  <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
                    {t("zion.routerConditional")}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={onClose} disabled={busy} className="flex-1 btn btn-secondary text-xs">
                  {t("common.cancel")}
                </button>
                <button
                  onClick={onConfirm}
                  disabled={busy}
                  className={cn(
                    "flex-1 btn btn-primary text-xs flex items-center justify-center gap-1.5",
                    busy && "opacity-70",
                  )}
                >
                  {busy ? t("zion.routerWiring") : (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      {cta}
                    </>
                  )}
                </button>
              </div>

              {!isImmediate && (
                <p className="font-mono text-[10px] text-ink-4 text-center mt-3 leading-relaxed inline-flex items-center justify-center gap-1 w-full">
                  <ExternalLink className="w-2.5 h-2.5" />
                  {t("zion.routerFootnote")}
                </p>
              )}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Token resolution ──────────────────────────────────────────────────

const FALLBACK_DECIMALS: Record<string, number> = {
  USDC: 6, USDT: 6, DAI: 18, BUSD: 18, FRAX: 18,
  WETH: 18, ETH: 18, WBNB: 18, BNB: 18,
  SOL: 9,  USDC_SPL: 6,
};

function resolveToken(chain: ChainId, symbol?: string, address?: string): Token | undefined {
  if (!symbol && !address) return undefined;
  // Try the curated token list first — gives us exact decimals + price + color
  if (symbol) {
    const bySym = findToken(chain, symbol);
    if (bySym) return bySym;
  }
  if (address) {
    const byAddr = findToken(chain, address);
    if (byAddr) return byAddr;
  }
  if (!symbol || !address) {
    // The card didn't give us enough — let the user wire it manually
    if (!symbol || !address) return undefined;
  }
  // Synthesize a Token with best-guess decimals when not in the curated list
  const decimals = FALLBACK_DECIMALS[symbol!.toUpperCase()] ?? 18;
  return {
    chain,
    symbol:   symbol!,
    name:     symbol!,
    address:  address!,
    decimals,
  };
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "green" | "violet" }) {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/40 px-3 py-2 min-w-0">
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-0.5">{label}</div>
      <div className={cn("font-mono text-xs truncate",
        tone === "green"  ? "text-green"  :
        tone === "violet" ? "text-violet" :
                            "text-ink",
      )}>
        {value}
      </div>
    </div>
  );
}
