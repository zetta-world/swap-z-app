-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Background Autopilot (server-side cron execution)
-- ─────────────────────────────────────────────────────────────────────────
-- Run once in Supabase Studio → SQL Editor (or `supabase db push`).
--
-- Lets a user "arm" the CEX autopilot and keep it running after they close
-- the browser. A GitHub Actions cron hits /api/autopilot/cron every few
-- minutes; that endpoint reads active sessions here, runs a ZION scan, and
-- fires the resulting orders against the user's CEX.
--
-- SECURITY MODEL:
--   • CEX API credentials are stored ENCRYPTED (AES-256-GCM) in creds_cipher.
--     The encryption key (AUTOPILOT_ENC_KEY) lives only in Vercel env vars,
--     never in the database. A DB dump alone cannot reveal any API key.
--   • RLS is enabled with NO policies — only the server-side service-role
--     client (which bypasses RLS) can touch these tables. Even a leaked anon
--     key sees nothing.
--   • Sessions auto-expire (expires_at). The cron refuses to act on an
--     expired row even if is_active is still true — a dead-man's switch so a
--     forgotten session can't run forever.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── autopilot_sessions ───────────────────────────────────────────────────
-- One armed background session per (wallet, exchange). Re-arming overwrites
-- the row (ON CONFLICT in the upsert path).
create table if not exists autopilot_sessions (
  id                    uuid primary key default gen_random_uuid(),
  wallet_address        text not null,
  exchange_id           text not null,

  -- ── strategy config ──
  risk_mode             text not null check (risk_mode in ('conservador','moderado','agressivo')),
  market_type           text not null default 'spot' check (market_type in ('spot','futures','margin')),
  max_trade_usd         numeric not null check (max_trade_usd >= 0),
  daily_loss_stop_usd   numeric not null check (daily_loss_stop_usd >= 0),
  max_trades_per_day    int not null check (max_trades_per_day between 1 and 50),
  allowed_symbols       text[] not null default '{}',
  lang                  text not null default 'pt',

  -- ── encrypted CEX credentials (AES-256-GCM, format: iv.tag.ciphertext b64) ──
  creds_cipher          text not null,

  -- ── lifecycle ──
  is_active             boolean not null default true,
  expires_at            timestamptz not null,

  -- ── daily counters (reset at UTC midnight by the cron) ──
  trades_today          int not null default 0,
  pnl_today             numeric not null default 0,
  last_reset_day        text not null,
  frozen_until_day      text,

  -- ── bookkeeping ──
  last_scan_at          timestamptz,
  last_error            text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),

  unique (wallet_address, exchange_id)
);
create index if not exists idx_autopilot_active
  on autopilot_sessions (is_active, expires_at)
  where is_active = true;

-- ── autopilot_runs ───────────────────────────────────────────────────────
-- Append-only audit log of every order the BACKGROUND cron fired (or tried
-- to). The in-browser pilot logs to localStorage; this is the server-side
-- equivalent so the user can reconcile what ran while they were away.
create table if not exists autopilot_runs (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references autopilot_sessions(id) on delete cascade,
  wallet_address  text not null,
  exchange_id     text not null,
  ran_at          timestamptz default now(),

  symbol          text,
  side            text,
  order_type      text,
  amount          numeric,
  price           numeric,
  notional_usd    numeric,

  -- 'fired' | 'rejected' | 'errored' | 'skipped' | 'scan_empty' | 'scan_error'
  status          text not null,
  order_id        text,
  card_kind       text,
  reason          text
);
create index if not exists idx_runs_wallet on autopilot_runs (wallet_address, ran_at desc);
create index if not exists idx_runs_session on autopilot_runs (session_id, ran_at desc);

-- ── Row-Level Security: sealed (service-role only) ───────────────────────
alter table autopilot_sessions enable row level security;
alter table autopilot_runs     enable row level security;
