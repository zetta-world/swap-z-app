/**
 * Jupiter v6 — Solana aggregator. Free, no key required.
 *
 *   GET /v6/quote   — indicative + firm quote (single endpoint)
 *   POST /v6/swap   — swap transaction builder (returns base64 tx for signing)
 *
 * Docs: https://station.jup.ag/docs/apis/swap-api
 *
 * Jupiter routes across every meaningful Solana AMM (Raydium, Orca, Meteora,
 * Phoenix, Lifinity, OpenBook, Saber, Whirlpool, etc.) and SOL ↔ SPL token
 * pairs. It handles wrapping/unwrapping native SOL automatically when
 * wrapAndUnwrapSol = true.
 */

export const JUPITER_BASE = "https://quote-api.jup.ag/v6";

/** Jupiter address for native SOL (wrapped SOL mint). */
export const JUPITER_SOL_MINT = "So11111111111111111111111111111111111111112";

// ─── Quote response ─────────────────────────────────────────────────

export interface JupRoutePlanStep {
  swapInfo: {
    ammKey:    string;
    label?:    string;            // e.g. "Raydium", "Orca", "Meteora DLMM"
    inputMint: string;
    outputMint: string;
    inAmount:  string;
    outAmount: string;
    feeAmount: string;
    feeMint:   string;
  };
  percent:  number;               // 0-100
}

export interface JupQuote {
  inputMint:           string;
  inAmount:            string;
  outputMint:          string;
  outAmount:           string;
  otherAmountThreshold: string;   // minBuyAmount equivalent
  swapMode:            "ExactIn" | "ExactOut";
  slippageBps:         number;
  platformFee?: {
    amount:  string;
    feeBps:  number;
  };
  priceImpactPct:      string;
  routePlan:           JupRoutePlanStep[];
  contextSlot?:        number;
  timeTaken?:          number;
}

// ─── Swap response ──────────────────────────────────────────────────

export interface JupSwapResponse {
  swapTransaction:           string;     // base64-encoded VersionedTransaction
  lastValidBlockHeight:      number;
  prioritizationFeeLamports?: number;
}

// ─── Args ───────────────────────────────────────────────────────────

interface QuoteArgs {
  inputMint:  string;
  outputMint: string;
  amount:     string;     // base units (lamports for SOL, decimals for SPL)
  slippageBps?: number;   // 1-5000 (default 50)
  /** Skip indirect routes — only direct AMM pairs. Defaults false. */
  onlyDirectRoutes?: boolean;
}

interface SwapArgs {
  quoteResponse:     JupQuote;
  userPublicKey:     string;
  wrapAndUnwrapSol?: boolean;
  /** Optional priority fee tip in lamports. */
  prioritizationFeeLamports?: number | "auto";
}

// ─── Calls ──────────────────────────────────────────────────────────

/**
 * Fetch a quote (indicative if `userPublicKey` is omitted; the same quote
 * is also passed to /v6/swap to build the transaction).
 */
export async function fetchJupiterQuote(args: QuoteArgs): Promise<JupQuote> {
  const params = new URLSearchParams({
    inputMint:    args.inputMint,
    outputMint:   args.outputMint,
    amount:       args.amount,
    slippageBps:  String(args.slippageBps ?? 50),
    swapMode:     "ExactIn",
  });
  if (args.onlyDirectRoutes) params.set("onlyDirectRoutes", "true");

  const res = await fetch(`${JUPITER_BASE}/quote?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jupiter ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json() as Promise<JupQuote>;
}

/**
 * Build a swap transaction from a previously-fetched quote. The returned
 * base64 transaction must be signed by the user wallet (Phantom / Solflare)
 * and submitted to the Solana RPC.
 */
export async function fetchJupiterSwap(args: SwapArgs): Promise<JupSwapResponse> {
  const body = {
    quoteResponse:    args.quoteResponse,
    userPublicKey:    args.userPublicKey,
    wrapAndUnwrapSol: args.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: args.prioritizationFeeLamports ?? "auto",
  };
  const res = await fetch(`${JUPITER_BASE}/swap`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jupiter swap ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json() as Promise<JupSwapResponse>;
}
