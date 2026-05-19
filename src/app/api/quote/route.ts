import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { isValidChain, validateAddress, validateAmount } from "@/lib/validate";
import {
  fetchZeroXPrice, fetchZeroXQuote, isZeroXSupported, ZEROX_CHAIN_IDS, ZEROX_NATIVE,
} from "@/lib/api/zerox";
import type { ChainId } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_PRICE = { windowMs: 60_000, max: 60 };     // indicative — generous
const RL_QUOTE = { windowMs: 60_000, max: 20 };     // firm — bound execution intent

/**
 * /api/quote — 0x Swap API v2 proxy.
 *
 * Query params:
 *   chain        ChainId (must be EVM and 0x-supported)
 *   sellToken    "native" | 0x… (ERC-20 address)
 *   buyToken     "native" | 0x… (ERC-20 address)
 *   sellAmount   base-units decimal string (≤ 32 chars)
 *   taker        user wallet address (required for `mode=quote`)
 *   slippageBps  optional integer 1-5000 (default 50 = 0.5%)
 *   mode         "price" (default — indicative) | "quote" (firm, with calldata)
 *
 * Hides the ZEROX_API_KEY server-side and rate-limits per IP.
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.ZEROX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", message: "ZEROX_API_KEY not set on the server. Configure it in Vercel project settings." },
      { status: 500 },
    );
  }

  const params = req.nextUrl.searchParams;
  const mode   = params.get("mode") === "quote" ? "quote" : "price";

  // Rate-limit by IP, separate buckets for price vs quote
  const rl = rateLimit(`zx:${mode}:${getClientId(req.headers)}`, mode === "quote" ? RL_QUOTE : RL_PRICE);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // ─── Validate inputs ────────────────────────────────────────────────
  const chain = params.get("chain");
  if (!isValidChain(chain) || !isZeroXSupported(chain as ChainId)) {
    return NextResponse.json({ error: "unsupported_chain" }, { status: 400 });
  }
  const chainId = ZEROX_CHAIN_IDS[chain as ChainId]!;

  const sellRaw   = params.get("sellToken");
  const buyRaw    = params.get("buyToken");
  const sellToken = sellRaw === "native" ? ZEROX_NATIVE : validateAddress(sellRaw);
  const buyToken  = buyRaw  === "native" ? ZEROX_NATIVE : validateAddress(buyRaw);
  if (!sellToken || !buyToken) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  if (sellToken.toLowerCase() === buyToken.toLowerCase()) {
    return NextResponse.json({ error: "same_token" }, { status: 400 });
  }

  const sellAmount = validateAmount(params.get("sellAmount"));
  if (!sellAmount) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }
  // sellAmount must already be in base units — caller is responsible for shifting
  if (!/^\d+$/.test(sellAmount)) {
    return NextResponse.json({ error: "amount_must_be_integer_base_units" }, { status: 400 });
  }

  let taker: string | undefined;
  const takerRaw = params.get("taker");
  if (takerRaw) {
    const t = validateAddress(takerRaw);
    if (!t || t === "native") {
      return NextResponse.json({ error: "invalid_taker" }, { status: 400 });
    }
    taker = t;
  }
  if (mode === "quote" && !taker) {
    return NextResponse.json({ error: "taker_required_for_quote" }, { status: 400 });
  }

  const slipRaw = params.get("slippageBps");
  let slippageBps: number | undefined;
  if (slipRaw) {
    const n = parseInt(slipRaw, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5000) {
      return NextResponse.json({ error: "invalid_slippage" }, { status: 400 });
    }
    slippageBps = n;
  }

  // ─── Hit 0x ─────────────────────────────────────────────────────────
  try {
    const result = mode === "quote"
      ? await fetchZeroXQuote({ chainId, sellToken, buyToken, sellAmount, taker, slippageBps }, apiKey)
      : await fetchZeroXPrice({ chainId, sellToken, buyToken, sellAmount, taker, slippageBps }, apiKey);

    return NextResponse.json(
      { ok: true, mode, chain, chainId, result },
      {
        headers: mode === "price"
          ? { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15" }
          : { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, error: "upstream_failed", message }, { status: 502 });
  }
}
