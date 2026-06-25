-- First-party analytics: page views, swap intents, CEX orders, errors.
-- Append-only; rows are inserted server-side via service-role only.
-- Wallet address is nullable (anonymous events are tracked without it).

create table if not exists platform_events (
  id             uuid        primary key default gen_random_uuid(),
  event_type     text        not null,
  wallet_address text,
  path           text,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists platform_events_type_idx on platform_events (event_type, created_at desc);
create index if not exists platform_events_path_idx on platform_events (path, created_at desc);
create index if not exists platform_events_wallet_idx on platform_events (wallet_address, created_at desc)
  where wallet_address is not null;
create index if not exists platform_events_created_idx on platform_events (created_at desc);

alter table platform_events enable row level security;
-- No public policies: service-role only.

-- Kill-switch key/value store for feature flags.
-- The admin panel reads/writes flags here; the main app checks them at runtime.

create table if not exists admin_kv (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

alter table admin_kv enable row level security;
-- No public policies: service-role only.

-- Seed default OFF state for all kill-switches.
insert into admin_kv (key, value) values
  ('disable_swap',     'false'),
  ('disable_cex',      'false'),
  ('maintenance_mode', 'false')
on conflict (key) do nothing;
