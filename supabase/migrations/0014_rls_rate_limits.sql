-- R2.3 — close the last RLS gap + document the intentional posture.
--
-- POSTURE (intentional, verified in the audit): every table has RLS ENABLED
-- with ZERO policies = default-deny for anon/authenticated. All legitimate
-- access goes through server routes using the service-role key (which
-- bypasses RLS). Do NOT add permissive policies "to fix" a client read —
-- that read should be a server route.
--
-- rate_limits was the one table created without the enable line (0008). It is
-- only touched via consume_rate_limit(), called server-side with the service
-- role, so enabling RLS changes nothing for the app and closes the gap.

alter table rate_limits enable row level security;
