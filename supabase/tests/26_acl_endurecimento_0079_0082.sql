\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 26 — R4 (Admin CC 2.0): 0079 (M1) · 0080 (M3) · 0081 (M4) · 0082 (M2)
--
-- ⚠️ RODAR COM OS DEFAULT PRIVILEGES DO SUPABASE REPRODUZIDOS (ver README):
-- em PostgreSQL puro nada nasce com grant para anon e este teste passaria sem
-- as migrations. A prova de que ele MORDE: rodado com a cadeia até 0078, T26.1,
-- T26.3, T26.5, T26.6 e T26.8 falham.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── T26.1 (M1/ADM-010): nenhuma das 34 tem TRUNCATE/REFERENCES/TRIGGER[/MAINTAIN]
do $$
declare
  t text; r text; p text; n int := 0;
  tabelas text[] := array['platform_admins','tier_cache','users','auth_nonces','autopilot_sessions',
    'autopilot_runs','dca_planos','dca_ciclos','strategy_certificates','platform_events','zion_suggestions',
    'agent_lessons','market_brain','ulfhednar_mensagens','paper_accounts','paper_positions','lab_strategies',
    'lab_runs','lab_results','lab_capital_log','bancada_estrategia','bancada_rodada','bancada_operacao',
    'bancada_posicao','bancada_resultado','bancada_arrendamento','celeiro_genoma','celeiro_mutacoes',
    'celeiro_fluxos','celeiro_posicoes','mercado_vela','mercado_cobertura','pro_piscina_medicao','pro_piscina_veredito'];
  privs text[] := case when current_setting('server_version_num')::int >= 170000
                       then array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                       else array['TRUNCATE','REFERENCES','TRIGGER'] end;
begin
  foreach t in array tabelas loop
    if to_regclass('public.'||t) is null then raise exception 'T26.1: public.% não existe', t; end if;
    foreach r in array array['anon','authenticated','public'] loop
      foreach p in array privs loop
        if has_table_privilege(r, ('public.'||t)::regclass, p) then
          raise warning 'T26.1: % tem % em %', r, p, t; n := n + 1;
        end if;
      end loop;
    end loop;
    -- o app (service_role) não perde nada
    if not has_table_privilege('service_role', ('public.'||t)::regclass, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'T26.1: service_role perdeu acesso a %', t;
    end if;
  end loop;
  if n > 0 then raise exception 'T26.1 FALHOU: % privilégio(s) de TRUNCATE/REFERENCES/TRIGGER abertos', n; end if;
  raise notice 'T26.1 ok — 34 tabelas sem TRUNCATE/REFERENCES/TRIGGER para anon/authenticated/PUBLIC';
end $$;

-- ── T26.2: COMPORTAMENTO — anon tenta TRUNCATE → 42501 (RLS não segura isto)
set local role anon;
do $$
begin
  begin
    truncate public.users;
    raise exception 'T26.2 FALHOU: anon truncou public.users';
  exception when insufficient_privilege then
    raise notice 'T26.2 ok — TRUNCATE de anon recusado por privilégio (42501)';
  end;
end $$;
reset role;

-- ── T26.3 (M3): 4 INVOKER sem EXECUTE para anon/authenticated/PUBLIC; service_role com
do $$
declare f text; r text; n int := 0;
  funcoes text[] := array['public.apply_session_pnl(uuid,numeric,text)','public.bump_session_trades(text,text,integer)',
    'public.consume_rate_limit(text,integer,integer)',
    'public.cex_transicao_permitida(public.cex_intent_state,public.cex_intent_state)'];
begin
  foreach f in array funcoes loop
    if to_regprocedure(f) is null then raise exception 'T26.3: % não existe', f; end if;
    foreach r in array array['anon','authenticated','public'] loop
      if has_function_privilege(r, to_regprocedure(f), 'EXECUTE') then
        raise warning 'T26.3: % executa %', r, f; n := n + 1;
      end if;
    end loop;
    if not has_function_privilege('service_role', to_regprocedure(f), 'EXECUTE') then
      raise exception 'T26.3: service_role perdeu EXECUTE em %', f;
    end if;
  end loop;
  if n > 0 then raise exception 'T26.3 FALHOU: % EXECUTE abertos', n; end if;
  raise notice 'T26.3 ok — 4 funções só service_role/postgres';
end $$;

-- ── T26.4: COMPORTAMENTO — anon chamando consume_rate_limit → 42501 na FUNÇÃO
set local role anon;
do $$
begin
  begin
    perform public.consume_rate_limit('t26', 1, 60);
    raise exception 'T26.4 FALHOU: anon executou consume_rate_limit';
  exception when insufficient_privilege then
    raise notice 'T26.4 ok — anon recusado na função (42501)';
  end;
end $$;
reset role;

-- ── T26.5 (M3): sequência de founders_sale_events fechada para anon; service_role usa
do $$
begin
  if has_sequence_privilege('anon', 'public.founders_sale_events_seq_seq', 'USAGE')
     or has_sequence_privilege('anon', 'public.founders_sale_events_seq_seq', 'UPDATE')
     or has_sequence_privilege('authenticated', 'public.founders_sale_events_seq_seq', 'USAGE') then
    raise exception 'T26.5 FALHOU: sequência ainda aberta para anon/authenticated';
  end if;
  if not has_sequence_privilege('service_role', 'public.founders_sale_events_seq_seq', 'USAGE') then
    raise exception 'T26.5: service_role perdeu USAGE da sequência (INSERT em founders_sale_events quebraria)';
  end if;
  raise notice 'T26.5 ok — sequência só service_role';
end $$;

-- ── T26.6 (M4): as 14 funções com search_path = public, pg_temp
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any(array['bancada_marcar_adiado','bancada_gravar_ultimos_tiques','bancada_tique_liberar',
       'bancada_tique_arrendar','bancada_reservar_rodada','bancada_abrir_posicao_papel','celeiro_reverter_genoma',
       'cex_recalcular_intent','cex_transicionar','cex_transicao_permitida','autopilot_projecao_pendente',
       'autopilot_taxa_do_intent_em_usd','autopilot_efeito_incompleto','autopilot_compromisso_vivo'])
     and not ('search_path=public, pg_temp' = any(coalesce(p.proconfig, '{}')));
  if n > 0 then raise exception 'T26.6 FALHOU: % função(ões) sem search_path=public, pg_temp', n; end if;
  -- e nenhuma SECURITY DEFINER de public ficou sem pg_temp
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not ('search_path=public, pg_temp' = any(coalesce(p.proconfig, '{}')));
  if n > 0 then raise exception 'T26.6 FALHOU: % SECURITY DEFINER sem pg_temp', n; end if;
  raise notice 'T26.6 ok — search_path fixo com pg_temp por último';
end $$;

-- ── T26.7 (regressão): nenhuma SECURITY DEFINER de public executável por anon/authenticated/PUBLIC
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('public', p.oid, 'EXECUTE'));
  if n > 0 then raise exception 'T26.7 FALHOU: % SECURITY DEFINER abertas', n; end if;
  raise notice 'T26.7 ok — 0 SECURITY DEFINER abertas';
end $$;

-- ── T26.8 (M2): objeto NOVO de postgres em public nasce fechado; service_role mantém
create table public.t26_nova (id int);
create sequence public.t26_seq;
create function public.t26_fn() returns int language sql as 'select 1';
create schema t26_outro;
create function t26_outro.t26_fn2() returns int language sql as 'select 2';
do $$
begin
  if has_table_privilege('anon', 'public.t26_nova', 'SELECT') or has_table_privilege('authenticated', 'public.t26_nova', 'TRUNCATE') then
    raise exception 'T26.8 FALHOU: tabela nova nasceu aberta para anon/authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.t26_nova', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'T26.8: service_role não recebeu a tabela nova';
  end if;
  if has_sequence_privilege('anon', 'public.t26_seq', 'USAGE') then
    raise exception 'T26.8 FALHOU: sequência nova nasceu aberta';
  end if;
  if has_function_privilege('anon', 'public.t26_fn()', 'EXECUTE') or has_function_privilege('public', 'public.t26_fn()', 'EXECUTE') then
    raise exception 'T26.8 FALHOU: função nova em public nasceu executável por anon/PUBLIC';
  end if;
  if not has_function_privilege('service_role', 'public.t26_fn()', 'EXECUTE') then
    raise exception 'T26.8: service_role não recebeu EXECUTE da função nova em public';
  end if;
  -- forma GLOBAL: fora de public também não há EXECUTE a PUBLIC
  if has_function_privilege('public', 't26_outro.t26_fn2()', 'EXECUTE') then
    raise exception 'T26.8 FALHOU: função nova fora de public nasceu com EXECUTE a PUBLIC (revoke por schema não basta)';
  end if;
  raise notice 'T26.8 ok — objetos novos nascem fechados (tabela, sequência, função; global)';
end $$;

rollback;
