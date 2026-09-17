-- ═══════════════════════════════════════════════════════════════════════
-- A127 — CONEXÕES VERSIONADAS (credential_identity + is_current/superseded_at).
-- ROUND 8 CIRÚRGICO. CRIADA, medida contra produção (0 linhas em
-- `cex_conexoes`), e escrita FORWARD-SAFE COM DADOS — ver cada decisão abaixo.
--
-- ⚠️⚠️ O ATAQUE QUE ESTA MIGRATION FECHA. Até aqui `cex_conexoes` tinha
-- UNIQUE (wallet_address, exchange_id) e o `guardarConexao` fazia UPSERT:
-- salvar credencial nova para o mesmo par SOBRESCREVIA `creds_cipher` NA
-- MESMA LINHA. O `id` — gravado como `conexao_id` em intents de execução,
-- sessões de autopilot e planos DCA — passava silenciosamente a apontar para
-- OUTRA conta CEX: um intent criado com a credencial C1 podia ser
-- reconciliado (ou pior, seguido) com a C2. Reconciliação com a credencial
-- errada não é só leitura errada: dependendo da venue, muta o livro alheio.
--
-- A CORREÇÃO É VERSIONAR, NÃO SOBRESCREVER:
--   · cada linha ganha `credential_identity` (HMAC-SHA256 da credencial sob
--     env do servidor, domínio "cex-connection-v1" — ver
--     `src/lib/cex/fingerprint.ts`): prova "é a mesma conta" sem guardar nem
--     comparar segredo em claro;
--   · o par (wallet, exchange) passa a ter no máximo UMA linha `is_current`
--     (índice parcial único abaixo); trocar a credencial APOSENTA a versão
--     anterior (`is_current=false`, `superseded_at=now()`) em vez de
--     apagá-la — ela segue `is_active` e RECONCILIA os intents antigos que a
--     referenciam, mas nunca mais executa operação nova;
--   · a decisão reuse-vs-nova-versão mora numa RPC security definer com
--     advisory lock por par — serializada no banco, sem corrida entre dois
--     saves simultâneos;
--   · revogar (aplicação) apaga `is_current` junto com `is_active` em TODAS
--     as versões do par, e o reconnect NUNCA ressuscita linha morta: a RPC
--     só reusa current ATIVA com identidade IGUAL — revogada ou legacy cai
--     no caminho de versão nova, com id novo.
--
-- ⚠️ O LEGADO NÃO GANHA IDENTIDADE INVENTADA. Linhas anteriores a esta
-- migration ficam com `credential_identity` NULL = "não comprovada". Não há
-- backfill: calcular a identidade exigiria DECRIPTAR `creds_cipher` no SQL
-- (a chave de cifra não mora no banco — e não vai morar), e inventar um
-- fingerprint retroativo seria gravar mentira no cofre. O legado é a current
-- do seu par por default (`is_current` nasce true); no PRIMEIRO save novo do
-- par, a RPC não consegue provar "mesma conta" (identity NULL) e faz o
-- seguro: aposenta o legado INTACTO (cipher preservado, intents antigos
-- seguem reconciliando por ele) e cria a versão nova com identidade própria.
--
-- ⚠️ ACL NA MESMA MIGRATION (lição A116): a RPC nasce fechada — só
-- service_role executa.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. A UNIQUE VELHA CAI ────────────────────────────────────────────────
-- Ela garantia ≤1 linha por par — exatamente o que forçava o upsert a
-- sobrescrever. Quem passa a garantir a unicidade é o índice parcial sobre
-- `is_current` (item 4): várias versões por par, UMA vigente.
alter table public.cex_conexoes
  drop constraint if exists cex_conexoes_wallet_address_exchange_id_key;

-- ── 2. AS TRÊS COLUNAS DE VERSÃO ─────────────────────────────────────────
-- `is_current` nasce true e o legado herda o default: com a UNIQUE velha
-- havia no máximo uma linha por par, e ela É a conexão vigente daquele par.
-- `credential_identity` nasce NULL de propósito — ver o cabeçalho.
alter table public.cex_conexoes
  add column if not exists credential_identity text;
alter table public.cex_conexoes
  add column if not exists is_current boolean not null default true;
alter table public.cex_conexoes
  add column if not exists superseded_at timestamptz;

comment on column public.cex_conexoes.credential_identity is
  'A127: HMAC-SHA256 hex (64 chars) de "cex-connection-v1" + NUL + exchange '
  'canonica + NUL + apiKey + NUL + apiSecret + NUL + passphrase, sob '
  'CEX_RECOVERY_HMAC_KEY. Prova "mesma conta" sem segredo em claro. NULL = '
  'linha legada, identidade nao comprovada — nunca reusada, so aposentada.';
comment on column public.cex_conexoes.is_current is
  'A127: no maximo UMA linha current por (wallet_address, exchange_id) — '
  'indice parcial unico cex_conexoes_uma_current_por_conta. Revogar apaga '
  'is_current junto com is_active em todas as versoes do par.';
comment on column public.cex_conexoes.superseded_at is
  'A127: quando esta versao foi substituida por outra (retired). NULL = '
  'nunca substituida. Aposentada com is_active=true segue reconciliando os '
  'intents que a referenciam; nunca executa operacao nova.';

-- ── 3. O FORMATO DA IDENTIDADE É REGRA DE BANCO ──────────────────────────
-- NULL (legado) ou EXATAMENTE 64 hex minúsculos — um valor malformado seria
-- um vínculo que nunca confere. NOT VALID + VALIDATE: como toda linha
-- existente tem identity NULL, a validação passa sobre qualquer dado legado
-- (forward-safe), e todo insert/update posterior é conferido na hora.
alter table public.cex_conexoes
  add constraint cex_conexoes_identity_formato
  check (credential_identity is null
         or credential_identity ~ '^[0-9a-f]{64}$') not valid;
alter table public.cex_conexoes
  validate constraint cex_conexoes_identity_formato;

-- ── 4. UMA CURRENT POR CONTA ─────────────────────────────────────────────
-- Forward-safe COM dados: a UNIQUE velha garantia ≤1 linha por par, logo ≤1
-- current por par depois do default — o índice sempre cria.
create unique index if not exists cex_conexoes_uma_current_por_conta
  on public.cex_conexoes (wallet_address, exchange_id) where is_current;

-- ── 5. A RPC DE GUARDA VERSIONADA ────────────────────────────────────────
-- Decisão atômica, serializada por advisory lock do par (sem corrida entre
-- dois saves): mesma identidade na current ATIVA → reusa o MESMO id (só
-- refresca expires_at — NÃO toca creds_cipher, a credencial é a mesma por
-- prova de HMAC); qualquer outro caso (identidade diferente, current legacy
-- com identity NULL, current revogada, par novo) → aposenta a current se
-- existir e insere versão NOVA com id novo.
create or replace function public.cex_guardar_conexao_versionada(
  p_wallet_address text,
  p_exchange_id text,
  p_creds_cipher text,
  p_credential_identity text,
  p_expires_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_atual public.cex_conexoes%rowtype;
  v_novo  uuid;
begin
  -- A identidade é obrigatória e bem-formada: uma linha nova sem identity
  -- comprovada seria o legacy renascendo. NULL ou não-64-hex não grava.
  if p_credential_identity is null
     or p_credential_identity !~ '^[0-9a-f]{64}$' then
    raise exception 'credential_identity malformada';
  end if;

  -- Serializa rotações do MESMO par: dois saves simultâneos não podem
  -- aposentar um ao outro e deixar o par sem current (ou com duas).
  perform pg_advisory_xact_lock(hashtext(p_wallet_address || E'\0' || p_exchange_id));

  select * into v_atual
    from public.cex_conexoes
   where wallet_address = p_wallet_address
     and exchange_id    = p_exchange_id
     and is_current
   limit 1;

  -- MESMA CONTA na current ativa (prova: identity igual, não nula): reusa o
  -- id. O cipher NÃO é regravado — a credencial é a mesma por definição de
  -- identity; regravar só criaria ciphertext novo sem fato novo.
  if found
     and v_atual.is_active
     and v_atual.credential_identity is not null
     and v_atual.credential_identity = p_credential_identity then
    update public.cex_conexoes
       set expires_at    = p_expires_at,
           atualizado_em = now()
     where id = v_atual.id;
    return v_atual.id;
  end if;

  -- QUALQUER OUTRO CASO: a current existente (identity diferente, legacy
  -- NULL ou revogada) é aposentada INTACTA — cipher preservado para os
  -- intents antigos reconciliarem — e a versão nova nasce com id novo.
  -- Ressuscitar revogada NUNCA: ela não é current (a revogação apaga
  -- is_current), então nem é lida aqui; e mesmo que fosse, o `is_active` no
  -- predicado acima a exclui do reuse.
  if found then
    update public.cex_conexoes
       set is_current    = false,
           superseded_at = now(),
           atualizado_em = now()
     where id = v_atual.id;
  end if;

  insert into public.cex_conexoes
    (wallet_address, exchange_id, creds_cipher, expires_at, is_active,
     credential_identity, is_current, superseded_at, atualizado_em)
  values
    (p_wallet_address, p_exchange_id, p_creds_cipher, p_expires_at, true,
     p_credential_identity, true, null, now())
  returning id into v_novo;

  return v_novo;
end; $$;

comment on function public.cex_guardar_conexao_versionada(text, text, text, text, timestamptz) is
  'A127: guarda versionada da credencial CEX. Advisory lock por par; identity '
  'igual na current ativa -> reusa o MESMO id (so expires_at); senao aposenta '
  'a current (is_current=false, superseded_at=now()) e insere versao nova com '
  'id novo. Legacy com identity NULL e revogada NUNCA sao reusadas.';

-- ── ACL — NASCE FECHADA (lição A116). Só a service_role executa. ─────────
revoke all on function public.cex_guardar_conexao_versionada(text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cex_guardar_conexao_versionada(text, text, text, text, timestamptz)
  to service_role;

-- ── 6. BROWSER REAL SEM ELO NO COFRE NÃO NASCE ───────────────────────────
-- A127 §24: intent de `autopilot_browser` REAL sem `conexao_id` seria uma
-- ordem sem identidade de conta durável — irreconciliável com segurança
-- depois de qualquer rotação. NOT VALID: os históricos são preservados sem
-- revalidação; TODO insert/update posterior é conferido na hora.
alter table public.cex_execution_intents
  add constraint cex_intents_browser_real_exige_conexao
  check (not (origin = 'autopilot_browser' and simulated = false and conexao_id is null)) not valid;
