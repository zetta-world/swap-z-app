/**
 * Server-side realtime broadcast — emits a lightweight "refresh" ping on the
 * `admin:refresh` channel whenever privileged data changes. The admin panel
 * client listens and re-fetches through the service-role API routes.
 *
 * This is an INVALIDATION BUS, not a data channel: no table rows ever travel
 * over realtime (the tables have RLS with no policies, so the browser's anon
 * key can't read them anyway). We only send "something in <scope> changed".
 *
 * Uses Supabase's HTTP broadcast endpoint with the service-role key, so no
 * persistent server connection is needed — fire-and-forget, never throws.
 */

export const ADMIN_REFRESH_TOPIC = "admin:refresh";

export type RefreshScope = "stats" | "tier" | "killswitch" | "events" | "audit";

export function broadcastAdminRefresh(scope: RefreshScope): void {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  // Fire-and-forget: do not await, do not let a failure bubble.
  fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          topic: ADMIN_REFRESH_TOPIC,
          event: "refresh",
          payload: { scope, at: Date.now() },
        },
      ],
    }),
  }).catch(() => undefined);
}
