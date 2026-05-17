"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Flame } from "lucide-react";

const MOVERS = [
  { symbol: "WIF",   name: "dogwifhat",   chain: "Solana",   price: "$1.86",  change: 18.4, color: "#FF9CBF" },
  { symbol: "JUP",   name: "Jupiter",     chain: "Solana",   price: "$0.95",  change: 9.2,  color: "#FBA124" },
  { symbol: "GMX",   name: "GMX",         chain: "Arbitrum", price: "$24.6",  change: 7.1,  color: "#3D8FFF" },
  { symbol: "ARB",   name: "Arbitrum",    chain: "Arbitrum", price: "$0.78",  change: 4.6,  color: "#28A0F0" },
  { symbol: "OP",    name: "Optimism",    chain: "Optimism", price: "$1.62",  change: -3.2, color: "#FF0420" },
  { symbol: "CAKE",  name: "PancakeSwap", chain: "BSC",      price: "$2.85",  change: -1.8, color: "#D1884F" },
];

export default function TopMovers() {
  return (
    <div className="rounded-xl border border-white/5 glass-pane overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <Flame className="w-3.5 h-3.5 text-gold" />
        <span className="font-display font-bold text-sm text-ink">Hot Movers</span>
        <span className="ml-auto font-mono text-[9px] text-ink-4 tracking-widest uppercase">24h</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {MOVERS.map((m, i) => (
          <motion.button
            key={m.symbol + m.chain}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
          >
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0"
              style={{ background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}55` }}
            >
              {m.symbol.slice(0, 2)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-xs text-ink">{m.symbol}</div>
              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider">{m.chain}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xs text-ink">{m.price}</div>
              <div className={`flex items-center justify-end gap-0.5 font-mono text-[10px] ${m.change > 0 ? "text-green" : "text-red"}`}>
                {m.change > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {m.change > 0 ? "+" : ""}{m.change}%
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
