-- 0017: archive round 1 of the agent tests (see docs/PLANO-ARQUIVO-RODADAS.md).
-- Epoch mechanism: archived_at IS NULL = live round. History is never deleted
-- (the honest flywheel keeps round 1 auditable) — it just leaves every
-- dashboard/digest/stat, which filter on archived_at IS NULL.

alter table zion_suggestions add column if not exists archived_at timestamptz;
alter table paper_positions  add column if not exists archived_at timestamptz;

-- Partial indexes: every stats reader scans only the live round.
create index if not exists idx_zion_suggestions_live on zion_suggestions (created_at) where archived_at is null;
create index if not exists idx_paper_positions_live  on paper_positions (status) where archived_at is null;

-- Round-1 boundary for suggestions: all agents were re-enabled 2026-07-17
-- 08:32 UTC after 3 days paused; everything before that is the old prompt
-- cohort + pre-hardening arbiter era.
update zion_suggestions
   set archived_at = now()
 where created_at < '2026-07-17T08:32:00Z' and archived_at is null;

-- Stale OPEN paper positions from round 1: close flat (pnl 0) so the resolver
-- never credits them into the reset wallets, then archive.
update paper_positions
   set status = 'closed', exit_price = entry_price, exit_reason = 'archived',
       pnl_usd = 0, pnl_pct = 0, closed_at = now(), archived_at = now()
 where status = 'open';

-- Everything opened up to this migration is round 1 (atomic with the wallet
-- reset below — the whole migration is one transaction).
update paper_positions set archived_at = now() where archived_at is null;

-- Fresh wallets for round 2.
update paper_accounts
   set cash_usd = starting_usd, realized_pnl_usd = 0, wins = 0, losses = 0,
       updated_at = now();
