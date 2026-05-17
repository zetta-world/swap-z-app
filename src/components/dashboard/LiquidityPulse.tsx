"use client";

import { motion } from "framer-motion";

const TICKER_ROWS = [
  { symbol: "ETH/USDC",  chain: "Ethereum", tvl: "$142.8M", vol: "$892K",  change: "+0.42%", color: "#627EEA" },
  { symbol: "BNB/USDT",  chain: "BSC",       tvl: "$98.3M",  vol: "$654K",  change: "+1.20%", color: "#F3BA2F" },
  { symbol: "SOL/USDC",  chain: "Solana",    tvl: "$203.1M", vol: "$1.4M",  change: "-0.18%", color: "#14F195" },
  { symbol: "WBTC/ETH",  chain: "Ethereum", tvl: "$67.5M",  vol: "$420K",  change: "+0.06%", color: "#F7931A" },
  { symbol: "wstETH/ETH", chain: "Ethereum", tvl: "$312.7M", vol: "$2.1M",  change: "+0.02%", color: "#00A3FF" },
  { symbol: "ARB/USDC",  chain: "Arbitrum", tvl: "$54.2M",  vol: "$310K",  change: "+0.84%", color: "#28A0F0" },
  { symbol: "OP/USDC",   chain: "Optimism", tvl: "$32.8M",  vol: "$186K",  change: "-0.32%", color: "#FF0420" },
  { symbol: "AVAX/USDC", chain: "Avalanche", tvl: "$28.6M",  vol: "$172K",  change: "+0.51%", color: "#E84142" },
];

export default function LiquidityPulse() {
  // Duplicate rows so the marquee loops seamlessly
  const rows = [...TICKER_ROWS, ...TICKER_ROWS];

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/5 glass-pane">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
        <span className="font-mono text-[10px] text-cyan tracking-widest uppercase">Liquidity Pulse</span>
        <span className="font-mono text-[9px] text-ink-4">Top pools across the Nexus · live</span>
      </div>

      <div className="relative">
        <motion.div
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 60, ease: "linear", repeat: Infinity }}
          className="flex"
        >
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-5 py-3 border-r border-white/5 flex-shrink-0"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color, boxShadow: `0 0 8px ${r.color}` }} />
              <span className="font-display font-bold text-xs text-ink whitespace-nowrap">{r.symbol}</span>
              <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider whitespace-nowrap">{r.chain}</span>
              <span className="font-mono text-[10px] text-ink-2 whitespace-nowrap">TVL {r.tvl}</span>
              <span className="font-mono text-[10px] text-ink-3 whitespace-nowrap">Vol {r.vol}</span>
              <span className={`font-mono text-[10px] whitespace-nowrap ${r.change.startsWith("+") ? "text-green" : "text-red"}`}>{r.change}</span>
            </div>
          ))}
        </motion.div>

        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-bg-1 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg-1 to-transparent" />
      </div>
    </div>
  );
}
