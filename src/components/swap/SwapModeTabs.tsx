"use client";

import { ArrowLeftRight, Globe, Crosshair } from "lucide-react";
import { motion } from "framer-motion";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { SwapMode } from "@/lib/store/swap";

// "cross" mode is intentionally absent — cross-chain has its own dedicated
// page at /bridge (linked from the CTA under the swap card). Keeping it
// out of the tabs avoids the "Multi-rede" label crowding the same-chain
// swap UI when there's already a clear path to /bridge.
const TABS: { mode: SwapMode; labelKey: MessageKey; Icon: typeof ArrowLeftRight }[] = [
  { mode: "swap",   labelKey: "swap.titleSwap",   Icon: ArrowLeftRight },
  { mode: "sniper", labelKey: "swap.titleSniper", Icon: Crosshair      },
];
// Globe kept imported for future use; suppress unused-import lint
void Globe;

export default function SwapModeTabs({
  mode, onChange,
}: {
  mode:     SwapMode;
  onChange: (m: SwapMode) => void;
}) {
  const t = useT();
  return (
    <div className="relative grid grid-cols-2 gap-1 p-1 rounded-xl border border-white/5 bg-bg-1/60">
      {TABS.map((tab) => {
        const active = mode === tab.mode;
        return (
          <button
            type="button"
            key={tab.mode}
            onClick={() => onChange(tab.mode)}
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
            <tab.Icon className="w-3.5 h-3.5 relative" />
            <span className="font-mono text-[10px] tracking-widest uppercase relative truncate">
              {t(tab.labelKey)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
