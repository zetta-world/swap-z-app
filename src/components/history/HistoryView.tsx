"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History, Filter, Trash2, ExternalLink, ChevronDown, ChevronUp,
  ArrowRight, TrendingUp, TrendingDown, Minus, Search,
} from "lucide-react";
import {
  useTxHistory, TX_TYPE_LABELS_PT, STATUS_LABELS_PT,
  type TxType, type TxStatus, type TxHistoryEntry,
} from "@/lib/store/txHistory";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/cn";

const TYPE_COLORS: Record<TxType, string> = {
  dex_swap:       "text-cyan   border-cyan/30   bg-cyan/5",
  dex_bridge:     "text-violet border-violet/30 bg-violet/5",
  cex_spot:       "text-gold   border-gold/30   bg-gold/5",
  cex_futures:    "text-red    border-red/30    bg-red/5",
  autopilot_dex:  "text-green  border-green/30  bg-green/5",
  autopilot_cex:  "text-green  border-green/30  bg-green/5",
  autopilot_arb:  "text-green  border-green/30  bg-green/5",
  rebalance:      "text-ink-2  border-white/20  bg-white/5",
};

const STATUS_COLORS: Record<TxStatus, string> = {
  pending:   "text-gold",
  confirmed: "text-green",
  failed:    "text-red",
  canceled:  "text-ink-3",
};

const ALL_TYPES: TxType[] = [
  "dex_swap", "dex_bridge", "cex_spot", "cex_futures",
  "autopilot_dex", "autopilot_cex", "autopilot_arb", "rebalance",
];

export default function HistoryView() {
  const { entries, clear } = useTxHistory();

  const [typeFilter,   setTypeFilter]   = useState<TxType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<TxStatus | "all">("all");
  const [query,        setQuery]        = useState("");
  const [expanded,     setExpanded]     = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter   !== "all" && e.type   !== typeFilter)   return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (q && !`${e.fromSymbol} ${e.toSymbol} ${e.fromChain} ${e.toChain} ${e.notes ?? ""} ${e.txHash ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, typeFilter, statusFilter, query]);

  // P&L summary
  const summary = useMemo(() => {
    const confirmed = entries.filter((e) => e.status === "confirmed");
    const totalVol = confirmed.reduce((s, e) => s + (e.valueUsd ?? 0), 0);
    const totalFees = confirmed.reduce((s, e) => s + (e.feesUsd ?? 0), 0);
    const totalPnl  = confirmed.filter((e) => e.pnlUsd !== undefined).reduce((s, e) => s + (e.pnlUsd ?? 0), 0);
    return { count: confirmed.length, totalVol, totalFees, totalPnl };
  }, [entries]);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              Histórico de Operações
            </span>
          </div>
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3rem)] leading-[0.98] tracking-tight text-ink mb-2">
                Histórico <span className="text-grad-aurora">Completo</span>
              </h1>
              <p className="font-sans text-sm text-ink-2 max-w-xl">
                Todas as operações — swaps, bridges, CEX spot/futuros, autopilot e rebalances — com P&L detalhado por tipo.
              </p>
            </div>
            {entries.length > 0 && (
              <button
                onClick={() => { if (confirm("Limpar todo o histórico?")) clear(); }}
                className="btn btn-secondary py-2 text-xs gap-1.5 text-red/70 hover:text-red border-red/20 hover:border-red/40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar tudo
              </button>
            )}
          </div>
        </motion.div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <SummaryCard label="Operações" value={String(summary.count)} tone="ink" />
          <SummaryCard label="Volume total" value={formatUsd(summary.totalVol)} tone="cyan" />
          <SummaryCard label="Taxas pagas" value={formatUsd(summary.totalFees)} tone="gold" />
          <SummaryCard
            label="P&L realizado"
            value={summary.totalPnl === 0 ? "–" : (summary.totalPnl > 0 ? "+" : "") + formatUsd(summary.totalPnl)}
            tone={summary.totalPnl > 0 ? "green" : summary.totalPnl < 0 ? "red" : "ink"}
          />
        </div>

        {/* Filters */}
        <div className="god-card rounded-2xl border border-white/5 glass-pane p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 focus-within:border-cyan/30">
            <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por token, rede, hash…"
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none font-sans"
            />
          </div>

          {/* Type pills */}
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={typeFilter === "all"} onClick={() => setTypeFilter("all")} label="Todos" />
            {ALL_TYPES.map((t) => (
              <FilterPill
                key={t}
                active={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                label={TX_TYPE_LABELS_PT[t]}
              />
            ))}
          </div>

          {/* Status pills */}
          <div className="flex gap-1.5">
            {(["all", "confirmed", "pending", "failed", "canceled"] as const).map((s) => (
              <FilterPill
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                label={s === "all" ? "Todos status" : STATUS_LABELS_PT[s]}
              />
            ))}
          </div>
        </div>

        {/* Transaction list */}
        <div className="god-card rounded-2xl border border-white/5 glass-pane overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <span className="font-display font-bold text-sm text-ink">Transações</span>
            <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
              {filtered.length} de {entries.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <History className="w-8 h-8 text-ink-4 mx-auto mb-3" />
              <p className="font-sans text-sm text-ink-3">
                {entries.length === 0
                  ? "Nenhuma transação registrada ainda. Execute um swap ou trade para começar."
                  : "Nenhum resultado para os filtros selecionados."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              <AnimatePresence initial={false}>
                {filtered.map((entry) => (
                  <TxRow
                    key={entry.id}
                    entry={entry}
                    expanded={expanded === entry.id}
                    onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <p className="font-mono text-[9px] text-ink-4 text-center mt-5">
          Histórico armazenado localmente · máx. 500 entradas · nunca enviado a servidores
        </p>
      </div>
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
  const date = new Date(entry.ts);
  const dateStr = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const timeStr = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const pnl = entry.pnlUsd;
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
          <span className="font-mono text-[9px] text-ink-4 flex-shrink-0">{entry.fromChain}</span>
          {isCross
            ? <ArrowRight className="w-3 h-3 text-violet flex-shrink-0" />
            : <ArrowRight className="w-3 h-3 text-ink-4 flex-shrink-0" />}
          <span className="font-display font-bold text-sm text-ink truncate">{entry.toSymbol}</span>
          <span className="font-mono text-[9px] text-ink-4 flex-shrink-0">{entry.toChain}</span>
        </div>

        {/* Value / P&L */}
        <div className="text-right flex-shrink-0 space-y-0.5">
          {entry.valueUsd !== undefined && (
            <div className="font-mono text-sm text-ink">{formatUsd(entry.valueUsd)}</div>
          )}
          {pnl !== undefined && (
            <div className={cn("font-mono text-xs flex items-center gap-0.5 justify-end", pnlColor)}>
              <PnlIcon className="w-2.5 h-2.5" />
              {pnl > 0 ? "+" : ""}{formatUsd(pnl)}
            </div>
          )}
        </div>

        {/* Status */}
        <span className={cn("flex-shrink-0 font-mono text-[10px]", STATUS_COLORS[entry.status])}>
          {STATUS_LABELS_PT[entry.status]}
        </span>

        {/* Date */}
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[10px] text-ink-3">{dateStr}</div>
          <div className="font-mono text-[10px] text-ink-4">{timeStr}</div>
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
                  <Detail label="Enviado" value={`${entry.fromAmount} ${entry.fromSymbol}`} />
                )}
                {entry.toAmount && (
                  <Detail label="Recebido" value={`${entry.toAmount} ${entry.toSymbol}`} />
                )}
                {entry.feesUsd !== undefined && (
                  <Detail label="Taxas" value={formatUsd(entry.feesUsd)} />
                )}
                {entry.route && (
                  <Detail label="Rota" value={entry.route} />
                )}
                {entry.exchange && (
                  <Detail label="Exchange" value={entry.exchange} />
                )}
                {entry.orderId && (
                  <Detail label="Order ID" value={entry.orderId.slice(0, 12) + "…"} mono />
                )}
                {entry.leverage && (
                  <Detail label="Alavancagem" value={`${entry.leverage}x`} />
                )}
                {entry.liqPrice && (
                  <Detail label="Liquidação" value={entry.liqPrice} />
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
                  Ver no explorer
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

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  const colors: Record<string, string> = {
    cyan: "text-cyan", green: "text-green", red: "text-red",
    gold: "text-gold", ink: "text-ink",
  };
  return (
    <div className="god-card rounded-xl border border-white/5 glass-pane p-3">
      <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-1">{label}</div>
      <div className={cn("font-display font-bold text-lg leading-none", colors[tone] ?? "text-ink")}>{value}</div>
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
          ? "bg-white/[0.08] border-white/20 text-ink"
          : "border-white/5 bg-white/[0.02] text-ink-3 hover:text-ink-2 hover:border-white/10",
      )}
    >
      {label}
    </button>
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
