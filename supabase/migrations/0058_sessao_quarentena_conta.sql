-- ═══════════════════════════════════════════════════════════════════════
-- QUARENTENA DE CONTA DA SESSÃO — achado A103.
--
-- ⚠️⚠️ O QUE ELA ANCORAVA ANTES. A reconciliação (`reconciliarIntent`) só roda
-- quando existe um INTENT pendente. Uma sessão cujo saldo real foi mexido por
-- fora — saque do cliente, venda manual no app da corretora — sem nenhum
-- intent em dúvida NUNCA era reconciliada: o bot decidia quanto comprar e o
-- que vender sobre um inventário que já não existia.
--
-- Agora `reconciliarConta` roda por sessão ativa no cron, INDEPENDENTE de
-- intents: compara o inventário interno (`autopilot_positions`) com o saldo
-- livre real na venue. Deriva confirmada → a sessão entra em QUARENTENA:
-- zero BUY autônomo (saídas/redução seguem permitidas — prender saída é
-- prender o cliente numa posição), até mão humana.
--
-- ⚠️ O BASELINE É DECLARADO, NÃO RECONSTRUÍDO. `saldo_baseline` grava o
-- snapshot da primeira reconciliação. O que a estratégia controla é o
-- inventário de `autopilot_positions` — NÃO o saldo total da conta. Não
-- reconstruímos patrimônio histórico da exchange, e nenhum depósito a mais
-- é deriva.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.autopilot_sessions
  add column if not exists quarentena_motivo text,
  add column if not exists quarentena_em timestamptz,
  add column if not exists saldo_baseline jsonb;

comment on column public.autopilot_sessions.quarentena_motivo is
  'A103: por que a conta entrou em quarentena (ACCOUNT_DRIFT). NOT NULL quando quarentena_em está preenchido.';
comment on column public.autopilot_sessions.quarentena_em is
  'A103: quando a reconciliação de conta detectou deriva. Enquanto preenchido: zero BUY autônomo, saídas permitidas.';
comment on column public.autopilot_sessions.saldo_baseline is
  'A103: snapshot da primeira reconciliação {lido_em, saldos:[{asset,free,total}]}. Declaração, não reconstrução de patrimônio.';
