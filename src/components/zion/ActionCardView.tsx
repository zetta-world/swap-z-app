"use client";

import { motion } from "framer-motion";
import { Zap, ArrowRight, Bot, Repeat, Target, Coins, TrendingUp, ShieldCheck } from "lucide-react";
import type { ActionCard } from "@/lib/zion/parse";
import { cn } from "@/lib/cn";

const KIND_META: Record<string, { Icon: React.ComponentType<{ className?: string }>; label: string; tone: string }> = {
  swap:         { Icon: Repeat,      label: "Swap",         tone: "cyan"   },
  bridge:       { Icon: ArrowRight,  label: "Bridge",       tone: "cyan"   },
  arbitrage:    { Icon: TrendingUp,  label: "Arbitrage",    tone: "violet" },
  sniper_watch: { Icon: Target,      label: "Sniper",       tone: "gold"   },
  limit:        { Icon: Bot,         label: "Limit",        tone: "violet" },
  yield:        { Icon: Coins,       label: "Yield",        tone: "green"  },
  approve:      { Icon: ShieldCheck, label: "Approve",      tone: "cyan"   },
};

const TONE_CFG: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  cyan:   { text: "text-cyan",   bg: "bg-cyan/10",   border: "border-cyan/30",   glow: "shadow-glow-cyan"   },
  violet: { text: "text-violet", bg: "bg-violet/10", border: "border-violet/30", glow: "shadow-glow-violet" },
  gold:   { text: "text-gold",   bg: "bg-gold/10",   border: "border-gold/30",   glow: "shadow-glow-gold"   },
  green:  { text: "text-green",  bg: "bg-green/10",  border: "border-green/30",  glow: "shadow-glow-green"  },
  red:    { text: "text-red",    bg: "bg-red/10",    border: "border-red/30",    glow: "shadow-glow-red"    },
};

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

export default function ActionCardView({ card, index, onExecute }: Props) {
  const meta = KIND_META[card.kind] ?? KIND_META.swap;
  const tone = TONE_CFG[meta.tone];
  const Icon = meta.Icon;

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
      <div className="flex items-center gap-2">
        <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center", tone.bg, tone.border)}>
          <Icon className={cn("w-3.5 h-3.5", tone.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("font-mono text-[9px] tracking-widest uppercase font-bold", tone.text)}>
              {meta.label}
            </span>
            <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">· {card.chain}</span>
            {card.risk && (
              <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", RISK_CFG[card.risk] ?? "text-ink-3 border-white/10")}>
                {card.risk}
              </span>
            )}
            {card.confidence && (
              <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest border border-white/10 px-1.5 py-0.5 rounded">
                conf · {card.confidence}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="font-display font-bold text-sm text-ink leading-snug">{card.title}</div>

      {/* Summary */}
      {card.summary && (
        <div className="font-sans text-[12px] text-ink-2 leading-relaxed">{card.summary}</div>
      )}

      {/* From / To */}
      {(card.from || card.to) && (
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-1/50 border border-white/5">
          {card.from && (
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">From</div>
              <div className="font-display font-bold text-xs text-ink truncate">
                {card.from.amount && <span className="text-ink-2">{card.from.amount} </span>}
                {card.from.symbol}
              </div>
            </div>
          )}
          <ArrowRight className="w-3 h-3 text-ink-3 flex-shrink-0" />
          {card.to && (
            <div className="flex-1 min-w-0 text-right">
              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">To</div>
              <div className="font-display font-bold text-xs text-ink truncate">{card.to.symbol}</div>
            </div>
          )}
        </div>
      )}

      {/* Cost / Return / Expires */}
      <div className="grid grid-cols-2 gap-2">
        {card.estCost && (
          <div className="rounded-lg border border-white/5 bg-bg-1/40 px-2.5 py-1.5">
            <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">Cost</div>
            <div className="font-mono text-[11px] text-ink truncate">{card.estCost}</div>
          </div>
        )}
        {card.estReturn && (
          <div className="rounded-lg border border-white/5 bg-bg-1/40 px-2.5 py-1.5">
            <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">Output</div>
            <div className="font-mono text-[11px] text-green truncate">{card.estReturn}</div>
          </div>
        )}
      </div>

      {card.expiresIn && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-gold/80">
          <Zap className="w-2.5 h-2.5" />
          Expires {card.expiresIn}
        </div>
      )}

      {/* Execute */}
      <button
        onClick={() => onExecute(card)}
        className={cn(
          "w-full mt-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-display font-bold text-xs tracking-widest uppercase transition-all",
          tone.bg, tone.border, tone.text, "hover:opacity-90 hover:" + tone.glow,
        )}
      >
        <Zap className="w-3 h-3" />
        Execute proposal
      </button>
    </motion.div>
  );
}
