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
import { SUPPORTED_CEX_IDS } from "@/lib/cex/types";
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
  /**
   * For cross-CEX arbitrage, the venue is pinned by ZION (BUY on
   * gateio, SELL on coinbase). When set, the pilot uses this exact
   * exchange instead of picking from `allowedExchanges`. Single-CEX
   * intents leave it undefined and rely on the picker.
   */
  exchange?: CexId;
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
/**
 * Resolve a ZION card into one OR more CEX order intents.
 *
 * Returns:
 *   - null            → card not mappable (autopilot skips it).
 *   - [intent]        → single-leg trade (swap, buy_limit, sell_*,
 *                       arbitrage_dex_cex CEX side).
 *   - [intentA, intentB] → atomic pair (arbitrage_cross_cex). The
 *                       pilot must fire both or neither — partial
 *                       fills leave the user with directional risk.
 *
 * mapCardToCexIntent (singular) below is the v1 backwards-compatible
 * wrapper that returns the first intent of the pair. Direct callers
 * (the new AutopilotPilot) should use mapCardToCexIntents to see the
 * full plan.
 */
export function mapCardToCexIntents(card: ActionCard): AutopilotIntent[] | null {
  if (card.kind === "arbitrage_cross_cex") {
    const a = card.cexLegA, b = card.cexLegB;
    if (!a || !b || !a.exchange || !b.exchange || !a.symbol || !b.symbol) return null;
    const base = normalizeSymbol(a.symbol);
    if (base !== normalizeSymbol(b.symbol)) return null; // legs must be on the SAME base
    if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(base)) return null;
    const exA = a.exchange.toLowerCase() as CexId;
    const exB = b.exchange.toLowerCase() as CexId;
    if (!SUPPORTED_CEX_IDS.includes(exA) || !SUPPORTED_CEX_IDS.includes(exB)) return null;
    if (exA === exB) return null; // would self-arb, nonsense
    // Sides must be opposite — one buy, one sell.
    if (a.side === b.side) return null;
    const priceA = a.price ? parsePrice(a.price) : 0;
    const priceB = b.price ? parsePrice(b.price) : 0;
    if (!priceA || !priceB) return null; // require limits for cross-CEX to bound slippage
    const notional = card.from?.amount ? Number(card.from.amount) : 0;
    if (!Number.isFinite(notional) || notional <= 0) return null;
    // Both legs trade the same BASE quantity, sized off the BUY price.
    const buyPrice = a.side === "buy" ? priceA : priceB;
    const baseAmount = notional / buyPrice;
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;
    return [
      {
        exchange:    exA,
        symbol:      `${base}/USDT`,
        side:        a.side,
        type:        "limit",
        amount:      baseAmount,
        price:       priceA,
        notionalUsd: notional,
      },
      {
        exchange:    exB,
        symbol:      `${base}/USDT`,
        side:        b.side,
        type:        "limit",
        amount:      baseAmount,
        price:       priceB,
        notionalUsd: notional,
      },
    ];
  }

  const single = mapCardToCexIntent(card);
  return single ? [single] : null;
}

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
      // REQUIRED by /api/cex/order — without it the route rejects every
      // call with 400 missing_confirmation. The autopilot's own countdown
      // banner IS the user's confirmation surface, so we attach the token
      // here once the countdown has elapsed unblocked.
      confirm:   "I-CONFIRM-REAL-ORDER",
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

/**
 * Poll /api/cex/order/status until the order is in a terminal state
 * ("closed", "filled", "canceled") OR the timeout elapses. Returns the
 * last-known order. Used by the autopilot loss-stop machinery to wait
 * for fills before computing realized PnL.
 *
 * Polling cadence is intentionally slow (8s) — order books rarely move
 * fast enough for a tighter loop to matter and we want to keep the
 * /order/status endpoint's request budget under control.
 */
export async function pollOrderUntilSettled(
  exchange: CexId,
  creds:    CexCredentials,
  orderId:  string,
  symbol:   string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<CexOrder> {
  const timeoutMs  = opts?.timeoutMs  ?? 15 * 60_000;    // 15 minutes
  const intervalMs = opts?.intervalMs ?? 8_000;          // 8 seconds
  const deadline   = Date.now() + timeoutMs;
  // Tiny initial wait so we don't poll the exchange for a status that
  // hasn't even propagated yet.
  await new Promise((r) => setTimeout(r, 1_500));

  let last: CexOrder | null = null;
  while (Date.now() < deadline) {
    const res = await fetch("/api/cex/order/status", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        exchange,
        orderId,
        symbol,
        apiKey:     creds.apiKey,
        apiSecret:  creds.apiSecret,
        passphrase: creds.passphrase,
      }),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as { ok?: boolean; order?: CexOrder };
      if (body.ok && body.order) {
        last = body.order;
        const status = last.status?.toLowerCase() ?? "";
        if (status === "closed" || status === "filled" || status === "canceled" || status === "cancelled" || status === "expired") {
          return last;
        }
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (last) return last;          // timeout — best-effort last snapshot
  throw new Error("order status poll timed out without any response");
}
