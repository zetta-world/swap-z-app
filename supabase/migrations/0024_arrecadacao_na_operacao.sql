-- ═══════════════════════════════════════════════════════════════════════════
-- A ARRECADAÇÃO VIRA PARCELA DA OPERAÇÃO (Fase 11).
--
-- ⚠️ POR QUE ISTO EXISTE (11/08).
--
-- O painel de receita mostrava "RECEITA (TETO, a 1%) $1,27", calculado como 1%
-- de $127,09 de volume. No mesmo dia a Fase 9 provou que a cotação FIRME nunca
-- mandou a taxa ao 0x — de 13/06 até 11/08 às 10:42, toda troca cobrou ZERO.
--
-- O arrecadado de verdade, no histórico inteiro, é UMA retenção de 0,092016
-- USDT. O teto não é uma estimativa conservadora do que aconteceu: é a resposta
-- de outra pergunta ("quanto teria rendido SE") ocupando o lugar do resultado.
-- Invariante nº 6 — agregado sem parcela não é auditável.
--
-- Estas colunas são a parcela. O valor vem do `integratorFee` que o agregador
-- devolve na cotação firme, e é gravado SÓ quando a operação confirma: o
-- `swap_intent` acontece antes de assinar, e contar a partir dele
-- transformaria cotação abandonada em receita. Cotação não é caixa.
--
-- ⚠️ E `platform_fee_usd` NÃO É `pnl_usd` NEM O `feesUsd` DO HISTÓRICO.
-- Aquele é o que o USUÁRIO pagou de custo (gás, ponte, taker de corretora);
-- este é o que NÓS recebemos. Dois números chamados "fee" com sinais opostos.
-- Somá-los transformaria custo do cliente em receita nossa.
-- ═══════════════════════════════════════════════════════════════════════════

alter table operations add column if not exists platform_fee_usd    numeric;
alter table operations add column if not exists platform_fee_amount text;
alter table operations add column if not exists platform_fee_token  text;
alter table operations add column if not exists platform_fee_bps    integer;

-- ⚠️ NEGATIVO NÃO EXISTE AQUI. Taxa retida é entrada; um valor negativo seria
-- custo disfarçado de receita, que é exatamente a confusão que os nomes acima
-- existem para impedir. Falha visível é melhor que número errado somado.
alter table operations drop constraint if exists operations_platform_fee_nao_negativa;
alter table operations add constraint operations_platform_fee_nao_negativa
  check (platform_fee_usd is null or platform_fee_usd >= 0);

-- ⚠️ AMOSTRA ANTES DE AGREGADO: contar quantas operações têm arrecadação
-- gravada é o que separa "não rendeu" de "não medimos" — as duas somam zero.
create index if not exists operations_platform_fee_idx
  on operations (created_at desc) where platform_fee_usd is not null;

comment on column operations.platform_fee_usd is
  'O que NÓS recebemos nesta operação, em USD no momento da troca. Não confundir com o custo do usuário.';
comment on column operations.platform_fee_amount is
  'A retenção em unidades-base do token da taxa, como o agregador devolveu.';
comment on column operations.platform_fee_token is
  'Endereço do token em que a taxa foi retida (saída, ou entrada quando a saída é nativa).';
comment on column operations.platform_fee_bps is
  'Os pontos-base pedidos, para conferir a retenção contra o plano.';
