-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Operations ledger (client-action capture for ZION learning)
-- ─────────────────────────────────────────────────────────────────────────
-- Every completed client operation (swap, CEX trade, autopilot fill, bridge)
-- with the wallet, type, pair, volume and realized P&L. Captures the maximum
-- signal from client actions — the dataset that feeds ZION's learning and the
-- admin operations view. `ref` is the client tx-history id, unique so re-syncs
-- from the browser are idempotent.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists operations (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text,
  kind           text not null,          -- swap | cex | autopilot_cex | bridge | ...
  chain          text,                   -- chain or exchange id
  pair           text,                   -- "ETH/USDC"
  side           text,                   -- buy | sell | null
  volume_usd     numeric,
  pnl_usd        numeric,                -- realized P&L when known
  status         text not null,
  route          text,
  ref            text unique,            -- client tx-history id (idempotent upsert)
  created_at     timestamptz not null default now()
);
create index if not exists idx_operations_wallet on operations (wallet_address);
create index if not exists idx_operations_created on operations (created_at desc);

alter table operations enable row level security;
-- No policies: only the service-role server client writes; admin reads server-side.
