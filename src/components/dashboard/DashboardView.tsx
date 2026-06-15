"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Wallet, TrendingUp, TrendingDown, Minus, Eye, EyeOff,
  LineChart, PieChart, Layers, Activity, Bot, Receipt, Coins, Percent,
  ArrowUpRight, Banknote, AlertTriangle, CheckCircle2, Power,
} from "lucide-react";
import { usePortfolioHistory, type PortfolioSnapshot } from "@/lib/store/portfolioHistory";
import {
  useTxHistory, TX_TYPE_LABELS_PT, STATUS_LABELS_PT,
  type TxType, type TxStatus,
} from "@/lib/store/txHistory";
import { useAutopilot } from "@/lib/store/autopilot";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Panel, Kpi, AreaChart, Donut, Bars, Gauge } from "./widgets";

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

  const [hidden, setHidden] = useState(false);
  const [range,  setRange]  = useState<Range>("7d");

  const mask = (v: string) => (hidden ? "•••••" : v);

  // ─── Current totals from the latest snapshot ──────────────────────────
  const latest = snapshots[snapshots.length - 1] ?? null;
  const totalUsd  = latest?.totalUsd  ?? 0;
  const walletUsd = latest?.walletUsd ?? 0;
  const cexUsd    = latest?.cexUsd    ?? 0;

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

  // ─── Allocation: wallet vs CEX ────────────────────────────────────────
  const allocation = useMemo(() => {
    const segs = [
      { label: "Carteira", value: walletUsd, color: "#00E8FF" },
      { label: "CEX",      value: cexUsd,    color: "#A78BFA" },
    ].filter((s) => s.value > 0);
    return segs;
  }, [walletUsd, cexUsd]);

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

  const hasAnyData = snapshots.length > 0 || entries.length > 0 || a.history.length > 0;

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
          <Panel title="Alocação" icon={<PieChart className="w-3.5 h-3.5 text-violet" />}>
            {allocation.length === 0 ? (
              <p className="py-6 text-center font-sans text-xs text-ink-3">Sem saldo registrado para alocar.</p>
            ) : (
              <div className="flex items-center gap-5 flex-wrap">
                <div className="relative">
                  <Donut segments={allocation} centerValue={mask(formatUsd(totalUsd, { compact: true }))} centerLabel="total" />
                </div>
                <div className="flex-1 min-w-[140px] space-y-2.5">
                  {allocation.map((s) => (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                      <span className="font-mono text-[11px] text-ink-2 flex-1">{s.label}</span>
                      <span className="font-mono text-[11px] text-ink tabular-nums">{mask(formatUsd(s.value, { compact: true }))}</span>
                      <span className="font-mono text-[10px] text-ink-4 w-12 text-right">
                        {totalUsd > 0 ? ((s.value / totalUsd) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                  ))}
                  <Link href="/portfolio" className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline pt-1">
                    Ver detalhamento por ativo <ArrowUpRight className="w-2.5 h-2.5" />
                  </Link>
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
