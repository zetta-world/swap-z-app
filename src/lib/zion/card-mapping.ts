/**
 * Pure, server-safe mapping from ZION action cards → CEX order intents.
 *
 * This module has NO "use client" directive and NO React/zustand imports, so
 * it can be imported from server routes (the background-autopilot cron) AND
 * from client code (the in-browser AutopilotPilot, via autopilot-bridge.ts
 * which re-exports these).
 *
 * Nothing here performs I/O or decides WHETHER to fire — it only normalizes a
 * card into one or more exchange-agnostic intents. Cap checks, countdowns and
 * the actual order placement live elsewhere.
 */

import type { ActionCard } from "@/lib/zion/parse";
import type { CexId, CexOrderSide, CexOrderType } from "@/lib/cex/types";
import { SUPPORTED_CEX_IDS } from "@/lib/cex/types";

/**
 * Curated whitelist of base symbols the autopilot is allowed to trade. The
 * full CEX ticker universe is huge and varies per exchange; this narrows it
 * to liquid majors. The per-session allowed_symbols list narrows it further.
 *
 * Lives here (not in store/autopilot.ts) so server code can use it without
 * importing the zustand store. store/autopilot.ts re-exports it for back-compat.
 */
export const AUTOPILOT_MAJOR_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "AVAX", "MATIC", "POL", "ARB", "OP",
  "LINK", "UNI", "AAVE", "PEPE", "WIF", "DOGE",
] as const;

export interface AutopilotIntent {
  /** "BTC/USDT" style. The quote side is always a stable. */
  symbol:   string;
  side:     CexOrderSide;
  type:     CexOrderType;
  /** Base-token quantity. */
  amount:   number;
  /** Limit price (for type="limit"). */
  price?:   number;
  /** Approx USD notional, for cap checks. */
  notionalUsd: number;
  /** Pinned venue for cross-CEX arb legs; undefined → picker chooses. */
  exchange?: CexId;
}

/** Strip wrapped / bridged token prefixes so "WETH" → "ETH" etc. */
export function normalizeSymbol(sym: string): string {
  const s = sym.toUpperCase().trim();
  if (/^W(ETH|BTC|BNB|MATIC|POL|AVAX|SOL)$/.test(s)) return s.slice(1);
  if (/^USDC([._].*)?$/.test(s) || s === "USDC.E")  return "USDC";
  if (/^USDT([._].*)?$/.test(s))                    return "USDT";
  if (s === "POL")    return "MATIC";
  return s;
}

const QUOTES_PREFERRED = ["USDT", "USDC", "FDUSD", "BUSD", "USD"];

/**
 * Pull a number out of a price string, robust to BOTH locale conventions.
 *
 * MONEY-CRITICAL (see C3 in docs/PLANO-DE-ACAO-ZION.md). The old version did
 * `.replace(/,/g,"")` which turned the PT/EU string "3.420,50" (= 3420.50)
 * into "3.420.50" → parseFloat → 3.42, a 1000× under-read. On a market BUY,
 * baseAmount = notional / price, so a price read 1000× too low means a base
 * amount 1000× too large → catastrophic overspend.
 *
 * Rules:
 *   - Both separators present → the LAST one is the decimal point; the other
 *     is a thousands separator. "3,420.50" (EN) and "3.420,50" (PT/EU) both
 *     resolve to 3420.50.
 *   - Single separator type → ambiguous (decimal vs thousands). When the
 *     groups look like thousands (every group after the first is exactly 3
 *     digits, 1-3 leading digits), strip it. This biases toward the LARGER
 *     price, which on a BUY means a SMALLER base amount — the SAFE direction
 *     (can never overspend). Otherwise treat it as a decimal point.
 *   - No separator → integer.
 *
 * Returns 0 for anything non-positive / unparseable (callers reject on 0).
 */
export function parsePrice(raw: string): number {
  const s = String(raw).replace(/[^\d.,]/g, "").trim();
  if (!s) return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");

  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalIsComma = lastComma > lastDot;
    const thousands = decimalIsComma ? "." : ",";
    const decimal   = decimalIsComma ? "," : ".";
    normalized = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep   = lastComma !== -1 ? "," : ".";
    const parts = s.split(sep);
    // A thousands lead group is 1-999 with NO leading zero. "0.816"/"0,816"
    // is a sub-$1 price (DOT!), never "0 thousand 816" — without this check,
    // any price under $1 with exactly 3 decimals parsed 1000x too big (caught
    // by the unit tests; likely the true culprit of the DOT 816-vs-0.816 row).
    const looksLikeThousands =
      parts.length > 1 &&
      /^[1-9]\d{0,2}$/.test(parts[0]) &&
      parts.slice(1).every((p) => p.length === 3);
    normalized = looksLikeThousands ? parts.join("") : s.replace(sep, ".");
  } else {
    normalized = s;
  }

  const n = parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolve a ZION card into one OR more CEX order intents.
 *   - null               → not mappable (caller skips the card).
 *   - [intent]           → single-leg trade.
 *   - [intentA, intentB] → atomic pair (arbitrage_cross_cex).
 *   - 3 intents          → arbitrage_triangular cycle.
 */
export function mapCardToCexIntents(card: ActionCard): AutopilotIntent[] | null {
  if (card.kind === "arbitrage_triangular") {
    const legs = card.cexLegs;
    if (!Array.isArray(legs) || legs.length !== 3) return null;
    const exchange = legs[0].exchange?.toLowerCase?.() as CexId;
    if (!SUPPORTED_CEX_IDS.includes(exchange)) return null;
    for (const leg of legs) {
      if (!leg.exchange || leg.exchange.toLowerCase() !== exchange) return null;
      if (leg.side !== "buy" && leg.side !== "sell")                return null;
      if (typeof leg.pair !== "string" || !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/i.test(leg.pair)) return null;
    }
    for (const leg of legs) {
      const base = normalizeSymbol(leg.pair.split("/")[0]);
      if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(base)) return null;
    }
    const seedUsd = card.from?.amount ? Number(card.from.amount) : NaN;
    if (!Number.isFinite(seedUsd) || seedUsd <= 0) return null;

    const intents: AutopilotIntent[] = [];
    for (const leg of legs) {
      const priceNum = leg.price ? parsePrice(leg.price) : 0;
      const baseAmount = leg.baseAmount ? parseFloat(String(leg.baseAmount).replace(/[, ]/g, "")) : 0;
      if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;
      intents.push({
        exchange,
        symbol:      leg.pair.toUpperCase(),
        side:        leg.side,
        type:        priceNum ? "limit" : "market",
        amount:      baseAmount,
        price:       priceNum || undefined,
        notionalUsd: seedUsd,
      });
    }
    return intents;
  }

  if (card.kind === "arbitrage_cross_cex") {
    const a = card.cexLegA, b = card.cexLegB;
    if (!a || !b || !a.exchange || !b.exchange || !a.symbol || !b.symbol) return null;
    const base = normalizeSymbol(a.symbol);
    if (base !== normalizeSymbol(b.symbol)) return null;
    if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(base)) return null;
    const exA = a.exchange.toLowerCase() as CexId;
    const exB = b.exchange.toLowerCase() as CexId;
    if (!SUPPORTED_CEX_IDS.includes(exA) || !SUPPORTED_CEX_IDS.includes(exB)) return null;
    if (exA === exB) return null;
    if (a.side === b.side) return null;
    const priceA = a.price ? parsePrice(a.price) : 0;
    const priceB = b.price ? parsePrice(b.price) : 0;
    if (!priceA || !priceB) return null;
    const notional = card.from?.amount ? Number(card.from.amount) : 0;
    if (!Number.isFinite(notional) || notional <= 0) return null;
    const buyPrice = a.side === "buy" ? priceA : priceB;
    const baseAmount = notional / buyPrice;
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;
    return [
      { exchange: exA, symbol: `${base}/USDT`, side: a.side, type: "limit", amount: baseAmount, price: priceA, notionalUsd: notional },
      { exchange: exB, symbol: `${base}/USDT`, side: b.side, type: "limit", amount: baseAmount, price: priceB, notionalUsd: notional },
    ];
  }

  const single = mapCardToCexIntent(card);
  return single ? [single] : null;
}

export function mapCardToCexIntent(card: ActionCard): AutopilotIntent | null {
  if (card.kind === "arbitrage_dex_cex") {
    if (!card.cexLeg || !card.cexLeg.symbol || !card.cexLeg.side) return null;
    const baseSym = normalizeSymbol(card.cexLeg.symbol);
    if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(baseSym)) return null;
    const priceNum = card.cexLeg.price ? parsePrice(card.cexLeg.price) : 0;
    const notional = card.from?.amount ? Number(card.from.amount) : 0;
    if (!Number.isFinite(notional) || notional <= 0) return null;
    const refPrice = priceNum || parsePrice(card.triggerPrice ?? card.entryPrice ?? "");
    if (!refPrice) return null;
    const baseAmount = notional / refPrice;
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;
    return {
      symbol:      `${baseSym}/USDT`,
      side:        card.cexLeg.side,
      type:        priceNum ? "limit" : "market",
      amount:      baseAmount,
      price:       priceNum || undefined,
      notionalUsd: notional,
    };
  }

  if (!card.from || !card.to) return null;

  const fromSym = normalizeSymbol(card.from.symbol);
  const toSym   = normalizeSymbol(card.to.symbol);

  const fromIsQuote = QUOTES_PREFERRED.includes(fromSym);
  const toIsQuote   = QUOTES_PREFERRED.includes(toSym);
  if (fromIsQuote === toIsQuote) return null;

  let side: CexOrderSide | null = null;
  let type: CexOrderType = "market";

  switch (card.kind) {
    case "swap":
      side = fromIsQuote ? "buy" : "sell";
      type = "market";
      break;
    case "buy_limit":
      side = "buy";
      type = "limit";
      break;
    case "sell_safe":
    case "sell_medium":
    case "sell_aggressive":
      side = "sell";
      type = "limit";
      break;
    case "stop_loss":
      return null;
    default:
      return null;
  }

  const baseSym  = side === "buy" ? toSym : fromSym;
  const quoteSym = side === "buy" ? fromSym : toSym;
  if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(baseSym)) return null;
  const symbol = `${baseSym}/${quoteSym}`;

  const amount = card.from.amount ? Number(card.from.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const priceStr = card.entryPrice ?? card.triggerPrice ?? "";
  const priceNum = parsePrice(priceStr);

  let baseAmount: number;
  let notionalUsd: number;
  let limitPrice: number | undefined;

  if (side === "buy") {
    if (!priceNum) return null;
    baseAmount  = amount / priceNum;
    notionalUsd = amount;
    limitPrice  = type === "limit" ? priceNum : undefined;
  } else {
    baseAmount  = amount;
    notionalUsd = priceNum ? amount * priceNum : amount;
    limitPrice  = type === "limit" ? priceNum : undefined;
  }

  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;

  return { symbol, side, type, amount: baseAmount, price: limitPrice, notionalUsd };
}

/**
 * Pick the first allowed + connected exchange. The caller passes the live
 * credentials map so we only fire on a venue the user has actually unlocked.
 */
export function pickExchangeForIntent(
  allowed: CexId[],
  connectedCreds: Partial<Record<CexId, { apiKey: string }>>,
): CexId | null {
  for (const id of allowed) {
    if (connectedCreds[id]) return id;
  }
  return null;
}
