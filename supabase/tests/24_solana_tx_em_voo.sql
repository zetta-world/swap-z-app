-- ═══════════════════════════════════════════════════════════════════════════
-- 24 — W3-C: trava durável por carteira (migration 0077).
-- ⚠️ SÓ EM BANCO DESCARTÁVEL (cadeia 0001→0077+). NUNCA contra produção. Roda numa transação e desfaz tudo.
-- A concorrência entre sessões está em 24b_solana_tx_em_voo_concorrencia.sh.
-- Esperado: termina com 'T24 PASS'.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
begin;
do $$
declare
  c  text := 'H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T';
  c2 text := '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  a  text := repeat('A', 88);  b text := repeat('B', 88);  x text := repeat('X', 88);
  h  text := repeat('f', 64);  bh text := '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';
  r jsonb; ok boolean; n int;
begin
  r := public.solana_tx_reservar(c, a, h, bh, 1000);
  assert r->>'resultado' = 'reservada', 'T24.01 primeira reserva: ' || r;
  r := public.solana_tx_reservar(c, a, h, bh, 1000);
  assert r->>'resultado' = 'retransmissao', 'T24.02 mesma assinatura = retransmissão: ' || r;
  r := public.solana_tx_reservar(c, b, h, bh, 2000);
  assert r->>'resultado' = 'bloqueada' and r->>'assinatura' = a and (r->>'valido_ate_bloco')::bigint = 1000,
    'T24.03 outra assinatura da MESMA carteira é bloqueada, com a altura GRAVADA: ' || r;
  r := public.solana_tx_reservar(c2, x, h, bh, 1000);
  assert r->>'resultado' = 'reservada', 'T24.04 outra carteira não é afetada: ' || r;

  ok := public.solana_tx_marcar(a, 'incerta', null, 'timeout');
  assert ok, 'T24.05 em aberto → incerta';
  r := public.solana_tx_reservar(c, b, h, bh, 2000);
  assert r->>'resultado' = 'bloqueada', 'T24.06 incerta continua bloqueando (sem TTL): ' || r;

  -- ⚠️ sem TTL: nem uma linha "velha" libera sozinha
  update public.solana_tx_em_voo set criada_em = now() - interval '30 days', atualizada_em = now() - interval '30 days' where assinatura = a;
  r := public.solana_tx_reservar(c, b, h, bh, 2000);
  assert r->>'resultado' = 'bloqueada', 'T24.07 tempo decorrido NÃO libera: ' || r;

  ok := public.solana_tx_marcar(a, 'resolvida', 'expirada', null);
  assert ok, 'T24.08 resolvida por fato';
  r := public.solana_tx_reservar(c, b, h, bh, 2000);
  assert r->>'resultado' = 'reservada', 'T24.09 depois do fato, a nova reserva: ' || r;
  r := public.solana_tx_reservar(c, a, h, bh, 1000);
  assert r->>'resultado' = 'ja_resolvida' and r->>'desfecho' = 'expirada', 'T24.10 assinatura já resolvida não volta: ' || r;

  ok := public.solana_tx_marcar(a, 'enviada', null, null);
  assert not ok, 'T24.11 resolvida é FINAL (marcar não reabre)';

  ok := public.solana_tx_marcar(b, 'resolvida', 'nao_enviada', 'preflight');
  r := public.solana_tx_reservar(c, b, h, bh, 2000);
  assert r->>'resultado' = 'reservada', 'T24.12 recusada antes da rede pode tentar de novo: ' || r;

  select count(*) into n from public.solana_tx_em_voo where carteira = c and estado <> 'resolvida';
  assert n = 1, 'T24.13 no máximo UMA em aberto por carteira: ' || n;

  begin
    insert into public.solana_tx_em_voo (carteira, assinatura, hash_mensagem, blockhash, valido_ate_bloco, estado)
    values (c, repeat('Z', 88), h, bh, 5, 'reservada');
    assert false, 'T24.14 índice único deveria recusar segunda em aberto';
  exception when unique_violation then null; end;

  begin
    perform public.solana_tx_reservar(c2, b, h, bh, 1);
    assert false, 'T24.15 assinatura de outra carteira deveria ser recusada';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.solana_tx_reservar('curta', repeat('Q', 88), h, bh, 1);
    assert false, 'T24.16 parâmetros inválidos deveriam ser recusados';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.solana_tx_marcar(b, 'resolvida', null, null);
    assert false, 'T24.17 resolvida sem desfecho deveria ser recusada';
  exception when sqlstate '22023' then null; end;
end $$;

-- ACL
do $$
begin
  assert not has_function_privilege('anon', 'public.solana_tx_reservar(text,text,text,text,bigint)', 'execute'), 'T24.20 anon não executa reservar';
  assert not has_function_privilege('authenticated', 'public.solana_tx_reservar(text,text,text,text,bigint)', 'execute'), 'T24.21 authenticated não executa reservar';
  assert not has_function_privilege('anon', 'public.solana_tx_marcar(text,text,text,text)', 'execute'), 'T24.22 anon não executa marcar';
  assert has_function_privilege('service_role', 'public.solana_tx_reservar(text,text,text,text,bigint)', 'execute'), 'T24.23 service_role executa';
  assert not has_table_privilege('anon', 'public.solana_tx_em_voo', 'select'), 'T24.24 anon não lê a tabela';
  assert not has_table_privilege('authenticated', 'public.solana_tx_em_voo', 'insert'), 'T24.25 authenticated não escreve';
  assert (select relrowsecurity from pg_class where oid = 'public.solana_tx_em_voo'::regclass), 'T24.26 RLS habilitada';
  assert (select count(*) from pg_policies where tablename = 'solana_tx_em_voo') = 0, 'T24.27 zero policies (default-deny)';
  assert (select bool_and(p.prosecdef and p.proconfig::text like '%search_path=public, pg_temp%')
            from pg_proc p where p.proname in ('solana_tx_reservar','solana_tx_marcar')), 'T24.28 security definer com search_path fixo';
end $$;
rollback;
\echo 'T24 PASS'
