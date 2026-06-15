"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";

// ─── Card shell ─────────────────────────────────────────────────────────

export function Panel({
  title,
  icon,
  right,
  children,
  className,
}: {
  title:   string;
  icon?:   React.ReactNode;
  right?:  React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("god-card rounded-2xl border border-white/5 glass-pane overflow-hidden", className)}>
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 flex-wrap">
        <span className="font-display font-bold text-sm text-ink flex items-center gap-2">
          {icon}
          {title}
        </span>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── KPI tile ───────────────────────────────────────────────────────────

const TONE_TEXT: Record<string, string> = {
  cyan:   "text-cyan",
  violet: "text-violet",
  gold:   "text-gold",
  green:  "text-green",
  red:    "text-red",
  ink:    "text-ink",
};

export function Kpi({
  label,
  value,
  sub,
  tone = "ink",
  Icon,
}: {
  label: string;
  value: string;
  sub?:  { text: string; tone?: keyof typeof TONE_TEXT } | null;
  tone?: keyof typeof TONE_TEXT;
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="god-card rounded-xl border border-white/5 glass-pane p-3.5 min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className={cn("w-3 h-3", TONE_TEXT[tone])} />}
        <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase truncate">{label}</span>
      </div>
      <div className={cn("font-display font-extrabold text-xl sm:text-2xl truncate tabular-nums", TONE_TEXT[tone])}>
        {value}
      </div>
      {sub && (
        <div className={cn("font-mono text-[10px] mt-0.5 truncate", TONE_TEXT[sub.tone ?? "ink"])}>
          {sub.text}
        </div>
      )}
    </div>
  );
}

// ─── Area chart (dependency-free SVG) ───────────────────────────────────

export function AreaChart({
  points,
  positive,
  height = 150,
}: {
  points:   { ts: number; value: number }[];
  positive: boolean;
  height?:  number;
}) {
  const W = 600;
  const H = height;
  const PAD = 4;

  const { linePath, areaPath } = useMemo(() => {
    if (points.length < 2) return { linePath: "", areaPath: "" };
    const t0 = points[0].ts;
    const t1 = points[points.length - 1].ts;
    const span = Math.max(t1 - t0, 1);
    let min = Infinity, max = -Infinity;
    for (const p of points) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    if (max - min < max * 0.001) { min *= 0.999; max *= 1.001; }
    const vspan = max - min || 1;
    const xy = points.map((p) => {
      const x = PAD + ((p.ts - t0) / span) * (W - PAD * 2);
      const y = PAD + (1 - (p.value - min) / vspan) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M ${xy.join(" L ")}`;
    const area = `${line} L ${(W - PAD).toFixed(1)},${H} L ${PAD},${H} Z`;
    return { linePath: line, areaPath: area };
  }, [points, H]);

  const stroke = positive ? "#34d399" : "#f87171";
  const gid = `dash-area-${positive ? "g" : "r"}-${height}`;

  if (!linePath) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} className="w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Donut chart (SVG) ──────────────────────────────────────────────────

export function Donut({
  segments,
  size = 132,
  thickness = 16,
  centerLabel,
  centerValue,
}: {
  segments:    { label: string; value: number; color: string }[];
  size?:       number;
  thickness?:  number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let acc = 0;
  const arcs = total > 0 ? segments.map((seg) => {
    const frac = seg.value / total;
    const dash = frac * circ;
    const offset = circ - acc * circ;
    acc += frac;
    return { seg, dash, gap: circ - dash, offset };
  }) : [];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={a.seg.color}
            strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={a.offset}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="absolute text-center pointer-events-none">
          {centerValue && <div className="font-display font-extrabold text-sm text-ink tabular-nums">{centerValue}</div>}
          {centerLabel && <div className="font-mono text-[8px] text-ink-4 tracking-widest uppercase">{centerLabel}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Vertical bar chart (SVG) ───────────────────────────────────────────

export function Bars({
  data,
  height = 120,
  color = "#00E8FF",
}: {
  data:    { label: string; value: number }[];
  height?: number;
  color?:  string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => {
        const h = max > 0 ? (d.value / max) * 100 : 0;
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group min-w-0">
            <div
              className="w-full rounded-t-sm transition-all group-hover:brightness-125 relative"
              style={{
                height: `${Math.max(h, d.value > 0 ? 3 : 0)}%`,
                background: `linear-gradient(to top, ${color}33, ${color})`,
                minHeight: d.value > 0 ? 2 : 0,
              }}
              title={`${d.label}: ${d.value.toFixed(2)}`}
            />
            <span className="font-mono text-[8px] text-ink-4 truncate w-full text-center">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Horizontal gauge (loss-stop / cap usage) ───────────────────────────

export function Gauge({
  pct,
  tone = "cyan",
  label,
  value,
}: {
  pct:   number;        // 0..1
  tone?: "cyan" | "gold" | "red" | "green";
  label: string;
  value: string;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  const fill = { cyan: "#00E8FF", gold: "#F5B544", red: "#f87171", green: "#34d399" }[tone];
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase truncate">{label}</span>
        <span className="font-mono text-[10px] text-ink tabular-nums">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${clamped * 100}%`, background: fill }} />
      </div>
    </div>
  );
}
