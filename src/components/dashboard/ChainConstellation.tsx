"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CHAINS, type Chain } from "@/lib/chains";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

// ─── Chain logo with gradient fallback ────────────────────────────────────
function ChainLogo({ chain }: { chain: Chain }) {
  const [failed, setFailed] = useState(false);

  if (chain.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={chain.logo}
        alt={chain.name}
        width={40}
        height={40}
        onError={() => setFailed(true)}
        className="w-10 h-10 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10"
      />
    );
  }

  // Gradient fallback for chains without a logo (ZETTA, zkSync, Linea)
  return (
    <span
      className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ring-1 ring-white/10"
      style={{ background: chain.gradient }}
    >
      <span className="font-display font-extrabold text-[11px] text-bg leading-none">
        {chain.short.slice(0, 3)}
      </span>
    </span>
  );
}

export default function ChainConstellation() {
  const t = useT();

  return (
    <div className="rounded-2xl border border-white/5 bg-bg-1/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/5">
        <span className="font-display font-extrabold text-sm text-ink">
          {t("swap.constellationLabel")}
        </span>
        <span
          className="ml-auto font-mono text-[9px] px-2 py-0.5 rounded-full border border-white/8 bg-white/[0.03] text-ink-3 tracking-widest uppercase"
        >
          {t("swap.constellationCount")}
        </span>
      </div>

      {/* Chain rows */}
      <div className="divide-y divide-white/[0.03]">
        {CHAINS.map((c, i) => (
          <motion.button
            key={c.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, ease: "easeOut" }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.025] active:bg-white/[0.04] transition-colors text-left group"
          >
            <ChainLogo chain={c} />

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-display font-bold text-[13px] text-ink leading-tight truncate">
                  {c.name}
                </span>
                {c.featured && (
                  <span className="font-mono text-[8px] text-cyan border border-cyan/30 bg-cyan/[0.07] px-1.5 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0">
                    {t("swap.featured")}
                  </span>
                )}
                {c.comingSoon && (
                  <span className="font-mono text-[8px] text-gold border border-gold/30 bg-gold/[0.07] px-1.5 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0">
                    {t("swap.soon")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {/* VM type badge */}
                <span
                  className="font-mono text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0"
                  style={{
                    background: `${c.color}15`,
                    color: c.color,
                    border: `1px solid ${c.color}30`,
                  }}
                >
                  {c.evm ? "EVM" : c.id === "solana" ? "SVM" : "ZVM"}
                </span>
                <span className="font-mono text-[9px] text-ink-4">·</span>
                <span className="font-mono text-[9px] text-ink-3 uppercase tracking-wider truncate">
                  {c.nativeToken}
                </span>
              </div>
            </div>

            {/* Live dot */}
            <span
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0 transition-all",
                c.comingSoon ? "opacity-30" : "opacity-100",
              )}
              style={{
                background: c.color,
                boxShadow: c.comingSoon ? "none" : `0 0 8px 1px ${c.color}80`,
              }}
            />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
