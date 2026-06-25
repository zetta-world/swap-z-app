-- Admin audit log — append-only record of every privileged action.
-- Rows are inserted by the server using the service-role key; RLS prevents
-- any direct mutation (insert/update/delete) from the anon/authenticated roles.

create table if not exists admin_audit_log (
  id           uuid        primary key default gen_random_uuid(),
  actor_wallet text        not null,
  action       text        not null,
  target       text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

-- Index for per-actor history lookup
create index if not exists admin_audit_log_actor_idx on admin_audit_log (actor_wallet, created_at desc);
-- Index for action-type filtering
create index if not exists admin_audit_log_action_idx on admin_audit_log (action, created_at desc);

alter table admin_audit_log enable row level security;

-- No public policies: all access goes through the service-role key only.
