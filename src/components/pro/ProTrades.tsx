"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Crown, Inbox } from "lucide-react";
import type { Trade } from "@/lib/api/geckoterminal";
import { cn } from "@/lib/cn";

interface Props {
  chain:    string;
  pool:     string;
  /** Crown threshold in USD. Trades ≥ this get highlighted + counted. */
  whaleAt?: number;
  /** Parent gets the latest trades for derived panels (ProFlow). */
  onTrades?: (trades: Trade[]) => void;
}

type Filter = "all" | "buy" | "sell" | "whales";

/**
 * Real-time pool trades feed with pro touches: whale rows highlighted
 * (≥ $10k USD by default), explorer link per tx, filter chips for
 * direction / whales-only. Polls /api/trades every 15s.
 */
export default function ProTrades({ chain, pool, whaleAt = 10_000, onTrades }: Props) {
  const [trades,  setTrades]  = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function load() {
      try {
        const res = await fetch(`/api/trades?chain=${chain}&pool=${pool}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { trades?: Trade[] };
        if (cancelled) return;
        const next = data.trades ?? [];
        setTrades(next);
        setError(null);
        onTrades?.(next);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.name !== "AbortError") setError(e.message);
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
  }, [chain, pool, onTrades]);

  const whaleCount = useMemo(
    () => trades.filter((t) => sizeUsd(t) >= whaleAt).length,
    [trades, whaleAt],
  );

  const visible = useMemo(() => {
    if (filter === "all")    return trades;
    if (filter === "buy")    return trades.filter((t) => t.kind === "buy");
    if (filter === "sell")   return trades.filter((t) => t.kind === "sell");
    /* whales */             return trades.filter((t) => sizeUsd(t) >= whaleAt);
  }, [trades, filter, whaleAt]);

  return (
    <div className="rounded-lg border border-white/5 bg-black/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Recent Trades</span>
        <span className="flex items-center gap-1 font-mono text-[9px] text-cyan/70 tracking-widest uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
          {loading ? "loading…" : error ? "cached" : "live"}
        </span>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5">
        {([
          ["all",    "All",    trades.length],
          ["buy",    "Buys",   trades.filter((t) => t.kind === "buy").length],
          ["sell",   "Sells",  trades.filter((t) => t.kind === "sell").length],
          ["whales", "Crowns", whaleCount],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "px-2 py-0.5 rounded font-mono text-[9px] tracking-widest uppercase transition-colors flex items-center gap-1",
              filter === key
                ? key === "whales" ? "bg-gold/15 text-gold" : "bg-cyan/15 text-cyan"
                : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
            )}
          >
            {key === "whales" && <Crown className="w-2.5 h-2.5" />}
            {label}
            <span className="text-ink-4">·{count}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 px-3 py-1 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
        <span className="col-span-2">Time</span>
        <span className="col-span-2 text-right">Side</span>
        <span className="col-span-3 text-right">Size</span>
        <span className="col-span-2 text-right">Price</span>
        <span className="col-span-3 text-right">Trader</span>
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {visible.length === 0 && !loading && (
          <div className="px-3 py-6 text-center font-mono text-[10px] text-ink-3 inline-flex items-center gap-1.5 justify-center w-full">
            <Inbox className="w-3 h-3" />
            {error ? "Trade feed unavailable" : filter === "all" ? "No recent trades" : "No matches for this filter"}
          </div>
        )}
        {visible.map((t, i) => {
          const ago    = relTime(t.ts);
          const usd    = sizeUsd(t);
          const isCrown = usd >= whaleAt;
          const isMega  = usd >= whaleAt * 10;
          return (
            <div
              key={t.txHash + i}
              className={cn(
                "grid grid-cols-12 px-3 py-0.5 font-mono text-[10px] border-b border-white/[0.02] last:border-0 hover:bg-white/[0.04]",
                isMega  && (t.kind === "buy" ? "bg-green/[0.05]" : "bg-red/[0.05]"),
                isCrown && !isMega && (t.kind === "buy" ? "bg-green/[0.025]" : "bg-red/[0.025]"),
              )}
            >
              <span className="col-span-2 text-ink-4">{ago}</span>
              <span className={cn(
                "col-span-2 text-right font-bold tracking-widest uppercase inline-flex items-center justify-end gap-0.5",
                t.kind === "buy" ? "text-green" : "text-red",
              )}>
                {isCrown && <Crown className="w-2.5 h-2.5" />}
                {t.kind === "buy" ? "BUY" : "SELL"}
              </span>
              <span className={cn(
                "col-span-3 text-right tabular-nums",
                isCrown ? "text-ink font-bold" : "text-ink-2",
              )}>
                ${formatUsd(usd)}
              </span>
              <span className="col-span-2 text-right text-ink tabular-nums">
                {t.priceUsd >= 1 ? t.priceUsd.toFixed(2) : t.priceUsd.toPrecision(4)}
              </span>
              <span className="col-span-3 text-right">
                {t.txHash
                  ? (
                    <a
                      href={txUrl(chain, t.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-cyan/70 hover:text-cyan tabular-nums"
                    >
                      {t.trader ? shortAddr(t.trader) : "tx"}
                      <ExternalLink className="w-2 h-2" />
                    </a>
                  )
                  : <span className="text-ink-4">{t.trader ? shortAddr(t.trader) : "—"}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sizeUsd(t: Trade): number {
  return t.sizeUsd || (t.priceUsd * (t.kind === "buy" ? t.amountOut : t.amountIn));
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function relTime(ts: number): string {
  const now  = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function txUrl(chain: string, txHash: string): string {
  const map: Record<string, string> = {
    ethereum:  "https://etherscan.io/tx/",
    bsc:       "https://bscscan.com/tx/",
    polygon:   "https://polygonscan.com/tx/",
    base:      "https://basescan.org/tx/",
    arbitrum:  "https://arbiscan.io/tx/",
    optimism:  "https://optimistic.etherscan.io/tx/",
    avalanche: "https://snowtrace.io/tx/",
    linea:     "https://lineascan.build/tx/",
    zksync:    "https://explorer.zksync.io/tx/",
    solana:    "https://solscan.io/tx/",
  };
  return (map[chain] ?? "https://etherscan.io/tx/") + txHash;
}
