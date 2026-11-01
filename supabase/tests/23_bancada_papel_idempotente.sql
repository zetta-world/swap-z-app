-- ═══════════════════════════════════════════════════════════════════════════
-- 23 — PAPEL ADIANTE: lease do tique, abertura idempotente, estado do sinal (migration 0076, RM-01/02/03)
--
-- ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0076). NUNCA contra produção.
-- Roda numa transação e desfaz tudo no fim (ROLLBACK). A concorrência entre sessões (que uma transação
-- só não prova) está em 23b_bancada_papel_concorrencia.sh.
--
-- Uso: psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f 23_bancada_papel_idempotente.sql
-- Esperado: termina com 'T23 PASS'. Qualquer ASSERT falho aborta com a mensagem do caso.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;

create function pg_temp.mesa(p_dono text, p_intervalo text default '1h') returns uuid language sql as $$
  insert into public.bancada_estrategia (dono, chain, nome, praca, papel, papel_adiante, simbolos, intervalo)
  values (p_dono, 'evm', 't23', 'spot_gate', 'taker', true, array['BTC','ETH'], p_intervalo) returning id
$$;

create function pg_temp.abrir(p_dono text, p_id uuid, p_simbolo text, p_vela bigint, p_intervalo text default '1h')
returns jsonb language sql as $$
  select public.bancada_abrir_posicao_papel(p_dono, p_id, p_simbolo, 'long', 100, 1000, 3, 2,
    now() + interval '72 hours', p_vela, p_intervalo, null, 72)
$$;

-- ── LEASE ─────────────────────────────────────────────────────────────
do $$
declare r jsonb; b boolean;
begin
  r := public.bancada_tique_arrendar('bancada_tique', 'passagem-A-0001', 60000);
  assert (r->>'ok')::boolean, 'T23.01 lease livre é tomado: ' || r;
  r := public.bancada_tique_arrendar('bancada_tique', 'passagem-B-0002', 60000);
  assert not (r->>'ok')::boolean and r->>'motivo' = 'ocupado', 'T23.02 lease válido recusa o segundo: ' || r;
  r := public.bancada_tique_arrendar('bancada_tique', 'passagem-A-0001', 60000);
  assert not (r->>'ok')::boolean, 'T23.03 nem o mesmo dono re-toma um lease válido (cada passagem tem token novo)';
  b := public.bancada_tique_liberar('bancada_tique', 'passagem-B-0002');
  assert not b, 'T23.04 quem NÃO é dono não libera';
  r := public.bancada_tique_arrendar('bancada_tique', 'passagem-C-0003', 60000);
  assert not (r->>'ok')::boolean, 'T23.04b continua ocupado depois da liberação recusada';
  b := public.bancada_tique_liberar('bancada_tique', 'passagem-A-0001');
  assert b, 'T23.05 o dono libera';
  r := public.bancada_tique_arrendar('bancada_tique', 'passagem-C-0003', 60000);
  assert (r->>'ok')::boolean, 'T23.06 liberado → o próximo toma: ' || r;
  -- crash: o lease venceu sem ninguém liberar → o próximo toma
  update public.bancada_arrendamento set ate = now() - interval '1 second' where escopo = 'bancada_tique';
  r := public.bancada_tique_arrendar('bancada_tique', 'passagem-D-0004', 60000);
  assert (r->>'ok')::boolean, 'T23.07 lease vencido (crash) é retomado: ' || r;
  b := public.bancada_tique_liberar('bancada_tique', 'passagem-C-0003');
  assert not b, 'T23.08 a passagem atrasada (C) NÃO solta o lease de quem a substituiu (D)';
  -- escopos independentes
  r := public.bancada_tique_arrendar('outro_escopo', 'passagem-E-0005', 60000);
  assert (r->>'ok')::boolean, 'T23.09 escopo diferente não espera';
  -- entradas inválidas viram erro, nunca lease
  begin perform public.bancada_tique_arrendar('bancada_tique', 'x', 60000); assert false, 'T23.10 dono curto deveria falhar';
  exception when sqlstate '22023' then null; end;
  begin perform public.bancada_tique_arrendar('bancada_tique', 'passagem-F-0006', 0); assert false, 'T23.11 ttl 0 deveria falhar';
  exception when sqlstate '22023' then null; end;
  begin perform public.bancada_tique_arrendar('Bancada Tique!', 'passagem-F-0006', 60000); assert false, 'T23.12 escopo inválido';
  exception when sqlstate '22023' then null; end;
end $$;

-- ── ABERTURA IDEMPOTENTE + ESTADO DO SINAL ─────────────────────────────
do $$
declare m uuid; m2 uuid; r jsonb; n bigint; uv bigint; primeiro uuid;
  H constant bigint := 3600000; V constant bigint := 1700000000000 - (1700000000000 % 3600000);
begin
  m := pg_temp.mesa('0xdono1');
  r := pg_temp.abrir('0xdono1', m, 'BTC', V);
  assert (r->>'ok')::boolean and (r->>'criada')::boolean, 'T23.20 primeira abertura cria: ' || r;
  primeiro := (r->>'id')::uuid;
  select ultima_vela_aberta into uv from public.bancada_estrategia where id = m;
  assert uv = V, 'T23.21 ultima_vela_aberta avança para a vela aberta';
  select count(*) into n from public.bancada_posicao where id = primeiro and chave_entrada = 'v1:' || m || ':1h:' || V;
  assert n = 1, 'T23.22 chave canônica gravada';

  -- replay / retry / segundo worker da MESMA oportunidade
  r := pg_temp.abrir('0xdono1', m, 'BTC', V);
  assert (r->>'ok')::boolean and not (r->>'criada')::boolean and r->>'motivo' = 'ja_registrada'
     and (r->>'id')::uuid = primeiro, 'T23.23 replay = sucesso idempotente com o MESMO id: ' || r;
  -- mesma vela, OUTRO símbolo da mesma mesa: a mesa já usou esta vela
  r := pg_temp.abrir('0xdono1', m, 'ETH', V);
  assert (r->>'ok')::boolean and not (r->>'criada')::boolean, 'T23.24 mesma vela, outro símbolo → já registrada: ' || r;
  select count(*) into n from public.bancada_posicao where estrategia_id = m;
  assert n = 1, 'T23.25 continua UMA posição (achou ' || n || ')';

  -- vela seguinte com posição aberta: recusa (uma posição por mesa)
  r := pg_temp.abrir('0xdono1', m, 'BTC', V + H);
  assert not (r->>'ok')::boolean and r->>'motivo' = 'ja_tem_posicao', 'T23.26 vela seguinte com posição aberta recusa: ' || r;

  -- ⚠️ O ACHADO RM-03: a posição FECHA e a mesma vela volta no próximo tique
  update public.bancada_posicao set status = 'ganhou', saida = 103, resultado_pct = 2.6, fechada_em = now() where id = primeiro;
  r := pg_temp.abrir('0xdono1', m, 'ETH', V);
  assert (r->>'ok')::boolean and not (r->>'criada')::boolean, 'T23.27 mesma vela depois do fechamento NÃO reabre: ' || r;
  -- vela anterior (atraso de execução / relógio velho): recusa
  r := pg_temp.abrir('0xdono1', m, 'BTC', V - H);
  assert not (r->>'ok')::boolean and r->>'motivo' = 'vela_ja_avaliada', 'T23.28 vela anterior recusa: ' || r;
  select count(*) into n from public.bancada_posicao where estrategia_id = m;
  assert n = 1, 'T23.29 nada novo depois do fechamento na mesma vela';

  -- vela seguinte, sem posição aberta: abre
  r := pg_temp.abrir('0xdono1', m, 'BTC', V + H);
  assert (r->>'ok')::boolean and (r->>'criada')::boolean, 'T23.30 vela seguinte abre: ' || r;
  select ultima_vela_aberta into uv from public.bancada_estrategia where id = m;
  assert uv = V + H, 'T23.31 ultima_vela_aberta avança de novo';

  -- estratégia DIFERENTE, mesma vela: permitida
  m2 := pg_temp.mesa('0xdono1');
  r := pg_temp.abrir('0xdono1', m2, 'BTC', V);
  assert (r->>'ok')::boolean and (r->>'criada')::boolean, 'T23.32 outra estratégia na mesma vela abre: ' || r;

  -- dono errado: recusa sem inserir
  r := pg_temp.abrir('0xintruso', m2, 'BTC', V + 2 * H);
  assert not (r->>'ok')::boolean and r->>'motivo' = 'dono_divergente', 'T23.33 dono divergente recusa: ' || r;
  r := pg_temp.abrir('0xdono1', gen_random_uuid(), 'BTC', V);
  assert not (r->>'ok')::boolean and r->>'motivo' = 'sem_estrategia', 'T23.34 estratégia inexistente recusa: ' || r;

  -- identidade incompleta: erro, nunca posição sem chave
  begin perform pg_temp.abrir('0xdono1', m2, 'BTC', null); assert false, 'T23.35 vela nula deveria falhar';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.abrir('0xdono1', m2, 'BTC', V, 'qualquer'); assert false, 'T23.36 intervalo inválido';
  exception when sqlstate '22023' then null; end;

  -- UNIQUE é a última palavra mesmo por fora da RPC
  begin
    insert into public.bancada_posicao (dono, estrategia_id, simbolo, lado, entrada, tamanho_usd, chave_entrada)
    values ('0xdono1', m, 'BTC', 'long', 1, 1, 'v1:' || m || ':1h:' || V);
    assert false, 'T23.37 a UNIQUE parcial deveria barrar a chave repetida';
  exception when unique_violation then null; end;
  -- linhas legadas (chave NULL) continuam aceitas — a UNIQUE é parcial
  insert into public.bancada_posicao (dono, estrategia_id, simbolo, lado, entrada, tamanho_usd, status)
  values ('0xdono1', m2, 'BTC', 'long', 1, 1, 'expirada'), ('0xdono1', m2, 'BTC', 'long', 1, 1, 'expirada');
end $$;

-- ── O backfill da migration: o maior vela_em histórico (aberto OU fechado) ─
do $$
declare m uuid; uv bigint;
begin
  m := pg_temp.mesa('0xlegado');
  insert into public.bancada_posicao (dono, estrategia_id, simbolo, lado, entrada, tamanho_usd, status, vela_em)
  values ('0xlegado', m, 'BTC', 'long', 1, 1, 'ganhou', 5000), ('0xlegado', m, 'BTC', 'long', 1, 1, 'perdeu', 9000);
  -- o mesmo UPDATE da 0076, reexecutado
  update public.bancada_estrategia e set ultima_vela_aberta = x.mx
    from (select estrategia_id, max(vela_em) mx from public.bancada_posicao where vela_em is not null group by 1) x
   where e.id = x.estrategia_id and (e.ultima_vela_aberta is null or e.ultima_vela_aberta < x.mx);
  select ultima_vela_aberta into uv from public.bancada_estrategia where id = m;
  assert uv = 9000, 'T23.40 backfill usa o maior vela_em, inclusive de posição FECHADA (achou ' || uv || ')';
  assert (pg_temp.abrir('0xlegado', m, 'BTC', 9000)->>'motivo') = 'vela_ja_avaliada', 'T23.41 vela legada não reabre';
end $$;

-- ── ACL: as três nascem fechadas ───────────────────────────────────────
do $$
declare f text; ok_anon boolean; ok_auth boolean; ok_srv boolean; sd boolean; sp text[];
begin
  foreach f in array array['bancada_tique_arrendar', 'bancada_tique_liberar', 'bancada_abrir_posicao_papel'] loop
    select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
           has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef, p.proconfig
      into ok_anon, ok_auth, ok_srv, sd, sp
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f;
    assert not ok_anon and not ok_auth, 'T23.50 ' || f || ': anon/authenticated NÃO executam';
    assert ok_srv, 'T23.51 ' || f || ': service_role executa';
    -- 0081 (R4/M4): `public, pg_temp` — temporário buscado por ÚLTIMO, não primeiro.
    assert sd and sp @> array['search_path=public, pg_temp'], 'T23.52 ' || f || ': definer + search_path fixo (pg_temp por último)';
  end loop;
  assert (select relrowsecurity from pg_class where oid = 'public.bancada_arrendamento'::regclass), 'T23.53 RLS ligada';
  assert not has_table_privilege('anon', 'public.bancada_arrendamento', 'select')
      or not exists (select 1 from pg_policies where tablename = 'bancada_arrendamento'), 'T23.54 sem policy pública';
end $$;

rollback;
\echo 'T23 PASS'
