-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Market Brain (Z3): persistent per-symbol memory
-- ─────────────────────────────────────────────────────────────────────────
-- ZION was stateless — every analysis re-derived everything from a snapshot.
-- This gives it memory: how long the current regime has held, and whether
-- volatility is elevated vs the symbol's own EWMA baseline. Shared across
-- users (market state is objective); updated best-effort on each analysis.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists market_brain (
  symbol        text primary key,
  regime        text,
  regime_since  timestamptz,
  prev_regime   text,
  atr_pct       numeric,
  vol_avg       numeric,        -- EWMA of atr_pct (volatility baseline)
  range_pct     numeric,        -- position in 1y range, 0..100
  updated_at    timestamptz default now()
);

alter table market_brain enable row level security;
-- No policies: only the service-role server client writes/reads it.
