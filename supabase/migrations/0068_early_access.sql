-- ═══════════════════════════════════════════════════════════════════════════
-- 0068 — EARLY ACCESS (Fase 1)
-- Plano: docs/PLANO-EARLY-ACCESS.md · Discovery: docs/WHITELIST-FUNDRAISING-DISCOVERY.md
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ISTO NÃO É A WHITELIST DE ADMIN. A "whitelist" do painel é a lista
-- `ADMIN_WALLETS` (src/app/admin/api/whitelist). Esta é uma lista PÚBLICA de
-- interessados, e por isso mora em `early_access_*`, sem tocar em `users`:
-- `users` é a identidade de produto (uma linha por CARTEIRA que assinou, 0001)
-- e é contada como "usuário"/"signup" em cinco painéis. Um lead por email ali
-- viraria usuário sem nunca ter conectado carteira.
--
-- ⚠️ ACL ANTES DE RLS (0067). Sob os default privileges do Supabase toda tabela
-- nova em `public` nasce com ALL para anon/authenticated. RLS sem policy segura
-- SELECT/INSERT/UPDATE, mas NÃO TRUNCATE, REFERENCES nem TRIGGER. As três
-- tabelas abaixo nascem com REVOKE explícito — inclusive de `service_role`,
-- que recebe de volta só o que a aplicação usa:
--
--   | tabela                  | service_role         | escrita                      |
--   |-------------------------|----------------------|------------------------------|
--   | early_access_signups    | SELECT               | só pelas RPCs (DEFINER)      |
--   | early_access_events     | SELECT               | só pelas RPCs (append-only)  |
--   | early_access_consents   | SELECT               | só pelas RPCs (append-only)  |
--
-- ⚠️ IMUTABILIDADE POR PRIVILÉGIO, NÃO POR TRIGGER. Este repo não tem trigger
-- nenhum (0061 recusou um por excesso). Sem INSERT/UPDATE/DELETE/TRUNCATE para
-- o papel da aplicação, o log só cresce pelas RPCs e não muda por nenhum
-- caminho da aplicação. (O DONO da migration mantém seus privilégios.)
--
-- ⚠️ O GATE LEGAL TAMBÉM MORA AQUI. Enquanto não houver texto jurídico
-- aprovado, a aplicação usa a versão "UNAPPROVED" e a rota fica fechada. O
-- CHECK abaixo garante que, mesmo se o gate da aplicação falhar, nenhuma
-- inscrição com versão não aprovada entra no banco.
--
-- ⚠️ A ROTA NASCE FECHADA: o seed de `admin_kv` grava
-- `disable_early_access=true` sem sobrescrever uma decisão já existente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── inscrições ──────────────────────────────────────────────────────────────
create table if not exists public.early_access_signups (
  id                     uuid        primary key default gen_random_uuid(),

  -- trim → NFC → minúsculas, ASCII, feito na aplicação. SEM dot folding nem
  -- plus stripping: `a.b+x@gmail.com` e `ab@gmail.com` são inscrições distintas.
  email_normalized       text        not null unique,
  display_name           text        not null,
  -- ISO 3166-1 alpha-2 AUTODECLARADO (a aplicação valida contra a lista real).
  -- Não é geolocalização.
  country                text        not null,

  status                 text        not null default 'pending',
  status_reason          text,

  -- VERIFIED e CONVERTED NÃO SÃO STATUS: são marcos de tempo, ortogonais à
  -- decisão de triagem.
  email_verified_at      timestamptz,

  -- Carteira DECLARADA (não provada). Só `wallet_verified_at` diz que a pessoa
  -- assinou com ela. EVM chega checksummed (viem), Solana em base58 — nunca
  -- lower(): base58 é case-sensitive.
  wallet_address         text,
  wallet_chain           text,
  wallet_verified_at     timestamptz,

  telegram_handle        text,
  x_handle               text,

  referral_code          text        not null unique,
  referred_by_signup_id  uuid        references public.early_access_signups(id) on delete set null,
  -- Sinal, não prova. IP igual sozinho não prova auto-indicação (NAT).
  referral_flag          text,

  -- first-touch, gravado uma vez, imutável pelo caminho público
  utm_source             text,
  utm_medium             text,
  utm_campaign           text,
  utm_content            text,
  utm_term               text,
  landing_path           text,
  referrer_host          text,
  source                 text        not null,

  terms_version          text        not null,
  privacy_version        text        not null,
  accepted_at            timestamptz not null,
  marketing_opt_in       boolean     not null default false,

  -- HMAC-SHA256 com segredo de servidor. NUNCA o IP cru.
  ip_hmac                text,

  converted_at           timestamptz,
  converted_wallet       text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ea_email_minusculo     check (email_normalized = lower(email_normalized)),
  constraint ea_email_formato       check (char_length(email_normalized) between 3 and 254
                                           and email_normalized ~ '^[!-~]+@[!-~]+$'),
  constraint ea_nome_tamanho        check (char_length(display_name) between 2 and 80
                                           and display_name = btrim(display_name)
                                           and display_name !~ '[[:cntrl:]]'),
  constraint ea_pais_formato        check (country ~ '^[A-Z]{2}$'),
  constraint ea_status_valido       check (status in ('pending','approved','rejected','blocked')),
  constraint ea_status_motivo       check (status not in ('rejected','blocked')
                                           or (status_reason is not null and btrim(status_reason) <> '')),
  constraint ea_status_motivo_tam   check (status_reason is null or char_length(status_reason) <= 500),
  constraint ea_carteira_par        check ((wallet_address is null) = (wallet_chain is null)),
  constraint ea_carteira_chain      check (wallet_chain is null or wallet_chain in ('evm','solana')),
  constraint ea_carteira_tam        check (wallet_address is null or char_length(wallet_address) between 32 and 64),
  constraint ea_carteira_verificada check (wallet_verified_at is null or wallet_address is not null),
  constraint ea_conversao_exige_carteira check (converted_at is null or wallet_verified_at is not null),
  constraint ea_conversao_par       check ((converted_at is null) = (converted_wallet is null)),
  constraint ea_telegram_formato    check (telegram_handle is null or telegram_handle ~ '^[A-Za-z0-9_]{5,32}$'),
  constraint ea_x_formato           check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  constraint ea_codigo_formato      check (referral_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  constraint ea_nao_indica_a_si     check (referred_by_signup_id is null or referred_by_signup_id <> id),
  constraint ea_flag_valida         check (referral_flag is null
                                           or referral_flag in ('sinal_mesmo_ip','sinal_mesma_carteira')),
  constraint ea_utm_tam             check (coalesce(char_length(utm_source), 0)   <= 100
                                       and coalesce(char_length(utm_medium), 0)   <= 100
                                       and coalesce(char_length(utm_campaign), 0) <= 100
                                       and coalesce(char_length(utm_content), 0)  <= 100
                                       and coalesce(char_length(utm_term), 0)     <= 100),
  constraint ea_landing_tam         check (landing_path is null
                                           or (char_length(landing_path) <= 300 and landing_path like '/%')),
  constraint ea_referrer_tam        check (referrer_host is null or char_length(referrer_host) <= 255),
  constraint ea_source_formato      check (source ~ '^[a-z0-9_]{1,40}$'),
  -- F-03: o sentinela vale em QUALQUER caixa e com espaço lateral, e a versão
  -- aprovada tem formato explícito (o mesmo de legal-versions.ts).
  constraint ea_versoes_aprovadas   check (terms_version   ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
                                       and privacy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
                                       and upper(btrim(terms_version))   <> 'UNAPPROVED'
                                       and upper(btrim(privacy_version)) <> 'UNAPPROVED'),
  constraint ea_ip_hmac_formato     check (ip_hmac is null or ip_hmac ~ '^[0-9a-f]{32}$')
);

create index if not exists early_access_status_idx   on public.early_access_signups (status, created_at desc);
create index if not exists early_access_created_idx  on public.early_access_signups (created_at desc);
create index if not exists early_access_country_idx  on public.early_access_signups (country);
create index if not exists early_access_referido_idx on public.early_access_signups (referred_by_signup_id)
  where referred_by_signup_id is not null;
create index if not exists early_access_utm_idx      on public.early_access_signups (utm_source, created_at desc)
  where utm_source is not null;
-- Carteira DECLARADA pode repetir (senão alguém "ocupa" a carteira de outro).
-- Carteira PROVADA pertence a uma inscrição só, por chain.
-- F-06: em EVM o endereço é hex sem distinção de caixa (o checksum EIP-55 é
-- só apresentação), então a unicidade compara lower(); em Solana o base58 É
-- sensível à caixa e fica intocado.
create unique index if not exists early_access_carteira_verificada_uq
  on public.early_access_signups (
    wallet_chain,
    (case when wallet_chain = 'evm' then lower(wallet_address) else wallet_address end)
  )
  where wallet_verified_at is not null;

-- ── audit de domínio (append-only, sem email) ───────────────────────────────
create table if not exists public.early_access_events (
  id           uuid        primary key default gen_random_uuid(),
  signup_id    uuid        not null references public.early_access_signups(id) on delete restrict,
  kind         text        not null,
  from_status  text,
  to_status    text,
  actor        text        not null,
  reason       text,
  meta         jsonb,
  created_at   timestamptz not null default now(),
  constraint ea_evento_kind  check (kind in ('created','duplicate_attempt','status_changed')),
  constraint ea_evento_ator  check (actor ~ '^(public|system|admin:[!-~]{1,100})$'),
  constraint ea_evento_motivo_tam check (reason is null or char_length(reason) <= 500),
  constraint ea_evento_transicao check (kind <> 'status_changed'
                                        or (from_status is not null and to_status is not null))
);
create index if not exists early_access_events_signup_idx
  on public.early_access_events (signup_id, created_at desc);
create index if not exists early_access_events_kind_idx
  on public.early_access_events (kind, created_at desc);

-- ── consentimentos (append-only) ────────────────────────────────────────────
create table if not exists public.early_access_consents (
  id          uuid        primary key default gen_random_uuid(),
  signup_id   uuid        not null references public.early_access_signups(id) on delete restrict,
  kind        text        not null,
  version     text        not null,
  granted     boolean     not null,
  source      text        not null,
  ip_hmac     text,
  created_at  timestamptz not null default now(),
  constraint ea_consent_kind    check (kind in ('terms','privacy','marketing')),
  constraint ea_consent_versao  check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
                                       and upper(btrim(version)) <> 'UNAPPROVED'),
  constraint ea_consent_source  check (source ~ '^[a-z0-9_]{1,40}$'),
  constraint ea_consent_ip      check (ip_hmac is null or ip_hmac ~ '^[0-9a-f]{32}$'),
  -- Termos e privacidade só existem concedidos: sem eles não há inscrição.
  constraint ea_consent_obrigatorio check (kind = 'marketing' or granted)
);
create index if not exists early_access_consents_signup_idx
  on public.early_access_consents (signup_id, created_at desc);

-- ── RLS + ACL ───────────────────────────────────────────────────────────────
alter table public.early_access_signups  enable row level security;
alter table public.early_access_events   enable row level security;
alter table public.early_access_consents enable row level security;

revoke all on table public.early_access_signups  from public, anon, authenticated, service_role;
revoke all on table public.early_access_events   from public, anon, authenticated, service_role;
revoke all on table public.early_access_consents from public, anon, authenticated, service_role;

-- F-04: SOMENTE SELECT para o service_role nas três. A aplicação nunca escreve
-- direto: as RPCs SECURITY DEFINER gravam como o dono. Com INSERT, qualquer
-- código com a service key forjaria evento de audit ou consentimento.
grant select on table public.early_access_signups  to service_role;
grant select on table public.early_access_events   to service_role;
grant select on table public.early_access_consents to service_role;

-- ── máquina de estados ──────────────────────────────────────────────────────
-- ⚠️ ESPELHADA em src/lib/early-access/estados.ts, e um teste compara as duas
-- por leitura de fonte. Mudar aqui sem mudar lá quebra o teste.
create or replace function public.early_access_transicao_permitida(p_de text, p_para text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case p_de
    when 'pending'  then p_para in ('approved','rejected','blocked')
    when 'approved' then p_para in ('rejected','blocked')
    when 'rejected' then p_para in ('pending','blocked')
    when 'blocked'  then p_para in ('pending')
    else false
  end;
$$;

-- Motivo obrigatório: ao rejeitar, ao bloquear, e ao SAIR de rejected/blocked
-- (reconsideração e desbloqueio também precisam de justificativa).
create or replace function public.early_access_transicao_exige_motivo(p_de text, p_para text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_para in ('rejected','blocked') or p_de in ('rejected','blocked');
$$;

-- ── transição: lock → valida → update → evento, UMA transação ──────────────
create or replace function public.early_access_transicionar(
  p_id uuid, p_para text, p_ator text, p_motivo text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_de     text;
  v_conv   timestamptz;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if p_ator is null or btrim(p_ator) = '' then
    raise exception 'early_access_ator_obrigatorio' using errcode = 'P0001';
  end if;

  select status, converted_at into v_de, v_conv
    from public.early_access_signups where id = p_id for update;
  if not found then
    raise exception 'early_access_nao_encontrado' using errcode = 'P0001';
  end if;

  if not public.early_access_transicao_permitida(v_de, p_para) then
    raise exception 'early_access_transicao_proibida' using errcode = 'P0001';
  end if;

  -- Quem já virou usuário de produto não é "des-aprovado" por rejeição; abuso
  -- depois da conversão continua podendo ir a `blocked`.
  if v_de = 'approved' and p_para = 'rejected' and v_conv is not null then
    raise exception 'early_access_ja_convertido' using errcode = 'P0001';
  end if;

  if public.early_access_transicao_exige_motivo(v_de, p_para) and v_motivo is null then
    raise exception 'early_access_motivo_obrigatorio' using errcode = 'P0001';
  end if;

  update public.early_access_signups
     set status        = p_para,
         status_reason = case when p_para in ('rejected','blocked') then v_motivo else null end,
         updated_at    = now()
   where id = p_id;

  -- ⚠️ SEM EVENTO, SEM MUDANÇA: se este insert falhar, a função aborta e o
  -- UPDATE acima volta junto.
  insert into public.early_access_events (signup_id, kind, from_status, to_status, actor, reason)
  values (p_id, 'status_changed', v_de, p_para, p_ator, v_motivo);

  return jsonb_build_object('de', v_de, 'para', p_para);
end;
$$;

-- ── inscrição pública ───────────────────────────────────────────────────────
-- Devolve 'criado' ou 'existente' para a APLICAÇÃO. A rota pública não
-- ramifica a resposta por isso (anti-enumeração).
create or replace function public.early_access_inscrever(
  p_email               text,
  p_display_name        text,
  p_country             text,
  p_wallet_address      text,
  p_wallet_chain        text,
  p_telegram_handle     text,
  p_x_handle            text,
  p_referral_code_in    text,
  p_codigos_candidatos  text[],
  p_utm_source          text,
  p_utm_medium          text,
  p_utm_campaign        text,
  p_utm_content         text,
  p_utm_term            text,
  p_landing_path        text,
  p_referrer_host       text,
  p_source              text,
  p_terms_version       text,
  p_privacy_version     text,
  p_marketing_opt_in    boolean,
  p_ip_hmac             text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existente  uuid;
  v_id         uuid;
  v_ref        uuid;
  v_ref_ip     text;
  v_ref_wallet text;
  v_ref_chain  text;
  v_flag       text;
  v_codigo     text;
  v_restricao  text;
begin
  if p_terms_version is null or p_privacy_version is null
     or upper(btrim(p_terms_version)) = 'UNAPPROVED' or upper(btrim(p_privacy_version)) = 'UNAPPROVED'
     or p_terms_version   !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
     or p_privacy_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' then
    raise exception 'early_access_versao_legal_nao_aprovada' using errcode = 'P0001';
  end if;
  if p_codigos_candidatos is null or cardinality(p_codigos_candidatos) = 0 then
    raise exception 'early_access_sem_codigo_candidato' using errcode = 'P0001';
  end if;

  -- ⚠️ DUPLICADO NÃO TOCA EM NADA: nem carteira, nem UTM, nem referral, nem
  -- consentimento. Só um evento sem PII, para enxergar abuso.
  select id into v_existente from public.early_access_signups where email_normalized = p_email;
  if found then
    insert into public.early_access_events (signup_id, kind, actor)
    values (v_existente, 'duplicate_attempt', 'public');
    return 'existente';
  end if;

  -- Referral: código inexistente é ignorado em silêncio (sem oráculo).
  if p_referral_code_in is not null then
    select id, ip_hmac, wallet_address, wallet_chain
      into v_ref, v_ref_ip, v_ref_wallet, v_ref_chain
      from public.early_access_signups where referral_code = p_referral_code_in;
    if v_ref is not null then
      if p_wallet_address is not null and v_ref_wallet = p_wallet_address
         and v_ref_chain = p_wallet_chain then
        v_flag := 'sinal_mesma_carteira';
      elsif p_ip_hmac is not null and v_ref_ip = p_ip_hmac then
        -- ⚠️ SINAL, NÃO PROVA: NAT e rede compartilhada dão o mesmo IP a
        -- pessoas diferentes. Nada é bloqueado nem desfeito por isto.
        v_flag := 'sinal_mesmo_ip';
      end if;
    end if;
  end if;

  -- Códigos vêm da aplicação (CSPRNG); colisão tenta o próximo.
  foreach v_codigo in array p_codigos_candidatos loop
    begin
      insert into public.early_access_signups (
        email_normalized, display_name, country,
        wallet_address, wallet_chain, telegram_handle, x_handle,
        referral_code, referred_by_signup_id, referral_flag,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_path, referrer_host, source,
        terms_version, privacy_version, accepted_at, marketing_opt_in, ip_hmac
      ) values (
        p_email, p_display_name, p_country,
        p_wallet_address, p_wallet_chain, p_telegram_handle, p_x_handle,
        v_codigo, v_ref, v_flag,
        p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term,
        p_landing_path, p_referrer_host, p_source,
        p_terms_version, p_privacy_version, now(), coalesce(p_marketing_opt_in, false), p_ip_hmac
      )
      on conflict (email_normalized) do nothing
      returning id into v_id;

      if v_id is null then
        -- Corrida: outra inscrição com o mesmo email entrou entre o SELECT e o
        -- INSERT. Mesmo tratamento do duplicado.
        select id into v_existente from public.early_access_signups where email_normalized = p_email;
        insert into public.early_access_events (signup_id, kind, actor)
        values (v_existente, 'duplicate_attempt', 'public');
        return 'existente';
      end if;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_restricao = constraint_name;
      if v_restricao is distinct from 'early_access_signups_referral_code_key' then
        raise;
      end if;
      v_id := null;
    end;
  end loop;

  if v_id is null then
    raise exception 'early_access_codigos_esgotados' using errcode = 'P0001';
  end if;

  -- Marketing registra a escolha nos dois sentidos (recusa explícita também é
  -- registro). Sua versão é a da política de privacidade que a rege.
  insert into public.early_access_consents (signup_id, kind, version, granted, source, ip_hmac) values
    (v_id, 'terms',     p_terms_version,   true,                               p_source, p_ip_hmac),
    (v_id, 'privacy',   p_privacy_version, true,                               p_source, p_ip_hmac),
    (v_id, 'marketing', p_privacy_version, coalesce(p_marketing_opt_in, false), p_source, p_ip_hmac);

  insert into public.early_access_events (signup_id, kind, actor) values (v_id, 'created', 'public');

  return 'criado';
end;
$$;

-- ── ACL das funções ─────────────────────────────────────────────────────────
revoke all on function public.early_access_transicao_permitida(text, text)        from public, anon, authenticated;
revoke all on function public.early_access_transicao_exige_motivo(text, text)     from public, anon, authenticated;
revoke all on function public.early_access_transicionar(uuid, text, text, text)   from public, anon, authenticated;
revoke all on function public.early_access_inscrever(
  text, text, text, text, text, text, text, text, text[], text, text, text, text, text,
  text, text, text, text, text, boolean, text) from public, anon, authenticated;

grant execute on function public.early_access_transicao_permitida(text, text)      to service_role;
grant execute on function public.early_access_transicao_exige_motivo(text, text)   to service_role;
grant execute on function public.early_access_transicionar(uuid, text, text, text) to service_role;
grant execute on function public.early_access_inscrever(
  text, text, text, text, text, text, text, text, text[], text, text, text, text, text,
  text, text, text, text, text, boolean, text) to service_role;

-- ── gate: nasce FECHADO, sem sobrescrever decisão existente ─────────────────
insert into public.admin_kv (key, value) values ('disable_early_access', 'true')
on conflict (key) do nothing;
