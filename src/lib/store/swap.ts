import { create } from "zustand";
import { findToken, DEFAULT_TOKENS, type Token } from "../tokens";
import type { ChainId } from "../chains";
import type { QuoteSource } from "../api/quote-types";

type Risk = "safe" | "caution" | "danger";

export type SwapMode = "swap" | "cross" | "sniper";

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
  mode:        SwapMode;
  /**
   * Optional override for the destination address when bridging cross-chain.
   * `undefined` means deliver to the connected wallet (msg.sender).
   * Stored as the raw user input; validation happens at the boundary.
   */
  recipient:   string | undefined;
  /**
   * When `true`, the global ExecuteSwap modal portal is open. Triggered by
   * the swap card CTA, by the ZION execute router, and (eventually) by the
   * orders page when a stored proposal is fired manually.
   */
  executeOpen: boolean;
  /**
   * Aggregator source the user picked in the QuoteComparison panel. The
   * ExecuteSwap portal uses this — if null it auto-picks best output.
   */
  selectedSource: QuoteSource | null;
  setFromChain: (c: ChainId) => void;
  setToChain:   (c: ChainId) => void;
  setFromToken: (t: Token) => void;
  setToToken:   (t: Token) => void;
  setAmountIn:  (v: string) => void;
  setSlippage:  (bps: number) => void;
  setMev:       (b: boolean) => void;
  setPrivacy:   (b: boolean) => void;
  setMode:      (m: SwapMode) => void;
  setRecipient: (r: string | undefined) => void;
  setExecuteOpen: (b: boolean) => void;
  setSelectedSource: (s: QuoteSource | null) => void;
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
  mode:        "swap",
  recipient:   undefined,
  executeOpen: false,
  selectedSource: null,

  setFromChain: (c) => {
    const oldFromChain = get().fromChain;
    if (c === oldFromChain) {
      set({ fromChain: c });
      return;
    }
    const { fromToken, toToken } = get();
    const newFrom =
      (fromToken && fromToken.chain === c ? fromToken : undefined) ??
      DEFAULT_TOKENS.find((t) => t.chain === c && t.address === "native") ??
      DEFAULT_TOKENS.find((t) => t.chain === c);
    // Preserve cross-chain intent: if the user deliberately picked a toToken
    // on a different chain than the old fromChain, that's a bridge pair —
    // keep the destination side instead of collapsing it to the new chain.
    const wasCrossChain = !!(toToken && toToken.chain !== oldFromChain);
    if (wasCrossChain && toToken) {
      set({ fromChain: c, toChain: toToken.chain, fromToken: newFrom, toToken });
      return;
    }
    const newTo = defaultCounterpart(c, newFrom?.address);
    set({ fromChain: c, toChain: c, fromToken: newFrom, toToken: newTo });
  },

  setToChain: (c) => set({ toChain: c }),

  /**
   * Setting the FROM token updates the from-side and its chain. If the
   * resulting pair would be (X → X) on same chain, picks a sensible
   * counterpart on the same chain so the quote is queryable. The user can
   * freely choose any to-token on any chain afterwards (cross-chain is
   * supported via LiFi).
   */
  setFromToken: (t) => {
    const { toToken } = get();
    // Only reset toToken if it would create an identical-token pair on the
    // same chain. Cross-chain identical tokens (USDC on ETH ↔ USDC on Base)
    // are a valid bridge operation, so we KEEP those.
    const sameTokenSameChain =
      toToken &&
      toToken.chain === t.chain &&
      toToken.address.toLowerCase() === t.address.toLowerCase();
    const newTo = sameTokenSameChain ? defaultCounterpart(t.chain, t.address) : toToken;
    set({
      fromToken: t,
      fromChain: t.chain,
      toToken:   newTo,
    });
  },

  /**
   * Setting the TO token updates the to-side and its chain. Cross-chain
   * pairs (different fromChain vs toChain) are valid — they route through
   * LiFi. Only the identical-token-same-chain case needs auto-fix.
   */
  setToToken: (t) => {
    const { fromToken } = get();
    const sameTokenSameChain =
      fromToken &&
      fromToken.chain === t.chain &&
      fromToken.address.toLowerCase() === t.address.toLowerCase();
    if (sameTokenSameChain) {
      // Pick a sensible new from-token on the same chain
      const newFrom =
        DEFAULT_TOKENS.find((x) => x.chain === t.chain && x.address === "native" && x.address.toLowerCase() !== t.address.toLowerCase()) ??
        defaultCounterpart(t.chain, t.address);
      set({ toToken: t, toChain: t.chain, fromToken: newFrom });
    } else {
      set({ toToken: t, toChain: t.chain });
    }
  },

  setAmountIn:  (v) => set({ amountIn: v }),
  setSlippage:  (bps) => set({ slippageBps: bps }),
  setMev:       (b) => set({ mevProtect: b }),
  setPrivacy:   (b) => set({ privacyMode: b }),
  setMode:      (m) => set({ mode: m }),
  setRecipient: (r) => set({ recipient: r === "" ? undefined : r }),
  setExecuteOpen: (b) => set({ executeOpen: b }),
  setSelectedSource: (s) => set({ selectedSource: s }),

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
