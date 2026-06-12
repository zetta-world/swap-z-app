/**
 * Swap-confirmed celebration hook — ExecuteSwap announces a confirmed swap
 * via a DOM event; the god theme layer decides whether (and how) to
 * celebrate. Keeps execution code tier-agnostic: with no listener mounted
 * (free tier, reduced motion) the event is a no-op.
 */

export const SWAP_STRIKE_EVENT = "zswap:swap-confirmed";

export function fireSwapStrike(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SWAP_STRIKE_EVENT));
  }
}
