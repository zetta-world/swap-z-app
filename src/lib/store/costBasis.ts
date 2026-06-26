"use client";

import { useMemo } from "react";
import { useTxHistory, type TxHistoryEntry } from "./txHistory";

/**
 * Realized-P&L engine — average-cost basis per asset, derived from the full
 * transaction history.
 *
 * WHY THIS EXISTS
 * A single spot buy (USDT → ETH) has no profit of its own; it's an *entry*.
 * Profit is only realized when you later *dispose* of that asset (ETH → USDT)
 * for more (or less) than it cost you. So "% profit per trade" can't be read
 * off one row — it requires matching disposals against prior acquisitions.
 *
 * MODEL
 *   - Average cost per symbol (not FIFO lots): every buy averages into the
 *     book; every sell realizes against the running average. This is the
 *     model most retail P&L tools and tax-lite reports use — simple, stable,
 *     and order-insensitive within a day.
 *   - Stablecoins are treated as cash (cost basis = $1), never the tracked
 *     asset. A USDT→ETH trade acquires ETH; the USDT leg is just the price.
 *   - Deposits seed cost basis at the USD value recorded when the transfer
 *     was made (so selling a deposited coin isn't 100% "profit"). Withdrawals
 *     remove quantity at average cost with no realized P&L (the asset merely
 *     left the tracked book; it wasn't sold).
 *   - Entries that already carry an explicit `pnlUsd` (futures / arb close out
 *     their own P&L) are passed through untouched and never touch the spot
 *     book — avoids double counting.
 *   - A trade with no `valueUsd` (some DEX swaps we can't price) is skipped
 *     rather than corrupting the book with a zero-cost lot. It simply won't
 *     show a % — honest over wrong.
 *
 * LIMITATION (documented on purpose)
 *   Cost basis is keyed by symbol across venues. If you buy ETH in-wallet AND
 *   separately deposit ETH to a CEX, both seed the book and the same coin can
 *   be counted twice. For users who trade within a venue (the common path)
 *   the numbers are correct. Treat the result as an estimate, labeled as such.
 */

const STABLES = new Set([
  "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDP", "USD", "USDE", "PYUSD",
]);

function isStable(sym: string): boolean {
  return STABLES.has(sym.toUpperCase());
}

export interface RealizedLot {
  /** Realized profit/loss in USD for this disposal. */
  realizedUsd: number;
  /** Realized P&L as a % of the cost removed. */
  realizedPct: number;
  /** USD cost basis that was removed by this disposal. */
  costUsd:     number;
}

interface Book {
  qty:  number;
  cost: number; // total USD cost of the held qty (average cost = cost / qty)
}

/**
 * Walks the history oldest→newest and returns a map of entry-id → realized lot
 * for every disposal that closed against a known cost basis. Entries not in the
 * map have no computable realized P&L (open buys, transfers, unpriced trades).
 */
export function computeRealizedPnl(entries: TxHistoryEntry[]): Map<string, RealizedLot> {
  const chrono = [...entries].sort((a, b) => a.ts - b.ts);
  const book = new Map<string, Book>();
  const out  = new Map<string, RealizedLot>();

  const acquire = (sym: string, qty: number, cost: number) => {
    if (!sym || isStable(sym) || !(qty > 0) || !(cost > 0)) return;
    const k = sym.toUpperCase();
    const b = book.get(k) ?? { qty: 0, cost: 0 };
    b.qty += qty;
    b.cost += cost;
    book.set(k, b);
  };

  /** Remove qty at average cost; returns the realized lot when proceeds given. */
  const dispose = (sym: string, qty: number, proceeds: number | null): RealizedLot | null => {
    if (!sym || isStable(sym) || !(qty > 0)) return null;
    const k = sym.toUpperCase();
    const b = book.get(k);
    if (!b || b.qty <= 0) return null; // no known cost basis to match against
    const sellQty     = Math.min(qty, b.qty);
    const avg         = b.cost / b.qty;
    const costRemoved = avg * sellQty;
    b.qty  -= sellQty;
    b.cost -= costRemoved;
    if (b.qty <= 1e-12) { b.qty = 0; b.cost = 0; }
    book.set(k, b);
    if (proceeds == null) return null; // transfer out — no realized P&L
    // Prorate proceeds when we could only match part of the sold quantity.
    const matchedProceeds = proceeds * (sellQty / qty);
    const realizedUsd = matchedProceeds - costRemoved;
    const realizedPct = costRemoved > 0 ? (realizedUsd / costRemoved) * 100 : 0;
    return { realizedUsd, realizedPct, costUsd: costRemoved };
  };

  for (const e of chrono) {
    if (e.status === "failed" || e.status === "canceled") continue;

    const value   = e.valueUsd;
    const fromQty = parseFloat(e.fromAmount);
    const toQty   = e.toAmount != null ? parseFloat(e.toAmount) : NaN;

    if (e.type === "deposit") {
      // Capital in: seed cost basis at the recorded USD value.
      if (value != null && Number.isFinite(fromQty)) acquire(e.fromSymbol, fromQty, value);
      continue;
    }
    if (e.type === "withdraw") {
      // Capital out: remove qty at average cost, no realized P&L.
      if (Number.isFinite(fromQty)) dispose(e.fromSymbol, fromQty, null);
      continue;
    }
    if (e.type === "rebalance") {
      continue; // internal repositioning — neutral for cost basis
    }

    // Futures / arb report their own realized P&L — never touch the spot book.
    if (e.pnlUsd !== undefined) continue;

    // Spot-style trade: dispose the "from" leg, acquire the "to" leg.
    if (value == null) continue; // unpriced — can't track in USD

    if (!isStable(e.fromSymbol) && Number.isFinite(fromQty)) {
      const lot = dispose(e.fromSymbol, fromQty, value);
      if (lot) out.set(e.id, lot);
    }
    if (!isStable(e.toSymbol) && Number.isFinite(toQty)) {
      acquire(e.toSymbol, toQty, value);
    }
  }

  return out;
}

/** Live realized-P&L map for the current history, memoized on entries. */
export function useRealizedPnl(): Map<string, RealizedLot> {
  const entries = useTxHistory((s) => s.entries);
  return useMemo(() => computeRealizedPnl(entries), [entries]);
}

/**
 * Effective realized P&L for one entry: an explicit `pnlUsd` (futures/arb)
 * wins; otherwise the computed spot realized value, if any. Returns undefined
 * when the trade has no realized result (open position / transfer / unpriced).
 */
export function effectiveRealizedUsd(
  entry: TxHistoryEntry,
  realized: Map<string, RealizedLot>,
): number | undefined {
  if (entry.pnlUsd !== undefined) return entry.pnlUsd;
  return realized.get(entry.id)?.realizedUsd;
}

/**
 * Effective realized P&L as a percentage for one entry. Futures use their
 * pnlUsd over notional; spot uses the matched cost basis. Undefined when not
 * computable.
 */
export function effectiveRealizedPct(
  entry: TxHistoryEntry,
  realized: Map<string, RealizedLot>,
): number | undefined {
  if (entry.pnlUsd !== undefined) {
    return entry.valueUsd && entry.valueUsd > 0 ? (entry.pnlUsd / entry.valueUsd) * 100 : undefined;
  }
  const lot = realized.get(entry.id);
  return lot ? lot.realizedPct : undefined;
}
