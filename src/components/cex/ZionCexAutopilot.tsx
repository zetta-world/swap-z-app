"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Play, Square, RefreshCw, ChevronDown, ChevronUp,
  Shield, Target, Zap, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import ActionCardView from "@/components/zion/ActionCardView";
import AutopilotPilot from "@/components/zion/AutopilotPilot";
import { useAutopilot, AUTOPILOT_RISK_PRESETS, type AutopilotRiskMode } from "@/lib/store/autopilot";
import { useCexVault } from "@/lib/cex/vault";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/cn";

const RISK_META: Record<AutopilotRiskMode, {
  Icon:        React.ComponentType<{ className?: string }>;
  color:       string;
  textClass:   string;
  borderClass: string;
  bgClass:     string;
  label:       string;
  desc:        string;
}> = {
  conservador: {
    Icon: Shield,
    color: "cyan",
    textClass:   "text-cyan",
    borderClass: "border-cyan/30",
    bgClass:     "bg-cyan/[0.08]",
    label: "Conservador",
    desc:  "BTC · ETH · SOL · $25/op · 3 trades/dia",
  },
  moderado: {
    Icon: Target,
    color: "gold",
    textClass:   "text-gold",
    borderClass: "border-gold/30",
    bgClass:     "bg-gold/[0.08]",
    label: "Moderado",
    desc:  "6 símbolos · $50/op · 5 trades/dia",
  },
  agressivo: {
    Icon: Zap,
    color: "red",
    textClass:   "text-red",
    borderClass: "border-red/30",
    bgClass:     "bg-red/[0.08]",
    label: "Agressivo",
    desc:  "10 símbolos · $100/op · 8 trades/dia",
  },
};

interface Props {
  exchangeId:  CexId;
  credentials: CexCredentials;
}

export default function ZionCexAutopilot({ exchangeId, credentials }: Props) {
  const a       = useAutopilot();
  const vault   = useCexVault();
  const { lang } = useUI();

  const [riskMode,    setRiskMode]    = useState<AutopilotRiskMode>("conservador");
  const [buffer,      setBuffer]      = useState("");
  const [streaming,   setStreaming]   = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const { visible, cards } = useMemo(() => parseZionStream(buffer), [buffer]);

  // Arm: apply preset, enable autopilot, run ZION scan
  const arm = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Apply risk preset + enable autopilot
    a.applyRiskPreset(riskMode, exchangeId);
    a.setEnabled(true);

    // Ensure vault has the credentials (they may already be there)
    const live = vault.getActive();
    if (!live?.[exchangeId]) {
      vault.setUnlocked({ ...live, [exchangeId]: credentials });
    }

    setBuffer("");
    setStreaming(true);

    const preset = AUTOPILOT_RISK_PRESETS[riskMode];
    const params = new URLSearchParams({
      op:           "autopilot_cex",
      riskMode,
      exchangeId,
      maxTradeUsd:  String(preset.maxTradeUsd),
      autopilotMode: "true",
      lang: lang === "pt" ? "pt" : lang === "es" ? "es" : lang === "zh" ? "zh" : "en",
    });

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
        setBuffer((prev) => prev + "\n\n[ZION: análise interrompida. Tente novamente.]");
      }
    } finally {
      setStreaming(false);
    }
  }, [riskMode, exchangeId, credentials, a, vault, lang]);

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

  // Noop executor — autopilot handles CEX execution; we don't open DEX modal
  const noopExecute = useCallback((_card: ActionCard) => {}, []);

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
            ZION · Autopilot CEX
          </span>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 font-mono text-[10px] tracking-widest uppercase",
          isFrozen ? "text-red" : isArmed ? "text-green" : "text-ink-4",
        )}>
          {isFrozen
            ? <><AlertTriangle className="w-3 h-3" /> CONGELADO</>
            : isArmed
              ? <><CheckCircle2 className="w-3 h-3" /> ARMADO</>
              : "● PARADO"}
        </div>
      </div>

      {/* ── Frozen warning ──────────────────────────────────────────── */}
      {isFrozen && (
        <div className="rounded-lg border border-red/30 bg-red/[0.06] px-3 py-2 font-mono text-[10px] text-red leading-relaxed">
          Stop de perda diária atingido (−${preset.dailyLossStopUsd}). Autopilot congelado até meia-noite UTC.
        </div>
      )}

      {/* ── Risk mode selector (only when disarmed) ─────────────────── */}
      {!isArmed && (
        <div className="space-y-3">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Modo de risco</div>

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
                  <div className="font-mono text-[9px] tracking-widest uppercase">{rm.label}</div>
                  <div className="font-mono text-[9px] text-ink-3 mt-0.5">
                    ≤${AUTOPILOT_RISK_PRESETS[m].maxTradeUsd}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Preset summary */}
          <div className="rounded-lg border border-white/5 bg-bg-1/30 p-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Por trade</div>
              <div className={cn("font-display font-bold text-sm", meta.textClass)}>${preset.maxTradeUsd}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Trades/dia</div>
              <div className="font-display font-bold text-sm text-ink">{preset.maxTradesPerDay}</div>
            </div>
            <div>
              <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-0.5">Stop perda</div>
              <div className="font-display font-bold text-sm text-red">${preset.dailyLossStopUsd}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="font-mono text-[9px] text-ink-4">
              Pares: {preset.allowedSymbols.join(", ")}
            </div>
            <div className="font-mono text-[9px] text-ink-4">
              Countdown: {preset.countdownMs / 1000}s por ordem (cancelável)
            </div>
          </div>
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
            {cards.length} ordem{cards.length !== 1 ? "s" : ""} gerada{cards.length !== 1 ? "s" : ""}
          </div>
          {cards.map((card, i) => (
            <ActionCardView
              key={i}
              card={card}
              index={i}
              onExecute={noopExecute}
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
            {showDetails ? "Ocultar análise" : "Ver análise ZION"}
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
                  {visible || (streaming ? "Analisando mercado…" : "")}
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
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analisando mercado…</>
              : <><Play className="w-3.5 h-3.5" /> Armar ZION Autopilot</>
            }
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={disarm}
              className="flex-1 py-2.5 rounded-lg font-display font-extrabold text-xs tracking-wide flex items-center justify-center gap-2 border border-red/30 bg-red/[0.06] text-red hover:bg-red/[0.12] transition-all"
            >
              <Square className="w-3.5 h-3.5" /> Desarmar
            </button>
            {!streaming && (
              <button
                type="button"
                onClick={rescan}
                className="px-3 py-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-ink-3 hover:text-ink-2 hover:border-white/20 font-mono text-[10px] tracking-widest uppercase flex items-center gap-1.5 transition-all"
              >
                <RefreshCw className="w-3 h-3" /> Nova scan
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Safety footer ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-white/5 bg-white/[0.015] px-3 py-2 font-mono text-[9px] text-ink-4 leading-relaxed space-y-0.5">
        <p>· Cada ordem tem <strong className="text-ink-3">{preset.countdownMs / 1000}s</strong> de countdown — você pode cancelar qualquer uma.</p>
        <p>· Stop automático ao atingir <strong className="text-red">${preset.dailyLossStopUsd}</strong> de perda diária.</p>
        <p>· Máximo <strong className="text-ink-3">{preset.maxTradesPerDay}</strong> trades/dia · <strong className="text-ink-3">${preset.maxTradeUsd}</strong> por operação.</p>
      </div>
    </motion.div>
  );
}
