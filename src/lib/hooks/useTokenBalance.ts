"use client";

import { useAccount, useBalance } from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { formatUnits } from "viem";
import { useEffect, useMemo, useState } from "react";
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
 * Fetch the connected wallet's balance for a specific token. Branches on the
 * token's chain: EVM tokens use wagmi's useBalance (multicall under the hood);
 * Solana tokens use @solana/web3.js — native SOL via `getBalance`, SPL via
 * `getParsedTokenAccountsByOwner` (matches the mint).
 *
 * Returns `loading: true` while fetching and zero-defaults when disconnected
 * — callers can always trust `.display` to render.
 *
 * `livePriceUsd` is an optional override that takes precedence over the
 * token's bundled `priceUsd` snapshot. Callers that batch-fetch from the
 * live price feed (`useTokenPrices`) should pass the freshly-fetched
 * value here so the USD column tracks the real market instead of the
 * stale token-list snapshot.
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

  // ─── Solana branch (always called; gated internally) ──────────────
  const { publicKey, connected: solConnected } = useWallet();
  const { connection: solConnection }          = useConnection();
  const [solRaw,     setSolRaw]     = useState<bigint>(0n);
  const [solLoading, setSolLoading] = useState(false);
  const [solError,   setSolError]   = useState<string | null>(null);

  useEffect(() => {
    if (!isSolana || !token || !publicKey) {
      setSolRaw(0n);
      setSolLoading(false);
      setSolError(null);
      return;
    }
    let cancelled = false;
    setSolLoading(true);
    setSolError(null);
    (async () => {
      try {
        if (token.address === "native") {
          const lamports = await solConnection.getBalance(publicKey, "confirmed");
          if (!cancelled) setSolRaw(BigInt(lamports));
        } else {
          const mint = new PublicKey(token.address);
          const accounts = await solConnection.getParsedTokenAccountsByOwner(
            publicKey, { mint }, "confirmed",
          );
          let total = 0n;
          for (const acc of accounts.value) {
            const amt = acc.account.data.parsed?.info?.tokenAmount?.amount;
            if (amt) total += BigInt(amt);
          }
          if (!cancelled) setSolRaw(total);
        }
      } catch (e) {
        if (!cancelled) setSolError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSolLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isSolana, token, publicKey, solConnection]);

  return useMemo<TokenBalance>(() => {
    if (!token) return emptyBalance(18, "");
    const decimals = token.decimals;
    const symbol   = token.symbol;

    // Live price wins over the stale token-list snapshot. `undefined` =
    // caller didn't opt in to the live feed → fall back to token.priceUsd;
    // `null` = live feed couldn't price this token → no USD value.
    const effectivePriceUsd =
      livePriceUsd === undefined ? (token.priceUsd ?? null) : livePriceUsd;

    if (isSolana) {
      if (!solConnected || !publicKey) return emptyBalance(decimals, symbol);
      if (solLoading)                  return loadingBalance(decimals, symbol);
      if (solError)                    return errorBalance(decimals, symbol, solError);
      const formatted = token.address === "native"
        ? (Number(solRaw) / LAMPORTS_PER_SOL).toString()
        : formatUnits(solRaw, decimals);
      const num = Number(formatted);
      return {
        raw:       solRaw,
        formatted, decimals, symbol,
        loading:   false,
        error:     null,
        isZero:    solRaw === 0n,
        display:   formatDisplay(num),
        usdValue:  effectivePriceUsd !== null ? num * effectivePriceUsd : null,
      };
    }

    // EVM
    if (!evmConnected || !evmEnabled) return emptyBalance(decimals, symbol);
    if (evmRes.isLoading)             return loadingBalance(decimals, symbol);
    if (evmRes.error)                 return errorBalance(decimals, symbol, evmRes.error.message);
    const raw       = evmRes.data?.value ?? 0n;
    const formatted = formatUnits(raw, evmRes.data?.decimals ?? decimals);
    const num       = Number(formatted);
    return {
      raw,
      formatted,
      decimals:  evmRes.data?.decimals ?? decimals,
      symbol:    evmRes.data?.symbol   ?? symbol,
      loading:   false,
      error:     null,
      isZero:    raw === 0n,
      display:   formatDisplay(num),
      usdValue:  effectivePriceUsd !== null ? num * effectivePriceUsd : null,
    };
  }, [
    token, isSolana, livePriceUsd,
    solRaw, solLoading, solError, solConnected, publicKey,
    evmRes.data, evmRes.isLoading, evmRes.error, evmConnected, evmEnabled,
  ]);
}

// ─── Helpers ───────────────────────────────────────────────────────────

function emptyBalance(decimals: number, symbol: string): TokenBalance {
  return {
    raw: 0n, formatted: "0", decimals, symbol,
    loading: false, error: null, isZero: true,
    display: "—", usdValue: null,
  };
}
function loadingBalance(decimals: number, symbol: string): TokenBalance {
  return {
    raw: 0n, formatted: "0", decimals, symbol,
    loading: true, error: null, isZero: true,
    display: "…", usdValue: null,
  };
}
function errorBalance(decimals: number, symbol: string, msg: string): TokenBalance {
  return {
    raw: 0n, formatted: "0", decimals, symbol,
    loading: false, error: msg, isZero: true,
    display: "—", usdValue: null,
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
