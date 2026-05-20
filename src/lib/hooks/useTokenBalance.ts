"use client";

import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useMemo } from "react";
import { WAGMI_CHAIN_IDS } from "@/lib/wagmi";
import type { Token } from "@/lib/tokens";

export interface TokenBalance {
  raw:        bigint;
  formatted:  string;
  decimals:   number;
  symbol:     string;
  loading:    boolean;
  error:      string | null;
  isZero:     boolean;
  /** UI-formatted with up to 6 decimals stripped of trailing zeros */
  display:    string;
  usdValue:   number | null;
}

/**
 * Fetch the connected wallet's balance of a specific token on the token's
 * native chain. Uses wagmi's `useBalance` (multicall under the hood for
 * ERC-20s) and computes a UI-friendly formatted string.
 *
 * Returns `loading: true` while connecting / fetching, and `null`-safe
 * defaults (zero balance) when wallet is disconnected — so the caller can
 * always trust `.display` to render.
 */
export function useTokenBalance(token: Token | undefined): TokenBalance {
  const { address, isConnected } = useAccount();

  // For EVM, get the wagmi numeric chainId for the token's chain
  const wagmiChainId = token ? WAGMI_CHAIN_IDS[token.chain] : undefined;
  const isEvmSupported = !!wagmiChainId;

  // Only enable the query when we have a wallet + an EVM token
  const enabled = !!(address && token && isEvmSupported);

  const { data, isLoading, error } = useBalance({
    address,
    token:   token?.address === "native" ? undefined : (token?.address as `0x${string}` | undefined),
    chainId: wagmiChainId,
    query: { enabled, staleTime: 15_000 },
  });

  return useMemo<TokenBalance>(() => {
    const decimals = data?.decimals ?? token?.decimals ?? 18;
    const symbol   = data?.symbol   ?? token?.symbol   ?? "";
    if (!isConnected || !enabled) {
      return {
        raw:       0n,
        formatted: "0",
        decimals,
        symbol,
        loading:   false,
        error:     null,
        isZero:    true,
        display:   "—",
        usdValue:  null,
      };
    }
    if (isLoading) {
      return {
        raw:       0n,
        formatted: "0",
        decimals,
        symbol,
        loading:   true,
        error:     null,
        isZero:    true,
        display:   "…",
        usdValue:  null,
      };
    }
    if (error) {
      return {
        raw:       0n,
        formatted: "0",
        decimals,
        symbol,
        loading:   false,
        error:     error.message,
        isZero:    true,
        display:   "—",
        usdValue:  null,
      };
    }
    const raw       = data?.value ?? 0n;
    const formatted = formatUnits(raw, decimals);
    const num       = Number(formatted);
    const usdValue  = token?.priceUsd ? num * token.priceUsd : null;
    return {
      raw,
      formatted,
      decimals,
      symbol,
      loading:  false,
      error:    null,
      isZero:   raw === 0n,
      display:  formatDisplay(num),
      usdValue,
    };
  }, [data, isLoading, error, enabled, isConnected, token]);
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
