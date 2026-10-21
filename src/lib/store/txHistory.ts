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

/**
 * ⚠️ ETAPA DE UMA TENTATIVA DE SWAP SOLANA (W3, 21/10). O `status` acima continua valendo para
 * registros antigos e para quem só lê ele; a etapa diz O QUE de fato aconteceu:
 *
 *   solicitada     — tentativa registrada ANTES da assinatura (nada assinado ainda)
 *   cancelada      — o usuário recusou na carteira
 *   assinada       — a carteira assinou; `txHash` = assinatura pública (ainda não enviada)
 *   envio_falhou   — recusa CERTA antes de ir à rede (não transmitida) — "Falha no envio"
 *   envio_incerto  — o envio não respondeu de forma conclusiva: PODE ter sido transmitida
 *   pendente       — transmitida, aguardando confirmação
 *   confirmada     — pousou com sucesso (err nulo) — única etapa que conta volume/taxa
 *   falhou_na_rede — pousou e REVERTEU — "Transação falhou na blockchain"
 *   expirada       — o blockhash venceu sem pousar: não executou e não pode mais executar
 */
export type EtapaTx =
  | "solicitada" | "cancelada" | "assinada" | "envio_falhou" | "envio_incerto"
  | "pendente" | "confirmada" | "falhou_na_rede" | "expirada";

export function statusDaEtapa(etapa: EtapaTx): TxStatus {
  switch (etapa) {
    case "confirmada": return "confirmed";
    case "cancelada": return "canceled";
    case "envio_falhou": case "falhou_na_rede": case "expirada": return "failed";
    default: return "pending";   // solicitada, assinada, envio_incerto, pendente: desfecho ainda aberto
  }
}

/** Etapas em que a transação AINDA PODE pousar — nova tentativa da mesma carteira fica bloqueada. */
export const ETAPAS_EM_ABERTO: ReadonlySet<EtapaTx> = new Set(["assinada", "envio_incerto", "pendente"]);

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

  /**
   * ⚠️ O QUE **NÓS** RECEBEMOS — e não confundir com `feesUsd` acima (Fase 11).
   *
   * `feesUsd` é CUSTO DO USUÁRIO: gás, ponte, taker de corretora. Este é
   * RECEITA NOSSA: a taxa de integrador que o agregador reteve e mandou para
   * a carteira da plataforma. Dois campos chamados "fee" com sinais opostos —
   * somá-los transformaria custo do cliente em receita nossa.
   *
   * Vem do `fees.integratorFee` da cotação FIRME, que é o único lugar onde o
   * agregador confirma quanto reteve de fato.
   */
  platformFeeUsd?:    number;
  /** A retenção em unidades-base, como o agregador devolveu. */
  platformFeeAmount?: string;
  /** O token em que ela foi retida. */
  platformFeeToken?:  string;
  /** Os bps pedidos, para conferir a retenção contra o plano. */
  platformFeeBps?:    number;

  // On-chain / CEX refs
  /** Assinatura pública (Solana) ou hash (EVM). Nunca inventado: só existe depois de assinar. */
  txHash?:     string;
  /** Carteira que originou (W3) — impede misturar tentativas de carteiras diferentes. */
  wallet?:     string;
  /** Etapa detalhada (W3). Ausente em registros antigos. */
  etapa?:      EtapaTx;
  /** `lastValidBlockHeight` da transação Solana — para saber se ela ainda pode pousar. */
  validoAteBloco?: number;
  /** Motivo curto de falha/incerteza (sem dados sensíveis). */
  motivo?:     string;
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

/** Rótulo da ETAPA (W3) — distingue "Falha no envio" (não transmitida) de "Falhou na blockchain". */
export const ETAPA_LABELS_PT: Record<EtapaTx, string> = {
  solicitada:     "Solicitada",
  cancelada:      "Cancelada na carteira",
  assinada:       "Assinada · não enviada",
  envio_falhou:   "Falha no envio",
  envio_incerto:  "Envio incerto · verificando",
  pendente:       "Pendente",
  confirmada:     "Confirmada",
  falhou_na_rede: "Falhou na blockchain",
  expirada:       "Expirada · não executou",
};

/** Rótulo para uma linha: a etapa quando houver (W3), senão o status de sempre. */
export const rotuloDaLinha = (e: Pick<TxHistoryEntry, "status" | "etapa">) =>
  e.etapa ? ETAPA_LABELS_PT[e.etapa] : STATUS_LABELS_PT[e.status];

/** A transação pode existir na rede? Sem isso, link de explorer seria um hash que a rede não tem. */
export const podeTerIdoARede = (e: Pick<TxHistoryEntry, "txHash" | "etapa">) =>
  !!e.txHash && e.etapa !== "envio_falhou" && e.etapa !== "cancelada" && e.etapa !== "solicitada";

export const STATUS_LABELS_PT: Record<TxStatus, string> = {
  pending:   "Pendente",
  confirmed: "Confirmada",
  failed:    "Falhou",
  canceled:  "Cancelada",
};
