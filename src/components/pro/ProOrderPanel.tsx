"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  pair:        { base: string; quote: string; chain: string };
  lastPrice:   number | null;
  accentColor: string;
}

type Side      = "buy" | "sell";
type OrderType = "market" | "limit" | "stop" | "oco" | "trailing";
type SizePct   = 25 | 50 | 75 | 100;
type TrailBy   = "pct" | "atr";

const SIZE_PCTS: SizePct[] = [25, 50, 75, 100];
const ORDER_TYPES: { id: OrderType; label: string }[] = [
  { id: "market",   label: "MKT"   },
  { id: "limit",    label: "LMT"   },
  { id: "stop",     label: "STP"   },
  { id: "oco",      label: "OCO"   },
  { id: "trailing", label: "TRAIL" },
];

export default function ProOrderPanel({ pair, lastPrice, accentColor }: Props) {
  const [side,        setSide]        = useState<Side>("buy");
  const [orderType,   setOrderType]   = useState<OrderType>("market");
  const [size,        setSize]        = useState("");
  const [limitPrice,  setLimitPrice]  = useState("");
  const [tpPrice,     setTpPrice]     = useState("");
  const [slPrice,     setSlPrice]     = useState("");
  const [trailPct,    setTrailPct]    = useState("2");
  const [trailBy,     setTrailBy]     = useState<TrailBy>("pct");
  const [sizePercent, setSizePercent] = useState<SizePct | null>(null);

  const showLimit    = orderType === "limit" || orderType === "stop";
  const showOco      = orderType === "oco";
  const showTrailing = orderType === "trailing";

  const isBuy  = side === "buy";
  const sizeNum    = parseFloat(size)       || 0;
  const priceNum   = showLimit ? (parseFloat(limitPrice) || lastPrice || 0) : (lastPrice ?? 0);
  const estTotal   = sizeNum > 0 && priceNum > 0 ? sizeNum * priceNum : null;

  // Trailing stop computation
  const trailPctNum = parseFloat(trailPct) || 2;
  const trailStop   = lastPrice != null
    ? isBuy
      ? lastPrice * (1 - trailPctNum / 100)   // trailing stop below for long
      : lastPrice * (1 + trailPctNum / 100)   // trailing stop above for short
    : null;

  function handlePct(pct: SizePct) {
    setSizePercent(pct);
    setSize((pct / 100).toFixed(4));
  }

  const ctaLabel = showOco
    ? `Place OCO ${isBuy ? "Buy" : "Sell"}`
    : showTrailing
    ? `Set Trailing ${isBuy ? "Long" : "Short"}`
    : `Execute ${isBuy ? "Buy" : "Sell"}`;

  return (
    <div className="rounded-xl border bg-black/60 backdrop-blur-sm overflow-hidden"
      style={{ borderColor: `${accentColor}22` }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">Order</span>
        <span className="font-mono text-[9px] text-ink-3">{pair.base}/{pair.quote}</span>
        {lastPrice !== null && (
          <span className="ml-auto font-mono text-[9px] tabular-nums" style={{ color: accentColor }}>
            ${fmtOrderPrice(lastPrice)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2.5">
        {/* Side */}
        <div className="flex gap-1.5">
          {(["buy", "sell"] as Side[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={cn(
                "flex-1 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase border transition-all",
                side === s && s === "buy"  && "bg-green/15 border-green/40 text-green font-bold",
                side === s && s === "sell" && "bg-red/15 border-red/40 text-red font-bold",
                side !== s && "border-white/10 text-ink-3 hover:border-white/20 hover:text-ink-2",
              )}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        {/* Order type */}
        <div className="flex gap-0.5">
          {ORDER_TYPES.map(ot => (
            <button
              key={ot.id}
              type="button"
              onClick={() => setOrderType(ot.id)}
              aria-pressed={orderType === ot.id}
              className={cn(
                "flex-1 py-1.5 rounded font-mono text-[8px] tracking-widest uppercase border transition-all",
                orderType === ot.id
                  ? "border-white/20 bg-white/8 text-ink"
                  : "border-white/5 text-ink-3 hover:border-white/10 hover:text-ink-2",
              )}
            >
              {ot.label}
            </button>
          ))}
        </div>

        {/* Size */}
        <div>
          <label className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-1">Size</label>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">$</span>
              <input
                type="number" min="0" step="any"
                value={size}
                onChange={e => { setSize(e.target.value); setSizePercent(null); }}
                placeholder="0.00"
                aria-label="Order size"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-6 pr-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-white/25 transition-colors tabular-nums"
              />
            </div>
            <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase whitespace-nowrap">
              {pair.quote}
            </span>
          </div>
          <div className="flex gap-1 mt-1.5">
            {SIZE_PCTS.map(pct => (
              <button key={pct} type="button" onClick={() => handlePct(pct)} aria-pressed={sizePercent === pct}
                className={cn(
                  "flex-1 py-1 rounded font-mono text-[9px] tracking-wider border transition-all",
                  sizePercent === pct ? "border-white/25 bg-white/8 text-ink" : "border-white/5 text-ink-4 hover:border-white/15 hover:text-ink-3",
                )}
              >
                {pct === 100 ? "MAX" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Limit / Stop price */}
        <AnimatePresence>
          {showLimit && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} style={{ overflow: "hidden" }}>
              <label className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-1">
                {orderType === "stop" ? "Stop Price" : "Limit Price"}
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">$</span>
                <input type="number" min="0" step="any" value={limitPrice}
                  onChange={e => setLimitPrice(e.target.value)}
                  placeholder={lastPrice ? fmtOrderPrice(lastPrice) : "0.00"}
                  aria-label="Limit price"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-6 pr-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-white/25 transition-colors tabular-nums"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* OCO: TP + SL */}
        <AnimatePresence>
          {showOco && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}
              style={{ overflow: "hidden" }} className="flex gap-2">
              <div className="flex-1">
                <label className="font-mono text-[9px] text-green tracking-widest uppercase block mb-1">TP</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">$</span>
                  <input type="number" min="0" step="any" value={tpPrice}
                    onChange={e => setTpPrice(e.target.value)}
                    placeholder={lastPrice ? fmtOrderPrice(lastPrice * 1.03) : "0.00"}
                    aria-label="Take profit price"
                    className="w-full bg-white/[0.03] border border-green/20 rounded-lg pl-6 pr-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-green/50 transition-colors tabular-nums"
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="font-mono text-[9px] text-red tracking-widest uppercase block mb-1">SL</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">$</span>
                  <input type="number" min="0" step="any" value={slPrice}
                    onChange={e => setSlPrice(e.target.value)}
                    placeholder={lastPrice ? fmtOrderPrice(lastPrice * 0.97) : "0.00"}
                    aria-label="Stop loss price"
                    className="w-full bg-white/[0.03] border border-red/20 rounded-lg pl-6 pr-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-red/50 transition-colors tabular-nums"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* OCO R/R */}
        {showOco && tpPrice && slPrice && lastPrice && (() => {
          const tp   = parseFloat(tpPrice), sl = parseFloat(slPrice);
          const risk = Math.abs(lastPrice - sl), reward = Math.abs(tp - lastPrice);
          if (risk <= 0 || !Number.isFinite(risk) || !Number.isFinite(reward)) return null;
          const rr = reward / risk;
          return (
            <div className="flex items-center justify-between font-mono text-[9px] text-ink-4 tracking-wider">
              <span>Risk / Reward</span>
              <span className="tabular-nums"
                style={{ color: rr >= 1.5 ? "#00E087" : rr >= 1 ? "#F5A623" : "#FF3B5C" }}>
                1 : {rr.toFixed(2)}
              </span>
            </div>
          );
        })()}

        {/* Trailing stop inputs */}
        <AnimatePresence>
          {showTrailing && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}
              style={{ overflow: "hidden" }} className="space-y-2">
              {/* Trail by selector */}
              <div className="flex gap-1">
                {(["pct", "atr"] as TrailBy[]).map(tb => (
                  <button key={tb} type="button" onClick={() => setTrailBy(tb)}
                    aria-pressed={trailBy === tb}
                    className={cn(
                      "flex-1 py-1.5 rounded font-mono text-[9px] tracking-widest uppercase border transition-all",
                      trailBy === tb ? "border-white/20 bg-white/8 text-ink" : "border-white/5 text-ink-3 hover:border-white/10 hover:text-ink-2",
                    )}
                  >
                    {tb === "pct" ? "% Trail" : "ATR Trail"}
                  </button>
                ))}
              </div>

              <div>
                <label className="font-mono text-[9px] text-ink-4 tracking-widest uppercase block mb-1">
                  {trailBy === "pct" ? "Trail Distance (%)" : "ATR Multiplier"}
                </label>
                <div className="relative">
                  <input type="number" min="0.1" step="0.1" value={trailPct}
                    onChange={e => setTrailPct(e.target.value)}
                    placeholder={trailBy === "pct" ? "2.0" : "1.5"}
                    aria-label="Trail distance"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-ink-4 outline-none focus:border-white/25 transition-colors tabular-nums"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4">
                    {trailBy === "pct" ? "%" : "×ATR"}
                  </span>
                </div>
              </div>

              {/* Computed stop level */}
              {trailStop !== null && (
                <div className="rounded-md bg-white/[0.03] border border-white/5 px-2.5 py-2 space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-[9px]">
                    <span className="text-ink-4 tracking-widest uppercase">Current Stop</span>
                    <span className="tabular-nums font-bold" style={{ color: isBuy ? "#FF3B5C" : "#00E087" }}>
                      ${fmtOrderPrice(trailStop)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[9px]">
                    <span className="text-ink-4 tracking-widest uppercase">Distance</span>
                    <span className="tabular-nums text-ink-2">{trailPctNum.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-[9px]">
                    <span className="text-ink-4 tracking-widest uppercase">Direction</span>
                    <span className="text-ink-2">{isBuy ? "↑ Trails up (long)" : "↓ Trails down (short)"}</span>
                  </div>
                </div>
              )}

              {/* Infrastructure note */}
              <div className="flex items-start gap-1.5 rounded-md bg-gold/[0.06] border border-gold/15 px-2.5 py-1.5">
                <Info className="w-3 h-3 text-gold flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[8px] text-ink-3 leading-snug">
                  UI preview — live execution via server-side order engine (Phase 3 infrastructure).
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Est. total */}
        <div className="flex items-center justify-between font-mono text-[9px] text-ink-4 tracking-wider">
          <span>Est. total</span>
          <span className="text-ink-2 tabular-nums">
            {estTotal !== null
              ? `$${estTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </span>
        </div>

        {/* CTA */}
        <button
          type="button"
          className="w-full rounded-lg py-2.5 font-mono text-[10px] font-bold tracking-widest uppercase flex items-center justify-center gap-2 transition-opacity hover:opacity-90 active:scale-[0.98]"
          style={{
            background: isBuy ? "rgba(0,224,135,0.18)" : "rgba(255,59,92,0.18)",
            border:     `1px solid ${isBuy ? "rgba(0,224,135,0.40)" : "rgba(255,59,92,0.40)"}`,
            color:      isBuy ? "#00E087" : "#FF3B5C",
          }}
        >
          <span>▶ {ctaLabel}</span>
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

function fmtOrderPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)     return n.toFixed(4);
  if (n >= 0.01)  return n.toFixed(6);
  return n.toPrecision(4);
}
