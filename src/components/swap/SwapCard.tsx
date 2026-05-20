"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount } from "wagmi";
import { ArrowDownUp, Settings2, Shield, EyeOff, Sparkles, ChevronDown, Globe, Clock, Fuel, Workflow, Flame } from "lucide-react";
import TokenSelector from "./TokenSelector";
import RoutePreview from "./RoutePreview";
import ExecuteSwap from "./ExecuteSwap";
import QuoteComparison from "./QuoteComparison";
import SwapModeTabs from "./SwapModeTabs";
import CrossChainBanner from "./CrossChainBanner";
import RecipientField from "./RecipientField";
import { useSwap, riskFromScore } from "@/lib/store/swap";
import { useUI } from "@/lib/store/ui";
import { CHAIN_BY_ID } from "@/lib/chains";
import { formatUsd, formatAmount, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Token } from "@/lib/tokens";
import { useQuotes } from "@/lib/hooks/useQuotes";
import { useTokenBalance, type TokenBalance } from "@/lib/hooks/useTokenBalance";
import type { QuoteSource, NormalizedQuote } from "@/lib/api/quote-types";

export default function SwapCard() {
  const {
    fromChain, toChain,
    fromToken, toToken, amountIn, slippageBps, mevProtect, privacyMode,
    mode, recipient,
    setFromToken, setToToken, setAmountIn, setSlippage, setMev, setPrivacy, flipPair,
    setMode, setRecipient,
  } = useSwap();
  const { toggleZion } = useUI();
  const { address } = useAccount();

  const [showSettings,  setShowSettings] = useState(false);
  const [executeOpen,   setExecuteOpen]  = useState(false);
  const [selectedSource, setSelectedSource] = useState<QuoteSource | null>(null);

  // ─── Real balances (wagmi useBalance per token) ─────────────────────
  const fromBalance = useTokenBalance(fromToken);
  const toBalance   = useTokenBalance(toToken);

  const isCrossChain = !!(fromToken && toToken && fromToken.chain !== toToken.chain);

  // Keep tab and pair state in sync — picking cross-chain tokens flips to
  // the cross tab; picking same-chain back drops you on swap.
  useEffect(() => {
    if (isCrossChain && mode !== "cross" && mode !== "sniper") {
      setMode("cross");
    } else if (!isCrossChain && mode === "cross") {
      setMode("swap");
    }
  }, [isCrossChain, mode, setMode]);

  // ─── Convert UI amount (decimal) → base units (integer) ─────────────
  const sellAmountBase = useMemo(() => {
    if (!fromToken) return "0";
    const amt = parseDecimalInput(amountIn) ?? 0;
    if (amt <= 0) return "0";
    const [intPart, fracPart = ""] = amt.toString().split(".");
    const fracPadded = (fracPart + "0".repeat(fromToken.decimals)).slice(0, fromToken.decimals);
    return (intPart + fracPadded).replace(/^0+/, "") || "0";
  }, [amountIn, fromToken]);

  // ─── Multi-aggregator quotes (0x + LiFi) ────────────────────────────
  const quotesState = useQuotes({
    fromChain,
    toChain:     toToken?.chain ?? toChain,
    sellToken:   fromToken?.address === "native" ? "native" : (fromToken?.address ?? ""),
    buyToken:    toToken?.address   === "native" ? "native" : (toToken?.address   ?? ""),
    sellAmount:  sellAmountBase,
    taker:       address,
    recipient:   isCrossChain ? recipient : undefined,
    slippageBps,
    enabled:     !!(fromToken && toToken && sellAmountBase !== "0"),
  });

  // Auto-select the best quote when the list changes
  useEffect(() => {
    if (quotesState.quotes.length === 0) {
      setSelectedSource(null);
      return;
    }
    const stillValid = quotesState.quotes.some((q) => q.source === selectedSource);
    if (!stillValid) {
      setSelectedSource(quotesState.quotes[0].source);
    }
  }, [quotesState.quotes, selectedSource]);

  const selectedQuote = useMemo(
    () => quotesState.quotes.find((q) => q.source === selectedSource) ?? quotesState.quotes[0] ?? null,
    [quotesState.quotes, selectedSource],
  );

  // ─── Derived display values from the selected quote ────────────────
  const display = useMemo(() => {
    if (!fromToken || !toToken || !selectedQuote) return null;
    const sellDec = Number(sellAmountBase) / Math.pow(10, fromToken.decimals);
    if (sellDec <= 0) return null;
    const buyDec  = Number(selectedQuote.buyAmount)    / Math.pow(10, toToken.decimals);
    const minDec  = Number(selectedQuote.minBuyAmount) / Math.pow(10, toToken.decimals);
    const rate    = sellDec > 0 ? buyDec / sellDec : 0;
    const inUsd   = sellDec * (fromToken.priceUsd ?? 0);
    const outUsd  = buyDec  * (toToken.priceUsd   ?? 0);
    return { sellDec, buyDec, minDec, rate, inUsd, outUsd };
  }, [selectedQuote, sellAmountBase, fromToken, toToken]);

  // ─── Aurora risk ────────────────────────────────────────────────────
  const risk = useMemo(() => {
    const a = fromToken?.riskScore ?? 0;
    const b = toToken?.riskScore ?? 0;
    return riskFromScore(Math.max(a, b));
  }, [fromToken, toToken]);

  // Reset modal when key inputs change
  useEffect(() => {
    if (executeOpen) setExecuteOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken?.address, toToken?.address, fromChain, sellAmountBase, recipient]);

  const canExecute   = !!(display && selectedQuote && selectedQuote.isFirm !== false && fromToken && toToken && address);
  const cantReason   = !fromToken || !toToken
    ? "Pick tokens"
    : !address
      ? "Connect wallet"
      : !display
        ? (quotesState.loading ? "Fetching quotes…" : "Enter amount")
        : !selectedQuote
          ? "No route available"
          : "";

  const onPercent = (pct: number) => {
    if (!fromBalance || fromBalance.isZero || !fromToken) return;
    const buf  = fromToken.address === "native" ? 0.001 : 0;
    const num  = Number(fromBalance.formatted) * pct;
    const safe = Math.max(num - buf, 0);
    setAmountIn(safe.toString().slice(0, 18));
  };

  const ctaLabel = canExecute
    ? mode === "cross"
      ? `Review bridge & swap`
      : mode === "sniper"
        ? `Snipe ${toToken?.symbol ?? "token"}`
        : "Review & swap"
    : cantReason;

  return (
    <div className="relative w-full max-w-md mx-auto">
      <div data-risk={risk} className="aurora-border p-1">
        <div className="relative rounded-[20px] glass p-5 sm:p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="section-label">
                {mode === "cross"  ? "Cross-chain" :
                 mode === "sniper" ? "Sniper"      :
                                     "Swap"}
              </span>
              <RiskBadge risk={risk} />
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMev(!mevProtect)} aria-pressed={mevProtect} title="MEV Protection"
                className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors", mevProtect ? "text-green bg-green/10" : "text-ink-3 hover:text-ink-2 hover:bg-white/5")}>
                <Shield className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setPrivacy(!privacyMode)} aria-pressed={privacyMode} title="Privacy Mode"
                className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors", privacyMode ? "text-gold bg-gold/10" : "text-ink-3 hover:text-ink-2 hover:bg-white/5")}>
                <EyeOff className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setShowSettings((s) => !s)} title="Settings"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink-2 hover:bg-white/5 transition-colors">
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Mode tabs — Swap / Cross-Chain / Sniper */}
          <SwapModeTabs mode={mode} onChange={setMode} />

          {/* Settings */}
          <AnimatePresence>
            {showSettings && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="rounded-lg border border-white/5 bg-bg-1/40 p-3 space-y-2.5 overflow-hidden">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">Slippage Tolerance</label>
                    <span className="font-mono text-[11px] text-cyan">{(slippageBps / 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex gap-1.5">
                    {[10, 50, 100, 300].map((bps) => (
                      <button type="button" key={bps} onClick={() => setSlippage(bps)}
                        className={cn("flex-1 py-1.5 rounded-md text-[11px] font-mono transition-colors",
                          slippageBps === bps ? "bg-cyan/15 text-cyan border border-cyan/30" : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2")}>
                        {bps === 10 ? "0.1%" : bps === 50 ? "0.5%" : bps === 100 ? "1%" : "3%"}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* From */}
          <SideBox label="You pay" token={fromToken} amount={amountIn} usdValue={display?.inUsd}
            onAmountChange={setAmountIn} onTokenChange={setFromToken} side="from" editable
            balance={fromBalance} onPercent={onPercent} />

          {/* Flip */}
          <div className="relative h-0 flex items-center justify-center">
            <button type="button" onClick={flipPair} aria-label="Flip pair"
              className="absolute -my-3 w-10 h-10 rounded-xl bg-bg-2 border border-white/10 flex items-center justify-center text-ink-2 hover:text-cyan hover:border-cyan/30 hover:rotate-180 transition-all duration-300 shadow-card">
              <ArrowDownUp className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* To */}
          <SideBox label="You receive" token={toToken}
            amount={display ? formatAmount(display.buyDec, 6) : (quotesState.loading ? "…" : "")}
            usdValue={display?.outUsd}
            onAmountChange={() => {}} onTokenChange={setToToken} side="to" editable={false}
            balance={toBalance} />

          {/* Cross-chain ticker (rate + bridge + ETA) */}
          <AnimatePresence>
            {isCrossChain && selectedQuote && fromToken && toToken && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                <CrossChainBanner quote={selectedQuote} fromToken={fromToken} toToken={toToken} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recipient (cross-chain only) */}
          <AnimatePresence>
            {isCrossChain && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <RecipientField
                  value={recipient}
                  onChange={setRecipient}
                  connected={address}
                  toChainName={toToken ? CHAIN_BY_ID[toToken.chain]?.name : undefined}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sniper-mode telemetry: risk, age, pooled depth (lightweight inline preview) */}
          {mode === "sniper" && toToken && (
            <SniperTelemetry token={toToken} />
          )}

          {/* Quote comparison — side-by-side aggregator routes */}
          {fromToken && toToken && sellAmountBase !== "0" && (
            <QuoteComparison
              quotes={quotesState.quotes}
              selected={selectedSource}
              onSelect={setSelectedSource}
              toToken={toToken}
              loading={quotesState.loading}
              error={quotesState.error}
            />
          )}

          {/* Stats + Route */}
          {display && selectedQuote && (
            <div className="space-y-2.5">
              <RoutePreview
                from={fromToken}
                to={toToken}
                hops={selectedQuote.hops}
                sourceLabel={selectedQuote.label}
              />

              <StatsGrid
                fromSymbol={fromToken?.symbol ?? ""}
                toSymbol={toToken?.symbol ?? ""}
                rate={display.rate}
                minDec={display.minDec}
                slippageBps={slippageBps}
                quote={selectedQuote}
                isCrossChain={isCrossChain}
              />

              {/* Live source ticker */}
              <div className="flex items-center justify-center gap-1.5 font-mono text-[9px] tracking-widest uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-green pulse-dot" />
                <span className="text-green/80">
                  Live · {selectedQuote.label}
                  {isCrossChain && " · cross-chain"}
                </span>
              </div>
            </div>
          )}

          {/* ZION teaser */}
          <button type="button" onClick={toggleZion}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gold/15 bg-gold/[0.04] hover:bg-gold/[0.08] hover:border-gold/25 transition-all group">
            <Sparkles className="w-3.5 h-3.5 text-gold flex-shrink-0" />
            <span className="font-mono text-[11px] text-gold/90 tracking-wide flex-1 text-left">
              Ask ZION about this swap
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gold/60 -rotate-90 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* CTA */}
          <button type="button"
            onClick={() => canExecute && setExecuteOpen(true)}
            disabled={!canExecute}
            className="w-full btn btn-primary py-3.5 text-sm tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">
            {ctaLabel}
          </button>

          {/* Disclaimer */}
          <p className="font-mono text-[10px] text-ink-4 text-center leading-relaxed">
            Powered by 0x Settler &amp; LiFi · multi-aggregator · non-custodial
          </p>
        </div>
      </div>

      {/* Execute modal — only mount when needed to avoid stale state */}
      {executeOpen && fromToken && toToken && selectedQuote && (
        <ExecuteSwap
          open={executeOpen}
          onClose={() => setExecuteOpen(false)}
          fromToken={fromToken}
          toToken={toToken}
          fromChain={fromChain}
          toChain={toToken.chain}
          sellAmount={sellAmountBase}
          slippageBps={slippageBps}
          source={selectedQuote.source}
          recipient={isCrossChain ? recipient : undefined}
        />
      )}
    </div>
  );
}

// ─── Cross-chain–aware stats grid ───────────────────────────────────────
function StatsGrid({
  fromSymbol, toSymbol, rate, minDec, slippageBps, quote, isCrossChain,
}: {
  fromSymbol:   string;
  toSymbol:     string;
  rate:         number;
  minDec:       number;
  slippageBps:  number;
  quote:        NormalizedQuote;
  isCrossChain: boolean;
}) {
  if (!isCrossChain) {
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Rate"
          value={`1 ${fromSymbol} = ${formatAmount(rate, 4)} ${toSymbol}`}
          compact />
        <Stat label="Slippage" value={`${(slippageBps / 100).toFixed(2)}%`} tone="green" />
        <Stat label="Min received"
          value={`${formatAmount(minDec, 4)} ${toSymbol}`}
          compact />
      </div>
    );
  }
  const dur = quote.durationSec;
  const durationLabel = dur < 60
    ? `~${dur}s`
    : dur < 3600
      ? `~${Math.round(dur / 60)}min`
      : `~${Math.round(dur / 3600)}h`;
  const bridge = quote.label.replace(/^LiFi\s·\s/, "");
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Stat icon="rate" label="Rate"
        value={`1 ${fromSymbol} = ${formatAmount(rate, 4)} ${toSymbol}`}
        compact />
      <Stat icon="time" label="ETA" value={durationLabel} tone="violet" />
      <Stat icon="bridge" label="Bridge" value={bridge} compact />
      <Stat label="Slippage" value={`${(slippageBps / 100).toFixed(2)}%`} tone="green" />
      <Stat label="Min received"
        value={`${formatAmount(minDec, 4)} ${toSymbol}`}
        compact />
      <Stat icon="gas" label="Gas (est.)"
        value={quote.gasUsd ? `~$${quote.gasUsd.toFixed(2)}` : "—"}
        compact />
    </div>
  );
}

// ─── Sniper-mode inline telemetry (Phase 4 will replace with real data) ─
function SniperTelemetry({ token }: { token: Token }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-gradient-to-r from-gold/[0.04] to-cyan/[0.02] p-3">
      <div className="flex items-center gap-2 mb-2">
        <Flame className="w-3.5 h-3.5 text-gold" />
        <span className="font-mono text-[10px] text-gold tracking-widest uppercase">
          Sniper telemetry · {token.symbol}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
        <Telem label="Chain" value={CHAIN_BY_ID[token.chain]?.name ?? token.chain} />
        <Telem label="Risk" value={token.riskScore !== undefined ? `${token.riskScore}/100` : "—"} />
        <Telem label="Address" value={token.address === "native" ? "native" : `${token.address.slice(0, 6)}…${token.address.slice(-4)}`} />
        <Telem label="Price" value={token.priceUsd ? `$${token.priceUsd.toFixed(6)}` : "—"} />
      </div>
      <p className="mt-2 font-mono text-[9px] text-ink-4 leading-relaxed">
        Pool depth · holder map · creator wallet · coming in Pair view.
      </p>
    </div>
  );
}

function Telem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between min-w-0 gap-2">
      <span className="text-ink-3 uppercase tracking-widest text-[9px] flex-shrink-0">{label}</span>
      <span className="text-ink-2 truncate">{value}</span>
    </div>
  );
}

// ─── SideBox: token selector + amount input + USD value ─────────────────
function SideBox({
  label, token, amount, usdValue, onAmountChange, onTokenChange, side, editable,
  balance, onPercent,
}: {
  label: string;
  token: Token | undefined;
  amount: string;
  usdValue?: number;
  onAmountChange: (v: string) => void;
  onTokenChange: (t: Token) => void;
  side: "from" | "to";
  editable: boolean;
  balance?: TokenBalance;
  onPercent?: (pct: number) => void;
}) {
  const balanceText = balance
    ? balance.loading
      ? "…"
      : balance.error
        ? "—"
        : balance.display
    : "—";

  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3.5 sm:p-4 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest flex-shrink-0">{label}</span>
        {token && (
          <span className="font-mono text-[10px] text-ink-3 truncate">
            Balance:{" "}
            <span className={cn(
              "font-bold",
              balance && !balance.isZero ? "text-ink-2" : "text-ink-3",
            )}>
              {balanceText}
            </span>
            {balance?.usdValue !== null && balance?.usdValue !== undefined && balance.usdValue > 0 && (
              <span className="text-ink-4"> · {formatUsd(balance.usdValue)}</span>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0">
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
      <div className="flex items-center justify-between mt-2 gap-2 min-w-0">
        <span className="font-mono text-[11px] text-ink-3 truncate">
          {usdValue !== undefined ? formatUsd(usdValue) : "$0.00"}
        </span>
        {editable && onPercent && balance && !balance.isZero && (
          <div className="flex gap-1 flex-shrink-0">
            {[
              { label: "25%", pct: 0.25 },
              { label: "50%", pct: 0.50 },
              { label: "MAX", pct: 1.00 },
            ].map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => onPercent(p.pct)}
                className="font-mono text-[10px] text-cyan/80 border border-cyan/20 bg-cyan/5 px-2 py-0.5 rounded hover:text-cyan hover:bg-cyan/10 hover:border-cyan/40 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, tone, compact, icon,
}: {
  label:    string;
  value:    string;
  tone?:    "green" | "violet";
  compact?: boolean;
  icon?:    "rate" | "time" | "bridge" | "gas";
}) {
  const IconEl =
    icon === "time"   ? Clock    :
    icon === "bridge" ? Workflow :
    icon === "gas"    ? Fuel     :
    icon === "rate"   ? Globe    :
                        null;
  const toneCls =
    tone === "green"  ? "text-green"  :
    tone === "violet" ? "text-violet" :
                        "text-ink";
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/30 px-2 py-2 min-w-0">
      <div className="flex items-center gap-1 mb-0.5">
        {IconEl && <IconEl className="w-2.5 h-2.5 text-ink-4" />}
        <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest truncate">{label}</span>
      </div>
      <div className={cn(
        "font-mono truncate",
        toneCls,
        compact ? "text-[10px]" : "text-[11px]",
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
