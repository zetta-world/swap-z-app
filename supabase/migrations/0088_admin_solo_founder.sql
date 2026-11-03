-- ═══════════════════════════════════════════════════════════════════════════
-- 0088 — SOLO FOUNDER MODE (Admin CC 2.0): governança de fundador único.
-- ADITIVA sobre a 0083. A 0083 NÃO é editada.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Desenho: docs/ADMIN-SOLO-FOUNDER-MODE.md · plano: docs/PLANO-ADMIN-SOLO-FOUNDER-20261102.md
--
-- PROBLEMA: os CHECKs da 0083 em admin_role_assignments exigem, para o 1º
-- superadmin, TRÊS identidades distintas (alvo ≠ quem concede ≠ quem aprova).
-- Um fundador sem equipe não cumpre isso sem identidades fictícias.
--
-- O QUE ESTA MIGRATION FAZ
--   · admin_governance — linha ÚNICA com o modo (`multi_admin` padrão = regra
--     atual; `solo_founder` só por bootstrap) e a identidade do fundador;
--   · admin_founder_authorizations — sha256 de cada autorização operacional
--     de uso único já consumida (bootstrap/recuperação): PK = não reusa;
--   · admin_role_assignments.grant_kind — `standard` (regras da 0083, iguais)
--     ou `founder_bootstrap` (superadmin SEM concedente/aprovador, preso a uma
--     autorização consumida). Índice único parcial: UM bootstrap para sempre;
--   · 3 RPCs SECURITY DEFINER (search_path fixo, EXECUTE só service_role):
--     founder_bootstrap · founder_mfa_reset · governance_to_multi. São o ÚNICO
--     caminho de escrita da governança e das autorizações: service_role só
--     tem SELECT nessas duas tabelas.
--
-- Nada lê isto enquanto ADMIN_AUTH_MODE for ausente (= legacy, produção hoje).
--
-- ROLLBACK (só enquanto não houver bootstrap; validado no harness 29):
--   supabase/tests/29c_admin_solo_founder_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── governança (linha única) ────────────────────────────────────────────────
create table admin_private.admin_governance (
  id                   boolean primary key default true check (id),
  mode                 text not null default 'multi_admin' check (mode in ('solo_founder','multi_admin')),
  founder_identity_id  uuid references admin_private.admin_identities(id),
  bootstrapped_at      timestamptz,
  multi_since          timestamptz,
  updated_at           timestamptz not null default now(),
  -- `solo_founder` só existe com fundador e bootstrap registrados
  constraint governanca_solo_tem_fundador
    check (mode <> 'solo_founder' or (founder_identity_id is not null and bootstrapped_at is not null))
);
insert into admin_private.admin_governance (id) values (true);

-- ── autorizações operacionais consumidas (uso único) ────────────────────────
create table admin_private.admin_founder_authorizations (
  token_sha256  bytea primary key check (length(token_sha256) = 32),
  purpose       text not null check (purpose in ('bootstrap','recovery')),
  identity_id   uuid not null references admin_private.admin_identities(id),
  consumed_at   timestamptz not null default now(),
  request_id    text not null
);

-- ── atribuições: tipo de concessão ──────────────────────────────────────────
alter table admin_private.admin_role_assignments
  add column grant_kind text not null default 'standard'
    constraint ara_grant_kind_valido check (grant_kind in ('standard','founder_bootstrap')),
  add column founder_authorization bytea references admin_private.admin_founder_authorizations(token_sha256);
alter table admin_private.admin_role_assignments alter column granted_by drop not null;

-- Os 3 CHECKs sem nome da 0083 que citam granted_by/approved_by são achados
-- pela DEFINIÇÃO (o nome automático não é contrato) e trocados por versões
-- NOMEADAS que mantêm a mesma regra para `standard`.
do $$
declare c record; n int := 0;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'admin_private.admin_role_assignments'::regclass and contype = 'c'
      and conname not like 'ara\_%'
      and (pg_get_constraintdef(oid) like '%granted_by%' or pg_get_constraintdef(oid) like '%approved_by%')
  loop
    execute format('alter table admin_private.admin_role_assignments drop constraint %I', c.conname);
    n := n + 1;
  end loop;
  if n <> 3 then raise exception '0088: esperava 3 CHECKs da 0083 com granted_by/approved_by, achei %', n; end if;
end $$;

alter table admin_private.admin_role_assignments
  -- `standard`: EXATAMENTE as regras da 0083 (ninguém concede a si; aprovador ≠ concedente ≠ alvo;
  -- papéis de topo exigem aprovador) + não carrega autorização de fundador.
  add constraint ara_concessao_padrao check (
    grant_kind <> 'standard' or (
      granted_by is not null and granted_by <> identity_id
      and (approved_by is null or (approved_by <> granted_by and approved_by <> identity_id))
      and (role not in ('superadmin','security_admin') or approved_by is not null)
      and founder_authorization is null)),
  -- `founder_bootstrap`: só superadmin, sem concedente/aprovador, preso a uma autorização consumida, sem prazo.
  add constraint ara_concessao_fundador check (
    grant_kind <> 'founder_bootstrap' or (
      role = 'superadmin' and granted_by is null and approved_by is null
      and founder_authorization is not null and expires_at is null));

-- UM bootstrap de fundador, para sempre (mesmo que a linha seja revogada depois).
create unique index ara_fundador_uma_vez on admin_private.admin_role_assignments ((true))
  where grant_kind = 'founder_bootstrap';

-- Atribuição é IMUTÁVEL, salvo a revogação (revoked_at/revoked_by/reason_code — o
-- único UPDATE do app, `repo.revogarPapel`). Sem isto, um UPDATE do service_role
-- poderia "mover" um superadmin para outra identidade ou trocar o tipo da concessão.
create function admin_private.ara_so_revogacao() returns trigger
language plpgsql set search_path = admin_private, pg_temp as $$
begin
  if new.identity_id is distinct from old.identity_id or new.role is distinct from old.role
     or new.granted_by is distinct from old.granted_by or new.approved_by is distinct from old.approved_by
     or new.granted_at is distinct from old.granted_at or new.expires_at is distinct from old.expires_at
     or new.grant_kind is distinct from old.grant_kind
     or new.founder_authorization is distinct from old.founder_authorization
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'admin_role_assignments: só a revogação altera uma atribuição' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function admin_private.ara_so_revogacao() from public, anon, authenticated;
create trigger ara_imutavel_salvo_revogacao before update on admin_private.admin_role_assignments
  for each row execute function admin_private.ara_so_revogacao();

-- ── RPC 1: bootstrap do fundador ─────────────────────────────────────────────
-- O app confere ANTES: env do servidor (e-mail do fundador, sha256 da autorização,
-- janela ≤ 24 h), CSRF, sessão. Aqui o banco RE-CONFERE tudo sob trava e grava
-- tudo ou nada: autorização consumida + atribuição + modo + trilha.
create function admin_private.founder_bootstrap(
  p_identity_id uuid, p_session_id uuid, p_token_sha256 bytea, p_founder_email text, p_request_id text)
returns text
language plpgsql security definer set search_path = admin_private, pg_temp as $$
declare
  g admin_private.admin_governance%rowtype;
  i admin_private.admin_identities%rowtype;
  s admin_private.admin_sessions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('admin_private.founder_bootstrap'));
  select * into g from admin_private.admin_governance where id for update;
  if not found then return 'governanca_ausente'; end if;
  if g.founder_identity_id is not null
     or exists (select 1 from admin_private.admin_role_assignments where grant_kind = 'founder_bootstrap') then
    return 'ja_feito';
  end if;
  if exists (select 1 from admin_private.admin_role_assignments a
             join admin_private.admin_identities x on x.id = a.identity_id
             where a.role = 'superadmin' and a.revoked_at is null
               and (a.expires_at is null or a.expires_at > now()) and x.status = 'active') then
    return 'ja_ha_superadmin';
  end if;
  if p_token_sha256 is null or length(p_token_sha256) <> 32 or coalesce(p_request_id, '') = '' then
    return 'autorizacao_invalida';
  end if;
  if exists (select 1 from admin_private.admin_founder_authorizations where token_sha256 = p_token_sha256) then
    return 'autorizacao_usada';
  end if;
  select * into i from admin_private.admin_identities where id = p_identity_id for update;
  if not found or i.status <> 'active' or i.mfa_enrolled_at is null or i.mfa_factor_id is null
     or i.auth_user_id is null or i.idp_subject is null then
    return 'identidade_nao_verificada';
  end if;
  if p_founder_email is null or i.email_normalized <> lower(btrim(p_founder_email)) then
    return 'nao_e_o_fundador';
  end if;
  if i.locked_until is not null and i.locked_until > now() then return 'identidade_bloqueada'; end if;
  select * into s from admin_private.admin_sessions where id = p_session_id;
  if not found or s.kind <> 'corp' or s.state <> 'active' or s.identity_id is distinct from i.id
     or s.revoked_at is not null or s.absolute_expires_at <= now()
     or s.last_seen_at < now() - make_interval(secs => s.idle_timeout_s)
     or s.aal is distinct from 'aal2' or s.mfa_verified_at is null
     or s.step_up_at is null or s.step_up_at < now() - interval '5 minutes' then
    return 'sessao_sem_mfa_recente';
  end if;

  insert into admin_private.admin_founder_authorizations (token_sha256, purpose, identity_id, request_id)
    values (p_token_sha256, 'bootstrap', i.id, p_request_id);
  insert into admin_private.admin_role_assignments
    (identity_id, role, granted_by, approved_by, grant_kind, founder_authorization, reason_code)
    values (i.id, 'superadmin', null, null, 'founder_bootstrap', p_token_sha256, 'founder_bootstrap');
  update admin_private.admin_governance
    set mode = 'solo_founder', founder_identity_id = i.id, bootstrapped_at = now(), updated_at = now()
    where id;
  insert into admin_private.admin_audit
    (request_id, actor_kind, actor_identity_id, actor_session_id, actor_roles, action,
     target_type, target_ref_redacted, authz_decision, outcome)
    values (p_request_id, 'corp', i.id, s.id, '{superadmin}', 'governance.founder_bootstrap',
            'identity', left(i.id::text, 8), 'allow', 'succeeded');
  return 'ok';
end $$;

-- ── RPC 2: recuperação de MFA do fundador (sem segunda pessoa) ──────────────
-- O app confere ANTES: carteira com sessão SIWE em ADMIN_WALLETS, sha256 da
-- autorização de RECUPERAÇÃO e janela ≤ 24 h, CSRF. Aqui: a identidade do
-- fundador volta a `invited` com novo código de ativação (o MESMO vínculo
-- provider+sub continua valendo), fator e sessões revogados. O papel fica.
create function admin_private.founder_mfa_reset(
  p_token_sha256 bytea, p_founder_email text, p_activation_hash bytea, p_activation_expires timestamptz,
  p_actor_wallet_redacted text, p_request_id text)
returns jsonb
language plpgsql security definer set search_path = admin_private, pg_temp as $$
declare
  g admin_private.admin_governance%rowtype;
  i admin_private.admin_identities%rowtype;
  fator uuid;
  n_sessoes int;
begin
  perform pg_advisory_xact_lock(hashtext('admin_private.founder_bootstrap'));
  select * into g from admin_private.admin_governance where id for update;
  if not found or g.mode <> 'solo_founder' or g.founder_identity_id is null then
    return jsonb_build_object('codigo', 'nao_solo');
  end if;
  if p_token_sha256 is null or length(p_token_sha256) <> 32 or coalesce(p_request_id, '') = '' then
    return jsonb_build_object('codigo', 'autorizacao_invalida');
  end if;
  if exists (select 1 from admin_private.admin_founder_authorizations where token_sha256 = p_token_sha256) then
    return jsonb_build_object('codigo', 'autorizacao_usada');
  end if;
  if p_activation_hash is null or length(p_activation_hash) <> 32 or p_activation_expires is null
     or p_activation_expires <= now() or p_activation_expires > now() + interval '72 hours' then
    return jsonb_build_object('codigo', 'ativacao_invalida');
  end if;
  select * into i from admin_private.admin_identities where id = g.founder_identity_id for update;
  if not found or i.status not in ('active','invited') or i.auth_user_id is null or i.idp_subject is null then
    return jsonb_build_object('codigo', 'fundador_inativo');
  end if;
  if p_founder_email is null or i.email_normalized <> lower(btrim(p_founder_email)) then
    return jsonb_build_object('codigo', 'nao_e_o_fundador');
  end if;
  fator := i.mfa_factor_id;

  insert into admin_private.admin_founder_authorizations (token_sha256, purpose, identity_id, request_id)
    values (p_token_sha256, 'recovery', i.id, p_request_id);
  update admin_private.admin_identities
    set status = 'invited', mfa_factor_id = null, mfa_enrolled_at = null, activated_at = null,
        activation_code_hash = p_activation_hash, activation_expires_at = p_activation_expires,
        failed_mfa_count = 0, locked_until = null
    where id = i.id;
  update admin_private.admin_sessions
    set revoked_at = now(), revoke_reason = 'founder_mfa_reset'
    where identity_id = i.id and revoked_at is null;
  get diagnostics n_sessoes = row_count;
  insert into admin_private.admin_audit
    (request_id, actor_kind, actor_wallet_redacted, action, target_type, target_ref_redacted,
     authz_decision, outcome, after_redacted)
    values (p_request_id, 'legacy', left(coalesce(p_actor_wallet_redacted, ''), 16), 'governance.founder_mfa_reset',
            'identity', left(i.id::text, 8), 'allow', 'succeeded',
            jsonb_build_object('status', 'invited', 'sessoes_revogadas', n_sessoes));
  return jsonb_build_object('codigo', 'ok', 'fator_antigo', fator, 'auth_user_id', i.auth_user_id,
                            'identidade', i.id, 'sessoes_revogadas', n_sessoes);
end $$;

-- ── RPC 3: transição solo_founder → multi_admin (só ida) ─────────────────────
-- Exige o gate do desenho §7: ≥ 2 superadmins ativos com MFA (≥ 1 por
-- concessão `standard` COM aprovador) e ≥ 1 security_admin ativo com MFA.
-- Não concede nada a ninguém.
create function admin_private.governance_to_multi(p_session_id uuid, p_request_id text)
returns text
language plpgsql security definer set search_path = admin_private, pg_temp as $$
declare
  g admin_private.admin_governance%rowtype;
  s admin_private.admin_sessions%rowtype;
  n_super int; n_aprovado int; n_seg int;
begin
  perform pg_advisory_xact_lock(hashtext('admin_private.founder_bootstrap'));
  select * into g from admin_private.admin_governance where id for update;
  if not found or g.mode <> 'solo_founder' then return 'nao_solo'; end if;
  if coalesce(p_request_id, '') = '' then return 'pedido_invalido'; end if;
  select * into s from admin_private.admin_sessions where id = p_session_id;
  if not found or s.kind <> 'corp' or s.state <> 'active' or s.identity_id is distinct from g.founder_identity_id
     or s.revoked_at is not null or s.absolute_expires_at <= now()
     or s.last_seen_at < now() - make_interval(secs => s.idle_timeout_s)
     or s.aal is distinct from 'aal2' or s.step_up_at is null or s.step_up_at < now() - interval '5 minutes' then
    return 'sessao_sem_mfa_recente';
  end if;
  select count(distinct a.identity_id) into n_super
    from admin_private.admin_role_assignments a join admin_private.admin_identities x on x.id = a.identity_id
    where a.role = 'superadmin' and a.revoked_at is null and (a.expires_at is null or a.expires_at > now())
      and x.status = 'active' and x.mfa_enrolled_at is not null;
  select count(*) into n_aprovado
    from admin_private.admin_role_assignments a join admin_private.admin_identities x on x.id = a.identity_id
    where a.role = 'superadmin' and a.grant_kind = 'standard' and a.approved_by is not null
      and a.revoked_at is null and (a.expires_at is null or a.expires_at > now())
      and x.status = 'active' and x.mfa_enrolled_at is not null and x.id <> g.founder_identity_id;
  select count(distinct a.identity_id) into n_seg
    from admin_private.admin_role_assignments a join admin_private.admin_identities x on x.id = a.identity_id
    where a.role = 'security_admin' and a.revoked_at is null and (a.expires_at is null or a.expires_at > now())
      and x.status = 'active' and x.mfa_enrolled_at is not null;
  if n_super < 2 or n_aprovado < 1 or n_seg < 1 then return 'gate_multi_incompleto'; end if;
  update admin_private.admin_governance set mode = 'multi_admin', multi_since = now(), updated_at = now() where id;
  insert into admin_private.admin_audit
    (request_id, actor_kind, actor_identity_id, actor_session_id, actor_roles, action, authz_decision, outcome, after_redacted)
    values (p_request_id, 'corp', s.identity_id, s.id, '{superadmin}', 'governance.to_multi_admin', 'allow', 'succeeded',
            jsonb_build_object('superadmins', n_super, 'security_admins', n_seg));
  return 'ok';
end $$;

-- ── RLS e ACL (padrão do repo: RLS ligada, zero policies; menor privilégio) ──
alter table admin_private.admin_governance             enable row level security;
alter table admin_private.admin_founder_authorizations enable row level security;

revoke all on admin_private.admin_governance, admin_private.admin_founder_authorizations
  from public, anon, authenticated, service_role;
-- service_role só LÊ: escrita de governança e de autorizações é exclusiva das RPCs
grant select on admin_private.admin_governance, admin_private.admin_founder_authorizations to service_role;

revoke execute on function admin_private.founder_bootstrap(uuid, uuid, bytea, text, text) from public, anon, authenticated;
revoke execute on function admin_private.founder_mfa_reset(bytea, text, bytea, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function admin_private.governance_to_multi(uuid, text) from public, anon, authenticated;
grant execute on function admin_private.founder_bootstrap(uuid, uuid, bytea, text, text) to service_role;
grant execute on function admin_private.founder_mfa_reset(bytea, text, bytea, timestamptz, text, text) to service_role;
grant execute on function admin_private.governance_to_multi(uuid, text) to service_role;
