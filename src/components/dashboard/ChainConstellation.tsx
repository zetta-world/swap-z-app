"use client";

import { motion } from "framer-motion";
import { CHAINS } from "@/lib/chains";

export default function ChainConstellation() {
  return (
    <div className="rounded-xl border border-white/5 glass-pane overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="font-display font-bold text-sm text-ink">Constellation</span>
        <span className="ml-auto font-mono text-[9px] text-ink-4 tracking-widest uppercase">11 chains</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {CHAINS.map((c, i) => (
          <motion.button
            key={c.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left group"
          >
            <span
              className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center"
              style={{ background: c.gradient }}
            >
              <span className="font-display font-extrabold text-[10px] text-bg leading-none">
                {c.short.slice(0, 3)}
              </span>
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-display font-bold text-xs text-ink truncate">{c.name}</span>
                {c.featured && (
                  <span className="font-mono text-[8px] text-cyan border border-cyan/30 bg-cyan/5 px-1 py-0.5 rounded uppercase tracking-widest">
                    Featured
                  </span>
                )}
                {c.comingSoon && (
                  <span className="font-mono text-[8px] text-gold border border-gold/30 bg-gold/5 px-1 py-0.5 rounded uppercase tracking-widest">
                    Soon
                  </span>
                )}
              </div>
              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider mt-0.5">
                {c.evm ? "EVM" : c.id === "solana" ? "SVM" : "ZVM"} · {c.nativeToken}
              </div>
            </div>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
