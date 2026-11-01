\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 28 — R4/M5 (Admin CC 2.0): 0084 G1 · 0085 G2 · 0086 G3 · 0087 G4 — fechamento total
--
-- ⚠️ RODAR COM OS DEFAULT PRIVILEGES DO SUPABASE (imagem supabase/postgres ou README): em PG puro
-- nada nasce com grant para anon e este teste passaria sem as migrations. A prova de que ele MORDE:
-- com a cadeia até 0083, T28.1 e T28.3/T28.4 falham (anon ainda tem SELECT; o SELECT dá 0 linhas pela
-- RLS em vez de 42501 pela ACL).
-- Esperado: termina com 'T28 PASS'.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── T28.1: nenhuma das 34 tabelas dá NENHUM privilégio a anon/authenticated/PUBLIC
do $$
declare
  t text; r text; p text; n int := 0;
  tabelas text[] := array['platform_admins','tier_cache','users','auth_nonces',
    'autopilot_sessions','autopilot_runs','dca_planos','dca_ciclos','strategy_certificates',
    'platform_events','zion_suggestions','agent_lessons','market_brain','ulfhednar_mensagens',
    'paper_accounts','paper_positions','lab_strategies','lab_runs','lab_results','lab_capital_log',
    'bancada_estrategia','bancada_rodada','bancada_operacao','bancada_posicao','bancada_resultado',
    'bancada_arrendamento','celeiro_genoma','celeiro_mutacoes','celeiro_fluxos','celeiro_posicoes',
    'mercado_vela','mercado_cobertura','pro_piscina_medicao','pro_piscina_veredito'];
  privs text[] := array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
begin
  foreach t in array tabelas loop
    if to_regclass('public.'||t) is null then raise exception 'T28.1: public.% não existe', t; end if;
    foreach r in array array['anon','authenticated','public'] loop
      foreach p in array privs loop
        if has_table_privilege(r, ('public.'||t)::regclass, p) then
          raise exception 'T28.1: % ainda tem % em public.%', r, p, t;
        end if;
      end loop;
    end loop;
    -- ── T28.2: service_role (a identidade do app) continua com o necessário
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', ('public.'||t)::regclass, p) then
        raise exception 'T28.2: service_role perdeu % em public.%', p, t;
      end if;
    end loop;
    -- ── T28.5 (T-ACL-18): RLS ligada e zero policies (o desenho não muda)
    if not (select relrowsecurity from pg_class where oid = ('public.'||t)::regclass) then
      raise exception 'T28.5: RLS desligada em public.%', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'T28.5: public.% tem policy', t;
    end if;
    n := n + 1;
  end loop;
  raise notice 'T28.1/2/5 OK — % tabelas fechadas para anon/authenticated/PUBLIC; service_role intacto', n;
end $$;

-- ── T28.3 (T-ACL-04/05): anon recebe 42501 da ACL (não 0 linhas da RLS) num SELECT e num INSERT
do $$
declare acl int := 0; m text; t text;
begin
  foreach t in array array['platform_admins','tier_cache','autopilot_sessions','platform_events','paper_positions','celeiro_fluxos'] loop
    begin
      execute 'set local role anon';
      execute format('select count(*) from public.%I', t);
      execute 'reset role';
      raise exception 'T28.3: anon leu public.% sem erro', t;
    exception when insufficient_privilege then
      get stacked diagnostics m = message_text;
      execute 'reset role';
      if m !~ 'permission denied for table' then raise exception 'T28.3: % negou por outro motivo: %', t, m; end if;
      acl := acl + 1;
    end;
  end loop;
  begin
    set local role anon;
    insert into public.platform_admins default values;
    reset role;
    raise exception 'T28.3: anon inseriu em platform_admins';
  exception when insufficient_privilege then
    get stacked diagnostics m = message_text;
    reset role;
    if m !~ 'permission denied for table' then raise exception 'T28.3: insert negado pela RLS, não pela ACL: %', m; end if;
    acl := acl + 1;
  end;
  raise notice 'T28.3 OK — % tentativas de anon negadas pela ACL (42501 permission denied)', acl;
end $$;

-- ── T28.4 (T-ACL-06): authenticated não atualiza autopilot_sessions (ACL)
do $$
declare m text;
begin
  begin
    set local role authenticated;
    update public.autopilot_sessions set is_active = false;
    reset role;
    raise exception 'T28.4: authenticated atualizou autopilot_sessions';
  exception when insufficient_privilege then
    get stacked diagnostics m = message_text;
    reset role;
    if m !~ 'permission denied for table' then raise exception 'T28.4: negado por outro motivo: %', m; end if;
  end;
  raise notice 'T28.4 OK — authenticated barrado pela ACL';
end $$;

-- ── T28.6: service_role continua lendo (comportamento, não só catálogo)
do $$
begin
  set local role service_role;
  perform count(*) from public.platform_admins;
  perform count(*) from public.paper_positions;
  reset role;
  raise notice 'T28.6 OK — service_role lê normalmente';
end $$;

rollback;
\echo 'T28 PASS'
