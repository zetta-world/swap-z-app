"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History, Trash2, ExternalLink, ChevronDown, ChevronUp,
  ArrowRight, TrendingUp, TrendingDown, Minus, Search,
  SlidersHorizontal, Download, X,
} from "lucide-react";
import {
  useTxHistory, TX_TYPE_LABELS_PT, STATUS_LABELS_PT,
  type TxType, type TxStatus, type TxHistoryEntry,
} from "@/lib/store/txHistory";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useT, type MessageKey } from "@/lib/i18n";
import { useUI } from "@/lib/store/ui";
import { useConfirm } from "@/components/ui/ConfirmModal";
import HistoryExportModal from "./HistoryExportModal";

const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  pt: "pt-BR",
  es: "es-ES",
  zh: "zh-CN",
};

const TYPE_COLORS: Record<TxType, string> = {
  dex_swap:       "text-cyan   border-cyan/30   bg-cyan/5",
  dex_bridge:     "text-violet border-violet/30 bg-violet/5",
  cex_spot:       "text-gold   border-gold/30   bg-gold/5",
  cex_futures:    "text-red    border-red/30    bg-red/5",
  autopilot_dex:  "text-green  border-green/30  bg-green/5",
  autopilot_cex:  "text-green  border-green/30  bg-green/5",
  autopilot_arb:  "text-green  border-green/30  bg-green/5",
  rebalance:      "text-ink-2  border-white/20  bg-white/5",
  deposit:        "text-ink-3  border-white/15  bg-white/3",
  withdraw:       "text-ink-3  border-white/15  bg-white/3",
};

const STATUS_COLORS: Record<TxStatus, string> = {
  pending:   "text-gold",
  confirmed: "text-green",
  failed:    "text-red",
  canceled:  "text-ink-3",
};

// Types grouped by venue — far more scannable than one flat row of pills.
const TYPE_GROUPS: { label: string; types: TxType[] }[] = [
  { label: "DEX",           types: ["dex_swap", "dex_bridge"] },
  { label: "CEX",           types: ["cex_spot", "cex_futures"] },
  { label: "Autopilot",     types: ["autopilot_dex", "autopilot_cex", "autopilot_arb", "rebalance"] },
  { label: "Transferência", types: ["deposit", "withdraw"] },
];

const STATUSES: TxStatus[] = ["confirmed", "pending", "failed", "canceled"];

const PAGE = 25;

export default function HistoryView() {
  const t = useT();
  const { confirm, modal: confirmModal } = useConfirm();
  const lang = useUI((s) => s.lang);
  const locale = LOCALE_MAP[lang] ?? "en-US";
  const { entries, clear } = useTxHistory();

  const [typeFilter,   setTypeFilter]   = useState<TxType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<TxStatus | "all">("all");
  const [query,        setQuery]        = useState("");
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [showFilters,  setShowFilters]  = useState(false);
  const [showExport,   setShowExport]   = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter   !== "all" && e.type   !== typeFilter)   return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (q && !`${e.fromSymbol} ${e.toSymbol} ${e.fromChain} ${e.toChain} ${e.notes ?? ""} ${e.txHash ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, typeFilter, statusFilter, query]);

  // Reset pagination whenever the result set changes.
  useEffect(() => { setVisibleCount(PAGE); }, [typeFilter, statusFilter, query]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Group the visible slice by day, preserving newest-first order.
  const groups = useMemo(() => {
    const out: { label: string; items: TxHistoryEntry[] }[] = [];
    for (const e of visible) {
      const label = dateGroupLabel(e.ts, locale, t);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [visible, locale, t]);

  const summary = useMemo(() => {
    const trades    = entries.filter((e) => e.type !== "deposit" && e.type !== "withdraw");
    const confirmed = trades.filter((e) => e.status === "confirmed");
    const pending   = entries.filter((e) => e.status === "pending").length;
    const totalVol  = confirmed.reduce((s, e) => s + (e.valueUsd ?? 0), 0);
    const totalFees = confirmed.reduce((s, e) => s + (e.feesUsd ?? 0), 0);
    const totalPnl  = confirmed.filter((e) => e.pnlUsd !== undefined).reduce((s, e) => s + (e.pnlUsd ?? 0), 0);
    return { count: entries.length, confirmed: confirmed.length, pending, totalVol, totalFees, totalPnl };
  }, [entries]);

  const activeFilterCount = (typeFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);
  const remaining = filtered.length - visible.length;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-5xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              {t("history.eyebrow")}
            </span>
          </div>
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3rem)] leading-[0.98] tracking-tight text-ink mb-2">
                {t("history.titlePrefix")} <span className="text-grad-aurora">{t("history.titleHighlight")}</span>
              </h1>
              <p className="font-sans text-sm text-ink-2 max-w-xl">
                {t("history.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {entries.length > 0 && (
                <button
                  onClick={() => setShowExport(true)}
                  className="btn btn-secondary py-2 text-xs gap-1.5 border-cyan/20 text-cyan/90 hover:border-cyan/40 hover:text-cyan"
                >
                  <Download className="w-3.5 h-3.5" />
                  {t("history.export")}
                </button>
              )}
              {entries.length > 0 && (
                <button
                  onClick={() => { void confirm(t("history.clearConfirm")).then((ok) => { if (ok) clear(); }); }}
                  className="btn btn-secondary py-2 text-xs gap-1.5 text-red/70 hover:text-red border-red/20 hover:border-red/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t("history.clear")}</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <SummaryCard
            label={t("history.summaryOperations")}
            value={String(summary.count)}
            sub={summary.pending > 0
              ? (summary.pending > 1 ? t("history.pendingPlural", { count: summary.pending }) : t("history.pendingSingular", { count: summary.pending }))
              : (summary.confirmed !== 1 ? t("history.confirmedPlural", { count: summary.confirmed }) : t("history.confirmedSingular", { count: summary.confirmed }))}
            tone="ink"
          />
          <SummaryCard label={t("history.summaryVolume")} value={formatUsd(summary.totalVol)} tone="cyan" />
          <SummaryCard label={t("history.summaryFees")} value={formatUsd(summary.totalFees)} tone="gold" />
          <SummaryCard
            label={t("history.summaryPnl")}
            value={summary.totalPnl === 0 ? "–" : (summary.totalPnl > 0 ? "+" : "") + formatUsd(summary.totalPnl)}
            tone={summary.totalPnl > 0 ? "green" : summary.totalPnl < 0 ? "red" : "ink"}
          />
        </div>

        {/* Toolbar: search + filters trigger */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 focus-within:border-cyan/30 flex-1 transition-colors">
            <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("history.searchPlaceholder")}
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none font-sans min-w-0"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label={t("common.clear")} className="text-ink-4 hover:text-ink transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-mono uppercase tracking-wider transition-all flex-shrink-0",
              showFilters || activeFilterCount > 0
                ? "bg-cyan/[0.08] border-cyan/30 text-cyan"
                : "bg-white/[0.03] border-white/5 text-ink-3 hover:text-ink-2 hover:border-white/10",
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("history.filters")}</span>
            {activeFilterCount > 0 && (
              <span className="ml-0.5 w-4 h-4 rounded-full bg-cyan text-bg text-[9px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {typeFilter !== "all" && (
              <ActiveChip label={TX_TYPE_LABELS_PT[typeFilter]} onRemove={() => setTypeFilter("all")} />
            )}
            {statusFilter !== "all" && (
              <ActiveChip label={STATUS_LABELS_PT[statusFilter]} onRemove={() => setStatusFilter("all")} />
            )}
            <button
              onClick={() => { setTypeFilter("all"); setStatusFilter("all"); }}
              className="font-mono text-[9px] text-ink-4 hover:text-ink-2 tracking-wider uppercase ml-1 transition-colors"
            >
              {t("history.clearFilters")}
            </button>
          </div>
        )}

        {/* Filter panel (collapsible) */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="god-card rounded-2xl border border-white/5 glass-pane p-4 mb-4 space-y-4">
                {/* Type */}
                <div>
                  <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-2">{t("history.filterTypeLabel")}</span>
                  <div className="space-y-2">
                    <FilterPill active={typeFilter === "all"} onClick={() => setTypeFilter("all")} label={t("history.filterTypeAll")} />
                    {TYPE_GROUPS.map((g) => (
                      <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[8px] text-ink-5 tracking-widest uppercase w-14 flex-shrink-0">{g.label}</span>
                        {g.types.map((t) => (
                          <FilterPill
                            key={t}
                            active={typeFilter === t}
                            onClick={() => setTypeFilter(t)}
                            label={TX_TYPE_LABELS_PT[t]}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-2">{t("history.filterStatusLabel")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label={t("history.filterStatusAll")} />
                    {STATUSES.map((s) => (
                      <FilterPill
                        key={s}
                        active={statusFilter === s}
                        onClick={() => setStatusFilter(s)}
                        label={STATUS_LABELS_PT[s]}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transaction list */}
        <div className="god-card rounded-2xl border border-white/5 glass-pane overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <span className="font-display font-bold text-sm text-ink">{t("history.transactionsTitle")}</span>
            <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
              {t("history.countOf", { filtered: filtered.length, total: entries.length })}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <History className="w-8 h-8 text-ink-4 mx-auto mb-3" />
              <p className="font-sans text-sm text-ink-3">
                {entries.length === 0
                  ? t("history.emptyNoTxs")
                  : t("history.emptyFiltered")}
              </p>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.label}>
                  {/* Date section header */}
                  <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.04] flex items-center justify-between sticky top-0 z-[1] backdrop-blur-sm">
                    <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{g.label}</span>
                    <span className="font-mono text-[9px] text-ink-5">{g.items.length}</span>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    <AnimatePresence initial={false}>
                      {g.items.map((entry) => (
                        <TxRow
                          key={entry.id}
                          entry={entry}
                          expanded={expanded === entry.id}
                          onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}

              {/* Load more */}
              {remaining > 0 && (
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE)}
                  className="w-full px-4 py-3.5 border-t border-white/5 font-mono text-[11px] text-ink-3 hover:text-cyan hover:bg-white/[0.02] transition-colors flex items-center justify-center gap-2"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  {t("history.loadMore")} ({t(remaining !== 1 ? "history.remainingPlural" : "history.remainingSingular", { count: remaining })})
                </button>
              )}
            </>
          )}
        </div>

        <p className="font-mono text-[9px] text-ink-4 text-center mt-5">
          {t("history.footer")}
        </p>
      </div>

      <HistoryExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        filtered={filtered}
        all={entries}
      />
      {confirmModal}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function TxRow({
  entry, expanded, onToggle,
}: {
  entry: TxHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const lang = useUI((s) => s.lang);
  const locale = LOCALE_MAP[lang] ?? "en-US";
  const date = new Date(entry.ts);
  const timeStr = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  const isFlow = entry.type === "deposit" || entry.type === "withdraw";
  const pnl = isFlow ? undefined : entry.pnlUsd;
  const pnlPct = pnl !== undefined && entry.valueUsd && entry.valueUsd > 0
    ? (pnl / entry.valueUsd) * 100
    : null;
  const PnlIcon = pnl === undefined ? Minus : pnl > 0 ? TrendingUp : pnl < 0 ? TrendingDown : Minus;
  const pnlColor = pnl === undefined ? "text-ink-4" : pnl > 0 ? "text-green" : pnl < 0 ? "text-red" : "text-ink-4";

  const isCross = entry.fromChain !== entry.toChain;
  const explorerUrl = buildExplorerUrl(entry);

  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        {/* Type badge */}
        <span className={cn(
          "flex-shrink-0 font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase whitespace-nowrap",
          TYPE_COLORS[entry.type],
        )}>
          {TX_TYPE_LABELS_PT[entry.type]}
        </span>

        {/* Pair */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <span className="font-display font-bold text-sm text-ink truncate">{entry.fromSymbol}</span>
          <span className="font-mono text-[9px] text-ink-4 flex-shrink-0 hidden sm:inline">{entry.fromChain}</span>
          <ArrowRight className={cn("w-3 h-3 flex-shrink-0", isCross ? "text-violet" : "text-ink-4")} />
          <span className="font-display font-bold text-sm text-ink truncate">{entry.toSymbol}</span>
          <span className="font-mono text-[9px] text-ink-4 flex-shrink-0 hidden sm:inline">{entry.toChain}</span>
        </div>

        {/* Value / P&L */}
        <div className="text-right flex-shrink-0 space-y-0.5">
          {entry.valueUsd !== undefined && (
            <div className="font-mono text-sm text-ink">{formatUsd(entry.valueUsd)}</div>
          )}
          {isFlow ? (
            <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
              {entry.type === "deposit" ? "entrada" : "saída"}
            </div>
          ) : pnl !== undefined ? (
            <div className={cn("font-mono text-xs flex items-center gap-0.5 justify-end", pnlColor)}>
              <PnlIcon className="w-2.5 h-2.5" />
              {pnl > 0 ? "+" : ""}{formatUsd(pnl)}
              {pnlPct !== null && (
                <span className="ml-1 text-[9px] opacity-70">
                  ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Status */}
        <span className={cn("flex-shrink-0 font-mono text-[10px] hidden sm:inline", STATUS_COLORS[entry.status])}>
          {STATUS_LABELS_PT[entry.status]}
        </span>

        {/* Time */}
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[10px] text-ink-3">{timeStr}</div>
          <div className={cn("font-mono text-[9px] sm:hidden", STATUS_COLORS[entry.status])}>
            {STATUS_LABELS_PT[entry.status]}
          </div>
        </div>

        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-ink-4 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-ink-4 flex-shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-2 bg-white/[0.01]">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 font-mono text-[11px]">
                {entry.fromAmount && (
                  <Detail label={t("history.detailSent")} value={`${entry.fromAmount} ${entry.fromSymbol}`} />
                )}
                {entry.toAmount && (
                  <Detail label={t("history.detailReceived")} value={`${entry.toAmount} ${entry.toSymbol}`} />
                )}
                {entry.feesUsd !== undefined && (
                  <Detail label={t("history.detailFees")} value={formatUsd(entry.feesUsd)} />
                )}
                {entry.route && (
                  <Detail label={t("history.detailRoute")} value={entry.route} />
                )}
                {entry.exchange && (
                  <Detail label={t("history.detailExchange")} value={entry.exchange} />
                )}
                {entry.orderId && (
                  <Detail label={t("history.detailOrderId")} value={entry.orderId.slice(0, 12) + "…"} mono />
                )}
                {entry.leverage && (
                  <Detail label={t("history.detailLeverage")} value={`${entry.leverage}x`} />
                )}
                {entry.liqPrice && (
                  <Detail label={t("history.detailLiqPrice")} value={entry.liqPrice} />
                )}
              </div>

              {entry.notes && (
                <p className="font-sans text-[11px] text-ink-3 border-l-2 border-white/10 pl-2 italic">
                  {entry.notes}
                </p>
              )}

              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {t("history.viewExplorer")}
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-ink-4 tracking-wider uppercase text-[9px]">{label}</div>
      <div className={cn("text-ink truncate", mono ? "font-mono" : "font-sans text-[11px]")}>{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  const colors: Record<string, string> = {
    cyan: "text-cyan", green: "text-green", red: "text-red",
    gold: "text-gold", ink: "text-ink",
  };
  return (
    <div className="god-card rounded-xl border border-white/5 glass-pane p-3">
      <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-1">{label}</div>
      <div className={cn("font-display font-bold text-lg leading-none", colors[tone] ?? "text-ink")}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-ink-4 mt-0.5">{sub}</div>}
    </div>
  );
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-all whitespace-nowrap",
        active
          ? "bg-cyan/[0.1] border-cyan/40 text-cyan"
          : "border-white/5 bg-white/[0.02] text-ink-3 hover:text-ink-2 hover:border-white/10",
      )}
    >
      {label}
    </button>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-cyan/[0.08] border border-cyan/30 text-cyan font-mono text-[10px] uppercase tracking-wider">
      {label}
      <button onClick={onRemove} aria-label={t("common.clear")} className="hover:text-ink transition-colors">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function buildExplorerUrl(entry: TxHistoryEntry): string | null {
  if (!entry.txHash) return null;
  const explorers: Record<string, string> = {
    ethereum:  "https://etherscan.io/tx/",
    bsc:       "https://bscscan.com/tx/",
    polygon:   "https://polygonscan.com/tx/",
    base:      "https://basescan.org/tx/",
    arbitrum:  "https://arbiscan.io/tx/",
    optimism:  "https://optimistic.etherscan.io/tx/",
    avalanche: "https://snowtrace.io/tx/",
    solana:    "https://solscan.io/tx/",
  };
  const base = explorers[entry.fromChain];
  return base ? `${base}${entry.txHash}` : null;
}

// Group label: Today / Yesterday / weekday (within a week) / full date.
function dateGroupLabel(ts: number, locale: string, t: (key: MessageKey) => string): string {
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(new Date());
  const day   = startOfDay(d);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays === 0) return t("history.today");
  if (diffDays === 1) return t("history.yesterday");
  if (diffDays > 1 && diffDays < 7) {
    const wd = d.toLocaleDateString(locale, { weekday: "long" });
    return wd.charAt(0).toUpperCase() + wd.slice(1);
  }
  return d.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" });
}
