import { create } from "zustand";
import { findToken, DEFAULT_TOKENS, type Token } from "../tokens";
import type { ChainId } from "../chains";

type Risk = "safe" | "caution" | "danger";

export function riskFromScore(score: number | undefined): Risk {
  if (score === undefined || score === null) return "safe";
  if (score < 20) return "safe";
  if (score < 50) return "caution";
  return "danger";
}

/**
 * Pick a sensible default counter-token on the same chain. Prefer USDC,
 * then USDT, then BUSD, then the first non-equal token on that chain.
 */
function defaultCounterpart(chain: ChainId, excludeAddress?: string): Token | undefined {
  const candidates = DEFAULT_TOKENS.filter(
    (t) => t.chain === chain && t.address.toLowerCase() !== (excludeAddress ?? "").toLowerCase(),
  );
  const stable =
    candidates.find((t) => t.symbol === "USDC") ??
    candidates.find((t) => t.symbol === "USDT") ??
    candidates.find((t) => t.symbol === "BUSD") ??
    candidates.find((t) => t.address === "native");
  return stable ?? candidates[0];
}

interface SwapState {
  fromChain: ChainId;
  toChain:   ChainId;
  fromToken: Token | undefined;
  toToken:   Token | undefined;
  amountIn:  string;
  slippageBps: number;            // basis points e.g. 50 = 0.5%
  mevProtect: boolean;
  privacyMode: boolean;
  setFromChain: (c: ChainId) => void;
  setToChain:   (c: ChainId) => void;
  setFromToken: (t: Token) => void;
  setToToken:   (t: Token) => void;
  setAmountIn:  (v: string) => void;
  setSlippage:  (bps: number) => void;
  setMev:       (b: boolean) => void;
  setPrivacy:   (b: boolean) => void;
  flipPair:     () => void;
}

export const useSwap = create<SwapState>((set, get) => ({
  fromChain: "ethereum",
  toChain:   "ethereum",
  fromToken: findToken("ethereum", "ETH"),
  toToken:   findToken("ethereum", "USDC"),
  amountIn:  "1.0",
  slippageBps: 50,
  mevProtect:  true,
  privacyMode: false,

  setFromChain: (c) => {
    const { fromToken, toToken } = get();
    // If chain is changing, find appropriate default tokens for the new chain
    if (c !== get().fromChain) {
      const newFrom =
        (fromToken && fromToken.chain === c ? fromToken : undefined) ??
        DEFAULT_TOKENS.find((t) => t.chain === c && t.address === "native") ??
        DEFAULT_TOKENS.find((t) => t.chain === c);
      const newTo = defaultCounterpart(c, newFrom?.address);
      set({ fromChain: c, toChain: c, fromToken: newFrom, toToken: newTo });
      // toToken stays on the same chain via this reset
      void toToken;
    } else {
      set({ fromChain: c });
    }
  },

  setToChain: (c) => set({ toChain: c }),

  /**
   * Setting the FROM token also re-aligns the chain. If the current TO
   * token is on a different chain (or is the same as the new from token),
   * pick a sensible same-chain counterpart.
   */
  setFromToken: (t) => {
    const { toToken } = get();
    const needsToReset =
      !toToken ||
      toToken.chain !== t.chain ||
      toToken.address.toLowerCase() === t.address.toLowerCase();
    const newTo = needsToReset ? defaultCounterpart(t.chain, t.address) : toToken;
    set({
      fromToken: t,
      fromChain: t.chain,
      toToken:   newTo,
      toChain:   t.chain,
    });
  },

  /**
   * Setting the TO token also enforces same-chain. If the picked token is
   * on a different chain than the current FROM, switch the WHOLE pair to
   * that chain and pick a sensible same-chain from-token (usually native).
   */
  setToToken: (t) => {
    const { fromToken, fromChain } = get();
    if (!fromToken || t.chain === fromChain) {
      // Same chain — straight update, but ensure tokens are distinct
      if (fromToken && fromToken.address.toLowerCase() === t.address.toLowerCase()) {
        // User picked the same token as from — pick a sensible different from-token
        const newFrom =
          DEFAULT_TOKENS.find((x) => x.chain === t.chain && x.address === "native" && x.address.toLowerCase() !== t.address.toLowerCase()) ??
          defaultCounterpart(t.chain, t.address);
        set({ toToken: t, toChain: t.chain, fromToken: newFrom });
      } else {
        set({ toToken: t, toChain: t.chain });
      }
    } else {
      // Different chain → switch the whole pair to this chain
      const newFrom =
        DEFAULT_TOKENS.find((x) => x.chain === t.chain && x.address === "native" && x.address.toLowerCase() !== t.address.toLowerCase()) ??
        defaultCounterpart(t.chain, t.address);
      set({
        toToken: t,
        toChain: t.chain,
        fromChain: t.chain,
        fromToken: newFrom,
      });
    }
  },

  setAmountIn:  (v) => set({ amountIn: v }),
  setSlippage:  (bps) => set({ slippageBps: bps }),
  setMev:       (b) => set({ mevProtect: b }),
  setPrivacy:   (b) => set({ privacyMode: b }),

  flipPair: () => {
    const { fromChain, toChain, fromToken, toToken } = get();
    set({
      fromChain: toChain,
      toChain: fromChain,
      fromToken: toToken,
      toToken: fromToken,
    });
  },
}));
