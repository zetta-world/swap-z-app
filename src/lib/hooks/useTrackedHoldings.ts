"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { CHAINS, type Chain } from "@/lib/chains";
import { findToken, type Token } from "@/lib/tokens";
import { useTokenBalance, type TokenBalance } from "@/lib/hooks/useTokenBalance";
import { useTokenPrices, tokenPriceKey } from "@/lib/hooks/useTokenPrices";

/**
 * Live wallet holdings across the curated token set. Mirrors the tracked
 * slots PortfolioView reads so the dashboard can show live allocation
 * (by chain / by asset) without duplicating PortfolioView's render tree.
 *
 * Hooks can't run in a loop, so the 17 slots are resolved statically and
 * useTokenBalance is called once per slot below — same shape as the
 * portfolio page.
 */
const TRACKED: Array<{ chain: Token["chain"]; symbol: string }> = [
  { chain: "ethereum",  symbol: "ETH"   },
  { chain: "ethereum",  symbol: "USDC"  },
  { chain: "ethereum",  symbol: "USDT"  },
  { chain: "ethereum",  symbol: "WBTC"  },
  { chain: "ethereum",  symbol: "stETH" },
  { chain: "bsc",       symbol: "BNB"   },
  { chain: "bsc",       symbol: "USDT"  },
  { chain: "polygon",   symbol: "POL"   },
  { chain: "polygon",   symbol: "USDC"  },
  { chain: "base",      symbol: "ETH"   },
  { chain: "base",      symbol: "USDC"  },
  { chain: "arbitrum",  symbol: "ETH"   },
  { chain: "arbitrum",  symbol: "USDC"  },
  { chain: "optimism",  symbol: "ETH"   },
  { chain: "avalanche", symbol: "AVAX"  },
  { chain: "solana",    symbol: "SOL"   },
  { chain: "solana",    symbol: "USDC"  },
];

export interface ChainSlice {
  id:    string;
  chain: Chain | undefined;
  value: number;
}

export interface AssetSlice {
  symbol: string;
  color:  string;
  value:  number;
}

export interface TrackedHoldings {
  holdings:  Array<{ token: Token; balance: TokenBalance }>;
  byChain:   ChainSlice[];
  byAsset:   AssetSlice[];
  walletUsd: number;
  loading:   boolean;
  anyWalletConnected: boolean;
}

export function useTrackedHoldings(): TrackedHoldings {
  const { isConnected: evmConnected } = useAccount();
  const sol = useWallet();
  const anyWalletConnected = evmConnected || sol.connected;

  const trackedTokens = useMemo(
    () => TRACKED.map(({ chain, symbol }) => findToken(chain, symbol)),
    [],
  );

  const { prices: livePrices } = useTokenPrices(trackedTokens);
  const livePrice = (tk: Token | undefined) =>
    (tk ? livePrices[tokenPriceKey(tk)] : null) ?? null;

  const balances: TokenBalance[] = [
    useTokenBalance(trackedTokens[0],  livePrice(trackedTokens[0])),
    useTokenBalance(trackedTokens[1],  livePrice(trackedTokens[1])),
    useTokenBalance(trackedTokens[2],  livePrice(trackedTokens[2])),
    useTokenBalance(trackedTokens[3],  livePrice(trackedTokens[3])),
    useTokenBalance(trackedTokens[4],  livePrice(trackedTokens[4])),
    useTokenBalance(trackedTokens[5],  livePrice(trackedTokens[5])),
    useTokenBalance(trackedTokens[6],  livePrice(trackedTokens[6])),
    useTokenBalance(trackedTokens[7],  livePrice(trackedTokens[7])),
    useTokenBalance(trackedTokens[8],  livePrice(trackedTokens[8])),
    useTokenBalance(trackedTokens[9],  livePrice(trackedTokens[9])),
    useTokenBalance(trackedTokens[10], livePrice(trackedTokens[10])),
    useTokenBalance(trackedTokens[11], livePrice(trackedTokens[11])),
    useTokenBalance(trackedTokens[12], livePrice(trackedTokens[12])),
    useTokenBalance(trackedTokens[13], livePrice(trackedTokens[13])),
    useTokenBalance(trackedTokens[14], livePrice(trackedTokens[14])),
    useTokenBalance(trackedTokens[15], livePrice(trackedTokens[15])),
    useTokenBalance(trackedTokens[16], livePrice(trackedTokens[16])),
  ];

  const holdings = useMemo(() => {
    return trackedTokens
      .map((token, i) => ({ token, balance: balances[i] }))
      .filter((row): row is { token: Token; balance: TokenBalance } =>
        !!row.token && !row.balance.isZero && !row.balance.loading && !row.balance.error,
      )
      .sort((a, b) => (b.balance.usdValue ?? 0) - (a.balance.usdValue ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedTokens, ...balances]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loading = useMemo(() => balances.some((b) => b.loading), [...balances]);

  const walletUsd = useMemo(
    () => holdings.reduce((acc, h) => acc + (h.balance.usdValue ?? 0), 0),
    [holdings],
  );

  const byChain = useMemo<ChainSlice[]>(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      const v = h.balance.usdValue ?? 0;
      if (v <= 0) continue;
      map.set(h.token.chain, (map.get(h.token.chain) ?? 0) + v);
    }
    return [...map.entries()]
      .map(([id, value]) => ({ id, value, chain: CHAINS.find((c) => c.id === id) }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const byAsset = useMemo<AssetSlice[]>(() => {
    const map = new Map<string, { value: number; color: string }>();
    for (const h of holdings) {
      const v = h.balance.usdValue ?? 0;
      if (v <= 0) continue;
      const cur = map.get(h.token.symbol) ?? { value: 0, color: h.token.color ?? "#00E8FF" };
      cur.value += v;
      map.set(h.token.symbol, cur);
    }
    return [...map.entries()]
      .map(([symbol, { value, color }]) => ({ symbol, value, color }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  return { holdings, byChain, byAsset, walletUsd, loading, anyWalletConnected };
}
