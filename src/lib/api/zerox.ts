/**
 * 0x Swap API v2 — AllowanceHolder flow.
 *
 * Two endpoints:
 *   - /swap/allowance-holder/price  → indicative quote (no allowance needed)
 *                                     Used for live preview as the user types.
 *   - /swap/allowance-holder/quote  → firm quote with ready-to-send calldata
 *                                     Used when the user clicks Execute.
 *
 * Why AllowanceHolder over Permit2: a swap is a SINGLE eth_sendTransaction —
 * no EIP-712 typed-data signature, no signature-appending to calldata. The
 * Permit2 sign-then-send double wallet popup was failing constantly on
 * mobile in-app browsers (the wallet drops the second request while the
 * first dialog is still closing).
 *
 * Flow when selling ERC-20 (first time per token):
 *   1. fetch /quote → `issues.allowance` is set
 *   2. approve(issues.allowance.spender, MaxUint256)   — one-time tx
 *   3. re-fetch /quote (fresh calldata after the approval wait)
 *   4. sendTransaction({ to, data, value, gas })
 *
 * Flow when allowance already granted, or selling chain-native:
 *   1. fetch /quote → `issues.allowance` is null
 *   2. sendTransaction({ to, data, value, gas })       — that's it
 */

import type { ChainId } from "../chains";

const BASE_URL = "https://api.0x.org";

// Mapping from internal ChainId to 0x's numeric chainId
export const ZEROX_CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum:  1,
  bsc:       56,
  polygon:   137,
  base:      8453,
  arbitrum:  42161,
  optimism:  10,
  avalanche: 43114,
  linea:     59144,
  // zksync supported on 0x but uses different API path
};

// Special address 0x uses to represent the chain's native currency
export const ZEROX_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export function isZeroXSupported(chain: ChainId): boolean {
  return chain in ZEROX_CHAIN_IDS;
}

// ─── 0x API response types ───────────────────────────────────────────

export interface ZxFill {
  source:        string;        // e.g. "Uniswap_V3"
  proportionBps: number;        // share of the swap (0-10000)
  from:          string;
  to:            string;
}

export interface ZxFee {
  amount:      string;          // base units
  token:       string;
  type:        "volume" | "gas" | "zeroex";
}

export interface ZxIssue {
  allowance?:  { actual: string; spender: string };
  balance?:    { token: string; actual: string; expected: string };
  simulationIncomplete?: boolean;
  invalidSourcesPassed?: string[];
}

export interface ZxTransaction {
  to:    string;
  data:  string;
  gas:   string | null;
  gasPrice: string | null;
  value: string;
}

export interface ZxRoute {
  fills: ZxFill[];
  tokens: { address: string; symbol: string }[];
}

export interface ZxPriceResponse {
  blockNumber:      string;
  buyAmount:        string;
  buyToken:         string;
  sellAmount:       string;
  sellToken:        string;
  minBuyAmount:     string;
  gas:              string | null;
  gasPrice:         string | null;
  liquidityAvailable: boolean;
  route:            ZxRoute;
  fees:             { integratorFee?: ZxFee | null; zeroExFee?: ZxFee | null; gasFee?: ZxFee | null };
  issues?:          ZxIssue;
  totalNetworkFee:  string | null;
}

export interface ZxQuoteResponse extends ZxPriceResponse {
  transaction:  ZxTransaction;
}

// ─── Server-side fetchers (called from /api/quote) ───────────────────

interface QuoteArgs {
  chainId:      number;
  sellToken:    string;   // address or ZEROX_NATIVE
  buyToken:     string;
  sellAmount:   string;   // base units, decimal string
  taker?:       string;   // user's address (recommended)
  slippageBps?: number;
}

export async function fetchZeroXPrice(args: QuoteArgs, apiKey: string): Promise<ZxPriceResponse> {
  const params = new URLSearchParams({
    chainId:    String(args.chainId),
    sellToken:  args.sellToken,
    buyToken:   args.buyToken,
    sellAmount: args.sellAmount,
  });
  if (args.taker)       params.set("taker", args.taker);
  if (args.slippageBps) params.set("slippageBps", String(args.slippageBps));

  const res = await fetch(`${BASE_URL}/swap/allowance-holder/price?${params.toString()}`, {
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
      "Accept":     "application/json",
    },
    // Indicative — cache aggressively for the same params
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`0x price ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json() as Promise<ZxPriceResponse>;
}

export async function fetchZeroXQuote(args: QuoteArgs, apiKey: string): Promise<ZxQuoteResponse> {
  if (!args.taker) {
    throw new Error("taker (wallet address) is required for firm quote");
  }
  const params = new URLSearchParams({
    chainId:    String(args.chainId),
    sellToken:  args.sellToken,
    buyToken:   args.buyToken,
    sellAmount: args.sellAmount,
    taker:      args.taker,
  });
  if (args.slippageBps) params.set("slippageBps", String(args.slippageBps));

  const res = await fetch(`${BASE_URL}/swap/allowance-holder/quote?${params.toString()}`, {
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
      "Accept":     "application/json",
    },
    // Firm quote — must NOT cache
    cache: "no-store",
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`0x quote ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json() as Promise<ZxQuoteResponse>;
}
