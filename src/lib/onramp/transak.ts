"use client";

/**
 * Transak fiat onramp — PIX → crypto in one widget.
 *
 * The user opens our embedded Transak iframe pre-configured for their
 * connected wallet + the token currently selected in the swap card.
 * Transak handles KYC (CPF + selfie one-time), captures PIX payment,
 * delivers the token on-chain to the wallet address, and never lets
 * the user override the destination (disableWalletAddressForm=true).
 *
 * Architecture decision: NO server-side webhooks in v1.
 *   - The user sees the token chegando in their wallet directly
 *     (real-time balance refresh in Z-SWAP picks it up).
 *   - Webhook integration would let us sync /orders with "PIX pending"
 *     entries but it requires the TRANSAK_API_SECRET (server-side) +
 *     a /api/transak/webhook route. Deferred — adds complexity for
 *     marginal UX gain at MVP scale.
 *
 * Security model:
 *   - Only the API Key is exposed (NEXT_PUBLIC_TRANSAK_API_KEY). It's
 *     a public identifier safe to embed; cannot be used to drain funds
 *     or impersonate users.
 *   - Wallet address is pinned via `walletAddress` + `disableWalletAddressForm=true`
 *     so the user can't (accidentally or otherwise) send funds to a
 *     different address than their connected wallet.
 *   - Z-SWAP never sees the user's CPF, selfie, bank account, or any
 *     PII — Transak handles every step of KYC + payment in their own
 *     iframe; we just pre-fill the destination and the desired token.
 */

import type { ChainId } from "@/lib/chains";

const PROD_URL = "https://global.transak.com";

/**
 * Internal chain id → Transak network slug. Transak's slug list is
 * different from wagmi's and from our internal `ChainId` — keep this
 * map narrow and explicit.
 *
 * Note: Avalanche on Transak is "avaxcchain" (the C-Chain EVM); zkSync
 * and Linea aren't in their menu today, those cards fall back to the
 * existing manual flow.
 */
const TRANSAK_NETWORK: Partial<Record<ChainId, string>> = {
  ethereum: "ethereum",
  bsc:      "bsc",
  polygon:  "polygon",
  base:     "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  avalanche:"avaxcchain",
};

export function isTransakSupportedChain(chain: ChainId | undefined): boolean {
  return !!chain && chain in TRANSAK_NETWORK;
}

/**
 * Tokens Transak lists with our exact symbol. For native chain
 * tokens (BNB, ETH, MATIC, AVAX) the slug is the same as our symbol.
 * Wrapped versions are also their own currencies on Transak (WBNB,
 * WETH, etc.) — we just pass the symbol through and let Transak's
 * resolver match.
 */
const KNOWN_TRANSAK_SYMBOLS = new Set([
  // Natives
  "ETH", "BNB", "MATIC", "POL", "AVAX",
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
 * Build the iframe URL with all the params Transak expects. Returns
 * null when the (chain, symbol, walletAddress) tuple isn't routable
 * — caller should show the "not available for this token" hint
 * instead of opening an iframe that will fail anyway.
 */
export interface TransakWidgetInput {
  /** The token symbol the user wants to buy (e.g. "WBNB", "ETH"). */
  cryptoCurrency: string;
  /** The chain to deliver on. */
  chain:          ChainId;
  /** Destination wallet — the user's connected MetaMask / Phantom address. */
  walletAddress:  string;
  /** Optional BRL amount to pre-fill (e.g. 100 → R$ 100). */
  fiatAmount?:    number;
  /** Whether to use staging (sandbox) endpoint. Default false. */
  staging?:       boolean;
  /** Hex color string without "#" — used to tint the widget UI. */
  themeColor?:    string;
}

export function buildTransakUrl(input: TransakWidgetInput): string | null {
  const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY;
  if (!apiKey) return null;

  const network = TRANSAK_NETWORK[input.chain];
  if (!network) return null;

  const symbol = input.cryptoCurrency.toUpperCase();
  if (!isTransakSupportedSymbol(symbol)) return null;

  if (!input.walletAddress || input.walletAddress.length < 10) return null;

  const base = input.staging
    ? "https://staging-global.transak.com"
    : PROD_URL;

  const params = new URLSearchParams({
    apiKey,
    defaultCryptoCurrency:     symbol,
    network,
    fiatCurrency:              "BRL",
    defaultPaymentMethod:      "pix",
    // Lock the destination. Without this the user could accidentally
    // type a different address inside the widget and lose funds.
    walletAddress:             input.walletAddress,
    disableWalletAddressForm:  "true",
    // Lock the token + network too — same UX principle. The user
    // already picked them in our swap card.
    cryptoCurrencyLock:        "true",
    networkLock:               "true",
    // BR-friendly default.
    countryCode:               "BR",
    // Pass through our theme so the widget doesn't look out of place.
    themeColor:                input.themeColor ?? "00E8FF",
    // Branding inside the widget so the user knows they're still in
    // the Z-SWAP flow even though it's a Transak iframe.
    productsAvailed:           "BUY",
    exchangeScreenTitle:       "Comprar com PIX · Z-SWAP",
    hideMenu:                  "true",
  });

  if (input.fiatAmount && input.fiatAmount > 0) {
    params.set("fiatAmount", String(input.fiatAmount));
  }

  return `${base}?${params.toString()}`;
}

// ─── Off-ramp (SELL crypto → PIX) ──────────────────────────────────────
//
// Mirror of the buy flow, but for the SELL side. The user picks a token
// they hold + an amount → Transak generates a payout target (PIX key
// linked to the user's bank — set up once inside the KYC flow). After
// the user signs an on-chain transfer to Transak's hot wallet, Transak
// confirms receipt and pushes BRL to the user's bank via PIX.
//
// Z-SWAP NEVER receives the user's PIX key or bank info — same posture
// as the BUY side. The wallet signs ONE outgoing transfer to Transak,
// nothing else.

export interface TransakSellInput {
  /** Token symbol the user wants to sell. */
  cryptoCurrency: string;
  /** Chain where the token is held. */
  chain:          ChainId;
  /** Source wallet — the user's connected EVM/Solana address. */
  walletAddress:  string;
  /** Optional crypto amount to pre-fill (in user units, e.g. 0.05). */
  cryptoAmount?:  number;
  staging?:       boolean;
  themeColor?:    string;
}

export function buildTransakSellUrl(input: TransakSellInput): string | null {
  const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY;
  if (!apiKey) return null;

  const network = TRANSAK_NETWORK[input.chain];
  if (!network) return null;

  const symbol = input.cryptoCurrency.toUpperCase();
  if (!isTransakSupportedSymbol(symbol)) return null;

  if (!input.walletAddress || input.walletAddress.length < 10) return null;

  const base = input.staging
    ? "https://staging-global.transak.com"
    : PROD_URL;

  const params = new URLSearchParams({
    apiKey,
    defaultCryptoCurrency:     symbol,
    network,
    fiatCurrency:              "BRL",
    defaultPaymentMethod:      "pix",
    walletAddress:             input.walletAddress,
    disableWalletAddressForm:  "true",
    cryptoCurrencyLock:        "true",
    networkLock:               "true",
    countryCode:               "BR",
    themeColor:                input.themeColor ?? "00E8FF",
    // The only difference vs the buy URL: pin productsAvailed to SELL
    // (forces the off-ramp side of the widget).
    productsAvailed:           "SELL",
    exchangeScreenTitle:       "Vender por PIX · Z-SWAP",
    hideMenu:                  "true",
  });

  if (input.cryptoAmount && input.cryptoAmount > 0) {
    params.set("cryptoAmount", String(input.cryptoAmount));
  }

  return `${base}?${params.toString()}`;
}

/**
 * Quick predicate the SwapCard uses to decide whether to even SHOW
 * the "Comprar com PIX" toggle. False when:
 *   - API key not configured (env var missing → deploy without onramp)
 *   - The currently-selected buy token isn't on Transak
 *   - The chain isn't on Transak
 *   - No wallet connected
 */
export function canOpenTransak(
  cryptoSymbol: string | undefined,
  chain:        ChainId | undefined,
  walletAddress: string | undefined,
): boolean {
  if (!process.env.NEXT_PUBLIC_TRANSAK_API_KEY) return false;
  if (!chain || !isTransakSupportedChain(chain)) return false;
  if (!cryptoSymbol || !isTransakSupportedSymbol(cryptoSymbol)) return false;
  if (!walletAddress || walletAddress.length < 10) return false;
  return true;
}
