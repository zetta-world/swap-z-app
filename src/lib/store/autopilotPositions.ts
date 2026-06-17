"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CexId } from "@/lib/cex/types";

/**
 * Autopilot position memory.
 *
 * When the autopilot fires a BUY, it opens a position the user now holds. If
 * the browser disconnects before the matching exit is armed (phone locks,
 * tab closed), that position sits unmanaged. This store remembers WHAT was
 * bought, at WHAT price, and WHY (ZION's reasoning) so the next scan can pick
 * up where it left off and arm a profitable exit instead of treating the
 * holding as a fresh, context-free balance.
 *
 * Keyed by `${exchange}:${base}` (e.g. "gateio:SOL"). One open position per
 * base asset per exchange — a second buy of the same asset averages into the
 * same record rather than creating a duplicate.
 *
 * Persisted to localStorage so it survives the very reload that motivated it.
 */

export type PositionStatus = "open" | "exit_armed" | "closed";

export interface AutopilotPosition {
  exchange:    CexId;
  /** Base symbol, e.g. "SOL". */
  base:        string;
  /** Trading pair, e.g. "SOL/USDT". */
  pair:        string;
  /** Average entry price in quote currency. */
  entryPrice:  number;
  /** Base quantity bought (cumulative if averaged). */
  baseAmount:  number;
  /** USD notional spent on entry (cumulative). */
  costUsd:     number;
  /** ZION's reasoning for the entry (card summary slice). */
  reasoning:   string;
  /** Card title for a compact label. */
  entryLabel:  string;
  /** When the (first) entry fired. */
  entryTs:     number;
  status:      PositionStatus;
  /** Order id of the armed exit, once one is placed. */
  exitOrderId?: string;
  /** When the exit was armed. */
  exitArmedTs?: number;
}

function key(exchange: string, base: string): string {
  return `${exchange.toLowerCase()}:${base.toUpperCase()}`;
}

interface PositionsState {
  positions: Record<string, AutopilotPosition>;

  /** Record (or average into) an entry after a BUY fires. */
  recordEntry: (p: {
    exchange:   CexId;
    pair:       string;
    entryPrice: number;
    baseAmount: number;
    costUsd:    number;
    reasoning:  string;
    entryLabel: string;
  }) => void;

  /** Flag that an exit order has been armed for this position. */
  markExitArmed: (exchange: CexId, base: string, orderId: string) => void;

  /** Remove a position once it's exited / no longer held. */
  closePosition: (exchange: CexId, base: string) => void;

  /** All non-closed positions on one exchange. */
  getOpen: (exchange: CexId) => AutopilotPosition[];

  clearAll: () => void;
}

export const useAutopilotPositions = create<PositionsState>()(
  persist(
    (set, get) => ({
      positions: {},

      recordEntry: (p) => {
        const base = p.pair.split("/")[0].toUpperCase();
        const k = key(p.exchange, base);
        set((s) => {
          const prev = s.positions[k];
          // Average into an existing OPEN position; otherwise start fresh.
          if (prev && prev.status !== "closed") {
            const totalBase = prev.baseAmount + p.baseAmount;
            const totalCost = prev.costUsd + p.costUsd;
            const avgPrice  = totalBase > 0 ? totalCost / totalBase : p.entryPrice;
            return {
              positions: {
                ...s.positions,
                [k]: {
                  ...prev,
                  entryPrice: avgPrice,
                  baseAmount: totalBase,
                  costUsd:    totalCost,
                  reasoning:  p.reasoning || prev.reasoning,
                  entryLabel: p.entryLabel || prev.entryLabel,
                  status:     "open", // re-open if it had an exit armed
                },
              },
            };
          }
          return {
            positions: {
              ...s.positions,
              [k]: {
                exchange:   p.exchange,
                base,
                pair:       p.pair.toUpperCase(),
                entryPrice: p.entryPrice,
                baseAmount: p.baseAmount,
                costUsd:    p.costUsd,
                reasoning:  p.reasoning,
                entryLabel: p.entryLabel,
                entryTs:    Date.now(),
                status:     "open",
              },
            },
          };
        });
      },

      markExitArmed: (exchange, base, orderId) => {
        const k = key(exchange, base);
        set((s) => {
          const prev = s.positions[k];
          if (!prev) return s;
          return {
            positions: {
              ...s.positions,
              [k]: { ...prev, status: "exit_armed", exitOrderId: orderId, exitArmedTs: Date.now() },
            },
          };
        });
      },

      closePosition: (exchange, base) => {
        const k = key(exchange, base);
        set((s) => {
          if (!s.positions[k]) return s;
          const next = { ...s.positions };
          delete next[k];
          return { positions: next };
        });
      },

      getOpen: (exchange) =>
        Object.values(get().positions).filter(
          (p) => p.exchange === exchange && p.status !== "closed",
        ),

      clearAll: () => set({ positions: {} }),
    }),
    {
      name: "zswap_autopilot_positions_v1",
      partialize: (s) => ({ positions: s.positions }),
    },
  ),
);
