"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Layers, Network, Server } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { CHAINS } from "@/lib/chains";
import { SUPPORTED_CEX_IDS } from "@/lib/cex/types";
import { formatUsd } from "@/lib/format";

// Real, verifiable platform counts — derived from the same source of truth
// the rest of the app uses, never hardcoded marketing numbers.
const CHAIN_COUNT = CHAINS.length;            // 11
const CEX_COUNT   = SUPPORTED_CEX_IDS.length; // 10
// DEX route sources actually wired into the quote engine (see AboutView +
// useQuotes): 0x v2, LiFi, Jupiter, CoW Protocol.
const DEX_AGGREGATORS = ["0x", "LiFi", "Jupiter", "CoW"] as const;

type Tone = "cyan" | "violet" | "gold" | "green";

const TONES: Record<Tone, { ring: string; text: string; bg: string; border: string }> = {
  cyan:   { ring: "rgba(0,232,255,0.18)",  text: "text-cyan",   bg: "bg-cyan/10",   border: "border-cyan/20"   },
  violet: { ring: "rgba(159,95,255,0.18)", text: "text-violet", bg: "bg-violet/10", border: "border-violet/20" },
  gold:   { ring: "rgba(245,166,35,0.18)", text: "text-gold",   bg: "bg-gold/10",   border: "border-gold/20"   },
  green:  { ring: "rgba(0,224,135,0.18)",  text: "text-green",  bg: "bg-green/10",  border: "border-green/20"  },
};

export default function StatPanel() {
  const t = useT();

  // 24h DEX market volume — fetched live from DefiLlama via our cached proxy.
  // null = still loading; -1 = upstream unavailable (render a dash, no guess).
  const [volume24h, setVolume24h] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/stats/dex");
        const data = (await res.json()) as { ok: boolean; volume24h?: number };
        if (alive) setVolume24h(data.ok && typeof data.volume24h === "number" ? data.volume24h : -1);
      } catch {
        if (alive) setVolume24h(-1);
      }
    })();
    return () => { alive = false; };
  }, []);

  const volumeValue =
    volume24h === null ? null
    : volume24h < 0    ? "—"
    : formatUsd(volume24h, { compact: true });

  const stats: {
    icon:     typeof TrendingUp;
    labelKey: MessageKey;
    value:    string | null;
    note:     string;
    tone:     Tone;
  }[] = [
    { icon: TrendingUp, labelKey: "swap.statDexVolume",     value: volumeValue,            note: t("swap.statSourceMarket"), tone: "cyan"   },
    { icon: Layers,     labelKey: "swap.statAggregators",   value: String(DEX_AGGREGATORS.length), note: DEX_AGGREGATORS.join(" · "), tone: "violet" },
    { icon: Network,    labelKey: "swap.statChains",        value: String(CHAIN_COUNT),    note: t("swap.statLive"),         tone: "gold"   },
    { icon: Server,     labelKey: "swap.statCexIntegrated", value: String(CEX_COUNT),      note: t("swap.statSourceCcxt"),   tone: "green"  },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s, i) => {
        const Icon = s.icon;
        const cfg = TONES[s.tone];
        return (
          <motion.div
            key={s.labelKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="god-card relative rounded-xl border border-white/5 glass-pane p-3.5 sm:p-4 overflow-hidden group hover:border-white/10 transition-colors"
          >
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-40 transition-opacity group-hover:opacity-70" style={{ background: cfg.ring }} />
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-7 h-7 rounded-lg ${cfg.bg} ${cfg.border} border flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                </div>
                <span className={`font-mono text-[10px] ${cfg.text} truncate max-w-[60%] text-right`}>{s.note}</span>
              </div>
              {s.value === null ? (
                <div className="h-7 sm:h-8 w-20 rounded shimmer" />
              ) : (
                <div className="font-display font-bold text-xl sm:text-2xl text-ink leading-none">{s.value}</div>
              )}
              <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1.5">{t(s.labelKey)}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
