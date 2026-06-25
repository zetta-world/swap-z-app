"use client";

import { motion } from "framer-motion";
import {
  Zap, ArrowRight, Bot, Repeat, Target, TrendingUp, ShieldCheck,
  ArrowDownToLine, ArrowUpFromLine, ShieldX, Globe, Crosshair,
  Clock, Wallet, Scale, TrendingDown,
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
  swap:                  { Icon: Repeat,           labelKey: "zion.cardKindSwap",     tone: "cyan"   },
  bridge:                { Icon: Globe,            labelKey: "zion.cardKindBridge",   tone: "cyan"   },
  approve:               { Icon: ShieldCheck,      labelKey: "zion.cardKindApprove",  tone: "cyan"   },
  arbitrage:             { Icon: TrendingUp,       labelKey: "zion.cardKindArb",      tone: "violet" },
  arbitrage_same_chain:  { Icon: TrendingUp,       labelKey: "zion.cardKindArbDex",   tone: "violet" },
  arbitrage_cross_chain: { Icon: Globe,            labelKey: "zion.cardKindArbChain", tone: "violet" },
  arbitrage_dex_cex:     { Icon: TrendingUp,       labelKey: "zion.cardKindArbDexCex", tone: "gold"   },
  arbitrage_cross_cex:   { Icon: TrendingUp,       labelKey: "zion.cardKindArbCrossCex", tone: "green" },
  sniper_watch:          { Icon: Crosshair,        labelKey: "zion.cardKindSniper",   tone: "gold"   },
  limit:                 { Icon: Bot,              labelKey: "zion.cardKindLimit",    tone: "violet" },
  buy_limit:             { Icon: ArrowDownToLine,  labelKey: "zion.cardKindBuyLimit", tone: "cyan"   },
  sell_safe:             { Icon: ArrowUpFromLine,  labelKey: "zion.cardKindSellSafe", tone: "green"  },
  sell_medium:           { Icon: Target,           labelKey: "zion.cardKindSellMed",  tone: "gold"   },
  sell_aggressive:       { Icon: TrendingUp,       labelKey: "zion.cardKindSellAggr", tone: "violet" },
  stop_loss:             { Icon: ShieldX,          labelKey: "zion.cardKindStop",     tone: "red"    },
};

const KNOWN_KINDS = new Set(Object.keys(KIND_META));

const TONE_CFG = {
  cyan:   { text: "text-cyan",   bg: "bg-cyan/10",   border: "border-cyan/30",   glow: "shadow-glow-cyan",   hoverGlow: "hover:shadow-glow-cyan"   },
  violet: { text: "text-violet", bg: "bg-violet/10", border: "border-violet/30", glow: "shadow-glow-violet", hoverGlow: "hover:shadow-glow-violet" },
  gold:   { text: "text-gold",   bg: "bg-gold/10",   border: "border-gold/30",   glow: "shadow-glow-gold",   hoverGlow: "hover:shadow-glow-gold"   },
  green:  { text: "text-green",  bg: "bg-green/10",  border: "border-green/30",  glow: "shadow-glow-green",  hoverGlow: "hover:shadow-glow-green"  },
  red:    { text: "text-red",    bg: "bg-red/10",    border: "border-red/30",    glow: "shadow-glow-red",    hoverGlow: "hover:shadow-glow-red"    },
} as const;

const RISK_CFG: Record<string, string> = {
  safe:    "text-green border-green/30 bg-green/5",
  caution: "text-gold border-gold/30 bg-gold/5",
  risky:   "text-gold border-gold/40 bg-gold/10",
  danger:  "text-red border-red/30 bg-red/5",
};

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

interface Props {
  card:      ActionCard;
  index:     number;
  onExecute: (card: ActionCard) => void;
}

/**
 * Renders a ZION ActionCard as a detailed trade thesis card. The model
 * fills the rich fields (entryPrice, stopLoss, expectedProfitPct, riskReward,
 * timeframe, exits[]) per the foundation prompt; this component lays them
 * out cleanly. Empty fields are silently skipped so minimal cards (e.g.
 * a plain approve / arbitrage row) still render compactly.
 */
export default function ActionCardView({ card, index, onExecute }: Props) {
  if (!KNOWN_KINDS.has(card.kind) && process.env.NODE_ENV !== "production") {
    // Unknown kind means the model emitted something outside the foundation
    // schema. We still render with the "swap" fallback so the card isn't lost,
    // but warn so the prompt can be tightened.
    console.warn("[zion/ActionCard] unknown kind, falling back to swap:", card.kind);
  }
  const meta = KIND_META[card.kind] ?? KIND_META.swap;
  const tone = TONE_CFG[meta.tone];
  const Icon = meta.Icon;
  const t    = useT();

  const isStopLoss = card.kind === "stop_loss";
  const riskLabel  = card.risk       ? t(RISK_KEY[card.risk] ?? "zion.riskSafe") : "";
  const confLabel  = card.confidence ? t(CONF_KEY[card.confidence] ?? "zion.confMedium") : "";

  // Pull the probability out as a clamped 0-100 integer for the badge color
  // (free-form string in the schema, so "~65%", "65" and "0.65" all collapse).
  const probabilityNum = (() => {
    if (!card.probability) return null;
    const m = String(card.probability).match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (n > 0 && n <= 1) n *= 100;
    return Math.max(0, Math.min(100, Math.round(n)));
  })();

  // Pick the headline number to surface in the big top row. Preference order:
  // expectedProfitPct (richest), then targetReturn, then estReturn.
  const headlineNumber = card.expectedProfitPct
    ?? card.targetReturn
    ?? card.estReturn
    ?? null;

  const hasTradeThesis = !!(
    card.entryPrice || card.stopLoss || card.expectedProfitPct ||
    card.riskReward || card.timeframe || card.positionSize ||
    (card.exits && card.exits.length > 0)
  );

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
      {/* Header — kind chip + chain + risk + confidence */}
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
            {probabilityNum !== null && (
              <span className={cn(
                "font-mono text-[9px] tracking-widest uppercase border px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-bold",
                probabilityNum >= 65 ? "text-green border-green/40 bg-green/[0.06]" :
                probabilityNum >= 40 ? "text-gold  border-gold/40  bg-gold/[0.06]" :
                                       "text-red   border-red/40   bg-red/[0.06]",
              )}>
                <Scale className="w-2.5 h-2.5" />
                {t("zion.probabilityBadge", { p: probabilityNum })}
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

      {/* From / To row */}
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

      {/* Headline number — only when the model gave us a strong signal */}
      {headlineNumber && (
        <div className={cn(
          "rounded-lg border px-3 py-2.5 flex items-center justify-between gap-2 min-w-0",
          isStopLoss ? "border-red/30 bg-red/[0.06]" : "border-green/30 bg-green/[0.06]",
        )}>
          <div className={cn(
            "inline-flex items-center gap-1.5 font-mono text-[10px] tracking-widest uppercase flex-shrink-0",
            isStopLoss ? "text-red/80" : "text-green/80",
          )}>
            {isStopLoss
              ? <><TrendingDown className="w-3 h-3" />{t("zion.maxLossLabel")}</>
              : <><TrendingUp   className="w-3 h-3" />{card.expectedProfitPct ? t("zion.profitLabel") : t("zion.targetLabel")}</>}
          </div>
          <div className={cn(
            "font-display font-extrabold text-lg tabular-nums truncate",
            isStopLoss ? "text-red" : "text-green",
          )}>
            {headlineNumber}
          </div>
        </div>
      )}

      {/* Trade-thesis grid: Entry · Stop · R/R · Timeframe · Size · Trigger */}
      {hasTradeThesis && (
        <div className="grid grid-cols-2 gap-1.5">
          {card.entryPrice && (
            <ThesisCell
              Icon={ArrowDownToLine}
              label={t("zion.entryPriceLabel")}
              value={card.entryPrice}
              tone="cyan"
            />
          )}
          {card.stopLoss && !isStopLoss && (
            <ThesisCell
              Icon={ShieldX}
              label={t("zion.stopLossLabel")}
              value={card.stopLoss}
              tone="red"
            />
          )}
          {card.triggerPrice && card.triggerPrice !== card.entryPrice && (
            <ThesisCell
              Icon={Bot}
              label={t("zion.triggerLabel")}
              value={card.triggerPrice}
              tone={isStopLoss ? "red" : "violet"}
            />
          )}
          {card.riskReward && (
            <ThesisCell
              Icon={Scale}
              label={t("zion.riskRewardLabel")}
              value={card.riskReward}
              tone="gold"
            />
          )}
          {card.timeframe && (
            <ThesisCell
              Icon={Clock}
              label={t("zion.timeframeLabel")}
              value={card.timeframe}
              tone="cyan"
            />
          )}
          {card.positionSize && (
            <ThesisCell
              Icon={Wallet}
              label={t("zion.positionSizeLabel")}
              value={card.positionSize}
              tone="violet"
            />
          )}
        </div>
      )}

      {/* Exit ladder (Safe / Balanced / Stretch) */}
      {card.exits && card.exits.length > 0 && (
        <div className="rounded-lg border border-white/5 bg-bg-1/40 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-white/5 bg-white/[0.02] font-mono text-[9px] text-green tracking-widest uppercase">
            {t("zion.exitLadderLabel")}
          </div>
          <div className="divide-y divide-white/[0.04]">
            {card.exits.map((rung, i) => (
              <div key={i} className="px-3 py-2 grid grid-cols-12 gap-2 min-w-0 items-center">
                <div className="col-span-3 font-display font-bold text-xs text-ink truncate">{rung.label}</div>
                <div className="col-span-3 font-mono text-xs text-ink tabular-nums truncate">{rung.price}</div>
                <div className="col-span-2 font-mono text-xs text-green tabular-nums truncate">{rung.profitPct}</div>
                {rung.probability && (
                  <div className="col-span-2 font-mono text-[10px] text-ink-3 tabular-nums truncate">
                    {t("zion.probabilityShort", { p: rung.probability })}
                  </div>
                )}
                {rung.sizeFraction && (
                  <div className="col-span-2 font-mono text-[10px] text-violet tabular-nums truncate text-right">
                    {t("zion.sizeFractionShort", { pct: rung.sizeFraction })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost row (gas + bridge fees) */}
      {card.estCost && (
        <div className="rounded-lg border border-white/5 bg-bg-1/40 px-2.5 py-1.5 flex items-center justify-between">
          <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{t("common.cost")}</div>
          <div className="font-mono text-[11px] text-ink truncate ml-2">{card.estCost}</div>
        </div>
      )}

      {/* Expiry */}
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
          tone.bg, tone.border, tone.text, "hover:opacity-90", tone.hoverGlow,
        )}
      >
        <Zap className="w-3 h-3" />
        {t("zion.executeProposal")}
      </button>
    </motion.div>
  );
}

// ─── Helper sub-components ─────────────────────────────────────────────

function ThesisCell({
  Icon, label, value, tone,
}: {
  Icon:  React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone:  "cyan" | "violet" | "gold" | "green" | "red";
}) {
  const cfg = TONE_CFG[tone];
  return (
    <div className={cn(
      "rounded-md border bg-bg-1/40 px-2.5 py-1.5 min-w-0",
      cfg.border,
    )}>
      <div className={cn("flex items-center gap-1 font-mono text-[9px] tracking-widest uppercase mb-0.5", cfg.text)}>
        <Icon className="w-2.5 h-2.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="font-mono text-[12px] text-ink tabular-nums truncate">{value}</div>
    </div>
  );
}
