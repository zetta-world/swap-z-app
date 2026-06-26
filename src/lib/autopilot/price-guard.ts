/**
 * Autopilot money guard (C1/C4 in docs/PLANO-DE-ACAO-ZION.md).
 *
 * The order amount and price on an autopilot intent are derived from
 * LLM-generated card text, and the per-trade cap was historically checked
 * against the LLM's OWN claimed USD number — a circular check. A stale or
 * mis-parsed price could make `baseAmount = notional / price` wrong by orders
 * of magnitude, and a market order has no price for the server's notional
 * ceiling to bind, so the real spend was effectively unbounded.
 *
 * This module recomputes the TRUE notional as `baseAmount × referencePrice`
 * (a fresh public spot price) and rejects oversized BUYS. The dangerous
 * direction is overspend (price read too low → base amount too high); an
 * underspend (price read too high → base amount too low) is harmless and
 * passes. SELLS are only checked against the absolute ceiling — they reduce
 * exposure and are naturally bounded by the user's holdings.
 *
 * Server-safe: no "use client", no React/zustand. Used by both the in-browser
 * order route and the background cron so the two channels share one guard.
 */

import { getCexSpotPrices } from "@/lib/api/cex-spot";

/** Headroom over the per-trade cap before rejecting (fees + price drift). */
export const NOTIONAL_TOLERANCE = 1.5;

/** Absolute ceiling for any single autopilot order, independent of user cap. */
export const AUTOPILOT_HARD_CEILING_USD = 100_000;

/** Fresh reference USD price for a base symbol, or null if unavailable. */
export async function getReferencePriceUsd(base: string): Promise<number | null> {
  const norm = base.toUpperCase().trim();
  const map = await getCexSpotPrices([norm]);
  const hit = map.get(norm);
  return hit && hit.priceUsd > 0 ? hit.priceUsd : null;
}

export interface NotionalCheck {
  ok:              boolean;
  realNotionalUsd: number | null;
  reason?:         string;
}

/**
 * Reconcile an autopilot order against a real reference price.
 *
 * Rejects when:
 *   - no reference price is available (fail-safe — never fire a buy we can't
 *     price-check);
 *   - the real notional exceeds the absolute hard ceiling;
 *   - (buys only) the real notional exceeds the per-trade cap × tolerance.
 */
export function checkRealNotional(params: {
  side:        "buy" | "sell";
  baseAmount:  number;
  refPrice:    number | null;
  maxTradeUsd: number;
}): NotionalCheck {
  const { side, baseAmount, refPrice, maxTradeUsd } = params;

  if (refPrice === null || !(refPrice > 0)) {
    return { ok: false, realNotionalUsd: null, reason: "no reference price for symbol" };
  }
  const realNotionalUsd = baseAmount * refPrice;
  if (!Number.isFinite(realNotionalUsd) || realNotionalUsd <= 0) {
    return { ok: false, realNotionalUsd: null, reason: "non-finite real notional" };
  }
  if (realNotionalUsd > AUTOPILOT_HARD_CEILING_USD) {
    return {
      ok: false,
      realNotionalUsd,
      reason: `real notional $${realNotionalUsd.toFixed(0)} over hard ceiling $${AUTOPILOT_HARD_CEILING_USD}`,
    };
  }
  if (side === "buy" && realNotionalUsd > maxTradeUsd * NOTIONAL_TOLERANCE) {
    return {
      ok: false,
      realNotionalUsd,
      reason: `real notional $${realNotionalUsd.toFixed(2)} exceeds per-trade cap $${maxTradeUsd} (×${NOTIONAL_TOLERANCE})`,
    };
  }
  return { ok: true, realNotionalUsd };
}
