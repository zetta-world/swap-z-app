"use client";

import { motion } from "framer-motion";
import {
  Sparkles, TrendingUp, Globe, Crosshair, FileText, Zap, ArrowRight, Bot,
} from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/cn";

interface ModeCard {
  Icon:     React.ComponentType<{ className?: string }>;
  label:    string;
  tone:     "cyan" | "violet" | "gold" | "green";
  tagline:  string;
  emits:    string[];
}

const MODES: ModeCard[] = [
  {
    Icon:    TrendingUp,
    label:   "Trading",
    tone:    "cyan",
    tagline: "Entry zone · 3 profit targets · stop loss · R/R · timeframe",
    emits:   ["buy_limit", "sell_safe", "sell_medium", "sell_aggressive", "stop_loss"],
  },
  {
    Icon:    Globe,
    label:   "Arbitrage",
    tone:    "violet",
    tagline: "Hunts spreads across DEXes + across chains. With execution recipe.",
    emits:   ["arbitrage_same_chain", "arbitrage_cross_chain"],
  },
  {
    Icon:    Crosshair,
    label:   "Sniper",
    tone:    "gold",
    tagline: "Paranoid scanner for fresh pairs. LP locks, holder map, dev wallet.",
    emits:   ["sniper_watch", "swap (rare, only on exceptional setups)"],
  },
  {
    Icon:    FileText,
    label:   "Deep",
    tone:    "green",
    tagline: "Pair analysis — discovery + security + liquidity + flow + verdict.",
    emits:   ["swap or buy_limit when warranted, else watch-only"],
  },
];

const TONE: Record<ModeCard["tone"], { border: string; bg: string; text: string }> = {
  cyan:   { border: "border-cyan/20",   bg: "bg-cyan/[0.04]",   text: "text-cyan"   },
  violet: { border: "border-violet/20", bg: "bg-violet/[0.04]", text: "text-violet" },
  gold:   { border: "border-gold/20",   bg: "bg-gold/[0.04]",   text: "text-gold"   },
  green:  { border: "border-green/20",  bg: "bg-green/[0.04]",  text: "text-green"  },
};

/**
 * ZION landing page — explains the AI advisory layer and points the user
 * to the drawer. The actual interaction surface is the drawer; this page
 * exists because the sidebar entry needs a destination and a chance to
 * orient new users.
 */
export default function ZionLanding() {
  const { setZion } = useUI();

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/3 w-[420px] h-[420px] rounded-full bg-gold/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[360px] h-[360px] rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-12 max-w-6xl mx-auto">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-gold" />
            <span className="font-mono text-[10px] text-gold/90 tracking-widest uppercase">
              ZION · Claude Haiku 4.5 · advisory layer
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(2rem,5vw,3.4rem)] leading-[0.98] tracking-[-0.02em] text-ink mb-3">
            Trading-desk intelligence,{" "}
            <span className="text-grad-aurora">surgical and explainable.</span>
          </h1>
          <p className="font-sans text-base sm:text-lg text-ink-2/95 leading-relaxed max-w-2xl">
            ZION reads pools, contracts, holder behaviour and live spreads to produce a
            complete thesis — entry, exits, stop, R/R — for every pair you load. Four
            specialized modes, each with its own playbook. You confirm; ZION never
            touches your wallet.
          </p>
          <button
            type="button"
            onClick={() => setZion(true)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-gold/40 bg-gold/[0.08] text-gold hover:bg-gold/[0.14] hover:border-gold/60 transition-all font-display font-bold text-sm tracking-wide group"
          >
            <Zap className="w-4 h-4" />
            Open ZION drawer
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </motion.div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {MODES.map((m, i) => {
            const tone = TONE[m.tone];
            const Icon = m.Icon;
            return (
              <motion.button
                key={m.label}
                onClick={() => setZion(true)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={cn(
                  "rounded-2xl border p-4 sm:p-5 min-w-0 text-left transition-all",
                  tone.border, tone.bg,
                  "hover:scale-[1.01]",
                )}
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center border", tone.border, tone.bg)}>
                    <Icon className={cn("w-4 h-4", tone.text)} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-ink">{m.label}</div>
                    <div className={cn("font-mono text-[10px] tracking-widest uppercase", tone.text)}>
                      mode tab
                    </div>
                  </div>
                </div>
                <p className="font-sans text-xs text-ink-2 leading-relaxed">{m.tagline}</p>
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1.5">
                    Emits action cards
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {m.emits.map((e) => (
                      <span
                        key={e}
                        className="font-mono text-[9px] text-ink-2 px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/5"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* How it works */}
        <div className="rounded-2xl border border-white/5 glass-pane p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-4 h-4 text-cyan" />
            <span className="section-label">How it works</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Step n={1} title="Pick a pair" body="Set the from/to tokens on any chain — ZION auto-loads the context (price, security, liquidity, holders, recent flow)." />
            <Step n={2} title="Pick a mode"  body="Trading for entry/exit, Arbitrage to hunt spreads, Sniper for fresh pairs, Deep for structural breakdown. Ask anything in the input bar." />
            <Step n={3} title="Confirm or skip" body="ZION emits action cards. Immediate cards (swap, bridge, arbitrage) open the real execute modal. Conditional cards (limit, stop, sniper-watch) save to /orders for manual fire." />
          </div>
        </div>

        {/* Footer note */}
        <p className="font-mono text-[10px] text-ink-4 text-center mt-6">
          ZION is advisory only. Every action requires your signature. Powered by Claude Haiku 4.5
          with prompt-cached foundation + mode-specific instructions.
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-5 h-5 rounded-md bg-gold/15 border border-gold/30 flex items-center justify-center font-display font-extrabold text-[10px] text-gold flex-shrink-0">
          {n}
        </div>
        <div className="font-display font-bold text-xs text-ink">{title}</div>
      </div>
      <p className="font-sans text-[11px] text-ink-2 leading-relaxed">{body}</p>
    </div>
  );
}
