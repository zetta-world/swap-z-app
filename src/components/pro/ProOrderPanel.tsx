"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface ProOrderPanelProps {
  pair:        { base: string; quote: string; chain: string };
  lastPrice:   number | null;
  accentColor: string;
}

type Side      = "buy" | "sell";
type OrderType = "market" | "limit" | "stop";
type SizePct   = 25 | 50 | 75 | 100;

const SIZE_PCTS: SizePct[] = [25, 50, 75, 100];

export default function ProOrderPanel({ pair, lastPrice, accentColor }: ProOrderPanelProps) {
  const [side, setSide]             = useState<Side>("buy");
  const [orderType, setOrderType]   = useState<OrderType>("market");
  const [size, setSize]             = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [sizePercent, setSizePercent] = useState<SizePct | null>(null);

  const showLimitInput = orderType === "limit" || orderType === "stop";

  const sizeNum      = parseFloat(size)       || 0;
  const priceNum     = showLimitInput
    ? (parseFloat(limitPrice) || lastPrice || 0)
    : (lastPrice ?? 0);
  const estTotal     = sizeNum > 0 && priceNum > 0 ? sizeNum * priceNum : null;

  const isBuy  = side === "buy";
  const isSell = side === "sell";

  function handlePctClick(pct: SizePct) {
    setSizePercent(pct);
    // Populate size field (placeholder logic — real impl would use wallet balance)
    setSize((pct / 100).toFixed(4));
  }

  return (
    <div className="rounded-xl border bg-black/60 backdrop-blur-sm overflow-hidden"
      style={{ borderColor: `${accentColor}22` }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">Order</span>
        <span className="font-mono text-[9px] text-ink-3">
          {pair.base}/{pair.quote}
        </span>
        {lastPrice !== null && (
          <span className="ml-auto font-mono text-[9px] tabular-nums" style={{ color: accentColor }}>
            ${formatOrderPrice(lastPrice)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        {/* Side toggle */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setSide("buy")}
            aria-pressed={isBuy}
            className={cn(
              "flex-1 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase border transition-all",
              isBuy
                ? "bg-green/15 border-green/40 text-green font-bold"
                : "border-white/10 text-ink-3 hover:border-white/20 hover:text-ink-2",
            )}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            aria-pressed={isSell}
            className={cn(
              "flex-1 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase border transition-all",
              isSell
                ? "bg-red/15 border-red/40 text-red font-bold"
                : "border-white/10 text-ink-3 hover:border-white/20 hover:text-ink-2",
            )}
          >
            Sell
          </button>
        </div>

        {/* Order type */}
        <div className="flex gap-1">
          {(["market", "limit", "stop"] as OrderType[]).map((ot) => (
            <button
              key={ot}
              type="button"
              onClick={() => setOrderType(ot)}
              aria-pressed={orderType === ot}
              className={cn(
                "flex-1 py-1.5 rounded font-mono text-[9px] tracking-widest uppercase border transition-all",
                orderType === ot
                  ? "border-white/20 bg-white/8 text-ink"
                  : "border-white/5 text-ink-3 hover:border-white/10 hover:text-ink-2",
              )}
            >
              {ot}
            </button>
          ))}
        </div>

        {/* Size input */}
        <div>
          <label className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-1">
            Size
          </label>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">$</span>
              <input
                type="number"
                min="0"
                step="any"
                value={size}
                onChange={(e) => { setSize(e.target.value); setSizePercent(null); }}
                placeholder="0.00"
                aria-label="Order size"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-6 pr-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-white/25 transition-colors tabular-nums"
              />
            </div>
            <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase whitespace-nowrap">
              {pair.quote}
            </span>
          </div>

          {/* Percent buttons */}
          <div className="flex gap-1 mt-1.5">
            {SIZE_PCTS.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handlePctClick(pct)}
                aria-pressed={sizePercent === pct}
                className={cn(
                  "flex-1 py-1 rounded font-mono text-[9px] tracking-wider border transition-all",
                  sizePercent === pct
                    ? "border-white/25 bg-white/8 text-ink"
                    : "border-white/5 text-ink-4 hover:border-white/15 hover:text-ink-3",
                )}
              >
                {pct === 100 ? "MAX" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Limit / Stop price (animated) */}
        <AnimatePresence>
          {showLimitInput && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden" }}
            >
              <label className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-1">
                {orderType === "stop" ? "Stop Price" : "Limit Price"}
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">$</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={lastPrice ? formatOrderPrice(lastPrice) : "0.00"}
                  aria-label="Limit price"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-6 pr-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-white/25 transition-colors tabular-nums"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Est. total */}
        <div className="flex items-center justify-between font-mono text-[9px] text-ink-4 tracking-wider">
          <span>Est. total</span>
          <span className="text-ink-2 tabular-nums">
            {estTotal !== null ? `$${estTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </span>
        </div>

        {/* CTA */}
        <button
          type="button"
          className="w-full rounded-lg py-2.5 font-mono text-[10px] font-bold tracking-widest uppercase flex items-center justify-center gap-2 transition-opacity hover:opacity-90 active:scale-[0.98]"
          style={{
            background:  isBuy ? "rgba(0,224,135,0.18)" : "rgba(255,59,92,0.18)",
            border:      `1px solid ${isBuy ? "rgba(0,224,135,0.40)" : "rgba(255,59,92,0.40)"}`,
            color:       isBuy ? "#00E087" : "#FF3B5C",
          }}
        >
          <span>▶ Execute {side === "buy" ? "Buy" : "Sell"}</span>
          <kbd
            className="inline-flex items-center rounded border px-1 py-0.5 font-mono text-[8px] opacity-60"
            style={{ borderColor: isBuy ? "rgba(0,224,135,0.30)" : "rgba(255,59,92,0.30)" }}
          >
            ⌘↵
          </kbd>
        </button>
      </div>
    </div>
  );
}

function formatOrderPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);
  return n.toPrecision(4);
}
