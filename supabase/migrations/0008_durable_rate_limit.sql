-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Durable rate limiting (A3)
-- ─────────────────────────────────────────────────────────────────────────
-- The in-memory Map limiter (src/lib/rate-limit.ts) is per-serverless-instance
-- and resets on every cold start, so it barely limits anything across a
-- horizontally-scaled deployment. This moves the high-stakes endpoints
-- (cex/order, cex/withdraw, zion) onto a shared Postgres counter.
--
-- consume_rate_limit() is atomic: the upsert + conditional window reset run
-- in a single statement under the row lock, so concurrent requests for the
-- same bucket can't race past the cap.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists rate_limits (
  bucket    text primary key,
  count     int not null,
  reset_at  timestamptz not null
);

create or replace function consume_rate_limit(p_bucket text, p_max int, p_window_secs int)
returns boolean
language plpgsql
as $$
declare
  v_count int;
begin
  insert into rate_limits (bucket, count, reset_at)
    values (p_bucket, 1, now() + make_interval(secs => p_window_secs))
  on conflict (bucket) do update
    set count    = case when rate_limits.reset_at < now() then 1
                        else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => p_window_secs)
                        else rate_limits.reset_at end
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

create index if not exists idx_rate_limits_reset on rate_limits (reset_at);
