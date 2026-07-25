-- 0018: Auto-Retro lesson ledger (docs/PLANO-ANALISTA-PROFUNDO.md).
-- Full history kept (auditable); the ACTIVE lessons for an agent are the
-- newest row per source. RLS default-deny like every internal table.
create table if not exists agent_lessons (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  lessons       jsonb not null,
  decided_count int  not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_agent_lessons_source_created on agent_lessons (source, created_at desc);
alter table agent_lessons enable row level security;
