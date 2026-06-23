"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { Timeframe } from "@/lib/api/geckoterminal";

interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

interface Bucket {
  priceBottom: number;
  priceTop:    number;
  volume:      number;
  isPOC:       boolean;
  isVA:        boolean;
}

interface Props {
  chain:       string;
  pool:        string;
  tf:          Timeframe;
  token?:      "base" | "quote";
  accentColor?: string;
}

const NUM_BUCKETS  = 40;
const VA_PCT       = 0.70;
const ROW_H        = 6;   // px per bucket row

// Distribute each candle's volume across price buckets proportionally to overlap.
function computeProfile(candles: Candle[]): Bucket[] {
  if (candles.length === 0) return [];
  const minP = Math.min(...candles.map(c => c.low));
  const maxP = Math.max(...candles.map(c => c.high));
  const range = maxP - minP;
  if (range <= 0) return [];

  const size = range / NUM_BUCKETS;
  const buckets: Bucket[] = Array.from({ length: NUM_BUCKETS }, (_, i) => ({
    priceBottom: minP + i * size,
    priceTop:    minP + (i + 1) * size,
    volume:      0,
    isPOC:       false,
    isVA:        false,
  }));

  for (const c of candles) {
    const cr = c.high - c.low;
    for (let i = 0; i < NUM_BUCKETS; i++) {
      const overLo = Math.max(c.low,  buckets[i].priceBottom);
      const overHi = Math.min(c.high, buckets[i].priceTop);
      if (overHi > overLo) {
        const frac = cr > 0 ? (overHi - overLo) / cr : 1 / NUM_BUCKETS;
        buckets[i].volume += frac * c.volume;
      }
    }
  }

  // POC — bucket with most volume
  let pocIdx = 0;
  for (let i = 1; i < NUM_BUCKETS; i++) {
    if (buckets[i].volume > buckets[pocIdx].volume) pocIdx = i;
  }
  buckets[pocIdx].isPOC = true;

  // Value Area — expand outward from POC until 70 % of total volume is enclosed
  const total = buckets.reduce((s, b) => s + b.volume, 0);
  let vaVol = buckets[pocIdx].volume;
  let lo = pocIdx, hi = pocIdx;
  while (vaVol < total * VA_PCT && (lo > 0 || hi < NUM_BUCKETS - 1)) {
    const addLo = lo > 0                    ? buckets[lo - 1].volume : 0;
    const addHi = hi < NUM_BUCKETS - 1      ? buckets[hi + 1].volume : 0;
    if (addHi >= addLo) { hi++; vaVol += buckets[hi].volume; }
    else                { lo--; vaVol += buckets[lo].volume; }
  }
  for (let i = lo; i <= hi; i++) buckets[i].isVA = true;

  return buckets;
}

function fmtP(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000)  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1)      return n.toFixed(2);
  if (n >= 0.01)   return n.toFixed(4);
  return n.toPrecision(3);
}

export default function ProVolumeProfile({ chain, pool, tf, token = "base", accentColor = "#00E5FF" }: Props) {
  const [candles, setCandles]   = useState<Candle[]>([]);
  const [loading, setLoading]   = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    fetch(`/api/ohlcv?chain=${chain}&pool=${pool}&tf=${tf}&token=${token}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { if (!ctrl.signal.aborted && d.candles) setCandles(d.candles); })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    return () => ctrl.abort();
  }, [chain, pool, tf, token]);

  const buckets = useMemo(() => computeProfile(candles), [candles]);
  const maxVol  = useMemo(() => Math.max(...buckets.map(b => b.volume), 1), [buckets]);

  // Buckets are low→high; reverse for rendering (high price at top)
  const rows = useMemo(() => [...buckets].reverse(), [buckets]);

  const poc = buckets.find(b => b.isPOC);
  // VAH = top of highest VA bucket; VAL = bottom of lowest VA bucket
  const vahBucket = [...buckets].reverse().find(b => b.isVA);
  const valBucket = buckets.find(b => b.isVA);

  const totalH = NUM_BUCKETS * ROW_H;

  // Compute row index (in reversed array) for label positioning
  const rowOf = (b: Bucket | undefined) =>
    b ? rows.findIndex(r => r.priceBottom === b.priceBottom) : -1;

  const totalVolume = candles.reduce((s, c) => s + c.volume, 0);

  return (
    <div className="rounded-xl border border-white/5 bg-black/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">Volume Profile</span>
        <span className="font-mono text-[9px] text-ink-3">· {tf.toUpperCase()}</span>
        {poc && (
          <span className="ml-auto font-mono text-[9px] tabular-nums" style={{ color: accentColor }}>
            POC ${fmtP(poc.priceBottom)}
          </span>
        )}
      </div>

      <div className="p-3">
        {loading ? (
          <div className="shimmer rounded" style={{ height: totalH }} />
        ) : buckets.length === 0 ? (
          <div className="flex items-center justify-center font-mono text-[10px] text-ink-4" style={{ height: totalH }}>
            No data
          </div>
        ) : (
          <div className="flex gap-2">
            {/* Histogram */}
            <div className="flex-1 relative" style={{ height: totalH }}>
              {rows.map((b, i) => {
                const w = Math.max((b.volume / maxVol) * 100, 0.3);
                const bg = b.isPOC
                  ? accentColor
                  : b.isVA
                  ? `${accentColor}55`
                  : "rgba(255,255,255,0.13)";
                return (
                  <div
                    key={i}
                    className="absolute rounded-[1px]"
                    style={{
                      top:    i * ROW_H,
                      left:   0,
                      height: ROW_H - 1,
                      width:  `${w}%`,
                      background: bg,
                      transition: "width 0.4s ease",
                    }}
                    title={`$${fmtP(b.priceBottom)} — vol ${b.volume.toFixed(2)}`}
                  />
                );
              })}
            </div>

            {/* Price labels — absolutely positioned at key levels */}
            <div className="w-16 relative flex-shrink-0" style={{ height: totalH }}>
              {/* Top price */}
              <PriceLabel top={0} label={`$${fmtP(rows[0].priceTop)}`} color="rgba(255,255,255,0.3)" />
              {/* VAH */}
              {vahBucket && rowOf(vahBucket) >= 0 && (
                <PriceLabel
                  top={rowOf(vahBucket) * ROW_H}
                  label={`VAH $${fmtP(vahBucket.priceTop)}`}
                  color={`${accentColor}99`}
                />
              )}
              {/* POC */}
              {poc && rowOf(poc) >= 0 && (
                <PriceLabel
                  top={rowOf(poc) * ROW_H}
                  label={`POC $${fmtP(poc.priceBottom)}`}
                  color={accentColor}
                  bold
                />
              )}
              {/* VAL */}
              {valBucket && rowOf(valBucket) >= 0 && (
                <PriceLabel
                  top={rowOf(valBucket) * ROW_H}
                  label={`VAL $${fmtP(valBucket.priceBottom)}`}
                  color={`${accentColor}99`}
                />
              )}
              {/* Bottom price */}
              <PriceLabel
                top={totalH - ROW_H}
                label={`$${fmtP(rows[rows.length - 1].priceBottom)}`}
                color="rgba(255,255,255,0.3)"
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer legend */}
      {!loading && buckets.length > 0 && (
        <div className="px-3 pb-2.5 flex items-center gap-3 font-mono text-[8px] text-ink-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-1.5 rounded-[1px] inline-block" style={{ background: accentColor }} />
            POC
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-1.5 rounded-[1px] inline-block" style={{ background: `${accentColor}55` }} />
            VA 70%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-1.5 rounded-[1px] inline-block bg-white/10" />
            Outside VA
          </span>
          <span className="ml-auto tabular-nums opacity-60">
            {candles.length} candles · vol {totalVolume > 1e6 ? `${(totalVolume / 1e6).toFixed(1)}M` : totalVolume > 1e3 ? `${(totalVolume / 1e3).toFixed(0)}K` : totalVolume.toFixed(0)}
          </span>
        </div>
      )}
    </div>
  );
}

function PriceLabel({ top, label, color, bold = false }: { top: number; label: string; color: string; bold?: boolean }) {
  return (
    <span
      className={cn("absolute left-0 font-mono text-[7px] tabular-nums leading-none whitespace-nowrap", bold && "font-bold")}
      style={{ top, color }}
    >
      {label}
    </span>
  );
}
