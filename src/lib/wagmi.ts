"use client";

import { http, createConfig } from "wagmi";
import {
  mainnet, bsc, polygon, base, arbitrum, optimism, avalanche, zksync, linea,
} from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

/**
 * Wagmi v2 client config — EVM chains supported by the Liquidity Nexus.
 *
 * Connectors:
 *   - `injected()` auto-discovers EIP-6963 wallets (MetaMask, Rabby, Brave,
 *     Phantom EVM, OKX, etc.). Each detected wallet gets its own connector
 *     entry so the user picks from a real list, not just "Browser Wallet".
 *   - `coinbaseWallet()` always available (uses Coinbase SDK fallback popup
 *     if extension not installed).
 *   - `walletConnect()` only if NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set
 *     — gracefully omitted otherwise.
 *
 * Solana wallets are deferred to a later sprint — wagmi only handles EVM.
 */

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: "Z-SWAP", appLogoUrl: undefined }),
  ...(WC_PROJECT_ID
    ? [walletConnect({
        projectId: WC_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name:        "Z-SWAP",
          description: "The Liquidity Nexus — multi-chain DEX with ZION AI",
          url:         "https://z-swap.app",
          icons:       [],
        },
      })]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [mainnet, bsc, polygon, base, arbitrum, optimism, avalanche, zksync, linea],
  connectors,
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    [mainnet.id]:   http(),
    [bsc.id]:       http(),
    [polygon.id]:   http(),
    [base.id]:      http(),
    [arbitrum.id]:  http(),
    [optimism.id]:  http(),
    [avalanche.id]: http(),
    [zksync.id]:    http(),
    [linea.id]:     http(),
  },
});

// Map wagmi chain.id → our internal ChainId for cross-referencing
import type { ChainId } from "./chains";

export const WAGMI_CHAIN_TO_INTERNAL: Record<number, ChainId> = {
  [mainnet.id]:   "ethereum",
  [bsc.id]:       "bsc",
  [polygon.id]:   "polygon",
  [base.id]:      "base",
  [arbitrum.id]:  "arbitrum",
  [optimism.id]:  "optimism",
  [avalanche.id]: "avalanche",
  [zksync.id]:    "zksync",
  [linea.id]:     "linea",
};
