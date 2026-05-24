"use client";

import { motion } from "framer-motion";
import {
  Zap, ArrowRight, Bot, Repeat, Target, Coins, TrendingUp, ShieldCheck,
  ArrowDownToLine, ArrowUpFromLine, ShieldX, Globe, Crosshair,
} from "lucide-react";
import type { ActionCard } from "@/lib/zion/parse";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface KindMeta {
  Icon:     React.ComponentType<{ className?: string }>;
  labelKey: MessageKey;
  tone:     "cyan" | "violet" | "gold" | "green" | "red";
}

const KIND_META: Record<string, KindMeta> = {
  // Generic
  swap:                  { Icon: Repeat,           labelKey: "zion.cardKindSwap",     tone: "cyan"   },
  bridge:                { Icon: Globe,            labelKey: "zion.cardKindBridge",   tone: "cyan"   },
  approve:               { Icon: ShieldCheck,      labelKey: "zion.cardKindApprove",  tone: "cyan"   },
  yield:                 { Icon: Coins,            labelKey: "zion.cardKindSwap",     tone: "green"  },

  // Arbitrage family
  arbitrage:             { Icon: TrendingUp,       labelKey: "zion.cardKindArb",      tone: "violet" },
  arbitrage_same_chain:  { Icon: TrendingUp,       labelKey: "zion.cardKindArbDex",   tone: "violet" },
  arbitrage_cross_chain: { Icon: Globe,            labelKey: "zion.cardKindArbChain", tone: "violet" },

  // Watch
  sniper_watch:          { Icon: Crosshair,        labelKey: "zion.cardKindSniper",   tone: "gold"   },

  // Orders
  limit:                 { Icon: Bot,              labelKey: "zion.cardKindLimit",    tone: "violet" },
  buy_limit:             { Icon: ArrowDownToLine,  labelKey: "zion.cardKindBuyLimit", tone: "cyan"   },
  sell_safe:             { Icon: ArrowUpFromLine,  labelKey: "zion.cardKindSellSafe", tone: "green"  },
  sell_medium:           { Icon: Target,           labelKey: "zion.cardKindSellMed",  tone: "gold"   },
  sell_aggressive:       { Icon: TrendingUp,       labelKey: "zion.cardKindSellAggr", tone: "violet" },
  stop_loss:             { Icon: ShieldX,          labelKey: "zion.cardKindStop",     tone: "red"    },
};

const TONE_CFG = {
  cyan:   { text: "text-cyan",   bg: "bg-cyan/10",   border: "border-cyan/30",   glow: "shadow-glow-cyan"   },
  violet: { text: "text-violet", bg: "bg-violet/10", border: "border-violet/30", glow: "shadow-glow-violet" },
  gold:   { text: "text-gold",   bg: "bg-gold/10",   border: "border-gold/30",   glow: "shadow-glow-gold"   },
  green:  { text: "text-green",  bg: "bg-green/10",  border: "border-green/30",  glow: "shadow-glow-green"  },
  red:    { text: "text-red",    bg: "bg-red/10",    border: "border-red/30",    glow: "shadow-glow-red"    },
} as const;

const RISK_CFG: Record<string, string> = {
  safe:    "text-green border-green/30 bg-green/5",
  caution: "text-gold border-gold/30 bg-gold/5",
  risky:   "text-gold border-gold/40 bg-gold/10",
  danger:  "text-red border-red/30 bg-red/5",
};

interface Props {
  card: ActionCard;
  index: number;
  onExecute: (card: ActionCard) => void;
}

const RISK_KEY: Record<string, MessageKey> = {
  safe:    "zion.riskSafe",
  caution: "zion.riskCaution",
  risky:   "zion.riskRisky",
  danger:  "zion.riskDanger",
};

const CONF_KEY: Record<string, MessageKey> = {
  high:   "zion.confHigh",
  medium: "zion.confMedium",
  low:    "zion.confLow",
};

export default function ActionCardView({ card, index, onExecute }: Props) {
  const meta = KIND_META[card.kind] ?? KIND_META.swap;
  const tone = TONE_CFG[meta.tone];
  const Icon = meta.Icon;
  const t    = useT();

  // Whether target return is a profit (+) or a stop (-)
  const isStopLoss = card.kind === "stop_loss";
  const targetText = card.targetReturn ?? card.estReturn;
  const riskLabel  = card.risk       ? t(RISK_KEY[card.risk] ?? "zion.riskSafe") : "";
  const confLabel  = card.confidence ? t(CONF_KEY[card.confidence] ?? "zion.confMedium") : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "rounded-xl border glass p-3.5 space-y-2.5",
        tone.border,
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0", tone.bg, tone.border)}>
          <Icon className={cn("w-3.5 h-3.5", tone.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("font-mono text-[9px] tracking-widest uppercase font-bold", tone.text)}>
              {t(meta.labelKey)}
            </span>
            <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">· {card.chain}</span>
            {card.risk && (
              <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", RISK_CFG[card.risk] ?? "text-ink-3 border-white/10")}>
                {riskLabel || card.risk}
              </span>
            )}
            {card.confidence && (
              <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest border border-white/10 px-1.5 py-0.5 rounded">
                {t("zion.confidence", { level: confLabel || card.confidence })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="font-display font-bold text-sm text-ink leading-snug break-words">{card.title}</div>

      {/* Summary */}
      {card.summary && (
        <div className="font-sans text-[12px] text-ink-2 leading-relaxed break-words">{card.summary}</div>
      )}

      {/* Trigger price (limit / stop) */}
      {card.triggerPrice && (
        <div className="rounded-lg border border-white/5 bg-bg-1/50 px-3 py-2 flex items-center justify-between">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("zion.triggerLabel")}</div>
          <div className={cn("font-display font-bold text-sm tabular-nums", isStopLoss ? "text-red" : tone.text)}>
            {card.triggerPrice}
          </div>
        </div>
      )}

      {/* Profit pretension — featured row */}
      {targetText && (
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-center justify-between",
          isStopLoss ? "border-red/20 bg-red/[0.04]" : "border-green/20 bg-green/[0.04]",
        )}>
          <div className={cn(
            "font-mono text-[10px] tracking-widest uppercase",
            isStopLoss ? "text-red/80" : "text-green/80",
          )}>
            {isStopLoss ? t("zion.maxLossLabel") : t("zion.targetLabel")}
          </div>
          <div className={cn(
            "font-display font-bold text-sm tabular-nums truncate ml-2",
            isStopLoss ? "text-red" : "text-green",
          )}>
            {targetText}
          </div>
        </div>
      )}

      {/* From / To */}
      {(card.from || card.to) && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-1/50 border border-white/5 min-w-0">
          {card.from && (
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{t("common.from")}</div>
              <div className="font-display font-bold text-xs text-ink truncate">
                {card.from.amount && <span className="text-ink-2">{card.from.amount} </span>}
                {card.from.symbol}
              </div>
            </div>
          )}
          <ArrowRight className="w-3 h-3 text-ink-3 flex-shrink-0" />
          {card.to && (
            <div className="flex-1 min-w-0 text-right">
              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{t("common.to")}</div>
              <div className="font-display font-bold text-xs text-ink truncate">{card.to.symbol}</div>
            </div>
          )}
        </div>
      )}

      {/* Cost — only when targetReturn doesn't already absorb the row */}
      {card.estCost && (
        <div className="rounded-lg border border-white/5 bg-bg-1/40 px-2.5 py-1.5 flex items-center justify-between">
          <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{t("common.cost")}</div>
          <div className="font-mono text-[11px] text-ink truncate ml-2">{card.estCost}</div>
        </div>
      )}

      {card.expiresIn && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-gold/80">
          <Zap className="w-2.5 h-2.5" />
          {t("zion.expires", { when: card.expiresIn })}
        </div>
      )}

      {/* Execute */}
      <button
        type="button"
        onClick={() => onExecute(card)}
        className={cn(
          "w-full mt-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-display font-bold text-xs tracking-widest uppercase transition-all",
          tone.bg, tone.border, tone.text, "hover:opacity-90 hover:" + tone.glow,
        )}
      >
        <Zap className="w-3 h-3" />
        {t("zion.executeProposal")}
      </button>
    </motion.div>
  );
}
