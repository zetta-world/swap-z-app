-- ═══════════════════════════════════════════════════════════════════════════
-- 0071 — VENDA FOUNDERS: persistência local-first (lane B, L-038). NÃO aplicada em produção.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE GUARDA (só o que o domínio `src/lib/founders-sale` já define e testa):
--   founders_allowlist_snapshots  — identidade do snapshot (sha256), versão, raiz de Merkle, nº de entradas,
--                                   instante do congelamento. CONGELADO = IMUTÁVEL (trigger).
--   founders_allowlist_entries    — (carteira, tier, quantidade, origem) por snapshot. Sem PII: carteira é
--                                   endereço público; e-mail nunca entra aqui. Imutáveis depois do congelamento.
--   founders_demand_signals       — preferência de tier e intenção NÃO VINCULANTE por inscrição do Early Access
--                                   (validação de demanda, OD-NFT-21). Some junto com a inscrição (ON DELETE
--                                   CASCADE) — a purga LGPD do Early Access continua valendo.
--   founders_sale_events          — trilha de evidência encadeada (hash/anterior), APPEND-ONLY (trigger
--                                   bloqueia UPDATE, DELETE e TRUNCATE).
--
-- O QUE NÃO GUARDA, DE PROPÓSITO: reservas/estoque (a autoridade de supply na venda real é o programa on-chain;
-- o livro local continua em memória no ensaio), preço, tesouraria, chaves. Nenhuma decisão de negócio pendente
-- (OD-NFT-04/11/16/17/20/21/22) vira coluna com valor.
--
-- ACL (padrão da 0068/0070): RLS ligada, ZERO policies; REVOKE ALL de public/anon/authenticated/service_role e
-- só o mínimo de volta ao service_role. Congelar = UPDATE só da coluna `congelado_em`.
-- Prova: supabase/tests/18_founders_sale.sql (rodar onde existem os DEFAULT PRIVILEGES do Supabase).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.founders_allowlist_snapshots (
  id            text        primary key check (id ~ '^[0-9a-f]{64}$'),
  versao        integer     not null unique check (versao > 0),
  raiz          text        not null check (raiz ~ '^[0-9a-f]{64}$'),
  entradas      integer     not null check (entradas > 0),
  folha_versao  text        not null default 'founders-allowlist-leaf-v2',
  criado_em     timestamptz not null default now(),
  congelado_em  timestamptz
);

create table if not exists public.founders_allowlist_entries (
  snapshot_id       text    not null references public.founders_allowlist_snapshots(id) on delete restrict,
  carteira          text    not null check (carteira ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  tier              text    not null check (tier in ('PRO', 'TRADER', 'PILOT')),
  quantidade        integer not null check (quantidade > 0),
  origem            text    not null check (origem in ('early_access', 'curada')),
  motivo_curadoria  text,
  primary key (snapshot_id, carteira, tier),
  constraint founders_curada_tem_motivo check (origem <> 'curada' or length(btrim(coalesce(motivo_curadoria, ''))) >= 5)
);

create table if not exists public.founders_demand_signals (
  id                       uuid        primary key default gen_random_uuid(),
  signup_id                uuid        not null unique references public.early_access_signups(id) on delete cascade,
  tier_preference          text        not null check (tier_preference in ('PRO', 'TRADER', 'PILOT', 'indeciso')),
  intencao_nao_vinculante  text        check (intencao_nao_vinculante in ('pretende_comprar', 'talvez', 'so_interesse')),
  fonte                    text        not null check (fonte ~ '^[a-z0-9_]{1,40}$'),
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now()
);
comment on column public.founders_demand_signals.intencao_nao_vinculante is
  'Intenção NÃO VINCULANTE de compra (validação de demanda). Não é reserva, compromisso nem pagamento.';

create table if not exists public.founders_sale_events (
  seq        bigint      generated always as identity primary key,
  tipo       text        not null check (tipo in ('allowlist_snapshot', 'merkle_root', 'proof_version', 'sale_config_fingerprint',
                                                  'mock_tx_lifecycle', 'admin_audit', 'sold_out_reconciliation')),
  dados      jsonb       not null,
  anterior   text        not null check (anterior = 'GENESIS' or anterior ~ '^[0-9a-f]{64}$'),
  hash       text        not null unique check (hash ~ '^[0-9a-f]{64}$'),
  criado_em  timestamptz not null default now()
);

-- ── imutabilidade do snapshot congelado ───────────────────────────────────
create or replace function public.founders_snapshot_guarda()
returns trigger language plpgsql set search_path = public as $$
declare n integer;
begin
  if tg_op = 'DELETE' then
    if old.congelado_em is not null then
      raise exception 'founders: snapshot % congelado é imutável', old.id using errcode = '55000';
    end if;
    return old;
  end if;
  if old.congelado_em is not null then
    raise exception 'founders: snapshot % congelado é imutável', old.id using errcode = '55000';
  end if;
  if new.id <> old.id or new.versao <> old.versao or new.raiz <> old.raiz or new.entradas <> old.entradas
     or new.folha_versao <> old.folha_versao or new.criado_em <> old.criado_em then
    raise exception 'founders: só congelar é permitido (congelado_em)' using errcode = '55000';
  end if;
  if new.congelado_em is not null then
    select count(*) into n from public.founders_allowlist_entries where snapshot_id = new.id;
    if n <> new.entradas then
      raise exception 'founders: snapshot % tem % entradas, declarou %', new.id, n, new.entradas using errcode = '55000';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists founders_snapshot_guarda on public.founders_allowlist_snapshots;
create trigger founders_snapshot_guarda before update or delete on public.founders_allowlist_snapshots
  for each row execute function public.founders_snapshot_guarda();

create or replace function public.founders_entrada_guarda()
returns trigger language plpgsql set search_path = public as $$
declare alvo text;
begin
  alvo := case when tg_op = 'INSERT' then new.snapshot_id else old.snapshot_id end;
  if exists (select 1 from public.founders_allowlist_snapshots s where s.id = alvo and s.congelado_em is not null) then
    raise exception 'founders: entradas de snapshot congelado são imutáveis' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.snapshot_id <> old.snapshot_id
     and exists (select 1 from public.founders_allowlist_snapshots s where s.id = new.snapshot_id and s.congelado_em is not null) then
    raise exception 'founders: entradas de snapshot congelado são imutáveis' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists founders_entrada_guarda on public.founders_allowlist_entries;
create trigger founders_entrada_guarda before insert or update or delete on public.founders_allowlist_entries
  for each row execute function public.founders_entrada_guarda();

-- ── trilha de evidência: append-only ──────────────────────────────────────
create or replace function public.founders_evento_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'founders: founders_sale_events é append-only (%)', tg_op using errcode = '55000';
end $$;

drop trigger if exists founders_evento_append_only on public.founders_sale_events;
create trigger founders_evento_append_only before update or delete on public.founders_sale_events
  for each row execute function public.founders_evento_append_only();
drop trigger if exists founders_evento_sem_truncate on public.founders_sale_events;
create trigger founders_evento_sem_truncate before truncate on public.founders_sale_events
  for each statement execute function public.founders_evento_append_only();

-- ── ACL ───────────────────────────────────────────────────────────────────
alter table public.founders_allowlist_snapshots enable row level security;
alter table public.founders_allowlist_entries   enable row level security;
alter table public.founders_demand_signals      enable row level security;
alter table public.founders_sale_events         enable row level security;

revoke all on table public.founders_allowlist_snapshots from public, anon, authenticated, service_role;
revoke all on table public.founders_allowlist_entries   from public, anon, authenticated, service_role;
revoke all on table public.founders_demand_signals      from public, anon, authenticated, service_role;
revoke all on table public.founders_sale_events         from public, anon, authenticated, service_role;

grant select, insert on table public.founders_allowlist_snapshots to service_role;
grant update (congelado_em) on table public.founders_allowlist_snapshots to service_role;
grant select, insert, delete on table public.founders_allowlist_entries to service_role;
grant select, insert, update (tier_preference, intencao_nao_vinculante, fonte, atualizado_em) on table public.founders_demand_signals to service_role;
grant select, insert on table public.founders_sale_events to service_role;

revoke all on function public.founders_snapshot_guarda()    from public, anon, authenticated;
revoke all on function public.founders_entrada_guarda()     from public, anon, authenticated;
revoke all on function public.founders_evento_append_only() from public, anon, authenticated;
