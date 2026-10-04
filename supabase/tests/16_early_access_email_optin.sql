\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 16 — EARLY ACCESS FASE 2: EMAIL DOUBLE OPT-IN
-- Migration: 0069_early_access_email_optin.sql · Especificação: docs/PLANO-EARLY-ACCESS-FASE2.md §12
--
-- ⚠️ Mesmo ambiente do 15 (default privileges do Supabase, cadeia 0001→0069).
-- NUNCA contra produção. Tudo dentro de BEGIN … ROLLBACK.
--
-- O tempo dentro de uma transação é constante (`now()`). Para simular "10 min
-- depois", "25 h depois" e "8 dias depois", o DONO desloca `created_at` (e
-- `expires_at` junto, para o CHECK do TTL continuar valendo) para o passado.
--
--   T16.1   tabelas novas: RLS ligada, zero policies
--   T16.2   anon/authenticated sem nada; service_role só SELECT; escrita direta negada
--   T16.3   RPCs: EXECUTE só service_role, DEFINER, search_path fixo; internas fechadas; sem overload
--   T16.4   inscrição nova: verificação com TTL de exatamente 24 h + evento
--   T16.5   hash fora do formato é recusado
--   T16.6   duplicado pendente: cooldown suprime; depois, reenvio revoga o anterior (um ativo só); dados intactos
--   T16.7   cap de 5 tokens/24 h por inscrição
--   T16.8   verificado / blocked / suprimido: duplicado não emite token
--   T16.9   confirmação: uso único, consentimentos do titular, eventos, status inalterado, referral_code
--   T16.10  replay, revogado e expirado → invalido; expirado nunca confirma
--   T16.11  correção só nome/país; inválida não deixa efeito parcial; audit sem valores
--   T16.12  D-4: CHECK e RPC recusam aprovar não verificado; verificado aprova
--   T16.13  preview não consome, não estende, e some quando o token não vale
--   T16.14  "não fui eu": purga na hora + lápide sem PII; token inválido não purga
--   T16.15  purga por retenção: só não verificadas > 7 dias; verificadas intactas
--   T16.16  retry: pendentes → reemitir (tentativa+1, revoga) → registrar_envio
--   T16.17  webhook: idempotente; bounce suprime reenvio; sem alvo / tipo desconhecido sem efeito
--   T16.18  nenhuma coluna de email ou de token cru nas tabelas novas
--   T16.9c  EA2-A02: opt-in/opt-out explícitos, preview sem a declaração provisória, CHECK
--   T16.7b  EA2-A01: nenhum token emitido depois de 6 dias (sobreviveria à purga)
--   T16.19  EA2-IA01: falha permanente = dead (terminal); transitória = failed (fila)
--   T16.20  EA2-IA02: emissão suprimida não revoga o token vigente (inscrição não encalha)
--   T16.21  EA2-IA03: webhook só com evento_hash; purga apaga a ligação mensagem→sujeito
--   T16.22  EA2-IA04: marketing_elegivel = efetivo E não suprimido (coluna gerada)
--   T16.23  EA2-IA05: declaração só sobre versão apresentada; semântica aceite/ciencia/opt_*
--   T16.24  EA2-IA06: sem_escolha, opt_in, opt_out distintos
--   T16.25  EA2-A02 (reprova): efetivo exige verificação + opt-in explícito (banco inteiro)
--   T16.26  EA2-IA09: sem escolha não tem marketing_escolhido_em
--   T16.27  EA2-IA07: nota do operador some na purga; nenhuma RPC escreve admin_audit_log
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- hash de teste no formato real (sha256 hex) a partir de um rótulo
create function pg_temp.h(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to('t16:' || p, 'UTF8')), 'hex');
$$;
create function pg_temp.insc(p_email text, p_codigo text, p_hash text) returns jsonb language sql as $$
  select public.early_access_inscrever(
    p_email, 'Pessoa Teste', 'BR', null, null, null, null, null, array[p_codigo],
    null, null, null, null, null, '/early-access', null, 'early_access_page',
    'tos-2026-10', 'priv-2026-10', true, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'pt', p_hash);
$$;
grant execute on function pg_temp.h(text) to service_role;
grant execute on function pg_temp.insc(text, text, text) to service_role;
-- desloca no tempo tudo o que a inscrição tem (só o dono pode)
create function pg_temp.envelhecer(p_email text, p_int interval) returns void language sql as $$
  update public.early_access_verificacoes
     set created_at = created_at - p_int, expires_at = expires_at - p_int
   where signup_id = (select id from public.early_access_signups where email_normalized = p_email);
  update public.early_access_signups set created_at = created_at - p_int where email_normalized = p_email;
$$;

-- ── T16.1 ───────────────────────────────────────────────────────────────────
do $$
declare r record; n int := 0;
begin
  for r in select c.relname, c.relrowsecurity, (select count(*) from pg_policy where polrelid = c.oid) pol
             from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public'
              and c.relname in ('early_access_verificacoes','early_access_webhook_eventos','early_access_purges') loop
    if not r.relrowsecurity then raise exception 'T16.1: % sem RLS', r.relname; end if;
    if r.pol <> 0 then raise exception 'T16.1: % tem % policies', r.relname, r.pol; end if;
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'T16.1: esperava 3 tabelas, achei %', n; end if;
  raise notice 'T16.1 OK — 3 tabelas novas, RLS ligada, zero policies';
end $$;

-- ── T16.2 ───────────────────────────────────────────────────────────────────
do $$
declare t text; r text; p text; op text; estado text; n int := 0;
begin
  foreach t in array array['early_access_verificacoes','early_access_webhook_eventos','early_access_purges'] loop
    if exists (select 1 from pg_class c, aclexplode(c.relacl) a
                where c.oid = ('public.'||t)::regclass and a.grantee = 0) then
      raise exception 'T16.2: PUBLIC tem privilegio em %', t;
    end if;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      foreach r in array array['anon','authenticated'] loop
        if has_table_privilege(r, 'public.'||t, p) then raise exception 'T16.2: % tem % em %', r, p, t; end if;
      end loop;
      if has_table_privilege('service_role', 'public.'||t, p) is distinct from (p = 'SELECT') then
        raise exception 'T16.2: service_role % em % divergente', p, t;
      end if;
      n := n + 1;
    end loop;
    foreach op in array array['insert','update','delete','truncate'] loop
      estado := null;
      begin
        execute 'set local role service_role';
        if op = 'insert' then execute format('insert into public.%I default values', t);
        elsif op = 'update' then execute format('update public.%I set id = id', t);
        elsif op = 'delete' then execute format('delete from public.%I', t);
        else execute format('truncate public.%I', t);
        end if;
        estado := 'EXECUTOU';
      exception when others then estado := sqlstate;
      end;
      execute 'reset role';
      if estado is distinct from '42501' then raise exception 'T16.2: service_role % em % → %', op, t, estado; end if;
    end loop;
  end loop;
  -- as colunas novas de signups não abriram nada para anon/authenticated
  if exists (select 1 from information_schema.column_privileges
              where table_schema = 'public' and table_name like 'early_access_%'
                and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception 'T16.2: privilegio de coluna aberto';
  end if;
  raise notice 'T16.2 OK — % combinacoes conferidas; service_role so SELECT; escrita direta negada (42501)', n;
end $$;

-- ── T16.3 ───────────────────────────────────────────────────────────────────
do $$
declare r record; n int := 0; f text;
  rpcs text[] := array['early_access_inscrever','early_access_registrar_envio','early_access_pendentes_de_envio',
                       'early_access_reemitir','early_access_token_preview','early_access_confirmar_email',
                       'early_access_recusar_email','early_access_purgar_nao_verificados',
                       'early_access_registrar_webhook','early_access_transicionar'];
begin
  foreach f in array rpcs loop
    for r in select p.oid, p.oid::regprocedure::text sig, p.prosecdef, p.proconfig
               from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and p.proname = f loop
      if not r.prosecdef then raise exception 'T16.3: % nao e DEFINER', r.sig; end if;
      if r.proconfig is null or not ('search_path=public, pg_temp' = any(r.proconfig)) then
        raise exception 'T16.3: % sem search_path fixo', r.sig;
      end if;
      if has_function_privilege('anon', r.oid, 'EXECUTE') or has_function_privilege('authenticated', r.oid, 'EXECUTE')
         or not has_function_privilege('service_role', r.oid, 'EXECUTE') then
        raise exception 'T16.3: ACL de % errada', r.sig;
      end if;
      if exists (select 1 from pg_proc p2, aclexplode(p2.proacl) a where p2.oid = r.oid and a.grantee = 0) then
        raise exception 'T16.3: PUBLIC executa %', r.sig;
      end if;
      n := n + 1;
    end loop;
  end loop;
  if n <> array_length(rpcs, 1) then raise exception 'T16.3: esperava % RPCs (sem overload), achei %', array_length(rpcs, 1), n; end if;
  -- a assinatura de 21 argumentos da 0068 não existe mais
  if (select count(*) from pg_proc where proname = 'early_access_inscrever') <> 1
     or (select pronargs from pg_proc where proname = 'early_access_inscrever') <> 23 then
    raise exception 'T16.3: early_access_inscrever com overload ou assinatura inesperada';
  end if;
  -- as internas: ninguém além do dono executa
  for r in select p.oid, p.oid::regprocedure::text sig, p.prosecdef from pg_proc p
            where p.proname in ('ea_interno_emitir','ea_interno_purgar') loop
    if r.prosecdef then raise exception 'T16.3: % nao deveria ser DEFINER', r.sig; end if;
    if has_function_privilege('service_role', r.oid, 'EXECUTE') or has_function_privilege('anon', r.oid, 'EXECUTE')
       or has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'T16.3: interna % executavel por papel da aplicacao', r.sig;
    end if;
  end loop;
  raise notice 'T16.3 OK — % RPCs DEFINER/search_path/ACL; inscrever 23 args sem overload; internas fechadas', n;
end $$;

set local role service_role;
-- service_role não chama as internas
do $$
declare ok boolean := false;
begin
  begin perform public.ea_interno_purgar(gen_random_uuid(), 'declined');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'T16.3b: service_role executou ea_interno_purgar'; end if;
  raise notice 'T16.3b OK — service_role nao executa a purga interna';
end $$;

-- ── T16.4 ───────────────────────────────────────────────────────────────────
do $$
declare res jsonb; v record; s record;
begin
  res := pg_temp.insc('ana@example.com', 'AAAAAAAAA1', pg_temp.h('ana1'));
  if res <> '{"resultado":"criado","envio":true}'::jsonb then raise exception 'T16.4: %', res; end if;
  select * into s from public.early_access_signups where email_normalized = 'ana@example.com';
  select * into v from public.early_access_verificacoes where signup_id = s.id;
  if v.token_hash <> pg_temp.h('ana1') or v.expires_at - v.created_at <> interval '24 hours'
     or v.tentativa <> 1 or v.send_status <> 'pending' or v.consumed_at is not null or v.revoked_at is not null then
    raise exception 'T16.4: verificacao inesperada %', row_to_json(v);
  end if;
  if s.locale <> 'pt' or s.email_verified_at is not null or s.status <> 'pending' then
    raise exception 'T16.4: inscricao inesperada';
  end if;
  if (select count(*) from public.early_access_events where signup_id = s.id and kind = 'verification_issued') <> 1 then
    raise exception 'T16.4: evento verification_issued ausente';
  end if;
  raise notice 'T16.4 OK — inscricao nova: 1 token pending, TTL exato de 24h, evento verification_issued';
end $$;

-- ── T16.5 ───────────────────────────────────────────────────────────────────
do $$
declare v text; ok boolean;
begin
  foreach v in array array['abc', upper(pg_temp.h('x')), pg_temp.h('x') || '0', 'g' || substr(pg_temp.h('x'), 2)] loop
    ok := false;
    begin perform pg_temp.insc('fmt@example.com', 'BBBBBBBBB2', v);
    exception when others then ok := sqlerrm = 'early_access_token_hash_invalido'; end;
    if not ok then raise exception 'T16.5: hash % aceito', v; end if;
  end loop;
  if exists (select 1 from public.early_access_signups where email_normalized = 'fmt@example.com') then
    raise exception 'T16.5: inscricao gravada com hash invalido';
  end if;
  if (public.early_access_confirmar_email('nao-e-hash', 'tos-2026-10', 'priv-2026-10', null, null, null))->>'resultado' <> 'invalido' then
    raise exception 'T16.5: confirmar aceitou hash fora do formato';
  end if;
  raise notice 'T16.5 OK — hash fora do formato recusado (inscrever) / invalido (confirmar)';
end $$;
reset role;

-- ── T16.6 ───────────────────────────────────────────────────────────────────
do $$
declare res jsonb; antes text; depois text; v_id uuid;
begin
  select id, row(display_name, country, locale, utm_source, referral_code)::text into v_id, antes
    from public.early_access_signups where email_normalized = 'ana@example.com';
  execute 'set local role service_role';
  -- dentro do cooldown de 10 min: suprimido, nenhum token novo
  res := pg_temp.insc('ana@example.com', 'CCCCCCCCC3', pg_temp.h('ana2'));
  execute 'reset role';
  if res <> '{"resultado":"existente","envio":false}'::jsonb then raise exception 'T16.6a: %', res; end if;
  if exists (select 1 from public.early_access_verificacoes where token_hash = pg_temp.h('ana2')) then
    raise exception 'T16.6a: token emitido dentro do cooldown';
  end if;
  if not exists (select 1 from public.early_access_events where signup_id = v_id and kind = 'verification_suppressed'
                   and meta->>'motivo' = 'cooldown') then
    raise exception 'T16.6a: supressao nao auditada';
  end if;
  -- 11 min depois: reenvio legítimo → token NOVO, o anterior REVOGADO (D-3)
  perform pg_temp.envelhecer('ana@example.com', interval '11 minutes');
  execute 'set local role service_role';
  res := pg_temp.insc('ana@example.com', 'CCCCCCCCC3', pg_temp.h('ana3'));
  execute 'reset role';
  if res <> '{"resultado":"existente","envio":true}'::jsonb then raise exception 'T16.6b: %', res; end if;
  if (select revoked_reason from public.early_access_verificacoes where token_hash = pg_temp.h('ana1')) <> 'superseded' then
    raise exception 'T16.6b: token anterior nao foi revogado';
  end if;
  if (select count(*) from public.early_access_verificacoes
       where signup_id = v_id and consumed_at is null and revoked_at is null) <> 1 then
    raise exception 'T16.6b: mais de um token ativo';
  end if;
  select row(display_name, country, locale, utm_source, referral_code)::text into depois
    from public.early_access_signups where id = v_id;
  if antes <> depois then raise exception 'T16.6c: duplicado alterou dados: % → %', antes, depois; end if;
  -- o unique parcial impede dois ativos mesmo para o dono
  begin
    insert into public.early_access_verificacoes (signup_id, token_hash, expires_at)
    values (v_id, pg_temp.h('intruso'), now() + interval '24 hours');
    raise exception 'T16.6d: segundo token ativo aceito';
  exception when unique_violation then null;
  end;
  -- e o TTL é invariante de tabela
  begin
    update public.early_access_verificacoes set expires_at = expires_at + interval '1 hour' where token_hash = pg_temp.h('ana3');
    raise exception 'T16.6e: TTL estendido';
  exception when check_violation then null;
  end;
  raise notice 'T16.6 OK — cooldown suprime e audita; reenvio revoga o anterior (1 ativo); dados intactos; TTL nao estende';
end $$;

-- ── T16.7 ───────────────────────────────────────────────────────────────────
do $$
declare i int; res jsonb; v_id uuid;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('cap@example.com', 'DDDDDDDDD4', pg_temp.h('cap0'));
  execute 'reset role';
  select id into v_id from public.early_access_signups where email_normalized = 'cap@example.com';
  for i in 1 .. 4 loop
    perform pg_temp.envelhecer('cap@example.com', interval '11 minutes');
    execute 'set local role service_role';
    res := pg_temp.insc('cap@example.com', 'DDDDDDDDD4', pg_temp.h('cap'||i));
    execute 'reset role';
    if (res->>'envio')::boolean is not true then raise exception 'T16.7: reenvio % negado cedo', i; end if;
  end loop;
  perform pg_temp.envelhecer('cap@example.com', interval '11 minutes');
  execute 'set local role service_role';
  res := pg_temp.insc('cap@example.com', 'DDDDDDDDD4', pg_temp.h('cap5'));
  execute 'reset role';
  if (res->>'envio')::boolean then raise exception 'T16.7: 6o token em 24h emitido'; end if;
  if not exists (select 1 from public.early_access_events where signup_id = v_id and meta->>'motivo' = 'cap_diario') then
    raise exception 'T16.7: cap nao auditado';
  end if;
  raise notice 'T16.7 OK — 5 tokens/24h por inscricao; o 6o e suprimido e auditado';
end $$;

-- D-3 (auditoria adversarial, achado EA2-A01): nenhum token sobrevive ao pedido.
do $$
declare res jsonb; v_id uuid;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('ret@example.com', 'TTTTTTTTT8', pg_temp.h('ret1'));
  execute 'reset role';
  select id into v_id from public.early_access_signups where email_normalized = 'ret@example.com';
  perform pg_temp.envelhecer('ret@example.com', interval '6 days 1 minute');
  execute 'set local role service_role';
  res := pg_temp.insc('ret@example.com', 'TTTTTTTTT8', pg_temp.h('ret2'));
  execute 'reset role';
  if (res->>'envio')::boolean then raise exception 'T16.7b: token emitido apos 6 dias'; end if;
  if not exists (select 1 from public.early_access_events where signup_id = v_id and meta->>'motivo' = 'retencao') then
    raise exception 'T16.7b: supressao por retencao nao auditada';
  end if;
  if exists (select 1 from public.early_access_verificacoes
              where signup_id = v_id
                and expires_at > (select created_at + interval '7 days' from public.early_access_signups where id = v_id)) then
    raise exception 'T16.7b: token vale alem da retencao';
  end if;
  raise notice 'T16.7b OK — depois de 6 dias nao se emite token: nenhum link sobrevive a purga de 7 dias';
end $$;

-- ── T16.8 ───────────────────────────────────────────────────────────────────
do $$
declare res jsonb; e text;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('ver@example.com', 'EEEEEEEEE5', pg_temp.h('ver1'));
  perform pg_temp.insc('blk@example.com', 'FFFFFFFFF6', pg_temp.h('blk1'));
  perform pg_temp.insc('sup@example.com', 'GGGGGGGGG7', pg_temp.h('sup1'));
  perform public.early_access_confirmar_email(pg_temp.h('ver1'), 'tos-2026-10', 'priv-2026-10', null, null, null);
  perform public.early_access_transicionar((select id from public.early_access_signups where email_normalized = 'blk@example.com'),
                                           'blocked', 'admin:0xADMIN', 'spam');
  execute 'reset role';
  update public.early_access_signups set email_suppressed_at = now(), email_suppression_reason = 'bounced'
   where email_normalized = 'sup@example.com';
  foreach e in array array['ver','blk','sup'] loop
    perform pg_temp.envelhecer(e||'@example.com', interval '11 minutes');
    execute 'set local role service_role';
    res := pg_temp.insc(e||'@example.com', 'HHHHHHHHH8', pg_temp.h(e||'2'));
    execute 'reset role';
    if res <> '{"resultado":"existente","envio":false}'::jsonb then raise exception 'T16.8: % → %', e, res; end if;
    if exists (select 1 from public.early_access_verificacoes where token_hash = pg_temp.h(e||'2')) then
      raise exception 'T16.8: token emitido para %', e;
    end if;
  end loop;
  raise notice 'T16.8 OK — verificado, blocked e suprimido: duplicado sem token novo e com a mesma resposta';
end $$;

-- ── T16.9 ───────────────────────────────────────────────────────────────────
set local role service_role;
do $$
declare res jsonb; v_id uuid; s record;
begin
  res := public.early_access_confirmar_email(pg_temp.h('ana3'), 'tos-2026-10', 'priv-2026-10', null, null, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  select * into s from public.early_access_signups where email_normalized = 'ana@example.com';
  if res->>'resultado' <> 'confirmado' or res->>'referral_code' <> s.referral_code then
    raise exception 'T16.9: %', res;
  end if;
  if s.email_verified_at is null or s.status <> 'pending' then
    raise exception 'T16.9: verificacao nao gravada ou status mudou (%)', s.status;
  end if;
  if (select consumed_at from public.early_access_verificacoes where token_hash = pg_temp.h('ana3')) is null then
    raise exception 'T16.9: token nao consumido';
  end if;
  if (select count(*) from public.early_access_consents where signup_id = s.id and source = 'email_confirmation') <> 3 then
    raise exception 'T16.9: consentimentos do titular ausentes';
  end if;
  -- EA2-A02: o formulário DECLAROU marketing=true (helper), mas o titular não
  -- escolheu nada na confirmação → OPT-OUT efetivo, auditado
  -- EA2-IA09: sem escolha não tem momento de escolha (marketing_escolhido_em = NULL)
  if s.marketing_opt_in is not true
     or s.marketing_efetivo is not false or s.marketing_escolhido_em is not null
     or (select granted from public.early_access_consents where signup_id = s.id and source = 'email_confirmation' and kind = 'marketing') <> false
     or (select meta->>'marketing' from public.early_access_events where signup_id = s.id and kind = 'email_verified') <> 'sem_escolha' then
    raise exception 'T16.9: declaracao provisoria virou consentimento (EA2-A02)';
  end if;
  if (select count(*) from public.early_access_events where signup_id = s.id and kind = 'email_verified') <> 1
     or exists (select 1 from public.early_access_events where signup_id = s.id and kind = 'self_corrected') then
    raise exception 'T16.9: eventos inesperados';
  end if;
  -- clique repetido: idempotente e SEM o código
  res := public.early_access_confirmar_email(pg_temp.h('ana3'), 'tos-2026-10', 'priv-2026-10', null, null, null);
  if res <> '{"resultado":"ja_confirmado"}'::jsonb then raise exception 'T16.9b: %', res; end if;
  if (select count(*) from public.early_access_events where signup_id = s.id and kind = 'email_verified') <> 1 then
    raise exception 'T16.9b: replay gravou de novo';
  end if;
  raise notice 'T16.9 OK — confirma uma vez: verifica, consome, 3 consents do titular, evento; status pending; replay ja_confirmado sem codigo';
end $$;

-- ── T16.9c — EA2-A02: escolha explícita do titular, independente da declaração ──
do $$
declare s record; c record; ok boolean := false;
begin
  execute 'set local role service_role';
  -- declarou true no formulário, titular escolhe OPT-OUT
  perform pg_temp.insc('mkt_out@example.com', 'XXXXXXXXX1', pg_temp.h('mo1'));
  perform public.early_access_confirmar_email(pg_temp.h('mo1'), 'tos-2026-10', 'priv-2026-10', null, null, null, false);
  -- declarou true, titular escolhe OPT-IN
  perform pg_temp.insc('mkt_in@example.com', 'XXXXXXXXX2', pg_temp.h('mi1'));
  perform public.early_access_confirmar_email(pg_temp.h('mi1'), 'tos-2026-10', 'priv-2026-10', null, null, null, true);
  -- a preview NÃO expõe a declaração provisória
  perform pg_temp.insc('mkt_pv@example.com', 'XXXXXXXXX3', pg_temp.h('mp1'));
  if public.early_access_token_preview(pg_temp.h('mp1')) ? 'marketing_opt_in' then
    raise exception 'T16.9c: preview expoe a declaracao provisoria';
  end if;
  execute 'reset role';
  select * into s from public.early_access_signups where email_normalized = 'mkt_out@example.com';
  if s.marketing_efetivo or (select meta->>'marketing' from public.early_access_events where signup_id = s.id and kind = 'email_verified') <> 'opt_out'
     or (select granted from public.early_access_consents where signup_id = s.id and source = 'email_confirmation' and kind = 'marketing') then
    raise exception 'T16.9c: opt-out explicito nao respeitado';
  end if;
  select * into s from public.early_access_signups where email_normalized = 'mkt_in@example.com';
  select * into c from public.early_access_consents where signup_id = s.id and source = 'email_confirmation' and kind = 'marketing';
  if not s.marketing_efetivo or s.marketing_escolhido_em is null or not c.granted
     or c.version <> s.privacy_version or c.created_at is null
     or (select meta->>'marketing' from public.early_access_events where signup_id = s.id and kind = 'email_verified') <> 'opt_in' then
    raise exception 'T16.9c: opt-in explicito sem audit completo (versao/momento/contexto)';
  end if;
  -- invariante de banco: nem o dono grava consentimento efetivo sem verificação/escolha
  select * into s from public.early_access_signups where email_normalized = 'mkt_pv@example.com';
  begin update public.early_access_signups set marketing_efetivo = true, marketing_escolhido_em = now() where id = s.id;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'T16.9c: marketing efetivo sem email verificado aceito'; end if;
  raise notice 'T16.9c OK — EA2-A02: declaracao do formulario e provisoria; titular escolhe opt-in/opt-out; sem escolha = opt-out; CHECK no banco';
end $$;

-- ── T16.10 ──────────────────────────────────────────────────────────────────
do $$
begin
  -- token inexistente
  if (public.early_access_confirmar_email(pg_temp.h('nunca'), 'tos-2026-10', 'priv-2026-10', null, null, null))->>'resultado' <> 'invalido' then
    raise exception 'T16.10a: token inexistente nao foi invalido';
  end if;
  raise notice 'T16.10a OK — token inexistente: invalido';
end $$;
reset role;
do $$
declare res jsonb;
begin
  -- revogado de inscrição NÃO verificada: invalido
  execute 'set local role service_role';
  perform pg_temp.insc('rev@example.com', 'JJJJJJJJJ9', pg_temp.h('rev1'));
  execute 'reset role';
  perform pg_temp.envelhecer('rev@example.com', interval '11 minutes');
  execute 'set local role service_role';
  perform pg_temp.insc('rev@example.com', 'JJJJJJJJJ9', pg_temp.h('rev2'));
  res := public.early_access_confirmar_email(pg_temp.h('rev1'), 'tos-2026-10', 'priv-2026-10', null, null, null);
  execute 'reset role';
  if res <> '{"resultado":"invalido"}'::jsonb then raise exception 'T16.10b: revogado → %', res; end if;
  -- expirado: 25 h depois, o token vigente não confirma
  perform pg_temp.envelhecer('rev@example.com', interval '25 hours');
  execute 'set local role service_role';
  res := public.early_access_confirmar_email(pg_temp.h('rev2'), 'tos-2026-10', 'priv-2026-10', null, null, null);
  execute 'reset role';
  if res <> '{"resultado":"invalido"}'::jsonb then raise exception 'T16.10c: expirado → %', res; end if;
  if (select email_verified_at from public.early_access_signups where email_normalized = 'rev@example.com') is not null
     or (select consumed_at from public.early_access_verificacoes where token_hash = pg_temp.h('rev2')) is not null then
    raise exception 'T16.10c: expirado deixou efeito';
  end if;
  raise notice 'T16.10 OK — revogado e expirado: invalido, sem efeito nenhum';
end $$;

-- ── T16.11 ──────────────────────────────────────────────────────────────────
do $$
declare res jsonb; v_id uuid; ok boolean := false; m jsonb;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('cor@example.com', 'KKKKKKKKK1', pg_temp.h('cor1'));
  -- correção inválida (país minúsculo): exceção, e NADA muda
  begin
    perform public.early_access_confirmar_email(pg_temp.h('cor1'), 'tos-2026-10', 'priv-2026-10', 'Nome Valido', 'br', null);
  exception when others then ok := sqlerrm = 'early_access_correcao_invalida';
  end;
  execute 'reset role';
  if not ok then raise exception 'T16.11a: correcao invalida nao foi recusada'; end if;
  select id into v_id from public.early_access_signups where email_normalized = 'cor@example.com';
  if (select email_verified_at from public.early_access_signups where id = v_id) is not null
     or (select display_name from public.early_access_signups where id = v_id) <> 'Pessoa Teste'
     or (select consumed_at from public.early_access_verificacoes where token_hash = pg_temp.h('cor1')) is not null then
    raise exception 'T16.11a: efeito parcial';
  end if;
  -- correção válida: aplicada, auditada só com NOMES de campo
  execute 'set local role service_role';
  res := public.early_access_confirmar_email(pg_temp.h('cor1'), 'tos-2026-10', 'priv-2026-10', 'Pessoa Corrigida', 'PT', null);
  execute 'reset role';
  if res->>'resultado' <> 'confirmado' then raise exception 'T16.11b: %', res; end if;
  if (select row(display_name, country)::text from public.early_access_signups where id = v_id) <> '("Pessoa Corrigida",PT)' then
    raise exception 'T16.11b: correcao nao aplicada';
  end if;
  select meta into m from public.early_access_events where signup_id = v_id and kind = 'self_corrected';
  if m <> '{"campos":["display_name","country"]}'::jsonb then raise exception 'T16.11c: meta %', m; end if;
  if exists (select 1 from public.early_access_events where signup_id = v_id
              and (meta::text like '%Corrigida%' or meta::text like '%PT%' or reason like '%Corrigida%')) then
    raise exception 'T16.11c: valor corrigido no audit';
  end if;
  -- a assinatura não tem como corrigir email (nenhum parâmetro de email)
  if exists (select 1 from pg_proc p, unnest(p.proargnames) a
              where p.proname = 'early_access_confirmar_email' and a like '%email%') then
    raise exception 'T16.11d: confirmar aceita email';
  end if;
  raise notice 'T16.11 OK — correcao so nome/pais, atomica (invalida nao deixa rastro), audit sem valores, email nao corrigivel';
end $$;

-- ── T16.12 ──────────────────────────────────────────────────────────────────
do $$
declare v_nv uuid; v_v uuid; ok boolean := false;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('nv@example.com', 'MMMMMMMMM2', pg_temp.h('nv1'));
  select id into v_nv from public.early_access_signups where email_normalized = 'nv@example.com';
  begin perform public.early_access_transicionar(v_nv, 'approved', 'admin:0xADMIN', null);
  exception when others then ok := sqlerrm = 'early_access_email_nao_verificado'; end;
  execute 'reset role';
  if not ok then raise exception 'T16.12a: RPC aprovou nao verificado'; end if;
  if (select status from public.early_access_signups where id = v_nv) <> 'pending' then
    raise exception 'T16.12a: status mudou';
  end if;
  -- nem o dono, por UPDATE direto
  ok := false;
  begin update public.early_access_signups set status = 'approved' where id = v_nv;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'T16.12b: CHECK aceitou approved sem verificacao'; end if;
  -- nem "des-verificar" quem já foi aprovado
  select id into v_v from public.early_access_signups where email_normalized = 'ana@example.com';
  execute 'set local role service_role';
  perform public.early_access_transicionar(v_v, 'approved', 'admin:0xADMIN', null);
  execute 'reset role';
  ok := false;
  begin update public.early_access_signups set email_verified_at = null where id = v_v;
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'T16.12c: approved ficou sem verificacao'; end if;
  raise notice 'T16.12 OK — D-4: RPC e CHECK recusam aprovar sem verificacao; verificado aprova';
end $$;

-- ── T16.13 ──────────────────────────────────────────────────────────────────
do $$
declare p jsonb; antes record; depois record;
begin
  select consumed_at, revoked_at, expires_at into antes from public.early_access_verificacoes where token_hash = pg_temp.h('nv1');
  execute 'set local role service_role';
  p := public.early_access_token_preview(pg_temp.h('nv1'));
  execute 'reset role';
  if p is null or p->>'display_name' <> 'Pessoa Teste' or p->>'country' <> 'BR' or p ? 'email' or p ? 'email_normalized' then
    raise exception 'T16.13a: preview %', p;
  end if;
  select consumed_at, revoked_at, expires_at into depois from public.early_access_verificacoes where token_hash = pg_temp.h('nv1');
  if antes.consumed_at is distinct from depois.consumed_at or antes.revoked_at is distinct from depois.revoked_at
     or antes.expires_at is distinct from depois.expires_at then
    raise exception 'T16.13b: preview mudou o token';
  end if;
  execute 'set local role service_role';
  if public.early_access_token_preview(pg_temp.h('ana3')) is not null       -- consumido
     or public.early_access_token_preview(pg_temp.h('rev2')) is not null    -- expirado
     or public.early_access_token_preview('x') is not null then
    raise exception 'T16.13c: preview de token que nao vale';
  end if;
  execute 'reset role';
  raise notice 'T16.13 OK — preview sem email, nao consome nem estende; consumido/expirado/malformado → nulo';
end $$;

-- ── T16.14 ──────────────────────────────────────────────────────────────────
do $$
declare v_id uuid; r text; v_ref uuid;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('naofui@example.com', 'NNNNNNNNN3', pg_temp.h('nf1'));
  execute 'reset role';
  select id into v_id from public.early_access_signups where email_normalized = 'naofui@example.com';
  execute 'set local role service_role';
  -- token inválido: nada é apagado
  if public.early_access_recusar_email(pg_temp.h('nao-existe')) <> 'invalido'
     or public.early_access_recusar_email('lixo') <> 'invalido' then
    raise exception 'T16.14a: recusa sem token valido';
  end if;
  execute 'reset role';
  if not exists (select 1 from public.early_access_signups where id = v_id) then
    raise exception 'T16.14a: purgou sem token valido';
  end if;
  execute 'set local role service_role';
  r := public.early_access_recusar_email(pg_temp.h('nf1'));
  execute 'reset role';
  if r <> 'recusado' then raise exception 'T16.14b: %', r; end if;
  if exists (select 1 from public.early_access_signups where id = v_id)
     or exists (select 1 from public.early_access_events where signup_id = v_id)
     or exists (select 1 from public.early_access_consents where signup_id = v_id)
     or exists (select 1 from public.early_access_verificacoes where signup_id = v_id) then
    raise exception 'T16.14b: sobrou PII da inscricao recusada';
  end if;
  if (select count(*) from public.early_access_purges where signup_id = v_id and motivo = 'declined') <> 1 then
    raise exception 'T16.14c: lapide ausente';
  end if;
  -- recusar de novo: invalido (o token não existe mais)
  execute 'set local role service_role';
  if public.early_access_recusar_email(pg_temp.h('nf1')) <> 'invalido' then raise exception 'T16.14d: replay'; end if;
  -- verificada não é recusável
  if public.early_access_recusar_email(pg_temp.h('ana3')) <> 'invalido' then raise exception 'T16.14e: recusou verificada'; end if;
  execute 'reset role';
  raise notice 'T16.14 OK — nao fui eu: purga na hora + lapide; token invalido/replay/verificada nao purgam';
end $$;

-- ── T16.15 ──────────────────────────────────────────────────────────────────
do $$
declare n int; v_velha uuid; v_ver uuid; v_filho uuid;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('velha@example.com', 'PPPPPPPPP4', pg_temp.h('velha1'));
  perform pg_temp.insc('nova@example.com',  'QQQQQQQQQ5', pg_temp.h('nova1'));
  execute 'reset role';
  select id into v_velha from public.early_access_signups where email_normalized = 'velha@example.com';
  select id into v_ver   from public.early_access_signups where email_normalized = 'ana@example.com';
  -- alguém indicado pela velha: o vínculo vira NULL, a inscrição dele fica
  select id into v_filho from public.early_access_signups where email_normalized = 'nv@example.com';
  update public.early_access_signups set referred_by_signup_id = v_velha where id = v_filho;
  perform pg_temp.envelhecer('velha@example.com', interval '8 days');
  perform pg_temp.envelhecer('ana@example.com',   interval '30 days');   -- verificada e antiga
  perform pg_temp.envelhecer('nova@example.com',  interval '6 days');    -- não verificada, dentro do prazo
  execute 'set local role service_role';
  n := public.early_access_purgar_nao_verificados(500);
  execute 'reset role';
  if exists (select 1 from public.early_access_signups where id = v_velha) then raise exception 'T16.15a: velha nao purgada'; end if;
  if not exists (select 1 from public.early_access_signups where email_normalized = 'nova@example.com') then
    raise exception 'T16.15b: purgou dentro dos 7 dias';
  end if;
  if not exists (select 1 from public.early_access_signups where id = v_ver) then
    raise exception 'T16.15c: purgou inscricao VERIFICADA';
  end if;
  if (select referred_by_signup_id from public.early_access_signups where id = v_filho) is not null then
    raise exception 'T16.15d: indicacao nao virou null';
  end if;
  if not exists (select 1 from public.early_access_purges where signup_id = v_velha and motivo = 'unverified_retention') then
    raise exception 'T16.15e: lapide ausente';
  end if;
  if exists (select 1 from public.early_access_signups where email_verified_at is null
              and created_at < now() - interval '7 days') then
    raise exception 'T16.15f: sobrou nao verificada antiga';
  end if;
  raise notice 'T16.15 OK — % purgadas; so nao verificadas > 7 dias; verificada antiga intacta; indicacao vira null', n;
end $$;

-- ── T16.16 ──────────────────────────────────────────────────────────────────
do $$
declare ids uuid[]; v_old uuid; r jsonb; ok boolean;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('retry@example.com', 'RRRRRRRRR6', pg_temp.h('rt1'));
  -- falha de envio: failed + evento; e vira candidato a retry
  ok := public.early_access_registrar_envio(pg_temp.h('rt1'), false, 'transitorio', null, true);
  if not ok then raise exception 'T16.16a: registrar falha'; end if;
  -- registrar de novo (já não está pending): false, sem efeito
  if public.early_access_registrar_envio(pg_temp.h('rt1'), true, null, 'msg-x', null) then raise exception 'T16.16a2: reabriu'; end if;
  select id into v_old from public.early_access_verificacoes where token_hash = pg_temp.h('rt1');
  select array_agg(x) into ids from public.early_access_pendentes_de_envio(50) x;
  if not (v_old = any(ids)) then raise exception 'T16.16b: falha nao virou pendente'; end if;
  r := public.early_access_reemitir(v_old, pg_temp.h('rt2'));
  if r <> '{"email":"retry@example.com","locale":"pt"}'::jsonb then raise exception 'T16.16c: %', r; end if;
  execute 'reset role';
  if (select revoked_reason from public.early_access_verificacoes where id = v_old) <> 'send_failed'
     or (select tentativa from public.early_access_verificacoes where token_hash = pg_temp.h('rt2')) <> 2 then
    raise exception 'T16.16d: reemissao inconsistente';
  end if;
  execute 'set local role service_role';
  -- reemitir o mesmo antigo de novo: nulo
  if public.early_access_reemitir(v_old, pg_temp.h('rt3')) is not null then raise exception 'T16.16e: reemitiu revogado'; end if;
  -- sucesso grava o id do provider
  if not public.early_access_registrar_envio(pg_temp.h('rt2'), true, null, 'resend-msg-123', null) then raise exception 'T16.16f'; end if;
  execute 'reset role';
  if (select send_status from public.early_access_verificacoes where token_hash = pg_temp.h('rt2')) <> 'sent' then
    raise exception 'T16.16f: nao marcou sent';
  end if;
  -- 'pending' há 4 min não é candidato; há 6 min é
  execute 'set local role service_role';
  perform pg_temp.insc('lento@example.com', 'SSSSSSSSS7', pg_temp.h('lento1'));
  execute 'reset role';
  perform pg_temp.envelhecer('lento@example.com', interval '4 minutes');
  if exists (select 1 from public.early_access_pendentes_de_envio(50) x
              join public.early_access_verificacoes v on v.id = x where v.token_hash = pg_temp.h('lento1')) then
    raise exception 'T16.16g: pending recente virou retry';
  end if;
  perform pg_temp.envelhecer('lento@example.com', interval '2 minutes');
  if not exists (select 1 from public.early_access_pendentes_de_envio(50) x
                  join public.early_access_verificacoes v on v.id = x where v.token_hash = pg_temp.h('lento1')) then
    raise exception 'T16.16h: pending antigo nao virou retry';
  end if;
  raise notice 'T16.16 OK — falha → pendente → reemitir (tentativa 2, revoga send_failed) → sent; pending < 5 min nao reenvia';
end $$;

-- ── T16.17 ──────────────────────────────────────────────────────────────────
do $$
declare r text; v_id uuid; res jsonb; v_eventos_antes int;
begin
  -- RR-O-01 (L-028/L-031): conta só os eventos DESTE bloco, para o teste também valer em banco povoado
  select count(*) into v_eventos_antes from public.early_access_webhook_eventos;
  select signup_id into v_id from public.early_access_verificacoes where token_hash = pg_temp.h('rt2');
  execute 'set local role service_role';
  r := public.early_access_registrar_webhook('msg_evt_1', 'email.bounced', 'resend-msg-123');
  if r <> 'processado' then raise exception 'T16.17a: %', r; end if;
  -- reentrega do mesmo evento: sem efeito novo
  r := public.early_access_registrar_webhook('msg_evt_1', 'email.bounced', 'resend-msg-123');
  if r <> 'duplicado' then raise exception 'T16.17b: %', r; end if;
  execute 'reset role';
  if (select row(email_suppression_reason)::text from public.early_access_signups where id = v_id) <> '(bounced)'
     or (select count(*) from public.early_access_events where signup_id = v_id and kind = 'email_bounced') <> 1 then
    raise exception 'T16.17c: supressao/evento';
  end if;
  -- suprimido: duplicado não reenvia e não vira retry
  perform pg_temp.envelhecer('retry@example.com', interval '11 minutes');
  execute 'set local role service_role';
  res := pg_temp.insc('retry@example.com', 'RRRRRRRRR6', pg_temp.h('rt9'));
  if (res->>'envio')::boolean then raise exception 'T16.17d: reenviou para suprimido'; end if;
  r := public.early_access_registrar_webhook('msg_evt_2', 'email.delivered', 'resend-msg-123');
  if r <> 'ignorado' then raise exception 'T16.17e: %', r; end if;
  r := public.early_access_registrar_webhook('msg_evt_3', 'email.complained', 'nao-existe');
  if r <> 'sem_alvo' then raise exception 'T16.17f: %', r; end if;
  begin perform public.early_access_registrar_webhook('', 'email.bounced', null); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_webhook_invalido' then raise exception 'T16.17g: %', sqlerrm; end if; end;
  execute 'reset role';
  if (select count(*) from public.early_access_webhook_eventos) <> v_eventos_antes + 3 then raise exception 'T16.17h: idempotencia'; end if;
  raise notice 'T16.17 OK — webhook: bounce suprime e audita; reentrega duplicado; tipo desconhecido ignorado; sem alvo sem efeito';
end $$;

-- ── T16.18 ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name in ('early_access_verificacoes','early_access_webhook_eventos','early_access_purges',
                                   'early_access_events','early_access_consents')
                and (column_name like '%email%' or column_name in ('token','token_raw','raw_token'))) then
    raise exception 'T16.18: coluna de email ou token cru';
  end if;
  raise notice 'T16.18 OK — tabelas novas sem email e sem token cru (so token_hash)';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RODADA DE CORREÇÃO DA AUDITORIA INDEPENDENTE (EA2-IA01…IA06) + reprova do EA2-A02
-- ═══════════════════════════════════════════════════════════════════════════

-- ── T16.19 — EA2-IA01: falha permanente é TERMINAL; transitória volta à fila ──
do $$
declare v_dead uuid; v_fail uuid; ok boolean := false;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('perm@example.com', 'YYYYYYYYY1', pg_temp.h('perm1'));
  perform pg_temp.insc('tran@example.com', 'YYYYYYYYY2', pg_temp.h('tran1'));
  perform public.early_access_registrar_envio(pg_temp.h('perm1'), false, 'rejeitado', null, false);
  perform public.early_access_registrar_envio(pg_temp.h('tran1'), false, 'provider_5xx', null, true);
  -- classificação ausente numa falha = erro (sem inferência)
  begin perform public.early_access_registrar_envio(pg_temp.h('x'), false, 'rede', null, null);
  exception when others then ok := sqlerrm = 'early_access_parametro_invalido'; end;
  execute 'reset role';
  if not ok then raise exception 'T16.19a: falha sem classificacao aceita'; end if;
  select id into v_dead from public.early_access_verificacoes where token_hash = pg_temp.h('perm1');
  select id into v_fail from public.early_access_verificacoes where token_hash = pg_temp.h('tran1');
  if (select send_status from public.early_access_verificacoes where id = v_dead) <> 'dead'
     or (select send_status from public.early_access_verificacoes where id = v_fail) <> 'failed' then
    raise exception 'T16.19b: classificacao nao persistida';
  end if;
  if (select (meta->>'terminal')::boolean from public.early_access_events e
       join public.early_access_verificacoes v on v.signup_id = e.signup_id
      where v.id = v_dead and e.kind = 'verification_send_failed') is not true then
    raise exception 'T16.19c: terminal nao auditado';
  end if;
  -- mesmo "envelhecido" (passou do limiar de 5 min), dead NUNCA é candidato
  perform pg_temp.envelhecer('perm@example.com', interval '30 minutes');
  if exists (select 1 from public.early_access_pendentes_de_envio(50) x where x = v_dead) then
    raise exception 'T16.19d: dead virou candidato a retry';
  end if;
  if not exists (select 1 from public.early_access_pendentes_de_envio(50) x where x = v_fail) then
    raise exception 'T16.19e: transitoria nao virou candidata';
  end if;
  execute 'set local role service_role';
  if public.early_access_reemitir(v_dead, pg_temp.h('perm2')) is not null then
    raise exception 'T16.19f: reemitir aceitou dead';
  end if;
  execute 'reset role';
  if (select revoked_at from public.early_access_verificacoes where id = v_dead) is not null then
    raise exception 'T16.19g: reemitir recusado mexeu no token dead';
  end if;
  raise notice 'T16.19 OK — EA2-IA01: permanente=dead (terminal, fora da fila e do reemitir); transitoria=failed (candidata); classificacao obrigatoria';
end $$;

-- ── T16.20 — EA2-IA02: emissão suprimida não encalha a inscrição ────────────
do $$
declare v_old uuid; v_sid uuid; v_dummy uuid; r jsonb; n int;
begin
  -- 1. inscrição com token ativo, falha transitória → elegível para retry
  execute 'set local role service_role';
  perform pg_temp.insc('encalhe@example.com', 'YYYYYYYYY3', pg_temp.h('enc1'));
  perform public.early_access_registrar_envio(pg_temp.h('enc1'), false, 'rate_limited', null, true);
  perform pg_temp.insc('enchimento@example.com', 'YYYYYYYYY4', null);
  execute 'reset role';
  select id, signup_id into v_old, v_sid from public.early_access_verificacoes where token_hash = pg_temp.h('enc1');
  select id into v_dummy from public.early_access_signups where email_normalized = 'enchimento@example.com';
  -- 2. teto global ESGOTADO (enchimento revogado, pelo dono, na última hora)
  select count(*) into n from public.early_access_verificacoes where created_at > now() - interval '1 hour';
  insert into public.early_access_verificacoes (signup_id, token_hash, expires_at, revoked_at, revoked_reason)
  select v_dummy, encode(sha256(convert_to('t16:enchimento:' || g, 'UTF8')), 'hex'), now() + interval '24 hours', now(), 'superseded'
    from generate_series(1, greatest(600 - n, 0)) g;
  -- 3. retry acontece e é suprimido
  execute 'set local role service_role';
  r := public.early_access_reemitir(v_old, pg_temp.h('enc2'));
  execute 'reset role';
  if r is not null then raise exception 'T16.20a: emitiu acima do teto'; end if;
  -- 4/5. NADA encalhou: o token antigo segue ATIVO, intacto, e na fila
  if (select revoked_at from public.early_access_verificacoes where id = v_old) is not null
     or (select send_status from public.early_access_verificacoes where id = v_old) <> 'failed' then
    raise exception 'T16.20b: token antigo revogado sem substituto (inscricao encalhada)';
  end if;
  if (select count(*) from public.early_access_verificacoes where signup_id = v_sid and consumed_at is null and revoked_at is null) <> 1 then
    raise exception 'T16.20c: inscricao sem token ativo';
  end if;
  if not exists (select 1 from public.early_access_pendentes_de_envio(50) x where x = v_old) then
    raise exception 'T16.20d: saiu da fila de retry';
  end if;
  if not exists (select 1 from public.early_access_events where signup_id = v_sid and kind = 'verification_suppressed'
                   and meta->>'motivo' = 'teto_global') then
    raise exception 'T16.20e: supressao nao auditada';
  end if;
  -- 6. capacidade volta → o mesmo caminho é determinístico: tentativa 2, antigo cai como send_failed
  delete from public.early_access_verificacoes where signup_id = v_dummy;
  execute 'set local role service_role';
  r := public.early_access_reemitir(v_old, pg_temp.h('enc2'));
  execute 'reset role';
  if r is null or (select revoked_reason from public.early_access_verificacoes where id = v_old) <> 'send_failed'
     or (select tentativa from public.early_access_verificacoes where token_hash = pg_temp.h('enc2')) <> 2 then
    raise exception 'T16.20f: retry apos capacidade nao foi deterministico';
  end if;
  raise notice 'T16.20 OK — EA2-IA02: teto esgotado nao revoga o antigo (segue ativo e na fila); com capacidade, reemissao normal';
end $$;

-- ── T16.21 — EA2-IA03: nada resolvível pelo provider sobrevive à purga ─────
do $$
declare v_sid uuid; r text; cols text;
begin
  select string_agg(column_name, ',' order by column_name) into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'early_access_webhook_eventos';
  if cols <> 'evento_hash,id,recebido_em,resultado,tipo' then raise exception 'T16.21a: colunas do webhook %', cols; end if;
  execute 'set local role service_role';
  perform pg_temp.insc('purgaweb@example.com', 'YYYYYYYYY5', pg_temp.h('pw1'));
  perform public.early_access_registrar_envio(pg_temp.h('pw1'), true, null, 'msg-purge-1', null);
  r := public.early_access_registrar_webhook('evt-purge-1', 'email.bounced', 'msg-purge-1');
  execute 'reset role';
  if r <> 'processado' then raise exception 'T16.21b: %', r; end if;
  if not exists (select 1 from public.early_access_webhook_eventos
                  where evento_hash = encode(sha256(convert_to('zswap-ea:webhook|evt-purge-1', 'UTF8')), 'hex')) then
    raise exception 'T16.21c: hash do evento ausente';
  end if;
  select id into v_sid from public.early_access_signups where email_normalized = 'purgaweb@example.com';
  perform pg_temp.envelhecer('purgaweb@example.com', interval '8 days');
  execute 'set local role service_role';
  perform public.early_access_purgar_nao_verificados(500);
  execute 'reset role';
  -- o id da mensagem não existe em lugar nenhum; o id cru do evento também não
  if exists (select 1 from public.early_access_verificacoes where provider_message_id = 'msg-purge-1')
     or exists (select 1 from public.early_access_webhook_eventos w where row(w.*)::text like '%msg-purge-1%' or row(w.*)::text like '%evt-purge-1%')
     or exists (select 1 from public.early_access_events where signup_id = v_sid)
     or exists (select 1 from public.early_access_consents where signup_id = v_sid)
     or exists (select 1 from public.early_access_signups where id = v_sid)
     or exists (select 1 from public.early_access_purges p where row(p.*)::text like '%msg-purge%' or row(p.*)::text like '%purgaweb%') then
    raise exception 'T16.21d: sobrou vinculo do sujeito purgado';
  end if;
  -- idempotência intacta; mensagem do sujeito purgado = sem alvo, nada guardado
  execute 'set local role service_role';
  r := public.early_access_registrar_webhook('evt-purge-1', 'email.bounced', 'msg-purge-1');
  if r <> 'duplicado' then raise exception 'T16.21e: replay %', r; end if;
  r := public.early_access_registrar_webhook('evt-purge-2', 'email.complained', 'msg-purge-1');
  if r <> 'sem_alvo' then raise exception 'T16.21f: %', r; end if;
  execute 'reset role';
  if (select count(*) from public.early_access_purges where signup_id = v_sid) <> 1 then
    raise exception 'T16.21g: lapide ausente';
  end if;
  raise notice 'T16.21 OK — EA2-IA03: webhook guarda so hash do evento; purga apaga a unica ligacao mensagem→sujeito; replay segue idempotente';
end $$;

-- ── T16.22 — EA2-IA04: consentimento ≠ elegibilidade ───────────────────────
do $$
declare e text; ok boolean := false;
begin
  execute 'set local role service_role';
  foreach e in array array['eleg_ok','eleg_bnc','eleg_cmp'] loop
    perform pg_temp.insc(e||'@example.com', 'ZZZZZZZZZ'||(array_position(array['eleg_ok','eleg_bnc','eleg_cmp'], e)), pg_temp.h(e));
    perform public.early_access_confirmar_email(pg_temp.h(e), 'tos-2026-10', 'priv-2026-10', null, null, null, true);
  end loop;
  execute 'reset role';
  update public.early_access_signups set email_suppressed_at = now(), email_suppression_reason = 'bounced'    where email_normalized = 'eleg_bnc@example.com';
  update public.early_access_signups set email_suppressed_at = now(), email_suppression_reason = 'complained' where email_normalized = 'eleg_cmp@example.com';
  if (select row(marketing_efetivo, marketing_elegivel)::text from public.early_access_signups where email_normalized = 'eleg_ok@example.com')  <> '(t,t)'
     or (select row(marketing_efetivo, marketing_elegivel)::text from public.early_access_signups where email_normalized = 'eleg_bnc@example.com') <> '(t,f)'
     or (select row(marketing_efetivo, marketing_elegivel)::text from public.early_access_signups where email_normalized = 'eleg_cmp@example.com') <> '(t,f)'
     or (select row(marketing_efetivo, marketing_elegivel)::text from public.early_access_signups where email_normalized = 'mkt_out@example.com') <> '(f,f)'
     or (select row(marketing_efetivo, marketing_elegivel)::text from public.early_access_signups where email_normalized = 'ana@example.com')     <> '(f,f)' then
    raise exception 'T16.22a: matriz de elegibilidade errada';
  end if;
  -- ninguém grava a elegibilidade à mão (coluna gerada)
  begin update public.early_access_signups set marketing_elegivel = true where email_normalized = 'eleg_bnc@example.com';
  exception when others then ok := true; end;
  if not ok then raise exception 'T16.22b: marketing_elegivel gravavel'; end if;
  raise notice 'T16.22 OK — EA2-IA04: opt-in ok→elegivel; opt-in+bounce/complaint→nao (consentimento preservado); opt-out/sem escolha→nao; coluna gerada';
end $$;

-- ── T16.23 — EA2-IA05: declaração só sobre versão apresentada, com semântica exata ──
do $$
declare v_sid uuid; ok boolean; v text[]; c record;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('legal@example.com', 'YYYYYYYYY6', pg_temp.h('lg1'));
  execute 'reset role';
  select id into v_sid from public.early_access_signups where email_normalized = 'legal@example.com';
  -- versão que a tela NÃO apresentou, ou ausente → nada é gravado
  foreach v slice 1 in array array[array['tos-OUTRA','priv-2026-10'], array['tos-2026-10','priv-OUTRA'],
                                   array[null,'priv-2026-10'], array['tos-2026-10',null]]::text[][] loop
    ok := false;
    execute 'set local role service_role';
    begin perform public.early_access_confirmar_email(pg_temp.h('lg1'), v[1], v[2], null, null, null, true);
    exception when others then ok := sqlerrm = 'early_access_versao_divergente'; end;
    execute 'reset role';
    if not ok then raise exception 'T16.23a: versao % aceita', v; end if;
  end loop;
  if exists (select 1 from public.early_access_consents where signup_id = v_sid and source = 'email_confirmation')
     or (select email_verified_at from public.early_access_signups where id = v_sid) is not null
     or (select consumed_at from public.early_access_verificacoes where token_hash = pg_temp.h('lg1')) is not null then
    raise exception 'T16.23b: versao divergente deixou efeito';
  end if;
  -- semântica exata: formulário (aceite/aceite/provisoria) × confirmação (aceite/ciencia/opt_*)
  if (select string_agg(kind||':'||declaracao, ',' order by kind) from public.early_access_consents
       where signup_id = v_sid and source = 'early_access_page') <> 'marketing:provisoria,privacy:aceite,terms:aceite' then
    raise exception 'T16.23c: declaracoes do formulario erradas';
  end if;
  execute 'set local role service_role';
  perform public.early_access_confirmar_email(pg_temp.h('lg1'), 'tos-2026-10', 'priv-2026-10', null, null, null, false);
  execute 'reset role';
  for c in select kind, version, declaracao, granted from public.early_access_consents
            where signup_id = v_sid and source = 'email_confirmation' loop
    if not ((c.kind = 'terms' and c.declaracao = 'aceite' and c.version = 'tos-2026-10' and c.granted)
         or (c.kind = 'privacy' and c.declaracao = 'ciencia' and c.version = 'priv-2026-10' and c.granted)
         or (c.kind = 'marketing' and c.declaracao = 'opt_out' and not c.granted)) then
      raise exception 'T16.23d: declaracao da confirmacao errada: %', row_to_json(c);
    end if;
  end loop;
  -- o banco recusa declaração com semântica trocada, mesmo para o dono
  ok := false;
  begin insert into public.early_access_consents (signup_id, kind, version, granted, source, declaracao)
        values (v_sid, 'privacy', 'priv-2026-10', true, 'email_confirmation', 'aceite');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'T16.23e: privacy confirmacao como aceite'; end if;
  ok := false;
  begin insert into public.early_access_consents (signup_id, kind, version, granted, source, declaracao)
        values (v_sid, 'marketing', 'priv-2026-10', true, 'email_confirmation', 'opt_out');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'T16.23f: marketing granted contradiz a declaracao'; end if;
  ok := false;
  begin insert into public.early_access_consents (signup_id, kind, version, granted, source, declaracao)
        values (v_sid, 'marketing', 'priv-2026-10', true, 'early_access_page', 'opt_in');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'T16.23g: formulario gravou marketing nao provisorio'; end if;
  raise notice 'T16.23 OK — EA2-IA05: versao nao apresentada nao grava nada; termos=aceite, privacidade=ciencia, marketing=opt_*/provisoria; CHECK no banco';
end $$;

-- ── T16.24 — EA2-IA06: os três estados ficam distintos no registro ─────────
do $$
begin
  if (select string_agg(s.email_normalized||'='||c.declaracao||'/'||(e.meta->>'marketing'), ',' order by s.email_normalized)
        from public.early_access_signups s
        join public.early_access_consents c on c.signup_id = s.id and c.source = 'email_confirmation' and c.kind = 'marketing'
        join public.early_access_events e on e.signup_id = s.id and e.kind = 'email_verified'
       where s.email_normalized in ('ana@example.com','mkt_in@example.com','mkt_out@example.com'))
     <> 'ana@example.com=sem_escolha/sem_escolha,mkt_in@example.com=opt_in/opt_in,mkt_out@example.com=opt_out/opt_out' then
    raise exception 'T16.24: tri-estado nao preservado';
  end if;
  raise notice 'T16.24 OK — EA2-IA06: sem_escolha, opt_in e opt_out distintos no consentimento e no evento';
end $$;

-- ── T16.25 — EA2-A02 reprovado: efetivo exige verificação + opt-in explícito ──
do $$
declare st text; n int;
begin
  -- a aplicação não grava signups direto
  begin
    execute 'set local role service_role';
    execute 'update public.early_access_signups set marketing_efetivo = true';
    st := 'EXECUTOU';
  exception when others then st := sqlstate;
  end;
  execute 'reset role';
  if st is distinct from '42501' then raise exception 'T16.25a: service_role gravou signups (%)', st; end if;
  -- toda declaração do formulário (provisória) está desligada como efetivo
  if exists (select 1 from public.early_access_signups where marketing_opt_in and email_verified_at is null and marketing_efetivo) then
    raise exception 'T16.25b: declaracao provisoria virou efetivo';
  end if;
  -- INVARIANTE GLOBAL: todo efetivo=true tem verificação + escolha + consentimento opt_in da confirmação
  select count(*) into n from public.early_access_signups s
   where s.marketing_efetivo
     and not (s.email_verified_at is not null and s.marketing_escolhido_em is not null
              and exists (select 1 from public.early_access_consents c
                           where c.signup_id = s.id and c.kind = 'marketing' and c.source = 'email_confirmation'
                             and c.declaracao = 'opt_in' and c.granted));
  if n <> 0 then raise exception 'T16.25c: % efetivos sem prova', n; end if;
  if (select count(*) from public.early_access_signups where marketing_efetivo) < 4 then
    raise exception 'T16.25d: controle positivo ausente (esperava opt-ins reais)';
  end if;
  raise notice 'T16.25 OK — EA2-A02 reprovado: efetivo so com verificacao + opt-in explicito; provisoria nunca vira efetivo; app sem escrita direta';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RODADA DE FECHAMENTO (segunda auditoria independente: EA2-IA07…IA09)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── T16.26 — EA2-IA09: momento de escolha só existe quando houve escolha ────
do $$
declare r record;
begin
  for r in select s.email_normalized e, s.marketing_efetivo ef, s.marketing_escolhido_em em, c.declaracao d
             from public.early_access_signups s
             join public.early_access_consents c on c.signup_id = s.id and c.source = 'email_confirmation' and c.kind = 'marketing'
            where s.email_normalized in ('ana@example.com','mkt_in@example.com','mkt_out@example.com') loop
    if (r.d = 'opt_in'      and not (r.ef and r.em is not null))
    or (r.d = 'opt_out'     and not (not r.ef and r.em is not null))
    or (r.d = 'sem_escolha' and not (not r.ef and r.em is null)) then
      raise exception 'T16.26: % (%): efetivo=% escolhido_em=%', r.e, r.d, r.ef, r.em;
    end if;
  end loop;
  -- banco-inteiro: toda confirmação 'sem_escolha' tem escolhido_em NULL; toda opt_in/opt_out tem momento
  if exists (select 1 from public.early_access_signups s join public.early_access_consents c
               on c.signup_id = s.id and c.source = 'email_confirmation' and c.kind = 'marketing'
              where (c.declaracao = 'sem_escolha') <> (s.marketing_escolhido_em is null)) then
    raise exception 'T16.26b: momento de escolha incoerente com a declaracao';
  end if;
  raise notice 'T16.26 OK — EA2-IA09: opt_in (efetivo, momento), opt_out (nao efetivo, momento), sem_escolha (nao efetivo, sem momento)';
end $$;

-- ── T16.27 — EA2-IA07: nota livre do operador some com a purga; o banco não escreve no log persistente ──
do $$
declare v_sid uuid; n_audit_antes int; n_audit_depois int;
begin
  execute 'set local role service_role';
  perform pg_temp.insc('notapii@example.com', 'YYYYYYYYY7', pg_temp.h('np1'));
  execute 'reset role';
  select id into v_sid from public.early_access_signups where email_normalized = 'notapii@example.com';
  select count(*) into n_audit_antes from public.admin_audit_log;
  -- a rota passa "codigo — nota"; a nota simula PII digitada por engano
  execute 'set local role service_role';
  perform public.early_access_transicionar(v_sid, 'blocked', 'admin:0xADMIN', 'abuse — Joao da Silva joao@example.com');
  execute 'reset role';
  select count(*) into n_audit_depois from public.admin_audit_log;
  if n_audit_depois <> n_audit_antes then raise exception 'T16.27a: RPC escreveu no admin_audit_log'; end if;
  if (select status_reason from public.early_access_signups where id = v_sid) not like 'abuse — %' then
    raise exception 'T16.27b: nota nao ficou no registro da inscricao';
  end if;
  perform pg_temp.envelhecer('notapii@example.com', interval '8 days');
  execute 'set local role service_role';
  perform public.early_access_purgar_nao_verificados(500);
  execute 'reset role';
  if exists (select 1 from public.early_access_signups where id = v_sid)
     or exists (select 1 from public.early_access_events where signup_id = v_sid)
     or exists (select 1 from public.early_access_purges p where row(p.*)::text like '%Joao%' or row(p.*)::text like '%joao@%')
     or exists (select 1 from public.early_access_webhook_eventos w where row(w.*)::text like '%joao%')
     or exists (select 1 from public.early_access_events e where e.reason like '%Joao%')
     or exists (select 1 from public.early_access_signups s where s.status_reason like '%Joao%') then
    raise exception 'T16.27c: nota com PII sobreviveu a purga';
  end if;
  if (select string_agg(motivo||'/'||status_no_momento, ',') from public.early_access_purges where signup_id = v_sid)
     <> 'unverified_retention/blocked' then
    raise exception 'T16.27d: lapide inesperada';
  end if;
  raise notice 'T16.27 OK — EA2-IA07: nota do operador so no registro da inscricao; purga apaga; o banco nunca escreve admin_audit_log';
end $$;

rollback;
