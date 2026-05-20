"use client";

import { ArrowLeftRight, Globe, Crosshair } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { SwapMode } from "@/lib/store/swap";

const TABS: { mode: SwapMode; label: string; Icon: typeof ArrowLeftRight; tagline: string }[] = [
  { mode: "swap",   label: "Swap",        Icon: ArrowLeftRight, tagline: "single-chain" },
  { mode: "cross",  label: "Cross-Chain", Icon: Globe,          tagline: "bridge + swap" },
  { mode: "sniper", label: "Sniper",      Icon: Crosshair,      tagline: "fresh pairs" },
];

export default function SwapModeTabs({
  mode, onChange,
}: {
  mode:     SwapMode;
  onChange: (m: SwapMode) => void;
}) {
  return (
    <div className="relative grid grid-cols-3 gap-1 p-1 rounded-xl border border-white/5 bg-bg-1/60">
      {TABS.map((t) => {
        const active = mode === t.mode;
        return (
          <button
            type="button"
            key={t.mode}
            onClick={() => onChange(t.mode)}
            className={cn(
              "relative z-10 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-colors min-w-0",
              active ? "text-cyan" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {active && (
              <motion.span
                layoutId="swap-mode-active"
                className="absolute inset-0 rounded-lg bg-cyan/[0.08] border border-cyan/25 shadow-[0_0_24px_-8px_rgba(0,232,255,0.5)]"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <t.Icon className="w-3.5 h-3.5 relative" />
            <span className="font-mono text-[10px] tracking-widest uppercase relative truncate">
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
