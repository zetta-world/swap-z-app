"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownUp, Settings2, Shield, EyeOff, Sparkles, ChevronDown } from "lucide-react";
import TokenSelector from "./TokenSelector";
import RoutePreview from "./RoutePreview";
import { useSwap, riskFromScore } from "@/lib/store/swap";
import { useUI } from "@/lib/store/ui";
import { formatUsd, formatAmount, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Token } from "@/lib/tokens";

export default function SwapCard() {
  const {
    fromToken, toToken, amountIn, slippageBps, mevProtect, privacyMode,
    setFromToken, setToToken, setAmountIn, setSlippage, setMev, setPrivacy, flipPair,
  } = useSwap();
  const { toggleZion } = useUI();

  const [showSettings, setShowSettings] = useState(false);

  // Demo cotation (mock until LiFi/0x integration in sprint 2)
  const quote = useMemo(() => {
    const amt = parseDecimalInput(amountIn) ?? 0;
    if (!fromToken || !toToken || amt <= 0) return null;
    const inUsd  = amt * (fromToken.priceUsd ?? 0);
    const outAmt = (inUsd / (toToken.priceUsd ?? 1)) * (1 - 0.0008);   // simulate 8bps fee
    const slip   = (slippageBps / 10_000);
    const minOut = outAmt * (1 - slip);
    return { inUsd, outAmt, outUsd: outAmt * (toToken.priceUsd ?? 0), minOut, priceImpactBps: 12 };
  }, [fromToken, toToken, amountIn, slippageBps]);

  // Aurora risk derived from heavier of two tokens
  const risk = useMemo(() => {
    const a = fromToken?.riskScore ?? 0;
    const b = toToken?.riskScore ?? 0;
    return riskFromScore(Math.max(a, b));
  }, [fromToken, toToken]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div
        data-risk={risk}
        className="aurora-border p-1"
      >
        <div className="relative rounded-[20px] glass p-5 sm:p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="section-label">Swap</span>
              <RiskBadge risk={risk} />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMev(!mevProtect)}
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                  mevProtect ? "text-green bg-green/10" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                )}
                title="MEV Protection"
                aria-pressed={mevProtect}
              >
                <Shield className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPrivacy(!privacyMode)}
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                  privacyMode ? "text-gold bg-gold/10" : "text-ink-3 hover:text-ink-2 hover:bg-white/5",
                )}
                title="Privacy Mode"
                aria-pressed={privacyMode}
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowSettings((s) => !s)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink-2 hover:bg-white/5 transition-colors"
                title="Settings"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Settings expandable */}
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-lg border border-white/5 bg-bg-1/40 p-3 space-y-2.5"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">Slippage Tolerance</label>
                  <span className="font-mono text-[11px] text-cyan">{(slippageBps / 100).toFixed(2)}%</span>
                </div>
                <div className="flex gap-1.5">
                  {[10, 50, 100, 300].map((bps) => (
                    <button
                      key={bps}
                      onClick={() => setSlippage(bps)}
                      className={cn(
                        "flex-1 py-1.5 rounded-md text-[11px] font-mono transition-colors",
                        slippageBps === bps
                          ? "bg-cyan/15 text-cyan border border-cyan/30"
                          : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                      )}
                    >
                      {bps === 10 ? "0.1%" : bps === 50 ? "0.5%" : bps === 100 ? "1%" : "3%"}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* From */}
          <SideBox
            label="You pay"
            token={fromToken}
            amount={amountIn}
            usdValue={quote?.inUsd}
            onAmountChange={setAmountIn}
            onTokenChange={setFromToken}
            side="from"
            editable
          />

          {/* Flip */}
          <div className="relative h-0 flex items-center justify-center">
            <button
              onClick={flipPair}
              className="absolute -my-3 w-10 h-10 rounded-xl bg-bg-2 border border-white/10 flex items-center justify-center text-ink-2 hover:text-cyan hover:border-cyan/30 hover:rotate-180 transition-all duration-300 shadow-card"
              aria-label="Flip pair"
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* To */}
          <SideBox
            label="You receive"
            token={toToken}
            amount={quote ? formatAmount(quote.outAmt, 6) : ""}
            usdValue={quote?.outUsd}
            onAmountChange={() => {}}
            onTokenChange={setToToken}
            side="to"
            editable={false}
          />

          {/* Stats / Route */}
          {quote && (
            <div className="space-y-2.5">
              <RoutePreview from={fromToken} to={toToken} />

              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Rate"          value={`1 ${fromToken?.symbol} = ${formatAmount((fromToken?.priceUsd ?? 0) / (toToken?.priceUsd ?? 1), 4)} ${toToken?.symbol}`} compact />
                <Stat label="Impact"        value={`${(quote.priceImpactBps / 100).toFixed(2)}%`} tone="green" />
                <Stat label="Min received"  value={`${formatAmount(quote.minOut, 4)} ${toToken?.symbol}`} compact />
              </div>
            </div>
          )}

          {/* ZION advisory teaser */}
          <button
            onClick={toggleZion}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gold/15 bg-gold/[0.04] hover:bg-gold/[0.08] hover:border-gold/25 transition-all group"
          >
            <Sparkles className="w-3.5 h-3.5 text-gold flex-shrink-0" />
            <span className="font-mono text-[11px] text-gold/90 tracking-wide flex-1 text-left">
              ZION rates this swap <span className="text-gold font-bold">SAFE · Score 92</span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gold/60 -rotate-90 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* CTA */}
          <button
            className="w-full btn btn-primary py-3.5 text-sm tracking-widest"
            disabled={!quote}
          >
            {quote ? "Review Swap" : "Enter Amount"}
          </button>

          {/* Disclaimer */}
          <p className="font-mono text-[10px] text-ink-4 text-center leading-relaxed">
            Demo environment · advisory only · not investment advice
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── SideBox: token selector + amount input + USD value ─────────────────
function SideBox({
  label, token, amount, usdValue, onAmountChange, onTokenChange, side, editable,
}: {
  label: string;
  token: Token | undefined;
  amount: string;
  usdValue?: number;
  onAmountChange: (v: string) => void;
  onTokenChange: (t: Token) => void;
  side: "from" | "to";
  editable: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3.5 sm:p-4 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">{label}</span>
        {token && (
          <span className="font-mono text-[10px] text-ink-3">
            Balance: <span className="text-ink-2">—</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => editable && onAmountChange(e.target.value)}
          placeholder="0.00"
          readOnly={!editable}
          className={cn(
            "flex-1 min-w-0 bg-transparent text-2xl sm:text-3xl font-display font-bold text-ink outline-none placeholder:text-ink-4",
            !editable && "cursor-default",
          )}
        />
        <TokenSelector value={token} onChange={onTokenChange} side={side} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="font-mono text-[11px] text-ink-3">
          {usdValue !== undefined ? formatUsd(usdValue) : "$0.00"}
        </span>
        {editable && (
          <div className="flex gap-1">
            {["25%", "50%", "MAX"].map((p) => (
              <button key={p} className="font-mono text-[10px] text-ink-3 px-1.5 py-0.5 rounded hover:text-cyan hover:bg-cyan/5 transition-colors">
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, compact }: { label: string; value: string; tone?: "green"; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/30 px-2 py-2">
      <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest mb-0.5">{label}</div>
      <div className={cn(
        "font-mono text-[11px] truncate",
        tone === "green" ? "text-green" : "text-ink",
        compact ? "text-[10px]" : "",
      )}>
        {value}
      </div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: "safe" | "caution" | "danger" }) {
  const cfg = {
    safe:    { cls: "tag tag-green",  label: "Safe Route"  },
    caution: { cls: "tag tag-gold",   label: "Caution"     },
    danger:  { cls: "tag tag-red",    label: "High Risk"   },
  }[risk];
  return (
    <span className={cfg.cls}>
      <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />
      {cfg.label}
    </span>
  );
}
