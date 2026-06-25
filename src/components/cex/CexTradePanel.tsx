"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, ArrowDownUp, RefreshCw, BookOpen, AlertTriangle, Wallet, ChevronDown, LayoutGrid,
} from "lucide-react";
import CexPairSelector from "./CexPairSelector";
import { toast } from "sonner";
import {
  CEX_META, type CexId, type CexCredentials, type CexBalance,
  type CexOrderbookSnapshot, type CexOrderSide, type CexOrder,
} from "@/lib/cex/types";
import CexOrderConfirm from "./CexOrderConfirm";
import { compactNumber } from "@/lib/format";
import { useT, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useTxHistory } from "@/lib/store/txHistory";

const SUGGESTED_SYMBOLS: Record<CexId, string[]> = {
  binance:  ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ARB/USDT"],
  coinbase: ["BTC/USD",  "ETH/USD",  "SOL/USD",  "MATIC/USD", "AVAX/USD", "LINK/USD"],
  okx:      ["BTC/USDT", "ETH/USDT", "SOL/USDT", "OKB/USDT", "DOGE/USDT", "TON/USDT"],
  bybit:    ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BIT/USDT", "TON/USDT",  "ARB/USDT"],
  kraken:   ["XBT/USD",  "ETH/USD",  "SOL/USD",  "DOT/USD",  "ADA/USD",   "ATOM/USD"],
  kucoin:   ["BTC/USDT", "ETH/USDT", "SOL/USDT", "KCS/USDT", "DOGE/USDT", "MATIC/USDT"],
  bitfinex: ["BTC/USD",  "ETH/USD",  "SOL/USD",  "LEO/USD",  "XAUT/USD",  "ALGO/USD"],
  mexc:     ["BTC/USDT", "ETH/USDT", "SOL/USDT", "MX/USDT",  "DOGE/USDT", "PEPE/USDT"],
  gateio:   ["BTC/USDT", "ETH/USDT", "SOL/USDT", "GT/USDT",  "DOGE/USDT", "ARB/USDT"],
  htx:      ["BTC/USDT", "ETH/USDT", "SOL/USDT", "HT/USDT",  "DOGE/USDT", "TRX/USDT"],
};

const ORDERBOOK_POLL_MS = 5_000;

interface Props {
  exchangeId:    CexId;
  credentials:   CexCredentials;
  /** Pre-filled symbol from a deep-link (e.g. SwapCard → /cex). */
  initialSymbol?: string;
  /** Pre-filled side (buy / sell) from a deep-link. */
  initialSide?:  "buy" | "sell";
}

/**
 * Live trade panel for one connected CEX. Polls the orderbook every 5s,
 * lets the user pick side/amount, and routes the final submit through
 * CexOrderConfirm which adds a 3-second cooldown + literal "I-CONFIRM-REAL-ORDER"
 * payload before the order hits the exchange.
 */
export default function CexTradePanel({
  exchangeId, credentials, initialSymbol, initialSide,
}: Props) {
  const meta = CEX_META[exchangeId];
  const t    = useT();

  // Inputs — honor deep-link prefill on first render
  const [symbol, setSymbol] = useState<string>(initialSymbol ?? SUGGESTED_SYMBOLS[exchangeId][0]);
  const [side,   setSide]   = useState<CexOrderSide>(initialSide ?? "buy");
  const [type,   setType]   = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState<string>("");
  const [limitPrice, setLimitPrice] = useState<string>("");

  // Live data
  const [orderbook, setOrderbook] = useState<CexOrderbookSnapshot | null>(null);
  const [obLoading, setObLoading] = useState(false);
  const [obError,   setObError]   = useState<string | null>(null);
  const [balances,  setBalances]  = useState<CexBalance[]>([]);
  const [bLoading,  setBLoading]  = useState(false);

  // Confirm modal
  const [confirmOpen,   setConfirmOpen]   = useState(false);
  // Pair selector modal
  const [selectorOpen,  setSelectorOpen]  = useState(false);

  // Track open orders refresh trigger after a successful place
  const [recentOrder, setRecentOrder] = useState<CexOrder | null>(null);
  const { push: pushHistory } = useTxHistory();

  // ─── Orderbook polling ──────────────────────────────────────────────
  const loadOrderbook = useCallback(async (signal?: AbortSignal) => {
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
        signal,
      });
      const body = await res.json() as CexOrderbookSnapshot & { error?: string };
      if (!res.ok || !body.ok) throw new Error(humanError(body.error ?? `HTTP ${res.status}`));
      setOrderbook(body);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setObError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal?.aborted) setObLoading(false);
    }
  }, [exchangeId, symbol, credentials]);

  // Initial fetch + poll. The AbortController guards against responses from
  // the prior symbol/exchange clobbering the new one's state when the user
  // switches mid-flight.
  useEffect(() => {
    const ctrl = new AbortController();
    void loadOrderbook(ctrl.signal);
    const id = setInterval(() => loadOrderbook(ctrl.signal), ORDERBOOK_POLL_MS);
    return () => {
      clearInterval(id);
      ctrl.abort();
    };
  }, [loadOrderbook]);

  // ─── Balances ───────────────────────────────────────────────────────
  const loadBalances = useCallback(async (signal?: AbortSignal) => {
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
        signal,
      });
      const body = await res.json() as { ok: boolean; balances?: CexBalance[]; error?: string };
      if (res.ok && body.ok && body.balances) setBalances(body.balances);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      /* swallow non-abort balance errors — sticky balances UI is acceptable */
    } finally {
      if (!signal?.aborted) setBLoading(false);
    }
  }, [exchangeId, credentials]);

  useEffect(() => {
    const ctrl = new AbortController();
    void loadBalances(ctrl.signal);
    return () => ctrl.abort();
  }, [loadBalances]);

  // ─── Derived ───────────────────────────────────────────────────────
  const baseAsset  = symbol.split(/[\/\-]/)[0];
  const quoteAsset = symbol.split(/[\/\-]/)[1];

  const baseBalance  = balances.find((b) => b.asset === baseAsset);
  const quoteBalance = balances.find((b) => b.asset === quoteAsset);

  const amountNum    = parseFloat(amount) || 0;
  const limitPriceNum = parseFloat(limitPrice) || 0;
  const marketRefPrice =
    side === "buy"  ? orderbook?.bestAsk ?? 0
                    : orderbook?.bestBid ?? 0;
  // For market orders, reference = top of book on the relevant side
  // For limit orders, reference = the user-set price (used for cost preview)
  const referencePrice = type === "limit" && limitPriceNum > 0
    ? limitPriceNum
    : marketRefPrice;
  const estCostQuoteRaw = amountNum * referencePrice;
  const estCostQuote = Number.isFinite(estCostQuoteRaw) ? estCostQuoteRaw : 0;

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
        w.push(t("cex.warningTopBook", { qty: consumed.toFixed(4), base: baseAsset }));
      } else if (referencePrice > 0) {
        const slip = Math.abs(worstPrice - referencePrice) / referencePrice;
        if (slip > 0.005) {
          w.push(t("cex.warningSlippage", { pct: (slip * 100).toFixed(2) }));
        }
      }
    }
    if (side === "sell" && baseBalance && amountNum > baseBalance.free) {
      w.push(t("cex.warningSellFree", { amount: amountNum, base: baseAsset, free: baseBalance.free.toFixed(6), exchange: meta.label }));
    }
    if (side === "buy" && quoteBalance && estCostQuote > quoteBalance.free) {
      w.push(t("cex.warningBuyFree", { cost: estCostQuote.toFixed(2), quote: quoteAsset, free: quoteBalance.free.toFixed(2), exchange: meta.label }));
    }
    return w;
  }, [amountNum, orderbook, side, referencePrice, baseAsset, quoteAsset, baseBalance, quoteBalance, estCostQuote, meta.label, t]);

  // ─── Place-order outcomes ──────────────────────────────────────────
  const onConfirmed = (order: CexOrder, filledImmediately: boolean) => {
    setConfirmOpen(false);
    setRecentOrder(order);
    setAmount("");
    if (filledImmediately) {
      toast.success(t("cex.fillMarketToast", { amount: order.filled.toFixed(6), base: baseAsset, avg: order.average?.toFixed(2) ?? "—" }));
    } else {
      toast.success(t("cex.placedToast", { id: order.id.slice(0, 12) }));
    }
    void loadBalances();
    const fillPrice = order.average ?? referencePrice;
    pushHistory({
      type: "cex_spot",
      status: filledImmediately ? "confirmed" : "pending",
      fromSymbol: side === "buy" ? quoteAsset : baseAsset,
      fromChain:  exchangeId,
      fromAmount: side === "buy"
        ? (amountNum * fillPrice).toFixed(6)
        : String(amountNum),
      toSymbol:   side === "buy" ? baseAsset : quoteAsset,
      toChain:    exchangeId,
      exchange:   exchangeId,
      orderId:    order.id,
      route:      order.type,
      notes:      `${order.type} ${side} ${symbol} @ ${fillPrice.toFixed(2)}`,
    });
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
          <span className="section-label">{t("cex.placeOrder", { exchange: meta.label })}</span>
        </div>

        {/* Symbol picker */}
        <div className="min-w-0">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{t("cex.symbol")}</div>

          {/* Current pair — clickable, opens full market list */}
          <button
            type="button"
            onClick={() => setSelectorOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/8 hover:border-cyan/25 transition-colors group"
          >
            <div className="flex items-baseline gap-1 min-w-0">
              <span className="font-display font-extrabold text-base text-ink leading-none">{baseAsset}</span>
              <span className="font-mono text-xs text-ink-3">/{quoteAsset}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase hidden sm:inline">trocar</span>
              <ChevronDown className="w-3.5 h-3.5 text-ink-3 group-hover:text-cyan transition-colors" />
            </div>
          </button>

          {/* Quick-access chips + "Ver todos" */}
          <div className="mt-2 flex items-center gap-1 flex-wrap">
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
                {s.split("/")[0]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectorOpen(true)}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] text-ink-3 border border-white/5 bg-white/[0.02] hover:text-cyan hover:border-cyan/20 transition-colors"
            >
              <LayoutGrid className="w-2.5 h-2.5" />
              Ver todos
            </button>
          </div>
        </div>

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
            <TrendingUp className="w-3.5 h-3.5" /> {t("cex.sideBuy", { base: baseAsset })}
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
            <TrendingDown className="w-3.5 h-3.5" /> {t("cex.sideSell", { base: baseAsset })}
          </button>
        </div>

        {/* Order type toggle */}
        <div className="grid grid-cols-2 gap-2 p-0.5 rounded-lg bg-white/[0.03] border border-white/8">
          {(["market", "limit"] as const).map((ty) => {
            const active = type === ty;
            return (
              <button
                key={ty}
                type="button"
                onClick={() => setType(ty)}
                className={cn(
                  "py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase transition-all",
                  active
                    ? "bg-cyan/15 text-cyan border border-cyan/30"
                    : "text-ink-3 hover:text-ink-2 border border-transparent",
                )}
              >
                {ty === "market" ? t("cex.orderTypeMarket") : t("cex.orderTypeLimit")}
              </button>
            );
          })}
        </div>

        {/* Limit price (only when type === limit) */}
        {type === "limit" && (
          <label className="block min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
                {t("cex.limitPriceLabel", { quote: quoteAsset })}
              </span>
              {marketRefPrice > 0 && (
                <button
                  type="button"
                  onClick={() => setLimitPrice(String(marketRefPrice))}
                  className="font-mono text-[10px] text-cyan hover:underline tracking-wider"
                >
                  {t("cex.useMarketPrice", { price: marketRefPrice.toLocaleString("en-US", { maximumFractionDigits: 6 }) })}
                </button>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0"
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus:border-cyan/30 outline-none text-base font-display font-bold text-ink placeholder:text-ink-4 tabular-nums"
            />
            {marketRefPrice > 0 && limitPriceNum > 0 && (
              <div className="mt-1 font-mono text-[10px] text-ink-3">
                {(() => {
                  const isBuy = side === "buy";
                  const below = limitPriceNum < marketRefPrice;
                  const pct = ((below ? marketRefPrice - limitPriceNum : limitPriceNum - marketRefPrice) / marketRefPrice) * 100;
                  const pctStr = pct.toFixed(2);
                  if (isBuy)
                    return below
                      ? t("cex.limitBelowMarket", { pct: pctStr })
                      : t("cex.limitWouldFill", { pct: pctStr, dir: t("cex.limitDirAbove") });
                  return below
                    ? t("cex.limitWouldFill", { pct: pctStr, dir: t("cex.limitDirBelow") })
                    : t("cex.limitAboveMarket", { pct: pctStr });
                })()}
              </div>
            )}
          </label>
        )}

        {/* Amount */}
        <label className="block min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              {t("cex.amountLabel", { base: baseAsset })}
            </span>
            {baseBalance && (
              <button
                type="button"
                onClick={() => setAmount(String(baseBalance.free))}
                className="font-mono text-[10px] text-cyan hover:underline tracking-wider"
              >
                {t("cex.maxBalance", { amount: compactNumber(baseBalance.free) })}
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
          <PreviewRow
            label={t("cex.referencePrice")}
            value={referencePrice > 0 ? `${referencePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${quoteAsset}` : "—"}
          />
          <PreviewRow
            label={side === "buy" ? t("cex.youSpend") : t("cex.youReceive")}
            value={amountNum > 0 && referencePrice > 0 ? `${estCostQuote.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quoteAsset}` : "—"}
          />
          <PreviewRow
            label={t("cex.orderTypeNote")}
            value={type === "market" ? t("cex.marketDesc") : t("cex.limitDesc")}
          />
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
          disabled={
            amountNum <= 0
            || marketRefPrice <= 0
            || (type === "limit" && limitPriceNum <= 0)
            || obError !== null
          }
          className={cn(
            "w-full py-3 rounded-lg font-display font-extrabold text-sm tracking-wide flex items-center justify-center gap-2 transition-all",
            side === "buy"
              ? "bg-green text-bg hover:opacity-90 disabled:bg-green/40"
              : "bg-red text-bg hover:opacity-90 disabled:bg-red/40",
            "disabled:cursor-not-allowed",
          )}
        >
          {amountNum > 0
            ? t("cex.reviewBtn",      { side: side === "buy" ? "BUY" : "SELL", amount, base: baseAsset })
            : t("cex.reviewBtnEmpty", { side: side === "buy" ? "BUY" : "SELL", base: baseAsset })}
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
              <span className="section-label">{t("cex.orderbookTitle", { symbol })}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadOrderbook()}
              disabled={obLoading}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-3 hover:text-cyan tracking-widest uppercase"
            >
              <RefreshCw className={cn("w-3 h-3", obLoading && "animate-spin")} />
              {obLoading ? t("cex.fetching") : t("cex.refreshShort")}
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
                label={t("cex.asksLabel")}
                tone="red"
                rows={orderbook.asks}
                referencePrice={orderbook.bestAsk}
                quote={quoteAsset}
              />
              <BookSide
                label={t("cex.bidsLabel")}
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
                {t("cex.mid")} <span className="text-ink">${orderbook.mid.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
              </div>
              <div className="font-mono text-[10px] text-ink-3">
                {t("cex.spread")} <span className="text-ink">{((orderbook.bestAsk - orderbook.bestBid) / orderbook.mid * 100).toFixed(3)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Balances */}
        <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 min-w-0">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-gold" />
              <span className="section-label">{t("cex.availableTitle", { exchange: meta.label })}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadBalances()}
              disabled={bLoading}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-3 hover:text-gold tracking-widest uppercase"
            >
              <RefreshCw className={cn("w-3 h-3", bLoading && "animate-spin")} />
              {bLoading ? t("cex.fetching") : t("cex.refreshShort")}
            </button>
          </div>
          {balances.length === 0
            ? <p className="font-mono text-[11px] text-ink-3">{t("cex.noBalances")}</p>
            : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {balances.slice(0, 9).map((b) => (
                  <div key={b.asset} className="rounded-lg border border-white/5 bg-bg-1/30 px-2.5 py-2 min-w-0">
                    <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{b.asset}</div>
                    <div className="priv-value font-display font-bold text-sm text-ink truncate tabular-nums">
                      {compactNumber(b.total)}
                    </div>
                    {b.usdValue !== undefined && b.usdValue > 0.01 && (
                      <div className="priv-value font-mono text-[10px] text-ink-3 tabular-nums">${compactNumber(b.usdValue)}</div>
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
                {t("cex.lastOrderTitle", { status: recentOrder.status })}
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
        type={type}
        amount={amountNum}
        limitPrice={type === "limit" ? limitPriceNum : undefined}
        referencePrice={referencePrice}
        baseAsset={baseAsset}
        quoteAsset={quoteAsset}
        onConfirmed={onConfirmed}
      />

      <CexPairSelector
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        exchangeId={exchangeId}
        credentials={credentials}
        currentSymbol={symbol}
        onSelect={setSymbol}
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
  const tImp = useT();
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
        {tImp("cex.ref")} <span className="text-ink tabular-nums">{referencePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
      </div>
    </div>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "auth_failed":         return t("cex.errAuthFailed");
    case "ip_not_whitelisted":  return t("cex.errIpWhitelist");
    case "permission_denied":   return t("cex.errPermDenied");
    case "rate_limited":        return t("cex.errRateLimit");
    case "symbol_not_found":    return t("cex.errSymbolNotFound");
    case "timeout":             return t("cex.errTimeout");
    case "upstream_failed":     return t("cex.errUpstreamFailed");
    default:
      if (code.startsWith("passphrase_required_for_")) {
        const ex = code.slice("passphrase_required_for_".length);
        return t("cex.errPassReqGeneric", { label: ex.toUpperCase() });
      }
      return code;
  }
}
