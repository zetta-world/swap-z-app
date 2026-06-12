"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Portfolio balance snapshots — powers the "Evolução do saldo" card.
 *
 * PortfolioView calls record() every time the live totals settle; the
 * store throttles writes so the series stays compact:
 *   - never more than one snapshot per 5 minutes
 *   - quiet periods (move < 0.5%) record at most every 30 minutes
 *   - capped at 2000 entries (~40 days of dense data) in localStorage
 *
 * Snapshots are local-only — nothing leaves the device.
 */

export interface PortfolioSnapshot {
  ts:        number;  // unix ms
  totalUsd:  number;  // wallet + CEX
  walletUsd: number;
  cexUsd:    number;
}

interface PortfolioHistoryState {
  snapshots: PortfolioSnapshot[];
  record: (totalUsd: number, walletUsd: number, cexUsd: number) => void;
  clear:  () => void;
}

const MIN_INTERVAL_MS   = 5 * 60_000;   // hard floor between writes
const QUIET_INTERVAL_MS = 30 * 60_000;  // floor when value barely moved
const QUIET_THRESHOLD   = 0.005;        // <0.5% move counts as quiet
const MAX_SNAPSHOTS     = 2000;

export const usePortfolioHistory = create<PortfolioHistoryState>()(
  persist(
    (set, get) => ({
      snapshots: [],

      record: (totalUsd, walletUsd, cexUsd) => {
        if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;
        const { snapshots } = get();
        const last = snapshots[snapshots.length - 1];
        const now = Date.now();
        if (last) {
          const age = now - last.ts;
          if (age < MIN_INTERVAL_MS) return;
          const movePct = last.totalUsd > 0
            ? Math.abs(totalUsd - last.totalUsd) / last.totalUsd
            : 1;
          if (age < QUIET_INTERVAL_MS && movePct < QUIET_THRESHOLD) return;
        }
        set({
          snapshots: [...snapshots, { ts: now, totalUsd, walletUsd, cexUsd }]
            .slice(-MAX_SNAPSHOTS),
        });
      },

      clear: () => set({ snapshots: [] }),
    }),
    {
      name: "zswap_portfolio_history_v1",
      partialize: (s) => ({ snapshots: s.snapshots }),
    },
  ),
);
