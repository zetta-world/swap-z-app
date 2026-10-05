-- ═══════════════════════════════════════════════════════════════════════════
-- 22 — RODADA DA BANCADA: métricas de custo (migration 0075, CE-14)
-- ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0075). Transação desfeita no fim. Esperado: 'T22 PASS'.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;
do $$
declare r uuid; v record;
begin
  insert into public.bancada_rodada (dono, chain, capital_usd, simbolos, intervalo, janela_de, janela_ate, praca, papel)
  values ('0xT22', 'evm', 100, array['BTC'], '1d', 1, 2, 'spot_gate', 'taker') returning id into r;
  select duracao_ms, velas_da_fonte, velas_do_cache into v from public.bancada_rodada where id = r;
  assert v.duracao_ms is null and v.velas_da_fonte is null and v.velas_do_cache is null,
    'T22.01 rodada sem medição fica NULL, nunca 0';
  update public.bancada_rodada set duracao_ms = 1234, velas_da_fonte = 0, velas_do_cache = 8761 where id = r;
  select duracao_ms, velas_da_fonte, velas_do_cache into v from public.bancada_rodada where id = r;
  assert v.duracao_ms = 1234 and v.velas_da_fonte = 0 and v.velas_do_cache = 8761, 'T22.02 grava as três';
  begin
    update public.bancada_rodada set velas_da_fonte = -1 where id = r;
    assert false, 'T22.03 negativo deveria violar o check';
  exception when check_violation then null; end;
end $$;
rollback;
\echo 'T22 PASS'
