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
