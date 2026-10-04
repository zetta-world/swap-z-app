\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 17 — ACL DAS TABELAS OPERACIONAIS (F-14 / 0070): admin_kv, rate_limits, admin_audit_log
-- Derivado mecanicamente do 14 (mesmo método; só a lista de tabelas e os rótulos mudam).
--
-- ⚠️ RODAR NUM AMBIENTE COM OS DEFAULT PRIVILEGES DO SUPABASE. Em PostgreSQL
-- puro nenhuma tabela nasce com grant para anon/authenticated, e este teste
-- passaria mesmo sem a 0070 — foi exatamente assim que o T10c passou verde até
-- a Release Phase 2. A prova só vale onde o grant da plataforma existe.
--
-- Mede duas coisas, e as duas são necessárias:
--   T17.1–T17.4  CATÁLOGO: nenhum privilégio de tabela ou de coluna para
--                PUBLIC/anon/authenticated; RLS ligada; zero policies;
--                service_role mantém o que a aplicação usa.
--   T17.5–T17.6  COMPORTAMENTO: como anon/authenticated, SELECT, INSERT e
--                TRUNCATE falham por PRIVILÉGIO (SQLSTATE 42501). "Devolver 0
--                linhas" NÃO passa: isso é RLS, a segunda porta. TRUNCATE nem
--                passa por RLS — só a ACL o segura.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── T17.1: nenhum privilégio de TABELA para PUBLIC/anon/authenticated ───────
do $$
declare
  t text; r text; p text; n int := 0;
  tabelas text[] := array['admin_kv','rate_limits','admin_audit_log'];
  privs   text[] := array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
begin
  foreach t in array tabelas loop
    if to_regclass('public.'||t) is null then
      raise exception 'T17.1: tabela % nao existe', t;
    end if;
    -- PUBLIC não tem papel para has_table_privilege: lê a ACL crua.
    if exists (select 1 from pg_class c, aclexplode(c.relacl) a
                where c.oid = ('public.'||t)::regclass and a.grantee = 0) then
      raise exception 'T17.1: PUBLIC tem privilegio direto em %', t;
    end if;
    foreach r in array array['anon','authenticated'] loop
      foreach p in array privs loop
        if has_table_privilege(r, 'public.'||t, p) then
          raise exception 'T17.1: % tem % em %', r, p, t;
        end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  raise notice 'T17.1 OK — % combinacoes tabela x papel x privilegio negadas; PUBLIC sem grant nas 3', n;
end $$;

-- ── T17.2: nenhum privilégio de COLUNA (REVOKE ALL ON TABLE não os cobre) ───
do $$
declare v int;
begin
  select count(*) into v
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name in ('admin_kv','rate_limits','admin_audit_log')
     and grantee in ('PUBLIC','anon','authenticated');
  if v <> 0 then
    raise exception 'T17.2: % privilegios de coluna para PUBLIC/anon/authenticated', v;
  end if;
  raise notice 'T17.2 OK — nenhum privilegio de coluna para PUBLIC/anon/authenticated';
end $$;

-- ── T17.3: RLS ligada e ZERO policies (o desenho não mudou) ─────────────────
do $$
declare r record;
begin
  for r in select c.relname, c.relrowsecurity,
                  (select count(*) from pg_policy where polrelid = c.oid) pol
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('admin_kv','rate_limits','admin_audit_log') loop
    if not r.relrowsecurity then raise exception 'T17.3: % sem RLS', r.relname; end if;
    if r.pol <> 0 then raise exception 'T17.3: % tem % policies', r.relname, r.pol; end if;
  end loop;
  raise notice 'T17.3 OK — RLS ligada e zero policies nas 3';
end $$;

-- ── T17.4: service_role segue com o que a aplicação usa ─────────────────────
do $$
declare t text; p text;
begin
  foreach t in array array['admin_kv','rate_limits','admin_audit_log'] loop
    foreach p in array array['SELECT','INSERT','UPDATE'] loop
      if not has_table_privilege('service_role', 'public.'||t, p) then
        raise exception 'T17.4: service_role perdeu % em %', p, t;
      end if;
    end loop;
  end loop;
  raise notice 'T17.4 OK — service_role mantem SELECT/INSERT/UPDATE nas 3';
end $$;

-- ── T17.5: comportamento como ANON — cada tentativa falha por PRIVILÉGIO ────
do $$
declare
  t text; op text; estado text; msg text; n int := 0;
begin
  foreach t in array array['admin_kv','rate_limits','admin_audit_log'] loop
    foreach op in array array['select','insert','truncate'] loop
      estado := null;
      begin
        execute 'set local role anon';
        if op = 'select' then
          execute format('select count(*) from public.%I', t);
        elsif op = 'insert' then
          execute format('insert into public.%I default values', t);
        else
          execute format('truncate public.%I', t);
        end if;
        estado := 'EXECUTOU';
      exception when others then
        estado := sqlstate; msg := sqlerrm;
      end;
      execute 'reset role';
      -- ⚠️ 42501 SOZINHO NÃO BASTA: violação de RLS num INSERT também é 42501
      -- ("new row violates row-level security policy"). Só a mensagem de
      -- privilégio prova que quem barrou foi a ACL, não a RLS.
      if estado is distinct from '42501' or msg not like 'permission denied for table%' then
        raise exception 'T17.5: anon % em % terminou em % / % (esperado 42501 permission denied for table)', op, t, estado, coalesce(msg,'-');
      end if;
      n := n + 1;
    end loop;
  end loop;
  raise notice 'T17.5 OK — % tentativas de anon (select/insert/truncate) negadas por privilegio', n;
end $$;

-- ── T17.6: comportamento como AUTHENTICATED ─────────────────────────────────
do $$
declare
  t text; op text; estado text; msg text; n int := 0;
begin
  foreach t in array array['admin_kv','rate_limits','admin_audit_log'] loop
    foreach op in array array['select','truncate'] loop
      estado := null;
      begin
        execute 'set local role authenticated';
        if op = 'select' then
          execute format('select count(*) from public.%I', t);
        else
          execute format('truncate public.%I', t);
        end if;
        estado := 'EXECUTOU';
      exception when others then
        estado := sqlstate; msg := sqlerrm;
      end;
      execute 'reset role';
      if estado is distinct from '42501' or msg not like 'permission denied for table%' then
        raise exception 'T17.6: authenticated % em % terminou em % / % (esperado 42501 permission denied for table)', op, t, estado, coalesce(msg,'-');
      end if;
      n := n + 1;
    end loop;
  end loop;
  raise notice 'T17.6 OK — % tentativas de authenticated (select/truncate) negadas por privilegio', n;
end $$;

rollback;
