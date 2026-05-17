import { create } from "zustand";
import { findToken, type Token } from "../tokens";
import type { ChainId } from "../chains";

type Risk = "safe" | "caution" | "danger";

export function riskFromScore(score: number | undefined): Risk {
  if (score === undefined || score === null) return "safe";
  if (score < 20) return "safe";
  if (score < 50) return "caution";
  return "danger";
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

  setFromChain: (c) => set({ fromChain: c }),
  setToChain:   (c) => set({ toChain: c }),
  setFromToken: (t) => set({ fromToken: t }),
  setToToken:   (t) => set({ toToken: t }),
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
