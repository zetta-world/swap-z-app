-- ═══════════════════════════════════════════════════════════════════════════
-- 0078 — W3-D: LIVRO FINANCEIRO VERIFICÁVEL (operações Solana reconciliadas pela assinatura pública).
-- Prova: supabase/tests/25_operations_verificacao.sql.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ — `/api/operations/record` recebe do NAVEGADOR `status`, `volumeUsd` e `platformFee*`. A
-- identidade já vem da origem conferida contra a sessão (W3), mas o CONTEÚDO financeiro é declarado.
--
-- DUAS DIMENSÕES, SEPARADAS DE PROPÓSITO (não misturar identidade com verificação financeira):
--
--   ESTADO FINANCEIRO — coluna `verificacao`:
--     verificada_onchain · a transação existe na rede, `err` nulo, pagador = carteira de origem, e a
--                          taxa foi MEDIDA na conta de taxa (`taxa_onchain_*`), não declarada
--     aguardando         · tem assinatura Solana declarada como confirmada; ainda não reconciliada
--     divergente         · reconciliada e NÃO bate (falhou na rede, outro pagador, taxa declarada que
--                          não chegou, sem registro na rede depois do prazo) — motivo em `verificacao_motivo`
--     declarada          · sem assinatura verificável (CEX, EVM, LI.FI, legado). ⚠️ TODO o histórico
--                          nasce aqui: nada antigo é "confirmado" por inferência.
--
--   IDENTIDADE — derivada, sem coluna de estado:
--     origem comprovada  · `pagador_onchain` preenchido (a rede diz quem assinou e pagou)
--     autenticada        · `wallet_address` preenchido (origem do registro == sessão assinada, W3)
--     não atribuída      · nenhum dos dois
--
-- ⚠️ ADITIVA: só colunas novas (defaults constantes, sem reescrever a tabela no PG ≥ 11) e índices.
--    Nenhum valor histórico muda; nenhum registro é apagado. Rollback: `drop index` ×2 + `drop column` ×8.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.operations add column if not exists tx_signature       text;
alter table public.operations add column if not exists carteira_origem    text;
alter table public.operations add column if not exists verificacao        text not null default 'declarada';
alter table public.operations add column if not exists verificacao_motivo text;
alter table public.operations add column if not exists verificada_em      timestamptz;
alter table public.operations add column if not exists pagador_onchain    text;
alter table public.operations add column if not exists taxa_onchain_raw   numeric;
alter table public.operations add column if not exists taxa_onchain_mint  text;

alter table public.operations drop constraint if exists operations_verificacao_valida;
alter table public.operations add constraint operations_verificacao_valida
  check (verificacao in ('verificada_onchain','aguardando','divergente','declarada'));
alter table public.operations drop constraint if exists operations_taxa_onchain_nao_negativa;
alter table public.operations add constraint operations_taxa_onchain_nao_negativa
  check (taxa_onchain_raw is null or taxa_onchain_raw >= 0);
-- verificada_onchain sempre traz o que foi medido; nada além disso pode alegar verificação.
alter table public.operations drop constraint if exists operations_verificada_tem_medicao;
alter table public.operations add constraint operations_verificada_tem_medicao
  check (verificacao <> 'verificada_onchain'
         or (tx_signature is not null and pagador_onchain is not null and taxa_onchain_raw is not null and verificada_em is not null));

create index if not exists idx_operations_aguardando on public.operations (created_at) where verificacao = 'aguardando';
create index if not exists idx_operations_tx_signature on public.operations (tx_signature) where tx_signature is not null;

comment on column public.operations.verificacao is
  'W3-D: estado FINANCEIRO (verificada_onchain | aguardando | divergente | declarada). Independe da identidade (wallet_address / pagador_onchain).';
comment on column public.operations.taxa_onchain_raw is
  'W3-D: taxa MEDIDA na conta de taxa da plataforma (unidades inteiras do mint em taxa_onchain_mint). Só preenchida pela reconciliação do servidor.';
