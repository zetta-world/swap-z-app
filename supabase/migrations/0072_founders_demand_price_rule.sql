-- ═══════════════════════════════════════════════════════════════════════════
-- 0072 — SINAL DE DEMANDA FOUNDERS: preço provisório EXIBIDO + versão da regra (lane B, L-039).
-- NÃO aplicada em produção. ADITIVA sobre a 0071 (que também não está em produção).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ: OD-NFT-21 (APPROVED 04/10/2026, regra v1) conta a intenção NÃO VINCULANTE só "ao preço provisório
-- declarado do tier". Sem gravar o preço que a pessoa viu, um sinal antigo não prova a que preço se referia — e a
-- regra exige preservar resultados para auditoria. `regra_versao` fixa sob qual regra o sinal foi coletado.
--
--   preco_intencao_usd  — preço PROVISÓRIO exibido no momento da intenção (fato, não decisão de preço final).
--   regra_versao        — versão da regra de validação de demanda vigente na coleta (v1).
--
-- "pretende_comprar" sem preço é recusado em linha NOVA (NOT VALID: linhas antigas — não há nenhuma em produção —
-- não quebram a migração; o domínio simplesmente não as conta como intenção).
-- ACL: segue a 0071 (RLS ligada, zero policies; anon/authenticated sem nada). service_role pode corrigir o preço
-- exibido (UPDATE de coluna); a versão da regra não muda depois do insert.
-- Prova: supabase/tests/19_founders_demand_price_rule.sql.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.founders_demand_signals
  add column if not exists preco_intencao_usd numeric(10,2),
  add column if not exists regra_versao smallint not null default 1;

alter table public.founders_demand_signals drop constraint if exists founders_preco_intencao_positivo;
alter table public.founders_demand_signals add constraint founders_preco_intencao_positivo
  check (preco_intencao_usd is null or preco_intencao_usd > 0);

alter table public.founders_demand_signals drop constraint if exists founders_regra_versao_valida;
alter table public.founders_demand_signals add constraint founders_regra_versao_valida
  check (regra_versao >= 1);

alter table public.founders_demand_signals drop constraint if exists founders_intencao_tem_preco;
alter table public.founders_demand_signals add constraint founders_intencao_tem_preco
  check (intencao_nao_vinculante is distinct from 'pretende_comprar' or preco_intencao_usd is not null) not valid;

comment on column public.founders_demand_signals.preco_intencao_usd is
  'Preço PROVISÓRIO exibido quando a intenção NÃO VINCULANTE foi registrada (OD-NFT-21 v1). Não é preço final nem compromisso.';
comment on column public.founders_demand_signals.regra_versao is
  'Versão da regra de validação de demanda vigente na coleta (OD-NFT-21). Mudança de regra = nova versão, resultado antigo preservado.';

revoke all on table public.founders_demand_signals from public, anon, authenticated;
grant update (preco_intencao_usd) on table public.founders_demand_signals to service_role;
