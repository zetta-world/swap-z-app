/**
 * LiFi v1 Quote API — same-chain DEX aggregation + cross-chain bridge+swap.
 *
 * Endpoint: https://li.quest/v1/quote
 * No API key required for free tier (rate-limited per IP).
 *
 * LiFi unifies bridges (Stargate, Across, Hop, LayerZero, Wormhole, Squid…)
 * and DEX aggregators (1inch, Paraswap, 0x, OpenOcean, KyberSwap…) into a
 * single quote endpoint. Cross-chain swaps execute as ONE user signature
 * that triggers the bridge on source → bridge delivers → swap on destination,
 * all atomic from the user's perspective.
 */

import type { ChainId } from "../chains";

export const LIFI_BASE = "https://li.quest/v1";

export const LIFI_CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum:  1,
  bsc:       56,
  polygon:   137,
  base:      8453,
  arbitrum:  42161,
  optimism:  10,
  avalanche: 43114,
  linea:     59144,
  zksync:    324,
  // Solana — LiFi's synthetic chain id for mainnet-beta. Same-chain Solana
  // quotes route through Jupiter (better depth); LiFi handles SOL↔EVM bridges.
  solana:    1151111081099710,
};

export const LIFI_NATIVE = "0x0000000000000000000000000000000000000000";

export function isLiFiSupported(chain: ChainId): boolean {
  return chain in LIFI_CHAIN_IDS;
}

// ─── Response types ─────────────────────────────────────────────────

export interface LfToken {
  address: string;
  symbol:  string;
  decimals: number;
  chainId: number;
  name?:   string;
  logoURI?: string;
  priceUSD?: string;
}

export interface LfStep {
  type:    string;        // "swap" | "cross" | …
  tool:    string;        // e.g. "stargateV2", "1inch", "paraswap"
  toolDetails?: { name?: string; logoURI?: string };
  action:  {
    fromToken: LfToken;
    toToken:   LfToken;
    fromChainId: number;
    toChainId:   number;
    fromAmount: string;
  };
  estimate: {
    fromAmount: string;
    toAmount:   string;
    toAmountMin: string;
    executionDuration: number;
  };
}

export interface LfFeeCost {
  name?:        string;
  description?: string;
  token:        LfToken;
  amount:       string;
  amountUSD?:   string;
  percentage?:  string;
}

export interface LfGasCost {
  type?:        string;
  price?:       string;
  estimate?:    string;
  limit?:       string;
  amount:       string;
  amountUSD?:   string;
  token:        LfToken;
}

export interface LfTransactionRequest {
  data:     string;
  to:       string;
  value:    string;
  from?:    string;
  chainId?: number;
  gasLimit?: string;
  gasPrice?: string;
}

export interface LfQuote {
  type:    string;          // "lifi"
  id:      string;
  action: {
    fromChainId: number;
    toChainId:   number;
    fromToken:   LfToken;
    toToken:     LfToken;
    fromAmount:  string;
    slippage:    number;
    fromAddress?: string;
  };
  estimate: {
    fromAmount:        string;
    toAmount:          string;
    toAmountMin:       string;
    approvalAddress:   string;
    executionDuration: number;   // seconds
    feeCosts?:         LfFeeCost[];
    gasCosts?:         LfGasCost[];
  };
  includedSteps?:    LfStep[];
  transactionRequest: LfTransactionRequest;
  tool?:    string;        // top-level tool name
  toolDetails?: { name?: string; logoURI?: string };
}

interface QuoteArgs {
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;     // address (use LIFI_NATIVE for native)
  toToken:      string;
  fromAmount:   string;     // base units
  fromAddress?: string;
  /** Override the destination address on the target chain. */
  toAddress?:   string;
  slippageBps?: number;     // 1-5000
}

/**
 * Fetch a single best-route quote from LiFi. Throws on HTTP errors.
 * Designed to be called from server routes — never include LiFi key in
 * the browser bundle.
 */
export async function fetchLiFiQuote(args: QuoteArgs, integratorKey?: string): Promise<LfQuote> {
  // LiFi's /v1/quote REQUIRES fromAddress to build the signable route — it
  // rejects requests without it ("querystring must have required property
  // 'fromAddress'", code 1011). An empty/undefined taker would otherwise be
  // dropped silently here and surface as a confusing remote 400, so we fail
  // locally with a clear message. Callers without a connected wallet must
  // skip LiFi rather than reach this function.
  if (!args.fromAddress) {
    throw new Error("LiFi quote requires fromAddress (no wallet connected)");
  }

  const params = new URLSearchParams({
    fromChain:    String(args.fromChainId),
    toChain:      String(args.toChainId),
    fromToken:    args.fromToken,
    toToken:      args.toToken,
    fromAmount:   args.fromAmount,
    fromAddress:  args.fromAddress,
    order:        "RECOMMENDED",
  });
  if (args.toAddress)   params.set("toAddress",   args.toAddress);
  if (args.slippageBps) params.set("slippage", (args.slippageBps / 10_000).toString());

  const res = await fetch(`${LIFI_BASE}/quote?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      ...(integratorKey ? { "x-lifi-api-key": integratorKey } : {}),
    },
    // Same-chain quotes change every block; don't cache aggressively
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LiFi ${res.status}: ${errText.slice(0, 240)}`);
  }
  return res.json() as Promise<LfQuote>;
}
