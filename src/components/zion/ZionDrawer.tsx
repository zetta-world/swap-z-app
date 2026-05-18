"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import { Sparkles, X, Send, Zap, RefreshCw, Scan, MessageSquare, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import ActionCardView from "./ActionCardView";
import ExecuteConfirmModal from "./ExecuteConfirmModal";
import { cn } from "@/lib/cn";

type Mode = "analyze_pair" | "scan_opportunities" | "ask";

const MODE_META: { id: Mode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "analyze_pair",       label: "Pair",          Icon: Search   },
  { id: "scan_opportunities", label: "Opportunities", Icon: Scan     },
  { id: "ask",                label: "Ask",           Icon: MessageSquare },
];

export default function ZionDrawer() {
  const { zionOpen, setZion } = useUI();
  const { fromToken, toToken, fromChain, amountIn } = useSwap();

  const [mode, setMode] = useState<Mode>("analyze_pair");
  const [buffer, setBuffer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [question, setQuestion] = useState("");
  const [executing, setExecuting] = useState<ActionCard | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (runMode: Mode, followUp: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setBuffer("");
    setStreaming(true);

    const params = new URLSearchParams({
      mode:     runMode === "ask" ? "ask" : runMode,
      chain:    fromChain,
      fromAddr: fromToken?.address ?? "",
      toAddr:   toToken?.address   ?? "",
      amountIn: amountIn ?? "1.0",
    });
    if (followUp) params.set("message", followUp);

    try {
      const res = await fetch(`/api/zion?${params.toString()}`, { signal: ctrl.signal });
      if (!res.ok || !res.body) {
        setBuffer(`[ZION offline: ${res.status} ${res.statusText}]`);
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
        setBuffer((s) => s + `\n\n[stream interrupted]`);
      }
    } finally {
      setStreaming(false);
    }
  }, [fromChain, fromToken?.address, toToken?.address, amountIn]);

  // Auto-trigger when drawer opens, mode changes, or pair changes
  useEffect(() => {
    if (!zionOpen) {
      abortRef.current?.abort();
      return;
    }
    setQuestion("");
    if (mode === "ask") {
      // In ask mode, wait for a question
      setBuffer("");
      return;
    }
    run(mode, "");
    return () => abortRef.current?.abort();
  }, [zionOpen, mode, fromToken?.symbol, toToken?.symbol, fromChain, run]);

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    setMode("ask");
    run("ask", q);
  };

  // Parse the rolling buffer into terminal text + cards
  const parsed = useMemo(() => parseZionStream(buffer), [buffer]);

  return (
    <Dialog.Root open={zionOpen} onOpenChange={setZion}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[460px] outline-none">
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
                    Haiku 4.5 · {streaming ? "thinking…" : "ready"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => run(mode, "")}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-gold hover:bg-gold/5 disabled:opacity-40"
                  title="Re-run"
                  disabled={streaming || mode === "ask"}
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

            {/* Mode tabs */}
            <div className="px-5 pt-3 flex-shrink-0">
              <div className="flex gap-0.5 p-0.5 rounded-xl bg-white/[0.03] border border-white/5">
                {MODE_META.map((m) => {
                  const active = mode === m.id;
                  const Icon = m.Icon;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      disabled={streaming}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase transition-all disabled:opacity-50",
                        active
                          ? "bg-gold/15 text-gold border border-gold/30"
                          : "text-ink-3 hover:text-ink-2 border border-transparent",
                      )}
                    >
                      <Icon className="w-3 h-3" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pair context — visible only for analyze_pair and ask */}
            {mode !== "scan_opportunities" && (
              <div className="px-5 pt-3 flex-shrink-0">
                <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3">
                  <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">
                    {mode === "ask" ? "Context" : "Analyzing"}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="font-display font-bold text-sm text-ink">
                      {fromToken?.symbol ?? "—"}{" "}
                      <span className="text-ink-3 mx-1">→</span>{" "}
                      {toToken?.symbol ?? "—"}
                    </div>
                    <span className="font-mono text-[9px] text-ink-3 tracking-wider uppercase">{fromChain}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Body */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {/* Terminal */}
              <div className="rounded-xl border border-gold/15 bg-black/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
                  <span className="w-2 h-2 rounded-full bg-red/60" />
                  <span className="w-2 h-2 rounded-full bg-gold/60" />
                  <span className="w-2 h-2 rounded-full bg-green/60" />
                  <span className="ml-2 font-mono text-[10px] text-ink-3 tracking-wider">
                    ZION · {modeLabel(mode)}
                  </span>
                  <div className="flex-1" />
                  <span className="flex items-center gap-1 font-mono text-[9px] text-gold/70 tracking-widest uppercase">
                    <Zap className="w-2.5 h-2.5" /> {streaming ? "streaming" : "idle"}
                  </span>
                </div>
                <div className="p-4 font-mono text-[11px] sm:text-xs leading-[1.75] whitespace-pre-wrap min-h-[220px] text-ink-2">
                  {parsed.visible || (streaming
                    ? ""
                    : mode === "ask"
                      ? "Ask ZION anything about your current pair, market conditions, or execution timing."
                      : "Awaiting analysis…"
                  )}
                  {streaming && <span className="term-cursor" />}
                </div>
              </div>

              {/* Action cards */}
              {parsed.cards.length > 0 && (
                <div className="space-y-2">
                  <div className="font-mono text-[10px] text-cyan tracking-widest uppercase">
                    {parsed.cards.length === 1 ? "Executable proposal" : `${parsed.cards.length} executable proposals`}
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
                  placeholder={streaming ? "ZION is responding…" : "Ask ZION anything…"}
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
                ZION proposes · you confirm · advisory only
              </p>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>

      <ExecuteConfirmModal card={executing} onClose={() => setExecuting(null)} />
    </Dialog.Root>
  );
}

function modeLabel(m: Mode): string {
  if (m === "analyze_pair")       return "pair analysis";
  if (m === "scan_opportunities") return "opportunity scout";
  return "conversation";
}
