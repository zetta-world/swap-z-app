-- ═══════════════════════════════════════════════════════════════════════════
-- 20 — COTA DA BANCADA: reserva atômica contada no banco (migration 0073, CE-04/CE-05)
--
-- ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0073). NUNCA contra produção.
-- Roda numa transação e desfaz tudo no fim (ROLLBACK). A concorrência entre
-- sessões (que uma transação só não prova) está em 20b_bancada_reserva_concorrencia.sh.
--
-- Uso: psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f 20_bancada_reserva_atomica.sql
-- Esperado: termina com 'T20 PASS'. Qualquer ASSERT falho aborta com a mensagem do caso.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;

-- Helper: reserva com os parâmetros mínimos. Janela de 24h.
create function pg_temp.reservar(p_dono text, p_limite int, p_orc bigint, p_unid bigint default 1, p_velas int default 1)
returns jsonb language sql as $$
  select public.bancada_reservar_rodada(
    p_dono, 'evm', null, 'propria', 100, array['BTC'], '1d',
    1000, 2000, 'spot_gate', 'taker', '{}'::jsonb, p_velas, p_unid,
    p_limite, p_orc, 86400000)
$$;

-- Helper: semeia N rodadas de um dono com criada_em controlada (direto na tabela, como superusuário).
create function pg_temp.semear(p_dono text, p_n int, p_idade interval, p_status text default 'concluida', p_velas int default 1)
returns void language sql as $$
  insert into public.bancada_rodada (dono, chain, capital_usd, simbolos, intervalo, janela_de, janela_ate,
                                     praca, papel, custo_velas, status, criada_em)
  select p_dono, 'evm', 100, array['BTC'], '1d', 1000, 2000, 'spot_gate', 'taker', p_velas, p_status, now() - p_idade
    from generate_series(1, p_n)
$$;

do $$
declare r jsonb; n bigint;
begin
  -- ── 0 usadas: a primeira passa e devolve id ─────────────────────────
  r := pg_temp.reservar('d0', 10, 1000000);
  assert (r->>'ok')::boolean, 'T20.01 0 usadas deveria passar: ' || r;
  assert (r->>'id') is not null, 'T20.01 sem id';
  assert (r->>'rodadas')::int = 1, 'T20.01 rodadas deveria ser 1: ' || r;
  select count(*) into n from public.bancada_rodada where id = (r->>'id')::uuid and status = 'rodando' and dono = 'd0';
  assert n = 1, 'T20.01 a linha reservada não existe como rodando';

  -- ── limite − 1, limite, limite + 1 (limite 10) ─────────────────────
  perform pg_temp.semear('d1', 8, interval '1 hour');                 -- 8 usadas
  r := pg_temp.reservar('d1', 10, 1000000);                           -- 9ª (limite−1 → passa)
  assert (r->>'ok')::boolean and (r->>'rodadas')::int = 9, 'T20.02 limite−1 deveria passar: ' || r;
  r := pg_temp.reservar('d1', 10, 1000000);                           -- 10ª (= limite → passa, usa a última)
  assert (r->>'ok')::boolean and (r->>'rodadas')::int = 10, 'T20.03 a reserva que ATINGE o limite passa: ' || r;
  r := pg_temp.reservar('d1', 10, 1000000);                           -- 11ª (limite+1 → recusa)
  assert not (r->>'ok')::boolean and r->>'motivo' = 'cota_esgotada', 'T20.04 limite+1 deveria recusar: ' || r;
  select count(*) into n from public.bancada_rodada where dono = 'd1';
  assert n = 10, 'T20.04 recusa NÃO pode inserir linha (achou ' || n || ')';

  -- ── limite 1 e limite 0 ─────────────────────────────────────────────
  r := pg_temp.reservar('d2', 1, 1000000);
  assert (r->>'ok')::boolean, 'T20.05 limite 1, primeira passa';
  r := pg_temp.reservar('d2', 1, 1000000);
  assert not (r->>'ok')::boolean, 'T20.05 limite 1, segunda recusa';
  r := pg_temp.reservar('d3', 0, 1000000);
  assert not (r->>'ok')::boolean, 'T20.06 limite 0 recusa sempre';

  -- ── 1.000 e 5.000: ACIMA do max_rows do PostgREST (o defeito que esta migration fecha) ──
  perform pg_temp.semear('d4', 999, interval '2 hours');
  r := pg_temp.reservar('d4', 1000, 100000000);
  assert (r->>'ok')::boolean and (r->>'rodadas')::int = 1000, 'T20.07 a 1.000ª passa: ' || r;
  r := pg_temp.reservar('d4', 1000, 100000000);
  assert not (r->>'ok')::boolean and (r->>'rodadas')::int = 1000, 'T20.08 a 1.001ª recusa com 1000 contadas: ' || r;

  perform pg_temp.semear('d5', 4999, interval '3 hours');
  r := pg_temp.reservar('d5', 5000, 100000000);
  assert (r->>'ok')::boolean and (r->>'rodadas')::int = 5000, 'T20.09 Pilot: a 5.000ª passa: ' || r;
  r := pg_temp.reservar('d5', 5000, 100000000);
  assert not (r->>'ok')::boolean and (r->>'rodadas')::int = 5000,
    'T20.10 Pilot: a 5.001ª RECUSA — com contagem no app (max_rows 1000) ela passaria: ' || r;

  -- ── 'recusada' não consome cota ─────────────────────────────────────
  perform pg_temp.semear('d6', 50, interval '1 hour', 'recusada');
  r := pg_temp.reservar('d6', 1, 1000000);
  assert (r->>'ok')::boolean and (r->>'rodadas')::int = 1, 'T20.11 recusadas não contam: ' || r;

  -- ── 'falhou' e 'rodando' contam (igual ao caminho antigo) ───────────
  perform pg_temp.semear('d7', 1, interval '1 hour', 'falhou');
  perform pg_temp.semear('d7', 1, interval '1 hour', 'rodando');
  r := pg_temp.reservar('d7', 2, 1000000);
  assert not (r->>'ok')::boolean and (r->>'rodadas')::int = 2, 'T20.12 falhou e rodando contam: ' || r;

  -- ── borda da janela: exatamente 24h atrás ENTRA, 24h + 1ms SAI ──────
  perform pg_temp.semear('d8', 1, interval '24 hours');
  perform pg_temp.semear('d8', 1, interval '24 hours 1 millisecond');
  perform pg_temp.semear('d8', 1, interval '30 days');
  r := pg_temp.reservar('d8', 100, 1000000);
  assert (r->>'rodadas')::int = 2, 'T20.13 só a de exatamente 24h conta junto com a nova: ' || r;

  -- ── janela expirando libera: 10 antigas (25h) não contam ────────────
  perform pg_temp.semear('d9', 10, interval '25 hours');
  r := pg_temp.reservar('d9', 1, 1000000);
  assert (r->>'ok')::boolean, 'T20.14 rodadas fora da janela não contam: ' || r;

  -- ── isolamento por dono ─────────────────────────────────────────────
  r := pg_temp.reservar('d1-outro', 10, 1000000);
  assert (r->>'ok')::boolean and (r->>'rodadas')::int = 1, 'T20.15 outro dono não herda consumo: ' || r;

  -- ── orçamento de unidades (CE-05) ───────────────────────────────────
  r := pg_temp.reservar('u1', 100, 1000, 600);
  assert (r->>'ok')::boolean and (r->>'unidades')::bigint = 600, 'T20.16 cabe no orçamento: ' || r;
  r := pg_temp.reservar('u1', 100, 1000, 400);
  assert (r->>'ok')::boolean and (r->>'unidades')::bigint = 1000, 'T20.17 exatamente o orçamento passa: ' || r;
  r := pg_temp.reservar('u1', 100, 1000, 1);
  assert not (r->>'ok')::boolean and r->>'motivo' = 'orcamento_esgotado', 'T20.18 +1 unidade recusa: ' || r;
  -- linhas antigas (custo_unidades 0) contam pelo custo_velas — transição sem buraco
  perform pg_temp.semear('u2', 3, interval '1 hour', 'concluida', 300);
  r := pg_temp.reservar('u2', 100, 1000, 101);
  assert not (r->>'ok')::boolean and (r->>'unidades')::bigint = 900, 'T20.19 legado conta por custo_velas: ' || r;
  r := pg_temp.reservar('u2', 100, 1000, 100);
  assert (r->>'ok')::boolean, 'T20.20 legado + 100 = 1000 passa: ' || r;

  -- ── entradas inválidas são ERRO, nunca cota livre ───────────────────
  begin
    perform public.bancada_reservar_rodada(null, 'evm', null, 'propria', 100, array['BTC'], '1d',
      1000, 2000, 'spot_gate', 'taker', '{}', 1, 1, 10, 10, 86400000);
    assert false, 'T20.21 dono nulo deveria lançar';
  exception when sqlstate '22023' then null; end;
  begin
    perform pg_temp.reservar('x', -1, 10);
    assert false, 'T20.22 limite negativo deveria lançar';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.bancada_reservar_rodada('x', 'evm', null, 'propria', 100, array['BTC'], '1d',
      1000, 2000, 'spot_gate', 'taker', '{}', 1, -5, 10, 10, 86400000);
    assert false, 'T20.23 unidades negativas deveriam lançar';
  exception when sqlstate '22023' then null; end;
  -- as constraints da tabela continuam valendo dentro da função (praça inválida)
  begin
    perform public.bancada_reservar_rodada('x', 'evm', null, 'propria', 100, array['BTC'], '1d',
      1000, 2000, 'lua', 'taker', '{}', 1, 1, 10, 10, 86400000);
    assert false, 'T20.24 praça inválida deveria violar o check';
  exception when check_violation then null; end;
end $$;

-- ── ACL: anon e authenticated NÃO executam; service_role executa ──────
do $$
declare ok_anon boolean; ok_auth boolean; ok_srv boolean; sd boolean; sp text[];
begin
  select has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'),
         p.prosecdef, p.proconfig
    into ok_anon, ok_auth, ok_srv, sd, sp
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bancada_reservar_rodada';
  assert not ok_anon, 'T20.25 anon NÃO pode executar';
  assert not ok_auth, 'T20.26 authenticated NÃO pode executar';
  assert ok_srv, 'T20.27 service_role executa';
  assert sd, 'T20.28 security definer';
  -- 0081 (R4/M4): `public, pg_temp` — temporário buscado por ÚLTIMO, não primeiro.
  assert sp @> array['search_path=public, pg_temp'], 'T20.29 search_path fixo (com pg_temp por último)';
  assert (select count(*) from pg_proc where proname = 'bancada_reservar_rodada') = 1, 'T20.30 sem overload';
end $$;

-- ── o plano usa o índice (dono, criada_em) — sem varrer a tabela ──────
do $$
declare plano text := ''; linha text;
begin
  set local enable_seqscan = off;  -- força o planner a revelar se HÁ índice utilizável
  for linha in execute 'explain select count(*) from public.bancada_rodada where dono = ''d5'' and criada_em >= now() - interval ''24 hours'' and status <> ''recusada''' loop
    plano := plano || linha || E'\n';
  end loop;
  assert plano ilike '%bancada_rodada%idx%', 'T20.31 contagem deveria usar índice: ' || plano;
end $$;

rollback;
\echo 'T20 PASS'
