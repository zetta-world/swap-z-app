"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

interface RingData {
  /** Display label inside the ring center (TXNS / VOL / WALLETS). */
  label:    string;
  /** Headline value to draw in the ring (e.g. "62k", "$3.3M"). */
  value:    string;
  /** Buy/sell composition; both 0–1, sum should be ~1. */
  buy:      number;
  sell:     number;
  /** Sub-text under the value. */
  detail?:  string;
}

/**
 * Z-SWAP Flow Sphere. Three concentric SVG rings — TXNS · VOLUME · WALLETS —
 * each split into a green (buy) and red (sell) arc proportional to the
 * pair's 24h pressure. The innermost label rotates slowly; the green/red
 * arcs pulse opacity to convey live activity. No Three.js needed — pure
 * SVG + framer-motion stays under 5kB and renders crisp on every device.
 *
 * Why this beats DexScreener's horizontal buy/sell bars: those need two
 * separate visual scans (count vs volume). The sphere overlays all three
 * dimensions in one read. At a glance: are buyers winning *and* moving
 * size *and* are unique wallets buying? You see the ratio in one shape.
 */
export default function FlowSphere({
  rings, dominantTone = "neutral",
}: {
  rings:         [RingData, RingData, RingData];
  dominantTone?: "buy" | "sell" | "neutral";
}) {
  // Hard-coded ring radii (in SVG units). The viewBox is 200 × 200; center 100,100.
  const R = [88, 64, 40] as const;
  const STROKE = 10;

  // Net pressure across all three rings → tints the centerpiece
  const totalBuy  = rings.reduce((acc, r) => acc + r.buy,  0);
  const totalSell = rings.reduce((acc, r) => acc + r.sell, 0);
  const net = totalBuy - totalSell; // -3 to +3 range
  const tone =
    dominantTone !== "neutral" ? dominantTone :
    net >  0.15 ? "buy"  :
    net < -0.15 ? "sell" :
                  "neutral";

  const accent =
    tone === "buy"  ? "#27D49B" :
    tone === "sell" ? "#FF5C5C" :
                      "#00E8FF";

  const innerColor = useMemo(() => {
    if (tone === "buy")  return "rgba(39,212,155,0.06)";
    if (tone === "sell") return "rgba(255,92,92,0.06)";
    return "rgba(0,232,255,0.06)";
  }, [tone]);

  return (
    <div className="relative w-full max-w-[340px] mx-auto aspect-square">
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full"
        role="img"
        aria-label="Buy / sell flow sphere"
      >
        <defs>
          <radialGradient id="flow-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor={accent} stopOpacity="0.22" />
            <stop offset="60%" stopColor={accent} stopOpacity="0.04" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          {/* Per-ring buy/sell gradients */}
          <linearGradient id="ring-buy"  x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#27D49B" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#27D49B" stopOpacity="1" />
            <stop offset="100%" stopColor="#27D49B" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="ring-sell" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#FF5C5C" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#FF5C5C" stopOpacity="1" />
            <stop offset="100%" stopColor="#FF5C5C" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* Halo */}
        <circle cx="100" cy="100" r="98" fill="url(#flow-glow)" />

        {/* Outer rotating tick ring — subtle, conveys "live data" */}
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 60, ease: "linear", repeat: Infinity }}
          style={{ transformOrigin: "100px 100px" }}
        >
          {Array.from({ length: 36 }).map((_, i) => (
            <line
              key={i}
              x1="100" y1="6" x2="100" y2={i % 9 === 0 ? 12 : 9}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="0.7"
              transform={`rotate(${i * 10} 100 100)`}
            />
          ))}
        </motion.g>

        {/* Three pressure rings */}
        {rings.map((ring, i) => (
          <Ring key={i} cx={100} cy={100} radius={R[i]} stroke={STROKE} {...ring} delay={i * 0.4} />
        ))}

        {/* Inner core — soft tint, net-pressure colored */}
        <circle cx="100" cy="100" r={R[2] - STROKE - 1} fill={innerColor} stroke={`${accent}40`} />
      </svg>

      {/* HTML overlay — labels stay sharp regardless of SVG scaling */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="font-mono text-[8px] tracking-[0.3em] uppercase mb-0.5" style={{ color: accent }}>
          24H FLOW
        </div>
        <div className="font-display font-extrabold text-base sm:text-lg tabular-nums" style={{ color: accent }}>
          {tone === "buy"  ? "Buyers leading"  :
           tone === "sell" ? "Sellers leading" :
                             "Balanced"}
        </div>
        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-0.5">
          {Math.round((totalBuy / Math.max(totalBuy + totalSell, 0.001)) * 100)}% buy · {Math.round((totalSell / Math.max(totalBuy + totalSell, 0.001)) * 100)}% sell
        </div>
      </div>

      {/* Ring legend (positioned absolutely under the SVG) */}
      <div className="absolute -bottom-1 left-0 right-0 flex justify-around px-2 text-center pointer-events-none">
        {rings.map((r) => (
          <div key={r.label} className="min-w-0">
            <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest truncate">{r.label}</div>
            <div className="font-mono text-[11px] text-ink tabular-nums truncate">{r.value}</div>
            {r.detail && (
              <div className="font-mono text-[9px] text-ink-4 tabular-nums truncate">{r.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Single pressure ring ──────────────────────────────────────────────

function Ring({
  cx, cy, radius, stroke, buy, sell, delay,
}: {
  cx:     number;
  cy:     number;
  radius: number;
  stroke: number;
  label:  string;
  value:  string;
  buy:    number;
  sell:   number;
  delay:  number;
}) {
  const circumference = 2 * Math.PI * radius;
  const buyClamped  = Math.max(0, Math.min(1, buy));
  const sellClamped = Math.max(0, Math.min(1, sell));
  const buyLen  = circumference * buyClamped;
  const sellLen = circumference * sellClamped;
  // Buy arc starts at the top (rotated -90°) and sweeps clockwise.
  // Sell arc starts immediately after, sweeping the rest.
  const gap = 1.5; // small gap so the two arcs don't fuse
  return (
    <g transform={`rotate(-90 ${cx} ${cy})`}>
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={stroke}
      />
      {/* Buy arc */}
      <motion.circle
        cx={cx} cy={cy} r={radius}
        fill="none"
        stroke="url(#ring-buy)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0, buyLen - gap)} ${circumference}`}
        strokeDashoffset={0}
        initial={{ opacity: 0.35 }}
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 2.2, ease: "easeInOut", repeat: Infinity, delay }}
      />
      {/* Sell arc — offset starts where buy ends */}
      <motion.circle
        cx={cx} cy={cy} r={radius}
        fill="none"
        stroke="url(#ring-sell)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0, sellLen - gap)} ${circumference}`}
        strokeDashoffset={-buyLen}
        initial={{ opacity: 0.35 }}
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 2.2, ease: "easeInOut", repeat: Infinity, delay: delay + 0.6 }}
      />
    </g>
  );
}
