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

// SAQUE CEX REMOVIDO (30/07) — `fireAutopilotWithdraw` vivia aqui, junto do
// piloto de auto-rebalanceamento que o acionava. Ver a nota em lib/cex/server.ts:
// o recurso exigia chave de API com permissão de SAQUE, que é precisamente a
// permissão que nunca se deve conceder a um terceiro.

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
