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
  if (card.kind === "arbitrage_triangular") {
    const legs = card.cexLegs;
    if (!Array.isArray(legs) || legs.length !== 3) return null;
    const exchange = legs[0].exchange?.toLowerCase?.() as CexId;
    if (!SUPPORTED_CEX_IDS.includes(exchange)) return null;
    // Cycle invariant: every leg must pin to the same CEX. Triangular
    // arb across venues would need on-chain transfers — out of scope.
    for (const leg of legs) {
      if (!leg.exchange || leg.exchange.toLowerCase() !== exchange) return null;
      if (leg.side !== "buy" && leg.side !== "sell")                return null;
      if (typeof leg.pair !== "string" || !/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/i.test(leg.pair)) return null;
    }
    // Every base symbol that appears must be on the whitelist (the
    // quote side can be anything — USDT, USDC, BTC, ETH).
    for (const leg of legs) {
      const base = normalizeSymbol(leg.pair.split("/")[0]);
      if (!(AUTOPILOT_MAJOR_SYMBOLS as readonly string[]).includes(base)) return null;
    }
    // Sum-of-notionals USD ceiling: the cycle exposes ~notional × 3 in
    // gross flow but only the seed amount in directional risk. We size
    // each leg's notionalUsd as the seed (the autopilot's per-trade cap
    // applies once per leg, not per gross flow). Seed comes from
    // card.from.amount (USD).
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

// ─── Auto-rebalance: CEX → wallet withdrawal ────────────────────────────
//
// Sibling pipeline to AutopilotIntent for the new `rebalance` card kind.
// Auto-rebalance MOVES funds (it doesn't trade them), so it has its own
// shape, its own opt-in toggle, its own per-day cap, its own history
// status. Failing here doesn't trip the daily loss-stop — the loss-stop
// only tracks realized trading PnL, not fund movement.

export interface AutopilotWithdrawIntent {
  /** Source CEX. */
  exchange:        CexId;
  /** Currency to withdraw, uppercase (e.g. "USDT"). */
  currency:        string;
  /** Amount in `currency` units. */
  amount:          number;
  /** Network slug ("SOL", "ERC20", "BSC", "POLYGON", …). */
  network:         string;
  /** Optional memo / destination tag if the chain demands one. */
  tag?:            string;
  /** USD-equivalent of `amount` — used for the per-rebalance cap check. */
  notionalUsd:     number;
  /** Suggested re-deposit target (informational only, for the toast). */
  toExchange?:     string;
  /** Source card's title slice for the audit log. */
  cardTitle:       string;
}

/**
 * Pull the structured rebalance request off a card. Returns null when
 * the card isn't a rebalance kind or its shape is malformed. Sizing /
 * cap checks happen at fire time in the pilot — this function just
 * normalizes the shape.
 */
export function mapCardToWithdrawIntent(card: ActionCard): {
  exchange:    CexId;
  currency:    string;
  amount:      number;
  network:     string;
  tag?:        string;
  notionalUsd: number;
  toExchange?: string;
  cardTitle:   string;
} | null {
  if (card.kind !== "rebalance") return null;
  const r = card.rebalance;
  if (!r || !r.fromExchange || !r.currency || !r.amount || !r.network) return null;

  const ex = r.fromExchange.toLowerCase() as CexId;
  if (!SUPPORTED_CEX_IDS.includes(ex)) return null;

  const currency = String(r.currency).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (currency.length < 2 || currency.length > 20) return null;

  const amount = parseFloat(String(r.amount).replace(/[, ]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const network = String(r.network).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (network.length < 2 || network.length > 32) return null;

  // Best-effort USD notional from card.estReturn or card.targetReturn,
  // or fall back to the amount itself (which is correct for stables).
  const notionalUsd = parsePrice(card.estReturn ?? card.targetReturn ?? "") || amount;

  return {
    exchange:    ex,
    currency,
    amount,
    network,
    tag:         r.tag,
    notionalUsd,
    toExchange:  r.toExchange,
    cardTitle:   String(card.title ?? "rebalance").slice(0, 80),
  };
}

/**
 * Resolve the destination address for a rebalance from the user's
 * connected wallet, picking the right wallet (Phantom vs EVM) for the
 * network. Returns null when the right wallet isn't connected — the
 * pilot treats this as "skip the card" so we never withdraw to an
 * address we can't verify the user controls.
 */
export function resolveWithdrawDestination(
  network: string,
  evmAddress: string | undefined,
  solAddress: string | null,
): string | null {
  const n = network.toUpperCase();
  if (n === "SOL" || n === "SPL" || n === "SOLANA") {
    return solAddress && solAddress.length >= 32 ? solAddress : null;
  }
  // Everything else we treat as EVM: ERC20, BSC, POLYGON, ARB, OP, BASE…
  if (!evmAddress) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) return null;
  return evmAddress;
}

/**
 * Fire a withdrawal via /api/cex/withdraw. Mirrors the order-firing
 * pattern: includes the confirm magic token, returns the receipt on
 * success or throws on failure with a sanitized message.
 *
 * Notably this does NOT include 2FA — auto-rebalance is opt-in to
 * exchanges that don't require 2FA for whitelisted addresses. If the
 * user's exchange demands 2FA, the call will fail upstream and we
 * surface the error verbatim so they know to either turn off
 * auto-rebalance for that venue or whitelist the address differently.
 */
export async function fireAutopilotWithdraw(
  exchange:    CexId,
  creds:       CexCredentials,
  intent:      AutopilotWithdrawIntent,
  destination: string,
): Promise<{ id: string; status: string; txid?: string; network?: string; address?: string }> {
  const res = await fetch("/api/cex/withdraw", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      exchange,
      currency:   intent.currency,
      amount:     intent.amount,
      address:    destination,
      network:    intent.network,
      tag:        intent.tag,
      confirm:    "I-CONFIRM-REAL-WITHDRAWAL",
      apiKey:     creds.apiKey,
      apiSecret:  creds.apiSecret,
      passphrase: creds.passphrase,
    }),
  });
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean;
    receipt?: { id: string; status: string; txid?: string; network?: string; address?: string };
    error?: string;
    detail?: string;
  };
  if (!res.ok || !body.ok || !body.receipt) {
    const reason = body.detail || body.error || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return body.receipt;
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
