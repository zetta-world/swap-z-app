"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3, CandlestickChart, LineChart, BarChart2,
  Zap, Activity, ChevronDown, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { compactNumber } from "@/lib/format";
import type { Timeframe, Trade, PriceToken, PoolMeta } from "@/lib/api/geckoterminal";
import { PRO_PAIRS, DEFAULT_PRO_PAIR, CATEGORY_LABELS, groupPairs, type ProPair } from "@/lib/pro-pairs";
import { CHAINS } from "@/lib/chains";
import { findToken } from "@/lib/tokens";
import { useT } from "@/lib/i18n";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import ProChart, { type ChartKind, type StrategyLevel, type ChartSignals } from "./ProChart";
import ProTrades from "./ProTrades";
import ProPoolStats from "./ProPoolStats";
import ProDepth from "./ProDepth";
import ProFlow from "./ProFlow";
import ProOrderPanel from "./ProOrderPanel";
import ProMTF from "./ProMTF";

// Defer the ZION AI dock — it runs a streaming Anthropic call and is never
// in the initial viewport. Loading it lazily lets the chart + trades panel
// render first without waiting for the AI SDK import chain.
const ProZionDock = dynamic(() => import("./ProZionDock"), {
  ssr: false,
  loading: () => (
    <div className="rounded-lg border border-white/5 bg-black/40 h-[200px] shimmer" />
  ),
});

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

type StrategyScenario = "conservative" | "moderate" | "aggressive";

// Cryptocurrency icon CDN base
const CRYPTO_ICON_BASE = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/icon";

export default function ProTerminal() {
  const t = useT();

  // ─── Tier theming ──────────────────────────────────────────────────
  const { accentColor, glowColor, active: tierActive } = useTierAccent();
  const terminalBorder = tierActive
    ? `1px solid ${accentColor}22`
    : "1px solid rgba(255,255,255,0.06)";

  // ─── State ────────────────────────────────────────────────────────
  const [pair, setPair]         = useState<ProPair>(DEFAULT_PRO_PAIR);
  const [tf, setTf]             = useState<Timeframe>("5m");
  const [kind, setKind]         = useState<ChartKind>("candle");
  const [maOn, setMaOn]         = useState(false);
  const [emaOn, setEmaOn]       = useState(false);
  const [bb, setBb]             = useState(false);
  const [vwap, setVwap]         = useState(false);
  const [ema9, setEma9]         = useState(false);
  const [ema21, setEma21]       = useState(false);
  const [ema100, setEma100]     = useState(false);
  const [ema200, setEma200]     = useState(false);
  const [rsiOn, setRsiOn]       = useState(false);
  const [macd, setMacd]         = useState(false);
  const [stochRsi, setStochRsi] = useState(false);
  const [signals, setSignals]   = useState<ChartSignals | null>(null);
  const [strategyOn, setStrategyOn]           = useState(false);
  const [strategyScenario, setStrategyScenario] = useState<StrategyScenario>("moderate");
  const [indicatorsOpen, setIndicatorsOpen]   = useState(false);
  const [pairOpen, setPairOpen]               = useState(false);
  const [pairQuery, setPairQuery]             = useState("");

  // Live header values pushed from ProChart
  const [hdr, setHdr] = useState<{ last: number; change: number; high: number; low: number; vol: number } | null>(null);
  const onLastPrice = useCallback((last: number, change: number, high: number, low: number, vol: number) => {
    setHdr({ last, change, high, low, vol });
  }, []);

  // ProTrades publishes its current trade window up to the parent so the
  // flow + depth panels can derive aggregate stats without re-fetching.
  const [trades, setTrades] = useState<Trade[]>([]);
  const onTrades = useCallback((next: Trade[]) => setTrades(next), []);

  const onSignals = useCallback((s: ChartSignals) => setSignals(s), []);

  const [chartSide, setChartSide] = useState<PriceToken>("base");
  const onMeta = useCallback((_meta: PoolMeta | null, side: PriceToken) => setChartSide(side), []);

  // Resolve Tokens for the depth matrix (it needs decimals + addresses).
  const fromToken = useMemo(() => findToken(pair.chain, pair.base),  [pair.chain, pair.base]);
  const toToken   = useMemo(() => findToken(pair.chain, pair.quote), [pair.chain, pair.quote]);

  const chainObj = useMemo(() => CHAINS.find((c) => c.id === pair.chain), [pair.chain]);

  // Filtered list for the picker
  const filteredPairs = useMemo(() => {
    const q = pairQuery.trim().toLowerCase();
    if (!q) return PRO_PAIRS;
    return PRO_PAIRS.filter((p) =>
      (p.base + p.quote + p.dex + p.chain).toLowerCase().includes(q),
    );
  }, [pairQuery]);
  const grouped = useMemo(() => groupPairs(filteredPairs), [filteredPairs]);

  // ─── Strategy levels ─────────────────────────────────────────────
  const strategyLevels = useMemo((): StrategyLevel[] => {
    if (!strategyOn || !hdr) return [];
    const p   = hdr.last;
    const atr = signals?.atr ?? (p * 0.01);
    const configs: Record<StrategyScenario, { entryMult: number; targetMult: number; stopMult: number }> = {
      conservative: { entryMult: 0.2, targetMult: 1.5, stopMult: 1.0 },
      moderate:     { entryMult: 0.2, targetMult: 2.5, stopMult: 1.2 },
      aggressive:   { entryMult: 0.3, targetMult: 4.0, stopMult: 1.5 },
    };
    const c      = configs[strategyScenario];
    const entry  = p - c.entryMult  * atr;
    const target = entry + c.targetMult * atr;
    const stop   = entry - c.stopMult   * atr;
    return [
      { price: entry,  label: `Entry ·${c.entryMult}×ATR`,   color: "#00E8FF", style: "solid"  },
      { price: target, label: `TP +${c.targetMult}×ATR`,      color: strategyScenario === "aggressive" ? "#F5A623" : "#00E087", style: "dashed" },
      { price: stop,   label: `SL -${c.stopMult}×ATR`,        color: "#FF3B5C", style: "dashed" },
    ];
  }, [strategyOn, hdr, strategyScenario, signals]);

  // ─── Conviction score ────────────────────────────────────────────
  const convictionScore = useMemo((): { score: number; label: string; color: string } | null => {
    if (!signals?.price) return null;
    const p = signals.price;
    let bull = 0; let total = 0;
    if (ema9   && signals.ema9   != null) { total++; if (p > signals.ema9)   bull++; }
    if (ema21  && signals.ema21  != null) { total++; if (p > signals.ema21)  bull++; }
    if (emaOn  && signals.ema50  != null) { total++; if (p > signals.ema50)  bull++; }
    if (ema100 && signals.ema100 != null) { total++; if (p > signals.ema100) bull++; }
    if (ema200 && signals.ema200 != null) { total++; if (p > signals.ema200) bull++; }
    if (vwap   && signals.vwap   != null) { total++; if (p > signals.vwap)   bull++; }
    if (rsiOn  && signals.rsi    != null) { total++; if (signals.rsi > 50)   bull++; }
    if (macd   && signals.macdBull != null) { total++; if (signals.macdBull) bull++; }
    if (total === 0) return null;
    const score = Math.round((bull / total) * 100);
    if (score >= 70) return { score, label: "HIGH",   color: "#00E087" };
    if (score >= 40) return { score, label: "MEDIUM", color: "#F5A623" };
    return              { score, label: "LOW",    color: "#FF3B5C" };
  }, [signals, ema9, ema21, emaOn, ema100, ema200, vwap, rsiOn, macd]);

  // ─── Market regime ───────────────────────────────────────────────
  const marketRegime = useMemo((): { label: string; color: string } | null => {
    if (!signals?.price || !signals.atr) return null;
    const { price, atr, ema21: e21, ema50: e50 } = signals;
    const atrPct      = (atr / price) * 100;
    const isVolatile  = atrPct > 2.5;
    const isTrending  = e21 != null && e50 != null && Math.abs(e21 - e50) / price > 0.004;
    const isBullTrend = e21 != null && e50 != null && e21 > e50;
    if (isTrending && isBullTrend)  return { label: "TRENDING ↑", color: "#00E087" };
    if (isTrending && !isBullTrend) return { label: "TRENDING ↓", color: "#FF3B5C" };
    if (isVolatile)                 return { label: "VOLATILE ⚡", color: "#F5A623" };
    return                                 { label: "RANGING ↔",  color: "#7E89C2" };
  }, [signals]);

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

  // Token logo URL helper
  const tokenLogoUrl = (symbol: string) =>
    `${CRYPTO_ICON_BASE}/${symbol.toLowerCase().replace(/^w/, "")}.png`;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden bg-black">
      <div className="absolute inset-0 grid-bg-dense opacity-25 pointer-events-none" />

      <div className="relative z-10 p-3 sm:p-4 lg:p-5 max-w-[1900px] mx-auto w-full">
        {/* Top bar */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 flex-wrap mb-3"
        >
          <BarChart3 className="w-4 h-4" style={{ color: accentColor }} />
          <span
            className="font-mono text-[10px] tracking-widest uppercase"
            style={{ color: `${accentColor}cc` }}
          >
            Pro Terminal · Z-SWAP
          </span>
          <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green pulse-dot" /> LIVE
            </span>
            <span className="text-ink-4">·</span>
            <span className="hidden sm:inline">GeckoTerminal feed</span>
          </div>
        </motion.div>

        {/* Pair header */}
        <div
          className="rounded-lg bg-black/40 p-3 flex items-center gap-3 sm:gap-5 flex-wrap mb-3"
          style={{ border: terminalBorder }}
        >
          {/* Pair selector with token logo */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => setPairOpen((o) => !o)}
              aria-expanded={pairOpen}
              aria-haspopup="listbox"
              aria-label={t("pro.selectPair")}
              className="flex items-center gap-3 hover:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
            >
              {/* Token logo with chain badge */}
              <div className="relative w-9 h-9 flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tokenLogoUrl(pair.base)}
                  alt={pair.base}
                  width={36}
                  height={36}
                  className="w-9 h-9 rounded-full object-cover bg-white/5"
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    el.style.display = "none";
                    const fallback = el.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = "flex";
                  }}
                />
                {/* Fallback colored square */}
                <span
                  className="w-9 h-9 rounded-full items-center justify-center font-display font-extrabold text-xs hidden absolute inset-0"
                  style={{
                    background: `${chainObj?.color}22`,
                    color:      chainObj?.color,
                    border:     `1px solid ${chainObj?.color}55`,
                  }}
                >
                  {pair.base.slice(0, 2)}
                </span>
                {/* Chain badge */}
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 rounded-full border border-black flex items-center justify-center overflow-hidden"
                  style={{ background: chainObj?.color ?? "#444" }}
                  title={chainObj?.name}
                >
                  {chainObj?.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={chainObj.logo} alt={chainObj.short ?? ""} width={16} height={16} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[6px] font-bold text-black">{chainObj?.short?.slice(0, 2) ?? "?"}</span>
                  )}
                </div>
              </div>
              <div className="text-left">
                <div className="font-display font-extrabold text-base sm:text-lg text-ink leading-none">
                  {pair.base} / {pair.quote}
                </div>
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1">
                  {chainObj?.short} · {pair.dex} {pair.feeTier && `· ${pair.feeTier}`}
                </div>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-ink-3 transition-transform", pairOpen && "rotate-180")} />
            </button>

            {/* Pair dropdown */}
            {pairOpen && (
              <div
                role="dialog"
                aria-label={t("pro.selectPair")}
                className="absolute left-0 top-full mt-1 z-20 w-[320px] sm:w-[360px] rounded-lg border border-white/10 glass-strong shadow-card overflow-hidden flex flex-col"
                style={{ maxHeight: "440px" }}
              >
                <div className="p-2 border-b border-white/5 flex-shrink-0">
                  <input
                    autoFocus
                    value={pairQuery}
                    onChange={(e) => setPairQuery(e.target.value)}
                    placeholder={t("common.searchTokens")}
                    aria-label={t("common.searchTokens")}
                    className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 text-[11px] font-mono text-ink placeholder:text-ink-4 outline-none focus:border-cyan/40"
                  />
                </div>
                <div role="listbox" aria-label={t("pro.selectPair")} className="flex-1 overflow-y-auto">
                  {filteredPairs.length === 0 && (
                    <div className="p-6 text-center font-mono text-[10px] text-ink-3">No matching pairs</div>
                  )}
                  {(Object.keys(grouped) as ProPair["category"][]).map((cat) => (
                    <div key={cat}>
                      {/* Category header with count */}
                      <div className="px-3 py-1.5 font-mono text-[9px] text-ink-4 tracking-widest uppercase bg-white/[0.02] border-b border-white/5 flex items-center gap-2">
                        <span>{CATEGORY_LABELS[cat]}</span>
                        <span className="ml-auto bg-white/5 rounded px-1.5 py-0.5 text-ink-4">{grouped[cat].length}</span>
                      </div>
                      {grouped[cat].map((p) => {
                        const c    = CHAINS.find((ch) => ch.id === p.chain);
                        const active = p.id === pair.id;
                        return (
                          <button
                            type="button"
                            key={p.id}
                            role="option"
                            aria-selected={active}
                            onClick={() => { setPair(p); setPairOpen(false); setPairQuery(""); }}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors",
                              active && "bg-cyan/[0.06]",
                            )}
                          >
                            {/* Chain logo */}
                            <div
                              className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                              style={{ background: c?.color ?? "#444" }}
                            >
                              {c?.logo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.logo} alt={c.short ?? ""} width={16} height={16} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[6px] font-bold text-black">{c?.short?.slice(0, 2) ?? "?"}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-display font-bold text-xs text-ink truncate">
                                {p.base} / {p.quote}
                              </div>
                              <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider truncate">
                                {c?.short} · {p.dex} {p.feeTier && `· ${p.feeTier}`}
                              </div>
                            </div>
                            {/* Fee tier chip */}
                            {p.feeTier && (
                              <span className="font-mono text-[8px] text-ink-4 bg-white/5 rounded px-1.5 py-0.5 flex-shrink-0">
                                {p.feeTier}
                              </span>
                            )}
                            {/* LIVE badge */}
                            {active && (
                              <span className="font-mono text-[9px] tracking-widest uppercase flex-shrink-0" style={{ color: accentColor }}>
                                live
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-white/5 font-mono text-[9px] text-ink-4 flex items-center justify-between flex-shrink-0">
                  <span>{PRO_PAIRS.length} pairs available</span>
                  <span>Keys 1-9 cycle</span>
                </div>
              </div>
            )}
          </div>

          {/* Price display */}
          <div className="font-mono">
            <div className="text-[10px] text-ink-3 tracking-widest uppercase">Last</div>
            <div className={cn(
              "font-display font-extrabold text-xl sm:text-2xl tabular-nums",
              hdr ? (hdr.change >= 0 ? "text-green" : "text-red") : "text-ink",
            )}>
              {hdr ? formatPrice(hdr.last) : "—"}
            </div>
          </div>
          <Field label="24h"    value={hdr ? `${hdr.change >= 0 ? "+" : ""}${hdr.change.toFixed(2)}%` : "—"} tone={hdr ? (hdr.change >= 0 ? "green" : "red") : undefined} />
          <Field label="High"   value={hdr ? formatPrice(hdr.high) : "—"} />
          <Field label="Low"    value={hdr ? formatPrice(hdr.low)  : "—"} />
          <Field label="Vol 24h" value={hdr ? `$${compactNumber(hdr.vol)}` : "—"} />
          {marketRegime && (
            <div className="font-mono hidden sm:block">
              <div className="text-[10px] text-ink-3 tracking-widest uppercase">Regime</div>
              <div className="text-[11px] font-bold tracking-wider" style={{ color: marketRegime.color }}>
                {marketRegime.label}
              </div>
            </div>
          )}
        </div>

        {/* Workspace */}
        <div className="grid grid-cols-12 gap-3">
          {/* Chart */}
          <div
            className="col-span-12 lg:col-span-8 rounded-lg bg-black/40 flex flex-col"
            style={{ border: terminalBorder }}
          >
            {/* Chart toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Price · {tf}</span>
                {/* Timeframes */}
                <div className="flex items-center gap-0.5 ml-1">
                  {TIMEFRAMES.map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => setTf(t)}
                      aria-pressed={t === tf}
                      className={cn(
                        "px-2 py-1 rounded font-mono text-[9px] tracking-widest uppercase transition-colors",
                        t === tf ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {/* Chart kind */}
                <div className="flex items-center gap-0.5 ml-2 border-l border-white/5 pl-2">
                  {CHART_KINDS.map((k) => {
                    const Icon   = k.Icon;
                    const active = k.id === kind;
                    return (
                      <button
                        type="button"
                        key={k.id}
                        onClick={() => setKind(k.id)}
                        aria-label={k.label}
                        aria-pressed={active}
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

              {/* Indicators toggle + strategy toggle */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStrategyOn((v) => !v)}
                  aria-pressed={strategyOn}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-[9px] tracking-widest uppercase border transition-all",
                    strategyOn
                      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
                      : "border-white/5 text-ink-3 hover:border-white/15 hover:text-ink-2",
                  )}
                >
                  <Zap className="w-3 h-3" />
                  <span className="hidden sm:inline">ZION</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIndicatorsOpen((v) => !v)}
                  aria-pressed={indicatorsOpen}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-[9px] tracking-widest uppercase border transition-all",
                    indicatorsOpen
                      ? "border-white/20 bg-white/8 text-ink"
                      : "border-white/5 text-ink-3 hover:border-white/15 hover:text-ink-2",
                  )}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span className="hidden sm:inline">Indicators</span>
                </button>
              </div>
            </div>

            {/* Indicators panel */}
            <AnimatePresence>
              {indicatorsOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ overflow: "hidden" }}
                  className="px-3 py-2 border-b border-white/5 flex flex-col gap-1.5"
                >
                  {/* Row 1: Moving averages */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[8px] text-ink-4 tracking-widest uppercase w-14">MA</span>
                    <IndicatorChip label="EMA 9"   on={ema9}   onToggle={() => setEma9((v)   => !v)} accentColor={accentColor} color="#00E8FF" />
                    <IndicatorChip label="MA 20"   on={maOn}   onToggle={() => setMaOn((v)   => !v)} accentColor={accentColor} color="#F5A623" />
                    <IndicatorChip label="EMA 21"  on={ema21}  onToggle={() => setEma21((v)  => !v)} accentColor={accentColor} color="#F5A623" />
                    <IndicatorChip label="EMA 50"  on={emaOn}  onToggle={() => setEmaOn((v)  => !v)} accentColor={accentColor} color="#9F5FFF" />
                    <IndicatorChip label="EMA 100" on={ema100} onToggle={() => setEma100((v) => !v)} accentColor={accentColor} color="#9F5FFF" />
                    <IndicatorChip label="EMA 200" on={ema200} onToggle={() => setEma200((v) => !v)} accentColor={accentColor} color="#FF3B5C" />
                  </div>
                  {/* Row 2: Overlays */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[8px] text-ink-4 tracking-widest uppercase w-14">Overlay</span>
                    <IndicatorChip label="BB 20" on={bb}   onToggle={() => setBb((v)   => !v)} accentColor={accentColor} color="#FF6B35" />
                    <IndicatorChip label="VWAP"  on={vwap} onToggle={() => setVwap((v) => !v)} accentColor={accentColor} color="#FFD700" />
                  </div>
                  {/* Row 3: Oscillators */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-[8px] text-ink-4 tracking-widest uppercase w-14">Osc</span>
                    <IndicatorChip label="RSI 14"  on={rsiOn}   onToggle={() => setRsiOn((v)   => !v)} accentColor={accentColor} color="#9F5FFF" />
                    <IndicatorChip label="Stoch RSI" on={stochRsi} onToggle={() => setStochRsi((v) => !v)} accentColor={accentColor} color="#C9A2FF" />
                    <IndicatorChip label="MACD"      on={macd}     onToggle={() => setMacd((v)     => !v)} accentColor={accentColor} color="#00E8FF" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chart canvas */}
            <div className="p-2 h-[400px] sm:h-[460px]">
              <ProChart
                chain={pair.chain}
                pool={pair.pool}
                tf={tf}
                kind={kind}
                ma={maOn}
                ema={emaOn}
                bb={bb}
                vwap={vwap}
                ema9={ema9}
                ema21={ema21}
                ema100={ema100}
                ema200={ema200}
                rsiOn={rsiOn}
                macd={macd}
                stochRsi={stochRsi}
                onSignals={onSignals}
                strategyLevels={strategyLevels}
                targetSymbol={pair.targetSymbol}
                onLastPrice={onLastPrice}
                onMeta={onMeta}
              />
            </div>
          </div>

          {/* Right rail: Order panel + ZION dock + trades */}
          <div className="col-span-12 lg:col-span-4 space-y-3">
            <ProOrderPanel
              pair={{ base: pair.base, quote: pair.quote, chain: pair.chain }}
              lastPrice={hdr?.last ?? null}
              accentColor={accentColor}
            />
            <ProZionDock
              chain={pair.chain}
              fromSymbol={pair.base}
              toSymbol={pair.quote}
              midPrice={hdr?.last ?? 0}
            />
            <ProTrades chain={pair.chain} pool={pair.pool} onTrades={onTrades} />
          </div>
        </div>

        <div className="mt-3">
          <ProMTF chain={pair.chain} pool={pair.pool} side={chartSide} accentColor={accentColor} />
        </div>

        {/* Pro tools row: pool stats · depth · flow */}
        <div className="grid grid-cols-12 gap-3 mt-3">
          <div className="col-span-12 xl:col-span-4">
            <ProPoolStats chain={pair.chain} pool={pair.pool} feeTier={pair.feeTier} />
          </div>
          <div className="col-span-12 md:col-span-7 xl:col-span-5">
            <ProDepth
              fromToken={fromToken}
              toToken={toToken}
              chain={pair.chain}
              midPrice={hdr?.last ?? 0}
            />
          </div>
          <div className="col-span-12 md:col-span-5 xl:col-span-3">
            <ProFlow trades={trades} />
          </div>
        </div>

        {/* Strategy panel — full width, only when strategyOn */}
        <AnimatePresence>
          {strategyOn && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: "hidden" }}
              className="mt-3"
            >
              <div
                className="rounded-lg bg-black/50 border p-4"
                style={{ borderColor: `${accentColor}22` }}
              >
                {/* Header */}
                <div className="flex items-center gap-3 mb-3">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="font-mono text-[10px] tracking-widest uppercase text-yellow-400">
                    ZION Strategy
                  </span>
                  {hdr && (
                    <span className="font-mono text-[10px] text-ink-3">
                      · Based on price action at {formatPrice(hdr.last)}
                    </span>
                  )}
                </div>

                {/* Scenario tabs */}
                <div className="flex gap-1.5 mb-4">
                  {(["conservative", "moderate", "aggressive"] as StrategyScenario[]).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setStrategyScenario(sc)}
                      aria-pressed={strategyScenario === sc}
                      className="px-3 py-1.5 rounded font-mono text-[9px] tracking-widest uppercase border transition-all"
                      style={strategyScenario === sc
                        ? { borderColor: `${accentColor}55`, background: `${accentColor}15`, color: accentColor }
                        : { borderColor: "rgba(255,255,255,0.07)", color: "#64748b" }
                      }
                    >
                      {sc}
                    </button>
                  ))}
                </div>

                {/* Levels grid */}
                {hdr && (() => {
                  const p   = hdr.last;
                  const atr = signals?.atr ?? (p * 0.01);
                  const cfgMap = {
                    conservative: { entryMult: 0.2, targetMult: 1.5, stopMult: 1.0 },
                    moderate:     { entryMult: 0.2, targetMult: 2.5, stopMult: 1.2 },
                    aggressive:   { entryMult: 0.3, targetMult: 4.0, stopMult: 1.5 },
                  };
                  const cfg    = cfgMap[strategyScenario];
                  const entry  = p - cfg.entryMult  * atr;
                  const target = entry + cfg.targetMult * atr;
                  const stop   = entry - cfg.stopMult   * atr;
                  const rr     = (target - entry) / Math.max(entry - stop, 0.000001);
                  return (
                    <>
                      {signals?.atr && (
                        <div className="font-mono text-[9px] text-ink-4 mb-2">
                          ATR(14) = <span className="text-ink-3">{formatPrice(signals.atr)}</span>
                          <span className="mx-1.5">·</span>
                          <span className="text-ink-3">{((signals.atr / hdr.last) * 100).toFixed(2)}% of price</span>
                        </div>
                      )}
                      {convictionScore && (
                        <div className="flex items-center gap-3 mb-3 rounded-lg border px-3 py-2"
                          style={{ borderColor: `${convictionScore.color}25`, background: `${convictionScore.color}08` }}
                        >
                          <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">Conviction</span>
                          <div className="flex items-center gap-2 ml-auto">
                            <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${convictionScore.score}%`, background: convictionScore.color }}
                              />
                            </div>
                            <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color: convictionScore.color }}>
                              {convictionScore.score}%
                            </span>
                            <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: convictionScore.color }}>
                              {convictionScore.label}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <StrategyLevelCard
                          title="Entry"
                          price={entry}
                          pctLabel={`${((entry / p - 1) * 100).toFixed(2)}%`}
                          color="#00E8FF"
                        />
                        <StrategyLevelCard
                          title="Target"
                          price={target}
                          pctLabel={`+${((target / p - 1) * 100).toFixed(1)}%`}
                          color="#00E087"
                        />
                        <StrategyLevelCard
                          title="Stop Loss"
                          price={stop}
                          pctLabel={`-${((1 - stop / p) * 100).toFixed(1)}%`}
                          color="#FF3B5C"
                        />
                      </div>
                      <div className="font-mono text-[10px] text-ink-3">
                        Risk/Reward: <span className="text-ink">1:{rr.toFixed(1)}</span>
                        <span className="mx-2 text-ink-4">·</span>
                        Scenario: <span className="text-ink">{strategyScenario}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Keybinds footer */}
        <details className="mt-3 rounded-lg border border-white/5 bg-black/40 overflow-hidden">
          <summary className="px-3 py-2 cursor-pointer list-none flex items-center gap-2 font-mono text-[10px] text-ink-3 tracking-widest uppercase hover:bg-white/[0.02]">
            <Zap className="w-3 h-3 text-gold" />
            Keybinds
            <span className="text-ink-4">·</span>
            <span className="text-ink-4">{PRO_PAIRS.length} pairs · 1-9 cycle</span>
          </summary>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-1.5 px-3 py-2 border-t border-white/5">
            {KEYBINDS.map((k) => (
              <div key={k.keys} className="flex items-center gap-2">
                <kbd className="font-mono text-[10px] text-ink-2 px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.02]">{k.keys}</kbd>
                <span className="font-mono text-[10px] text-ink-3">{k.label}</span>
              </div>
            ))}
          </div>
        </details>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-4">
          OHLCV + trades · GeckoTerminal · depth · 0x quote · flow · ZION dock · trading-mode analysis
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Field({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const cls = tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-ink";
  return (
    <div className="font-mono">
      <div className="text-[10px] text-ink-3 tracking-widest uppercase">{label}</div>
      <div className={cn("text-sm tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function IndicatorChip({
  label, on, onToggle, accentColor, color,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  accentColor: string;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="px-2.5 py-1 rounded font-mono text-[9px] tracking-widest uppercase border transition-all"
      style={on
        ? { borderColor: `${color}55`, background: `${color}15`, color }
        : { borderColor: "rgba(255,255,255,0.07)", color: "#64748b" }
      }
    >
      {on && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full mr-1 -mt-0.5 align-middle"
          style={{ background: accentColor }}
        />
      )}
      {label}
    </button>
  );
}

function StrategyLevelCard({
  title, price, pctLabel, color,
}: {
  title: string;
  price: number;
  pctLabel: string;
  color: string;
}) {
  return (
    <div
      className="rounded-lg p-3 border"
      style={{ borderColor: `${color}22`, background: `${color}08` }}
    >
      <div className="font-mono text-[9px] tracking-widest uppercase mb-1" style={{ color }}>
        {title}
      </div>
      <div className="font-display font-bold text-sm text-ink tabular-nums">
        {formatPrice(price)}
      </div>
      <div className="font-mono text-[9px] mt-0.5" style={{ color }}>
        {pctLabel}
      </div>
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

// keep unused Activity export for future
void Activity;
