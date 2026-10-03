-- ═══════════════════════════════════════════════════════════════════════════
-- 0069 — EARLY ACCESS FASE 2: EMAIL DOUBLE OPT-IN (F-01, F-11)
-- Especificação final: docs/PLANO-EARLY-ACCESS-FASE2.md · Decisões do dono: L-021, L-023
-- Auditorias independentes: L-024 (EA2-IA01…IA06), L-025 (EA2-IA07…IA09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ADITIVA. A 0068 NÃO é editada: o que muda dela (o CHECK de `kind` dos
-- eventos, a assinatura de `early_access_inscrever`, a regra de aprovação em
-- `early_access_transicionar`) é refeito AQUI.
--
-- ⚠️ O TOKEN CRU NUNCA CHEGA AO BANCO. A aplicação gera 32 bytes CSPRNG, manda
-- só o SHA-256 (hex, 64) e compõe o link com o cru que tem em memória. Quem
-- tiver uma cópia do banco não confirma email de ninguém.
--
-- ⚠️ CONSTANTES APROVADAS PELO DONO MORAM AQUI, NÃO EM PARÂMETRO (D-3):
--   · TTL do token: 24 h — CHECK `eav_ttl_24h` (expires_at = created_at + 24h);
--   · retenção de inscrição não verificada: 7 dias — `early_access_purgar_nao_verificados`.
-- Nenhuma leitura, preview ou clique inválido estende o prazo.
--
-- ⚠️ UM TOKEN ATIVO POR INSCRIÇÃO (D-3). Reenvio cria token NOVO e revoga
-- TODOS os anteriores (`superseded`). Garantido por unique parcial. A
-- revogação só acontece DENTRO de uma emissão bem-sucedida (EA2-IA02): emissão
-- suprimida (teto, retenção, cooldown) não mexe no token vigente.
--
-- ⚠️ ESTADO DE ENVIO (EA2-IA01): pending → sent | failed (TRANSITÓRIA, volta à
-- fila de retry) | dead (PERMANENTE, terminal, nunca volta à fila). A
-- classificação vem explícita do adaptador (`registrar_envio(…, p_transitorio)`).
--
-- ⚠️ WEBHOOK (EA2-IA03): guarda só `evento_hash` (sha256 de mão única do
-- svix-id) para idempotência; nem o id do evento em claro nem o
-- `provider_message_id`. A única ligação mensagem→inscrição é
-- `early_access_verificacoes.provider_message_id`, apagada na purga.
--
-- ⚠️ NENHUMA RPC DESTA MIGRATION ESCREVE EM `admin_audit_log` (EA2-IA07). A
-- nota livre de transição vive só em `early_access_events.reason` /
-- `status_reason`, registros da inscrição que a purga apaga; o log de admin
-- (persistente) recebe da APLICAÇÃO só o código controlado.
--
-- ⚠️ APROVAR EXIGE EMAIL VERIFICADO (D-4). CHECK `ea_aprovado_exige_email` na
-- tabela — vale para QUALQUER caminho, inclusive o dono da migration — e erro
-- explícito `early_access_email_nao_verificado` na RPC de transição.
--
-- ⚠️ MARKETING SÓ VALE COM ESCOLHA DO TITULAR (decisão do dono EA2-A02).
-- `marketing_opt_in` (0068) passa a ser só a DECLARAÇÃO PROVISÓRIA de quem
-- enviou o formulário — nunca base para envio. O consentimento EFETIVO é
-- `marketing_efetivo`, gravado só na confirmação, pela escolha explícita do
-- titular verificado. Tri-estado (EA2-IA06/IA09): opt_in → efetivo + momento;
-- opt_out → não efetivo + momento; sem escolha → não efetivo e
-- `marketing_escolhido_em` NULO (nenhuma permissão). CHECK impede efetivo sem
-- verificação e sem escolha. O registro auditável é a linha
-- `early_access_consents` (kind 'marketing', source 'email_confirmation',
-- `declaracao` opt_in|opt_out|sem_escolha, versão da política, created_at).
-- Elegibilidade para envio ≠ consentimento (EA2-IA04): `marketing_elegivel`
-- (gerada) = efetivo E não suprimido.
--
-- ⚠️ DECLARAÇÕES LEGAIS (EA2-IA05): `early_access_consents.declaracao` diz o
-- que foi declarado (Termos 'aceite'; Privacidade 'ciencia' na confirmação,
-- 'aceite' no formulário; marketing 'provisoria' no formulário). A confirmação
-- só grava sobre as versões que a tela apresentou e que batem com a inscrição.
--
-- ⚠️ VERIFICAR NÃO APROVA. A confirmação grava `email_verified_at` e não toca
-- em `status`. A triagem continua sendo decisão de admin.
--
-- ⚠️ MESMA DISCIPLINA DE ACL DA 0068: tabelas novas com RLS e zero policies,
-- REVOKE de tudo (inclusive service_role) e só SELECT de volta. Escrita só
-- pelas RPCs DEFINER. As funções internas `ea_interno_*` NÃO são executáveis
-- pelo service_role: só o dono, de dentro das RPCs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── inscrições: colunas novas e invariantes ────────────────────────────────
alter table public.early_access_signups
  add column if not exists locale                   text,
  add column if not exists email_suppressed_at      timestamptz,
  add column if not exists email_suppression_reason text,
  -- EA2-A02: consentimento de marketing EFETIVO (escolha do titular verificado)
  add column if not exists marketing_efetivo        boolean not null default false,
  add column if not exists marketing_escolhido_em   timestamptz;

alter table public.early_access_signups
  add constraint ea_locale_valido     check (locale is null or locale in ('en','pt','es','zh')),
  add constraint ea_supressao_par     check ((email_suppressed_at is null) = (email_suppression_reason is null)),
  add constraint ea_supressao_motivo  check (email_suppression_reason is null
                                             or email_suppression_reason in ('bounced','complained')),
  -- D-4: invariante de banco. Nenhuma linha aprovada sem posse de email provada.
  add constraint ea_aprovado_exige_email check (status <> 'approved' or email_verified_at is not null),
  -- EA2-A02: escolha de marketing só existe depois da prova de posse, e o
  -- consentimento efetivo só existe com escolha registrada.
  add constraint ea_marketing_escolha_exige_email check (marketing_escolhido_em is null or email_verified_at is not null),
  add constraint ea_marketing_efetivo_exige_escolha check (not marketing_efetivo or marketing_escolhido_em is not null);

-- EA2-IA04: consentimento (fato histórico do titular) ≠ entregabilidade.
-- `marketing_elegivel` é a ÚNICA coluna que diz "pode receber marketing":
-- exige consentimento efetivo E endereço não suprimido (bounce/complaint).
-- Gerada pelo banco: ninguém consegue gravá-la em desacordo com as duas.
alter table public.early_access_signups
  add column if not exists marketing_elegivel boolean
    generated always as (marketing_efetivo and email_suppressed_at is null) stored;

-- ── consentimentos: semântica EXPLÍCITA de cada declaração (EA2-IA05) ──────
-- `granted` sozinho não dizia O QUE a pessoa declarou. Agora cada linha diz:
--   terms     → 'aceite'   (aceite dos Termos, no formulário ou na confirmação)
--   privacy   → 'aceite'   no formulário (o texto do formulário diz "Aceito");
--               'ciencia'  na confirmação (o titular declara ter recebido a Política)
--   marketing → 'provisoria' no formulário (EA2-A02: nunca vale para envio);
--               'opt_in' | 'opt_out' | 'sem_escolha' na confirmação, com
--               granted = (declaracao = 'opt_in')
-- Linhas legadas (gravadas pela RPC da 0068, se houver) recebem o mapeamento
-- do formulário antes do NOT NULL.
alter table public.early_access_consents add column if not exists declaracao text;
update public.early_access_consents
   set declaracao = case kind when 'marketing' then 'provisoria' else 'aceite' end
 where declaracao is null;
alter table public.early_access_consents alter column declaracao set not null;
alter table public.early_access_consents add constraint ea_consent_declaracao check (
     (kind = 'terms' and declaracao = 'aceite')
  or (kind = 'privacy' and (
        (source =  'email_confirmation' and declaracao = 'ciencia')
     or (source <> 'email_confirmation' and declaracao = 'aceite')))
  or (kind = 'marketing' and (
        (source =  'email_confirmation' and declaracao in ('opt_in','opt_out','sem_escolha')
                                        and granted = (declaracao = 'opt_in'))
     or (source <> 'email_confirmation' and declaracao = 'provisoria')))
);

create index if not exists early_access_nao_verificados_idx
  on public.early_access_signups (created_at) where email_verified_at is null;

-- ── eventos: tipos novos (drop + add, sem editar a 0068) ───────────────────
alter table public.early_access_events drop constraint ea_evento_kind;
alter table public.early_access_events add constraint ea_evento_kind_v2 check (kind in (
  'created','duplicate_attempt','status_changed',
  'verification_issued','verification_suppressed','verification_send_failed',
  'email_verified','self_corrected','email_bounced','email_complained'));

-- ── pedidos de verificação (o token e o estado de envio dele) ──────────────
create table if not exists public.early_access_verificacoes (
  id                  uuid        primary key default gen_random_uuid(),
  signup_id           uuid        not null references public.early_access_signups(id) on delete restrict,
  -- sha256("zswap-ea:verify\0" || token) em hex. NUNCA o token.
  token_hash          text        not null unique,
  tentativa           int         not null default 1,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  revoked_at          timestamptz,
  revoked_reason      text,
  send_status         text        not null default 'pending',
  send_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  constraint eav_hash_formato   check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint eav_tentativa      check (tentativa between 1 and 3),
  constraint eav_ttl_24h        check (expires_at = created_at + interval '24 hours'),
  constraint eav_uso_xor_revoga check (consumed_at is null or revoked_at is null),
  constraint eav_motivo_par     check ((revoked_at is null) = (revoked_reason is null)),
  constraint eav_motivo_valido  check (revoked_reason is null
                                       or revoked_reason in ('superseded','send_failed','confirmed')),
  -- EA2-IA01: 'failed' = falha TRANSITÓRIA (volta ao retry); 'dead' = falha
  -- PERMANENTE (rejeição do provider, credencial, resposta inválida): TERMINAL,
  -- nunca volta à fila automática. A classificação vem explícita do adaptador.
  constraint eav_send_status    check (send_status in ('pending','sent','failed','dead')),
  constraint eav_falha_tem_codigo check (send_status not in ('failed','dead') or send_error is not null),
  constraint eav_enviado_par    check ((send_status = 'sent') = (sent_at is not null)),
  constraint eav_send_error     check (send_error is null or send_error ~ '^[a-z0-9_]{1,40}$'),
  constraint eav_provider_id    check (provider_message_id is null
                                       or (char_length(provider_message_id) between 1 and 200
                                           and provider_message_id ~ '^[!-~]+$'))
);
-- D-3: no máximo UM token ativo (nem consumido nem revogado) por inscrição.
create unique index if not exists early_access_verificacao_ativa_uq
  on public.early_access_verificacoes (signup_id) where consumed_at is null and revoked_at is null;
create unique index if not exists early_access_verificacao_msg_uq
  on public.early_access_verificacoes (provider_message_id) where provider_message_id is not null;
create index if not exists early_access_verificacoes_signup_idx
  on public.early_access_verificacoes (signup_id, created_at desc);
create index if not exists early_access_verificacoes_created_idx
  on public.early_access_verificacoes (created_at);

-- ── webhooks do provider: idempotência e audit (sem email, sem payload) ────
-- EA2-IA03: o mínimo para IDEMPOTÊNCIA e nada que o provider resolva de volta
-- para a pessoa. Nem o `svix-id` cru (o painel do provider mostra a entrega
-- com o destinatário) nem o `provider_message_id` ficam aqui: só um hash de
-- mão única do id do evento. A ligação mensagem→inscrição mora SÓ em
-- `early_access_verificacoes.provider_message_id`, que a purga apaga.
create table if not exists public.early_access_webhook_eventos (
  id                  uuid        primary key default gen_random_uuid(),
  evento_hash         text        not null unique,
  tipo                text        not null,
  resultado           text        not null,
  recebido_em         timestamptz not null default now(),
  constraint eaw_evento_hash check (evento_hash ~ '^[0-9a-f]{64}$'),
  constraint eaw_tipo        check (tipo ~ '^[a-z][a-z._]{0,59}$'),
  constraint eaw_resultado   check (resultado in ('processado','sem_alvo','ignorado'))
);

-- ── lápide de purga (D-7): o mínimo, sem nada que reconstrua o apagado ─────
create table if not exists public.early_access_purges (
  id                 uuid        primary key default gen_random_uuid(),
  signup_id          uuid        not null,           -- sem FK: a linha não existe mais
  motivo             text        not null,
  status_no_momento  text        not null,
  purged_at          timestamptz not null default now(),
  constraint eap_motivo check (motivo in ('unverified_retention','declined')),
  constraint eap_status check (status_no_momento in ('pending','approved','rejected','blocked'))
);

-- ── RLS + ACL ───────────────────────────────────────────────────────────────
alter table public.early_access_verificacoes    enable row level security;
alter table public.early_access_webhook_eventos enable row level security;
alter table public.early_access_purges          enable row level security;

revoke all on table public.early_access_verificacoes    from public, anon, authenticated, service_role;
revoke all on table public.early_access_webhook_eventos from public, anon, authenticated, service_role;
revoke all on table public.early_access_purges          from public, anon, authenticated, service_role;

grant select on table public.early_access_verificacoes    to service_role;
grant select on table public.early_access_webhook_eventos to service_role;
grant select on table public.early_access_purges          to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNÇÕES INTERNAS — só o dono executa (chamadas de dentro das RPCs)
-- ═══════════════════════════════════════════════════════════════════════════

-- Emite um token novo para a inscrição: revoga TODOS os ativos e insere o
-- novo, respeitando cooldown/cap (pedidos públicos) e o teto global (sempre).
-- Grava `verification_issued` ou `verification_suppressed`. Devolve se emitiu.
-- ⚠️ Quem chama já TRAVOU a linha da inscrição.
-- ⚠️ EA2-IA02: a revogação dos tokens ativos acontece AQUI, só DEPOIS de todas
-- as checagens passarem. Suprimido (teto, retenção, cooldown) = NADA muda: o
-- token vigente continua exatamente como estava — e, se era candidato a
-- retry, continua candidato. Nenhum caminho deixa a inscrição sem token por
-- ter tentado trocá-lo. `p_motivo_revogacao` diz por que o anterior caiu.
create or replace function public.ea_interno_emitir(
  p_signup uuid, p_hash text, p_tentativa int, p_publico boolean, p_motivo_revogacao text
) returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare
  v_motivo text;
begin
  -- Teto global serializado: duas inscrições simultâneas não passam juntas do limite.
  perform pg_advisory_xact_lock(hashtext('early_access_envio_global'));

  -- D-3: nenhum token pode sobreviver ao pedido. A inscrição não verificada
  -- é purgada aos 7 dias; com TTL de 24 h, emitir depois de 6 dias daria um
  -- link "válido" para um pedido que vai sumir antes dele.
  if (select created_at from public.early_access_signups where id = p_signup) < now() - interval '6 days' then
    v_motivo := 'retencao';
  elsif p_publico then
    if exists (select 1 from public.early_access_verificacoes
                where signup_id = p_signup and created_at > now() - interval '10 minutes') then
      v_motivo := 'cooldown';
    elsif (select count(*) from public.early_access_verificacoes
            where signup_id = p_signup and created_at > now() - interval '24 hours') >= 5 then
      v_motivo := 'cap_diario';
    end if;
  end if;
  if v_motivo is null
     and (select count(*) from public.early_access_verificacoes
           where created_at > now() - interval '1 hour') >= 600 then
    v_motivo := 'teto_global';
  end if;

  if v_motivo is not null then
    insert into public.early_access_events (signup_id, kind, actor, meta)
    values (p_signup, 'verification_suppressed', case when p_publico then 'public' else 'system' end,
            jsonb_build_object('motivo', v_motivo));
    return false;
  end if;

  update public.early_access_verificacoes
     set revoked_at = now(), revoked_reason = p_motivo_revogacao
   where signup_id = p_signup and consumed_at is null and revoked_at is null;

  insert into public.early_access_verificacoes (signup_id, token_hash, tentativa, expires_at)
  values (p_signup, p_hash, p_tentativa, now() + interval '24 hours');

  insert into public.early_access_events (signup_id, kind, actor, meta)
  values (p_signup, 'verification_issued', case when p_publico then 'public' else 'system' end,
          jsonb_build_object('tentativa', p_tentativa));
  return true;
end;
$$;

-- Purga UMA inscrição NÃO verificada: tokens, eventos, consentimentos e a
-- linha; grava a lápide. Indicações que apontavam para ela viram NULL pela FK.
-- Nunca apaga inscrição verificada (o filtro está no próprio SELECT).
create or replace function public.ea_interno_purgar(p_id uuid, p_motivo text)
returns boolean
language plpgsql set search_path = public, pg_temp as $$
declare
  v_status text;
begin
  select status into v_status from public.early_access_signups
   where id = p_id and email_verified_at is null for update;
  if not found then return false; end if;

  delete from public.early_access_verificacoes where signup_id = p_id;
  delete from public.early_access_events       where signup_id = p_id;
  delete from public.early_access_consents     where signup_id = p_id;
  delete from public.early_access_signups      where id = p_id;

  insert into public.early_access_purges (signup_id, motivo, status_no_momento)
  values (p_id, p_motivo, v_status);
  return true;
end;
$$;

revoke all on function public.ea_interno_emitir(uuid, text, int, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.ea_interno_purgar(uuid, text)               from public, anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- ── inscrição pública (substitui a da 0068: + locale, + hash do token) ─────
-- Devolve {resultado: 'criado'|'existente', envio: bool} para a APLICAÇÃO. A
-- rota pública não ramifica a resposta por nenhum dos dois (anti-enumeração);
-- `envio` só diz se ela deve mandar o email com o token que tem em memória.
drop function if exists public.early_access_inscrever(
  text, text, text, text, text, text, text, text, text[], text, text, text, text, text,
  text, text, text, text, text, boolean, text);

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
  p_ip_hmac             text,
  p_locale              text,
  p_token_hash          text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ex         record;
  v_id         uuid;
  v_ref        uuid;
  v_ref_ip     text;
  v_ref_wallet text;
  v_ref_chain  text;
  v_flag       text;
  v_codigo     text;
  v_restricao  text;
  v_envio      boolean := false;
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
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'early_access_token_hash_invalido' using errcode = 'P0001';
  end if;

  -- ⚠️ DUPLICADO NÃO TOCA EM NADA (nem carteira, UTM, referral, consentimento
  -- nem nome). Só o evento, e — se a inscrição ainda espera confirmação — um
  -- token NOVO, sujeito a cooldown e cap (D-3, D-5).
  select id, status, email_verified_at, email_suppressed_at into v_ex
    from public.early_access_signups where email_normalized = p_email for update;
  if found then
    insert into public.early_access_events (signup_id, kind, actor)
    values (v_ex.id, 'duplicate_attempt', 'public');
    if p_token_hash is not null and v_ex.status = 'pending'
       and v_ex.email_verified_at is null and v_ex.email_suppressed_at is null then
      v_envio := public.ea_interno_emitir(v_ex.id, p_token_hash, 1, true, 'superseded');
    end if;
    return jsonb_build_object('resultado', 'existente', 'envio', v_envio);
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
        -- ⚠️ SINAL, NÃO PROVA (NAT). Nada é bloqueado nem desfeito por isto.
        v_flag := 'sinal_mesmo_ip';
      end if;
    end if;
  end if;

  foreach v_codigo in array p_codigos_candidatos loop
    begin
      insert into public.early_access_signups (
        email_normalized, display_name, country,
        wallet_address, wallet_chain, telegram_handle, x_handle,
        referral_code, referred_by_signup_id, referral_flag,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_path, referrer_host, source,
        terms_version, privacy_version, accepted_at, marketing_opt_in, ip_hmac, locale
      ) values (
        p_email, p_display_name, p_country,
        p_wallet_address, p_wallet_chain, p_telegram_handle, p_x_handle,
        v_codigo, v_ref, v_flag,
        p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term,
        p_landing_path, p_referrer_host, p_source,
        p_terms_version, p_privacy_version, now(), coalesce(p_marketing_opt_in, false), p_ip_hmac, p_locale
      )
      on conflict (email_normalized) do nothing
      returning id into v_id;

      if v_id is null then
        -- Corrida: o mesmo email entrou entre o SELECT e o INSERT. Mesmo
        -- tratamento do duplicado, sem token (o vencedor já emitiu o dele).
        select id into v_id from public.early_access_signups where email_normalized = p_email;
        insert into public.early_access_events (signup_id, kind, actor)
        values (v_id, 'duplicate_attempt', 'public');
        return jsonb_build_object('resultado', 'existente', 'envio', false);
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

  -- Estes consentimentos são a DECLARAÇÃO de quem enviou o formulário. O do
  -- TITULAR é o `source='email_confirmation'` gravado na confirmação.
  insert into public.early_access_consents (signup_id, kind, version, granted, source, ip_hmac, declaracao) values
    (v_id, 'terms',     p_terms_version,   true,                               p_source, p_ip_hmac, 'aceite'),
    (v_id, 'privacy',   p_privacy_version, true,                               p_source, p_ip_hmac, 'aceite'),
    (v_id, 'marketing', p_privacy_version, coalesce(p_marketing_opt_in, false), p_source, p_ip_hmac, 'provisoria');

  insert into public.early_access_events (signup_id, kind, actor) values (v_id, 'created', 'public');

  if p_token_hash is not null then
    v_envio := public.ea_interno_emitir(v_id, p_token_hash, 1, true, 'superseded');
  end if;

  return jsonb_build_object('resultado', 'criado', 'envio', v_envio);
end;
$$;

-- ── resultado do envio ──────────────────────────────────────────────────────
-- Só muda quem ainda está `pending`; nunca "desrevoga" nem reabre token.
-- EA2-IA01: falha exige `p_transitorio` EXPLÍCITO (nulo = erro): transitória →
-- 'failed' (retry); permanente → 'dead' (terminal, fora da fila para sempre).
create or replace function public.early_access_registrar_envio(
  p_token_hash text, p_ok boolean, p_erro text, p_provider_id text, p_transitorio boolean
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_signup uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_ok is null
     or (not p_ok and p_transitorio is null) then
    raise exception 'early_access_parametro_invalido' using errcode = 'P0001';
  end if;
  update public.early_access_verificacoes
     set send_status         = case when p_ok then 'sent' when p_transitorio then 'failed' else 'dead' end,
         sent_at             = case when p_ok then now() end,
         send_error          = case when p_ok then null else coalesce(p_erro, 'desconhecido') end,
         provider_message_id = case when p_ok then p_provider_id end
   where token_hash = p_token_hash and send_status = 'pending'
   returning signup_id into v_signup;
  if v_signup is null then return false; end if;
  if not p_ok then
    insert into public.early_access_events (signup_id, kind, actor, meta)
    values (v_signup, 'verification_send_failed', 'system',
            jsonb_build_object('codigo', coalesce(p_erro, 'desconhecido'), 'terminal', not p_transitorio));
  end if;
  return true;
end;
$$;

-- ── retry: quem precisa de reenvio (só ids, sem PII) ───────────────────────
create or replace function public.early_access_pendentes_de_envio(p_limite int)
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id
    from public.early_access_verificacoes v
    join public.early_access_signups s on s.id = v.signup_id
   where v.consumed_at is null and v.revoked_at is null and v.expires_at > now()
     and v.tentativa < 3
     and (v.send_status = 'failed'
          or (v.send_status = 'pending' and v.created_at < now() - interval '5 minutes'))
     and s.status = 'pending' and s.email_verified_at is null and s.email_suppressed_at is null
   order by v.created_at
   limit least(greatest(coalesce(p_limite, 1), 1), 50);
$$;

-- Emite o próximo token (tentativa+1) no lugar do que não chegou. É o ÚNICO
-- caminho em que o email sai do banco para envio, e só para inscrição que
-- ainda espera confirmação. Devolve null se não houver o que reenviar.
-- EA2-IA01: só aceita exatamente o que a fila aceita ('failed', ou 'pending'
-- há > 5 min) — 'dead' nunca. EA2-IA02: o token antigo só cai DENTRO da
-- emissão bem-sucedida; emissão suprimida deixa tudo como estava.
create or replace function public.early_access_reemitir(p_id uuid, p_token_hash text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid  uuid;
  v_s    record;
  v_t    record;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'early_access_token_hash_invalido' using errcode = 'P0001';
  end if;
  select signup_id into v_sid from public.early_access_verificacoes where id = p_id;
  if v_sid is null then return null; end if;
  -- ordem de lock: inscrição → token (a mesma de inscrever/confirmar)
  select id, status, email_normalized, locale, email_verified_at, email_suppressed_at into v_s
    from public.early_access_signups where id = v_sid for update;
  select * into v_t from public.early_access_verificacoes where id = p_id for update;
  if v_s.id is null or v_t.id is null
     or v_t.consumed_at is not null or v_t.revoked_at is not null or v_t.expires_at <= now()
     or v_t.tentativa >= 3
     or not (v_t.send_status = 'failed'
             or (v_t.send_status = 'pending' and v_t.created_at < now() - interval '5 minutes'))
     or v_s.status <> 'pending' or v_s.email_verified_at is not null or v_s.email_suppressed_at is not null then
    return null;
  end if;

  if not public.ea_interno_emitir(v_sid, p_token_hash, v_t.tentativa + 1, false, 'send_failed') then
    return null;   -- suprimido: o token antigo segue ativo e na fila (nada encalha)
  end if;
  return jsonb_build_object('email', v_s.email_normalized, 'locale', coalesce(v_s.locale, 'en'));
end;
$$;

-- ── preview: o que o titular vai confirmar (só leitura, não estende nada) ──
create or replace function public.early_access_token_preview(p_token_hash text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'display_name',     s.display_name,
           'country',          s.country,
           'terms_version',    s.terms_version,
           'privacy_version',  s.privacy_version)
           -- EA2-A02: a declaração provisória de marketing NÃO é exposta: a
           -- escolha do titular não pode vir pré-preenchida por terceiro.
    from public.early_access_verificacoes v
    join public.early_access_signups s on s.id = v.signup_id
   where p_token_hash ~ '^[0-9a-f]{64}$'
     and v.token_hash = p_token_hash
     and v.consumed_at is null and v.revoked_at is null and v.expires_at > now()
     and s.status = 'pending' and s.email_verified_at is null;
$$;

-- ── confirmação: prova de posse + consentimento do titular ─────────────────
-- Uso único. Só `display_name` e `country` podem ser corrigidos (D-6); email
-- nunca. Tudo numa transação: correção, verificação, consumo, consentimentos
-- e eventos — ou nada. NÃO muda o status (verificar não aprova).
-- EA2-A02: `p_marketing_opt_in` é a escolha EXPLÍCITA do titular; nulo
-- (sem escolha) = OPT-OUT. A declaração do formulário não entra aqui.
-- EA2-IA05: a confirmação é uma DECLARAÇÃO do titular sobre documentos que ele
-- VIU nesta tela. A tela mostra as versões (vindas da preview) e o botão diz
-- o que significa clicar; a aplicação devolve AS MESMAS versões em
-- `p_versao_termos`/`p_versao_privacidade`. Ausentes ou diferentes das da
-- inscrição → `early_access_versao_divergente`, e NADA é gravado: o banco não
-- registra declaração sobre versão que não fez parte do fluxo. O registro diz
-- o tipo exato: Termos = 'aceite'; Privacidade = 'ciencia' (recebimento,
-- não "consentimento"); marketing = opt_in | opt_out | sem_escolha.
create or replace function public.early_access_confirmar_email(
  p_token_hash text, p_versao_termos text, p_versao_privacidade text,
  p_display_name text, p_country text, p_ip_hmac text,
  p_marketing_opt_in boolean default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid    uuid;
  v_s      record;
  v_t      record;
  v_campos text[] := '{}';
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('resultado', 'invalido');
  end if;
  select signup_id into v_sid from public.early_access_verificacoes where token_hash = p_token_hash;
  if v_sid is null then return jsonb_build_object('resultado', 'invalido'); end if;

  select * into v_s from public.early_access_signups where id = v_sid for update;
  select * into v_t from public.early_access_verificacoes where token_hash = p_token_hash for update;
  if v_s.id is null or v_t.id is null then return jsonb_build_object('resultado', 'invalido'); end if;

  if v_t.consumed_at is not null then
    -- clique repetido / abas concorrentes: idempotente, sem devolver o código
    return jsonb_build_object('resultado',
      case when v_s.email_verified_at is not null then 'ja_confirmado' else 'invalido' end);
  end if;
  if v_t.revoked_at is not null or v_t.expires_at <= now()
     or v_s.status <> 'pending' or v_s.email_verified_at is not null then
    return jsonb_build_object('resultado', 'invalido');
  end if;

  -- EA2-IA05: só se registra declaração sobre a versão que a tela apresentou
  if p_versao_termos is distinct from v_s.terms_version
     or p_versao_privacidade is distinct from v_s.privacy_version then
    raise exception 'early_access_versao_divergente' using errcode = 'P0001';
  end if;

  if p_display_name is not null and p_display_name is distinct from v_s.display_name then
    v_campos := v_campos || 'display_name'::text;
  end if;
  if p_country is not null and p_country is distinct from v_s.country then
    v_campos := v_campos || 'country'::text;
  end if;

  begin
    update public.early_access_signups
       set display_name      = coalesce(p_display_name, display_name),
           country           = coalesce(p_country, country),
           email_verified_at = now(),
           marketing_efetivo      = coalesce(p_marketing_opt_in, false),
           -- EA2-IA09: só ESCOLHA tem momento de escolha; sem escolha = NULL
           marketing_escolhido_em = case when p_marketing_opt_in is null then null else now() end,
           updated_at        = now()
     where id = v_sid;
  exception when check_violation then
    raise exception 'early_access_correcao_invalida' using errcode = 'P0001';
  end;

  update public.early_access_verificacoes set consumed_at = now() where id = v_t.id;
  update public.early_access_verificacoes
     set revoked_at = now(), revoked_reason = 'confirmed'
   where signup_id = v_sid and id <> v_t.id and consumed_at is null and revoked_at is null;

  -- O consentimento do TITULAR, às versões que a inscrição declarou. Marketing
  -- = a escolha explícita feita AGORA (EA2-A02), nunca a declaração provisória.
  insert into public.early_access_consents (signup_id, kind, version, granted, source, ip_hmac, declaracao) values
    (v_sid, 'terms',     p_versao_termos,      true,                                'email_confirmation', p_ip_hmac, 'aceite'),
    (v_sid, 'privacy',   p_versao_privacidade, true,                                'email_confirmation', p_ip_hmac, 'ciencia'),
    (v_sid, 'marketing', p_versao_privacidade, coalesce(p_marketing_opt_in, false), 'email_confirmation', p_ip_hmac,
       case when p_marketing_opt_in is true then 'opt_in' when p_marketing_opt_in is false then 'opt_out' else 'sem_escolha' end);

  -- contexto da escolha no audit (sem PII): opt_in | opt_out | sem_escolha (= opt-out)
  insert into public.early_access_events (signup_id, kind, actor, meta)
  values (v_sid, 'email_verified', 'public', jsonb_build_object('marketing',
    case when p_marketing_opt_in is true then 'opt_in'
         when p_marketing_opt_in is false then 'opt_out' else 'sem_escolha' end));
  if cardinality(v_campos) > 0 then
    -- só os NOMES dos campos; os valores antigos e novos não vão para o audit
    insert into public.early_access_events (signup_id, kind, actor, meta)
    values (v_sid, 'self_corrected', 'public', jsonb_build_object('campos', to_jsonb(v_campos)));
  end if;

  return jsonb_build_object('resultado', 'confirmado', 'referral_code', v_s.referral_code);
end;
$$;

-- ── "não fui eu" (D-7): autenticado pelo token, purga na hora ──────────────
create or replace function public.early_access_recusar_email(p_token_hash text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid uuid;
  v_s   record;
  v_t   record;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return 'invalido'; end if;
  select signup_id into v_sid from public.early_access_verificacoes where token_hash = p_token_hash;
  if v_sid is null then return 'invalido'; end if;
  select id, status, email_verified_at into v_s from public.early_access_signups where id = v_sid for update;
  select * into v_t from public.early_access_verificacoes where token_hash = p_token_hash for update;
  if v_s.id is null or v_t.id is null
     or v_t.consumed_at is not null or v_t.revoked_at is not null or v_t.expires_at <= now()
     or v_s.status <> 'pending' or v_s.email_verified_at is not null then
    return 'invalido';
  end if;
  if not public.ea_interno_purgar(v_sid, 'declined') then return 'invalido'; end if;
  return 'recusado';
end;
$$;

-- ── purga por retenção (D-3: 7 dias, constante aqui) ───────────────────────
create or replace function public.early_access_purgar_nao_verificados(p_limite int)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  n    int := 0;
begin
  for v_id in
    select id from public.early_access_signups
     where email_verified_at is null and created_at < now() - interval '7 days'
     order by created_at
     limit least(greatest(coalesce(p_limite, 1), 1), 500)
     for update skip locked
  loop
    if public.ea_interno_purgar(v_id, 'unverified_retention') then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- ── webhook do provider (D-10): idempotente; quem chama já autenticou ──────
create or replace function public.early_access_registrar_webhook(
  p_evento_id text, p_tipo text, p_provider_message_id text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid;
  v_signup uuid;
  v_res    text;
begin
  if p_evento_id is null or p_evento_id !~ '^[!-~]{1,100}$'
     or p_tipo is null or p_tipo !~ '^[a-z][a-z._]{0,59}$'
     or (p_provider_message_id is not null
         and (char_length(p_provider_message_id) > 200 or p_provider_message_id !~ '^[!-~]+$')) then
    raise exception 'early_access_webhook_invalido' using errcode = 'P0001';
  end if;

  if p_tipo not in ('email.bounced','email.complained') then
    v_res := 'ignorado';
  else
    select signup_id into v_signup from public.early_access_verificacoes
     where provider_message_id = p_provider_message_id;
    v_res := case when v_signup is null then 'sem_alvo' else 'processado' end;
  end if;

  insert into public.early_access_webhook_eventos (evento_hash, tipo, resultado)
  values (encode(sha256(convert_to('zswap-ea:webhook|' || p_evento_id, 'UTF8')), 'hex'), p_tipo, v_res)
  on conflict (evento_hash) do nothing
  returning id into v_id;
  if v_id is null then return 'duplicado'; end if;   -- reentrega: nenhum efeito novo

  if v_res = 'processado' then
    update public.early_access_signups
       set email_suppressed_at      = coalesce(email_suppressed_at, now()),
           email_suppression_reason = coalesce(email_suppression_reason,
                                        case when p_tipo = 'email.bounced' then 'bounced' else 'complained' end),
           updated_at               = now()
     where id = v_signup;
    insert into public.early_access_events (signup_id, kind, actor)
    values (v_signup, case when p_tipo = 'email.bounced' then 'email_bounced' else 'email_complained' end, 'system');
  end if;
  return v_res;
end;
$$;

-- ── transição (mesma assinatura da 0068) + D-4 ─────────────────────────────
create or replace function public.early_access_transicionar(
  p_id uuid, p_para text, p_ator text, p_motivo text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_de     text;
  v_conv   timestamptz;
  v_verif  timestamptz;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if p_ator is null or btrim(p_ator) = '' then
    raise exception 'early_access_ator_obrigatorio' using errcode = 'P0001';
  end if;

  select status, converted_at, email_verified_at into v_de, v_conv, v_verif
    from public.early_access_signups where id = p_id for update;
  if not found then
    raise exception 'early_access_nao_encontrado' using errcode = 'P0001';
  end if;

  if not public.early_access_transicao_permitida(v_de, p_para) then
    raise exception 'early_access_transicao_proibida' using errcode = 'P0001';
  end if;

  -- D-4: aprovar exige posse de email provada (o CHECK da tabela também barra).
  if p_para = 'approved' and v_verif is null then
    raise exception 'early_access_email_nao_verificado' using errcode = 'P0001';
  end if;

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

  -- ⚠️ SEM EVENTO, SEM MUDANÇA (mesma transação).
  insert into public.early_access_events (signup_id, kind, from_status, to_status, actor, reason)
  values (p_id, 'status_changed', v_de, p_para, p_ator, v_motivo);

  return jsonb_build_object('de', v_de, 'para', p_para);
end;
$$;

-- ── ACL das funções ─────────────────────────────────────────────────────────
revoke all on function public.early_access_inscrever(
  text, text, text, text, text, text, text, text, text[], text, text, text, text, text,
  text, text, text, text, text, boolean, text, text, text)          from public, anon, authenticated;
revoke all on function public.early_access_registrar_envio(text, boolean, text, text, boolean) from public, anon, authenticated;
revoke all on function public.early_access_pendentes_de_envio(int)                     from public, anon, authenticated;
revoke all on function public.early_access_reemitir(uuid, text)                        from public, anon, authenticated;
revoke all on function public.early_access_token_preview(text)                         from public, anon, authenticated;
revoke all on function public.early_access_confirmar_email(text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.early_access_recusar_email(text)                         from public, anon, authenticated;
revoke all on function public.early_access_purgar_nao_verificados(int)                 from public, anon, authenticated;
revoke all on function public.early_access_registrar_webhook(text, text, text)         from public, anon, authenticated;
revoke all on function public.early_access_transicionar(uuid, text, text, text)        from public, anon, authenticated;

grant execute on function public.early_access_inscrever(
  text, text, text, text, text, text, text, text, text[], text, text, text, text, text,
  text, text, text, text, text, boolean, text, text, text)          to service_role;
grant execute on function public.early_access_registrar_envio(text, boolean, text, text, boolean) to service_role;
grant execute on function public.early_access_pendentes_de_envio(int)                     to service_role;
grant execute on function public.early_access_reemitir(uuid, text)                        to service_role;
grant execute on function public.early_access_token_preview(text)                         to service_role;
grant execute on function public.early_access_confirmar_email(text, text, text, text, text, text, boolean) to service_role;
grant execute on function public.early_access_recusar_email(text)                         to service_role;
grant execute on function public.early_access_purgar_nao_verificados(int)                 to service_role;
grant execute on function public.early_access_registrar_webhook(text, text, text)         to service_role;
grant execute on function public.early_access_transicionar(uuid, text, text, text)        to service_role;
