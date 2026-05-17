"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import { Sparkles, X, Send, Zap, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * ZION drawer — connects to /api/zion which streams Claude Haiku 4.5
 * (with prompt caching on the system prompt) over a plain text stream.
 *
 * We re-trigger an analysis whenever the drawer opens or the pair changes.
 * Follow-up questions ("why...?") are sent as message=... and skip re-fetch.
 */
export default function ZionDrawer() {
  const { zionOpen, setZion } = useUI();
  const { fromToken, toToken, fromChain, amountIn } = useSwap();

  const [stream, setStream] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState<{ q: string; a: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (followUp = "") => {
    // Cancel any in-flight stream
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStream("");
    setStreaming(true);

    const params = new URLSearchParams({
      chain:    fromChain,
      fromAddr: fromToken?.address ?? "",
      toAddr:   toToken?.address   ?? "",
      amountIn: amountIn ?? "1.0",
    });
    if (followUp) params.set("message", followUp);

    try {
      const res = await fetch(`/api/zion?${params.toString()}`, { signal: ctrl.signal });
      if (!res.ok || !res.body) {
        setStream(`[ZION offline: ${res.status} ${res.statusText}]`);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setStream(buf);
        // auto-scroll
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        });
      }
      // Push to transcript if this was a follow-up question
      if (followUp) setTranscript((t) => [...t, { q: followUp, a: buf }]);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setStream((s) => s + `\n\n[stream interrupted]`);
      }
    } finally {
      setStreaming(false);
    }
  }, [fromChain, fromToken?.address, toToken?.address, amountIn]);

  // Auto-run on drawer open or pair change
  useEffect(() => {
    if (!zionOpen) {
      abortRef.current?.abort();
      return;
    }
    setTranscript([]);
    setQuestion("");
    run("");
    return () => abortRef.current?.abort();
  }, [zionOpen, fromToken?.symbol, toToken?.symbol, fromChain, run]);

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    run(q);
  };

  return (
    <Dialog.Root open={zionOpen} onOpenChange={setZion}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[440px] outline-none">
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
                    Haiku 4.5 · advisory · {streaming ? "thinking…" : "ready"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => run("")}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-gold hover:bg-gold/5"
                  title="Re-run analysis"
                  disabled={streaming}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${streaming ? "animate-spin" : ""}`} />
                </button>
                <Dialog.Close asChild>
                  <button className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            {/* Pair header */}
            <div className="p-5 pb-3 flex-shrink-0">
              <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3.5">
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">Analyzing</div>
                <div className="flex items-center justify-between">
                  <div className="font-display font-bold text-base text-ink">
                    {fromToken?.symbol ?? "—"} <span className="text-ink-3 mx-1.5">→</span> {toToken?.symbol ?? "—"}
                  </div>
                  <span className="font-mono text-[10px] text-ink-3 tracking-wider uppercase">{fromChain}</span>
                </div>
              </div>
            </div>

            {/* Terminal */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-3">
              <div className="rounded-xl border border-gold/15 bg-black/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02] sticky top-0">
                  <span className="w-2 h-2 rounded-full bg-red/60" />
                  <span className="w-2 h-2 rounded-full bg-gold/60" />
                  <span className="w-2 h-2 rounded-full bg-green/60" />
                  <span className="ml-2 font-mono text-[10px] text-ink-3 tracking-wider">ZION · claude-haiku-4-5</span>
                  <div className="flex-1" />
                  <span className="flex items-center gap-1 font-mono text-[9px] text-gold/70 tracking-widest uppercase">
                    <Zap className="w-2.5 h-2.5" /> {streaming ? "streaming" : "idle"}
                  </span>
                </div>
                <div className="p-4 font-mono text-[11px] sm:text-xs leading-[1.75] whitespace-pre-wrap min-h-[320px] text-ink-2">
                  {stream || (streaming ? "" : "Awaiting analysis…")}
                  {streaming && <span className="term-cursor" />}
                </div>
              </div>

              {/* Past Q&A in transcript */}
              {transcript.length > 0 && (
                <div className="mt-3 space-y-3">
                  {transcript.slice(0, -1).reverse().map((t, i) => (
                    <div key={i} className="rounded-xl border border-white/5 bg-bg-1/40 p-3">
                      <div className="font-mono text-[10px] text-cyan tracking-widest uppercase mb-1.5">Question</div>
                      <div className="font-sans text-xs text-ink-2 mb-2">{t.q}</div>
                      <div className="font-mono text-[10px] text-gold/80 tracking-widest uppercase mb-1.5">ZION</div>
                      <div className="font-mono text-[11px] text-ink-2 leading-relaxed whitespace-pre-wrap">{t.a}</div>
                    </div>
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
                  placeholder={streaming ? "ZION is responding…" : "Ask ZION about this swap…"}
                  disabled={streaming}
                  className="flex-1 bg-transparent outline-none text-sm font-sans text-ink placeholder:text-ink-4 disabled:opacity-50"
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
                ZION operates in advisory mode · execute swaps manually
              </p>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
