"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, CandlestickChart, LineChart, BarChart2,
  ArrowUp, ArrowDown, Zap, Activity, ChevronDown, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { compactNumber } from "@/lib/format";
import type { Timeframe } from "@/lib/api/geckoterminal";
import { PRO_PAIRS, DEFAULT_PRO_PAIR, type ProPair } from "@/lib/pro-pairs";
import { CHAINS } from "@/lib/chains";
import ProChart, { type ChartKind } from "./ProChart";
import ProTrades from "./ProTrades";

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

const CHART_KINDS: { id: ChartKind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "candle", label: "Candle", Icon: CandlestickChart },
  { id: "bar",    label: "Bar",    Icon: BarChart2        },
  { id: "line",   label: "Line",   Icon: LineChart        },
];

const KEYBINDS = [
  { keys: "B",     label: "Buy"       },
  { keys: "S",     label: "Sell"      },
  { keys: "⌘ ↵",   label: "Execute"   },
  { keys: "⌘ K",   label: "Search"    },
  { keys: "Z",     label: "ZION ask"  },
  { keys: "1-9",   label: "Pair n"    },
];

export default function ProTerminal() {
  // ─── State ────────────────────────────────────────────────────────
  const [pair, setPair]       = useState<ProPair>(DEFAULT_PRO_PAIR);
  const [tf, setTf]           = useState<Timeframe>("5m");
  const [kind, setKind]       = useState<ChartKind>("candle");
  const [maOn, setMaOn]       = useState(false);
  const [emaOn, setEmaOn]     = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

  // Live header values pushed from ProChart
  const [hdr, setHdr] = useState<{ last: number; change: number; high: number; low: number; vol: number } | null>(null);
  const onLastPrice = useCallback((last: number, change: number, high: number, low: number, vol: number) => {
    setHdr({ last, change, high, low, vol });
  }, []);

  const chainObj = useMemo(() => CHAINS.find((c) => c.id === pair.chain), [pair.chain]);

  // Keyboard shortcut: 1-9 → switch pair
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const idx = parseInt(e.key, 10);
      if (Number.isInteger(idx) && idx >= 1 && idx <= PRO_PAIRS.length) {
        setPair(PRO_PAIRS[idx - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden bg-black">
      <div className="absolute inset-0 grid-bg-dense opacity-25 pointer-events-none" />

      <div className="relative z-10 p-3 sm:p-4 lg:p-5 max-w-[1900px] mx-auto w-full">
        {/* Top bar */}
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 flex-wrap mb-3">
          <BarChart3 className="w-4 h-4 text-cyan" />
          <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">Pro Terminal · Z-SWAP</span>
          <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green pulse-dot" /> LIVE
            </span>
            <span className="text-ink-4">·</span>
            <span className="hidden sm:inline">GeckoTerminal feed</span>
          </div>
        </motion.div>

        {/* Pair header */}
        <div className="rounded-lg border border-white/5 bg-black/40 p-3 flex items-center gap-3 sm:gap-5 flex-wrap mb-3">
          {/* Pair selector */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setPairOpen((o) => !o)}
              className="flex items-center gap-3 hover:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
            >
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center font-display font-extrabold"
                style={{
                  background: `${chainObj?.color}22`,
                  color:      chainObj?.color,
                  border:     `1px solid ${chainObj?.color}55`,
                }}
              >
                {pair.base.slice(0, 3)}
              </span>
              <div className="text-left">
                <div className="font-display font-extrabold text-base sm:text-lg text-ink leading-none">
                  {pair.base} / {pair.quote}
                </div>
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1">
                  {chainObj?.name} · {pair.dex} {pair.feeTier && `· ${pair.feeTier}`}
                </div>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-ink-3 transition-transform", pairOpen && "rotate-180")} />
            </button>
            {pairOpen && (
              <div className="absolute left-0 top-full mt-1 z-20 w-72 rounded-lg border border-white/10 glass-strong shadow-card overflow-hidden">
                {PRO_PAIRS.map((p, i) => {
                  const c = CHAINS.find((c) => c.id === p.chain);
                  const active = p.id === pair.id;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => { setPair(p); setPairOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors",
                        active && "bg-cyan/[0.06]",
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c?.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-bold text-xs text-ink truncate">
                          {p.base} / {p.quote}
                        </div>
                        <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider truncate">
                          {c?.short} · {p.dex} {p.feeTier && `· ${p.feeTier}`}
                        </div>
                      </div>
                      <kbd className="font-mono text-[9px] text-ink-3 px-1 py-0.5 rounded border border-white/10">{i + 1}</kbd>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="font-mono">
            <div className="text-[10px] text-ink-3 tracking-widest uppercase">Last</div>
            <div className={cn(
              "font-display font-extrabold text-xl sm:text-2xl tabular-nums",
              hdr ? (hdr.change >= 0 ? "text-green" : "text-red") : "text-ink",
            )}>
              {hdr ? formatPrice(hdr.last) : "—"}
            </div>
          </div>
          <Field label="24h" value={hdr ? `${hdr.change >= 0 ? "+" : ""}${hdr.change.toFixed(2)}%` : "—"} tone={hdr ? (hdr.change >= 0 ? "green" : "red") : undefined} />
          <Field label="High" value={hdr ? formatPrice(hdr.high) : "—"} />
          <Field label="Low"  value={hdr ? formatPrice(hdr.low)  : "—"} />
          <Field label="Vol 24h" value={hdr ? `$${compactNumber(hdr.vol)}` : "—"} />

          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" className="px-3 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border border-green/30 bg-green/5 text-green hover:bg-green/10">
              <ArrowUp className="w-3 h-3 inline mr-1" /> Buy (B)
            </button>
            <button type="button" className="px-3 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border border-red/30 bg-red/5 text-red hover:bg-red/10">
              <ArrowDown className="w-3 h-3 inline mr-1" /> Sell (S)
            </button>
          </div>
        </div>

        {/* Workspace */}
        <div className="grid grid-cols-12 gap-3">
          {/* Chart */}
          <div className="col-span-12 lg:col-span-8 rounded-lg border border-white/5 bg-black/40 flex flex-col">
            {/* Chart toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Price · {tf}</span>
                <div className="flex items-center gap-0.5 ml-1">
                  {TIMEFRAMES.map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setTf(t)}
                      className={cn(
                        "px-2 py-1 rounded font-mono text-[9px] tracking-widest uppercase transition-colors",
                        t === tf ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-0.5 ml-2 border-l border-white/5 pl-2">
                  {CHART_KINDS.map((k) => {
                    const Icon = k.Icon;
                    const active = k.id === kind;
                    return (
                      <button
                        type="button"
                        key={k.id}
                        onClick={() => setKind(k.id)}
                        title={k.label}
                        className={cn(
                          "p-1.5 rounded transition-colors",
                          active ? "bg-white/10 text-ink" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-ink-3 tracking-widest uppercase hidden md:inline">Indicators</span>
                <button
                  type="button"
                  onClick={() => setMaOn((v) => !v)}
                  className={cn(
                    "px-2 py-1 rounded transition-colors",
                    maOn ? "bg-gold/15 text-gold" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                  )}
                >
                  MA 20
                </button>
                <button
                  type="button"
                  onClick={() => setEmaOn((v) => !v)}
                  className={cn(
                    "px-2 py-1 rounded transition-colors",
                    emaOn ? "bg-violet/15 text-violet" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                  )}
                >
                  EMA 50
                </button>
              </div>
            </div>
            {/* Chart canvas */}
            <div className="p-2 h-[400px] sm:h-[460px]">
              <ProChart
                chain={pair.chain}
                pool={pair.pool}
                tf={tf}
                kind={kind}
                ma={maOn}
                ema={emaOn}
                onLastPrice={onLastPrice}
              />
            </div>
          </div>

          {/* Trades */}
          <div className="col-span-12 lg:col-span-4 space-y-3">
            <ProTrades chain={pair.chain} pool={pair.pool} />

            <div className="rounded-lg border border-gold/15 bg-gold/[0.04] p-3 flex gap-2.5">
              <Sparkles className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-display font-bold text-xs text-gold mb-0.5">ZION standby</div>
                <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
                  Press <kbd className="font-mono text-ink px-1 py-0.5 rounded border border-white/10 bg-white/5">Z</kbd> or open the drawer to ask ZION about this pair.
                </p>
              </div>
            </div>

            {/* Keybinds */}
            <div className="rounded-lg border border-white/5 bg-black/40 p-3 space-y-1.5">
              <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-gold" /> Keybinds
              </div>
              {KEYBINDS.map((k) => (
                <div key={k.keys} className="flex items-center justify-between">
                  <kbd className="font-mono text-[10px] text-ink-2 px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.02]">{k.keys}</kbd>
                  <span className="font-mono text-[10px] text-ink-3">{k.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-4">
          Live OHLCV + trades via GeckoTerminal · TradingView Lightweight Charts · {PRO_PAIRS.length} pairs available · keys 1-{PRO_PAIRS.length} switch
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const cls = tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-ink";
  return (
    <div className="font-mono">
      <div className="text-[10px] text-ink-3 tracking-widest uppercase">{label}</div>
      <div className={cn("text-sm tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}

// keep BarChart export for future
void Activity;
