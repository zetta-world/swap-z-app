import { getSupabaseAdmin } from "@/lib/supabase/server";

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
}
