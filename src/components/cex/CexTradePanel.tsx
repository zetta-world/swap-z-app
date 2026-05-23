"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, ArrowDownUp, RefreshCw, BookOpen, AlertTriangle, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  CEX_META, type CexId, type CexCredentials, type CexBalance,
  type CexOrderbookSnapshot, type CexOrderSide, type CexOrder,
} from "@/lib/cex/types";
import CexOrderConfirm from "./CexOrderConfirm";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const SUGGESTED_SYMBOLS: Record<CexId, string[]> = {
  binance:  ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ARB/USDT"],
  coinbase: ["BTC/USD",  "ETH/USD",  "SOL/USD",  "MATIC/USD", "AVAX/USD", "LINK/USD"],
  okx:      ["BTC/USDT", "ETH/USDT", "SOL/USDT", "OKB/USDT", "DOGE/USDT", "TON/USDT"],
};

const ORDERBOOK_POLL_MS = 5_000;

interface Props {
  exchangeId:  CexId;
  credentials: CexCredentials;
}

/**
 * Live trade panel for one connected CEX. Polls the orderbook every 5s,
 * lets the user pick side/amount, and routes the final submit through
 * CexOrderConfirm which adds a 3-second cooldown + literal "I-CONFIRM-REAL-ORDER"
 * payload before the order hits the exchange.
 */
export default function CexTradePanel({ exchangeId, credentials }: Props) {
  const meta = CEX_META[exchangeId];

  // Inputs
  const [symbol, setSymbol] = useState<string>(SUGGESTED_SYMBOLS[exchangeId][0]);
  const [side,   setSide]   = useState<CexOrderSide>("buy");
  const [amount, setAmount] = useState<string>("");

  // Live data
  const [orderbook, setOrderbook] = useState<CexOrderbookSnapshot | null>(null);
  const [obLoading, setObLoading] = useState(false);
  const [obError,   setObError]   = useState<string | null>(null);
  const [balances,  setBalances]  = useState<CexBalance[]>([]);
  const [bLoading,  setBLoading]  = useState(false);

  // Confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Track open orders refresh trigger after a successful place
  const [recentOrder, setRecentOrder] = useState<CexOrder | null>(null);

  // ─── Orderbook polling ──────────────────────────────────────────────
  const loadOrderbook = useCallback(async () => {
    setObLoading(true);
    setObError(null);
    try {
      const res = await fetch("/api/cex/orderbook", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   exchangeId,
          symbol,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
          depth:      10,
        }),
      });
      const body = await res.json() as CexOrderbookSnapshot & { error?: string };
      if (!res.ok || !body.ok) throw new Error(humanError(body.error ?? `HTTP ${res.status}`));
      setOrderbook(body);
    } catch (e) {
      setObError(e instanceof Error ? e.message : String(e));
    } finally {
      setObLoading(false);
    }
  }, [exchangeId, symbol, credentials]);

  // Initial fetch + poll
  useEffect(() => {
    void loadOrderbook();
    const id = setInterval(loadOrderbook, ORDERBOOK_POLL_MS);
    return () => clearInterval(id);
  }, [loadOrderbook]);

  // ─── Balances ───────────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setBLoading(true);
    try {
      const res = await fetch("/api/cex/balance", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   exchangeId,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
          withUsd:    true,
        }),
      });
      const body = await res.json() as { ok: boolean; balances?: CexBalance[]; error?: string };
      if (res.ok && body.ok && body.balances) setBalances(body.balances);
    } catch { /* */ } finally { setBLoading(false); }
  }, [exchangeId, credentials]);

  useEffect(() => { void loadBalances(); }, [loadBalances]);

  // ─── Derived ───────────────────────────────────────────────────────
  const baseAsset  = symbol.split(/[\/\-]/)[0];
  const quoteAsset = symbol.split(/[\/\-]/)[1];

  const baseBalance  = balances.find((b) => b.asset === baseAsset);
  const quoteBalance = balances.find((b) => b.asset === quoteAsset);

  const amountNum = parseFloat(amount) || 0;
  const referencePrice =
    side === "buy"  ? orderbook?.bestAsk ?? 0
                    : orderbook?.bestBid ?? 0;
  const estCostQuote = amountNum * referencePrice;

  // Sanity warnings
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (amountNum > 0 && orderbook) {
      // Check if our notional eats the top of book (likely >0.5% slippage)
      const sideLevels = side === "buy" ? orderbook.asks : orderbook.bids;
      let consumed = 0;
      let worstPrice = referencePrice;
      for (const lvl of sideLevels) {
        consumed += lvl.amount;
        worstPrice = lvl.price;
        if (consumed >= amountNum) break;
      }
      if (consumed < amountNum) {
        w.push(`Top-10 levels only show ${consumed.toFixed(4)} ${baseAsset} — your order is bigger than visible book depth.`);
      } else if (referencePrice > 0) {
        const slip = Math.abs(worstPrice - referencePrice) / referencePrice;
        if (slip > 0.005) {
          w.push(`Likely slippage ~${(slip * 100).toFixed(2)}% — order eats multiple book levels.`);
        }
      }
    }
    if (side === "sell" && baseBalance && amountNum > baseBalance.free) {
      w.push(`Selling ${amountNum} ${baseAsset} but only ${baseBalance.free.toFixed(6)} ${baseAsset} is free on ${meta.label}.`);
    }
    if (side === "buy" && quoteBalance && estCostQuote > quoteBalance.free) {
      w.push(`Buy needs ~${estCostQuote.toFixed(2)} ${quoteAsset} but only ${quoteBalance.free.toFixed(2)} ${quoteAsset} is free on ${meta.label}.`);
    }
    return w;
  }, [amountNum, orderbook, side, referencePrice, baseAsset, quoteAsset, baseBalance, quoteBalance, estCostQuote, meta.label]);

  // ─── Place-order outcomes ──────────────────────────────────────────
  const onConfirmed = (order: CexOrder, filledImmediately: boolean) => {
    setConfirmOpen(false);
    setRecentOrder(order);
    setAmount("");
    if (filledImmediately) {
      toast.success(`Market order filled: ${order.filled.toFixed(6)} ${baseAsset} @ ~${order.average?.toFixed(2) ?? "—"}.`);
    } else {
      toast.success(`Order placed: id ${order.id.slice(0, 12)}…`);
    }
    void loadBalances();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 min-w-0">
      {/* LEFT: trade form */}
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        className="lg:col-span-5 rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 space-y-4 min-w-0"
      >
        <div className="flex items-center gap-2">
          <ArrowDownUp className="w-4 h-4 text-cyan" />
          <span className="section-label">Place order · {meta.label}</span>
        </div>

        {/* Symbol picker */}
        <label className="block min-w-0">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">Symbol</div>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase().trim())}
            placeholder="e.g. BTC/USDT"
            spellCheck={false}
            autoCorrect="off"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus:border-cyan/30 outline-none text-sm font-mono text-ink placeholder:text-ink-4"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {SUGGESTED_SYMBOLS[exchangeId].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSymbol(s)}
                className={cn(
                  "px-2 py-0.5 rounded-md font-mono text-[10px] tracking-wider transition-colors",
                  symbol === s
                    ? "bg-cyan/15 text-cyan border border-cyan/30"
                    : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </label>

        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={cn(
              "py-2.5 rounded-lg border font-display font-bold text-xs tracking-wide flex items-center justify-center gap-1.5 transition-all",
              side === "buy"
                ? "border-green/40 bg-green/[0.10] text-green shadow-glow-green"
                : "border-white/10 bg-white/[0.02] text-ink-3 hover:text-ink-2",
            )}
          >
            <TrendingUp className="w-3.5 h-3.5" /> BUY {baseAsset}
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={cn(
              "py-2.5 rounded-lg border font-display font-bold text-xs tracking-wide flex items-center justify-center gap-1.5 transition-all",
              side === "sell"
                ? "border-red/40 bg-red/[0.10] text-red shadow-glow-red"
                : "border-white/10 bg-white/[0.02] text-ink-3 hover:text-ink-2",
            )}
          >
            <TrendingDown className="w-3.5 h-3.5" /> SELL {baseAsset}
          </button>
        </div>

        {/* Amount */}
        <label className="block min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              Amount ({baseAsset})
            </span>
            {baseBalance && (
              <button
                type="button"
                onClick={() => setAmount(String(baseBalance.free))}
                className="font-mono text-[10px] text-cyan hover:underline tracking-wider"
              >
                max: {compactNumber(baseBalance.free)}
              </button>
            )}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus:border-cyan/30 outline-none text-base font-display font-bold text-ink placeholder:text-ink-4 tabular-nums"
          />
        </label>

        {/* Preview */}
        <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3 space-y-1.5 min-w-0">
          <PreviewRow label="Reference price" value={referencePrice > 0 ? `${referencePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${quoteAsset}` : "—"} />
          <PreviewRow label={side === "buy" ? "You spend ≈" : "You receive ≈"} value={amountNum > 0 && referencePrice > 0 ? `${estCostQuote.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quoteAsset}` : "—"} />
          <PreviewRow label="Order type" value="market · fills immediately" />
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-1.5">
            {warnings.map((w, i) => (
              <div key={i} className="rounded-md border border-gold/20 bg-gold/[0.04] px-2.5 py-1.5 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-gold flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[10px] text-ink-2 leading-relaxed">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* Submit */}
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={amountNum <= 0 || referencePrice <= 0 || obError !== null}
          className={cn(
            "w-full py-3 rounded-lg font-display font-extrabold text-sm tracking-wide flex items-center justify-center gap-2 transition-all",
            side === "buy"
              ? "bg-green text-bg hover:opacity-90 disabled:bg-green/40"
              : "bg-red text-bg hover:opacity-90 disabled:bg-red/40",
            "disabled:cursor-not-allowed",
          )}
        >
          Review {side === "buy" ? "BUY" : "SELL"} {amountNum > 0 ? `${amount} ${baseAsset}` : baseAsset}
        </button>
      </motion.div>

      {/* RIGHT: orderbook + balances */}
      <motion.div
        initial={{ opacity: 0, x: 6 }}
        animate={{ opacity: 1, x: 0 }}
        className="lg:col-span-7 space-y-4 min-w-0"
      >
        {/* Orderbook */}
        <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 min-w-0">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-cyan" />
              <span className="section-label">Order book · {symbol}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadOrderbook()}
              disabled={obLoading}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-3 hover:text-cyan tracking-widest uppercase"
            >
              <RefreshCw className={cn("w-3 h-3", obLoading && "animate-spin")} />
              {obLoading ? "fetching…" : "refresh"}
            </button>
          </div>

          {obError && (
            <div className="rounded-md border border-red/20 bg-red/[0.05] p-2.5 font-mono text-[11px] text-red">
              {obError}
            </div>
          )}

          {!obError && orderbook && (
            <div className="grid grid-cols-2 gap-3">
              <BookSide
                label="Asks (sell wall)"
                tone="red"
                rows={orderbook.asks}
                referencePrice={orderbook.bestAsk}
                quote={quoteAsset}
              />
              <BookSide
                label="Bids (buy wall)"
                tone="green"
                rows={orderbook.bids}
                referencePrice={orderbook.bestBid}
                quote={quoteAsset}
              />
            </div>
          )}

          {!obError && orderbook && (
            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between flex-wrap gap-2">
              <div className="font-mono text-[10px] text-ink-3">
                Mid <span className="text-ink">${orderbook.mid.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
              </div>
              <div className="font-mono text-[10px] text-ink-3">
                Spread <span className="text-ink">{((orderbook.bestAsk - orderbook.bestBid) / orderbook.mid * 100).toFixed(3)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Balances */}
        <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 min-w-0">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-gold" />
              <span className="section-label">Available · {meta.label}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadBalances()}
              disabled={bLoading}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-3 hover:text-gold tracking-widest uppercase"
            >
              <RefreshCw className={cn("w-3 h-3", bLoading && "animate-spin")} />
              {bLoading ? "fetching…" : "refresh"}
            </button>
          </div>
          {balances.length === 0
            ? <p className="font-mono text-[11px] text-ink-3">No balances yet — refresh or fund the account.</p>
            : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {balances.slice(0, 9).map((b) => (
                  <div key={b.asset} className="rounded-lg border border-white/5 bg-bg-1/30 px-2.5 py-2 min-w-0">
                    <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{b.asset}</div>
                    <div className="font-display font-bold text-sm text-ink truncate tabular-nums">
                      {compactNumber(b.total)}
                    </div>
                    {b.usdValue !== undefined && b.usdValue > 0.01 && (
                      <div className="font-mono text-[10px] text-ink-3 tabular-nums">${compactNumber(b.usdValue)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>

        {/* Last order receipt */}
        {recentOrder && (
          <div className="rounded-2xl border border-green/20 bg-green/[0.04] p-4 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-green" />
              <span className="font-mono text-[10px] text-green tracking-widest uppercase">
                Last order · {recentOrder.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs font-mono">
              <div><span className="text-ink-3">side </span><span className="text-ink uppercase">{recentOrder.side}</span></div>
              <div><span className="text-ink-3">type </span><span className="text-ink">{recentOrder.type}</span></div>
              <div><span className="text-ink-3">filled </span><span className="text-ink tabular-nums">{recentOrder.filled.toFixed(6)} {baseAsset}</span></div>
              <div><span className="text-ink-3">avg </span><span className="text-ink tabular-nums">{recentOrder.average?.toFixed(2) ?? "—"}</span></div>
              <div className="col-span-2 truncate"><span className="text-ink-3">id </span><span className="text-ink">{recentOrder.id}</span></div>
            </div>
          </div>
        )}
      </motion.div>

      <CexOrderConfirm
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        exchangeId={exchangeId}
        credentials={credentials}
        symbol={symbol}
        side={side}
        amount={amountNum}
        referencePrice={referencePrice}
        baseAsset={baseAsset}
        quoteAsset={quoteAsset}
        onConfirmed={onConfirmed}
      />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between min-w-0">
      <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{label}</span>
      <span className="font-mono text-[11px] text-ink tabular-nums truncate ml-2">{value}</span>
    </div>
  );
}

function BookSide({
  label, tone, rows, referencePrice, quote,
}: {
  label:          string;
  tone:           "red" | "green";
  rows:           { price: number; amount: number }[];
  referencePrice: number;
  quote:          string;
}) {
  void quote;
  const total = rows.reduce((acc, r) => acc + r.amount, 0);
  const toneText = tone === "red" ? "text-red" : "text-green";
  const toneBg   = tone === "red" ? "bg-red/[0.04]" : "bg-green/[0.04]";

  return (
    <div className="min-w-0">
      <div className={cn("font-mono text-[9px] tracking-widest uppercase mb-1", toneText)}>{label}</div>
      <div className="space-y-0.5">
        {rows.slice(0, 8).map((r, i) => {
          const widthPct = total > 0 ? (r.amount / total) * 100 : 0;
          return (
            <div key={i} className="relative px-2 py-1 rounded-sm font-mono text-[10px] flex items-center justify-between tabular-nums min-w-0">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-sm", toneBg)}
                style={{ width: `${Math.min(100, widthPct)}%` }}
              />
              <span className={cn("relative truncate", toneText)}>{r.price.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
              <span className="relative text-ink-3 truncate ml-2">{r.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">
        ref <span className="text-ink tabular-nums">{referencePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
      </div>
    </div>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "auth_failed":         return "Authentication rejected. Check the saved keys in Settings.";
    case "ip_not_whitelisted":  return "Your IP isn't whitelisted by this key.";
    case "permission_denied":   return "The API key lacks the required scope.";
    case "rate_limited":        return "Slow down — rate-limited by the exchange.";
    case "symbol_not_found":    return "Symbol not listed on this exchange.";
    case "timeout":             return "Exchange timed out.";
    case "upstream_failed":     return "Exchange call failed — try again in a moment.";
    default:                    return code;
  }
}
