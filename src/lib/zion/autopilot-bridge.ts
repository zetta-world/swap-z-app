"use client";

/**
 * Bridge between ZION action cards and the CEX trading API.
 *
 * The drawer surfaces cards anchored to DEX context (chain, contract
 * addresses). The autopilot needs them as CEX orders ("BTC/USDT market
 * BUY 0.01"). This file handles:
 *
 *   1. mapCardToCexIntent — decides if a card is CEX-mappable and
 *      produces the intent (exchange-agnostic, just symbol + side +
 *      type + qty + optional price).
 *   2. pickExchangeForIntent — given the user's allowed-exchanges list
 *      and the symbol, returns the first exchange that's both connected
 *      AND likely to list the pair (defensive: we let the upstream
 *      reject it if the pair isn't actually listed).
 *   3. fireAutopilotIntent — actually places the order against /api/cex/order.
 *
 * Nothing here decides WHETHER to fire; the autopilot UI runs the
 * countdown and the user can always cancel. This file is the
 * mechanism, not the policy.
 */

import type { ActionCard } from "@/lib/zion/parse";
import type { CexCredentials, CexId, CexOrder, CexOrderSide, CexOrderType } from "@/lib/cex/types";
import { AUTOPILOT_MAJOR_SYMBOLS } from "@/lib/store/autopilot";

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
}

/** Strip wrapped / bridged token prefixes so "WETH" → "ETH" etc. */
function normalizeSymbol(sym: string): string {
  const s = sym.toUpperCase().trim();
  // Strip leading W for wrapped natives we trade on CEX as native.
  if (/^W(ETH|BTC|BNB|MATIC|POL|AVAX|SOL)$/.test(s)) return s.slice(1);
  // Bridged stables → USDC/USDT canonical (USDC.e, USDC_, sUSDC etc).
  if (/^USDC([._].*)?$/.test(s) || s === "USDC.E")  return "USDC";
  if (/^USDT([._].*)?$/.test(s))                    return "USDT";
  // POL ↔ MATIC swap on Polygon (rebrand).
  if (s === "POL")    return "MATIC";
  return s;
}

const QUOTES_PREFERRED = ["USDT", "USDC", "FDUSD", "BUSD", "USD"];

/**
 * Decide whether a ZION card maps cleanly to a CEX order. Returns the
 * intent on success; null on skip. The autopilot will simply not act
 * on unmappable cards — the user can still execute them manually via
 * the existing drawer path.
 */
export function mapCardToCexIntent(card: ActionCard): AutopilotIntent | null {
  // arbitrage_dex_cex carries its OWN structured cexLeg description and
  // doesn't depend on the standard from/to pair semantics — handle it
  // up-front before the stable-pair heuristics kick in.
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

  // Decide which side is base vs quote. The quote is the stable.
  const fromIsQuote = QUOTES_PREFERRED.includes(fromSym);
  const toIsQuote   = QUOTES_PREFERRED.includes(toSym);

  if (fromIsQuote === toIsQuote) {
    // Two stables or two non-stables — autopilot can't disambiguate.
    return null;
  }

  // Map kind → side
  let side: CexOrderSide | null = null;
  let type: CexOrderType = "market";

  switch (card.kind) {
    case "swap":
      // The card already represents an intent: spend `from` to get `to`.
      // If FROM is stable (USDC → ETH) it's a BUY on the ETH/USDC pair.
      // If TO is stable (ETH → USDC) it's a SELL on the ETH/USDC pair.
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
      // Stop-loss requires a separate exchange API (createStopOrder); v1
      // skips so we don't accidentally fire a market sell at the wrong
      // price. The card still renders for manual execution.
      return null;
    default:
      return null;
  }

  // Build "BASE/QUOTE" string.
  const baseSym  = side === "buy" ? toSym : fromSym;
  const quoteSym = side === "buy" ? fromSym : toSym;
  // Only operate on the curated major-symbol list. The full list of CEX
  // tickers is huge and varies per exchange; the autopilot whitelist
  // narrows it further and the user controls that in Settings.
  if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(baseSym)) return null;
  const symbol = `${baseSym}/${quoteSym}`;

  // Quantity comes from card.from.amount when present, otherwise we
  // refuse to act (no implicit "10% of portfolio" — too risky).
  const amount = card.from.amount ? Number(card.from.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // For "buy" side, card.from.amount is in QUOTE currency (USDC), but
  // CEX createOrder expects BASE amount. We need a price to convert.
  // We use card.entryPrice or triggerPrice; if neither is present, skip.
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
    // sell — amount IS the base quantity
    baseAmount  = amount;
    notionalUsd = priceNum ? amount * priceNum : amount;  // best-effort
    limitPrice  = type === "limit" ? priceNum : undefined;
  }

  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;

  return {
    symbol,
    side,
    type,
    amount: baseAmount,
    price:  limitPrice,
    notionalUsd,
  };
}

/** Pull a number out of a locale-formatted price string ("$3,420.50"). */
function parsePrice(raw: string): number {
  const m = String(raw).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = parseFloat(m);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Pick the first allowed + connected exchange. Caller passes the live
 * credentials map (decrypted in memory) so we can verify the user has
 * actually unlocked the vault before firing.
 */
export function pickExchangeForIntent(
  allowed: CexId[],
  connectedCreds: Partial<Record<CexId, CexCredentials>>,
): CexId | null {
  for (const id of allowed) {
    if (connectedCreds[id]) return id;
  }
  return null;
}

/**
 * Place the order against /api/cex/order. Returns the order on
 * success; throws with a sanitized message on failure.
 */
export async function fireAutopilotIntent(
  exchange: CexId,
  creds:    CexCredentials,
  intent:   AutopilotIntent,
): Promise<CexOrder> {
  const res = await fetch("/api/cex/order", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      exchange,
      apiKey:    creds.apiKey,
      apiSecret: creds.apiSecret,
      passphrase: creds.passphrase,
      symbol:    intent.symbol,
      side:      intent.side,
      type:      intent.type,
      amount:    intent.amount,
      price:     intent.price,
    }),
  });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean; order?: CexOrder; error?: string; detail?: string;
  };
  if (!res.ok || !body.ok || !body.order) {
    const reason = body.detail || body.error || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return body.order;
}
