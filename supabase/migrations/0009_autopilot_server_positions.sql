-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Server-side autopilot positions + exit engine (A5)
-- ─────────────────────────────────────────────────────────────────────────
-- The background cron previously only BOUGHT — positions lived in the
-- browser's localStorage, invisible to the server — so background bags were
-- never sold and the cron's loss-stop could never compute realized P&L.
--
-- This table is the server-side equivalent of store/autopilotPositions.ts:
-- the cron records what it opened, injects open positions into the ZION scan
-- (so the model proposes exits), arms/settles those exits, and feeds realized
-- P&L back into the session's daily loss-stop.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists autopilot_positions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references autopilot_sessions(id) on delete cascade,
  wallet_address text not null,
  exchange_id    text not null,
  base           text not null,
  pair           text not null,
  entry_price    numeric not null,
  base_amount    numeric not null,
  cost_usd       numeric not null,
  reasoning      text,
  entry_label    text,
  status         text not null default 'open' check (status in ('open','exit_armed','closed')),
  exit_order_id  text,
  exit_armed_at  timestamptz,
  entry_ts       timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (session_id, base)
);
create index if not exists idx_autopilot_positions_open
  on autopilot_positions (session_id, status)
  where status <> 'closed';

alter table autopilot_positions enable row level security;
-- No policies: only the service-role server client (bypasses RLS) may touch it.

-- Atomic realized-P&L application: add delta to pnl_today and trip the freeze
-- in one statement so concurrent settles can't race. Loss stop read from row.
create or replace function apply_session_pnl(p_id uuid, p_delta numeric, p_today text)
returns void
language sql
as $$
  update autopilot_sessions
    set pnl_today        = pnl_today + p_delta,
        frozen_until_day = case
          when (pnl_today + p_delta) <= -daily_loss_stop_usd then p_today
          else frozen_until_day end,
        updated_at       = now()
  where id = p_id;
$$;
