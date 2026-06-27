import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";

type EventOpts = {
  wallet?: string | null;
  path?:   string | null;
  meta?:   Record<string, unknown>;
};

/**
 * Fire-and-forget platform event recorder.
 * Never throws, never awaited by callers — tracking must not add latency.
 */
export function recordEvent(type: string, opts: EventOpts = {}): void {
  const db = getSupabaseAdmin();
  if (!db) return;

  const promise = db.from("platform_events").insert({
    event_type:     type,
    wallet_address: opts.wallet ?? null,
    path:           opts.path   ?? null,
    metadata:       opts.meta   ?? null,
  });
  // Supabase builder returns a PromiseLike; cast to Promise for .catch
  Promise.resolve(promise).catch(() => undefined);

  // Nudge the admin live feed — but NOT for page_view, which can fire many
  // times per second under traffic and would flood the channel. Meaningful
  // events (swap_intent, cex_order) ping; page views show up on the next poll.
  if (type !== "page_view") broadcastAdminRefresh("events");
}

export type Severity = "low" | "med" | "high";

/**
 * Record a SECURITY-relevant event: a likely abuse / violation / attack
 * signal (bad confirmation token on a money endpoint, a blocked guard, a
 * rate-limit hit, an auth failure). Surfaced in the admin Logs & Security
 * panel so we can spot probing/attacks without reading server logs.
 */
export function logSecurity(kind: string, meta: Record<string, unknown> = {}, severity: Severity = "med"): void {
  recordEvent("security", { meta: { kind, severity, ...meta } });
}

/**
 * Record an ERROR / failure (a caught exception, a failed upstream call) so
 * bugs are queryable in the admin panel, not buried in Vercel logs. Messages
 * are truncated; never pass secrets in `meta`.
 */
export function logError(where: string, message: string, meta: Record<string, unknown> = {}): void {
  recordEvent("error", { meta: { where, message: String(message).slice(0, 300), ...meta } });
}
