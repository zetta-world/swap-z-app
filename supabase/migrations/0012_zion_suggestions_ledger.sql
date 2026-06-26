-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Shadow Flywheel ledger (Z5/Z6)
-- ─────────────────────────────────────────────────────────────────────────
-- Every ZION suggestion is logged with the market price at emission. A
-- resolver later checks whether it played out — target/stop hit, or a
-- directional outcome over a fixed horizon. This is the ground-truth data
-- that lets us measure win-rate / expectancy and (later, Z7) calibrate the
-- model's stated probability against reality. Without it, "ZION works" is
-- opinion; with it, it's a number.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists zion_suggestions (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,
  kind           text not null,
  side           text not null check (side in ('buy','sell')),
  ref_price      numeric not null,
  entry_price    numeric,
  target_price   numeric,
  stop_price     numeric,
  probability    numeric,
  regime         text,
  source         text not null default 'self_scan',
  horizon_hours  int not null default 72,
  status         text not null default 'open',  -- open|win|loss|neutral|hit_target|hit_stop|expired
  outcome_pct    numeric,
  resolved_price numeric,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists idx_zion_suggestions_open
  on zion_suggestions (status, created_at) where status = 'open';
create index if not exists idx_zion_suggestions_symbol on zion_suggestions (symbol);

alter table zion_suggestions enable row level security;
