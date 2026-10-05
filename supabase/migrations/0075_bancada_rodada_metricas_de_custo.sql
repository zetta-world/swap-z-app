-- ═══════════════════════════════════════════════════════════════════════════
-- 0075 — RODADA DA BANCADA: métricas de CUSTO na própria linha (CE-14, cost engineering round).
-- NÃO aplicada em produção. Lane B, local. Prova: supabase/tests/22_bancada_rodada_metricas.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ: a auditoria econômica precisa de dado real por rodada — quanto tempo levou, quantas velas vieram da
-- FONTE externa (requisição paga/limitada por IP) e quantas do cache `mercado_vela`. Um evento em `platform_events`
-- por rodada criaria uma linha a mais por backtest numa tabela sem retenção (até 5.000/dia por Pilot). A linha da
-- rodada já existe: as três colunas ficam nela, sem linha nova.
--
-- ⚠️ ADITIVA: colunas anuláveis (NULL = rodada anterior à 0075, não medida — nunca 0, que afirmaria "medido e nulo").
-- Nenhuma função, ACL ou dado existente muda.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.bancada_rodada
  add column if not exists duracao_ms     integer,
  add column if not exists velas_da_fonte integer,
  add column if not exists velas_do_cache integer;

alter table public.bancada_rodada drop constraint if exists bancada_rodada_metricas_nao_negativas;
alter table public.bancada_rodada add constraint bancada_rodada_metricas_nao_negativas
  check ((duracao_ms is null or duracao_ms >= 0)
     and (velas_da_fonte is null or velas_da_fonte >= 0)
     and (velas_do_cache is null or velas_do_cache >= 0));

comment on column public.bancada_rodada.duracao_ms is
  'CE-14: tempo de relógio do motor + leituras da rodada, em ms. NULL = rodada anterior à 0075.';
comment on column public.bancada_rodada.velas_da_fonte is
  'CE-14: velas buscadas na FONTE externa nesta rodada (requisição paga/limitada). NULL = não medido.';
comment on column public.bancada_rodada.velas_do_cache is
  'CE-14: velas servidas pelo cache mercado_vela nesta rodada. NULL = não medido.';
