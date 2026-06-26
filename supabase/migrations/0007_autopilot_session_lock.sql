-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Autopilot session lock (A2: double-execution guard)
-- ─────────────────────────────────────────────────────────────────────────
-- The background cron (.github/workflows/autopilot-cron.yml) runs with
-- cancel-in-progress:false so an in-flight order is never interrupted. That
-- leaves a window where a long run and the next scheduled run overlap and
-- could both process the same session — double-firing orders.
--
-- This per-session advisory lock closes it: the cron atomically acquires
-- `locked_until = now()+TTL` (only if currently null or already expired)
-- before working a session, and releases it when done. A future TTL
-- auto-releases a crashed run so a session can never wedge permanently.
-- ─────────────────────────────────────────────────────────────────────────

alter table autopilot_sessions
  add column if not exists locked_until timestamptz;
