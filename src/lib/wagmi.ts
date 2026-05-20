"use client";

import { http, createConfig } from "wagmi";
import {
  mainnet, bsc, polygon, base, arbitrum, optimism, avalanche, zksync, linea,
} from "wagmi/chains";
import { coinbaseWallet, injected, metaMask, walletConnect } from "wagmi/connectors";

/**
 * Wagmi v2 client config — EVM chains supported by the Liquidity Nexus.
 *
 * Connectors (order matters — first match wins in some UIs):
 *
 *   1. `metaMask()` — uses MetaMask SDK under the hood. Handles the mobile
 *      deep-link round trip via a WebSocket relay: when a user on a mobile
 *      external browser clicks "MetaMask", the SDK opens MM app, MM signs
 *      the connect request, and the relay completes the handshake. Without
 *      this, mobile-external-browser → MM mobile would hang on "Connecting…"
 *      because there's no `window.ethereum` to inject into.
 *
 *   2. `injected({ shimDisconnect })` — EIP-6963 auto-discovery for every
 *      installed wallet (Rabby, Brave, OKX, Phantom EVM, Trust, etc.). On
 *      desktop with MetaMask extension installed, MM extension also surfaces
 *      via this connector — but #1 above takes priority for the explicit
 *      "MetaMask" button so mobile users get the proper flow.
 *
 *   3. `coinbaseWallet()` — always available, popup fallback when extension
 *      not installed.
 *
 *   4. `walletConnect()` — added only if NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 *      is set. Provides QR + mobile wallet pairing.
 *
 * Solana wallets are deferred to a later sprint — wagmi only handles EVM.
 */

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const APP_URL  = (typeof window !== "undefined" && window.location?.origin)
  ? window.location.origin
  : "https://z-swap-app.vercel.app";

const connectors = [
  metaMask({
    dappMetadata: {
      name:    "Z-SWAP — The Liquidity Nexus",
      url:     APP_URL,
      iconUrl: `${APP_URL}/favicon.svg`,
    },
    extensionOnly: false,        // also work on mobile via SDK relay
    enableAnalytics: false,
    logging: { developerMode: false, sdk: false },
  }),
  injected({ shimDisconnect: true }),
  coinbaseWallet({
    appName:     "Z-SWAP",
    appLogoUrl:  `${APP_URL}/favicon.svg`,
  }),
  ...(WC_PROJECT_ID
    ? [walletConnect({
        projectId: WC_PROJECT_ID,
        showQrModal: true,
        metadata: {
          name:        "Z-SWAP",
          description: "The Liquidity Nexus — multi-chain DEX with ZION AI",
          url:         APP_URL,
          icons:       [`${APP_URL}/favicon.svg`],
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

// Inverse: internal ChainId → wagmi numeric chain id
export const WAGMI_CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum:  mainnet.id,
  bsc:       bsc.id,
  polygon:   polygon.id,
  base:      base.id,
  arbitrum:  arbitrum.id,
  optimism:  optimism.id,
  avalanche: avalanche.id,
  zksync:    zksync.id,
  linea:     linea.id,
};
