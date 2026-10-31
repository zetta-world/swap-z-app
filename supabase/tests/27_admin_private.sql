\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 27 — 0083: admin_private fechado, invariantes no banco e trilha append-only.
-- Rodar com os default privileges do Supabase reproduzidos (README).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- T27.1 schema e tabelas fora do alcance de anon/authenticated/PUBLIC
do $$
declare t text; r text;
begin
  foreach r in array array['anon','authenticated','public'] loop
    if has_schema_privilege(r, 'admin_private', 'USAGE') then raise exception 'T27.1: % tem USAGE em admin_private', r; end if;
    foreach t in array array['admin_identities','admin_role_assignments','admin_sessions','admin_audit'] loop
      if has_table_privilege(r, 'admin_private.'||t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'T27.1: % tem privilégio em %', r, t;
      end if;
      if not (select relrowsecurity from pg_class where oid = ('admin_private.'||t)::regclass) then
        raise exception 'T27.1: RLS desligada em %', t;
      end if;
    end loop;
  end loop;
  if has_table_privilege('service_role', 'admin_private.admin_audit', 'UPDATE')
     or has_table_privilege('service_role', 'admin_private.admin_audit', 'DELETE')
     or has_table_privilege('service_role', 'admin_private.admin_audit', 'TRUNCATE') then
    raise exception 'T27.1: service_role pode reescrever a trilha';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'admin_private') then raise exception 'T27.1: há policy'; end if;
  raise notice 'T27.1 ok — admin_private fechado; trilha só INSERT/SELECT para service_role';
end $$;

-- T27.2 invariantes de papel
insert into admin_private.admin_identities (id, email_normalized, provider, expected_issuer, expected_tenant)
values ('00000000-0000-0000-0000-00000000000a', 'dono@exemplo.test', 'google', 'https://accounts.google.com', 'exemplo.test'),
       ('00000000-0000-0000-0000-00000000000b', 'ops@exemplo.test',  'google', 'https://accounts.google.com', 'exemplo.test');
do $$
begin
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-00000000000a', 'operations', '00000000-0000-0000-0000-00000000000a');
    raise exception 'T27.2 FALHOU: concedeu papel a si';
  exception when check_violation then null; end;
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-00000000000b', 'superadmin', '00000000-0000-0000-0000-00000000000a');
    raise exception 'T27.2 FALHOU: superadmin sem segunda pessoa';
  exception when check_violation then null; end;
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-00000000000b', 'dono_de_tudo', '00000000-0000-0000-0000-00000000000a');
    raise exception 'T27.2 FALHOU: papel fora do catálogo';
  exception when check_violation then null; end;
  insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
  values ('00000000-0000-0000-0000-00000000000b', 'operations', '00000000-0000-0000-0000-00000000000a');
  raise notice 'T27.2 ok — autoconcessão, topo sem aprovação e papel inventado recusados';
end $$;

-- T27.3 sessão corp ativa exige MFA (aal2) e é corp XOR break-glass
do $$
begin
  begin
    insert into admin_private.admin_sessions (token_hash, kind, state, identity_id, absolute_expires_at, idle_timeout_s)
    values (decode(repeat('ab', 32), 'hex'), 'corp', 'active', '00000000-0000-0000-0000-00000000000b', now() + interval '8 hours', 1800);
    raise exception 'T27.3 FALHOU: sessão ativa sem MFA';
  exception when check_violation then null; end;
  begin
    insert into admin_private.admin_sessions (token_hash, kind, state, identity_id, breakglass_wallet, absolute_expires_at, idle_timeout_s)
    values (decode(repeat('cd', 32), 'hex'), 'corp', 'mfa_pending', '00000000-0000-0000-0000-00000000000b', '0xabc', now() + interval '1 hour', 600);
    raise exception 'T27.3 FALHOU: sessão corp com carteira';
  exception when check_violation then null; end;
  insert into admin_private.admin_sessions (token_hash, kind, state, identity_id, aal, mfa_verified_at, absolute_expires_at, idle_timeout_s)
  values (decode(repeat('ef', 32), 'hex'), 'corp', 'active', '00000000-0000-0000-0000-00000000000b', 'aal2', now(), now() + interval '8 hours', 1800);
  raise notice 'T27.3 ok — ativa só com aal2; corp ≠ break-glass';
end $$;

-- T27.4 trilha append-only, inclusive para o dono do banco
insert into admin_private.admin_audit (request_id, actor_kind, action, authz_decision, outcome)
values ('r1', 'system', 't27', 'allow', 'intent');
do $$
begin
  begin update admin_private.admin_audit set action = 'x'; raise exception 'T27.4 FALHOU: update'; exception when insufficient_privilege then null; end;
  begin delete from admin_private.admin_audit; raise exception 'T27.4 FALHOU: delete'; exception when insufficient_privilege then null; end;
  begin truncate admin_private.admin_audit; raise exception 'T27.4 FALHOU: truncate'; exception when insufficient_privilege then null; end;
  raise notice 'T27.4 ok — admin_audit append-only (UPDATE/DELETE/TRUNCATE recusados até para postgres)';
end $$;

-- T27.5 anon nem enxerga o schema
set local role anon;
do $$
begin
  begin
    perform 1 from admin_private.admin_identities;
    raise exception 'T27.5 FALHOU: anon leu admin_identities';
  exception when insufficient_privilege then raise notice 'T27.5 ok — anon recusado (42501)';
  end;
end $$;
reset role;

rollback;
