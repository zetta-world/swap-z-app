"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────

export type TxType =
  | "dex_swap"       // Same-chain DEX swap (0x, Jupiter)
  | "dex_bridge"     // Cross-chain bridge (LiFi)
  | "cex_spot"       // CEX spot order (manual)
  | "cex_futures"    // CEX futures position
  | "autopilot_dex"  // DEX swap fired by autopilot
  | "autopilot_cex"  // CEX order fired by autopilot
  | "autopilot_arb"  // Arbitrage fired by autopilot
  | "rebalance"      // CEX→wallet rebalance (internal repositioning)
  | "deposit"        // Capital in: wallet→CEX or external→wallet (not a trade)
  | "withdraw";      // Capital out: CEX→wallet or wallet→external (not a trade)

export type TxStatus = "pending" | "confirmed" | "failed" | "canceled";

export interface TxHistoryEntry {
  id:          string;
  ts:          number;   // unix ms
  type:        TxType;
  status:      TxStatus;

  // Token pair
  fromSymbol:  string;
  fromChain:   string;
  fromAmount:  string;   // decimal string
  toSymbol:    string;
  toChain:     string;
  toAmount?:   string;   // filled after confirmation

  // Economics
  valueUsd?:   number;   // fromAmount × price at time
  feesUsd?:    number;   // all fees paid (gas + bridge + CEX taker)
  pnlUsd?:     number;   // realized P&L (for futures / arb)

  // On-chain / CEX refs
  txHash?:     string;
  exchange?:   string;   // CEX id for CEX trades
  orderId?:    string;   // CEX order id
  route?:      string;   // "0x" | "lifi" | "jupiter" | "gateio" | etc.
  notes?:      string;   // ZION card title or description

  // Futures extras
  leverage?:   number;
  liqPrice?:   string;
}

interface TxHistoryState {
  entries:  TxHistoryEntry[];
  push:     (entry: Omit<TxHistoryEntry, "id" | "ts">) => string;
  update:   (id: string, patch: Partial<TxHistoryEntry>) => void;
  remove:   (id: string) => void;
  clear:    () => void;
}

function genId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Persisted to localStorage — bounded at 500 entries (FIFO).
export const useTxHistory = create<TxHistoryState>()(
  persist(
    (set) => ({
      entries: [],

      push: (entry) => {
        const id = genId();
        set((s) => ({
          entries: [
            { ...entry, id, ts: Date.now() },
            ...s.entries,
          ].slice(0, 500),
        }));
        return id;
      },

      update: (id, patch) => {
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        }));
      },

      remove: (id) => {
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
      },

      clear: () => set({ entries: [] }),
    }),
    {
      name: "zswap_tx_history_v1",
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);

// ─── Helpers ──────────────────────────────────────────────────────────────

export const TX_TYPE_LABELS: Record<TxType, string> = {
  dex_swap:       "DEX Swap",
  dex_bridge:     "Bridge",
  cex_spot:       "CEX Spot",
  cex_futures:    "CEX Futures",
  autopilot_dex:  "Autopilot DEX",
  autopilot_cex:  "Autopilot CEX",
  autopilot_arb:  "Autopilot Arb",
  rebalance:      "Rebalance",
  deposit:        "Deposit",
  withdraw:       "Withdraw",
};

export const TX_TYPE_LABELS_PT: Record<TxType, string> = {
  dex_swap:       "Swap DEX",
  dex_bridge:     "Bridge",
  cex_spot:       "CEX Spot",
  cex_futures:    "CEX Futuros",
  autopilot_dex:  "Autopilot DEX",
  autopilot_cex:  "Autopilot CEX",
  autopilot_arb:  "Autopilot Arb",
  rebalance:      "Rebalance",
  deposit:        "Depósito",
  withdraw:       "Saque",
};

export const STATUS_LABELS_PT: Record<TxStatus, string> = {
  pending:   "Pendente",
  confirmed: "Confirmada",
  failed:    "Falhou",
  canceled:  "Cancelada",
};
