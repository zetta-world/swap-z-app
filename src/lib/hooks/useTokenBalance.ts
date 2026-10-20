"use client";

import { useAccount, useBalance } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useMemo } from "react";
import { WAGMI_CHAIN_IDS } from "@/lib/wagmi";
import type { Token } from "@/lib/tokens";
import { buscarSaldoSolana, chaveSaldoSolana, ErroSaldo } from "@/lib/solana/saldo-cliente";

/**
 * Estado do saldo (W1, 20/10). ⚠️ "Não sei" nunca é "zero":
 *   DISCONNECTED   — carteira da família do token não conectada
 *   LOADING        — primeira leitura em curso
 *   READY_ZERO     — a rede respondeu: zero (inclusive "nenhuma conta desse token")
 *   READY_POSITIVE — a rede respondeu: saldo > 0
 *   STALE          — a última atualização falhou; mostra o último valor LIDO PARA ESTA CONTA
 *   ERROR          — nunca houve leitura válida para esta conta
 */
export type StatusSaldo = "DISCONNECTED" | "LOADING" | "READY_ZERO" | "READY_POSITIVE" | "STALE" | "ERROR";

export interface TokenBalance {
  status:     StatusSaldo;
  raw:        bigint;
  formatted:  string;
  decimals:   number;
  symbol:     string;
  loading:    boolean;
  /** Preenchido em ERROR e STALE — quem soma patrimônio trata os dois como "indisponível". */
  error:      string | null;
  /** Só `true` em READY_ZERO. Erro NÃO é zero. */
  isZero:     boolean;
  /** UI-formatted with up to 6 decimals stripped of trailing zeros */
  display:    string;
  usdValue:   number | null;
  /** Atualização manual (botão "tentar de novo"). */
  refetch:    () => void;
}

/**
 * Opções da leitura Solana — as MESMAS para todo leitor (Swap, Portfólio, chip): mesma chave = uma
 * leitura compartilhada. Retry só em falha transitória (no máximo 2); volta ao app relê se passou
 * do `staleTime`; sem polling.
 */
export function opcoesSaldoSolana(owner: string, mint: string) {
  return {
    queryKey: chaveSaldoSolana(owner, mint),
    queryFn:  ({ signal }: { signal?: AbortSignal }) => buscarSaldoSolana(owner, mint, signal),
    staleTime: 15_000,
    gcTime:    5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect:   true,
    retry: (falhas: number, err: unknown) => err instanceof ErroSaldo && err.transitorio && falhas < 2,
    retryDelay: (n: number) => Math.min(1_000 * 2 ** n, 5_000),
  };
}

/** Saldo utilizável para 25%/50%/MAX: lido, desta conta, positivo. */
export const saldoPronto = (b: TokenBalance | undefined): b is TokenBalance => b?.status === "READY_POSITIVE";

/**
 * Saldo da carteira conectada para um token.
 *
 * EVM: `useBalance` do wagmi. Solana: `/api/solana/saldo` (servidor) via TanStack Query — a chave
 * é (dono, mint), então Swap, Portfólio e chip compartilham UMA leitura, a troca de conta nunca
 * mostra o saldo da conta anterior, e a resposta é conferida contra o dono pedido.
 *
 * Retry só em falha transitória (429/timeout/queda/5xx), no máximo 2. Atualiza ao reconectar, ao
 * voltar para o app (limitado pelo `staleTime`) e quando um swap confirma (`ExecuteSwap`). Sem polling.
 *
 * `livePriceUsd`: preço ao vivo opcional; `undefined` usa o `priceUsd` da lista, `null` = sem preço.
 */
export function useTokenBalance(token: Token | undefined, livePriceUsd?: number | null): TokenBalance {
  const isSolana = token?.chain === "solana";

  // ─── EVM branch (always called; gated by `enabled`) ───────────────
  const { address: evmAddr, isConnected: evmConnected } = useAccount();
  const wagmiChainId = token && !isSolana ? WAGMI_CHAIN_IDS[token.chain] : undefined;
  const evmEnabled = !!(evmAddr && token && !isSolana && wagmiChainId);
  const evmRes = useBalance({
    address: evmAddr,
    token:   token?.address === "native" || isSolana
      ? undefined
      : (token?.address as `0x${string}` | undefined),
    chainId: wagmiChainId,
    query: { enabled: evmEnabled, staleTime: 15_000 },
  });

  // ─── Solana branch (always called; gated by `enabled`) ────────────
  const { publicKey, connected: solConnected } = useWallet();
  const owner = solConnected && publicKey ? publicKey.toBase58() : undefined;
  const mint  = isSolana && token ? (token.address === "native" ? "native" : token.address) : undefined;
  const solEnabled = !!(isSolana && owner && mint);
  const solQ = useQuery({ ...opcoesSaldoSolana(owner ?? "", mint ?? ""), enabled: solEnabled });

  return useMemo<TokenBalance>(() => {
    if (!token) return semCarteira(18, "", () => {});
    const effectivePriceUsd =
      livePriceUsd === undefined ? (token.priceUsd ?? null) : livePriceUsd;
    if (isSolana) {
      return montarSaldo(token, effectivePriceUsd, {
        habilitado: solEnabled,
        dados: solQ.data ? { raw: solQ.data.raw, decimals: solQ.data.decimals, symbol: null } : undefined,
        erro: solQ.isError ? tipoDoErro(solQ.error) : null,
        refetch: () => { void solQ.refetch(); },
      });
    }
    const d = evmRes.data;
    return montarSaldo(token, effectivePriceUsd, {
      habilitado: evmConnected && evmEnabled,
      dados: d ? { raw: d.value, decimals: d.decimals ?? null, symbol: d.symbol ?? null } : undefined,
      erro: evmRes.isError ? (evmRes.error?.message ?? "erro") : null,
      refetch: () => { void evmRes.refetch(); },
    });
  }, [
    token, isSolana, livePriceUsd, solEnabled,
    solQ.data, solQ.isError, solQ.error, solQ.refetch,
    evmRes.data, evmRes.isError, evmRes.error, evmRes.refetch, evmConnected, evmEnabled,
  ]);
}

/**
 * O estado do saldo a partir da leitura — PURO (testado sem React).
 * Sem carteira → DISCONNECTED; sem dado: erro → ERROR, senão LOADING; com dado: erro novo → STALE,
 * senão READY_ZERO/READY_POSITIVE. O dado é sempre da chave (dono, mint) atual: o de outra conta
 * nunca chega aqui.
 */
export function montarSaldo(token: Token, priceUsd: number | null, leitura: {
  habilitado: boolean;
  dados: { raw: bigint; decimals: number | null; symbol: string | null } | undefined;
  erro: string | null;
  refetch: () => void;
}): TokenBalance {
  const { habilitado, dados, erro, refetch } = leitura;
  if (!habilitado) return semCarteira(token.decimals, token.symbol, refetch);
  if (!dados) return erro ? comErro(token.decimals, token.symbol, erro, refetch) : carregando(token.decimals, token.symbol, refetch);
  return pronto(dados.raw, dados.decimals ?? token.decimals, dados.symbol ?? token.symbol, priceUsd, refetch, erro);
}

const tipoDoErro = (e: unknown) => (e instanceof ErroSaldo ? e.tipo : "erro");

// ─── Helpers ───────────────────────────────────────────────────────────

function semCarteira(decimals: number, symbol: string, refetch: () => void): TokenBalance {
  return {
    status: "DISCONNECTED", raw: 0n, formatted: "0", decimals, symbol,
    loading: false, error: null, isZero: false,
    display: "—", usdValue: null, refetch,
  };
}
function carregando(decimals: number, symbol: string, refetch: () => void): TokenBalance {
  return {
    status: "LOADING", raw: 0n, formatted: "0", decimals, symbol,
    loading: true, error: null, isZero: false,
    display: "…", usdValue: null, refetch,
  };
}
/** ⚠️ Erro sem leitura anterior: `raw` 0 só para satisfazer o tipo — `isZero` é FALSE e o display é "—". */
function comErro(decimals: number, symbol: string, msg: string, refetch: () => void): TokenBalance {
  return {
    status: "ERROR", raw: 0n, formatted: "0", decimals, symbol,
    loading: false, error: msg, isZero: false,
    display: "—", usdValue: null, refetch,
  };
}
/** Leitura válida desta conta; com `erroNovo` ela é STALE (a atualização seguinte falhou). */
function pronto(raw: bigint, decimals: number, symbol: string, priceUsd: number | null,
  refetch: () => void, erroNovo: string | null): TokenBalance {
  const formatted = formatUnits(raw, decimals);
  const num = Number(formatted);
  return {
    status: erroNovo ? "STALE" : raw === 0n ? "READY_ZERO" : "READY_POSITIVE",
    raw, formatted, decimals, symbol,
    loading: false, error: erroNovo, isZero: !erroNovo && raw === 0n,
    display: formatDisplay(num),
    usdValue: priceUsd !== null ? num * priceUsd : null,
    refetch,
  };
}

function formatDisplay(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0)              return "0";
  if (n < 0.0001)           return n.toExponential(2);
  if (n < 1)                return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (n < 1_000)            return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (n < 1_000_000)        return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (n / 1_000_000).toFixed(2) + "M";
}
