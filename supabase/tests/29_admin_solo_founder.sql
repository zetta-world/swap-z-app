\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 29 — 0088: SOLO FOUNDER MODE. Bootstrap único com UMA identidade, recusas,
-- regras `standard` da 0083 preservadas, recuperação, transição e ACL.
-- Rodar com os default privileges do Supabase reproduzidos (README). Tudo numa
-- transação desfeita no fim (o arquivo pode rodar de novo).
--
-- Ids: identidades A (fundador) …a1, B (comum, sem MFA) …b1, C …c1, D …d1;
-- sessões …e1 (A, step-up agora) · …e2 (A, step-up velho) · …e3 (A, expirada)
-- · …e4 (B, pré-MFA) · …e5 (C, step-up agora).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

insert into admin_private.admin_identities
  (id, status, email_normalized, provider, expected_issuer, expected_tenant, auth_user_id, idp_subject, mfa_factor_id, mfa_enrolled_at)
values
  ('00000000-0000-0000-0000-0000000000a1','active','dono@exemplo.test','google','https://accounts.google.com','exemplo.test',
   '10000000-0000-0000-0000-0000000000a1','sub-a','20000000-0000-0000-0000-0000000000a1', now()),
  ('00000000-0000-0000-0000-0000000000b1','invited','ops@exemplo.test','google','https://accounts.google.com','exemplo.test',
   null, null, null, null),
  ('00000000-0000-0000-0000-0000000000c1','active','c@exemplo.test','google','https://accounts.google.com','exemplo.test',
   '10000000-0000-0000-0000-0000000000c1','sub-c','20000000-0000-0000-0000-0000000000c1', now()),
  ('00000000-0000-0000-0000-0000000000d1','active','d@exemplo.test','google','https://accounts.google.com','exemplo.test',
   '10000000-0000-0000-0000-0000000000d1','sub-d','20000000-0000-0000-0000-0000000000d1', now());

insert into admin_private.admin_sessions
  (id, token_hash, kind, state, identity_id, created_at, last_seen_at, absolute_expires_at, idle_timeout_s, aal, mfa_verified_at, step_up_at)
values
  ('30000000-0000-0000-0000-0000000000e1', decode(repeat('01',32),'hex'), 'corp','active','00000000-0000-0000-0000-0000000000a1',
   now(), now(), now() + interval '8 hours', 1800, 'aal2', now(), now()),
  ('30000000-0000-0000-0000-0000000000e2', decode(repeat('02',32),'hex'), 'corp','active','00000000-0000-0000-0000-0000000000a1',
   now(), now(), now() + interval '8 hours', 1800, 'aal2', now() - interval '1 hour', now() - interval '1 hour'),
  ('30000000-0000-0000-0000-0000000000e3', decode(repeat('03',32),'hex'), 'corp','active','00000000-0000-0000-0000-0000000000a1',
   now() - interval '9 hours', now() - interval '9 hours', now() - interval '1 hour', 1800, 'aal2', now() - interval '9 hours', now() - interval '9 hours'),
  ('30000000-0000-0000-0000-0000000000e4', decode(repeat('04',32),'hex'), 'corp','mfa_pending','00000000-0000-0000-0000-0000000000b1',
   now(), now(), now() + interval '10 minutes', 600, 'aal1', null, null),
  ('30000000-0000-0000-0000-0000000000e5', decode(repeat('05',32),'hex'), 'corp','active','00000000-0000-0000-0000-0000000000c1',
   now(), now(), now() + interval '8 hours', 1800, 'aal2', now(), now());

-- T29.1 ACL: nada para anon/authenticated/PUBLIC; service_role só LÊ governança e autorizações; RPCs só service_role
do $$
declare r text; t text; f text;
begin
  foreach r in array array['anon','authenticated','public'] loop
    foreach t in array array['admin_governance','admin_founder_authorizations'] loop
      if has_table_privilege(r, 'admin_private.'||t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'T29.1: % tem privilégio em %', r, t;
      end if;
    end loop;
    foreach f in array array['admin_private.founder_bootstrap(uuid,uuid,bytea,text,text)',
                             'admin_private.founder_mfa_reset(bytea,text,bytea,timestamptz,text,text)',
                             'admin_private.governance_to_multi(uuid,text)'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception 'T29.1: % executa %', r, f; end if;
    end loop;
  end loop;
  foreach t in array array['admin_governance','admin_founder_authorizations'] loop
    if not has_table_privilege('service_role', 'admin_private.'||t, 'SELECT') then raise exception 'T29.1: service_role não lê %', t; end if;
    if has_table_privilege('service_role', 'admin_private.'||t, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'T29.1: service_role ESCREVE % direto (só a RPC pode)', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('admin_private.'||t)::regclass) then raise exception 'T29.1: RLS desligada em %', t; end if;
  end loop;
  if not has_function_privilege('service_role', 'admin_private.founder_bootstrap(uuid,uuid,bytea,text,text)', 'EXECUTE') then
    raise exception 'T29.1: service_role não executa o bootstrap';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'admin_private') then raise exception 'T29.1: há policy'; end if;
  if (select mode from admin_private.admin_governance) <> 'multi_admin' then raise exception 'T29.1: modo inicial não é multi_admin'; end if;
  raise notice 'T29.1 ok — tabelas novas fechadas; service_role só lê; RPCs só service_role; modo inicial multi_admin';
end $$;

-- T29.2 regras `standard` da 0083 continuam (ninguém concede a si; topo exige aprovador ≠ concedente ≠ alvo)
do $$
begin
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-0000000000c1', 'operations', '00000000-0000-0000-0000-0000000000c1');
    raise exception 'T29.2: auto-concessão aceita';
  exception when check_violation then null; end;
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-0000000000c1', 'superadmin', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'T29.2: superadmin sem aprovador aceito';
  exception when check_violation then null; end;
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by, approved_by)
    values ('00000000-0000-0000-0000-0000000000c1', 'superadmin', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'T29.2: aprovador = concedente aceito';
  exception when check_violation then null; end;
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-0000000000c1', 'operations', null);
    raise exception 'T29.2: standard sem concedente aceito';
  exception when check_violation then null; end;
  -- concessão de fundador direta, sem passar pela RPC: precisa de autorização consumida (FK) — não há
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, grant_kind, founder_authorization)
    values ('00000000-0000-0000-0000-0000000000a1', 'superadmin', 'founder_bootstrap', decode(repeat('aa',32),'hex'));
    raise exception 'T29.2: concessão de fundador sem autorização aceita';
  exception when foreign_key_violation then null; end;
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, grant_kind)
    values ('00000000-0000-0000-0000-0000000000a1', 'superadmin', 'founder_bootstrap');
    raise exception 'T29.2: concessão de fundador sem autorização (null) aceita';
  exception when check_violation then null; end;
  raise notice 'T29.2 ok — regras standard da 0083 preservadas; fundador só pela RPC';
end $$;

-- T29.3 recusas do bootstrap (chamadas COMO service_role, o único que executa)
set local role service_role;
do $$
declare r text; tok bytea := decode(repeat('7a',32),'hex');
begin
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000e4', tok, 'ops@exemplo.test', 'req-b');
  if r <> 'identidade_nao_verificada' then raise exception 'T29.3a: usuário comum/sem MFA → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e1', tok, 'outro@exemplo.test', 'req-x');
  if r <> 'nao_e_o_fundador' then raise exception 'T29.3b: e-mail de fundador diferente → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e2', tok, 'dono@exemplo.test', 'req-x');
  if r <> 'sessao_sem_mfa_recente' then raise exception 'T29.3c: sem step-up recente → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e3', tok, 'dono@exemplo.test', 'req-x');
  if r <> 'sessao_sem_mfa_recente' then raise exception 'T29.3d: sessão expirada → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e5', tok, 'dono@exemplo.test', 'req-x');
  if r <> 'sessao_sem_mfa_recente' then raise exception 'T29.3e: sessão de OUTRA identidade → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e1', decode('00','hex'), 'dono@exemplo.test', 'req-x');
  if r <> 'autorizacao_invalida' then raise exception 'T29.3f: autorização malformada → %', r; end if;
  if (select count(*) from admin_private.admin_founder_authorizations) <> 0 then raise exception 'T29.3: recusa consumiu autorização'; end if;
  raise notice 'T29.3 ok — comum, e-mail errado, sem MFA recente, expirada, sessão alheia e autorização malformada recusados, nada gravado';
end $$;

-- T29.4 sucesso com UMA identidade; T29.5 repetido recusado
do $$
declare r text; tok bytea := decode(repeat('7a',32),'hex');
begin
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e1', tok, ' Dono@Exemplo.test ', 'req-ok');
  if r <> 'ok' then raise exception 'T29.4: bootstrap legítimo → %', r; end if;
  if (select mode from admin_private.admin_governance) <> 'solo_founder'
     or (select founder_identity_id from admin_private.admin_governance) <> '00000000-0000-0000-0000-0000000000a1' then
    raise exception 'T29.4: governança não virou solo_founder do A';
  end if;
  if (select count(*) from admin_private.admin_role_assignments where grant_kind = 'founder_bootstrap'
        and identity_id = '00000000-0000-0000-0000-0000000000a1' and role = 'superadmin' and revoked_at is null) <> 1 then
    raise exception 'T29.4: atribuição de fundador ausente';
  end if;
  if not exists (select 1 from admin_private.admin_audit where action = 'governance.founder_bootstrap' and outcome = 'succeeded') then
    raise exception 'T29.4: sem trilha';
  end if;
  raise notice 'T29.4 ok — uma identidade bastou: superadmin + solo_founder + trilha, numa transação';
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e1', tok, 'dono@exemplo.test', 'req-2');
  if r <> 'ja_feito' then raise exception 'T29.5a: repetido com o mesmo token → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e1', decode(repeat('7b',32),'hex'), 'dono@exemplo.test', 'req-3');
  if r <> 'ja_feito' then raise exception 'T29.5b: repetido com token novo → %', r; end if;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000c1','30000000-0000-0000-0000-0000000000e5', decode(repeat('7c',32),'hex'), 'c@exemplo.test', 'req-4');
  if r <> 'ja_feito' then raise exception 'T29.5c: outro "fundador" → %', r; end if;
  raise notice 'T29.5 ok — bootstrap repetido recusado (mesmo token, token novo, outra identidade)';
end $$;

-- T29.6 service_role não escreve governança/autorizações direto e não move atribuições
do $$
begin
  begin
    update admin_private.admin_governance set founder_identity_id = '00000000-0000-0000-0000-0000000000c1';
    raise exception 'T29.6: service_role trocou o fundador direto';
  exception when insufficient_privilege then null; end;
  begin
    insert into admin_private.admin_founder_authorizations (token_sha256, purpose, identity_id, request_id)
    values (decode(repeat('7d',32),'hex'), 'bootstrap', '00000000-0000-0000-0000-0000000000c1', 'x');
    raise exception 'T29.6: service_role criou autorização direto';
  exception when insufficient_privilege then null; end;
  begin
    update admin_private.admin_role_assignments set identity_id = '00000000-0000-0000-0000-0000000000c1'
      where grant_kind = 'founder_bootstrap';
    raise exception 'T29.6: superadmin movido para outra identidade';
  exception when insufficient_privilege then null; end;
  raise notice 'T29.6 ok — governança/autorização só pela RPC; atribuição imutável salvo revogação';
end $$;
reset role;

-- T29.7 um 2º bootstrap é impossível mesmo por fora da RPC (índice único "uma vez")
do $$
begin
  insert into admin_private.admin_founder_authorizations (token_sha256, purpose, identity_id, request_id)
  values (decode(repeat('7e',32),'hex'), 'bootstrap', '00000000-0000-0000-0000-0000000000c1', 'x');
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, grant_kind, founder_authorization)
    values ('00000000-0000-0000-0000-0000000000c1', 'superadmin', 'founder_bootstrap', decode(repeat('7e',32),'hex'));
    raise exception 'T29.7: segundo founder_bootstrap aceito';
  exception when unique_violation then null; end;
  delete from admin_private.admin_founder_authorizations where token_sha256 = decode(repeat('7e',32),'hex');
  raise notice 'T29.7 ok — um único founder_bootstrap para sempre';
end $$;

-- T29.8 recuperação de MFA do fundador (uso único; sessões revogadas; papel fica)
set local role service_role;
do $$
declare r jsonb; tok bytea := decode(repeat('5a',32),'hex');
begin
  r := admin_private.founder_mfa_reset(tok, 'outro@exemplo.test', decode(repeat('66',32),'hex'), now() + interval '1 hour', '0xabc…', 'rec-x');
  if r->>'codigo' <> 'nao_e_o_fundador' then raise exception 'T29.8a: % ', r; end if;
  r := admin_private.founder_mfa_reset(tok, 'dono@exemplo.test', decode(repeat('66',32),'hex'), now() + interval '30 days', '0xabc…', 'rec-x');
  if r->>'codigo' <> 'ativacao_invalida' then raise exception 'T29.8b: validade longa demais aceita %', r; end if;
  r := admin_private.founder_mfa_reset(decode(repeat('7a',32),'hex'), 'dono@exemplo.test', decode(repeat('66',32),'hex'), now() + interval '1 hour', '0xabc…', 'rec-x');
  if r->>'codigo' <> 'autorizacao_usada' then raise exception 'T29.8c: token do bootstrap reusado %', r; end if;
  r := admin_private.founder_mfa_reset(tok, 'dono@exemplo.test', decode(repeat('66',32),'hex'), now() + interval '1 hour', '0xabc…', 'rec-ok');
  if r->>'codigo' <> 'ok' or (r->>'fator_antigo')::uuid <> '20000000-0000-0000-0000-0000000000a1' then raise exception 'T29.8d: %', r; end if;
  if (select status from admin_private.admin_identities where id = '00000000-0000-0000-0000-0000000000a1') <> 'invited'
     or (select mfa_factor_id from admin_private.admin_identities where id = '00000000-0000-0000-0000-0000000000a1') is not null
     or (select idp_subject from admin_private.admin_identities where id = '00000000-0000-0000-0000-0000000000a1') <> 'sub-a' then
    raise exception 'T29.8d: identidade não voltou a invited mantendo o vínculo';
  end if;
  if exists (select 1 from admin_private.admin_sessions where identity_id = '00000000-0000-0000-0000-0000000000a1' and revoked_at is null) then
    raise exception 'T29.8d: sessão do fundador ficou viva';
  end if;
  if not exists (select 1 from admin_private.admin_role_assignments where grant_kind = 'founder_bootstrap' and revoked_at is null) then
    raise exception 'T29.8d: papel de fundador perdido na recuperação';
  end if;
  r := admin_private.founder_mfa_reset(tok, 'dono@exemplo.test', decode(repeat('67',32),'hex'), now() + interval '1 hour', '0xabc…', 'rec-2');
  if r->>'codigo' <> 'autorizacao_usada' then raise exception 'T29.8e: recuperação reusada %', r; end if;
  raise notice 'T29.8 ok — recuperação de uso único: invited com o mesmo sub, sessões revogadas, papel mantido';
end $$;
reset role;

-- reativa A (simula a nova matrícula do TOTP) e abre sessão nova com step-up
update admin_private.admin_identities set status = 'active', mfa_factor_id = '20000000-0000-0000-0000-0000000000a2', mfa_enrolled_at = now(),
  activation_code_hash = null, activation_expires_at = null where id = '00000000-0000-0000-0000-0000000000a1';
insert into admin_private.admin_sessions
  (id, token_hash, kind, state, identity_id, absolute_expires_at, idle_timeout_s, aal, mfa_verified_at, step_up_at)
values ('30000000-0000-0000-0000-0000000000e6', decode(repeat('06',32),'hex'), 'corp','active','00000000-0000-0000-0000-0000000000a1',
        now() + interval '8 hours', 1800, 'aal2', now(), now());

-- T29.9 transição para multi_admin: gate no banco, só pelo fundador, só ida
set local role service_role;
do $$
declare r text;
begin
  r := admin_private.governance_to_multi('30000000-0000-0000-0000-0000000000e6', 'tr-1');
  if r <> 'gate_multi_incompleto' then raise exception 'T29.9a: transição só com o fundador → %', r; end if;
  r := admin_private.governance_to_multi('30000000-0000-0000-0000-0000000000e5', 'tr-1');
  if r <> 'sessao_sem_mfa_recente' then raise exception 'T29.9b: transição por sessão de outra identidade → %', r; end if;
end $$;
reset role;
-- C vira superadmin (A concede, D aprova) e D vira security_admin (A concede, C aprova): regras standard
insert into admin_private.admin_role_assignments (identity_id, role, granted_by, approved_by)
values ('00000000-0000-0000-0000-0000000000c1', 'superadmin', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1'),
       ('00000000-0000-0000-0000-0000000000d1', 'security_admin', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1');
set local role service_role;
do $$
declare r text;
begin
  r := admin_private.governance_to_multi('30000000-0000-0000-0000-0000000000e6', 'tr-2');
  if r <> 'ok' then raise exception 'T29.9c: transição com o gate cumprido → %', r; end if;
  if (select mode from admin_private.admin_governance) <> 'multi_admin' then raise exception 'T29.9c: modo não mudou'; end if;
  r := admin_private.governance_to_multi('30000000-0000-0000-0000-0000000000e6', 'tr-3');
  if r <> 'nao_solo' then raise exception 'T29.9d: transição repetida → %', r; end if;
  raise notice 'T29.9 ok — transição só com o gate (2 superadmins, 1 aprovado; 1 security_admin), só pelo fundador, só ida';
end $$;
reset role;

-- T29.10 em multi_admin as regras standard seguem; bootstrap não reabre
do $$
declare r text;
begin
  begin
    insert into admin_private.admin_role_assignments (identity_id, role, granted_by)
    values ('00000000-0000-0000-0000-0000000000c1', 'finance', '00000000-0000-0000-0000-0000000000c1');
    raise exception 'T29.10: auto-concessão aceita em multi';
  exception when check_violation then null; end;
  r := admin_private.founder_bootstrap('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000e6', decode(repeat('7f',32),'hex'), 'dono@exemplo.test', 'req-9');
  if r <> 'ja_feito' then raise exception 'T29.10: bootstrap reabriu em multi → %', r; end if;
  raise notice 'T29.10 ok — multi_admin mantém o RBAC/2 pessoas; bootstrap não reabre';
end $$;

rollback;
