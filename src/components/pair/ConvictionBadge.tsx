"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Minus } from "lucide-react";
import type { ConvictionResult, ConvictionFactor } from "@/lib/conviction";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * Visual badge for the Conviction Score. Renders as a circular gauge
 * (SVG arc) with the score in the center, the band label, the one-line
 * summary, and the contributing factor breakdown listed below.
 *
 * Designed to sit between the hero strip and the Flow Sphere on the
 * pair page — answers "should I touch this?" in one glance.
 */
export default function ConvictionBadge({
  result, compact = false,
}: {
  result:  ConvictionResult;
  compact?: boolean;
}) {
  if (compact) {
    return <CompactPill result={result} />;
  }
  return <FullBadge result={result} />;
}

// ─── Full badge (used on the pair page) ────────────────────────────

function FullBadge({ result }: { result: ConvictionResult }) {
  const t = useT();
  const arcLen = (result.score / 100) * 282.74; // 2π·45
  return (
    <div className="rounded-2xl border border-white/5 bg-bg-1/40 overflow-hidden">
      <div
        className="h-0.5 w-full"
        style={{ background: `linear-gradient(90deg, transparent, ${result.color}, transparent)` }}
      />
      <div className="p-4 sm:p-5 flex items-center gap-4 sm:gap-5 min-w-0">
        {/* SVG gauge */}
        <div className="relative flex-shrink-0">
          <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label={t("common.convictionScore")}>
            <defs>
              <linearGradient id="conv-arc" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"  stopColor={result.color} stopOpacity="0.6" />
                <stop offset="100%" stopColor={result.color} stopOpacity="1" />
              </linearGradient>
              <radialGradient id="conv-halo" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor={result.color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={result.color} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="56" cy="56" r="54" fill="url(#conv-halo)" />
            {/* Track */}
            <circle
              cx="56" cy="56" r="45"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="6"
            />
            {/* Arc */}
            <motion.circle
              cx="56" cy="56" r="45"
              fill="none"
              stroke="url(#conv-arc)"
              strokeWidth="6"
              strokeLinecap="round"
              transform="rotate(-90 56 56)"
              initial={{ strokeDasharray: `0 282.74` }}
              animate={{ strokeDasharray: `${arcLen} 282.74` }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            />
            {/* Tick marker at score position */}
            <g transform={`rotate(${(result.score / 100) * 360 - 90} 56 56)`}>
              <circle cx="56" cy="11" r="3" fill={result.color} />
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="font-display font-extrabold text-3xl leading-none tabular-nums" style={{ color: result.color }}>
              {result.score}
            </div>
            <div className="font-mono text-[9px] tracking-[0.25em] uppercase mt-0.5 text-ink-3">
              CONVICTION
            </div>
          </div>
        </div>

        {/* Right: band, summary, top 3 factors */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="font-display font-extrabold text-base sm:text-lg tracking-wide"
              style={{ color: result.color }}
            >
              {result.bandLabel.toUpperCase()}
            </span>
            <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
              Z-SWAP Conviction · 0-100
            </span>
          </div>
          <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mb-2 line-clamp-2">
            {result.summary}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topFactors(result.factors, 4).map((f, i) => (
              <FactorChip key={`${f.label}-${i}`} factor={f} />
            ))}
          </div>
        </div>
      </div>

      {/* Full factor list, collapsible */}
      <details className="border-t border-white/5">
        <summary className="px-4 py-2.5 cursor-pointer font-mono text-[10px] text-ink-3 tracking-widest uppercase hover:text-cyan transition-colors flex items-center justify-between">
          <span>Full breakdown ({result.factors.length})</span>
          <span className="text-ink-4">click to expand</span>
        </summary>
        <ul className="px-4 pb-4 space-y-1">
          {result.factors.map((f, i) => (
            <FactorRow key={i} factor={f} />
          ))}
        </ul>
      </details>
    </div>
  );
}

// ─── Compact pill (used inline in Radar cluster cards) ─────────────

function CompactPill({ result }: { result: ConvictionResult }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-mono text-[10px] tracking-widest uppercase"
      style={{
        background: `${result.color}10`,
        borderColor: `${result.color}33`,
        color: result.color,
      }}
      title={result.summary}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: result.color, boxShadow: `0 0 8px ${result.color}` }}
      />
      {result.score} · {result.bandLabel}
    </span>
  );
}

// ─── Factor helpers ────────────────────────────────────────────────

function topFactors(factors: ConvictionFactor[], n: number): ConvictionFactor[] {
  return [...factors]
    .filter((f) => f.kind !== "neutral" || Math.abs(f.delta) === 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, n);
}

function FactorChip({ factor }: { factor: ConvictionFactor }) {
  const tone =
    factor.kind === "positive" ? "border-green/30 bg-green/[0.05] text-green" :
    factor.kind === "critical" ? "border-red/40 bg-red/[0.08] text-red" :
    factor.kind === "negative" ? "border-red/30 bg-red/[0.05] text-red" :
                                  "border-white/10 bg-white/[0.03] text-ink-3";
  return (
    <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded border tracking-tight truncate max-w-[180px]", tone)}>
      {factor.label}
    </span>
  );
}

function FactorRow({ factor }: { factor: ConvictionFactor }) {
  const Icon =
    factor.kind === "positive" ? CheckCircle2 :
    factor.kind === "critical" ? XCircle      :
    factor.kind === "negative" ? AlertTriangle :
                                  Minus;
  const tone =
    factor.kind === "positive" ? "text-green" :
    factor.kind === "critical" ? "text-red"   :
    factor.kind === "negative" ? "text-red"   :
                                  "text-ink-3";
  const signed = factor.delta === 0 ? "—" : factor.delta > 0 ? `+${factor.delta}` : `${factor.delta}`;
  return (
    <li className="flex items-center gap-2 font-mono text-[11px] min-w-0">
      <Icon className={cn("w-3 h-3 flex-shrink-0", tone)} />
      <span className="text-ink-2 truncate flex-1">{factor.label}</span>
      <span className={cn("tabular-nums text-[10px] flex-shrink-0", tone)}>{signed}</span>
    </li>
  );
}
