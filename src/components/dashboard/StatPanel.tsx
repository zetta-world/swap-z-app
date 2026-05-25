"use client";

import { motion } from "framer-motion";
import { TrendingUp, Layers, Network, Shield } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";

const STATS: { icon: typeof TrendingUp; labelKey: MessageKey; value: string; change: string; changeIsKey?: MessageKey; tone: "cyan" | "violet" | "gold" | "green" }[] = [
  { icon: TrendingUp, labelKey: "swap.stat24hVolume", value: "$2.84B",   change: "+12.4%",                            tone: "cyan"   },
  { icon: Layers,     labelKey: "swap.statPools",      value: "8,420",    change: "+128",                              tone: "violet" },
  { icon: Network,    labelKey: "swap.statChains",     value: "11",       change: "Live",   changeIsKey: "swap.statLive", tone: "gold" },
  { icon: Shield,     labelKey: "swap.statMevSaved",   value: "$148K",    change: "+8.6%",                             tone: "green"  },
];

const TONES = {
  cyan:   { ring: "rgba(0,232,255,0.18)",  text: "text-cyan",   bg: "bg-cyan/10",   border: "border-cyan/20"   },
  violet: { ring: "rgba(159,95,255,0.18)", text: "text-violet", bg: "bg-violet/10", border: "border-violet/20" },
  gold:   { ring: "rgba(245,166,35,0.18)", text: "text-gold",   bg: "bg-gold/10",   border: "border-gold/20"   },
  green:  { ring: "rgba(0,224,135,0.18)",  text: "text-green",  bg: "bg-green/10",  border: "border-green/20"  },
} as const;

export default function StatPanel() {
  const t = useT();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {STATS.map((s, i) => {
        const Icon = s.icon;
        const cfg = TONES[s.tone];
        const label = t(s.labelKey);
        const change = s.changeIsKey ? t(s.changeIsKey) : s.change;
        return (
          <motion.div
            key={s.labelKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-xl border border-white/5 glass-pane p-3.5 sm:p-4 overflow-hidden group hover:border-white/10 transition-colors"
          >
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-40 transition-opacity group-hover:opacity-70" style={{ background: cfg.ring }} />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-7 h-7 rounded-lg ${cfg.bg} ${cfg.border} border flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                </div>
                <span className={`font-mono text-[10px] ${cfg.text}`}>{change}</span>
              </div>
              <div className="font-display font-bold text-xl sm:text-2xl text-ink leading-none">{s.value}</div>
              <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1.5">{label}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
