"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import {
  Sparkles, X, Send, RefreshCw, TrendingUp, Globe, Crosshair, FileText,
  ChevronDown, ChevronUp, RotateCcw, Loader2, Sparkle, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import ActionCardView from "./ActionCardView";
import AutopilotPilot from "./AutopilotPilot";
import RebalancePilot from "./RebalancePilot";
import ZionExecuteRouter from "./ZionExecuteRouter";
import TokenSelector from "@/components/swap/TokenSelector";
import type { ZionOp } from "@/lib/zion/mode-prompts";
import type { Token } from "@/lib/tokens";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { useTokenPrice } from "@/lib/hooks/useTokenPrices";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import { GOD_META, isPaidTier } from "@/lib/tier/gods";

const OPS: { id: ZionOp; labelKey: MessageKey; taglineKey: MessageKey; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "trading",   labelKey: "zion.tabTrading", taglineKey: "zion.taglineTrading", Icon: TrendingUp },
  { id: "arbitrage", labelKey: "zion.tabArb",     taglineKey: "zion.taglineArb",     Icon: Globe      },
  { id: "futures",   labelKey: "zion.tabFutures", taglineKey: "zion.taglineFutures", Icon: Zap        },
  { id: "sniper",    labelKey: "zion.tabSniper",  taglineKey: "zion.taglineSniper",  Icon: Crosshair  },
  { id: "pair",      labelKey: "zion.tabDeep",    taglineKey: "zion.taglineDeep",    Icon: FileText   },
];

export default function ZionDrawer() {
  const { zionOpen, setZion, lang } = useUI();
  const { active: tierActive, tier: activeTier } = useTierAccent();
  const { fromToken, toToken, fromChain, amountIn } = useSwap();
  const t = useT();

  const [op, setOp] = useState<ZionOp>("trading");
  const [autoScan, setAutoScan] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [question, setQuestion] = useState("");
  const [executing, setExecuting] = useState<ActionCard | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Local pair override — lets the user analyze ANY pair from inside the
  // drawer without committing to it on the swap card. `null` means "use the
  // active swap pair" (the default + a one-click "reset" puts us back there).
  const [pairOverrideFrom, setPairOverrideFrom] = useState<Token | null>(null);
  const [pairOverrideTo,   setPairOverrideTo  ] = useState<Token | null>(null);

  // Arb-mode filter
  const [arbMinSpread, setArbMinSpread] = useState("0.5");
  // Sniper-mode filter
  const [snipeMaxAge,  setSnipeMaxAge]  = useState<"1h" | "6h" | "24h" | "7d">("24h");
  // Futures-mode filters
  const [futuresLeverage, setFuturesLeverage] = useState("5");
  const [futuresDir,      setFuturesDir]      = useState<"long" | "short">("long");

  const abortRef  = useRef<AbortController | null>(null);

  // Effective pair: override wins when set, else the swap store. The chain
  // tracks the FROM side because ZION analyses are anchored to the source
  // chain.
  const effectiveFromToken = pairOverrideFrom ?? fromToken;
  const effectiveToToken   = pairOverrideTo   ?? toToken;
  const effectiveChain     = effectiveFromToken?.chain ?? fromChain;
  const hasOverride        = !!(pairOverrideFrom || pairOverrideTo);

  // Read amountIn at call-time via a ref so typing in the swap card doesn't
  // recompute the run callback (which would re-fire the auto-open effect).
  const amountInRef = useRef(amountIn);
  amountInRef.current = amountIn;

  // Pull the connected-wallet balance of the FROM token + the live USD
  // price so ZION can size proposals against what the user actually has,
  // valued at the current market price. Read at call-time via a ref —
  // balance/price refreshes happen on their own polling cadence and we
  // don't want either to re-fire the analysis effect.
  const { priceUsd: fromLivePrice } = useTokenPrice(effectiveFromToken);
  const fromBalance = useTokenBalance(effectiveFromToken, fromLivePrice);
  const balanceRef = useRef(fromBalance);
  balanceRef.current = fromBalance;

  const run = useCallback(async (runOp: ZionOp, followUp: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setBuffer("");
    setStreaming(true);

    const useAutoScan = autoScan && (runOp === "trading" || runOp === "arbitrage");
    const params = new URLSearchParams({
      op:       followUp ? "ask" : runOp,
      chain:    effectiveChain,
      fromAddr: useAutoScan ? "" : (effectiveFromToken?.address ?? ""),
      toAddr:   useAutoScan ? "" : (effectiveToToken?.address   ?? ""),
      amountIn: amountInRef.current ?? "1.0",
    });
    if (followUp)              params.set("message",   followUp);
    if (runOp === "arbitrage") params.set("minSpread", arbMinSpread);
    if (runOp === "sniper")    params.set("maxAge",    snipeMaxAge);
    if (runOp === "futures") {
      params.set("leverage",    futuresLeverage);
      params.set("futuresDir",  futuresDir);
    }
    params.set("lang", lang);

    // Forward the live wallet balance so the server can size proposals to
    // what the user can actually afford. "unknown" = wallet not connected /
    // balance not yet loaded, which tells the model to fall back to generic
    // sizing instead of fabricating numbers.
    const bal = balanceRef.current;
    if (bal && !bal.loading && !bal.error) {
      params.set("fromBalance",    bal.formatted);
      if (bal.usdValue !== null && Number.isFinite(bal.usdValue)) {
        params.set("fromBalanceUsd", String(bal.usdValue));
      }
    }

    try {
      const res = await fetch(`/api/zion?${params.toString()}`, { signal: ctrl.signal });
      if (!res.ok || !res.body) {
        if (res.status === 429) {
          const retry = res.headers.get("Retry-After") ?? "60";
          setBuffer(`[${t("common.rateLimit")}]\n\n${t("zion.rateLimit", { seconds: retry })}`);
        } else if (res.status === 400) {
          const body = await res.text().catch(() => "");
          setBuffer(`[${body || res.statusText}]\n\n${t("zion.badRequest")}`);
        } else if (res.status === 503) {
          const body = await res.text().catch(() => "");
          setBuffer(`[${t("zion.notConfigured")}]\n\n${body || t("zion.notConfiguredHint")}`);
        } else {
          setBuffer(`[ZION ${t("common.offline")}: ${res.status} ${res.statusText}]\n\n${t("zion.serverError")}`);
        }
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setBuffer(acc);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setBuffer((s) => s + `\n\n[${t("zion.streamInterrupted")}]`);
      }
    } finally {
      setStreaming(false);
    }
  }, [autoScan, effectiveChain, effectiveFromToken?.address, effectiveToToken?.address, arbMinSpread, snipeMaxAge, lang, t]);

  // Auto-run when drawer opens or op changes.
  useEffect(() => {
    if (!zionOpen) {
      abortRef.current?.abort();
      return;
    }
    setQuestion("");
    run(op, "");
    return () => abortRef.current?.abort();
  }, [zionOpen, op, run]);

  // For trading/pair, re-run when the EFFECTIVE pair changes.
  useEffect(() => {
    if (!zionOpen) return;
    if (op !== "trading" && op !== "pair") return;
    if (autoScan) return;
    run(op, "");
    // Intentionally only re-fires on pair-symbol changes — run() is stable
    // enough that we don't want every filter change to re-trigger this path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFromToken?.symbol, effectiveToToken?.symbol]);

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    run(op, q);
  };

  const parsed = useMemo(() => parseZionStream(buffer), [buffer]);
  const opMeta = OPS.find((o) => o.id === op)!;

  // Stream stage — derived from buffer content to drive a clean progress UI
  // in place of the raw terminal trace.
  const streamStage: "idle" | "preparing" | "thinking" | "rendering" | "complete" = (() => {
    if (!streaming && parsed.cards.length > 0) return "complete";
    if (!streaming && !buffer)                  return "idle";
    if (!streaming)                             return "complete";
    if (!buffer)                                return "preparing";
    if (parsed.cards.length > 0 || parsed.inProgress) return "rendering";
    return "thinking";
  })();

  const onResetPair = () => {
    setPairOverrideFrom(null);
    setPairOverrideTo(null);
  };

  const handleAutoScanToggle = () => {
    const next = !autoScan;
    if (next) {
      setPairOverrideFrom(null);
      setPairOverrideTo(null);
    }
    setAutoScan(next);
  };

  const handleModeChange = (next: ZionOp) => {
    if (next === "sniper") {
      setPairOverrideFrom(null);
      setPairOverrideTo(null);
    }
    setOp(next);
  };

  const showPairSelector = op !== "sniper";

  return (
    <Dialog.Root open={zionOpen} onOpenChange={setZion}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] outline-none">
          <Dialog.Title className="sr-only">ZION AI Advisory</Dialog.Title>
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="god-card h-full glass-strong border-l border-white/10 flex flex-col"
          >
            {/* Header */}
            <span className="tier-godline flex-shrink-0" aria-hidden />
            <div className="h-16 flex items-center justify-between px-5 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="relative w-9 h-9">
                  <div className="absolute inset-0 rounded-xl bg-gold/30 blur-md animate-pulse-glow" />
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-gold to-gold-dim flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-bg" />
                  </div>
                </div>
                <div>
                  <div className="font-display font-bold text-sm text-ink leading-none flex items-center gap-1.5">
                    ZION
                    {tierActive && isPaidTier(activeTier) && (
                      <span
                        className="font-mono text-[8px] tracking-[0.25em] uppercase px-1.5 py-0.5 rounded border"
                        style={{ color: "var(--tier-accent)", borderColor: "color-mix(in srgb, var(--tier-accent) 40%, transparent)" }}
                        title={GOD_META[activeTier].epithet}
                      >
                        {GOD_META[activeTier].rune} {GOD_META[activeTier].god}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[9px] text-gold/70 tracking-widest uppercase mt-1">
                    {t("zion.drawerSubtitle", { state: streaming ? t("zion.thinking") : t(opMeta.labelKey).toLowerCase() })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => run(op, "")}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-gold hover:bg-gold/5 disabled:opacity-40"
                  title={t("zion.rerun")}
                  disabled={streaming}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", streaming && "animate-spin")} />
                </button>
                <Dialog.Close asChild>
                  <button className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            {/* Op tabs */}
            <div className="px-5 pt-3 flex-shrink-0">
              <div className="grid grid-cols-4 gap-0.5 p-0.5 rounded-xl bg-white/[0.03] border border-white/5">
                {OPS.map((o) => {
                  const active = op === o.id;
                  const Icon = o.Icon;
                  return (
                    <button
                      key={o.id}
                      onClick={() => handleModeChange(o.id)}
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase transition-all min-w-0",
                        active
                          ? "bg-gold/15 text-gold border border-gold/30"
                          : "text-ink-3 hover:text-ink-2 border border-transparent",
                      )}
                    >
                      <Icon className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{t(o.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="font-mono text-[9px] text-ink-4 tracking-wide mt-1.5 text-center truncate">
                {t(opMeta.taglineKey)}
              </div>
            </div>

            {/* Mode-specific context */}
            <div className="px-5 pt-3 flex-shrink-0">
              {showPairSelector && (
                <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3 space-y-2">
                  {/* Auto-scan toggle — trading + arb only */}
                  {(op === "trading" || op === "arbitrage") && (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
                          {t("zion.autoScan")}
                        </div>
                        {autoScan && (
                          <div className="font-mono text-[9px] text-cyan/70 mt-0.5 normal-case tracking-normal leading-relaxed">
                            {t("zion.autoScanHint")}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleAutoScanToggle}
                        aria-pressed={autoScan}
                        aria-label={t("zion.autoScan")}
                        className={cn(
                          "relative flex-shrink-0 h-5 w-9 rounded-full border transition-colors mt-0.5",
                          autoScan ? "bg-cyan/20 border-cyan/40" : "bg-white/[0.08] border-white/10",
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full transition-all",
                          autoScan ? "left-[18px] bg-cyan" : "left-0.5 bg-white/40",
                        )} />
                      </button>
                    </div>
                  )}
                  {!autoScan && (
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
                        {t("zion.overridePair")}
                      </div>
                      {hasOverride && (
                        <button
                          type="button"
                          onClick={onResetPair}
                          className="inline-flex items-center gap-1 font-mono text-[9px] text-cyan/80 hover:text-cyan tracking-widest uppercase"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          {t("zion.overrideReset")}
                        </button>
                      )}
                    </div>
                  )}
                  <div className={cn("flex items-center gap-1.5", autoScan && "opacity-40 pointer-events-none")}>
                    <div className="flex-1 min-w-0">
                      <TokenSelector
                        value={effectiveFromToken}
                        onChange={(tk) => setPairOverrideFrom(tk)}
                        side="from"
                      />
                    </div>
                    <span className="text-ink-3 text-xs flex-shrink-0">→</span>
                    <div className="flex-1 min-w-0">
                      <TokenSelector
                        value={effectiveToToken}
                        onChange={(tk) => setPairOverrideTo(tk)}
                        side="to"
                      />
                    </div>
                  </div>
                  {!autoScan && (
                    <div className="font-mono text-[9px] text-ink-4 tracking-wider uppercase text-right">
                      {effectiveChain}
                    </div>
                  )}
                </div>
              )}

              {op === "arbitrage" && (
                <div className="rounded-xl border border-violet/15 bg-violet/[0.04] p-3 space-y-2">
                  <div className="font-mono text-[9px] text-violet tracking-widest uppercase">
                    {t("zion.arbMinSpread")}
                  </div>
                  <div className="flex gap-1">
                    {["0.3", "0.5", "1.0", "2.0"].map((s) => (
                      <button
                        key={s}
                        onClick={() => setArbMinSpread(s)}
                        disabled={streaming}
                        className={cn(
                          "flex-1 py-1.5 rounded-md font-mono text-[10px] tracking-wider transition-colors",
                          arbMinSpread === s
                            ? "bg-violet/20 text-violet border border-violet/40"
                            : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                        )}
                      >
                        {s}%
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {op === "sniper" && (
                <div className="rounded-xl border border-gold/15 bg-gold/[0.04] p-3 space-y-2">
                  <div className="font-mono text-[9px] text-gold tracking-widest uppercase">
                    {t("zion.sniperAge")}
                  </div>
                  <div className="flex gap-1">
                    {(["1h", "6h", "24h", "7d"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setSnipeMaxAge(s)}
                        disabled={streaming}
                        className={cn(
                          "flex-1 py-1.5 rounded-md font-mono text-[10px] tracking-wider transition-colors",
                          snipeMaxAge === s
                            ? "bg-gold/20 text-gold border border-gold/40"
                            : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                        )}
                      >
                        ≤{s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {/* Streaming / empty / complete indicator
                  We no longer dump the raw terminal trace by default — the
                  cards ARE the deliverable. A small expandable section lets
                  power users still see the underlying analysis text if they
                  want context. */}
              {streamStage !== "complete" && (
                <StreamIndicator
                  stage={streamStage}
                  hasBuffer={!!buffer}
                  cardsCount={parsed.cards.length}
                  t={t}
                />
              )}

              {/* Action cards */}
              {parsed.cards.length > 0 && (
                <div className="space-y-2">
                  <div className="font-mono text-[10px] text-cyan tracking-widest uppercase">
                    {parsed.cards.length === 1
                      ? t("zion.proposalsSingular")
                      : t("zion.proposalsPlural", { n: parsed.cards.length })}
                  </div>
                  {/* Autopilot banner — picks the next eligible card and runs
                      a cancel-able countdown before firing it through the
                      CEX API. Hidden when autopilot is OFF or nothing
                      matches the rails. */}
                  <AutopilotPilot cards={parsed.cards} />
                  {/* Auto-rebalance banner — sibling pilot for `rebalance`
                      cards (CEX→wallet withdrawal). Independent opt-in toggle
                      in settings, hidden when off or no rebalance card pending. */}
                  <RebalancePilot cards={parsed.cards} />
                  <AnimatePresence initial={false}>
                    {parsed.cards.map((c, i) => (
                      <ActionCardView key={i} card={c} index={i} onExecute={setExecuting} />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* "Show analysis text" expandable section — collapsed by default.
                  Hidden until there's actually something to show. */}
              {parsed.visible && (
                <details
                  className="rounded-xl border border-white/5 bg-bg-1/30 overflow-hidden"
                  open={showDetails}
                  onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer list-none px-3 py-2 flex items-center gap-2 font-mono text-[10px] text-ink-3 hover:text-ink-2 tracking-widest uppercase">
                    {showDetails
                      ? <ChevronUp   className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />}
                    {showDetails ? t("zion.hideDetails") : t("zion.showDetails")}
                  </summary>
                  <div className="px-4 pb-4 pt-1 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap text-ink-3 border-t border-white/5">
                    {parsed.visible}
                  </div>
                </details>
              )}
            </div>

            {/* Input bar */}
            <form onSubmit={onAsk} className="border-t border-white/5 p-4 flex-shrink-0">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 focus-within:border-gold/30">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={streaming
                    ? t("zion.askWhileThinking")
                    : t("zion.askPlaceholder", { mode: t(opMeta.labelKey).toLowerCase() })}
                  disabled={streaming}
                  className="flex-1 min-w-0 bg-transparent outline-none text-sm font-sans text-ink placeholder:text-ink-4 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={streaming || !question.trim()}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-gold hover:bg-gold/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="font-mono text-[9px] text-ink-4 mt-2 text-center">
                {t("zion.proposes")}
              </p>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>

      <ZionExecuteRouter card={executing} onClose={() => setExecuting(null)} />
    </Dialog.Root>
  );
}

// ─── Stream stage indicator ──────────────────────────────────────────────

function StreamIndicator({
  stage, hasBuffer, cardsCount, t,
}: {
  stage:      "idle" | "preparing" | "thinking" | "rendering" | "complete";
  hasBuffer:  boolean;
  cardsCount: number;
  t:          (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  void hasBuffer;
  void cardsCount;

  if (stage === "idle") {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-1/30 p-6 text-center">
        <Sparkle className="w-5 h-5 text-gold/40 mx-auto mb-2" />
        <p className="font-mono text-[11px] text-ink-3">{t("zion.noCardsYet")}</p>
      </div>
    );
  }

  const labelByStage: Record<"preparing" | "thinking" | "rendering" | "complete", string> = {
    preparing:  t("zion.streamPreparing"),
    thinking:   t("zion.streamThinking"),
    rendering:  t("zion.streamRendering"),
    complete:   t("zion.streamComplete"),
  };

  return (
    <div className="rounded-xl border border-gold/20 bg-gold/[0.04] p-4 flex items-center gap-3">
      <Loader2 className="w-4 h-4 text-gold animate-spin flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-display font-bold text-xs text-gold">
          {labelByStage[stage]}
        </div>
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed mt-0.5">
          {t("zion.noCardsExplain")}
        </p>
      </div>
    </div>
  );
}
