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
  status:    "pending" | "fired" | "expired" | "cancelled" | "triggered";
  /** Last error if the user tried to fire and it failed. */
  lastError?: string;
  /** Set when the order was pre-signed via CoW Protocol. */
  cow?:      CowAttachment;
  /** Unix ms when the price watcher detected the trigger was reached. */
  triggeredAt?: number;
  /**
   * ⚠️ Unix ms de quando o par foi CARREGADO no swap card — que NÃO é o mesmo
   * que executado (auditoria de 24/08).
   *
   * O `onFireNow` gravava `status: "fired"` no clique, antes de o drawer sequer
   * abrir. Fechar sem assinar deixava a ordem marcada DISPARADA para sempre, e
   * "carreguei a tela" ficava indistinguível de "gastei dinheiro" — invariante
   * nº 33.
   *
   * Esta aplicação NÃO consegue saber se o usuário assinou: a assinatura
   * acontece na carteira dele. Então ela não afirma. `status` segue `pending`,
   * e a tela diz "carregada há X", que é o que de fato aconteceu.
   */
  loadedAt?: number;
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

/** Event fired after any mutation so open lists (e.g. /orders) re-read. */
export const ORDERS_CHANGED_EVENT = "zion-orders-changed";

/**
 * ⚠️⚠️ DEVOLVE SE GRAVOU (auditoria de 24/08).
 *
 * A versão anterior tinha `catch { /* quota — silently drop *\/ }` e assinatura
 * `void`. Com o `localStorage` cheio, a ordem não era salva, nada acusava, e o
 * chamador mostrava "Ordem salva" — o dono fecharia a aba confiando numa ordem
 * que não existe.
 *
 * É a MESMA classe dos dois críticos do autopilot de 23/08 e do `engine.ts:492`:
 * a falha que resolve em vez de lançar. Aqui a fonte é outra (quota do
 * navegador, não `{ data: null, error }` do Supabase), o desfecho é idêntico.
 */
function safeWrite(orders: PendingOrder[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(orders));
    window.dispatchEvent(new Event(ORDERS_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function listPendingOrders(): PendingOrder[] {
  return safeRead().sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Grava uma ordem. ⚠️ Devolve `null` quando NÃO gravou — o chamador tem de
 * conferir antes de dizer ao dono que salvou.
 */
export function savePendingOrder(card: ActionCard): PendingOrder | null {
  const order: PendingOrder = {
    id:        crypto.randomUUID(),
    createdAt: Date.now(),
    card,
    status:    "pending",
  };
  const existing = safeRead();
  existing.push(order);
  return safeWrite(existing) ? order : null;
}

/**
 * ⚠️ TODAS AS MUTAÇÕES DEVOLVEM SE DERAM CERTO, e não só a que a auditoria
 * pegou. O defeito era de CLASSE — `safeWrite` era `void` e ninguém podia
 * conferir nada. Consertar só o `save` deixaria "Ordem removida" mentindo pelo
 * mesmo motivo, no botão do lado.
 */
export function deletePendingOrder(id: string): boolean {
  const existing = safeRead();
  return safeWrite(existing.filter((o) => o.id !== id));
}

export function updatePendingOrder(id: string, patch: Partial<PendingOrder>): boolean {
  const existing = safeRead();
  return safeWrite(existing.map((o) => (o.id === id ? { ...o, ...patch } : o)));
}

/**
 * Attach a CoW Protocol pre-sign payload to an existing pending order.
 * Idempotent — calling again overwrites the previous attachment. Used
 * right after SignLimitOrderButton successfully POSTs to CoW.
 */
export function attachCowOrder(id: string, cow: CowAttachment): boolean {
  return updatePendingOrder(id, { cow });
}

/**
 * Update the cached CoW status on an order. Called by /orders when it
 * polls api.cow.fi to refresh the badge.
 */
export function updateCowStatus(id: string, status: CowAttachment["lastStatus"]): boolean {
  const existing = safeRead();
  return safeWrite(existing.map((o) => {
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
