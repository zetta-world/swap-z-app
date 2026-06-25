"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Lock, AlertTriangle, History, RefreshCw, X, Banknote } from "lucide-react";
import { useAutopilot, AUTOPILOT_MAJOR_SYMBOLS, type AutopilotEntry } from "@/lib/store/autopilot";
import { useCexVault } from "@/lib/cex/vault";
import { CEX_META, SUPPORTED_CEX_IDS, type CexId } from "@/lib/cex/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import TierGate from "@/components/auth/TierGate";

/**
 * Settings UI for the ZION autopilot. Designed so the user has to
 * make explicit choices for every rail before the master toggle does
 * anything: a frozen-loss safety stop, a per-trade USD ceiling, a
 * daily count cap, an exchanges whitelist, a symbol whitelist.
 *
 * The history viewer at the bottom is read-only; everything's stored
 * locally via the zustand persist of useAutopilot.
 */
/**
 * CEX autopilot is a "pro"-tier feature. The gate is dormant until
 * TIER_GATES_ENABLED=true, so this wrapper is a pass-through until launch.
 */
export default function AutopilotPanel() {
  return (
    <TierGate required="pro">
      <AutopilotPanelInner />
    </TierGate>
  );
}

function AutopilotPanelInner() {
  const t = useT();
  const a = useAutopilot();
  const vault = useCexVault();
  const [confirmOn, setConfirmOn] = useState(false);

  const vaultReady = !!vault.creds;
  const connectedIds = useMemo(
    () => (vault.creds ? Object.keys(vault.creds) as CexId[] : []),
    [vault.creds],
  );

  const onToggleMaster = () => {
    if (!a.enabled) {
      setConfirmOn(true);
      return;
    }
    a.setEnabled(false);
  };

  const onConfirmEnable = () => {
    if (a.allowedExchanges.length === 0 || a.allowedSymbols.length === 0) {
      return;
    }
    a.setEnabled(true);
    setConfirmOn(false);
  };

  const symbolPool = AUTOPILOT_MAJOR_SYMBOLS;

  return (
    <div className="rounded-2xl border border-gold/15 glass-pane p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-gold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-sm text-ink">{t("autopilot.title")}</div>
          <div className="font-mono text-[10px] text-ink-3 tracking-wider uppercase">
            {t("autopilot.subtitle")}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleMaster}
          className={cn(
            "px-3 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border transition-colors",
            a.enabled
              ? "border-green/40 bg-green/10 text-green hover:bg-green/20"
              : "border-white/15 bg-white/[0.03] text-ink-3 hover:bg-white/[0.06]",
          )}
        >
          {a.enabled ? t("autopilot.on") : t("autopilot.off")}
        </button>
      </div>

      {/* Vault status — autopilot is dead in the water without unlocked creds */}
      <div className={cn(
        "rounded-md border px-3 py-2.5 flex items-start gap-2 text-[11px] leading-relaxed",
        vaultReady
          ? "border-cyan/20 bg-cyan/[0.04] text-ink-2"
          : "border-gold/30 bg-gold/[0.05] text-ink-2",
      )}>
        <Lock className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", vaultReady ? "text-cyan" : "text-gold")} />
        <div>
          {vaultReady
            ? (connectedIds.length === 1
                ? t("autopilot.vaultUnlocked", { n: connectedIds.length })
                : t("autopilot.vaultUnlockedPlural", { n: connectedIds.length }))
            : t("autopilot.vaultLocked")}
        </div>
      </div>

      {/* Daily freeze indicator */}
      {a.frozenUntilDay && (
        <div className="rounded-md border border-red/30 bg-red/[0.05] px-3 py-2.5 flex items-start gap-2 text-[11px] text-red">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>
            {t("autopilot.frozenMsg")}
          </div>
        </div>
      )}

      {/* Rails — numeric */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <NumRail
          label={t("autopilot.railMaxPerTrade")}
          unit="$"
          value={a.maxTradeUsd}
          onChange={a.setMaxTradeUsd}
          step={25}
        />
        <NumRail
          label={t("autopilot.railTradesPerDay")}
          unit=""
          value={a.maxTradesPerDay}
          onChange={a.setMaxTradesPerDay}
          step={1}
        />
        <NumRail
          label={t("autopilot.railDailyLossStop")}
          unit="$"
          value={a.dailyLossStopUsd}
          onChange={a.setDailyLossStopUsd}
          step={25}
        />
        <NumRail
          label={t("autopilot.railCancelWindow")}
          unit="s"
          value={Math.round(a.countdownMs / 1000)}
          onChange={(n) => a.setCountdownMs(n * 1000)}
          step={5}
          min={5}
          max={180}
        />
      </div>

      {/* Exchanges */}
      <div>
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{t("autopilot.allowedExchanges")}</div>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED_CEX_IDS.map((id) => {
            const active = a.allowedExchanges.includes(id);
            const isConnected = connectedIds.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => a.setAllowedExchanges(
                  active
                    ? a.allowedExchanges.filter((x) => x !== id)
                    : [...a.allowedExchanges, id],
                )}
                className={cn(
                  "px-2 py-1 rounded font-mono text-[10px] tracking-widest uppercase border inline-flex items-center gap-1.5",
                  active ? "border-gold/40 bg-gold/10 text-gold" : "border-white/10 bg-white/[0.02] text-ink-3 hover:bg-white/[0.05]",
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-green" : "bg-ink-4")} />
                {CEX_META[id].label}
              </button>
            );
          })}
        </div>
        <div className="font-mono text-[9px] text-ink-4 mt-1.5">
          {t("autopilot.exchangesHelp")}
        </div>
      </div>

      {/* Symbols */}
      <div>
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{t("autopilot.allowedSymbols")}</div>
        <div className="flex flex-wrap gap-1.5">
          {symbolPool.map((sym) => {
            const active = a.allowedSymbols.includes(sym);
            return (
              <button
                key={sym}
                type="button"
                onClick={() => a.setAllowedSymbols(
                  active
                    ? a.allowedSymbols.filter((x) => x !== sym)
                    : [...a.allowedSymbols, sym],
                )}
                className={cn(
                  "px-2 py-1 rounded font-mono text-[10px] tracking-widest uppercase border",
                  active ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/10 bg-white/[0.02] text-ink-3 hover:bg-white/[0.05]",
                )}
              >
                {sym}
              </button>
            );
          })}
        </div>
      </div>

      {/* Auto-rebalance — separate opt-in pipeline that lets the
          autopilot fire a CEX→wallet withdrawal when ZION emits a
          `rebalance` card. The user still has to manually re-deposit
          to the destination CEX from their wallet; v1 doesn't auto-sign. */}
      <div className="rounded-md border border-violet/20 bg-violet/[0.04] p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="w-3.5 h-3.5 text-violet flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-xs text-violet">{t("autopilot.rebalanceTitle")}</div>
            <div className="font-mono text-[9px] text-ink-3 tracking-wider uppercase">
              {t("autopilot.rebalanceDesc")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => a.setAutoRebalanceEnabled(!a.autoRebalanceEnabled)}
            className={cn(
              "px-2.5 py-1 rounded font-mono text-[10px] tracking-widest uppercase border",
              a.autoRebalanceEnabled
                ? "border-violet/50 bg-violet/15 text-violet hover:bg-violet/25"
                : "border-white/15 bg-white/[0.03] text-ink-3 hover:bg-white/[0.06]",
            )}
          >
            {a.autoRebalanceEnabled ? t("autopilot.on") : t("autopilot.off")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumRail
            label={t("autopilot.railMaxPerRebalance")}
            unit="$"
            value={a.maxRebalanceUsd}
            onChange={a.setMaxRebalanceUsd}
            step={25}
            min={10}
            max={5_000}
          />
          <NumRail
            label={t("autopilot.railRebalancesPerDay")}
            unit=""
            value={a.maxRebalancesPerDay}
            onChange={a.setMaxRebalancesPerDay}
            step={1}
            min={1}
            max={20}
          />
        </div>
        <div className="font-mono text-[10px] text-ink-3 leading-relaxed">
          {t("autopilot.rebalanceDestination")}
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-4 gap-2 text-center pt-2 border-t border-white/5">
        <Counter label={t("autopilot.counterTradesToday")} value={`${a.tradesToday} / ${a.maxTradesPerDay}`} tone="cyan" />
        <Counter label={t("autopilot.counterRebalancesToday")} value={`${a.rebalancesToday} / ${a.maxRebalancesPerDay}`} tone="violet" />
        <Counter label={t("autopilot.counterDayPnl")} value={`${a.pnlToday >= 0 ? "+" : ""}$${a.pnlToday.toFixed(2)}`} tone={a.pnlToday < 0 ? "red" : "green"} />
        <Counter label={t("autopilot.counterHistory")} value={String(a.history.length)} tone="violet" />
      </div>

      {/* History viewer */}
      {a.history.length > 0 && (
        <AutopilotHistory history={a.history} onClear={a.clearHistory} />
      )}

      {/* Confirmation overlay */}
      {confirmOn && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-md border border-gold/30 bg-bg-1 p-3 space-y-2"
        >
          <div className="flex items-center gap-2 font-display font-bold text-xs text-gold">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t("autopilot.confirmTitle")}
          </div>
          <ul className="font-mono text-[11px] text-ink-2 leading-relaxed list-disc list-inside space-y-1">
            <li>{t("autopilot.confirmReal")}</li>
            <li>{t("autopilot.confirmLimits", { maxTrade: a.maxTradeUsd, dailyLoss: a.dailyLossStopUsd, maxTrades: a.maxTradesPerDay })}</li>
            <li>{t("autopilot.confirmCountdown", { n: Math.round(a.countdownMs / 1000) })}</li>
            <li>{t("autopilot.confirmPause")}</li>
          </ul>
          {(a.allowedExchanges.length === 0 || a.allowedSymbols.length === 0) && (
            <div className="font-mono text-[11px] text-red">
              {t("autopilot.confirmPickOne")}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmOn(false)}
              className="px-3 py-1.5 rounded font-mono text-[10px] tracking-widest uppercase border border-white/10 text-ink-3 hover:bg-white/5"
            >
              {t("autopilot.confirmCancel")}
            </button>
            <button
              type="button"
              onClick={onConfirmEnable}
              disabled={a.allowedExchanges.length === 0 || a.allowedSymbols.length === 0}
              className="px-3 py-1.5 rounded font-mono text-[10px] tracking-widest uppercase border border-gold/40 bg-gold/15 text-gold hover:bg-gold/25 disabled:opacity-40"
            >
              {t("autopilot.confirmEnable")}
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function NumRail({
  label, unit, value, onChange, step, min, max,
}: {
  label:    string;
  unit:     string;
  value:    number;
  onChange: (n: number) => void;
  step:     number;
  min?:     number;
  max?:     number;
}) {
  return (
    <label className="block">
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
      <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-bg-2 px-2 py-1.5 focus-within:border-cyan/40">
        {unit === "$" && <span className="font-mono text-[11px] text-ink-3">$</span>}
        <input
          type="number"
          inputMode="numeric"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n) && n >= 0) onChange(n);
          }}
          className="w-full bg-transparent outline-none font-mono text-sm text-ink tabular-nums"
        />
        {unit && unit !== "$" && <span className="font-mono text-[11px] text-ink-3">{unit}</span>}
      </div>
    </label>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone: "cyan" | "violet" | "green" | "red" }) {
  const text = tone === "cyan" ? "text-cyan" : tone === "violet" ? "text-violet" : tone === "green" ? "text-green" : "text-red";
  return (
    <div>
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-0.5">{label}</div>
      <div className={cn("font-display font-bold text-sm tabular-nums", text)}>{value}</div>
    </div>
  );
}

function AutopilotHistory({ history, onClear }: { history: AutopilotEntry[]; onClear: () => void }) {
  const t = useT();
  return (
    <div className="rounded-md border border-white/5 bg-bg-1/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase inline-flex items-center gap-1.5">
          <History className="w-3 h-3" /> {t("autopilot.recentFires")}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="font-mono text-[9px] text-ink-3 hover:text-ink-2 tracking-widest uppercase inline-flex items-center gap-1"
        >
          <X className="w-2.5 h-2.5" /> {t("autopilot.clear")}
        </button>
      </div>
      <div className="max-h-[200px] overflow-y-auto divide-y divide-white/[0.04]">
        {history.slice(0, 20).map((e, i) => (
          <div key={e.ts + e.symbol + i} className="px-3 py-1.5 font-mono text-[10px] grid grid-cols-12 gap-1.5 items-center">
            <span className="col-span-2 text-ink-4">{formatTime(e.ts)}</span>
            <span className="col-span-2 text-ink-3 truncate">{e.exchange}</span>
            <span className={cn(
              "col-span-2 tracking-widest uppercase font-bold",
              e.side === "buy" ? "text-green" : "text-red",
            )}>
              {e.side}
            </span>
            <span className="col-span-3 text-ink truncate">{e.symbol}</span>
            <span className={cn(
              "col-span-3 text-right tracking-widest uppercase",
              e.status === "fired" ? "text-green" :
              e.status === "canceled" ? "text-ink-3" :
              "text-red",
            )}>
              {e.status}
            </span>
            {e.reason && (
              <span className="col-span-12 text-ink-3 text-[10px] break-words">↳ {e.reason}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Re-export RefreshCw so the bundler doesn't tree-shake the icon away when
// the history is empty — keeps the import surface tight.
void RefreshCw;
