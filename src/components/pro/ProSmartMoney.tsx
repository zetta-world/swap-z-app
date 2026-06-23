"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, Crown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Trade } from "@/lib/api/geckoterminal";

interface Props {
  trades:      Trade[];
  accentColor?: string;
  whaleAt?:    number;   // USD threshold to classify a trade as "whale"
}

type Verdict = "ACCUMULATING" | "DISTRIBUTING" | "NEUTRAL";
type MevRisk = "LOW" | "MEDIUM" | "HIGH";

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function ProSmartMoney({ trades, accentColor = "#00E5FF", whaleAt = 10_000 }: Props) {
  const stats = useMemo(() => {
    if (trades.length === 0) return null;

    const whales     = trades.filter(t => t.sizeUsd >= whaleAt);
    const whaleBuys  = whales.filter(t => t.kind === "buy");
    const whaleSells = whales.filter(t => t.kind === "sell");
    const buyVol     = whaleBuys.reduce((s, t) => s + t.sizeUsd, 0);
    const sellVol    = whaleSells.reduce((s, t) => s + t.sizeUsd, 0);
    const totalWhale = buyVol + sellVol;
    const bias       = totalWhale > 0 ? buyVol / totalWhale : 0.5;

    const largest    = whales.reduce<Trade | null>((best, t) => !best || t.sizeUsd > best.sizeUsd ? t : best, null);

    const verdict: Verdict = bias > 0.62 ? "ACCUMULATING" : bias < 0.38 ? "DISTRIBUTING" : "NEUTRAL";

    // MEV risk proxy: coefficient of variation in recent trade prices
    const recent = trades.slice(0, 30);
    const prices = recent.map(t => t.priceUsd).filter(p => p > 0);
    let mev: MevRisk = "LOW";
    if (prices.length >= 3) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const cv  = Math.sqrt(prices.reduce((s, p) => s + (p - avg) ** 2, 0) / prices.length) / (avg || 1);
      const totalVol   = recent.reduce((s, t) => s + t.sizeUsd, 0);
      const whaleFrac  = totalVol > 0
        ? recent.filter(t => t.sizeUsd >= whaleAt).reduce((s, t) => s + t.sizeUsd, 0) / totalVol
        : 0;
      const score = cv * 0.6 + whaleFrac * 0.4;
      if (score > 0.12) mev = "HIGH";
      else if (score > 0.05) mev = "MEDIUM";
    }

    return { whales, whaleBuys, whaleSells, buyVol, sellVol, bias, verdict, largest, mev };
  }, [trades, whaleAt]);

  if (!stats) {
    return (
      <div className="rounded-xl border border-white/5 bg-black/60 backdrop-blur-sm p-3 flex items-center justify-center h-full">
        <span className="font-mono text-[10px] text-ink-4">Loading trades…</span>
      </div>
    );
  }

  const { whales, buyVol, sellVol, bias, verdict, largest, mev } = stats;

  const verdictColor   = verdict === "ACCUMULATING" ? "#00E087" : verdict === "DISTRIBUTING" ? "#FF3B5C" : "rgba(255,255,255,0.5)";
  const VerdictIcon    = verdict === "ACCUMULATING" ? TrendingUp : verdict === "DISTRIBUTING" ? TrendingDown : Minus;
  const mevColor       = mev === "HIGH" ? "#FF3B5C" : mev === "MEDIUM" ? "#F5A623" : "#00E087";

  const buyPct  = bias * 100;
  const sellPct = 100 - buyPct;

  return (
    <div className="rounded-xl border bg-black/60 backdrop-blur-sm overflow-hidden h-full flex flex-col"
      style={{ borderColor: `${accentColor}22` }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <Crown className="w-3 h-3 text-gold" />
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">Smart Money</span>
        <span className="font-mono text-[9px] text-ink-3">· ≥{fmtUsd(whaleAt)}</span>
        <span className="ml-auto font-mono text-[9px] tabular-nums" style={{ color: accentColor }}>
          {whales.length} whale{whales.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2.5">
        {/* Verdict */}
        <div className="flex items-center gap-2">
          <VerdictIcon className="w-4 h-4 flex-shrink-0" style={{ color: verdictColor }} />
          <div>
            <div className="font-mono text-[11px] font-bold leading-none" style={{ color: verdictColor }}>
              {verdict}
            </div>
            <div className="font-mono text-[9px] text-ink-3 mt-0.5">
              Whale bias: {buyPct.toFixed(0)}% buy / {sellPct.toFixed(0)}% sell
            </div>
          </div>
        </div>

        {/* Buy / sell volume bar */}
        <div>
          <div className="flex items-center justify-between font-mono text-[9px] text-ink-4 mb-1">
            <span style={{ color: "#00E087" }}>{fmtUsd(buyVol)} buy</span>
            <span style={{ color: "#FF3B5C" }}>{fmtUsd(sellVol)} sell</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden flex bg-white/5">
            <div className="h-full rounded-l-full bg-green/70 transition-all"
              style={{ width: `${buyPct}%` }} />
            <div className="h-full rounded-r-full bg-red/70 transition-all"
              style={{ width: `${sellPct}%` }} />
          </div>
        </div>

        {/* Largest trade */}
        {largest && (
          <div className="flex items-center justify-between font-mono text-[9px]">
            <span className="text-ink-4 tracking-widest uppercase">Largest</span>
            <span
              className="tabular-nums"
              style={{ color: largest.kind === "buy" ? "#00E087" : "#FF3B5C" }}
            >
              {largest.kind.toUpperCase()} {fmtUsd(largest.sizeUsd)}
            </span>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-white/5" />

        {/* MEV risk */}
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: mevColor }} />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">MEV Exposure</div>
            <div className="font-mono text-[10px] font-bold leading-none mt-0.5" style={{ color: mevColor }}>
              {mev}
            </div>
          </div>
          <div className="text-right font-mono text-[8px] text-ink-4 leading-snug">
            <div>price spread proxy</div>
            <div>+ whale concentration</div>
          </div>
        </div>

        {mev !== "LOW" && (
          <div className="rounded-md bg-white/[0.03] border border-white/5 px-2 py-1.5 font-mono text-[8px] text-ink-3 leading-snug">
            {mev === "HIGH"
              ? "High price variance + large trades detected — sandwich risk elevated."
              : "Moderate spread activity — monitor for front-running on large swaps."}
          </div>
        )}
      </div>
    </div>
  );
}
