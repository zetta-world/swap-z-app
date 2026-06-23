"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { Candle, Timeframe, PriceToken } from "@/lib/api/geckoterminal";
import { cn } from "@/lib/cn";

interface Props {
  chain:        string;
  pool:         string;
  side:         PriceToken;   // "base" | "quote"
  accentColor:  string;
}

type Trend = "bull" | "bear" | "neutral";

const TFS: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) prev = closes[i] * k + prev * (1 - k);
  return prev;
}

function trendOf(candles: Candle[]): Trend {
  if (candles.length < 50) return "neutral";
  const closes = candles.map((c) => c.close);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const last = closes[closes.length - 1];
  if (e21 == null || e50 == null) return "neutral";
  if (last > e21 && e21 > e50) return "bull";
  if (last < e21 && e21 < e50) return "bear";
  return "neutral";
}

export default function ProMTF({ chain, pool, side, accentColor }: Props) {
  const [trends, setTrends] = useState<Record<Timeframe, Trend>>({} as Record<Timeframe, Trend>);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);

    Promise.all(
      TFS.map(async (tf) => {
        try {
          const res = await fetch(`/api/ohlcv?chain=${chain}&pool=${pool}&tf=${tf}&token=${side}`, { signal: ctrl.signal });
          if (!res.ok) return [tf, "neutral"] as const;
          const data = (await res.json()) as { candles?: Candle[] };
          return [tf, trendOf(data.candles ?? [])] as const;
        } catch {
          return [tf, "neutral"] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next = {} as Record<Timeframe, Trend>;
      for (const [tf, tr] of entries) next[tf] = tr;
      setTrends(next);
      setLoading(false);
    });

    return () => { cancelled = true; ctrl.abort(); };
  }, [chain, pool, side]);

  const values = TFS.map((tf) => trends[tf] ?? "neutral");
  const bulls  = values.filter((v) => v === "bull").length;
  const bears  = values.filter((v) => v === "bear").length;
  const overall = bulls > bears ? "bull" : bears > bulls ? "bear" : "neutral";
  const aligned = Math.max(bulls, bears);

  const overallColor = overall === "bull" ? "#00E087" : overall === "bear" ? "#FF3B5C" : "#7E89C2";

  return (
    <div className="rounded-lg bg-black/40 border border-white/5 px-3 py-2 flex items-center gap-3 flex-wrap">
      <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">MTF Trend</span>

      <div className="flex items-center gap-1.5 flex-wrap">
        {TFS.map((tf) => {
          const tr = trends[tf] ?? "neutral";
          const color = tr === "bull" ? "#00E087" : tr === "bear" ? "#FF3B5C" : "#7E89C2";
          const Icon  = tr === "bull" ? TrendingUp : tr === "bear" ? TrendingDown : Minus;
          return (
            <div
              key={tf}
              className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border", loading && "opacity-40")}
              style={{ borderColor: `${color}30`, background: `${color}0d` }}
              title={`${tf}: ${tr}`}
            >
              <span className="font-mono text-[9px] text-ink-3 tabular-nums">{tf}</span>
              <Icon className="w-2.5 h-2.5" style={{ color }} />
            </div>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="font-mono text-[9px] text-ink-4 tracking-wider tabular-nums">{aligned}/{TFS.length}</span>
        <span className="font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: overallColor }}>
          {overall}
        </span>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }} />
      </div>
    </div>
  );
}
