-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — Dedicated ADMIN access grants — ADDITIVE ONLY
-- ─────────────────────────────────────────────────────────────────────────
-- Until now admin-panel access was COUPLED to tiers: requireAdmin let in any
-- wallet with a tier_cache row of source='admin', so granting a tier from the
-- panel also handed out admin. This table separates the two: an explicit,
-- auditable list of admin wallets the CEO can grant/revoke at will, independent
-- of any tier. requireAdmin now checks (env ADMIN_WALLETS) OR (this table) OR
-- (legacy tier_cache.source='admin', kept for back-compat so nobody is locked
-- out). RLS default-deny (enabled, zero policies) — service-role only.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists platform_admins (
  wallet_address text primary key,
  granted_by     text,                     -- admin wallet that granted it
  note           text,                     -- optional label ("co-founder", "ops")
  granted_at     timestamptz not null default now()
);

alter table platform_admins enable row level security;
