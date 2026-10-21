# PROPOSTA — W3-C trava durável por carteira · W3-D reconciliação financeira (21/10/2026)

Status: 📝 **somente desenho** — NADA aplicado ao Supabase. Exige autorização do dono (escrita durável; o banco do
Preview e o de Produção precisam ser confirmados antes de qualquer migration).

---

## W3-C — trava durável e atômica por carteira (anti-duplicação entre aparelhos)

### O problema, reproduzido (21/10, preview `dpl_EAVfKb7mcnXt2PvNaeoMwBaEyEBC`, carteira de TESTE sem fundos)

Dois navegadores independentes, mesma carteira, cotações diferentes → duas assinaturas diferentes → o servidor levou
**as duas** ao RPC (só pararam no preflight por falta de saldo). A trava atual vive no `localStorage` de cada navegador.
Evidência: `zswap-local/evidence/w3-auditoria2-20261021/reproducao-duplicacao-entre-navegadores.txt`.

### Regras

- **Retransmissão da MESMA transação** (mesma assinatura) é sempre permitida: a rede aceita uma assinatura uma vez só.
- **Segunda transação INDEPENDENTE** (assinatura diferente) da mesma carteira é recusada enquanto a anterior ainda puder
  pousar.
- "Ainda pode pousar" termina por: desfecho on-chain (confirmada / falhou_na_rede), `expirada` (altura de bloco >
  `lastValidBlockHeight`), recusa certa antes da rede, ou **TTL de segurança** (5 min) — nunca trava permanente.
- A trava é verificada NO SERVIDOR, em `/api/solana/transmitir`, depois da validação e do vínculo e antes do RPC.

### Migration proposta (NÃO aplicada — texto para revisão)

```sql
-- 00XX_solana_tx_em_voo.sql  (PROPOSTA — não aplicar sem autorização)
create table if not exists solana_tx_em_voo (
  id                uuid primary key default gen_random_uuid(),
  carteira          text        not null,
  assinatura        text        not null unique,          -- identificador único da tentativa na rede
  hash_mensagem     text        not null,                 -- o mesmo do vínculo cotação↔transação
  blockhash         text        not null,
  valido_ate_bloco  bigint      not null,
  estado            text        not null check (estado in ('reservada','enviada','incerta','resolvida')),
  desfecho          text            null check (desfecho in ('confirmada','falhou_na_rede','expirada','nao_enviada','ttl')),
  criada_em         timestamptz not null default now(),
  atualizada_em     timestamptz not null default now(),
  expira_em         timestamptz not null default now() + interval '5 minutes'   -- TTL de segurança
);
-- ⚠️ A atomicidade vem daqui: no máximo UMA tentativa em aberto por carteira.
create unique index if not exists um_em_voo_por_carteira
  on solana_tx_em_voo (carteira) where estado in ('reservada','enviada','incerta');
create index if not exists idx_em_voo_expira on solana_tx_em_voo (expira_em) where estado <> 'resolvida';
alter table solana_tx_em_voo enable row level security;   -- convenção do repo: RLS sem policies (só service role)

-- Reserva atômica. Devolve: 'reservada' | 'retransmissao' | 'bloqueada:<assinatura em aberto>'
create or replace function reservar_transmissao_solana(
  p_carteira text, p_assinatura text, p_hash text, p_blockhash text, p_lvbh bigint
) returns text language plpgsql as $$
declare aberta solana_tx_em_voo;
begin
  -- libera o que venceu pelo TTL (sem depender de ninguém consultar o status)
  update solana_tx_em_voo set estado = 'resolvida', desfecho = 'ttl', atualizada_em = now()
   where carteira = p_carteira and estado <> 'resolvida' and expira_em < now();
  select * into aberta from solana_tx_em_voo
   where carteira = p_carteira and estado in ('reservada','enviada','incerta') for update;
  if found then
    if aberta.assinatura = p_assinatura then return 'retransmissao'; end if;
    return 'bloqueada:' || aberta.assinatura;
  end if;
  insert into solana_tx_em_voo (carteira, assinatura, hash_mensagem, blockhash, valido_ate_bloco, estado)
  values (p_carteira, p_assinatura, p_hash, p_blockhash, p_lvbh, 'reservada')
  on conflict do nothing;                      -- corrida perdida para outra reserva → tratada abaixo
  if not found then return 'bloqueada:concorrente'; end if;
  return 'reservada';
end $$;
```

### Fluxo no servidor (a implementar depois da autorização)

1. `/api/solana/transmitir`: validação → vínculo → `reservar_transmissao_solana(...)`.
   - `bloqueada:<sig>` → consulta o status de `<sig>`; se terminal (`confirmada`/`falhou_na_rede`/`expirada`) resolve a
     linha e tenta reservar de novo; senão responde 409 `{ fase: "antes_do_rpc", erro: "anterior_em_aberto", assinatura }`.
2. Envio → `enviada` / `incerta` / (`nao_enviada` → `resolvida`).
3. `/api/solana/status` resolve a linha quando o desfecho é terminal.
4. Falha do banco na reserva → **falha fechada** (não transmite) — dinheiro em jogo.
5. Queda do servidor entre reservar e enviar → linha `reservada` vence pelo `lastValidBlockHeight` (status `expirada`) ou
   pelo TTL. Sem trava permanente.

---

## W3-D — integridade do livro financeiro (`operations`)

### Hoje

`/api/operations/record` recebe do NAVEGADOR `status`, `volumeUsd` e `platformFee*`. A identidade agora vem da origem
conferida contra a sessão (W3), mas o **conteúdo financeiro é declarado**. O painel de receita separa por **atribuição**
(`temIdentidadeAssinada`: tem `wallet_address` ou não) — **não** separa verificado on-chain de declarado.

### Classes propostas (nenhum registro histórico é apagado)

| `verificacao` | significado |
|---|---|
| `verificada_onchain` | assinatura conferida na rede: `err` nulo, pagador = carteira, taxa medida na conta de taxa |
| `aguardando` | tem assinatura, ainda não reconciliada |
| `divergente` | reconciliada e NÃO bate (falhou na rede, outro pagador, taxa diferente da declarada) |
| `declarada` | sem assinatura verificável (CEX, legado, EVM antes da reconciliação EVM) |
| `nao_atribuida` | sem identidade de origem (W3) — conta no total, não é de ninguém |

### Migration proposta (NÃO aplicada)

```sql
-- 00XX_operations_verificacao.sql  (PROPOSTA — não aplicar sem autorização)
alter table operations add column if not exists tx_signature      text;
alter table operations add column if not exists verificacao       text not null default 'declarada'
  check (verificacao in ('verificada_onchain','aguardando','divergente','declarada','nao_atribuida'));
alter table operations add column if not exists verificada_em     timestamptz;
alter table operations add column if not exists taxa_onchain_raw  text;   -- medida na rede, não declarada
create index if not exists idx_operations_aguardando on operations (created_at) where verificacao = 'aguardando';
-- Histórico: só RECLASSIFICA, não apaga nem altera valores.
update operations set verificacao = 'nao_atribuida' where wallet_address is null and verificacao = 'declarada';
```

### Reconciliação por assinatura pública (proposta)

- O navegador envia `txHash` (assinatura Solana) no registro; o servidor grava `tx_signature` e `verificacao='aguardando'`
  — nunca confia no `status` declarado para classificar.
- Rotina de servidor (cron com `CRON_SECRET`): para cada `aguardando`, `getTransaction(sig, jsonParsed,
  maxSupportedTransactionVersion: 0)` no RPC do servidor e confere: `meta.err === null`; pagador (1ª conta) =
  `wallet_address`; delta da conta de taxa (`preTokenBalances`/`postTokenBalances` da conta USDC/wSOL da plataforma) > 0
  e coerente com os bps do vínculo; marca `verificada_onchain` + `taxa_onchain_raw`, ou `divergente`.
- Painel: receita **verificada** e **declarada** em linhas separadas; "não atribuída" à parte. A receita oficial passa a
  ser a verificada.
- EVM/LI.FI: mesma ideia por `receipt` + evento de transferência ao destinatário da taxa — rodada própria.

### Riscos se não for feito

Volume/receita do painel continuam aceitando números declarados (limitados pelo CHECK de não-negativo e pelo rate
limit); um cliente adulterado pode inflar o próprio volume. Não move fundos; distorce indicadores.
