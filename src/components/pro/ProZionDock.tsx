"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, ChevronLeft, RefreshCw, ExternalLink } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { parseZionStream, type ActionCard } from "@/lib/zion/parse";
import { cn } from "@/lib/cn";

interface Props {
  /** Internal chain id that the pair lives on (ethereum, bsc, ...). */
  chain:        string;
  fromSymbol:   string;
  toSymbol:     string;
  /** Current spot for the pair, used as amount_in scaler in the prompt. */
  midPrice:     number;
}

/**
 * Compact ZION analysis dock for the Pro Terminal. Sits on the right edge
 * of the workspace; collapsed by default to a thin vertical strip so it
 * doesn't fight the chart for screen real-estate. Expand → ZION runs a
 * TRADING analysis for the current pair and surfaces only the action
 * cards (no raw terminal prose).
 *
 * Pro UX choices:
 *   - Manual run, not auto-stream on every pair switch. Pros don't want
 *     network noise every time they cycle the watchlist. A "Run" button
 *     and a "Refresh" affordance keep them in control.
 *   - Sentiment chip on the COLLAPSED strip — once a run completes the
 *     strip color reflects the strongest action's `risk`, giving a
 *     glanceable bias without having to open the panel.
 *   - "Open full drawer" link drops out to the global ZION drawer for
 *     follow-up Q&A.
 */
export default function ProZionDock({ chain, fromSymbol, toSymbol, midPrice }: Props) {
  const { setZion } = useUI();
  const [expanded, setExpanded] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [buffer,    setBuffer]    = useState("");
  const [hasRun,    setHasRun]    = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset on pair change so the user doesn't see stale analysis for the
  // wrong token. Doesn't auto-run — manual control is more pro.
  useEffect(() => {
    setBuffer("");
    setHasRun(false);
    abortRef.current?.abort();
  }, [chain, fromSymbol, toSymbol]);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBuffer("");
    setStreaming(true);
    setHasRun(true);

    const params = new URLSearchParams({
      op:       "trading",
      chain,
      fromAddr: fromSymbol,
      toAddr:   toSymbol,
      amountIn: midPrice > 0 ? "1.0" : "1.0",
      lang:     "en",
    });
    try {
      const res = await fetch(`/api/zion?${params.toString()}`, { signal: ctrl.signal });
      if (!res.ok || !res.body) {
        setBuffer(`[ZION offline · ${res.status}]`);
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
        setBuffer((s) => s + "\n[stream interrupted]");
      }
    } finally {
      setStreaming(false);
    }
  }, [chain, fromSymbol, toSymbol, midPrice]);

  const parsed = useMemo(() => parseZionStream(buffer), [buffer]);
  const topCards = useMemo(() => parsed.cards.slice(0, 4), [parsed.cards]);
  const sentiment = inferSentiment(topCards);

  return (
    <div className={cn(
      "rounded-lg border bg-black/40 flex flex-col transition-all duration-200",
      expanded ? "w-full lg:w-[320px] border-gold/20" : "w-full lg:w-[44px] border-white/5",
    )}>
      {/* Strip header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-2 py-2 border-b border-white/5 hover:bg-white/[0.03]",
          expanded ? "justify-between" : "justify-center",
        )}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className={cn(
            "w-5 h-5 rounded flex items-center justify-center flex-shrink-0",
            sentiment.dot,
          )}>
            <Sparkles className="w-3 h-3 text-bg" />
          </span>
          {expanded && (
            <span className="font-display font-bold text-xs text-gold truncate">ZION</span>
          )}
        </span>
        {expanded
          ? <ChevronRight className="w-3.5 h-3.5 text-ink-3" />
          : <ChevronLeft  className="w-3.5 h-3.5 text-ink-3" />}
      </button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{    opacity: 0, height: 0 }}
            className="flex flex-col"
          >
            <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
              <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase truncate flex-1">
                {fromSymbol} / {toSymbol}
              </span>
              <button
                type="button"
                onClick={run}
                disabled={streaming}
                className={cn(
                  "px-2 py-1 rounded font-mono text-[9px] tracking-widest uppercase inline-flex items-center gap-1",
                  streaming
                    ? "bg-white/5 text-ink-4 cursor-wait"
                    : "bg-gold/15 text-gold hover:bg-gold/25",
                )}
              >
                <RefreshCw className={cn("w-2.5 h-2.5", streaming && "animate-spin")} />
                {streaming ? "running" : hasRun ? "rerun" : "run"}
              </button>
            </div>

            <div className="px-3 py-3 flex-1 max-h-[420px] overflow-y-auto">
              {!hasRun && !streaming && (
                <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
                  Press <span className="text-gold">Run</span> to analyze this pair.
                  Cards appear here; full Q&A still lives in the main drawer.
                </p>
              )}
              {streaming && topCards.length === 0 && (
                <p className="font-mono text-[10px] text-ink-3 animate-pulse">
                  ZION is analyzing this pool…
                </p>
              )}
              {topCards.length > 0 && (
                <div className="space-y-2">
                  {topCards.map((c, i) => (
                    <CompactCard key={i} card={c} />
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setZion(true)}
              className="px-3 py-2 border-t border-white/5 font-mono text-[10px] text-cyan/80 hover:text-cyan tracking-widest uppercase inline-flex items-center justify-center gap-1.5"
            >
              Open full drawer <ExternalLink className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Compact card (no execute button — pro dock is informational, the
//     full drawer handles execution + follow-up) ──────────────────────

function CompactCard({ card }: { card: ActionCard }) {
  const kind = card.kind.replace(/_/g, " ");
  const tone =
    card.kind === "stop_loss"           ? "border-red/30   text-red"   :
    card.kind === "sell_safe"           ? "border-green/30 text-green" :
    card.kind === "sell_medium"         ? "border-gold/30  text-gold"  :
    card.kind === "sell_aggressive"     ? "border-violet/30 text-violet" :
    card.kind.startsWith("arbitrage")   ? "border-violet/30 text-violet" :
                                          "border-cyan/30  text-cyan";

  const prob = card.probability ? parseProb(card.probability) : null;

  return (
    <div className="rounded-md border bg-white/[0.02] p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className={cn("font-mono text-[9px] tracking-widest uppercase font-bold truncate border px-1 py-0.5 rounded", tone)}>
          {kind}
        </span>
        {prob !== null && (
          <span className={cn(
            "font-mono text-[9px] tracking-widest uppercase",
            prob >= 65 ? "text-green" : prob >= 40 ? "text-gold" : "text-red",
          )}>
            {prob}%
          </span>
        )}
      </div>
      <div className="font-display font-bold text-[11px] text-ink leading-snug break-words">
        {card.title}
      </div>
      <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
        {card.entryPrice && (
          <div>
            <span className="text-ink-4 tracking-widest uppercase">Entry</span>
            <div className="text-cyan tabular-nums">{card.entryPrice}</div>
          </div>
        )}
        {card.stopLoss && (
          <div>
            <span className="text-ink-4 tracking-widest uppercase">Stop</span>
            <div className="text-red tabular-nums">{card.stopLoss}</div>
          </div>
        )}
        {card.expectedProfitPct && (
          <div>
            <span className="text-ink-4 tracking-widest uppercase">Target</span>
            <div className="text-green tabular-nums">{card.expectedProfitPct}</div>
          </div>
        )}
        {card.riskReward && (
          <div>
            <span className="text-ink-4 tracking-widest uppercase">R/R</span>
            <div className="text-violet tabular-nums">{card.riskReward}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseProb(raw: string): number | null {
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (n > 0 && n <= 1) n *= 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function inferSentiment(cards: ActionCard[]): { dot: string } {
  if (cards.length === 0) return { dot: "bg-gradient-to-br from-gold to-gold-dim" };
  // Take the strongest buy/sell card we got and color the dot accordingly.
  const hasBuy  = cards.some((c) => c.kind === "swap" || c.kind === "buy_limit");
  const hasSell = cards.some((c) => c.kind.startsWith("sell"));
  if (hasBuy && !hasSell)  return { dot: "bg-gradient-to-br from-green to-cyan" };
  if (hasSell && !hasBuy)  return { dot: "bg-gradient-to-br from-red to-gold" };
  return { dot: "bg-gradient-to-br from-gold to-gold-dim" };
}
