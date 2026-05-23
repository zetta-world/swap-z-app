"use client";

import { useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import ExecuteSwap from "./ExecuteSwap";
import { useSwap } from "@/lib/store/swap";
import { parseDecimalInput } from "@/lib/format";
import { useQuotes } from "@/lib/hooks/useQuotes";
import type { QuoteSource } from "@/lib/api/quote-types";

/**
 * App-level portal that mounts the ExecuteSwap modal whenever `executeOpen`
 * flips to true in the swap store. Lives in `AppShell`, so the modal can
 * be opened from anywhere (SwapCard CTA, ZION action card, /orders fire).
 *
 * The portal owns the auto-select-best-source logic that used to live in
 * SwapCard — when the modal opens we pick the highest-conviction quote
 * source (0x / LiFi / Jupiter) for the current pair.
 */
export default function ExecuteSwapPortal() {
  const {
    fromChain, toChain, fromToken, toToken, amountIn, slippageBps,
    recipient, executeOpen, selectedSource, setExecuteOpen,
  } = useSwap();

  const { address }     = useAccount();
  const sol             = useWallet();
  const solAddress      = sol.publicKey?.toBase58();
  const isCrossChain    = !!(fromToken && toToken && fromToken.chain !== toToken.chain);
  const fromTaker       = fromChain === "solana" ? solAddress : address;

  // Convert UI amount → base units (matches SwapCard's helper exactly so the
  // modal's "Pay" line is identical to the card's).
  const sellAmountBase = useMemo(() => {
    if (!fromToken) return "0";
    const amt = parseDecimalInput(amountIn) ?? 0;
    if (amt <= 0) return "0";
    const [intPart, fracPart = ""] = amt.toString().split(".");
    const fracPadded = (fracPart + "0".repeat(fromToken.decimals)).slice(0, fromToken.decimals);
    return (intPart + fracPadded).replace(/^0+/, "") || "0";
  }, [amountIn, fromToken]);

  // We need at least one valid quote to know which source to fire. Pre-fetch
  // a short list when the modal opens — the modal itself will re-fetch the
  // firm quote with calldata, but this picks the source first.
  const quotes = useQuotes({
    fromChain,
    toChain:    toToken?.chain ?? toChain,
    sellToken:  fromToken?.address === "native" ? "native" : (fromToken?.address ?? ""),
    buyToken:   toToken?.address   === "native" ? "native" : (toToken?.address   ?? ""),
    sellAmount: sellAmountBase,
    taker:      fromTaker,
    recipient:  isCrossChain ? recipient : undefined,
    slippageBps,
    enabled:    executeOpen && !!(fromToken && toToken && sellAmountBase !== "0"),
    debounceMs: 0,
  });

  // Honor the user's manual pick when present; otherwise fall back to the
  // top-ranked quote (rankQuotes already sorted by best minBuyAmount).
  const source: QuoteSource | null = selectedSource
    && quotes.quotes.some((q) => q.source === selectedSource)
      ? selectedSource
      : (quotes.quotes[0]?.source ?? null);

  // Auto-close if the configuration becomes invalid (e.g. user manually
  // cleared the amount while the modal was opening).
  useEffect(() => {
    if (executeOpen && (!fromToken || !toToken || sellAmountBase === "0")) {
      setExecuteOpen(false);
    }
  }, [executeOpen, fromToken, toToken, sellAmountBase, setExecuteOpen]);

  if (!executeOpen || !fromToken || !toToken || !source) return null;

  return (
    <ExecuteSwap
      open={executeOpen}
      onClose={() => setExecuteOpen(false)}
      fromToken={fromToken}
      toToken={toToken}
      fromChain={fromChain}
      toChain={toToken.chain}
      sellAmount={sellAmountBase}
      slippageBps={slippageBps}
      source={source}
      recipient={isCrossChain ? recipient : undefined}
    />
  );
}
