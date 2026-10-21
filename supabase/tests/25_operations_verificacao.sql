-- ═══════════════════════════════════════════════════════════════════════════
-- 25 — W3-D: colunas de verificação em `operations` (migration 0078).
-- ⚠️ SÓ EM BANCO DESCARTÁVEL. Roda numa transação e desfaz tudo. Esperado: 'T25 PASS'.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;
do $$
declare v text; n int;
begin
  insert into public.operations (kind, status, ref) values ('dex_swap', 'confirmed', 't25-legado');
  select verificacao into v from public.operations where ref = 't25-legado';
  assert v = 'declarada', 'T25.01 registro sem assinatura nasce DECLARADO: ' || v;

  begin
    insert into public.operations (kind, status, ref, verificacao) values ('dex_swap','confirmed','t25-falsa','verificada_onchain');
    assert false, 'T25.02 verificada sem medição deveria ser recusada';
  exception when check_violation then null; end;

  begin
    insert into public.operations (kind, status, ref, verificacao) values ('dex_swap','confirmed','t25-x','confirmada');
    assert false, 'T25.03 valor fora do vocabulário deveria ser recusado';
  exception when check_violation then null; end;

  begin
    insert into public.operations (kind, status, ref, tx_signature, pagador_onchain, taxa_onchain_raw, verificada_em, verificacao)
    values ('dex_swap','confirmed','t25-neg', repeat('S',88), 'p', -1, now(), 'verificada_onchain');
    assert false, 'T25.04 taxa medida negativa deveria ser recusada';
  exception when check_violation then null; end;

  insert into public.operations (kind, status, ref, tx_signature, pagador_onchain, taxa_onchain_raw, taxa_onchain_mint, verificada_em, verificacao)
  values ('dex_swap','confirmed','t25-ok', repeat('S',88), 'H7zw', 11000, 'EPjF', now(), 'verificada_onchain');
  select count(*) into n from public.operations where verificacao = 'verificada_onchain' and ref = 't25-ok';
  assert n = 1, 'T25.05 verificada com medição é aceita';
end $$;
do $$
begin
  assert not has_table_privilege('anon', 'public.operations', 'select'), 'T25.10 anon não lê operations';
  assert not has_table_privilege('anon', 'public.operations', 'truncate'), 'T25.11 anon não trunca operations (RLS não cobre TRUNCATE)';
  assert not has_table_privilege('authenticated', 'public.operations', 'truncate'), 'T25.12 authenticated não trunca operations';
  assert not has_table_privilege('authenticated', 'public.operations', 'insert'), 'T25.13 authenticated não insere em operations';
  assert has_table_privilege('service_role', 'public.operations', 'insert') and has_table_privilege('service_role', 'public.operations', 'update'),
    'T25.14 service_role continua escrevendo';
end $$;
rollback;
\echo 'T25 PASS'
