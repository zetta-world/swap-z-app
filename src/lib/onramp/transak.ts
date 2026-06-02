"use client";

/**
 * Transak fiat onramp — client-safe metadata only.
 *
 * Transak deprecated the legacy "apiKey in the query string" widget URL.
 * Building the URL now happens SERVER-SIDE (see lib/onramp/transak-server.ts
 * + /api/onramp/transak/session) because it requires the API secret to
 * mint an access token. This module keeps only the bits the browser can
 * safely know: which chains + tokens Transak covers, and the network-slug
 * mapping the client sends to our /session route.
 *
 * Security model:
 *   - No secret here. The browser never sees the API key or secret.
 *   - The /session route attaches credentials + referrerDomain server-side
 *     and returns an already-authenticated, single-use widgetUrl.
 *   - Wallet address is pinned server-side via walletAddress +
 *     disableWalletAddressForm, so the user can't redirect funds.
 *   - Z-SWAP never sees CPF, selfie, bank, or any PII — all of that lives
 *     inside the Transak iframe.
 */

import type { ChainId } from "@/lib/chains";

/**
 * Internal chain id → Transak network slug. Transak's slug list differs
 * from wagmi's and from our internal `ChainId`. Avalanche is "avaxcchain"
 * (the C-Chain EVM). zkSync / Linea aren't in Transak's menu today, so
 * those chains are simply absent and the UI hides the onramp for them.
 */
const TRANSAK_NETWORK: Partial<Record<ChainId, string>> = {
  ethereum: "ethereum",
  bsc:      "bsc",
  polygon:  "polygon",
  base:     "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  avalanche:"avaxcchain",
  solana:   "solana",
};

export function isTransakSupportedChain(chain: ChainId | undefined): boolean {
  return !!chain && chain in TRANSAK_NETWORK;
}

/** Map our ChainId to the slug the /session route forwards to Transak. */
export function transakNetworkSlug(chain: ChainId | undefined): string | null {
  if (!chain) return null;
  return TRANSAK_NETWORK[chain] ?? null;
}

/**
 * Tokens Transak lists with our exact symbol. Native chain tokens
 * (BNB, ETH, MATIC, AVAX, SOL) share the slug with our symbol; wrapped
 * versions (WBNB, WETH…) are their own Transak currencies. We pass the
 * symbol straight through and let Transak's resolver match.
 */
const KNOWN_TRANSAK_SYMBOLS = new Set([
  // Natives
  "ETH", "BNB", "MATIC", "POL", "AVAX", "SOL",
  // Wrapped
  "WETH", "WBNB", "WMATIC", "WAVAX",
  // Stables
  "USDC", "USDT", "DAI", "BUSD", "USDC.E",
  // L2 / blue chips
  "ARB", "OP", "BASE", "LINK", "UNI", "AAVE",
  // Memes / popular
  "DOGE", "SHIB", "PEPE", "WIF",
]);

export function isTransakSupportedSymbol(symbol: string | undefined): boolean {
  if (!symbol) return false;
  return KNOWN_TRANSAK_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Whether the (token, chain, wallet) tuple is routable through Transak.
 * Drives whether the onramp CTA is enabled. We no longer gate on an env
 * var here — the key is server-side; the /session route reports a clean
 * "not_configured" error if the deploy is missing the credentials.
 */
export function canOpenTransak(
  cryptoSymbol:  string | undefined,
  chain:         ChainId | undefined,
  walletAddress: string | undefined,
): boolean {
  if (!chain || !isTransakSupportedChain(chain)) return false;
  if (!cryptoSymbol || !isTransakSupportedSymbol(cryptoSymbol)) return false;
  if (!walletAddress || walletAddress.length < 10) return false;
  return true;
}

export interface TransakSessionResponse {
  ok:        boolean;
  widgetUrl?: string;
  error?:    string;
  detail?:   string;
}

/**
 * Ask our backend to mint a one-time Transak widget URL. Returns the
 * authenticated URL the iframe should load, or throws with a friendly
 * message the UI can render.
 */
export async function fetchTransakWidgetUrl(input: {
  product:        "BUY" | "SELL";
  chain:          ChainId;
  cryptoCurrency: string;
  walletAddress:  string;
  fiatAmount?:    number;
  cryptoAmount?:  number;
}): Promise<string> {
  const network = transakNetworkSlug(input.chain);
  if (!network) throw new Error(`Rede ${input.chain} não suportada pela Transak.`);

  const res = await fetch("/api/onramp/transak/session", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      product:        input.product,
      network,
      cryptoCurrency: input.cryptoCurrency,
      walletAddress:  input.walletAddress,
      fiatAmount:     input.fiatAmount,
      cryptoAmount:   input.cryptoAmount,
    }),
  });

  const body = await res.json().catch(() => ({})) as TransakSessionResponse;
  if (!res.ok || !body.ok || !body.widgetUrl) {
    if (body.error === "not_configured") {
      throw new Error("Onramp ainda não configurado no servidor (faltam TRANSAK_API_KEY / TRANSAK_API_SECRET).");
    }
    if (body.error === "upstream_failed") {
      throw new Error(`Transak recusou a sessão: ${body.detail ?? "verifique domínio + IP whitelist no painel."}`);
    }
    throw new Error(body.detail || body.error || `Falha ao criar sessão (HTTP ${res.status}).`);
  }
  return body.widgetUrl;
}
