"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CexId } from "@/lib/cex/types";

/**
 * ZION Autopilot — opt-in auto-execution of ZION action cards against
 * connected CEX accounts.
 *
 * Threat model (read before changing anything):
 *   - Default OFF. Master toggle is gated by a confirmation dialog the
 *     first time it's flipped. Re-confirms whenever it's been off > 24h.
 *   - Hard caps the user CANNOT bypass without re-confirming:
 *       • maxTradeUsd      — single-trade USD ceiling
 *       • maxTradesPerDay  — count ceiling, resets at UTC midnight
 *       • dailyLossStopUsd — cumulative realized + estimated unreal'd
 *                            loss for the day; once crossed, autopilot
 *                            freezes itself OFF until midnight.
 *   - Per-fire countdown (default 30 s) gives the user a chance to
 *     cancel ANY individual trade. The countdown banner is the only
 *     UI surface that fires the trade — there is no "execute now"
 *     button on autopilot, by design.
 *   - allowedExchanges / allowedSymbols are explicit whitelists. ZION
 *     cards that don't fit are still rendered for manual execution; the
 *     autopilot just skips them.
 *
 * Everything persists to localStorage so the rules survive reloads.
 * The trade history log is bounded at 200 entries (FIFO).
 */

export type AutopilotRiskMode = "conservador" | "moderado" | "agressivo";

export const AUTOPILOT_RISK_PRESETS: Record<AutopilotRiskMode, {
  maxTradeUsd:       number;
  maxTradesPerDay:   number;
  dailyLossStopUsd:  number;
  countdownMs:       number;
  allowedSymbols:    string[];
}> = {
  conservador: {
    maxTradeUsd:      25,
    maxTradesPerDay:  3,
    dailyLossStopUsd: 20,
    countdownMs:      60_000,
    allowedSymbols:   ["BTC", "ETH", "SOL"],
  },
  moderado: {
    maxTradeUsd:      50,
    maxTradesPerDay:  5,
    dailyLossStopUsd: 40,
    countdownMs:      30_000,
    allowedSymbols:   ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK"],
  },
  agressivo: {
    maxTradeUsd:      100,
    maxTradesPerDay:  8,
    dailyLossStopUsd: 60,
    countdownMs:      15_000,
    allowedSymbols:   ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "UNI", "DOGE", "ARB", "OP"],
  },
};

export const AUTOPILOT_MAJOR_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "AVAX", "MATIC", "POL", "ARB", "OP",
  "LINK", "UNI", "AAVE", "PEPE", "WIF", "DOGE",
] as const;

export interface AutopilotEntry {
  ts:         number;
  exchange:   CexId;
  symbol:     string;
  side:       "buy" | "sell";
  type:       "market" | "limit";
  amount:     number;
  price?:     number;
  status:     "fired" | "rejected" | "canceled" | "errored";
  orderId?:   string;
  cardKind:   string;
  cardTitle:  string;
  /** When status="rejected" or "errored", why. */
  reason?:    string;
}

interface AutopilotState {
  enabled:           boolean;
  countdownMs:       number;
  maxTradeUsd:       number;
  maxTradesPerDay:   number;
  dailyLossStopUsd:  number;
  allowedExchanges:  CexId[];
  allowedSymbols:    string[];
  /**
   * Auto-rebalance — a separate opt-in that lets the autopilot fire a
   * CEX→wallet withdrawal when ZION surfaces a `rebalance` card. Off
   * by default and persisted-as-false so a reload always resets the
   * opt-in. Trade-side rails (maxTradeUsd, maxTradesPerDay,
   * dailyLossStopUsd) DO NOT cover rebalances — they're a separate
   * cap pair below.
   */
  autoRebalanceEnabled: boolean;
  /** Per-rebalance USD ceiling. Hard cap regardless of card.from.amount. */
  maxRebalanceUsd:      number;
  /** Daily count cap on rebalance fires. */
  maxRebalancesPerDay:  number;
  /** Runtime counters — reset at UTC midnight (see noteUtcDay). */
  tradesToday:       number;
  pnlToday:          number;
  rebalancesToday:   number;
  lastResetDay:      string;
  /** Locally-only audit log of every auto-execution attempt. */
  history:           AutopilotEntry[];
  /** Set when daily loss stop fires — blocks autopilot until rolled to next day. */
  frozenUntilDay:    string | null;

  setEnabled:          (b: boolean) => void;
  setCountdownMs:      (n: number)  => void;
  setMaxTradeUsd:      (n: number)  => void;
  setMaxTradesPerDay:  (n: number)  => void;
  setDailyLossStopUsd: (n: number)  => void;
  setAllowedExchanges: (ids: CexId[]) => void;
  setAllowedSymbols:   (syms: string[]) => void;
  setAutoRebalanceEnabled: (b: boolean) => void;
  setMaxRebalanceUsd:      (n: number)  => void;
  setMaxRebalancesPerDay:  (n: number)  => void;
  /**
   * Apply a risk-mode preset in one call — sets maxTradeUsd,
   * maxTradesPerDay, dailyLossStopUsd, countdownMs, and allowedSymbols.
   * Optionally pins a single exchange in allowedExchanges.
   */
  applyRiskPreset: (mode: AutopilotRiskMode, exchangeId?: CexId) => void;
  /**
   * Append a new entry to the audit log. Caller computes everything;
   * we just FIFO-cap the list at 200 entries.
   */
  pushHistory:         (entry: AutopilotEntry) => void;
  /** Bump the daily counters when a successful auto-trade fires. */
  recordTrade:         (notionalUsd: number) => void;
  /** Bump the rebalance counter — separate from tradesToday. */
  recordRebalance:     (notionalUsd: number) => void;
  /** Adjust the daily P&L; freezes autopilot when the stop is hit. */
  recordPnl:           (deltaUsd: number) => void;
  /** Force the daily-reset check; called on app boot. */
  rolloverIfNewDay:    () => void;
  clearHistory:        () => void;
}

function utcDayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const useAutopilot = create<AutopilotState>()(
  persist(
    (set, get) => ({
      enabled:              false,
      countdownMs:          30_000,
      maxTradeUsd:          250,
      maxTradesPerDay:      6,
      dailyLossStopUsd:     200,
      allowedExchanges:     [] as CexId[],
      allowedSymbols:       ["BTC", "ETH", "SOL"],
      autoRebalanceEnabled: false,
      maxRebalanceUsd:      200,
      maxRebalancesPerDay:  2,
      tradesToday:          0,
      pnlToday:             0,
      rebalancesToday:      0,
      lastResetDay:         utcDayKey(),
      history:              [],
      frozenUntilDay:       null,

      setEnabled: (b) => {
        get().rolloverIfNewDay();
        set({ enabled: b });
      },
      setCountdownMs:      (n) => set({ countdownMs:      Math.max(5_000, Math.min(180_000, n)) }),
      setMaxTradeUsd:      (n) => set({ maxTradeUsd:      Math.max(10, Math.min(50_000, n))    }),
      setMaxTradesPerDay:  (n) => set({ maxTradesPerDay:  Math.max(1,  Math.min(50,     n))    }),
      setDailyLossStopUsd: (n) => set({ dailyLossStopUsd: Math.max(10, Math.min(100_000, n))   }),
      setAllowedExchanges: (ids)  => set({ allowedExchanges: [...new Set(ids)] }),
      setAllowedSymbols:   (syms) => set({ allowedSymbols:   [...new Set(syms.map((s) => s.toUpperCase().trim()).filter(Boolean))] }),
      setAutoRebalanceEnabled: (b) => {
        get().rolloverIfNewDay();
        set({ autoRebalanceEnabled: b });
      },
      setMaxRebalanceUsd:     (n) => set({ maxRebalanceUsd:     Math.max(10, Math.min(5_000, n)) }),
      setMaxRebalancesPerDay: (n) => set({ maxRebalancesPerDay: Math.max(1,  Math.min(20,    n)) }),

      applyRiskPreset: (mode, exchangeId) => {
        const p = AUTOPILOT_RISK_PRESETS[mode];
        set({
          maxTradeUsd:       p.maxTradeUsd,
          maxTradesPerDay:   p.maxTradesPerDay,
          dailyLossStopUsd:  p.dailyLossStopUsd,
          countdownMs:       p.countdownMs,
          allowedSymbols:    p.allowedSymbols,
          ...(exchangeId ? { allowedExchanges: [exchangeId] } : {}),
        });
      },

      pushHistory: (entry) => {
        const next = [entry, ...get().history].slice(0, 200);
        set({ history: next });
      },

      recordTrade: (notionalUsd) => {
        get().rolloverIfNewDay();
        set((s) => ({ tradesToday: s.tradesToday + 1 }));
        // Notional only counts toward the count cap; the loss-stop tracks
        // P&L explicitly via recordPnl, which the caller invokes once the
        // trade settles.
        void notionalUsd;
      },

      recordRebalance: (notionalUsd) => {
        get().rolloverIfNewDay();
        set((s) => ({ rebalancesToday: s.rebalancesToday + 1 }));
        // Rebalance USD is informational only — it doesn't fold into
        // pnlToday because the funds are just MOVING, not lost. The
        // loss-stop only triggers off trading PnL via recordPnl().
        void notionalUsd;
      },

      recordPnl: (deltaUsd) => {
        get().rolloverIfNewDay();
        const next = get().pnlToday + deltaUsd;
        set({ pnlToday: next });
        if (next <= -get().dailyLossStopUsd) {
          // Loss-stop trips BOTH the trade pilot AND auto-rebalance —
          // if the user is hemorrhaging, the last thing they need is
          // the bot also auto-moving funds between venues.
          set({ enabled: false, autoRebalanceEnabled: false, frozenUntilDay: utcDayKey() });
        }
      },

      rolloverIfNewDay: () => {
        const today = utcDayKey();
        if (get().lastResetDay !== today) {
          set({
            lastResetDay:    today,
            tradesToday:     0,
            pnlToday:        0,
            rebalancesToday: 0,
            frozenUntilDay:  get().frozenUntilDay === today ? get().frozenUntilDay : null,
          });
        }
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name:    "zswap_autopilot_v1",
      version: 1,
      // SECURITY: never persist `enabled`. If it survived a reload, auto-
      // trading would silently resume the moment the page loads — before
      // the user has a chance to see the UI or re-confirm. The daily
      // counters (tradesToday / pnlToday / lastResetDay / frozenUntilDay)
      // MUST persist, otherwise a reload would reset the caps and let a
      // user (or a runaway loop) blow past maxTradesPerDay by refreshing.
      partialize: (s) => ({
        countdownMs:         s.countdownMs,
        maxTradeUsd:         s.maxTradeUsd,
        maxTradesPerDay:     s.maxTradesPerDay,
        dailyLossStopUsd:    s.dailyLossStopUsd,
        allowedExchanges:    s.allowedExchanges,
        allowedSymbols:      s.allowedSymbols,
        maxRebalanceUsd:     s.maxRebalanceUsd,
        maxRebalancesPerDay: s.maxRebalancesPerDay,
        tradesToday:         s.tradesToday,
        pnlToday:            s.pnlToday,
        rebalancesToday:     s.rebalancesToday,
        lastResetDay:        s.lastResetDay,
        history:             s.history,
        frozenUntilDay:      s.frozenUntilDay,
        // enabled + autoRebalanceEnabled intentionally omitted → both
        // always rehydrate to false. Same reasoning: a reload should
        // never silently resume auto-execution of any kind.
      }),
    },
  ),
);
