/**
 * Pending-orders storage for ZION action cards that can't execute immediately
 * (limit / stop loss / sniper watch / safe-medium-aggressive sells). These
 * are stored locally in the browser; the /orders page reads them and offers
 * manual fire-now or cancel.
 *
 * No backend — the orders never leave the user's machine. Future revisions
 * may sync them to a wallet-scoped server store, but for now this keeps the
 * "advisory only" posture intact and avoids any custody.
 */

import type { ActionCard } from "./parse";
import type { ChainId } from "@/lib/chains";

const KEY = "zion_pending_orders_v1";

/**
 * Optional CoW Protocol attachment for orders that have been pre-signed
 * for autopilot fill. When present, the order is "armed" — a solver will
 * fill it automatically the moment the market hits the limit. Without
 * this, the order stays in pure-manual mode.
 */
export interface CowAttachment {
  chain:     ChainId;
  /** The CoW orderUid (0x… 56-byte hash) returned by the POST. */
  orderUid:  string;
  /** Unix ms when the user signed. */
  signedAt:  number;
  /** Unix ms when the order auto-expires per validTo. */
  expiresAt: number;
  /** Cached last-known status — refreshed by /orders on load. */
  lastStatus?: "open" | "fulfilled" | "cancelled" | "expired" | "unknown";
  /** Unix ms of the last status refresh, for cache invalidation. */
  lastChecked?: number;
}

export interface PendingOrder {
  id:        string;     // local random id
  createdAt: number;     // unix ms
  card:      ActionCard;
  status:    "pending" | "fired" | "expired" | "cancelled";
  /** Last error if the user tried to fire and it failed. */
  lastError?: string;
  /** Set when the order was pre-signed via CoW Protocol. */
  cow?:      CowAttachment;
}

function safeRead(): PendingOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingOrder[]) : [];
  } catch {
    return [];
  }
}

function safeWrite(orders: PendingOrder[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    /* quota — silently drop */
  }
}

export function listPendingOrders(): PendingOrder[] {
  return safeRead().sort((a, b) => b.createdAt - a.createdAt);
}

export function savePendingOrder(card: ActionCard): PendingOrder {
  const order: PendingOrder = {
    id:        crypto.randomUUID(),
    createdAt: Date.now(),
    card,
    status:    "pending",
  };
  const existing = safeRead();
  existing.push(order);
  safeWrite(existing);
  return order;
}

export function deletePendingOrder(id: string) {
  const existing = safeRead();
  safeWrite(existing.filter((o) => o.id !== id));
}

export function updatePendingOrder(id: string, patch: Partial<PendingOrder>) {
  const existing = safeRead();
  safeWrite(existing.map((o) => (o.id === id ? { ...o, ...patch } : o)));
}

/**
 * Attach a CoW Protocol pre-sign payload to an existing pending order.
 * Idempotent — calling again overwrites the previous attachment. Used
 * right after SignLimitOrderButton successfully POSTs to CoW.
 */
export function attachCowOrder(id: string, cow: CowAttachment) {
  updatePendingOrder(id, { cow });
}

/**
 * Update the cached CoW status on an order. Called by /orders when it
 * polls api.cow.fi to refresh the badge.
 */
export function updateCowStatus(id: string, status: CowAttachment["lastStatus"]) {
  const existing = safeRead();
  safeWrite(existing.map((o) => {
    if (o.id !== id || !o.cow) return o;
    return { ...o, cow: { ...o.cow, lastStatus: status, lastChecked: Date.now() } };
  }));
}

/**
 * Whether a card kind can execute right now (swap / bridge / arbitrage) or
 * needs to wait for a trigger (limit / stop / sniper watch).
 */
export function isImmediateCard(kind: string): boolean {
  return (
    kind === "swap" ||
    kind === "bridge" ||
    kind === "arbitrage" ||
    kind === "arbitrage_same_chain" ||
    kind === "arbitrage_cross_chain" ||
    kind === "approve"
  );
}
