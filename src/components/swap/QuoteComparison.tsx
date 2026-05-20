"use client";

import { motion } from "framer-motion";
import { Check, Clock, Globe, Zap, Sparkles } from "lucide-react";
import type { NormalizedQuote, QuoteSource } from "@/lib/api/quote-types";
import type { Token } from "@/lib/tokens";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Props {
  quotes:        NormalizedQuote[];
  selected:      QuoteSource | null;
  onSelect:      (source: QuoteSource) => void;
  toToken:       Token | undefined;
  loading?:      boolean;
  error?:        string | null;
}

const SOURCE_META: Record<QuoteSource, { label: string; color: string; tagline: string }> = {
  "0x":   { label: "0x Settler",  color: "#00E8FF", tagline: "Same-chain · 100+ DEXs" },
  "lifi": { label: "LiFi Router", color: "#9F5FFF", tagline: "Cross-chain · 30+ bridges" },
};

/**
 * Side-by-side quote comparison panel. Each row is a fully-formed quote
 * from a different aggregator; the user clicks a row to select that
 * source for execution.
 */
export default function QuoteComparison({
  quotes, selected, onSelect, toToken, loading, error,
}: Props) {
  if (loading && quotes.length === 0) {
    return (
      <div className="rounded-xl border border-cyan/15 bg-cyan/[0.03] p-4 flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
        <span className="font-mono text-[11px] text-cyan/80 tracking-widest uppercase">
          Polling aggregators…
        </span>
      </div>
    );
  }

  if (error && quotes.length === 0) {
    return (
      <div className="rounded-xl border border-gold/20 bg-gold/[0.04] p-3">
        <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-1">Quote error</div>
        <p className="font-sans text-xs text-ink-2 leading-relaxed break-words">{error}</p>
      </div>
    );
  }

  if (quotes.length === 0) return null;

  const best = quotes[0];   // rankQuotes already sorted by min buy descending

  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3 h-3 text-cyan" />
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            {quotes.length} {quotes.length === 1 ? "route" : "routes"} · pick the best for you
          </span>
        </div>
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
          {loading ? "refreshing…" : "live"}
        </span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {quotes.map((q, i) => {
          const meta     = SOURCE_META[q.source];
          const isBest   = q === best;
          const isPicked = q.source === selected;
          const buyDec   = toToken
            ? Number(q.buyAmount) / Math.pow(10, toToken.decimals)
            : Number(q.buyAmount);

          const durationLabel = q.durationSec < 60
            ? `~${q.durationSec}s`
            : q.durationSec < 3600
              ? `~${Math.round(q.durationSec / 60)}min`
              : `~${Math.round(q.durationSec / 3600)}h`;

          return (
            <motion.button
              type="button"
              key={q.source + i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onSelect(q.source)}
              className={cn(
                "w-full text-left px-3 py-3 transition-colors min-w-0",
                isPicked ? "bg-cyan/[0.06]" : "hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-start gap-3 min-w-0">
                {/* Pick indicator */}
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5",
                  isPicked ? "border-cyan bg-cyan/20" : "border-white/20",
                )}>
                  {isPicked && <Check className="w-2.5 h-2.5 text-cyan" />}
                </div>

                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-display font-bold text-xs" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                    {q.isCrossChain && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-violet/30 bg-violet/5 text-violet tracking-widest uppercase">
                        <Globe className="w-2.5 h-2.5 inline mr-0.5" />
                        Cross-chain
                      </span>
                    )}
                    {isBest && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-green/30 bg-green/10 text-green tracking-widest uppercase">
                        Best
                      </span>
                    )}
                    {q.isIndicative && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-gold/20 bg-gold/5 text-gold/80 tracking-widest uppercase">
                        Indicative
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-ink-3 truncate">
                    {q.routeSummary}
                  </div>
                </div>

                {/* Output + meta */}
                <div className="text-right flex-shrink-0">
                  <div className="font-display font-bold text-sm text-ink tabular-nums">
                    {formatAmount(buyDec, 6)}
                  </div>
                  <div className="font-mono text-[10px] text-ink-3 truncate max-w-[120px]">
                    {toToken?.symbol ?? ""}
                  </div>
                </div>
              </div>

              {/* Bottom row: gas, time, hops mini */}
              <div className="flex items-center gap-3 mt-2 pl-7 font-mono text-[10px] text-ink-3 flex-wrap">
                {q.gasUsd !== undefined && q.gasUsd > 0 && (
                  <span className="flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" />
                    ~${q.gasUsd.toFixed(2)} gas
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {durationLabel}
                </span>
                {q.hops.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    {q.hops.slice(0, 4).map((h, hi) => (
                      <span
                        key={hi}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: h.color ?? "#00E8FF" }}
                        title={h.protocol}
                      />
                    ))}
                    <span>{q.hops.length} {q.hops.length === 1 ? "hop" : "hops"}</span>
                  </span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
