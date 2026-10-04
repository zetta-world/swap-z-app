-- Fase A — exportação SÓ LEITURA (rodada por scripts/strategy/exportar.mjs dentro de
-- BEGIN TRANSACTION READ ONLY … ROLLBACK). Um único SELECT que devolve um objeto JSON.
-- Só colunas necessárias à reconciliação; nenhuma coluna de identidade de usuário.
with
pa as (select coalesce(json_agg(json_build_object(
  'id', id, 'source', source, 'starting_usd', starting_usd, 'cash_usd', cash_usd, 'realized_pnl_usd', realized_pnl_usd,
  'wins', wins, 'losses', losses, 'created_at', created_at, 'updated_at', updated_at) order by source), '[]'::json) j from paper_accounts),
pp as (select coalesce(json_agg(json_build_object(
  'id', id, 'account_id', account_id, 'suggestion_id', suggestion_id, 'source', source, 'symbol', symbol, 'side', side,
  'cost_usd', cost_usd, 'status', status, 'exit_reason', exit_reason, 'pnl_usd', pnl_usd, 'opened_at', opened_at,
  'closed_at', closed_at, 'archived_at', archived_at) order by id), '[]'::json) j from paper_positions),
zs as (select coalesce(json_agg(json_build_object(
  'id', id, 'source', source, 'symbol', symbol, 'side', side, 'status', status, 'created_at', created_at,
  'resolved_at', resolved_at, 'archived_at', archived_at) order by id), '[]'::json) j from zion_suggestions),
cp as (select coalesce(json_agg(json_build_object(
  'id', id, 'agente', agente, 'lado', lado, 'usd', usd, 'preco_entrada', preco_entrada, 'preco_saida', preco_saida,
  'motivo_saida', motivo_saida, 'aberta_em', aberta_em, 'fechada_em', fechada_em, 'genoma_versao', genoma_versao,
  'meta', json_build_object('alavanca', meta->'alavanca')) order by id), '[]'::json) j from celeiro_posicoes),
cf as (select coalesce(json_agg(json_build_object(
  'id', id, 'agente', agente, 'causa', causa, 'usdt', usdt, 'ref', ref, 'ocorreu_em', ocorreu_em,
  'genoma_versao', genoma_versao) order by id), '[]'::json) j from celeiro_fluxos),
cg as (select coalesce(json_agg(json_build_object(
  'agente', agente, 'versao', versao, 'ativo', ativo, 'criado_em', criado_em) order by agente, versao), '[]'::json) j from celeiro_genoma),
br as (select coalesce(json_agg(json_build_object(
  'id', id, 'origem', origem, 'estrategia_id', estrategia_id, 'status', status, 'criada_em', criada_em,
  'terminada_em', terminada_em) order by id), '[]'::json) j from bancada_rodada),
bo as (select coalesce(json_agg(json_build_object(
  'id', id, 'rodada_id', rodada_id, 'desfecho', desfecho, 'liquido_pct', liquido_pct) order by id), '[]'::json) j from bancada_operacao),
bres as (select coalesce(json_agg(json_build_object(
  'rodada_id', rodada_id, 'n', n, 'acertos', acertos, 'liquido_pct', liquido_pct) order by rodada_id), '[]'::json) j from bancada_resultado),
lr as (select coalesce(json_agg(json_build_object(
  'id', id, 'strategy_id', strategy_id, 'status', status, 'started_at', started_at, 'finished_at', finished_at) order by id), '[]'::json) j from lab_runs),
lres as (select coalesce(json_agg(json_build_object(
  'id', id, 'run_id', run_id, 'net_pct', net_pct, 'gross_pct', gross_pct, 'cost_pct', cost_pct, 'trades', trades,
  'sample_n', sample_n) order by id), '[]'::json) j from lab_results),
mk as (select json_build_array(
  (select json_build_object('tabela', 'mercado_vela', 'linhas', count(*), 'chaves', count(distinct (simbolo, intervalo)),
     'de', to_timestamp(min(abriu_em) / 1000.0), 'ate', to_timestamp(max(abriu_em) / 1000.0)) from mercado_vela),
  (select json_build_object('tabela', 'market_brain', 'linhas', count(*), 'chaves', count(distinct symbol),
     'de', min(updated_at), 'ate', max(updated_at)) from market_brain)) j)
select json_build_object(
  'paper_accounts', pa.j, 'paper_positions', pp.j, 'zion_suggestions', zs.j,
  'celeiro_posicoes', cp.j, 'celeiro_fluxos', cf.j, 'celeiro_genoma', cg.j,
  'bancada_rodada', br.j, 'bancada_operacao', bo.j, 'bancada_resultado', bres.j,
  'lab_runs', lr.j, 'lab_results', lres.j, 'mercado', mk.j)
from pa, pp, zs, cp, cf, cg, br, bo, bres, lr, lres, mk
