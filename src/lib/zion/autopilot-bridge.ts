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

import type { CexCredentials, CexId, CexOrder } from "@/lib/cex/types";
import { SUPPORTED_CEX_IDS } from "@/lib/cex/types";
import type { ActionCard } from "@/lib/zion/parse";

// The pure card→intent mapping now lives in a server-safe module so the
// background-autopilot cron can reuse it. Re-exported here so existing client
// imports (`from "@/lib/zion/autopilot-bridge"`) keep working unchanged.
export {
  AUTOPILOT_MAJOR_SYMBOLS,
  normalizeSymbol,
  parsePrice,
  mapCardToCexIntents,
  mapCardToCexIntent,
  pickExchangeForIntent,
  type AutopilotIntent,
} from "@/lib/zion/card-mapping";
import { parsePrice } from "@/lib/zion/card-mapping";
import type { AutopilotIntent } from "@/lib/zion/card-mapping";

/**
 * Place the order against /api/cex/order. Returns the order on
 * success; throws with a sanitized message on failure.
 */
export async function fireAutopilotIntent(
  exchange: CexId,
  creds:    CexCredentials,
  intent:   AutopilotIntent,
  maxNotionalUsd?: number,
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
      // Trigger the server-side real-price notional guard (C1/C4). The cap
      // lets the server reject an order whose true notional blows past it.
      autopilot:      true,
      maxNotionalUsd: maxNotionalUsd,
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
  maxNotionalUsd?: number,
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
      // Server-side per-rebalance cap check against a fresh real price (C6).
      autopilot:      true,
      maxNotionalUsd: maxNotionalUsd,
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
