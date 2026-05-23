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

const KEY = "zion_pending_orders_v1";

export interface PendingOrder {
  id:        string;     // local random id
  createdAt: number;     // unix ms
  card:      ActionCard;
  status:    "pending" | "fired" | "expired" | "cancelled";
  /** Last error if the user tried to fire and it failed. */
  lastError?: string;
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
