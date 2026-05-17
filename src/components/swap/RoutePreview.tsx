"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { Token } from "@/lib/tokens";

interface Hop {
  protocol: string;
  pool: string;
  share: number;   // 0-1
  color: string;
}

const SAMPLE_HOPS: Hop[] = [
  { protocol: "Uniswap V3", pool: "ETH/USDC 0.05%", share: 0.62, color: "#FF007A" },
  { protocol: "Curve",      pool: "3pool",          share: 0.23, color: "#3676FF" },
  { protocol: "Balancer",   pool: "wstETH/USDC",    share: 0.15, color: "#FF6B00" },
];

export default function RoutePreview({
  from,
  to,
  showSavings = true,
}: {
  from: Token | undefined;
  to:   Token | undefined;
  showSavings?: boolean;
}) {
  if (!from || !to) return null;

  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">Optimal Route</span>
        <span className="font-mono text-[10px] text-cyan tracking-widest uppercase flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
          Live
        </span>
      </div>

      {/* Route flow */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-2 px-2">
        <RouteNode token={from.symbol} color={from.color || "#00E8FF"} />
        <div className="flex-1 flex items-center min-w-0 px-1">
          <RoutePipe />
        </div>
        <RouteNode token={to.symbol} color={to.color || "#9F5FFF"} />
      </div>

      {/* Hop breakdown */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        {SAMPLE_HOPS.map((h, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: h.color, boxShadow: `0 0 8px ${h.color}` }}
              />
              <span className="font-mono text-[11px] text-ink-2 truncate">{h.protocol}</span>
              <span className="font-mono text-[10px] text-ink-4 truncate">{h.pool}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${h.share * 100}%`, background: h.color }}
                />
              </div>
              <span className="font-mono text-[11px] text-ink-2 w-9 text-right">
                {(h.share * 100).toFixed(0)}%
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {showSavings && (
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">vs. Direct</span>
          <span className="font-mono text-[11px] text-green">+0.42% better · saves $18 gas</span>
        </div>
      )}
    </div>
  );
}

function RouteNode({ token, color }: { token: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center font-mono text-[10px] font-bold"
        style={{
          background: `${color}22`,
          color,
          border: `1px solid ${color}66`,
          boxShadow: `0 0 12px ${color}33`,
        }}
      >
        {token.slice(0, 3)}
      </div>
      <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{token}</span>
    </div>
  );
}

function RoutePipe() {
  return (
    <div className="relative w-full h-px bg-gradient-to-r from-cyan/40 via-violet/40 to-gold/40">
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className="absolute top-1/2 -translate-y-1/2 w-12 h-2 rounded-full bg-gradient-to-r from-transparent via-cyan to-transparent blur-sm"
      />
      <ArrowRight className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 text-cyan" />
    </div>
  );
}
