"use client";

import { useMemo } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Users } from "lucide-react";
import type { Trade } from "@/lib/api/geckoterminal";
import { compactNumber } from "@/lib/format";

/**
 * Aggregate buy/sell pressure across the loaded trade window. Mirrors a
 * CEX "taker buy ratio" stat but for the on-chain feed — a pro signal
 * for who's in control right now. Also surfaces unique wallet count as
 * a quick proxy for breadth vs concentration.
 */
export default function ProFlow({ trades }: { trades: Trade[] }) {
  const flow = useMemo(() => {
    let buyUsd  = 0;
    let sellUsd = 0;
    const buyers  = new Set<string>();
    const sellers = new Set<string>();
    for (const t of trades) {
      const v = t.sizeUsd || (t.priceUsd * (t.kind === "buy" ? t.amountOut : t.amountIn));
      if (t.kind === "buy") { buyUsd  += v; if (t.trader) buyers.add(t.trader); }
      else                  { sellUsd += v; if (t.trader) sellers.add(t.trader); }
    }
    const total = buyUsd + sellUsd;
    const buyPct = total > 0 ? (buyUsd / total) * 100 : 50;
    return { buyUsd, sellUsd, total, buyPct, buyers: buyers.size, sellers: sellers.size };
  }, [trades]);

  const dominant: "buy" | "sell" | "flat" =
    flow.total === 0 ? "flat" :
    flow.buyPct >= 60 ? "buy"  :
    flow.buyPct <= 40 ? "sell" : "flat";

  const verdict =
    dominant === "buy"  ? "Buyers leading" :
    dominant === "sell" ? "Sellers leading" :
                          "Balanced flow";

  const verdictCls =
    dominant === "buy"  ? "text-green" :
    dominant === "sell" ? "text-red"   :
                          "text-ink-2";

  return (
    <div className="rounded-lg border border-white/5 bg-black/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase inline-flex items-center gap-1.5">
          <Users className="w-3 h-3 text-gold" />
          Order flow
        </span>
        <span className={`font-mono text-[10px] tracking-widest uppercase ${verdictCls}`}>
          {verdict}
        </span>
      </div>

      <div className="px-3 py-3 space-y-2.5">
        {/* Bar */}
        <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.04]">
          <div
            className="bg-green transition-all duration-500"
            style={{ width: `${flow.buyPct}%` }}
            title={`${flow.buyPct.toFixed(1)}% buy`}
          />
          <div
            className="bg-red transition-all duration-500"
            style={{ width: `${100 - flow.buyPct}%` }}
            title={`${(100 - flow.buyPct).toFixed(1)}% sell`}
          />
        </div>

        {/* USD legend */}
        <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
          <div className="text-left">
            <div className="text-ink-3 tracking-widest uppercase inline-flex items-center gap-1">
              <ArrowDownToLine className="w-2.5 h-2.5 text-green" /> Buy
            </div>
            <div className="text-green tabular-nums text-sm font-display font-bold mt-0.5">
              ${compactNumber(flow.buyUsd)}
            </div>
            <div className="text-ink-4 mt-0.5">
              {flow.buyers} wallet{flow.buyers === 1 ? "" : "s"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-ink-3 tracking-widest uppercase inline-flex items-center gap-1 justify-end w-full">
              Sell <ArrowUpFromLine className="w-2.5 h-2.5 text-red" />
            </div>
            <div className="text-red tabular-nums text-sm font-display font-bold mt-0.5">
              ${compactNumber(flow.sellUsd)}
            </div>
            <div className="text-ink-4 mt-0.5">
              {flow.sellers} wallet{flow.sellers === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
