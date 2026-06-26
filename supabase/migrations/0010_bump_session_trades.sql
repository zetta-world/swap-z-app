-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Browser→server trade write-back (A1)
-- ─────────────────────────────────────────────────────────────────────────
-- The browser pilot folds the server's trades_today into its caps (read
-- direction), but the cron couldn't see the browser's own fires. This RPC
-- lets the browser publish each fire to its session, making the server's
-- trades_today the single source of truth for the COMBINED daily budget.
-- Atomic increment so concurrent bumps can't lose a count.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function bump_session_trades(p_wallet text, p_exchange text, p_n int)
returns void
language sql
as $$
  update autopilot_sessions
    set trades_today = trades_today + p_n,
        updated_at   = now()
  where wallet_address = p_wallet and exchange_id = p_exchange;
$$;
