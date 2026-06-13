import type { Token } from "@/lib/tokens";

/**
 * USD value of the native gas token Z-SWAP always keeps in the wallet so a
 * ZION-executed swap never drains the balance below what's needed to pay
 * network fees. Example: selling on BNB Chain leaves ~$1 of BNB for gas.
 */
export const GAS_RESERVE_USD = 1;

/** A token is the chain's native gas asset when it has no contract address. */
export function isNativeToken(token: Token | undefined | null): boolean {
  return !!token && token.address === "native";
}

export interface NativeGasReserveResult {
  /** Possibly-reduced sell amount (decimal string), safe for setAmountIn. */
  amount:      string;
  /** True when we capped the amount to preserve the gas reserve. */
  adjusted:    boolean;
  /** USD value held back (GAS_RESERVE_USD when applied, else 0). */
  reservedUsd: number;
}

/**
 * Cap a ZION-proposed sell amount so that `GAS_RESERVE_USD` worth of the
 * native gas token always stays in the wallet to cover network fees.
 *
 * Only acts when the SELL token is the native gas asset — ERC-20/SPL swaps
 * pay gas in the native coin, not in the token being sold, so they're left
 * untouched. Also a no-op when ZION already proposed a size that leaves
 * enough headroom (e.g. selling 10% of the balance).
 *
 * Needs a positive live price to convert the USD reserve into native units;
 * if the price or balance is unavailable, it leaves the amount unchanged
 * rather than guessing.
 */
export function applyNativeGasReserve(args: {
  token:            Token;
  requestedAmount:  string;
  balanceFormatted: string;
  nativePriceUsd:   number | null;
}): NativeGasReserveResult {
  const { token, requestedAmount, balanceFormatted, nativePriceUsd } = args;
  const requested = Number(requestedAmount);

  const unchanged: NativeGasReserveResult = {
    amount: requestedAmount, adjusted: false, reservedUsd: 0,
  };

  // Gas reserve only applies to the native coin being sold.
  if (!isNativeToken(token)) return unchanged;
  if (!Number.isFinite(requested) || requested <= 0) return unchanged;
  // Need a positive price to turn $1 into a native-token amount.
  if (!nativePriceUsd || !Number.isFinite(nativePriceUsd) || nativePriceUsd <= 0) return unchanged;

  const balance = Number(balanceFormatted);
  if (!Number.isFinite(balance) || balance <= 0) return unchanged;

  const reserveNative = GAS_RESERVE_USD / nativePriceUsd;
  const maxSellable   = Math.max(balance - reserveNative, 0);

  // ZION already left enough native behind — nothing to cap.
  if (requested <= maxSellable) return unchanged;

  return {
    amount:      formatNativeAmount(maxSellable, token.decimals),
    adjusted:    true,
    reservedUsd: GAS_RESERVE_USD,
  };
}

/** Decimal string without scientific notation, trimmed of trailing zeros. */
function formatNativeAmount(n: number, decimals: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const places = Math.min(Math.max(decimals, 0), 8);
  let s = n.toFixed(places);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s || "0";
}
