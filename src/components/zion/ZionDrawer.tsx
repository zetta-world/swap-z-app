"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import {
  Sparkles, X, Send, Zap, RefreshCw, TrendingUp, Globe, Crosshair, FileText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import ActionCardView from "./ActionCardView";
import ZionExecuteRouter from "./ZionExecuteRouter";
import type { ZionOp } from "@/lib/zion/mode-prompts";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const OPS: { id: ZionOp; labelKey: MessageKey; taglineKey: MessageKey; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "trading",   labelKey: "zion.tabTrading", taglineKey: "zion.taglineTrading", Icon: TrendingUp },
  { id: "arbitrage", labelKey: "zion.tabArb",     taglineKey: "zion.taglineArb",     Icon: Globe      },
  { id: "sniper",    labelKey: "zion.tabSniper",  taglineKey: "zion.taglineSniper",  Icon: Crosshair  },
  { id: "pair",      labelKey: "zion.tabDeep",    taglineKey: "zion.taglineDeep",    Icon: FileText   },
];

export default function ZionDrawer() {
  const { zionOpen, setZion, lang } = useUI();
  const { fromToken, toToken, fromChain, amountIn } = useSwap();
  const t = useT();

  const [op, setOp] = useState<ZionOp>("trading");
  const [buffer, setBuffer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [question, setQuestion] = useState("");
  const [executing, setExecuting] = useState<ActionCard | null>(null);

  // Arb-mode filters
  const [arbMinSpread, setArbMinSpread] = useState("0.5");
  // Sniper-mode filters
  const [snipeMaxAge,  setSnipeMaxAge]  = useState<"1h" | "6h" | "24h" | "7d">("24h");

  const abortRef  = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (runOp: ZionOp, followUp: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setBuffer("");
    setStreaming(true);

    const params = new URLSearchParams({
      op:       followUp ? "ask" : runOp,
      chain:    fromChain,
      fromAddr: fromToken?.address ?? "",
      toAddr:   toToken?.address   ?? "",
      amountIn: amountIn ?? "1.0",
    });
    if (followUp)            params.set("message", followUp);
    if (runOp === "arbitrage") params.set("minSpread", arbMinSpread);
    if (runOp === "sniper")    params.set("maxAge",    snipeMaxAge);
    // Forward UI language so the server prompt tells Claude which idiom to reply in
    params.set("lang", lang);

    try {
      const res = await fetch(`/api/zion?${params.toString()}`, { signal: ctrl.signal });
      if (!res.ok || !res.body) {
        if (res.status === 429) {
          const retry = res.headers.get("Retry-After") ?? "60";
          setBuffer(`[${t("common.rateLimit")}]\n\n${t("zion.rateLimit", { seconds: retry })}`);
        } else if (res.status === 400) {
          const body = await res.text().catch(() => "");
          setBuffer(`[${body || res.statusText}]\n\n${t("zion.badRequest")}`);
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
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        });
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setBuffer((s) => s + `\n\n[${t("zion.streamInterrupted")}]`);
      }
    } finally {
      setStreaming(false);
    }
  }, [fromChain, fromToken?.address, toToken?.address, amountIn, arbMinSpread, snipeMaxAge, lang, t]);

  // Auto-run when drawer opens or op changes (except for pair changes —
  // those trigger inside trading/pair, but not arbitrage/sniper).
  useEffect(() => {
    if (!zionOpen) {
      abortRef.current?.abort();
      return;
    }
    setQuestion("");
    run(op, "");
    return () => abortRef.current?.abort();
  }, [zionOpen, op, run]);

  // For trading/pair, re-run when the user changes their selected pair
  useEffect(() => {
    if (!zionOpen) return;
    if (op !== "trading" && op !== "pair") return;
    run(op, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken?.symbol, toToken?.symbol]);

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    run(op, q);
  };

  const parsed = useMemo(() => parseZionStream(buffer), [buffer]);
  const opMeta = OPS.find((o) => o.id === op)!;

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
            className="h-full glass-strong border-l border-white/10 flex flex-col"
          >
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-5 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="relative w-9 h-9">
                  <div className="absolute inset-0 rounded-xl bg-gold/30 blur-md animate-pulse-glow" />
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-gold to-gold-dim flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-bg" />
                  </div>
                </div>
                <div>
                  <div className="font-display font-bold text-sm text-ink leading-none">ZION</div>
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
                      onClick={() => setOp(o.id)}
                      disabled={streaming}
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase transition-all disabled:opacity-50 min-w-0",
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
              {(op === "trading" || op === "pair") && (
                <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3">
                  <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">
                    {t("zion.contextAnalyzing")}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="font-display font-bold text-sm text-ink truncate">
                      {fromToken?.symbol ?? "—"}{" "}
                      <span className="text-ink-3 mx-1">→</span>{" "}
                      {toToken?.symbol ?? "—"}
                    </div>
                    <span className="font-mono text-[9px] text-ink-3 tracking-wider uppercase">{fromChain}</span>
                  </div>
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
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {/* Terminal */}
              <div className="rounded-xl border border-gold/15 bg-black/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
                  <span className="w-2 h-2 rounded-full bg-red/60" />
                  <span className="w-2 h-2 rounded-full bg-gold/60" />
                  <span className="w-2 h-2 rounded-full bg-green/60" />
                  <span className="ml-2 font-mono text-[10px] text-ink-3 tracking-wider">
                    {t("zion.terminal", { label: t(opMeta.labelKey).toLowerCase() })}
                  </span>
                  <div className="flex-1" />
                  <span className="flex items-center gap-1 font-mono text-[9px] text-gold/70 tracking-widest uppercase">
                    <Zap className="w-2.5 h-2.5" /> {streaming ? t("zion.streamingState") : t("zion.idle")}
                  </span>
                </div>
                <div className="p-4 font-mono text-[11px] sm:text-xs leading-[1.75] whitespace-pre-wrap min-h-[220px] text-ink-2">
                  {parsed.visible || (streaming ? "" : t("zion.awaitingAnalysis"))}
                  {streaming && <span className="term-cursor" />}
                </div>
              </div>

              {/* Action cards */}
              {parsed.cards.length > 0 && (
                <div className="space-y-2">
                  <div className="font-mono text-[10px] text-cyan tracking-widest uppercase">
                    {parsed.cards.length === 1
                      ? t("zion.proposalsSingular")
                      : t("zion.proposalsPlural", { n: parsed.cards.length })}
                  </div>
                  {parsed.cards.map((c, i) => (
                    <ActionCardView key={i} card={c} index={i} onExecute={setExecuting} />
                  ))}
                </div>
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
