"use client";

import { useEffect, useState } from "react";
import type { Trade } from "@/lib/api/geckoterminal";
import { cn } from "@/lib/cn";

interface Props {
  chain: string;
  pool:  string;
}

/**
 * Real-time pool trades feed. Polls /api/trades every 15s.
 * Empty / errored state remains visible with a friendly message.
 */
export default function ProTrades({ chain, pool }: Props) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function load() {
      try {
        const res = await fetch(`/api/trades?chain=${chain}&pool=${pool}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { trades?: Trade[] };
        if (cancelled) return;
        setTrades(data.trades ?? []);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.name !== "AbortError") {
          setError(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [chain, pool]);

  return (
    <div className="rounded-lg border border-white/5 bg-black/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Recent Trades</span>
        <span className="flex items-center gap-1 font-mono text-[9px] text-cyan/70 tracking-widest uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
          {loading ? "loading…" : error ? "cached" : "live"}
        </span>
      </div>
      <div className="grid grid-cols-12 px-3 py-1 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
        <span className="col-span-3">Time</span>
        <span className="col-span-2 text-right">Side</span>
        <span className="col-span-4 text-right">Size</span>
        <span className="col-span-3 text-right">Price</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {trades.length === 0 && !loading && (
          <div className="px-3 py-6 text-center font-mono text-[10px] text-ink-3">
            {error ? "Trade feed unavailable" : "No recent trades"}
          </div>
        )}
        {trades.map((t, i) => {
          const ago = relTime(t.ts);
          const sizeUsd = t.priceUsd * (t.kind === "buy" ? t.amountOut : t.amountIn);
          return (
            <div key={t.txHash + i} className="grid grid-cols-12 px-3 py-0.5 font-mono text-[10px] border-b border-white/[0.02] last:border-0 hover:bg-white/[0.02]">
              <span className="col-span-3 text-ink-4">{ago}</span>
              <span className={cn(
                "col-span-2 text-right font-bold tracking-widest uppercase",
                t.kind === "buy" ? "text-green" : "text-red",
              )}>
                {t.kind === "buy" ? "BUY" : "SELL"}
              </span>
              <span className="col-span-4 text-right text-ink-2 tabular-nums">
                ${sizeUsd >= 1000 ? (sizeUsd / 1000).toFixed(1) + "K" : sizeUsd.toFixed(0)}
              </span>
              <span className="col-span-3 text-right text-ink tabular-nums">
                {t.priceUsd >= 1 ? t.priceUsd.toFixed(2) : t.priceUsd.toPrecision(4)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function relTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60)     return `${diff}s`;
  if (diff < 3600)   return `${Math.floor(diff / 60)}m`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
