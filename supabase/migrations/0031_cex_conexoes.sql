-- ── O COFRE DA CREDENCIAL DE CORRETORA ───────────────────────────────
-- (docs/PLANO-DCA-AUTOMATICO.md §2 — T1 da virada em três tempos)
--
-- ⚠️ POR QUE ESTA TABELA EXISTE. Hoje `autopilot_sessions` diz ao mesmo tempo
-- "conectei minha corretora" e "o robô de IA está ligado". São coisas
-- diferentes: o DCA precisa da primeira e não deve exigir a segunda.
--
-- Decisão do dono (24/08): UMA cópia do segredo, um lugar para revogar. A
-- alternativa — cada produto com a própria cópia cifrada — foi recusada porque
-- matar o autopilot no pânico NÃO mataria o DCA: ele seguiria operando com a
-- segunda chave.
--
-- ⚠️ ESTE É O T1: cria e faz backfill. NADA lê daqui ainda, exceto o DCA, que
-- nasce já usando o cofre. A migração da leitura do autopilot é o T2 (leitura
-- dupla com contador) e o T3 (remover `creds_cipher`), em PR próprio.

create table if not exists public.cex_conexoes (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  exchange_id    text not null,

  -- AES-256-GCM, mesmo formato de `autopilot_sessions.creds_cipher`:
  -- iv.tag.ciphertext em base64. Ver `lib/crypto/secretbox.ts`.
  creds_cipher   text not null,

  /**
   * ⚠️ NULO = SEM PRAZO DURO, e é o padrão DE PROPÓSITO.
   *
   * Copiar o `expires_at` da sessão de autopilot para cá faria todo plano de
   * DCA nascer morto: sessão de IA é curta por segurança, e um DCA de doze
   * meses não cabe nisso.
   *
   * O cofre guarda a CHAVE; cada produto aplica a PRÓPRIA política em cima:
   * o autopilot segue com o `expires_at` curto dele, e o DCA roda enquanto a
   * conexão estiver ativa. Revogar é `is_active = false` aqui, ou apagar a
   * chave na corretora.
   */
  expires_at     timestamptz,
  is_active      boolean not null default true,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  unique (wallet_address, exchange_id)
);

create index if not exists cex_conexoes_ativas_idx
  on public.cex_conexoes (wallet_address, exchange_id) where is_active;

alter table public.cex_conexoes enable row level security;

-- ── o elo, ainda NULÁVEL ─────────────────────────────────────────────
-- ⚠️ Nulável de propósito: no T1 nenhuma linha de `autopilot_sessions` é
-- obrigada a ter conexão, e o código do autopilot NÃO lê esta coluna ainda.
-- Torná-la NOT NULL agora quebraria qualquer sessão criada entre a migration
-- e o deploy do código.
alter table public.autopilot_sessions
  add column if not exists conexao_id uuid references public.cex_conexoes(id) on delete set null;

-- ── backfill ─────────────────────────────────────────────────────────
-- Uma conexão por (carteira, corretora), a partir do que já existe. O
-- `expires_at` vai NULO — ver a nota acima.
insert into public.cex_conexoes (wallet_address, exchange_id, creds_cipher, is_active)
select distinct on (wallet_address, exchange_id)
       wallet_address, exchange_id, creds_cipher, true
  from public.autopilot_sessions
 where creds_cipher is not null and creds_cipher <> ''
 order by wallet_address, exchange_id, updated_at desc nulls last
on conflict (wallet_address, exchange_id) do nothing;

update public.autopilot_sessions s
   set conexao_id = c.id
  from public.cex_conexoes c
 where c.wallet_address = s.wallet_address
   and c.exchange_id    = s.exchange_id
   and s.conexao_id is null;
