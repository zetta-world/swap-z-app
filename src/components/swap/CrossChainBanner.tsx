"use client";

import { Globe, Clock, Fuel, Workflow } from "lucide-react";
import type { NormalizedQuote } from "@/lib/api/quote-types";
import type { Token } from "@/lib/tokens";
import { CHAIN_BY_ID } from "@/lib/chains";
import { formatAmount } from "@/lib/format";

/**
 * Compact ticker between the From/To boxes that surfaces the cross-chain
 * exchange rate, total processing time, and bridge route — the three things
 * a user has to scan before they trust a cross-chain quote.
 */
export default function CrossChainBanner({
  quote, fromToken, toToken,
}: {
  quote:     NormalizedQuote;
  fromToken: Token;
  toToken:   Token;
}) {
  const sellDec = Number(quote.sellAmount) / Math.pow(10, fromToken.decimals);
  const buyDec  = Number(quote.buyAmount)  / Math.pow(10, toToken.decimals);
  const rate    = sellDec > 0 ? buyDec / sellDec : 0;

  const durationLabel = quote.durationSec < 60
    ? `~${quote.durationSec}s`
    : quote.durationSec < 3600
      ? `~${Math.round(quote.durationSec / 60)}min`
      : `~${Math.round(quote.durationSec / 3600)}h`;

  const fromChainShort = CHAIN_BY_ID[fromToken.chain]?.short ?? fromToken.chain;
  const toChainShort   = CHAIN_BY_ID[toToken.chain]?.short   ?? toToken.chain;

  return (
    <div className="relative rounded-xl border border-violet/20 bg-gradient-to-r from-violet/[0.05] via-cyan/[0.03] to-violet/[0.05] overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-40">
        <div className="absolute top-0 left-0 h-px w-1/2 bg-gradient-to-r from-transparent via-violet/60 to-transparent animate-pulse" />
      </div>
      <div className="relative p-3 space-y-2">
        {/* Rate line */}
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-3.5 h-3.5 text-violet flex-shrink-0" />
          <span className="font-mono text-[10px] text-violet/80 tracking-widest uppercase flex-shrink-0">
            {fromChainShort} → {toChainShort}
          </span>
          <span className="ml-auto font-mono text-[11px] text-ink tabular-nums truncate min-w-0">
            1 {fromToken.symbol} = {formatAmount(rate, 6)} {toToken.symbol}
          </span>
        </div>
        {/* Stats line */}
        <div className="flex items-center gap-3 font-mono text-[10px] text-ink-3 flex-wrap">
          <span className="flex items-center gap-1">
            <Workflow className="w-2.5 h-2.5" />
            via <span className="text-ink-2">{quote.label.replace(/^LiFi\s·\s/, "")}</span>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {durationLabel}
          </span>
          {quote.gasUsd !== undefined && quote.gasUsd > 0 && (
            <span className="flex items-center gap-1">
              <Fuel className="w-2.5 h-2.5" />
              ~${quote.gasUsd.toFixed(2)} gas
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
