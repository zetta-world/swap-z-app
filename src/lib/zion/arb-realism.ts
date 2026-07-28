/**
 * ARBITER F2 — orderbook realism (docs/PLANO-ARBITER-REAL.md).
 *
 * The paper arbiter assumes BOTH legs fill at the observed TOP price. Reality:
 * you walk the book, and depth eats the spread. This module computes the
 * REALISTIC round-trip against real bid/ask depth, so we learn how much of the
 * paper 0.30% survives before risking a cent. Pure math here (unit-tested);
 * the live orderbook fetch lives in cex-orderbook.ts and runs in prod.
 *
 * Model: buy `sizeUsd` of base on the cheap venue by walking its ASKS (paying
 * up the book), then sell the base you got on the rich venue by walking its
 * BIDS (down the book). realisticSpread = (sellVWAP − buyVWAP)/buyVWAP.
 */

/** [price, size] level. Asks sorted ascending, bids descending. */
export type Level = [number, number];

export interface FillBuy { avgPrice: number; baseFilled: number; fullyFilled: boolean }
export interface FillSell { avgPrice: number; usdFilled: number; fullyFilled: boolean }

/** Spend `sizeUsd` walking asks; returns the volume-weighted fill price and how
 *  much base that bought. fullyFilled=false when the book is too thin. */
export function vwapBuy(asks: Level[], sizeUsd: number): FillBuy {
  let spent = 0, base = 0;
  for (const [price, size] of asks) {
    if (!(price > 0) || !(size > 0)) continue;
    const levelUsd = price * size;
    const take = Math.min(levelUsd, sizeUsd - spent);
    spent += take; base += take / price;
    if (spent >= sizeUsd - 1e-9) break;
  }
  return { avgPrice: base > 0 ? spent / base : 0, baseFilled: base, fullyFilled: spent >= sizeUsd - 1e-9 };
}

/** Sell `baseAmt` walking bids; returns the VWAP sell price and USD received. */
export function vwapSell(bids: Level[], baseAmt: number): FillSell {
  let sold = 0, usd = 0;
  for (const [price, size] of bids) {
    if (!(price > 0) || !(size > 0)) continue;
    const take = Math.min(size, baseAmt - sold);
    sold += take; usd += take * price;
    if (sold >= baseAmt - 1e-12) break;
  }
  return { avgPrice: sold > 0 ? usd / sold : 0, usdFilled: usd, fullyFilled: sold >= baseAmt - 1e-12 };
}

export interface Realism {
  theoreticalNetPct: number;   // top-of-book spread − cost (what paper booked)
  realisticNetPct:   number;   // depth-walked spread − cost
  slippagePct:       number;   // theoretical − realistic (how much depth ate)
  fullyFilled:       boolean;  // both legs had enough depth for sizeUsd
}

/** Compare the paper (top-of-book) net against the depth-walked net. */
export function assessRealism(
  buyAsks: Level[], sellBids: Level[], sizeUsd: number,
  theoreticalSpreadPct: number, costPct: number,
): Realism {
  const buy  = vwapBuy(buyAsks, sizeUsd);
  const sell = vwapSell(sellBids, buy.baseFilled);
  const realisticSpreadPct = buy.avgPrice > 0 ? ((sell.avgPrice - buy.avgPrice) / buy.avgPrice) * 100 : 0;
  const theoreticalNetPct = theoreticalSpreadPct - costPct;
  const realisticNetPct   = realisticSpreadPct - costPct;
  return {
    theoreticalNetPct: Math.round(theoreticalNetPct * 1000) / 1000,
    realisticNetPct:   Math.round(realisticNetPct   * 1000) / 1000,
    slippagePct:       Math.round((theoreticalNetPct - realisticNetPct) * 1000) / 1000,
    fullyFilled:       buy.fullyFilled && sell.fullyFilled,
  };
}
