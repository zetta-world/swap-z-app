-- ═══════════════════════════════════════════════════════════════════════════
-- 0083 — R1/R2 (Admin CC 2.0): schema admin_private — identidade corporativa,
-- papéis, sessões admin e trilha append-only. ADITIVA; NADA LÊ ISTO AINDA.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Desenho: docs/ADMIN-SSO-MFA-RBAC-DESIGN.md §4.8. Enquanto ADMIN_AUTH_MODE
-- estiver ausente (= legacy), nenhum código lê ou escreve estas tabelas: quem
-- é admin continua sendo `requireAdmin()` (3 fontes legadas). Esta migration
-- só prepara o chão para R1 (login corporativo + MFA), que depende de IdP e
-- contas reais — bloqueado até autorização do dono.
--
-- ACESSO SÓ PELO SERVIDOR: schema sem USAGE para PUBLIC/anon/authenticated;
-- service_role com o mínimo. RLS ligada e ZERO policies (padrão do repo).
-- `admin_audit` é APPEND-ONLY: só INSERT/SELECT para service_role e gatilhos
-- que levantam erro em UPDATE/DELETE/TRUNCATE — nem o app apaga a trilha.
--
-- Invariantes no banco (CHECK), não só no código:
--   · ninguém concede papel a si; aprovação nunca é de quem concedeu nem do alvo;
--   · `role` ∈ os 8 papéis de src/lib/admin/rbac.ts (teste confere a igualdade);
--   · sessão é corp (com identidade) OU break-glass (com carteira), nunca as duas.
--
-- ROLLBACK: `drop schema admin_private cascade;` (vazio até R1 entrar).
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists admin_private;
revoke all on schema admin_private from public, anon, authenticated;
grant usage on schema admin_private to service_role;

-- funções criadas aqui NÃO nascem executáveis por PUBLIC (redundante à 0082, de propósito)
alter default privileges for role postgres in schema admin_private revoke execute on functions from public;
alter default privileges for role postgres in schema admin_private revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema admin_private revoke all on sequences from anon, authenticated;

create table admin_private.admin_identities (
  id                     uuid primary key default gen_random_uuid(),
  status                 text not null default 'invited' check (status in ('invited','active','suspended','revoked')),
  email_normalized       text not null check (email_normalized = lower(btrim(email_normalized)) and position('@' in email_normalized) > 1),
  display_label          text check (display_label is null or length(display_label) <= 80),
  provider               text not null check (provider in ('google','azure')),
  expected_issuer        text not null,
  expected_tenant        text not null,
  auth_user_id           uuid unique,
  idp_subject            text,
  mfa_factor_id          uuid,
  mfa_enrolled_at        timestamptz,
  activation_code_hash   bytea,
  activation_expires_at  timestamptz,
  failed_mfa_count       integer not null default 0 check (failed_mfa_count >= 0),
  locked_until           timestamptz,
  legacy_wallet          text,   -- SÓ correlação de observação (R5); nunca concede nada
  invited_by             uuid references admin_private.admin_identities(id),
  invited_at             timestamptz not null default now(),
  activated_at           timestamptz,
  suspended_at           timestamptz,
  revoked_at             timestamptz,
  revoked_by             uuid references admin_private.admin_identities(id),
  reason_code            text,
  check (invited_by is null or invited_by <> id),
  check ((status = 'revoked') = (revoked_at is not null))
);
create unique index admin_identities_email_vivo on admin_private.admin_identities (email_normalized) where status <> 'revoked';
create unique index admin_identities_sujeito on admin_private.admin_identities (provider, idp_subject) where idp_subject is not null;

create table admin_private.admin_role_assignments (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references admin_private.admin_identities(id),
  role         text not null check (role in ('superadmin','security_admin','operations','finance','support','analyst','auditor','growth')),
  granted_by   uuid not null references admin_private.admin_identities(id),
  granted_at   timestamptz not null default now(),
  approved_by  uuid references admin_private.admin_identities(id),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references admin_private.admin_identities(id),
  reason_code  text,
  check (granted_by <> identity_id),
  check (approved_by is null or (approved_by <> granted_by and approved_by <> identity_id)),
  -- papéis de topo exigem segunda pessoa
  check (role not in ('superadmin','security_admin') or approved_by is not null)
);
create unique index admin_role_vivo on admin_private.admin_role_assignments (identity_id, role) where revoked_at is null;

create table admin_private.admin_sessions (
  id                   uuid primary key default gen_random_uuid(),
  token_hash           bytea not null unique check (length(token_hash) = 32),
  kind                 text not null check (kind in ('corp','breakglass')),
  state                text not null check (state in ('mfa_pending','active')),
  identity_id          uuid references admin_private.admin_identities(id),
  breakglass_wallet    text,
  audience             text not null default 'zswap-admin' check (audience = 'zswap-admin'),
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  absolute_expires_at  timestamptz not null,
  idle_timeout_s       integer not null check (idle_timeout_s between 60 and 86400),
  aal                  text check (aal in ('aal1','aal2')),
  mfa_verified_at      timestamptz,
  step_up_at           timestamptz,
  sb_user_id           uuid,
  sb_session_id        uuid,
  sb_refresh_token_enc bytea,
  ua_hash              bytea,
  ip_prefix            text,
  rotated_from         uuid references admin_private.admin_sessions(id),
  revoked_at           timestamptz,
  revoked_by           uuid references admin_private.admin_identities(id),
  revoke_reason        text,
  check ((kind = 'corp' and identity_id is not null and breakglass_wallet is null)
      or (kind = 'breakglass' and identity_id is null and breakglass_wallet is not null)),
  check (state <> 'active' or kind = 'breakglass' or (aal = 'aal2' and mfa_verified_at is not null)),
  check (absolute_expires_at > created_at)
);

create table admin_private.admin_audit (
  id                    uuid primary key default gen_random_uuid(),
  occurred_at           timestamptz not null default now(),
  request_id            text not null,
  idempotency_key       text,
  actor_kind            text not null check (actor_kind in ('corp','legacy','breakglass','system')),
  actor_identity_id     uuid,
  actor_session_id      uuid,
  actor_wallet_redacted text,
  actor_roles           text[] not null default '{}',
  action                text not null,
  target_type           text,
  target_ref_redacted   text,
  authz_decision        text not null check (authz_decision in ('allow','deny')),
  outcome               text not null check (outcome in ('intent','succeeded','failed','denied')),
  failure_code          text,
  before_redacted       jsonb,
  after_redacted        jsonb,
  origin                text,
  evidence_ref          text
);
create unique index admin_audit_idem on admin_private.admin_audit (action, idempotency_key, outcome) where idempotency_key is not null;
create index admin_audit_quando on admin_private.admin_audit (occurred_at desc);

-- append-only: a trilha não se edita nem se apaga, nem pelo app
create function admin_private.admin_audit_imutavel() returns trigger
language plpgsql set search_path = admin_private, pg_temp as $$
begin
  raise exception 'admin_audit é append-only (%)', tg_op using errcode = '42501';
end $$;
revoke execute on function admin_private.admin_audit_imutavel() from public;
create trigger admin_audit_sem_update_delete before update or delete on admin_private.admin_audit
  for each row execute function admin_private.admin_audit_imutavel();
create trigger admin_audit_sem_truncate before truncate on admin_private.admin_audit
  for each statement execute function admin_private.admin_audit_imutavel();

-- RLS ligada, zero policies
alter table admin_private.admin_identities       enable row level security;
alter table admin_private.admin_role_assignments enable row level security;
alter table admin_private.admin_sessions         enable row level security;
alter table admin_private.admin_audit            enable row level security;

-- ACL: nada para PUBLIC/anon/authenticated; service_role com o mínimo
revoke all on all tables in schema admin_private from public, anon, authenticated, service_role;
grant select, insert, update on admin_private.admin_identities, admin_private.admin_role_assignments,
                                admin_private.admin_sessions to service_role;
grant delete on admin_private.admin_sessions to service_role;          -- limpeza de sessão expirada
grant select, insert on admin_private.admin_audit to service_role;     -- append-only
