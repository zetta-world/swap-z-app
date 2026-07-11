-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Paper trading (Gate.io simulation) — ADDITIVE ONLY
-- ─────────────────────────────────────────────────────────────────────────
-- An autonomous PAPER agent that executes the flywheel's signals
-- (zion_suggestions) as simulated trades, filled against Gate.io's LIVE public
-- price. No real orders, no exchange keys, no money path touched. One virtual
-- account PER signal source (self_scan / mistral_scan / … / radar) gives a real
-- portfolio equity curve per AI agent: not just "was the signal right?" but
-- "would this agent have MADE money trading it on Gate.io?".
--
-- Fully isolated from the live autopilot (autopilot_* tables are untouched) and
-- read-only on zion_suggestions. RLS default-deny (enabled, zero policies) like
-- every other table — service-role access only.
-- ─────────────────────────────────────────────────────────────────────────

-- One virtual wallet per agent (source). Cash is the uninvested balance;
-- deployed capital lives in the open paper_positions until they close.
create table if not exists paper_accounts (
  id            uuid primary key default gen_random_uuid(),
  source        text not null unique,              -- self_scan | mistral_scan | grok_scan | deepseek_scan | kimi_scan | radar
  label         text not null,
  exchange      text not null default 'gateio',
  starting_usd  numeric not null default 1000,
  cash_usd      numeric not null default 1000,     -- uninvested; starts == starting_usd
  realized_pnl_usd numeric not null default 0,     -- running realized P&L (denormalized for cheap reads)
  wins          int not null default 0,
  losses        int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One simulated position per (account, suggestion). Opened at the live Gate.io
-- fill; carries the suggestion's absolute target/stop levels. Closed when a
-- level is touched (or the horizon elapses), realizing P&L back to cash.
create table if not exists paper_positions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references paper_accounts(id),
  suggestion_id uuid not null,                     -- soft ref to zion_suggestions.id (read-only source)
  source        text not null,
  symbol        text not null,
  side          text not null check (side in ('buy','sell')),
  qty           numeric not null,                  -- base units bought/shorted
  entry_price   numeric not null,                  -- LIVE Gate.io fill price at open
  cost_usd      numeric not null,                  -- capital deployed (qty * entry_price)
  target_price  numeric,
  stop_price    numeric,
  horizon_hours int not null default 72,
  status        text not null default 'open',      -- open | closed
  exit_price    numeric,
  exit_reason   text,                              -- target | stop | expired
  pnl_usd       numeric,
  pnl_pct       numeric,                           -- net of round-trip cost
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  -- an account takes each signal at most once (idempotent opens across ticks)
  unique (account_id, suggestion_id)
);
create index if not exists idx_paper_positions_open
  on paper_positions (account_id, status) where status = 'open';
create index if not exists idx_paper_positions_suggestion on paper_positions (suggestion_id);

alter table paper_accounts  enable row level security;
alter table paper_positions enable row level security;
