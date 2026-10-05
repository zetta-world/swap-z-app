-- ═══════════════════════════════════════════════════════════════════════════
-- 21 — TIQUE DA BANCADA: último tique em lote (migration 0074, CE-09/CE-12)
-- ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0074). Transação desfeita no fim. Esperado: 'T21 PASS'.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;

do $$
declare a uuid; b uuid; c uuid; n int; v jsonb;
begin
  insert into public.bancada_estrategia (dono, chain, nome, params, praca, papel)
  values ('0xT21A', 'evm', 'a', '{}', 'spot_gate', 'taker') returning id into a;
  insert into public.bancada_estrategia (dono, chain, nome, params, praca, papel, ultimo_tique)
  values ('0xT21A', 'evm', 'b', '{}', 'spot_gate', 'taker', '{"em": 1, "adiadaEm": 5}') returning id into b;
  insert into public.bancada_estrategia (dono, chain, nome, params, praca, papel)
  values ('0xT21B', 'evm', 'c', '{}', 'spot_gate', 'taker') returning id into c;

  -- lote com: duas do dono certo, uma com dono TROCADO (não pode escrever)
  n := public.bancada_gravar_ultimos_tiques(jsonb_build_array(
    jsonb_build_object('id', a, 'dono', '0xT21A', 'em', 1000, 'simbolos', '{"BTC": {"preco": 1}}'::jsonb),
    jsonb_build_object('id', b, 'dono', '0xT21A', 'em', 1000, 'simbolos', '{}'::jsonb),
    jsonb_build_object('id', c, 'dono', '0xT21A', 'em', 1000, 'simbolos', '{}'::jsonb)
  ));
  assert n = 2, 'T21.01 só as duas do dono certo: ' || n;

  select ultimo_tique into v from public.bancada_estrategia where id = a;
  assert v = '{"em": 1000, "simbolos": {"BTC": {"preco": 1}}}'::jsonb, 'T21.02 formato {em, simbolos}: ' || v;
  select ultimo_tique into v from public.bancada_estrategia where id = b;
  assert v = '{"em": 1000, "simbolos": {}}'::jsonb, 'T21.03 avaliação substitui a marca de adiada (igual ao PATCH): ' || v;
  select ultimo_tique into v from public.bancada_estrategia where id = c;
  assert v is null, 'T21.04 dono trocado NÃO escreve';

  -- lote vazio e item sem dono
  assert public.bancada_gravar_ultimos_tiques('[]'::jsonb) = 0, 'T21.05 lote vazio';
  assert public.bancada_gravar_ultimos_tiques(jsonb_build_array(jsonb_build_object('id', c, 'em', 2))) = 0,
    'T21.06 sem dono não escreve';
  begin
    perform public.bancada_gravar_ultimos_tiques('{"id": 1}'::jsonb);
    assert false, 'T21.07 não-array deveria lançar';
  exception when sqlstate '22023' then null; end;
end $$;

do $$
begin
  assert not has_function_privilege('anon', 'public.bancada_gravar_ultimos_tiques(jsonb)', 'execute'), 'T21.08 anon';
  assert not has_function_privilege('authenticated', 'public.bancada_gravar_ultimos_tiques(jsonb)', 'execute'), 'T21.09 authenticated';
  assert has_function_privilege('service_role', 'public.bancada_gravar_ultimos_tiques(jsonb)', 'execute'), 'T21.10 service_role';
end $$;

rollback;
\echo 'T21 PASS'
