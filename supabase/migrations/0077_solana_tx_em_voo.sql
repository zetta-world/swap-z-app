-- ═══════════════════════════════════════════════════════════════════════════
-- 0077 — W3-C: TRAVA DURÁVEL POR CARTEIRA para transmissões Solana (anti-duplicação entre aparelhos).
-- Prova: supabase/tests/24_solana_tx_em_voo.sql (+ 24b_solana_tx_em_voo_concorrencia.sh).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ — reproduzido em 21/10 (preview, carteira de TESTE sem fundos): dois navegadores, mesma carteira,
-- cotações diferentes → duas assinaturas diferentes → o servidor levou AS DUAS ao RPC. A trava antiga
-- vivia no localStorage de cada navegador.
--
-- REGRAS
--   · Retransmissão da MESMA transação (mesma assinatura) é sempre permitida: a rede aceita uma
--     assinatura uma vez só.
--   · Segunda transação INDEPENDENTE (assinatura diferente) da mesma carteira é recusada enquanto a
--     anterior estiver em aberto.
--   · ⚠️ SEM TTL. Uma tentativa em aberto só é resolvida por FATO: desfecho on-chain (confirmada /
--     falhou_na_rede), `expirada` (altura de bloco > `valido_ate_bloco`, medida no RPC pelo servidor)
--     ou recusa certa antes da rede (`nao_enviada`). O banco não conhece a altura de bloco — quem resolve
--     é o servidor (`/api/solana/transmitir` no conflito, `/api/solana/status`), consultando a rede.
--     Isso não trava para sempre: toda transação tem `valido_ate_bloco`, e passada essa altura ela
--     fica `expirada` na primeira consulta que o RPC responder.
--   · `valido_ate_bloco` vem do VÍNCULO assinado pelo servidor na cotação (HMAC), nunca do navegador.
--   · Só é possível reservar para uma carteira depois que o servidor conferiu a assinatura ed25519 dessa
--     carteira sobre a mensagem e o vínculo — terceiros não conseguem travar a carteira de outra pessoa.
--
-- ATOMICIDADE: advisory lock de transação POR CARTEIRA serializa a decisão; o índice único parcial
-- garante no máximo UMA linha em aberto por carteira mesmo se alguém escrever fora da função.
--
-- ⚠️ ACL: security definer + search_path fixo; EXECUTE revogado de public/anon/authenticated, só
--    service_role (padrão da 0055/0073; registrado em `src/lib/cex/execucao/rpcs-acl.test.ts`).
-- ⚠️ ADITIVA: tabela e funções novas. Nada existente muda. Rollback: `drop function` ×2 + `drop table`.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.solana_tx_em_voo (
  id               uuid        primary key default gen_random_uuid(),
  carteira         text        not null,
  assinatura       text        not null unique,
  hash_mensagem    text        not null,
  blockhash        text        not null,
  valido_ate_bloco bigint      not null check (valido_ate_bloco >= 0),
  estado           text        not null check (estado in ('reservada','enviada','incerta','resolvida')),
  desfecho         text            null check (desfecho in ('confirmada','falhou_na_rede','expirada','nao_enviada')),
  motivo           text            null,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now(),
  constraint solana_tx_em_voo_desfecho_coerente check ((estado = 'resolvida') = (desfecho is not null))
);

create unique index if not exists solana_tx_em_voo_um_aberto_por_carteira
  on public.solana_tx_em_voo (carteira) where estado <> 'resolvida';
create index if not exists solana_tx_em_voo_carteira_criada
  on public.solana_tx_em_voo (carteira, criada_em desc);

alter table public.solana_tx_em_voo enable row level security;   -- default-deny: sem policies, de propósito
revoke all on table public.solana_tx_em_voo from public, anon, authenticated;
grant select, insert, update on table public.solana_tx_em_voo to service_role;

comment on table public.solana_tx_em_voo is
  'W3-C: tentativas de transmissão Solana por carteira. No máximo uma em aberto por carteira; resolve só por fato on-chain, expiração por altura de bloco ou recusa certa antes da rede (sem TTL).';

-- ─── Reserva ────────────────────────────────────────────────────────────────
-- Devolve jsonb:
--   {"resultado":"reservada"}                         → pode transmitir
--   {"resultado":"retransmissao"}                     → a MESMA transação já está em aberto: pode retransmitir
--   {"resultado":"ja_resolvida","desfecho":...}       → esta assinatura já tem desfecho definitivo: não transmitir
--   {"resultado":"bloqueada","assinatura":...,"valido_ate_bloco":...}
--                                                     → outra transação desta carteira está em aberto
create or replace function public.solana_tx_reservar(
  p_carteira text, p_assinatura text, p_hash text, p_blockhash text, p_valido_ate_bloco bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  propria public.solana_tx_em_voo;
  aberta  public.solana_tx_em_voo;
begin
  if p_carteira is null or length(p_carteira) not between 32 and 44
     or p_assinatura is null or length(p_assinatura) not between 64 and 90
     or p_hash is null or length(p_hash) <> 64
     or p_blockhash is null or length(p_blockhash) not between 32 and 44
     or p_valido_ate_bloco is null or p_valido_ate_bloco < 0 then
    raise exception 'solana_tx_reservar: parametros_invalidos' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('solana_tx_em_voo:' || p_carteira, 0));

  select * into propria from public.solana_tx_em_voo where assinatura = p_assinatura for update;
  if found then
    if propria.carteira <> p_carteira then
      raise exception 'solana_tx_reservar: assinatura_de_outra_carteira' using errcode = '22023';
    end if;
    if propria.estado <> 'resolvida' then
      return jsonb_build_object('resultado', 'retransmissao');
    end if;
    if propria.desfecho <> 'nao_enviada' then
      return jsonb_build_object('resultado', 'ja_resolvida', 'desfecho', propria.desfecho);
    end if;
    -- recusada antes da rede: pode tentar de novo, se nada mais estiver em aberto (abaixo)
  end if;

  select * into aberta from public.solana_tx_em_voo
   where carteira = p_carteira and estado <> 'resolvida' and assinatura <> p_assinatura
   for update;
  if found then
    return jsonb_build_object('resultado', 'bloqueada', 'assinatura', aberta.assinatura,
                              'valido_ate_bloco', aberta.valido_ate_bloco);
  end if;

  if propria.id is not null then
    update public.solana_tx_em_voo
       set estado = 'reservada', desfecho = null, motivo = null, atualizada_em = now()
     where id = propria.id;
  else
    insert into public.solana_tx_em_voo (carteira, assinatura, hash_mensagem, blockhash, valido_ate_bloco, estado)
    values (p_carteira, p_assinatura, p_hash, p_blockhash, p_valido_ate_bloco, 'reservada');
  end if;
  return jsonb_build_object('resultado', 'reservada');
end
$$;

-- ─── Transição ──────────────────────────────────────────────────────────────
-- Em aberto → enviada | incerta | resolvida(desfecho). Resolvida é FINAL (exceto o caminho
-- `nao_enviada` → nova reserva, que só a função acima faz). Devolve true se a linha mudou.
create or replace function public.solana_tx_marcar(
  p_assinatura text, p_estado text, p_desfecho text, p_motivo text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if p_estado not in ('enviada','incerta','resolvida') then
    raise exception 'solana_tx_marcar: estado_invalido' using errcode = '22023';
  end if;
  if (p_estado = 'resolvida') <> (p_desfecho is not null) then
    raise exception 'solana_tx_marcar: desfecho_incoerente' using errcode = '22023';
  end if;
  update public.solana_tx_em_voo
     set estado = p_estado, desfecho = p_desfecho, motivo = left(p_motivo, 160), atualizada_em = now()
   where assinatura = p_assinatura and estado <> 'resolvida';
  get diagnostics n = row_count;
  return n > 0;
end
$$;

revoke all on function public.solana_tx_reservar(text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.solana_tx_marcar(text, text, text, text)           from public, anon, authenticated;
grant execute on function public.solana_tx_reservar(text, text, text, text, bigint) to service_role;
grant execute on function public.solana_tx_marcar(text, text, text, text)           to service_role;
