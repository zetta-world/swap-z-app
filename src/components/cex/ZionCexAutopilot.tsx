"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Play, Square, RefreshCw, ChevronDown, ChevronUp,
  Shield, Target, Zap, AlertTriangle, CheckCircle2, Loader2,
  BookOpen, TrendingUp, Layers,
} from "lucide-react";
import { toast } from "sonner";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import ActionCardView from "@/components/zion/ActionCardView";
import AutopilotPilot from "@/components/zion/AutopilotPilot";
import CexOrderConfirm from "@/components/cex/CexOrderConfirm";
import { mapCardToCexIntents, type AutopilotIntent } from "@/lib/zion/autopilot-bridge";
import BackgroundAutopilotPanel from "@/components/cex/BackgroundAutopilotPanel";
import { useAutopilot, AUTOPILOT_RISK_PRESETS, type AutopilotRiskMode } from "@/lib/store/autopilot";
import { useAutopilotPositions } from "@/lib/store/autopilotPositions";
import { useTxHistory } from "@/lib/store/txHistory";
import { useCexVault } from "@/lib/cex/vault";
import type { CexId, CexCredentials, CexBalance, CexOrder } from "@/lib/cex/types";
import { useUI } from "@/lib/store/ui";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

type MarketType = "spot" | "futures" | "margin";

const MARKET_LABELS: Record<MarketType, { labelKey: MessageKey; Icon: React.ComponentType<{ className?: string }> }> = {
  spot:    { labelKey: "cex.zionApMarketSpot",    Icon: BookOpen },
  futures: { labelKey: "cex.zionApMarketFutures", Icon: TrendingUp },
  margin:  { labelKey: "cex.zionApMarketMargin",  Icon: Layers },
};

const RISK_META: Record<AutopilotRiskMode, {
  Icon:        React.ComponentType<{ className?: string }>;
  color:       string;
  textClass:   string;
  borderClass: string;
  bgClass:     string;
  labelKey:    MessageKey;
  pct:         number;
  descKey:     MessageKey;
}> = {
  conservador: {
    Icon: Shield,
    color: "cyan",
    textClass:   "text-cyan",
    borderClass: "border-cyan/30",
    bgClass:     "bg-cyan/[0.08]",
    labelKey: "cex.zionApRiskConservative",
    pct:   0.20,
    descKey:  "cex.zionApRiskConservativeDesc",
  },
  moderado: {
    Icon: Target,
    color: "gold",
    textClass:   "text-gold",
    borderClass: "border-gold/30",
    bgClass:     "bg-gold/[0.08]",
    labelKey: "cex.zionApRiskModerate",
    pct:   0.40,
    descKey:  "cex.zionApRiskModerateDesc",
  },
  agressivo: {
    Icon: Zap,
    color: "red",
    textClass:   "text-red",
    borderClass: "border-red/30",
    bgClass:     "bg-red/[0.08]",
    labelKey: "cex.zionApRiskAggressive",
    pct:   0.65,
    descKey:  "cex.zionApRiskAggressiveDesc",
  },
};

const LOSS_PCT: Record<AutopilotRiskMode, number> = {
  conservador: 0.10,
  moderado:    0.20,
  agressivo:   0.35,
};

interface Props {
  exchangeId:  CexId;
  credentials: CexCredentials;
}

interface CexBalanceSnapshot {
  totalUsd:  number;
  balances:  CexBalance[];
}

export default function ZionCexAutopilot({ exchangeId, credentials }: Props) {
  const t       = useT();
  const a       = useAutopilot();
  const vault   = useCexVault();
  const { lang } = useUI();

  const positionsRecord = useAutopilotPositions((s) => s.positions);
  const closePosition   = useAutopilotPositions((s) => s.closePosition);
  const recordEntry     = useAutopilotPositions((s) => s.recordEntry);
  const markExitArmed   = useAutopilotPositions((s) => s.markExitArmed);
  const pushTxHistory   = useTxHistory((s) => s.push);

  // Manual "Executar proposta" → opens the CexOrderConfirm guard for the
  // selected card's resolved intent. Distinct from the autonomous pilot:
  // here the user clicks each card explicitly and confirms in the modal.
  const [manualOrder, setManualOrder] = useState<{
    card:   ActionCard;
    intent: AutopilotIntent;
  } | null>(null);

  const [riskMode,    setRiskMode]    = useState<AutopilotRiskMode>("conservador");
  const [marketType,  setMarketType]  = useState<MarketType>("spot");
  const [buffer,      setBuffer]      = useState("");
  const [streaming,   setStreaming]   = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [cexBalance,  setCexBalance]  = useState<CexBalanceSnapshot | null>(null);
  const [loadingBal,  setLoadingBal]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Fetch real CEX balance once on mount / credential change ──────────
  useEffect(() => {
    const ctrl = new AbortController();
    setLoadingBal(true);
    setCexBalance(null);
    fetch("/api/cex/balance", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exchange:   exchangeId,
        apiKey:     credentials.apiKey,
        apiSecret:  credentials.apiSecret,
        passphrase: credentials.passphrase,
        withUsd:    true,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json() as Promise<{ ok: boolean; totalUsd?: number; balances?: CexBalance[] }>)
      .then((body) => {
        if (body.ok && body.balances) {
          setCexBalance({ totalUsd: body.totalUsd ?? 0, balances: body.balances });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingBal(false));
    return () => ctrl.abort();
  }, [exchangeId, credentials]);

  // ── Dynamic trade sizing from real balance ────────────────────────────
  const effectiveMaxTradeUsd = useMemo(() => {
    if (!cexBalance || cexBalance.totalUsd <= 0) return AUTOPILOT_RISK_PRESETS[riskMode].maxTradeUsd;
    return Math.max(2, Math.round(cexBalance.totalUsd * RISK_META[riskMode].pct));
  }, [cexBalance, riskMode]);

  const effectiveDailyLossStopUsd = useMemo(() => {
    if (!cexBalance || cexBalance.totalUsd <= 0) return AUTOPILOT_RISK_PRESETS[riskMode].dailyLossStopUsd;
    return Math.max(2, Math.round(cexBalance.totalUsd * LOSS_PCT[riskMode]));
  }, [cexBalance, riskMode]);

  // Compact balance string passed to ZION for context
  const balanceContext = useMemo(() => {
    if (!cexBalance) return "";
    const nonZero = cexBalance.balances
      .filter((b) => b.total > 0)
      .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
      .slice(0, 10);
    const parts = nonZero
      .map((b) => `${b.asset}: ${b.total}${b.usdValue ? ` (~$${b.usdValue.toFixed(2)})` : ""}`)
      .join(", ");
    return `total: $${cexBalance.totalUsd.toFixed(2)} | ${parts}`;
  }, [cexBalance]);

  // ── Open positions opened by the autopilot (entry memory) ─────────────
  const openPositions = useMemo(
    () => Object.values(positionsRecord).filter((p) => p.exchange === exchangeId && p.status !== "closed"),
    [positionsRecord, exchangeId],
  );

  // Reap positions that are no longer held (exit filled / sold elsewhere).
  // Guarded by a 2-min age buffer so a freshly-opened position isn't reaped
  // by a balance snapshot taken before the buy settled.
  useEffect(() => {
    if (!cexBalance) return;
    const now = Date.now();
    for (const p of openPositions) {
      if (now - p.entryTs < 120_000) continue;
      const bal = cexBalance.balances.find((b) => b.asset.toUpperCase() === p.base);
      if (!bal || bal.total <= 0) closePosition(p.exchange, p.base);
    }
  }, [cexBalance, openPositions, closePosition]);

  // Position context fed to ZION so a re-scan arms profitable EXITS for
  // holdings the autopilot opened — using the entry price + the reasoning it
  // recorded at entry time. Cross-referenced with the live balance (source of
  // truth for what's actually held right now).
  const positionsContext = useMemo(() => {
    if (openPositions.length === 0) return "";
    const lines = openPositions.map((p) => {
      const bal = cexBalance?.balances.find((b) => b.asset.toUpperCase() === p.base);
      const held = bal?.total ?? p.baseAmount;
      const curPrice = bal && bal.total > 0 && bal.usdValue ? bal.usdValue / bal.total : undefined;
      const pnlPct = curPrice ? ((curPrice - p.entryPrice) / p.entryPrice) * 100 : undefined;
      const ageH = Math.max(0, Math.round((Date.now() - p.entryTs) / 3_600_000));
      return [
        p.pair,
        `held=${held}`,
        `entry=$${p.entryPrice}`,
        curPrice ? `now=$${curPrice.toFixed(4)}` : "",
        pnlPct !== undefined ? `unrealized=${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "",
        `age=${ageH}h`,
        `exit_armed=${p.status === "exit_armed" ? "yes" : "no"}`,
        p.reasoning ? `entry_reason="${p.reasoning.replace(/"/g, "'").slice(0, 140)}"` : "",
      ].filter(Boolean).join(" | ");
    });
    return lines.join("\n");
  }, [openPositions, cexBalance]);

  const { visible, cards } = useMemo(() => parseZionStream(buffer), [buffer]);

  // ── Arm: apply dynamic preset, enable autopilot, run ZION scan ────────
  const arm = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const preset = AUTOPILOT_RISK_PRESETS[riskMode];

    // Apply dynamic risk values to the autopilot store
    a.setMaxTradeUsd(effectiveMaxTradeUsd);
    a.setMaxTradesPerDay(preset.maxTradesPerDay);
    a.setDailyLossStopUsd(effectiveDailyLossStopUsd);
    a.setCountdownMs(preset.countdownMs);
    a.setAllowedSymbols(preset.allowedSymbols);
    a.setAllowedExchanges([exchangeId]);
    a.setEnabled(true);

    // Ensure vault has the credentials
    const live = vault.getActive();
    if (!live?.[exchangeId]) {
      vault.setUnlocked({ ...live, [exchangeId]: credentials });
    }

    setBuffer("");
    setStreaming(true);

    const params = new URLSearchParams({
      op:             "autopilot_cex",
      riskMode,
      exchangeId,
      maxTradeUsd:    String(effectiveMaxTradeUsd),
      marketType,
      balanceContext,
      autopilotMode:  "true",
      lang: lang === "pt" ? "pt" : lang === "es" ? "es" : lang === "zh" ? "zh" : "en",
    });
    if (positionsContext) params.set("positionsContext", positionsContext);

    try {
      const res = await fetch(`/api/zion?${params.toString()}`, { signal: ctrl.signal });
      if (!res.body) { setStreaming(false); return; }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setBuffer((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        setBuffer((prev) => prev + "\n\n" + t("cex.zionApStreamInterrupted"));
      }
    } finally {
      setStreaming(false);
    }
  }, [riskMode, marketType, exchangeId, credentials, a, vault, lang, effectiveMaxTradeUsd, effectiveDailyLossStopUsd, balanceContext, positionsContext, t]);

  const disarm = useCallback(() => {
    abortRef.current?.abort();
    a.setEnabled(false);
    setStreaming(false);
    setBuffer("");
  }, [a]);

  const rescan = useCallback(() => {
    setBuffer("");
    void arm();
  }, [arm]);

  const isArmed  = a.enabled;
  const isFrozen = !!a.frozenUntilDay;
  const preset   = AUTOPILOT_RISK_PRESETS[riskMode];
  const meta     = RISK_META[riskMode];
  const ModeIcon = meta.Icon;

  // Manual execution from the "Executar proposta" button on a card.
  // Maps the card → CEX intent and opens the confirmation guard. The
  // autonomous pilot (countdown banner) is unchanged and independent.
  const executeCard = useCallback((card: ActionCard) => {
    const intents = mapCardToCexIntents(card);
    if (!intents || intents.length === 0) {
      if (card.kind === "stop_loss") {
        toast.error(t("cex.zionApStopLossManual"));
      } else {
        toast.error(t("cex.zionApNoConvert"));
      }
      return;
    }
    if (intents.length > 1) {
      // Multi-leg arb (cross-CEX / triangular) — these fire atomically and
      // belong to the autonomous pilot. Manual single-confirm would leave
      // directional risk on a partial fill.
      toast.error(t("cex.zionApMultiLeg"));
      return;
    }
    setManualOrder({ card, intent: intents[0] });
  }, [t]);

  // After a manual order is accepted by the exchange, mirror the pilot's
  // bookkeeping: record to tx history + position memory.
  const onManualConfirmed = useCallback((order: CexOrder) => {
    if (!manualOrder) return;
    const { card, intent } = manualOrder;
    const [baseSymbol, quoteSymbol] = intent.symbol.split("/");
    pushTxHistory({
      type:       "cex_spot",
      status:     "confirmed",
      fromSymbol: intent.side === "buy" ? (quoteSymbol ?? "USDT") : (baseSymbol ?? intent.symbol),
      fromChain:  exchangeId,
      fromAmount: intent.side === "buy" ? String(intent.notionalUsd.toFixed(6)) : String(intent.amount),
      toSymbol:   intent.side === "buy" ? (baseSymbol ?? intent.symbol) : (quoteSymbol ?? "USDT"),
      toChain:    exchangeId,
      exchange:   exchangeId,
      orderId:    order.id,
      route:      intent.type,
      notes:      card.title.slice(0, 80),
      valueUsd:   intent.notionalUsd,
    });
    if (intent.side === "buy" && intent.price && intent.price > 0) {
      recordEntry({
        exchange:   exchangeId,
        pair:       intent.symbol,
        entryPrice: intent.price,
        baseAmount: intent.amount,
        costUsd:    intent.notionalUsd,
        reasoning:  (card.summary ?? "").slice(0, 300),
        entryLabel: card.title.slice(0, 80),
      });
    } else if (intent.side === "sell") {
      markExitArmed(exchangeId, baseSymbol ?? intent.symbol.split("/")[0], order.id);
    }
    toast.success(t("cex.zionApOrderSent", { side: intent.side.toUpperCase(), symbol: intent.symbol, exchange: exchangeId }));
    setManualOrder(null);
  }, [manualOrder, exchangeId, pushTxHistory, recordEntry, markExitArmed, t]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-purple-500/25 bg-purple-500/[0.04] p-4 sm:p-5 space-y-4 min-w-0"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-400" />
          <span className="font-mono text-[10px] tracking-widest uppercase text-purple-300 font-bold">
            {t("cex.zionApHeader")}
          </span>
          {loadingBal && <Loader2 className="w-3 h-3 text-ink-4 animate-spin" />}
          {cexBalance && !loadingBal && (
            <span className="font-mono text-[10px] text-ink-3">
              ${cexBalance.totalUsd.toFixed(2)}
            </span>
          )}
        </div>
        <div className={cn(
          "flex items-center gap-1.5 font-mono text-[10px] tracking-widest uppercase",
          isFrozen ? "text-red" : isArmed ? "text-green" : "text-ink-4",
        )}>
          {isFrozen
            ? <><AlertTriangle className="w-3 h-3" /> {t("cex.zionApStatusFrozen")}</>
            : isArmed
              ? <><CheckCircle2 className="w-3 h-3" /> {t("cex.zionApStatusArmed")}</>
              : t("cex.zionApStatusStopped")}
        </div>
      </div>

      {/* ── Frozen warning ──────────────────────────────────────────── */}
      {isFrozen && (
        <div className="rounded-lg border border-red/30 bg-red/[0.06] px-3 py-2 font-mono text-[10px] text-red leading-relaxed">
          {t("cex.zionApFrozenMsg", { amount: effectiveDailyLossStopUsd })}
        </div>
      )}

      {/* ── Selectors (only when disarmed) ──────────────────────────── */}
      {!isArmed && (
        <div className="space-y-3">
          {/* Market type */}
          <div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-2">{t("cex.zionApMarketTypeLabel")}</div>
            <div className="grid grid-cols-3 gap-2">
              {(["spot", "futures", "margin"] as const).map((mt) => {
                const { labelKey, Icon } = MARKET_LABELS[mt];
                const active = marketType === mt;
                return (
                  <button
                    key={mt}
                    type="button"
                    onClick={() => setMarketType(mt)}
                    className={cn(
                      "rounded-xl border p-2.5 text-center transition-all",
                      active
                        ? "border-purple-500/50 bg-purple-500/[0.10] text-purple-300"
                        : "border-white/8 bg-white/[0.02] text-ink-3 hover:border-white/15 hover:text-ink-2",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 mx-auto mb-1" />
                    <div className="font-mono text-[9px] tracking-widest uppercase">{t(labelKey)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Risk mode */}
          <div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-2">{t("cex.zionApRiskModeLabel")}</div>
            <div className="grid grid-cols-3 gap-2">
              {(["conservador", "moderado", "agressivo"] as const).map((m) => {
                const rm = RISK_META[m];
                const RmIcon = rm.Icon;
                const active = riskMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRiskMode(m)}
                    className={cn(
                      "rounded-xl border p-2.5 text-center transition-all",
                      active
                        ? `${rm.borderClass} ${rm.bgClass} ${rm.textClass}`
                        : "border-white/8 bg-white/[0.02] text-ink-3 hover:border-white/15 hover:text-ink-2",
                    )}
                  >
                    <RmIcon className="w-3.5 h-3.5 mx-auto mb-1" />
                    <div className="font-mono text-[9px] tracking-widest uppercase">{t(rm.labelKey)}</div>
                    <div className="font-mono text-[9px] text-ink-3 mt-0.5">
                      {t("cex.zionApPctOfBalance", { pct: rm.pct * 100 })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic preset summary */}
          <div className="rounded-lg border border-white/5 bg-bg-1/30 p-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">{t("cex.zionApPerTrade")}</div>
              <div className={cn("font-display font-bold text-sm", meta.textClass)}>
                {loadingBal
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                  : `$${effectiveMaxTradeUsd}`}
              </div>
            </div>
            <div>
              <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">{t("cex.zionApTradesPerDay")}</div>
              <div className="font-display font-bold text-sm text-ink">{preset.maxTradesPerDay}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">{t("cex.zionApLossStop")}</div>
              <div className="font-display font-bold text-sm text-red">
                {loadingBal
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                  : `$${effectiveDailyLossStopUsd}`}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="font-mono text-[9px] text-ink-4">
              {t("cex.zionApPairs", { pairs: preset.allowedSymbols.join(", ") })}
            </div>
            <div className="font-mono text-[9px] text-ink-4">
              {t("cex.zionApCountdown", { seconds: preset.countdownMs / 1000 })}
            </div>
            {cexBalance && (
              <div className="font-mono text-[9px] text-ink-4">
                {t("cex.zionApCexBalance", { balances: cexBalance.balances
                  .filter((b) => b.total > 0)
                  .sort((x, y) => (y.usdValue ?? 0) - (x.usdValue ?? 0))
                  .slice(0, 4)
                  .map((b) => `${b.asset} ${b.total > 0.001 ? b.total.toFixed(4) : b.total}${b.usdValue ? ` ($${b.usdValue.toFixed(2)})` : ""}`)
                  .join(" · ") })}
              </div>
            )}
          </div>

          {/* Background mode — keep operating after the browser closes */}
          <BackgroundAutopilotPanel
            exchangeId={exchangeId}
            credentials={credentials}
            riskMode={riskMode}
            marketType={marketType}
            maxTradeUsd={effectiveMaxTradeUsd}
            dailyLossStopUsd={effectiveDailyLossStopUsd}
            maxTradesPerDay={preset.maxTradesPerDay}
            allowedSymbols={preset.allowedSymbols}
            lang={lang === "pt" ? "pt" : lang === "es" ? "es" : lang === "zh" ? "zh" : "en"}
          />
        </div>
      )}

      {/* ── AutopilotPilot countdown banner ─────────────────────────── */}
      {isArmed && cards.length > 0 && (
        <AutopilotPilot cards={cards} />
      )}

      {/* ── Action cards ─────────────────────────────────────────────── */}
      {isArmed && cards.length > 0 && (
        <div className="space-y-2">
          <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
            {cards.length === 1
              ? t("cex.zionApOrdersGenerated", { n: cards.length })
              : t("cex.zionApOrdersGeneratedPlural", { n: cards.length })}
          </div>
          {cards.map((card, i) => (
            <ActionCardView
              key={i}
              card={card}
              index={i}
              onExecute={executeCard}
            />
          ))}
        </div>
      )}

      {/* ── ZION analysis text (collapsible) ─────────────────────────── */}
      {buffer && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3 hover:text-ink-2 tracking-widest uppercase transition-colors"
          >
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showDetails ? t("cex.zionApHideAnalysis") : t("cex.zionApShowAnalysis")}
            {streaming && <RefreshCw className="w-2.5 h-2.5 animate-spin ml-1" />}
          </button>
          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <pre className="text-[11px] text-ink-2 font-mono whitespace-pre-wrap leading-relaxed bg-bg-1/40 rounded-lg p-3 border border-white/5 max-h-56 overflow-y-auto">
                  {visible || (streaming ? t("cex.zionApAnalyzing") : "")}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Arm / Disarm / Rescan buttons ─────────────────────────────── */}
      <div className="flex gap-2">
        {!isArmed ? (
          <button
            type="button"
            onClick={arm}
            disabled={streaming || isFrozen}
            className={cn(
              "flex-1 py-2.5 rounded-lg font-display font-extrabold text-xs tracking-wide flex items-center justify-center gap-2 transition-all",
              "bg-purple-600 text-white hover:bg-purple-500",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {streaming
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("cex.zionApAnalyzing")}</>
              : <><Play className="w-3.5 h-3.5" /> {t("cex.zionApArm")} {t(MARKET_LABELS[marketType].labelKey)}</>
            }
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={disarm}
              className="flex-1 py-2.5 rounded-lg font-display font-extrabold text-xs tracking-wide flex items-center justify-center gap-2 border border-red/30 bg-red/[0.06] text-red hover:bg-red/[0.12] transition-all"
            >
              <Square className="w-3.5 h-3.5" /> {t("cex.zionApDisarm")}
            </button>
            {!streaming && (
              <button
                type="button"
                onClick={rescan}
                className="px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-ink-3 hover:text-ink-2 hover:border-white/20 font-mono text-[10px] tracking-widest uppercase flex items-center gap-1.5 transition-all"
              >
                <RefreshCw className="w-3 h-3" /> {t("cex.zionApRescan")}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Safety footer ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-white/5 bg-white/[0.015] px-3 py-2 font-mono text-[9px] text-ink-4 leading-relaxed space-y-0.5">
        <p>{t("cex.zionApRule1", { seconds: preset.countdownMs / 1000 })}</p>
        <p>{t("cex.zionApRule2", { amount: effectiveDailyLossStopUsd })}</p>
        <p>{t("cex.zionApRule3", { trades: preset.maxTradesPerDay, perTrade: effectiveMaxTradeUsd, pct: meta.pct * 100 })}</p>
      </div>

      {/* ── Manual execution confirm (from "Executar proposta") ─────────── */}
      {manualOrder && (() => {
        const { intent } = manualOrder;
        const [baseAsset, quoteAsset] = intent.symbol.split("/");
        const referencePrice = intent.price && intent.price > 0
          ? intent.price
          : (intent.amount > 0 ? intent.notionalUsd / intent.amount : 0);
        return (
          <CexOrderConfirm
            open
            onClose={() => setManualOrder(null)}
            exchangeId={exchangeId}
            credentials={credentials}
            symbol={intent.symbol}
            side={intent.side}
            type={intent.type}
            amount={intent.amount}
            limitPrice={intent.type === "limit" ? intent.price : undefined}
            referencePrice={referencePrice}
            baseAsset={baseAsset ?? intent.symbol}
            quoteAsset={quoteAsset ?? "USDT"}
            onConfirmed={onManualConfirmed}
          />
        );
      })()}
    </motion.div>
  );
}
