import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { isValidChain, validateAddress, validateAmount } from "@/lib/validate";
import {
  fetchZeroXPrice, fetchZeroXQuote, isZeroXSupported, ZEROX_CHAIN_IDS, ZEROX_NATIVE,
} from "@/lib/api/zerox";
import {
  fetchLiFiQuote, isLiFiSupported, LIFI_CHAIN_IDS, LIFI_NATIVE,
} from "@/lib/api/lifi";
import {
  fetchJupiterQuote, fetchJupiterSwap, JUPITER_SOL_MINT,
} from "@/lib/api/jupiter";
import {
  normalizeZeroX, normalizeLiFi, normalizeJupiter,
  rankQuotes, type NormalizedQuote,
} from "@/lib/api/quote-types";
import type { ChainId } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_LIST  = { windowMs: 60_000, max: 30 };   // multi-quote list (heavier)
const RL_FIRM  = { windowMs: 60_000, max: 20 };   // firm quote per source

/**
 * /api/quote — unified quote router.
 *
 * Query params:
 *   fromChain     ChainId  (required)
 *   toChain       ChainId  (optional, defaults to fromChain — same-chain)
 *   sellToken     "native" | 0x... (required)
 *   buyToken      "native" | 0x... (required)
 *   sellAmount    integer base units (required)
 *   taker         user wallet (required for `mode=quote` / `source=lifi`)
 *   slippageBps   1-5000 (default 50)
 *   mode          "list"   → list of normalized quotes (default)
 *                 "quote"  → firm quote from one source for execution
 *   source        "0x" | "lifi"  (required when mode=quote)
 *
 * When mode=list, dispatches to 0x (same-chain) and LiFi (any-chain) in
 * parallel and returns the unified list of quotes the comparison panel
 * renders.
 *
 * When mode=quote, returns the firm, signable payload from the selected
 * source (transaction calldata + permit2 / approvalAddress).
 */
export async function GET(req: NextRequest) {
  const zeroXKey = process.env.ZEROX_API_KEY;
  const lifiKey  = process.env.LIFI_API_KEY;        // optional — free tier works without

  const params = req.nextUrl.searchParams;
  const mode   = params.get("mode") === "quote" ? "quote" : "list";

  // ─── Rate limit ─────────────────────────────────────────────────────
  const rl = rateLimit(`q:${mode}:${getClientId(req.headers)}`, mode === "quote" ? RL_FIRM : RL_LIST);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // ─── Common validation ─────────────────────────────────────────────
  const fromChain = params.get("fromChain") ?? params.get("chain"); // backwards compat
  const toChain   = params.get("toChain")   ?? fromChain;
  if (!isValidChain(fromChain)) {
    return NextResponse.json({ error: "invalid_from_chain" }, { status: 400 });
  }
  if (!isValidChain(toChain)) {
    return NextResponse.json({ error: "invalid_to_chain" }, { status: 400 });
  }

  const sellRaw   = params.get("sellToken");
  const buyRaw    = params.get("buyToken");
  const sellToken = sellRaw === "native" ? "native" : validateAddress(sellRaw);
  const buyToken  = buyRaw  === "native" ? "native" : validateAddress(buyRaw);
  if (!sellToken || !buyToken) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  if (fromChain === toChain && sellToken.toLowerCase() === buyToken.toLowerCase()) {
    return NextResponse.json({ error: "same_token" }, { status: 400 });
  }

  const sellAmount = validateAmount(params.get("sellAmount"));
  if (!sellAmount || !/^\d+$/.test(sellAmount)) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
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

  // Optional override for cross-chain delivery address. Defaults to taker.
  let recipient: string | undefined;
  const recipientRaw = params.get("recipient");
  if (recipientRaw) {
    const r = validateAddress(recipientRaw);
    if (!r || r === "native") {
      return NextResponse.json({ error: "invalid_recipient" }, { status: 400 });
    }
    recipient = r;
  }

  const slipRaw    = params.get("slippageBps");
  const slippageBps = slipRaw ? parseInt(slipRaw, 10) : 50;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    return NextResponse.json({ error: "invalid_slippage" }, { status: 400 });
  }

  const isCrossChain     = fromChain !== toChain;
  const fromIsSolana     = fromChain === "solana";
  const toIsSolana       = toChain   === "solana";
  const isSameChainSolana = fromIsSolana && toIsSolana;

  // ─── Helpers ────────────────────────────────────────────────────────
  // EVM aggregator args. Only meaningful when the chains in question are EVM
  // (the `!` is safe because we gate every use behind isZeroXSupported / isLiFiSupported).
  const zxArgs = {
    chainId:     ZEROX_CHAIN_IDS[fromChain as ChainId]!,
    sellToken:   sellToken === "native" ? ZEROX_NATIVE : sellToken,
    buyToken:    buyToken  === "native" ? ZEROX_NATIVE : buyToken,
    sellAmount,
    taker,
    slippageBps,
  };
  const lfArgs = {
    fromChainId: LIFI_CHAIN_IDS[fromChain as ChainId]!,
    toChainId:   LIFI_CHAIN_IDS[toChain   as ChainId]!,
    fromToken:   sellToken === "native" ? LIFI_NATIVE : sellToken,
    toToken:     buyToken  === "native" ? LIFI_NATIVE : buyToken,
    fromAmount:  sellAmount,
    fromAddress: taker,
    toAddress:   recipient ?? taker,
    slippageBps,
  };
  // Jupiter args (Solana-only). Native SOL → wrapped SOL mint per Jupiter convention.
  const jupArgs = {
    inputMint:   sellToken === "native" ? JUPITER_SOL_MINT : sellToken,
    outputMint:  buyToken  === "native" ? JUPITER_SOL_MINT : buyToken,
    amount:      sellAmount,
    slippageBps,
  };

  // ─── Firm single-source path ────────────────────────────────────────
  if (mode === "quote") {
    const source = params.get("source");
    if (!taker) return NextResponse.json({ error: "taker_required_for_quote" }, { status: 400 });

    try {
      if (source === "0x") {
        if (isCrossChain) return NextResponse.json({ error: "0x_no_cross_chain" }, { status: 400 });
        if (!isZeroXSupported(fromChain as ChainId) || !zeroXKey) {
          return NextResponse.json({ error: "0x_unavailable" }, { status: 400 });
        }
        const q = await fetchZeroXQuote(zxArgs, zeroXKey);
        return NextResponse.json(
          { ok: true, mode, source, result: q, normalized: normalizeZeroX(q, zxArgs.chainId, true) },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (source === "lifi") {
        if (!isLiFiSupported(fromChain as ChainId) || !isLiFiSupported(toChain as ChainId)) {
          return NextResponse.json({ error: "lifi_unsupported_chain" }, { status: 400 });
        }
        const q = await fetchLiFiQuote(lfArgs, lifiKey);
        return NextResponse.json(
          { ok: true, mode, source, result: q, normalized: normalizeLiFi(q) },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (source === "jupiter") {
        if (!isSameChainSolana) {
          return NextResponse.json({ error: "jupiter_solana_only" }, { status: 400 });
        }
        // Jupiter requires the user's wallet pubkey to build the swap tx.
        // The /quote endpoint doesn't, but we need both to return a firm
        // payload the client can sign and send.
        const quote = await fetchJupiterQuote(jupArgs);
        const swap  = await fetchJupiterSwap({
          quoteResponse:    quote,
          userPublicKey:    taker,
          wrapAndUnwrapSol: true,
        });
        return NextResponse.json(
          {
            ok: true, mode, source,
            result: { quote, swap },
            normalized: normalizeJupiter(quote),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json({ error: "invalid_source" }, { status: 400 });
    } catch (err) {
      console.warn("[quote/firm] upstream error:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { ok: false, error: "upstream_failed" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // ─── List path — query all applicable sources in parallel ───────────
  const tasks: Promise<NormalizedQuote | null>[] = [];

  // 0x: same-chain only
  if (!isCrossChain && isZeroXSupported(fromChain as ChainId) && zeroXKey) {
    tasks.push(
      fetchZeroXPrice(zxArgs, zeroXKey)
        .then((q) => normalizeZeroX(q, zxArgs.chainId, false))
        .catch((e) => {
          console.warn("[quote/list] 0x failed:", e instanceof Error ? e.message : e);
          return null;
        }),
    );
  }

  // LiFi: any chain pair (same or cross), needs both chains supported.
  // Skip when it's a same-chain Solana swap — Jupiter has deeper liquidity
  // and faster execution there.
  if (
    !isSameChainSolana &&
    isLiFiSupported(fromChain as ChainId) &&
    isLiFiSupported(toChain   as ChainId)
  ) {
    tasks.push(
      fetchLiFiQuote(lfArgs, lifiKey)
        .then(normalizeLiFi)
        .catch((e) => {
          console.warn("[quote/list] LiFi failed:", e instanceof Error ? e.message : e);
          return null;
        }),
    );
  }

  // Jupiter: same-chain Solana only
  if (isSameChainSolana) {
    tasks.push(
      fetchJupiterQuote(jupArgs)
        .then(normalizeJupiter)
        .catch((e) => {
          console.warn("[quote/list] Jupiter failed:", e instanceof Error ? e.message : e);
          return null;
        }),
    );
  }

  if (tasks.length === 0) {
    return NextResponse.json(
      { ok: true, mode, quotes: [], note: "No aggregator supports this chain pair" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const settled = await Promise.all(tasks);
  const quotes  = rankQuotes(settled.filter((x): x is NormalizedQuote => !!x));

  return NextResponse.json(
    { ok: true, mode, quotes, isCrossChain },
    {
      // Indicative quotes — short CDN cache OK
      headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=15" },
    },
  );
}
