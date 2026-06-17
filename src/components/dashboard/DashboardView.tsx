"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Wallet, TrendingUp, TrendingDown, Minus, Eye, EyeOff,
  LineChart, PieChart, Layers, Activity, Bot, Receipt, Coins, Percent,
  ArrowUpRight, Banknote, AlertTriangle, CheckCircle2, Power,
  Sparkles, Flame, Crown, Loader2, Zap,
} from "lucide-react";
import { usePortfolioHistory, type PortfolioSnapshot } from "@/lib/store/portfolioHistory";
import {
  useTxHistory, TX_TYPE_LABELS_PT, STATUS_LABELS_PT,
  type TxType, type TxStatus,
} from "@/lib/store/txHistory";
import { useAutopilot } from "@/lib/store/autopilot";
import { useTrackedHoldings } from "@/lib/hooks/useTrackedHoldings";
import { useCexVault } from "@/lib/cex/vault";
import { type CexId, type CexCredentials, type CexBalanceResponse } from "@/lib/cex/types";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Panel, Kpi, AreaChart, Donut, Bars, Gauge } from "./widgets";

const CEX_TOTAL_CACHE_KEY = "zswap_cex_last_total_usd";

function readCachedCexTotal(): number {
  try {
    return parseFloat(localStorage.getItem(CEX_TOTAL_CACHE_KEY) ?? "0") || 0;
  } catch { return 0; }
}

/**
 * Fetch live CEX totals when vault is unlocked.
 * When locked: returns the last successfully-fetched total from localStorage
 * so the portfolio doesn't suddenly show $0 just because the vault is locked.
 */
function useLiveCexTotal(): { total: number; loading: boolean; stale: boolean } {
  const creds = useCexVault((s) => s.creds);
  const [total,   setTotal]   = useState(() => readCachedCexTotal());
  const [loading, setLoading] = useState(false);
  const [stale,   setStale]   = useState(true);
  const prevCredsRef = useRef<typeof creds>(null);

  useEffect(() => {
    // Only re-fetch when credentials actually change
    if (creds === prevCredsRef.current) return;
    prevCredsRef.current = creds;
    if (!creds) {
      // Vault locked — fall back to cached value instead of zeroing out
      const cached = readCachedCexTotal();
      setTotal(cached);
      setStale(true);
      return;
    }
    const entries = Object.entries(creds) as [CexId, CexCredentials][];
    if (entries.length === 0) return;
    setLoading(true);
    Promise.all(
      entries.map(([exchangeId, c]) =>
        fetch("/api/cex/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exchange: exchangeId, apiKey: c.apiKey,
            apiSecret: c.apiSecret, passphrase: c.passphrase, withUsd: true,
          }),
        })
        .then((r) => r.json())
        .then((d: CexBalanceResponse) => (d.ok ? d.totalUsd : 0))
        .catch(() => 0),
      ),
    ).then((totals) => {
      const live = totals.reduce((s, v) => s + v, 0);
      setTotal(live);
      setStale(false);
      setLoading(false);
      // Cache the fresh total so future locked-vault sessions stay accurate
      if (live > 0) {
        try { localStorage.setItem(CEX_TOTAL_CACHE_KEY, String(live)); } catch {}
      }
    });
  }, [creds]);

  return { total, loading, stale };
}

type AllocMode = "chains" | "assets" | "all" | "venues";

interface Insight {
  Icon: React.ComponentType<{ className?: string }>;
  tone: "cyan" | "violet" | "gold" | "green" | "red";
  text: string;
}

type Range = "24h" | "7d" | "30d" | "all";

const RANGE_MS: Record<Exclude<Range, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7  * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const TYPE_COLOR: Record<TxType, string> = {
  dex_swap:      "#00E8FF",
  dex_bridge:    "#A78BFA",
  cex_spot:      "#F5B544",
  cex_futures:   "#f87171",
  autopilot_dex: "#34d399",
  autopilot_cex: "#34d399",
  autopilot_arb: "#34d399",
  rebalance:     "#94a3b8",
};

const STATUS_TEXT: Record<TxStatus, string> = {
  pending:   "text-gold",
  confirmed: "text-green",
  failed:    "text-red",
  canceled:  "text-ink-3",
};

/** P&L between the snapshot closest to (now - window) and the latest value. */
function pnlOverWindow(snaps: PortfolioSnapshot[], windowMs: number): { abs: number; pct: number } | null {
  if (snaps.length < 2) return null;
  const latest = snaps[snaps.length - 1];
  const cutoff = Date.now() - windowMs;
  // The last snapshot at or before the cutoff is our baseline; fall back to
  // the earliest snapshot when the window predates our whole history.
  let base: PortfolioSnapshot | undefined;
  for (const s of snaps) {
    if (s.ts <= cutoff) base = s;
    else break;
  }
  base = base ?? snaps[0];
  if (base.totalUsd <= 0 || base.ts === latest.ts) return null;
  const abs = latest.totalUsd - base.totalUsd;
  const pct = (abs / base.totalUsd) * 100;
  return { abs, pct };
}

export default function DashboardView() {
  const { snapshots } = usePortfolioHistory();
  const { entries }   = useTxHistory();
  const a             = useAutopilot();
  const live          = useTrackedHoldings();
  const liveCex       = useLiveCexTotal();

  const [hidden, setHidden] = useState(false);
  const [range,  setRange]  = useState<Range>("7d");
  const [allocMode, setAllocMode] = useState<AllocMode>("chains");

  // ZION narrative streaming state
  const [zionNarrative,  setZionNarrative]  = useState<string>("");
  const [zionStreaming,  setZionStreaming]   = useState(false);

  const mask = (v: string) => (hidden ? "•••••" : v);

  // ─── Current totals ────────────────────────────────────────────────────
  const latest = snapshots[snapshots.length - 1] ?? null;
  // liveCex.total now returns cached value even when vault is locked, so
  // the portfolio doesn't suddenly show $0 because of a locked session.
  const cexUsd    = liveCex.total > 0 ? liveCex.total : (latest?.cexUsd ?? 0);
  const walletUsd = live.anyWalletConnected ? live.walletUsd : (latest?.walletUsd ?? 0);
  // Include CEX even when no wallet is connected (user may be CEX-only)
  const totalUsd  = (live.anyWalletConnected || cexUsd > 0)
    ? walletUsd + cexUsd
    : (latest?.totalUsd ?? 0);

  // ─── Hero P&L windows ─────────────────────────────────────────────────
  const pnl24h = useMemo(() => pnlOverWindow(snapshots, RANGE_MS["24h"]), [snapshots]);
  const pnl7d  = useMemo(() => pnlOverWindow(snapshots, RANGE_MS["7d"]),  [snapshots]);
  const pnl30d = useMemo(() => pnlOverWindow(snapshots, RANGE_MS["30d"]), [snapshots]);

  // ─── Trade aggregates from history ────────────────────────────────────
  const stats = useMemo(() => {
    const confirmed = entries.filter((e) => e.status === "confirmed");
    const withPnl   = confirmed.filter((e) => e.pnlUsd !== undefined);
    const wins      = withPnl.filter((e) => (e.pnlUsd ?? 0) > 0).length;
    const volume    = confirmed.reduce((s, e) => s + (e.valueUsd ?? 0), 0);
    const fees      = confirmed.reduce((s, e) => s + (e.feesUsd ?? 0), 0);
    const realized  = withPnl.reduce((s, e) => s + (e.pnlUsd ?? 0), 0);
    const winRate   = withPnl.length > 0 ? (wins / withPnl.length) * 100 : null;
    const pending   = entries.filter((e) => e.status === "pending").length;
    return {
      total: entries.length, confirmed: confirmed.length, pending,
      volume, fees, realized, winRate, wins, scored: withPnl.length,
    };
  }, [entries]);

  // ─── Equity curve series for the selected range ───────────────────────
  const series = useMemo(() => {
    const cutoff = range === "all" ? 0 : Date.now() - RANGE_MS[range];
    return snapshots
      .filter((s) => s.ts >= cutoff)
      .map((s) => ({ ts: s.ts, value: s.totalUsd }));
  }, [snapshots, range]);

  const rangeDelta = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0].value;
    const last  = series[series.length - 1].value;
    const abs = last - first;
    return { abs, pct: first > 0 ? (abs / first) * 100 : 0 };
  }, [series]);

  // ─── Allocation: mode-aware segments ──────────────────────────────────
  const allocation = useMemo(() => {
    if (allocMode === "venues") {
      return [
        { label: "Carteira", value: walletUsd, color: "#00E8FF" },
        { label: "CEX",      value: cexUsd,    color: "#A78BFA" },
      ].filter((s) => s.value > 0);
    }
    if (allocMode === "chains") {
      return live.byChain.map((c) => ({
        label: c.chain?.short ?? c.id,
        value: c.value,
        color: c.chain?.color ?? "#00E8FF",
      }));
    }
    if (allocMode === "all") {
      // All wallet assets + CEX as a single block
      const segs = live.byAsset.map((x) => ({ label: x.symbol, value: x.value, color: x.color }));
      if (cexUsd > 0) segs.push({ label: "CEX", value: cexUsd, color: "#A78BFA" });
      return segs;
    }
    // assets — top 5, fold the rest + CEX into summary entries
    const top = live.byAsset.slice(0, 5);
    const rest = live.byAsset.slice(5).reduce((s, x) => s + x.value, 0);
    const segs = top.map((x) => ({ label: x.symbol, value: x.value, color: x.color }));
    if (rest > 0) segs.push({ label: "Outros", value: rest, color: "#64748b" });
    if (cexUsd > 0) segs.push({ label: "CEX", value: cexUsd, color: "#A78BFA" });
    return segs;
  }, [allocMode, walletUsd, cexUsd, live.byChain, live.byAsset]);

  const allocTotal = useMemo(() => allocation.reduce((s, x) => s + x.value, 0), [allocation]);

  // ─── P&L / volume by operation type ───────────────────────────────────
  const byType = useMemo(() => {
    const map = new Map<TxType, { count: number; volume: number; pnl: number; fees: number }>();
    for (const e of entries) {
      if (e.status !== "confirmed") continue;
      const row = map.get(e.type) ?? { count: 0, volume: 0, pnl: 0, fees: 0 };
      row.count  += 1;
      row.volume += e.valueUsd ?? 0;
      row.pnl    += e.pnlUsd   ?? 0;
      row.fees   += e.feesUsd  ?? 0;
      map.set(e.type, row);
    }
    return [...map.entries()].sort((x, y) => y[1].volume - x[1].volume);
  }, [entries]);

  // ─── Activity: volume per day, last 14 days ───────────────────────────
  const activity = useMemo(() => {
    const DAYS = 14;
    const now = new Date();
    const buckets: { label: string; value: number; ts: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      buckets.push({ label: String(d.getDate()), value: 0, ts: d.getTime() });
    }
    const start = buckets[0].ts;
    for (const e of entries) {
      if (e.status !== "confirmed") continue;
      if (e.ts < start) continue;
      const idx = Math.floor((e.ts - start) / (24 * 60 * 60 * 1000));
      if (idx >= 0 && idx < buckets.length) buckets[idx].value += e.valueUsd ?? 0;
    }
    return buckets;
  }, [entries]);

  // ─── Autopilot panel data ─────────────────────────────────────────────
  const apStats = useMemo(() => {
    const fired    = a.history.filter((h) => h.status === "fired").length;
    const rejected = a.history.filter((h) => h.status === "rejected" || h.status === "errored").length;
    const canceled = a.history.filter((h) => h.status === "canceled").length;
    const lossUsed = a.dailyLossStopUsd > 0 ? Math.min(1, Math.max(0, -a.pnlToday) / a.dailyLossStopUsd) : 0;
    const tradesUsed = a.maxTradesPerDay > 0 ? Math.min(1, a.tradesToday / a.maxTradesPerDay) : 0;
    return { fired, rejected, canceled, lossUsed, tradesUsed };
  }, [a.history, a.dailyLossStopUsd, a.pnlToday, a.maxTradesPerDay, a.tradesToday]);

  // ─── Recent operations ────────────────────────────────────────────────
  const recent = useMemo(() => entries.slice(0, 8), [entries]);

  // ─── ZION insights — derived locally from the stores (instant, free) ──
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];

    // Patrimônio trend (7d)
    if (pnl7d) {
      out.push(pnl7d.abs >= 0
        ? { Icon: TrendingUp, tone: "green", text: `Patrimônio em alta: ${pnl7d.pct >= 0 ? "+" : ""}${pnl7d.pct.toFixed(1)}% nos últimos 7 dias.` }
        : { Icon: TrendingDown, tone: "red", text: `Patrimônio recuou ${pnl7d.pct.toFixed(1)}% em 7 dias — momento de cautela.` });
    }

    // Best / worst op type by realized P&L
    const scored = byType.filter(([, r]) => r.pnl !== 0);
    if (scored.length > 0) {
      const best = scored.reduce((m, x) => (x[1].pnl > m[1].pnl ? x : m));
      if (best[1].pnl > 0) out.push({ Icon: Crown, tone: "gold", text: `Melhor desempenho: ${TX_TYPE_LABELS_PT[best[0]]} (+${formatUsd(best[1].pnl)} realizado).` });
      const worst = scored.reduce((m, x) => (x[1].pnl < m[1].pnl ? x : m));
      if (worst[1].pnl < 0) out.push({ Icon: AlertTriangle, tone: "red", text: `Atenção: ${TX_TYPE_LABELS_PT[worst[0]]} acumula ${formatUsd(worst[1].pnl)}.` });
    }

    // Most traded pair
    const pairCount = new Map<string, number>();
    for (const e of entries) {
      if (e.status !== "confirmed") continue;
      const k = `${e.fromSymbol}→${e.toSymbol}`;
      pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }
    if (pairCount.size > 0) {
      const [pair, n] = [...pairCount.entries()].sort((x, y) => y[1] - x[1])[0];
      if (n >= 2) out.push({ Icon: Activity, tone: "cyan", text: `Par mais operado: ${pair} (${n} vezes).` });
    }

    // Fees as % of volume
    if (stats.volume > 0 && stats.fees > 0) {
      const ratio = (stats.fees / stats.volume) * 100;
      out.push({ Icon: Receipt, tone: "violet", text: `Taxas consumiram ${ratio.toFixed(2)}% do volume operado (${formatUsd(stats.fees)}).` });
    }

    // Concentration of largest live asset
    if (live.anyWalletConnected && live.walletUsd > 0 && live.byAsset.length > 0) {
      const top = live.byAsset[0];
      const pct = (top.value / live.walletUsd) * 100;
      if (pct >= 40) out.push({ Icon: PieChart, tone: "gold", text: `Carteira concentrada: ${top.symbol} = ${pct.toFixed(0)}% do total — considere diversificar.` });
    }

    // Win rate
    if (stats.winRate !== null) {
      out.push(stats.winRate >= 55
        ? { Icon: Percent, tone: "green", text: `Win rate saudável de ${stats.winRate.toFixed(0)}% (${stats.wins}/${stats.scored}).` }
        : { Icon: Percent, tone: "gold", text: `Win rate de ${stats.winRate.toFixed(0)}% — revise os pontos de entrada/saída.` });
    }

    // Autopilot
    if (a.frozenUntilDay) {
      out.push({ Icon: Bot, tone: "red", text: "Autopilot congelado pelo stop de perda diário — reabre à meia-noite UTC." });
    } else if (a.enabled) {
      out.push({ Icon: Bot, tone: a.pnlToday >= 0 ? "green" : "red", text: `Autopilot ativo · P&L de hoje ${a.pnlToday >= 0 ? "+" : ""}${formatUsd(a.pnlToday)} em ${a.tradesToday} trade(s).` });
    }

    return out.slice(0, 6);
  }, [pnl7d, byType, entries, stats, live.anyWalletConnected, live.walletUsd, live.byAsset, a.frozenUntilDay, a.enabled, a.pnlToday, a.tradesToday]);

  const hasAnyData = snapshots.length > 0 || entries.length > 0 || a.history.length > 0 || live.walletUsd > 0;

  const DeltaPill = ({ d }: { d: { abs: number; pct: number } | null }) => {
    if (!d) return <span className="font-mono text-[10px] text-ink-4">—</span>;
    const Icon = d.abs > 0 ? TrendingUp : d.abs < 0 ? TrendingDown : Minus;
    const tone = d.abs > 0 ? "text-green" : d.abs < 0 ? "text-red" : "text-ink-3";
    return (
      <span className={cn("font-mono text-[10px] flex items-center gap-1", tone)}>
        <Icon className="w-3 h-3" />
        {mask(`${d.abs >= 0 ? "+" : ""}${(d.pct).toFixed(2)}%`)}
      </span>
    );
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-24 right-1/4 w-[420px] h-[420px] rounded-full bg-violet/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-7xl mx-auto">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <LayoutDashboard className="w-4 h-4 text-violet" />
            <span className="font-mono text-[10px] text-violet/80 tracking-widest uppercase">
              Painel de Controle
            </span>
          </div>
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.4rem)] leading-[0.98] tracking-tight text-ink mb-2">
                Sua <span className="text-grad-aurora">central</span> de operações
              </h1>
              <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
                Patrimônio, P&amp;L, alocação, atividade e autopilot — tudo num lugar só, em tempo real.
              </p>
            </div>
            <button onClick={() => setHidden((h) => !h)} className="btn btn-secondary py-2 text-xs">
              {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {hidden ? "Mostrar valores" : "Ocultar valores"}
            </button>
          </div>
        </motion.div>

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {!hasAnyData && (
          <div className="god-card rounded-2xl border border-white/5 glass-pane p-8 text-center mb-6">
            <LayoutDashboard className="w-8 h-8 text-violet/60 mx-auto mb-3" />
            <h2 className="font-display font-bold text-base text-ink mb-1">Ainda sem dados para exibir</h2>
            <p className="font-sans text-sm text-ink-2 max-w-md mx-auto mb-4 leading-relaxed">
              Conecte sua carteira e visite o portfólio para começar a registrar a evolução do patrimônio, ou faça
              sua primeira operação — o painel se preenche automaticamente.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Link href="/portfolio" className="btn btn-primary text-xs">
                <Wallet className="w-3 h-3" /> Abrir portfólio
              </Link>
              <Link href="/" className="btn btn-secondary text-xs">
                <TrendingUp className="w-3 h-3" /> Fazer um swap
              </Link>
            </div>
          </div>
        )}

        {/* ── Hero KPIs ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="col-span-2 lg:col-span-1 aurora-border p-px rounded-xl">
            <div className="god-card rounded-[11px] glass p-3.5 h-full">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Coins className="w-3 h-3 text-cyan" />
                <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">Patrimônio total</span>
              </div>
              <div className="font-display font-extrabold text-2xl sm:text-3xl text-ink tabular-nums truncate">
                {mask(formatUsd(totalUsd))}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="font-mono text-[10px] text-ink-3">24h</span>
                <DeltaPill d={pnl24h} />
              </div>
            </div>
          </div>

          <Kpi
            label="P&L 7 dias" Icon={LineChart}
            tone={(pnl7d?.abs ?? 0) >= 0 ? "green" : "red"}
            value={mask(pnl7d ? `${pnl7d.abs >= 0 ? "+" : ""}${formatUsd(pnl7d.abs)}` : "—")}
            sub={pnl7d ? { text: `${pnl7d.pct >= 0 ? "+" : ""}${pnl7d.pct.toFixed(2)}%`, tone: pnl7d.abs >= 0 ? "green" : "red" } : null}
          />
          <Kpi
            label="P&L 30 dias" Icon={LineChart}
            tone={(pnl30d?.abs ?? 0) >= 0 ? "green" : "red"}
            value={mask(pnl30d ? `${pnl30d.abs >= 0 ? "+" : ""}${formatUsd(pnl30d.abs)}` : "—")}
            sub={pnl30d ? { text: `${pnl30d.pct >= 0 ? "+" : ""}${pnl30d.pct.toFixed(2)}%`, tone: pnl30d.abs >= 0 ? "green" : "red" } : null}
          />
          <Kpi
            label="Win rate" Icon={Percent} tone="gold"
            value={stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"}
            sub={stats.scored > 0 ? { text: `${stats.wins}/${stats.scored} trades`, tone: "ink" } : { text: "sem P&L registrado", tone: "ink" }}
          />
        </div>

        {/* ── Secondary KPIs ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Kpi label="Volume operado" Icon={Activity} tone="cyan" value={mask(formatUsd(stats.volume, { compact: true }))} sub={{ text: `${stats.confirmed} confirmadas`, tone: "ink" }} />
          <Kpi label="Taxas pagas" Icon={Receipt} tone="violet" value={mask(formatUsd(stats.fees, { compact: true }))} sub={stats.pending > 0 ? { text: `${stats.pending} pendentes`, tone: "gold" } : null} />
          <Kpi label="P&L realizado" Icon={TrendingUp} tone={stats.realized >= 0 ? "green" : "red"} value={mask(`${stats.realized >= 0 ? "+" : ""}${formatUsd(stats.realized)}`)} sub={{ text: `${stats.scored} com P&L`, tone: "ink" }} />
          <Kpi
            label="Autopilot" Icon={Bot}
            tone={a.frozenUntilDay ? "red" : a.enabled ? "green" : "ink"}
            value={a.frozenUntilDay ? "Congelado" : a.enabled ? "Ativo" : "Parado"}
            sub={{ text: `${a.tradesToday}/${a.maxTradesPerDay} trades hoje`, tone: "ink" }}
          />
        </div>

        {/* ── ZION insights ────────────────────────────────────────────── */}
        <div className="aurora-border p-px rounded-2xl mb-4">
          <div className="god-card rounded-[15px] glass overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 flex-wrap">
              <span className="font-display font-bold text-sm text-ink flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-gold" />
                ZION · Insights do dia
              </span>
              <div className="flex items-center gap-2">
                {insights.length > 0 && (
                  <button
                    type="button"
                    disabled={zionStreaming}
                    onClick={async () => {
                      setZionNarrative("");
                      setZionStreaming(true);
                      try {
                        const ctx = [
                          `Patrimônio total: ${formatUsd(totalUsd)}`,
                          `CEX: ${formatUsd(cexUsd)} | Carteira: ${formatUsd(walletUsd)}`,
                          `P&L 7d: ${pnl7d ? `${pnl7d.abs >= 0 ? "+" : ""}${formatUsd(pnl7d.abs)} (${pnl7d.pct.toFixed(1)}%)` : "n/a"}`,
                          `Win rate: ${stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "n/a"} | Volume: ${formatUsd(stats.volume)}`,
                          `Insights identificados:`,
                          ...insights.map((ins) => `- ${ins.text}`),
                        ].join("\n");
                        const params = new URLSearchParams({
                          op:      "trading",
                          message: `Sou um investidor cripto. Analise meu portfólio e gere um resumo estratégico em 3-4 parágrafos em português, fluido e direto ao ponto.\n\n${ctx}`,
                        });
                        const res = await fetch(`/api/zion?${params}`);
                        if (!res.body) return;
                        const reader = res.body.getReader();
                        const dec = new TextDecoder();
                        let buf = "";
                        while (true) {
                          const { done, value } = await reader.read();
                          if (done) break;
                          buf += dec.decode(value, { stream: true });
                          // strip action cards, keep only narrative text
                          const clean = buf.replace(/```[\s\S]*?```/g, "").replace(/\[ACTION_CARD[\s\S]*?\]/g, "").trim();
                          setZionNarrative(clean);
                        }
                      } catch { /* ignore */ }
                      finally { setZionStreaming(false); }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet/15 border border-violet/25 font-mono text-[10px] text-violet tracking-widest uppercase hover:bg-violet/25 disabled:opacity-50 transition-colors"
                  >
                    {zionStreaming
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> gerando…</>
                      : <><Zap className="w-3 h-3" /> gerar análise</>}
                  </button>
                )}
                <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gold pulse-dot" />
                  dos seus dados
                </span>
              </div>
            </div>
            <div className="p-4">
              {insights.length === 0 ? (
                <p className="font-sans text-xs text-ink-3 leading-relaxed py-2">
                  Conecte a carteira e faça algumas operações — o ZION passa a destacar tendências, melhores
                  desempenhos, concentração de risco e o status do autopilot automaticamente aqui.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {insights.map((ins, i) => {
                      const tone = {
                        cyan: "text-cyan", violet: "text-violet", gold: "text-gold", green: "text-green", red: "text-red",
                      }[ins.tone];
                      const bg = {
                        cyan: "bg-cyan/[0.06] border-cyan/15", violet: "bg-violet/[0.06] border-violet/15",
                        gold: "bg-gold/[0.06] border-gold/15", green: "bg-green/[0.06] border-green/15",
                        red: "bg-red/[0.06] border-red/15",
                      }[ins.tone];
                      return (
                        <div key={i} className={cn("flex items-start gap-2.5 rounded-xl border p-2.5 min-w-0", bg)}>
                          <ins.Icon className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", tone)} />
                          <p className="font-sans text-[12px] text-ink-2 leading-snug">{hidden ? "•••••••••••••••" : ins.text}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* ZION narrative — appears after "Gerar análise" is clicked */}
                  {(zionNarrative || zionStreaming) && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-3 rounded-xl border border-violet/20 bg-violet/[0.04] p-3.5"
                    >
                      <div className="flex items-center gap-1.5 mb-2">
                        <Sparkles className="w-3 h-3 text-violet" />
                        <span className="font-mono text-[9px] text-violet/70 tracking-widest uppercase">análise ZION</span>
                        {zionStreaming && <Loader2 className="w-3 h-3 text-violet animate-spin ml-auto" />}
                      </div>
                      <p className="font-sans text-[12px] text-ink-2 leading-relaxed whitespace-pre-wrap">
                        {hidden ? "•••••••••••••••••••••" : zionNarrative}
                        {zionStreaming && <span className="inline-block w-1.5 h-3.5 bg-violet/60 animate-pulse ml-0.5 align-text-bottom" />}
                      </p>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Equity curve ─────────────────────────────────────────────── */}
        <Panel
          title="Evolução do patrimônio"
          icon={<LineChart className="w-3.5 h-3.5 text-cyan" />}
          className="mb-4"
          right={
            <div className="flex gap-1">
              {(["24h", "7d", "30d", "all"] as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "px-2 py-0.5 rounded-md font-mono text-[10px] uppercase tracking-wider border transition-all",
                    range === r ? "bg-white/[0.08] border-white/20 text-ink" : "border-white/5 bg-white/[0.02] text-ink-3 hover:text-ink-2",
                  )}
                >
                  {r === "all" ? "Tudo" : r}
                </button>
              ))}
            </div>
          }
        >
          {series.length < 2 ? (
            <p className="py-8 text-center font-sans text-xs text-ink-3 max-w-sm mx-auto leading-relaxed">
              Poucos snapshots de saldo ainda. Mantenha a carteira conectada — o painel registra a evolução automaticamente ao longo do tempo.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-3">
                <span className={cn("font-display font-extrabold text-2xl flex items-center gap-1.5", (rangeDelta?.abs ?? 0) >= 0 ? "text-green" : "text-red")}>
                  {(rangeDelta?.abs ?? 0) >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  {mask(`${(rangeDelta?.abs ?? 0) >= 0 ? "+" : ""}${formatUsd(rangeDelta?.abs ?? 0)}`)}
                </span>
                <span className={cn("font-mono text-sm", (rangeDelta?.abs ?? 0) >= 0 ? "text-green" : "text-red")}>
                  {mask(`${(rangeDelta?.pct ?? 0) >= 0 ? "+" : ""}${(rangeDelta?.pct ?? 0).toFixed(2)}%`)}
                </span>
                <span className="font-mono text-[10px] text-ink-4 uppercase tracking-widest ml-auto">
                  {range === "all" ? "tudo" : range}
                </span>
              </div>
              <AreaChart points={series} positive={(rangeDelta?.abs ?? 0) >= 0} height={170} />
            </>
          )}
        </Panel>

        {/* ── Allocation + Autopilot row ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Allocation */}
          <Panel
            title="Alocação"
            icon={<PieChart className="w-3.5 h-3.5 text-violet" />}
            right={
              <div className="flex gap-1">
                {([["chains", "Chains"], ["assets", "Ativos"], ["all", "Todos"], ["venues", "Carteira/CEX"]] as [AllocMode, string][]).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAllocMode(m)}
                    className={cn(
                      "px-2 py-0.5 rounded-md font-mono text-[10px] uppercase tracking-wider border transition-all",
                      allocMode === m ? "bg-white/[0.08] border-white/20 text-ink" : "border-white/5 bg-white/[0.02] text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {allocation.length === 0 ? (
              <p className="py-6 text-center font-sans text-xs text-ink-3 leading-relaxed max-w-xs mx-auto">
                {allocMode === "venues"
                  ? "Sem saldo registrado para alocar."
                  : live.anyWalletConnected
                    ? (live.loading ? "Carregando saldos da carteira…" : "Nenhum saldo encontrado nos tokens monitorados.")
                    : "Conecte a carteira para ver a alocação por chain e por ativo."}
              </p>
            ) : (
              <div className="flex items-center gap-5 flex-wrap">
                <Donut segments={allocation} centerValue={mask(formatUsd(allocTotal, { compact: true }))} centerLabel={allocMode === "venues" ? "total" : allocMode === "chains" ? "chains" : "ativos"} />
                <div className="flex-1 min-w-[150px] space-y-2 max-h-44 overflow-y-auto">
                  {allocation.map((s) => (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                      <span className="font-mono text-[11px] text-ink-2 flex-1 truncate">{s.label}</span>
                      <span className="font-mono text-[11px] text-ink tabular-nums">{mask(formatUsd(s.value, { compact: true }))}</span>
                      <span className="font-mono text-[10px] text-ink-4 w-10 text-right">
                        {allocTotal > 0 ? ((s.value / allocTotal) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          {/* Autopilot */}
          <Panel
            title="ZION Autopilot"
            icon={<Bot className="w-3.5 h-3.5 text-violet" />}
            right={
              <span className={cn(
                "font-mono text-[10px] tracking-widest uppercase flex items-center gap-1",
                a.frozenUntilDay ? "text-red" : a.enabled ? "text-green" : "text-ink-4",
              )}>
                {a.frozenUntilDay ? <><AlertTriangle className="w-3 h-3" /> congelado</>
                  : a.enabled ? <><CheckCircle2 className="w-3 h-3" /> ativo</>
                  : <><Power className="w-3 h-3" /> parado</>}
              </span>
            }
          >
            <div className="grid grid-cols-3 gap-3 mb-4 text-center">
              <div>
                <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">P&L hoje</div>
                <div className={cn("font-display font-bold text-lg tabular-nums", a.pnlToday > 0 ? "text-green" : a.pnlToday < 0 ? "text-red" : "text-ink")}>
                  {mask(`${a.pnlToday >= 0 ? "+" : ""}${formatUsd(a.pnlToday)}`)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Disparadas</div>
                <div className="font-display font-bold text-lg text-ink tabular-nums">{apStats.fired}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Rejeitadas</div>
                <div className="font-display font-bold text-lg text-ink-3 tabular-nums">{apStats.rejected}</div>
              </div>
            </div>
            <div className="space-y-3">
              <Gauge label="Trades hoje" tone="cyan" pct={apStats.tradesUsed} value={`${a.tradesToday}/${a.maxTradesPerDay}`} />
              <Gauge label="Stop de perda diário" tone="red" pct={apStats.lossUsed} value={`${formatUsd(Math.max(0, -a.pnlToday))} / ${formatUsd(a.dailyLossStopUsd)}`} />
            </div>
            <Link href="/cex" className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline mt-3">
              <Banknote className="w-2.5 h-2.5" /> Abrir terminal CEX
            </Link>
          </Panel>
        </div>

        {/* ── P&L by type + Activity row ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* P&L / volume by type */}
          <Panel title="Performance por tipo" icon={<Layers className="w-3.5 h-3.5 text-gold" />}>
            {byType.length === 0 ? (
              <p className="py-6 text-center font-sans text-xs text-ink-3">Nenhuma operação confirmada ainda.</p>
            ) : (
              <div className="space-y-2.5">
                {byType.map(([type, row]) => {
                  const maxVol = Math.max(...byType.map(([, r]) => r.volume), 1);
                  return (
                    <div key={type} className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: TYPE_COLOR[type] }} />
                        <span className="font-mono text-[11px] text-ink-2 flex-1 truncate">{TX_TYPE_LABELS_PT[type]}</span>
                        <span className="font-mono text-[10px] text-ink-4">{row.count} ops</span>
                        <span className={cn("font-mono text-[11px] w-20 text-right tabular-nums", row.pnl > 0 ? "text-green" : row.pnl < 0 ? "text-red" : "text-ink-3")}>
                          {row.pnl !== 0 ? mask(`${row.pnl >= 0 ? "+" : ""}${formatUsd(row.pnl)}`) : "—"}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.03] overflow-hidden ml-4">
                        <div className="h-full rounded-full" style={{ width: `${(row.volume / maxVol) * 100}%`, background: TYPE_COLOR[type] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Activity */}
          <Panel
            title="Atividade · 14 dias"
            icon={<Activity className="w-3.5 h-3.5 text-cyan" />}
            right={<span className="font-mono text-[10px] text-ink-4 tracking-widest uppercase">volume/dia</span>}
          >
            {activity.every((d) => d.value === 0) ? (
              <p className="py-6 text-center font-sans text-xs text-ink-3">Sem atividade nos últimos 14 dias.</p>
            ) : (
              <>
                <Bars data={activity} height={140} color="#00E8FF" />
                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-ink-3">Total no período</span>
                  <span className="font-mono text-[11px] text-ink tabular-nums">
                    {mask(formatUsd(activity.reduce((s, d) => s + d.value, 0), { compact: true }))}
                  </span>
                </div>
              </>
            )}
          </Panel>
        </div>

        {/* ── Recent operations ────────────────────────────────────────── */}
        <Panel
          title="Operações recentes"
          icon={<Receipt className="w-3.5 h-3.5 text-violet" />}
          right={
            <Link href="/history" className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline">
              Ver tudo <ArrowUpRight className="w-2.5 h-2.5" />
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-6 text-center font-sans text-xs text-ink-3">Nenhuma operação registrada ainda.</p>
          ) : (
            <div className="divide-y divide-white/[0.04] -mx-4">
              {recent.map((e) => (
                <div key={e.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02]">
                  <span
                    className="font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-wider uppercase flex-shrink-0"
                    style={{ color: TYPE_COLOR[e.type], borderColor: `${TYPE_COLOR[e.type]}55`, background: `${TYPE_COLOR[e.type]}11` }}
                  >
                    {TX_TYPE_LABELS_PT[e.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[12px] text-ink truncate">
                      {e.fromSymbol} <span className="text-ink-4">→</span> {e.toSymbol}
                    </div>
                    <div className="font-mono text-[9px] text-ink-4 truncate">
                      {new Date(e.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {e.valueUsd !== undefined && (
                      <div className="font-mono text-[12px] text-ink tabular-nums">{mask(formatUsd(e.valueUsd))}</div>
                    )}
                    <div className={cn("font-mono text-[9px] tracking-wider uppercase", STATUS_TEXT[e.status])}>
                      {STATUS_LABELS_PT[e.status]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-6">
          Todos os dados são locais (neste navegador). Nada sai do seu dispositivo.
        </p>
      </div>
    </div>
  );
}
