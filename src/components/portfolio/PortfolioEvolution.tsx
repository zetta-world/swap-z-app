"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, LineChart, ArrowUpRight } from "lucide-react";
import { usePortfolioHistory, type PortfolioSnapshot } from "@/lib/store/portfolioHistory";
import { useTxHistory, TX_TYPE_LABELS_PT, type TxType } from "@/lib/store/txHistory";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

type Range = "24h" | "7d" | "30d" | "all";

const RANGE_MS: Record<Exclude<Range, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7  * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * "Evolução do saldo" — area chart of total net worth over time plus a
 * realized-P&L breakdown per operation type pulled from the tx history.
 *
 * Snapshots come from usePortfolioHistory (recorded by PortfolioView when
 * live totals settle); `liveTotalUsd` extends the series with the current
 * value so the chart always ends at "now".
 */
export default function PortfolioEvolution({
  liveTotalUsd,
  hidden,
}: {
  liveTotalUsd: number;
  hidden: boolean;
}) {
  const t = useT();
  const { snapshots } = usePortfolioHistory();
  const { entries } = useTxHistory();
  const [range, setRange] = useState<Range>("7d");

  // Series for the selected range, with the live value appended as "now".
  const series = useMemo(() => {
    const cutoff = range === "all" ? 0 : Date.now() - RANGE_MS[range];
    const pts = snapshots.filter((s) => s.ts >= cutoff);
    if (liveTotalUsd > 0) {
      pts.push({ ts: Date.now(), totalUsd: liveTotalUsd, walletUsd: 0, cexUsd: 0 });
    }
    return pts;
  }, [snapshots, range, liveTotalUsd]);

  const delta = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0].totalUsd;
    const last  = series[series.length - 1].totalUsd;
    const abs = last - first;
    const pct = first > 0 ? (abs / first) * 100 : 0;
    return { abs, pct };
  }, [series]);

  // Realized P&L + fees per operation type, from confirmed history entries.
  const byType = useMemo(() => {
    const map = new Map<TxType, { count: number; pnl: number; fees: number }>();
    for (const e of entries) {
      if (e.status !== "confirmed") continue;
      const row = map.get(e.type) ?? { count: 0, pnl: 0, fees: 0 };
      row.count += 1;
      row.pnl   += e.pnlUsd  ?? 0;
      row.fees  += e.feesUsd ?? 0;
      map.set(e.type, row);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [entries]);

  const totalRealized = byType.reduce((s, [, r]) => s + r.pnl, 0);

  const DeltaIcon = !delta || delta.abs === 0 ? Minus : delta.abs > 0 ? TrendingUp : TrendingDown;
  const deltaColor = !delta || delta.abs === 0 ? "text-ink-3" : delta.abs > 0 ? "text-green" : "text-red";
  const mask = (v: string) => (hidden ? "•••••" : v);

  return (
    <div className="god-card rounded-2xl border border-white/5 glass-pane overflow-hidden mb-4">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 flex-wrap">
        <span className="font-display font-bold text-sm text-ink flex items-center gap-2">
          <LineChart className="w-3.5 h-3.5 text-cyan" />
          {t("portfolio.evolutionTitle")}
        </span>
        <div className="flex gap-1">
          {(["24h", "7d", "30d", "all"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "px-2 py-0.5 rounded-md font-mono text-[10px] uppercase tracking-wider border transition-all",
                range === r
                  ? "bg-white/[0.08] border-white/20 text-ink"
                  : "border-white/5 bg-white/[0.02] text-ink-3 hover:text-ink-2",
              )}
            >
              {r === "all" ? t("portfolio.evolutionRangeAll") : r}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {series.length < 2 ? (
          <div className="py-6 text-center">
            <p className="font-sans text-xs text-ink-3 max-w-sm mx-auto leading-relaxed">
              {t("portfolio.evolutionEmpty")}
            </p>
          </div>
        ) : (
          <>
            {/* Delta headline */}
            <div className="flex items-baseline gap-2 mb-3">
              <span className={cn("font-display font-extrabold text-2xl flex items-center gap-1.5", deltaColor)}>
                <DeltaIcon className="w-5 h-5" />
                {mask(`${delta && delta.abs >= 0 ? "+" : ""}${formatUsd(delta?.abs ?? 0)}`)}
              </span>
              <span className={cn("font-mono text-sm", deltaColor)}>
                {mask(`${delta && delta.pct >= 0 ? "+" : ""}${(delta?.pct ?? 0).toFixed(2)}%`)}
              </span>
              <span className="font-mono text-[10px] text-ink-4 uppercase tracking-widest ml-auto">
                {range === "all" ? t("portfolio.evolutionRangeAll") : range}
              </span>
            </div>

            <AreaChart series={series} positive={!delta || delta.abs >= 0} />
          </>
        )}

        {/* P&L per operation type */}
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              {t("portfolio.pnlByType")}
            </span>
            {byType.length > 0 && (
              <span className={cn(
                "font-mono text-xs",
                totalRealized > 0 ? "text-green" : totalRealized < 0 ? "text-red" : "text-ink-3",
              )}>
                {mask(`${totalRealized >= 0 ? "+" : ""}${formatUsd(totalRealized)}`)}
              </span>
            )}
          </div>

          {byType.length === 0 ? (
            <p className="font-sans text-[11px] text-ink-4">
              {t("portfolio.pnlNoData")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {byType.map(([type, row]) => (
                <div key={type} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-ink-2 flex-1 truncate">
                    {TX_TYPE_LABELS_PT[type]}
                  </span>
                  <span className="font-mono text-ink-4">
                    {row.count} {t("portfolio.pnlOps")}
                  </span>
                  <span className="font-mono text-ink-4 w-20 text-right">
                    −{mask(formatUsd(row.fees))}
                  </span>
                  <span className={cn(
                    "font-mono w-20 text-right",
                    row.pnl > 0 ? "text-green" : row.pnl < 0 ? "text-red" : "text-ink-3",
                  )}>
                    {mask(`${row.pnl >= 0 ? "+" : ""}${formatUsd(row.pnl)}`)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Link
            href="/history"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline mt-2.5"
          >
            {t("portfolio.pnlSeeHistory")}
            <ArrowUpRight className="w-2.5 h-2.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Minimal dependency-free SVG area chart. */
function AreaChart({ series, positive }: { series: PortfolioSnapshot[]; positive: boolean }) {
  const W = 600;
  const H = 110;
  const PAD = 4;

  const { linePath, areaPath } = useMemo(() => {
    const t0 = series[0].ts;
    const t1 = series[series.length - 1].ts;
    const span = Math.max(t1 - t0, 1);
    let min = Infinity, max = -Infinity;
    for (const s of series) {
      if (s.totalUsd < min) min = s.totalUsd;
      if (s.totalUsd > max) max = s.totalUsd;
    }
    // Flat series still needs visible height
    if (max - min < max * 0.001) { min *= 0.999; max *= 1.001; }
    const vspan = max - min || 1;

    const pts = series.map((s) => {
      const x = PAD + ((s.ts - t0) / span) * (W - PAD * 2);
      const y = PAD + (1 - (s.totalUsd - min) / vspan) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M ${pts.join(" L ")}`;
    const area = `${line} L ${(W - PAD).toFixed(1)},${H} L ${PAD},${H} Z`;
    return { linePath: line, areaPath: area };
  }, [series]);

  const stroke = positive ? "#34d399" : "#f87171";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[110px]" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="pf-evo-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#pf-evo-fill)" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
