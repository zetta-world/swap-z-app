"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Token } from "@/lib/tokens";

export interface Hop {
  protocol: string;
  share:    number;   // 0-1
  color:    string;
}

const FALLBACK_HOPS: Hop[] = [
  { protocol: "Uniswap V3",  share: 0.62, color: "#FF007A" },
  { protocol: "Curve",       share: 0.23, color: "#3676FF" },
  { protocol: "Balancer V2", share: 0.15, color: "#FF6B00" },
];

// Brand colors for known DEX sources from 0x
const DEX_COLOR: Record<string, string> = {
  uniswap_v2:   "#FF007A",
  uniswap_v3:   "#FF007A",
  uniswap_v4:   "#FF007A",
  pancakeswap:  "#F3BA2F",
  pancakeswap_v2: "#F3BA2F",
  pancakeswap_v3: "#F3BA2F",
  curve:        "#3676FF",
  curve_v2:     "#3676FF",
  balancer:     "#FF6B00",
  balancer_v2:  "#FF6B00",
  sushi:        "#FA52A0",
  sushiswap:    "#FA52A0",
  maverick:     "#FF5C8A",
  aerodrome:    "#5046E5",
  velodrome:    "#FF0420",
  trader_joe:   "#E84142",
  raydium:      "#14F195",
  zeroex:       "#00E8FF",
};

function colorFor(source: string): string {
  const key = source.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return DEX_COLOR[key] ?? "#9F5FFF";
}

function prettySource(source: string): string {
  return source
    .replace(/_/g, " ")
    .replace(/\b(v\d)\b/gi, (m) => m.toUpperCase());
}

export default function RoutePreview({
  from, to, hops: hopsIn = null, sourceLabel, showSavings = true,
}: {
  from:  Token | undefined;
  to:    Token | undefined;
  hops?: { protocol: string; share: number; color?: string }[] | null;
  sourceLabel?: string;
  showSavings?: boolean;
}) {
  const t = useT();
  if (!from || !to) return null;

  // Normalize hops into the local Hop shape; fall back to a curated default
  const hops: Hop[] = hopsIn && hopsIn.length > 0
    ? hopsIn
        .map((h) => ({
          protocol: prettySource(h.protocol),
          share:    h.share,
          color:    h.color ?? colorFor(h.protocol),
        }))
        .filter((h) => h.share > 0)
        .sort((a, b) => b.share - a.share)
        .slice(0, 5)
    : FALLBACK_HOPS;

  const isLive = hopsIn !== null;

  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">{t("swap.optimalRoute")}</span>
        <span className={`font-mono text-[10px] tracking-widest uppercase flex items-center gap-1.5 ${isLive ? "text-cyan" : "text-ink-3"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-cyan pulse-dot" : "bg-ink-4"}`} />
          {isLive ? t("swap.routeSampleLive", { label: sourceLabel ?? t("swap.routeRouter") }) : t("swap.routeSample")}
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
        {hops.map((h, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: h.color, boxShadow: `0 0 8px ${h.color}` }}
              />
              <span className="font-mono text-[11px] text-ink-2 truncate">{h.protocol}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-16 h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${h.share * 100}%`, background: h.color }}
                />
              </div>
              <span className="font-mono text-[11px] text-ink-2 w-10 text-right">
                {(h.share * 100).toFixed(h.share < 0.01 ? 2 : 0)}%
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {showSavings && !isLive && (
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">{t("swap.routeDemoLabel")}</span>
          <span className="font-mono text-[11px] text-ink-3">{t("swap.routeRealFills")}</span>
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
