\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 15 — EARLY ACCESS: ACL, RLS, append-only, constraints, máquina de estados
-- Migration: 0068_early_access.sql · Plano: docs/PLANO-EARLY-ACCESS.md
--
-- ⚠️ RODAR NUM AMBIENTE COM OS DEFAULT PRIVILEGES DO SUPABASE (ver
-- 14_acl_tabelas_financeiras.sql). Em PostgreSQL puro as tabelas nasceriam
-- sem grant para anon/authenticated e T15.2 passaria mesmo sem os REVOKEs.
-- NUNCA contra produção. Tudo dentro de BEGIN … ROLLBACK.
--
--   T15.1   tabelas existem, RLS ligada, zero policies
--   T15.2   PUBLIC/anon/authenticated sem privilégio de tabela nem de coluna
--   T15.3   service_role SOMENTE SELECT nas três (F-04)
--   T15.4   anon/authenticated: SELECT/INSERT/TRUNCATE negados por PRIVILÉGIO
--   T15.5   service_role: INSERT/UPDATE/DELETE/TRUNCATE negados nas três
--   T15.6   RPCs: EXECUTE só service_role; DEFINER com search_path fixo
--   T15.7   seed do gate fechado, sem sobrescrever decisão existente
--   T15.8   inscrição cria signup + 3 consents + evento, atomicamente
--   T15.9   duplicado não altera nada e devolve o mesmo tipo de resultado
--   T15.10  sentinela UNAPPROVED em qualquer caixa/espaço + formato (F-03)
--   T15.11  constraints da tabela principal
--   T15.12  referral: vínculo, sinal de IP sem bloqueio, código inexistente
--   T15.13  colisão de código de referral tenta o próximo candidato
--   T15.14  matriz de estados + motivo obrigatório + conversão
--   T15.15  atomicidade: evento que falha desfaz a transição
--   T15.16  unique parcial só para carteira VERIFICADA; EVM sem caixa (F-06)
--   T15.17  evento não carrega email
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- Helper de inscrição com padrões razoáveis (SECURITY INVOKER: roda com o
-- papel corrente, então chamado após `set local role service_role` prova o
-- caminho real da aplicação).
-- 0069: a RPC ganhou `p_locale` e `p_token_hash` e devolve jsonb. O helper passa
-- os dois como NULL (sem token: estes testes são do contrato da 0068) e lê
-- `->>'resultado'`, que mantém os valores 'criado'/'existente' de antes.
create function pg_temp.insc(
  p_email text, p_codigos text[], p_ref text default null,
  p_wallet text default null, p_chain text default null,
  p_ip text default 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  p_terms text default 'tos-2026-10', p_utm text default 'utm_a'
) returns text language sql as $$
  select public.early_access_inscrever(
    p_email, 'Pessoa Teste', 'BR', p_wallet, p_chain, null, null, p_ref, p_codigos,
    p_utm, null, null, null, null, '/early-access', null, 'early_access_page',
    p_terms, 'priv-2026-10', false, p_ip, null, null)->>'resultado';
$$;
grant execute on function pg_temp.insc(text, text[], text, text, text, text, text, text) to service_role;

-- ── T15.1 ───────────────────────────────────────────────────────────────────
do $$
declare r record; n int := 0;
begin
  for r in select c.relname, c.relrowsecurity,
                  (select count(*) from pg_policy where polrelid = c.oid) pol
             from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public'
              and c.relname in ('early_access_signups','early_access_events','early_access_consents') loop
    if not r.relrowsecurity then raise exception 'T15.1: % sem RLS', r.relname; end if;
    if r.pol <> 0 then raise exception 'T15.1: % tem % policies', r.relname, r.pol; end if;
    n := n + 1;
  end loop;
  if n <> 3 then raise exception 'T15.1: esperava 3 tabelas, achei %', n; end if;
  raise notice 'T15.1 OK — 3 tabelas, RLS ligada, zero policies';
end $$;

-- ── T15.2 ───────────────────────────────────────────────────────────────────
do $$
declare t text; r text; p text; n int := 0; v int;
begin
  foreach t in array array['early_access_signups','early_access_events','early_access_consents'] loop
    if exists (select 1 from pg_class c, aclexplode(c.relacl) a
                where c.oid = ('public.'||t)::regclass and a.grantee = 0) then
      raise exception 'T15.2: PUBLIC tem privilegio direto em %', t;
    end if;
    foreach r in array array['anon','authenticated'] loop
      foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(r, 'public.'||t, p) then
          raise exception 'T15.2: % tem % em %', r, p, t;
        end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  select count(*) into v from information_schema.column_privileges
   where table_schema = 'public' and table_name like 'early_access_%'
     and grantee in ('PUBLIC','anon','authenticated');
  if v <> 0 then raise exception 'T15.2: % privilegios de coluna abertos', v; end if;
  raise notice 'T15.2 OK — % combinacoes negadas; PUBLIC sem grant; zero privilegio de coluna', n;
end $$;

-- ── T15.3 ───────────────────────────────────────────────────────────────────
do $$
declare t text; p text; quer boolean;
begin
  foreach t in array array['early_access_signups','early_access_events','early_access_consents'] loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      quer := p = 'SELECT';
      if has_table_privilege('service_role', 'public.'||t, p) is distinct from quer then
        raise exception 'T15.3: service_role % em %: tem=%, esperado=%', p, t,
          has_table_privilege('service_role', 'public.'||t, p), quer;
      end if;
    end loop;
  end loop;
  raise notice 'T15.3 OK — service_role: SOMENTE SELECT nas tres tabelas (sem INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER)';
end $$;

-- ── T15.4 ───────────────────────────────────────────────────────────────────
do $$
declare t text; r text; op text; estado text; msg text; n int := 0;
begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['early_access_signups','early_access_events','early_access_consents'] loop
      foreach op in array array['select','insert','truncate'] loop
        estado := null; msg := null;
        begin
          execute format('set local role %I', r);
          if op = 'select' then execute format('select count(*) from public.%I', t);
          elsif op = 'insert' then execute format('insert into public.%I default values', t);
          else execute format('truncate public.%I', t);
          end if;
          estado := 'EXECUTOU';
        exception when others then estado := sqlstate; msg := sqlerrm;
        end;
        execute 'reset role';
        if estado is distinct from '42501' or msg not like 'permission denied for table%' then
          raise exception 'T15.4: % % em % → % / %', r, op, t, estado, coalesce(msg,'-');
        end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  raise notice 'T15.4 OK — % tentativas de anon/authenticated negadas por privilegio', n;
end $$;

-- ── T15.5 ───────────────────────────────────────────────────────────────────
do $$
declare t text; op text; estado text; msg text; n int := 0;
begin
  foreach t in array array['early_access_events','early_access_consents','early_access_signups'] loop
    foreach op in array array['update','delete','truncate','insert'] loop
      estado := null; msg := null;
      begin
        execute 'set local role service_role';
        if op = 'update' then execute format('update public.%I set created_at = now()', t);
        elsif op = 'delete' then execute format('delete from public.%I', t);
        elsif op = 'truncate' then execute format('truncate public.%I', t);
        else execute format('insert into public.%I default values', t);
        end if;
        estado := 'EXECUTOU';
      exception when others then estado := sqlstate; msg := sqlerrm;
      end;
      execute 'reset role';
      if estado is distinct from '42501' or msg not like 'permission denied for table%' then
        raise exception 'T15.5: service_role % em % → % / %', op, t, estado, coalesce(msg,'-');
      end if;
      n := n + 1;
    end loop;
  end loop;
  raise notice 'T15.5 OK — % escritas diretas de service_role negadas (inclui INSERT em events/consents)', n;
end $$;

-- ── T15.6 ───────────────────────────────────────────────────────────────────
do $$
declare r record; n int := 0;
begin
  for r in select p.oid, p.oid::regprocedure::text sig, p.prosecdef, p.proconfig, p.proname
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.proname like 'early_access_%' loop
    if has_function_privilege('anon', r.oid, 'EXECUTE') then raise exception 'T15.6: anon executa %', r.sig; end if;
    if has_function_privilege('authenticated', r.oid, 'EXECUTE') then raise exception 'T15.6: authenticated executa %', r.sig; end if;
    if not has_function_privilege('service_role', r.oid, 'EXECUTE') then raise exception 'T15.6: service_role NAO executa %', r.sig; end if;
    if exists (select 1 from pg_proc p2, aclexplode(p2.proacl) a where p2.oid = r.oid and a.grantee = 0) then
      raise exception 'T15.6: PUBLIC executa %', r.sig;
    end if;
    if r.proconfig is null or not ('search_path=public, pg_temp' = any(r.proconfig)) then
      raise exception 'T15.6: % sem search_path fixo (%)', r.sig, r.proconfig;
    end if;
    if r.proname in ('early_access_inscrever','early_access_transicionar') and not r.prosecdef then
      raise exception 'T15.6: % deveria ser SECURITY DEFINER', r.sig;
    end if;
    n := n + 1;
  end loop;
  -- 0069: 4 da 0068 + 8 RPCs novas (inscrever e transicionar foram recriadas, não somadas).
  -- As internas `ea_interno_*` não casam com 'early_access_%' e são conferidas no T16.3.
  if n <> 12 then raise exception 'T15.6: esperava 12 funcoes (0068 + 0069), achei %', n; end if;
  raise notice 'T15.6 OK — 12 funcoes: EXECUTE so service_role, search_path fixo, RPCs DEFINER';
end $$;

-- ── T15.7 ───────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  select value into v from public.admin_kv where key = 'disable_early_access';
  if v is distinct from 'true' then raise exception 'T15.7: seed do gate = %, esperado true', v; end if;
  -- reaplicar o seed não pode sobrescrever uma decisão explícita
  update public.admin_kv set value = 'false' where key = 'disable_early_access';
  insert into public.admin_kv (key, value) values ('disable_early_access', 'true') on conflict (key) do nothing;
  select value into v from public.admin_kv where key = 'disable_early_access';
  if v <> 'false' then raise exception 'T15.7: seed sobrescreveu decisao existente'; end if;
  update public.admin_kv set value = 'true' where key = 'disable_early_access';
  raise notice 'T15.7 OK — gate nasce fechado e o seed nao sobrescreve decisao existente';
end $$;

-- ── T15.8 ───────────────────────────────────────────────────────────────────
set local role service_role;
do $$
declare res text; v_id uuid; nc int; ne int;
begin
  res := pg_temp.insc('ana@example.com', array['AAAAAAAAA1']);
  if res <> 'criado' then raise exception 'T15.8: resultado %', res; end if;
  select id into v_id from public.early_access_signups where email_normalized = 'ana@example.com';
  select count(*) into nc from public.early_access_consents where signup_id = v_id;
  select count(*) into ne from public.early_access_events where signup_id = v_id and kind = 'created' and actor = 'public';
  if nc <> 3 or ne <> 1 then raise exception 'T15.8: consents=% eventos_created=%', nc, ne; end if;
  if (select status from public.early_access_signups where id = v_id) <> 'pending' then
    raise exception 'T15.8: status inicial nao e pending';
  end if;
  raise notice 'T15.8 OK — signup pending + 3 consents + evento created, pelo papel service_role';
end $$;

-- ── T15.9 ───────────────────────────────────────────────────────────────────
do $$
declare res text; antes text; depois text; nc int; nd int;
begin
  select row(wallet_address, utm_source, referral_code, referred_by_signup_id, display_name)::text
    into antes from public.early_access_signups where email_normalized = 'ana@example.com';
  res := pg_temp.insc('ana@example.com', array['BBBBBBBBB2'], 'AAAAAAAAA1',
                      '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A', 'evm',
                      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'tos-2026-10', 'utm_ataque');
  select row(wallet_address, utm_source, referral_code, referred_by_signup_id, display_name)::text
    into depois from public.early_access_signups where email_normalized = 'ana@example.com';
  if res <> 'existente' then raise exception 'T15.9: resultado %', res; end if;
  if antes <> depois then raise exception 'T15.9: duplicado alterou a linha: % → %', antes, depois; end if;
  select count(*) into nc from public.early_access_consents c join public.early_access_signups s on s.id = c.signup_id
   where s.email_normalized = 'ana@example.com';
  select count(*) into nd from public.early_access_events e join public.early_access_signups s on s.id = e.signup_id
   where s.email_normalized = 'ana@example.com' and e.kind = 'duplicate_attempt';
  if nc <> 3 or nd <> 1 then raise exception 'T15.9: consents=% duplicate_attempt=%', nc, nd; end if;
  if (select count(*) from public.early_access_signups where email_normalized = 'ana@example.com') <> 1 then
    raise exception 'T15.9: duplicou a linha';
  end if;
  raise notice 'T15.9 OK — duplicado: linha intacta (carteira/UTM/referral), sem consent novo, evento duplicate_attempt';
end $$;

-- ── T15.10 ──────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    perform pg_temp.insc('bia@example.com', array['CCCCCCCCC3'], null, null, null,
                         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'UNAPPROVED');
  exception when others then
    ok := sqlerrm = 'early_access_versao_legal_nao_aprovada';
  end;
  if not ok then raise exception 'T15.10: RPC aceitou UNAPPROVED'; end if;
  if exists (select 1 from public.early_access_signups where email_normalized = 'bia@example.com') then
    raise exception 'T15.10: linha gravada com UNAPPROVED';
  end if;
  raise notice 'T15.10a OK — RPC recusa versao UNAPPROVED';
end $$;

-- F-03: o sentinela em qualquer caixa e com espaço lateral, e versões fora do
-- formato, são recusados pela RPC.
do $$
declare v text; n int := 0; ok boolean;
begin
  foreach v in array array['UNAPPROVED','unapproved',' Unapproved','UNAPPROVED ','  unapproved',
                           'uNaPpRoVeD','-tos','tos 1','tos/1','', repeat('a', 41)] loop
    ok := false;
    begin
      perform pg_temp.insc('v'||n||'@example.com', array['KKKKKKKK'||lpad(n::text, 2, '0')], null, null, null,
                           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', v);
    exception when others then
      ok := sqlerrm = 'early_access_versao_legal_nao_aprovada';
    end;
    if not ok then raise exception 'T15.10c: versao % passou pela RPC', quote_literal(v); end if;
    n := n + 1;
  end loop;
  raise notice 'T15.10c OK — % variantes (caixa/espaco/formato) recusadas pela RPC', n;
end $$;
reset role;

-- Defesa em profundidade: mesmo com privilégio de dono, o CHECK recusa.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.early_access_signups (email_normalized, display_name, country, referral_code,
      source, terms_version, privacy_version, accepted_at)
    values ('cid@example.com', 'Cid', 'BR', 'DDDDDDDDD4', 'early_access_page', 'UNAPPROVED', 'p1', now());
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'T15.10b: CHECK aceitou UNAPPROVED'; end if;
  raise notice 'T15.10b OK — CHECK ea_versoes_aprovadas recusa UNAPPROVED mesmo para o dono';
end $$;

-- F-03 no CHECK, mesmo para o dono: variantes do sentinela e formato.
do $$
declare v text; n int := 0; ok boolean;
begin
  foreach v in array array['unapproved',' UNAPPROVED','UNAPPROVED ','Unapproved','tos 1','-x'] loop
    ok := false;
    begin
      insert into public.early_access_signups (email_normalized, display_name, country, referral_code,
        source, terms_version, privacy_version, accepted_at)
      values ('chk'||n||'@example.com', 'Cid', 'BR', 'DDDDDDDD'||lpad(n::text, 2, '0'), 'early_access_page', v, 'p1', now());
    exception when check_violation then ok := true;
    end;
    if not ok then raise exception 'T15.10d: CHECK aceitou versao %', quote_literal(v); end if;
    n := n + 1;
  end loop;
  raise notice 'T15.10d OK — CHECK recusa % variantes do sentinela/formato mesmo para o dono', n;
end $$;

-- ── T15.11 ──────────────────────────────────────────────────────────────────
do $$
declare
  casos text[][] := array[
    array['email maiusculo',          $c$update public.early_access_signups set email_normalized = 'Ana@example.com' where email_normalized = 'ana@example.com'$c$],
    array['email nao ascii',          $c$update public.early_access_signups set email_normalized = 'ãna@example.com' where email_normalized = 'ana@example.com'$c$],
    array['pais minusculo',           $c$update public.early_access_signups set country = 'br' where email_normalized = 'ana@example.com'$c$],
    array['pais 3 letras',            $c$update public.early_access_signups set country = 'BRA' where email_normalized = 'ana@example.com'$c$],
    array['nome curto',               $c$update public.early_access_signups set display_name = 'A' where email_normalized = 'ana@example.com'$c$],
    array['nome com controle',        $c$update public.early_access_signups set display_name = E'Ana\x07Bia' where email_normalized = 'ana@example.com'$c$],
    array['nome longo',               $c$update public.early_access_signups set display_name = repeat('a', 81) where email_normalized = 'ana@example.com'$c$],
    array['carteira sem chain',       $c$update public.early_access_signups set wallet_address = '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A' where email_normalized = 'ana@example.com'$c$],
    array['chain sem carteira',       $c$update public.early_access_signups set wallet_chain = 'evm' where email_normalized = 'ana@example.com'$c$],
    array['chain invalida',           $c$update public.early_access_signups set wallet_address = '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A', wallet_chain = 'btc' where email_normalized = 'ana@example.com'$c$],
    array['status invalido',          $c$update public.early_access_signups set status = 'verified' where email_normalized = 'ana@example.com'$c$],
    array['status converted',         $c$update public.early_access_signups set status = 'converted' where email_normalized = 'ana@example.com'$c$],
    array['rejected sem motivo',      $c$update public.early_access_signups set status = 'rejected', status_reason = null where email_normalized = 'ana@example.com'$c$],
    array['blocked motivo vazio',     $c$update public.early_access_signups set status = 'blocked', status_reason = '  ' where email_normalized = 'ana@example.com'$c$],
    array['auto-indicacao',           $c$update public.early_access_signups set referred_by_signup_id = id where email_normalized = 'ana@example.com'$c$],
    array['verificada sem carteira',  $c$update public.early_access_signups set wallet_verified_at = now() where email_normalized = 'ana@example.com'$c$],
    array['convertido sem verificar', $c$update public.early_access_signups set converted_at = now(), converted_wallet = 'x' where email_normalized = 'ana@example.com'$c$],
    array['codigo fora do alfabeto',  $c$update public.early_access_signups set referral_code = 'IIIIIIIII1' where email_normalized = 'ana@example.com'$c$],
    array['utm longo',                $c$update public.early_access_signups set utm_source = repeat('u', 101) where email_normalized = 'ana@example.com'$c$],
    array['ip cru',                   $c$update public.early_access_signups set ip_hmac = '189.40.1.2' where email_normalized = 'ana@example.com'$c$],
    array['landing sem barra',        $c$update public.early_access_signups set landing_path = 'http://x' where email_normalized = 'ana@example.com'$c$],
    array['flag desconhecida',        $c$update public.early_access_signups set referral_flag = 'fraude' where email_normalized = 'ana@example.com'$c$]
  ];
  i int; ok boolean;
begin
  for i in 1 .. array_length(casos, 1) loop
    ok := false;
    begin
      execute casos[i][2];
    exception when check_violation then ok := true;
    end;
    if not ok then raise exception 'T15.11: constraint nao barrou: %', casos[i][1]; end if;
  end loop;
  raise notice 'T15.11 OK — % violacoes barradas por CHECK', array_length(casos, 1);
end $$;

-- ── T15.12 / T15.13 ─────────────────────────────────────────────────────────
set local role service_role;
do $$
declare v_ana uuid; r record;
begin
  select id into v_ana from public.early_access_signups where email_normalized = 'ana@example.com';

  -- vínculo normal (IP diferente)
  perform pg_temp.insc('bia@example.com', array['EEEEEEEEE5'], 'AAAAAAAAA1', null, null,
                       'cccccccccccccccccccccccccccccccc');
  select referred_by_signup_id, referral_flag into r from public.early_access_signups where email_normalized = 'bia@example.com';
  if r.referred_by_signup_id is distinct from v_ana or r.referral_flag is not null then
    raise exception 'T15.12a: vinculo % flag %', r.referred_by_signup_id, r.referral_flag;
  end if;

  -- mesmo IP: SINAL, sem bloquear e sem desfazer o vínculo
  perform pg_temp.insc('caio@example.com', array['FFFFFFFFF6'], 'AAAAAAAAA1');
  select status, referred_by_signup_id, referral_flag into r from public.early_access_signups where email_normalized = 'caio@example.com';
  if r.status <> 'pending' or r.referred_by_signup_id is distinct from v_ana or r.referral_flag <> 'sinal_mesmo_ip' then
    raise exception 'T15.12b: % % %', r.status, r.referred_by_signup_id, r.referral_flag;
  end if;

  -- código inexistente: ignorado em silêncio
  perform pg_temp.insc('davi@example.com', array['GGGGGGGGG7'], 'ZZZZZZZZZ9');
  if (select referred_by_signup_id from public.early_access_signups where email_normalized = 'davi@example.com') is not null then
    raise exception 'T15.12c: codigo inexistente criou vinculo';
  end if;
  raise notice 'T15.12 OK — referral vincula; mesmo IP so sinaliza (nao bloqueia); codigo inexistente ignorado';

  -- colisão: o primeiro candidato já é da Ana
  perform pg_temp.insc('edu@example.com', array['AAAAAAAAA1','HHHHHHHHH8']);
  if (select referral_code from public.early_access_signups where email_normalized = 'edu@example.com') <> 'HHHHHHHHH8' then
    raise exception 'T15.13: colisao nao tentou o proximo candidato';
  end if;
  begin
    perform pg_temp.insc('fabi@example.com', array['AAAAAAAAA1']);
    raise exception 'T15.13: candidatos esgotados nao falhou';
  exception when others then
    if sqlerrm <> 'early_access_codigos_esgotados' then raise; end if;
  end;
  raise notice 'T15.13 OK — colisao de codigo tenta o proximo; todos colidindo falha explicitamente';
end $$;

-- 0069 (D-4): aprovar exige email verificado (CHECK + RPC). As inscrições que
-- a T15.14/T15.14b/T15.15 aprovam recebem `email_verified_at` pelo DONO aqui;
-- a recusa de aprovar sem verificação é provada no T16.12. Nenhuma asserção
-- deste arquivo foi removida.
reset role;
update public.early_access_signups set email_verified_at = now()
 where email_normalized in ('bia@example.com','davi@example.com','edu@example.com');
set local role service_role;

-- ── T15.14 ──────────────────────────────────────────────────────────────────
do $$
declare
  estados text[] := array['pending','approved','rejected','blocked'];
  esperado text[] := array['pending>approved','pending>rejected','pending>blocked',
                           'approved>rejected','approved>blocked',
                           'rejected>pending','rejected>blocked','blocked>pending'];
  de text; para text; n int := 0; v_id uuid; res jsonb;
  procedure_falha text;
begin
  foreach de in array estados loop
    foreach para in array estados loop
      if public.early_access_transicao_permitida(de, para) is distinct from ((de||'>'||para) = any(esperado)) then
        raise exception 'T15.14: matriz divergente em %→%', de, para;
      end if;
      n := n + 1;
    end loop;
  end loop;

  select id into v_id from public.early_access_signups where email_normalized = 'bia@example.com';

  -- pending → approved (sem motivo: ok)
  res := public.early_access_transicionar(v_id, 'approved', 'admin:0xADMIN', null);
  -- approved → pending: proibido
  begin perform public.early_access_transicionar(v_id, 'pending', 'admin:0xADMIN', 'x'); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_transicao_proibida' then raise exception 'T15.14 a: %', sqlerrm; end if; end;
  -- approved → rejected sem motivo: barrado
  begin perform public.early_access_transicionar(v_id, 'rejected', 'admin:0xADMIN', '  '); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_motivo_obrigatorio' then raise exception 'T15.14 b: %', sqlerrm; end if; end;
  res := public.early_access_transicionar(v_id, 'rejected', 'admin:0xADMIN', 'perfil incompleto');
  -- rejected → approved: proibido
  begin perform public.early_access_transicionar(v_id, 'approved', 'admin:0xADMIN', 'x'); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_transicao_proibida' then raise exception 'T15.14 c: %', sqlerrm; end if; end;
  -- rejected → pending sem motivo: barrado; com motivo: ok
  begin perform public.early_access_transicionar(v_id, 'pending', 'admin:0xADMIN', null); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_motivo_obrigatorio' then raise exception 'T15.14 d: %', sqlerrm; end if; end;
  res := public.early_access_transicionar(v_id, 'pending', 'admin:0xADMIN', 'reconsiderado');
  res := public.early_access_transicionar(v_id, 'blocked', 'admin:0xADMIN', 'spam');
  -- blocked → approved: proibido; blocked → pending sem motivo: barrado
  begin perform public.early_access_transicionar(v_id, 'approved', 'admin:0xADMIN', 'x'); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_transicao_proibida' then raise exception 'T15.14 e: %', sqlerrm; end if; end;
  begin perform public.early_access_transicionar(v_id, 'pending', 'admin:0xADMIN', ''); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_motivo_obrigatorio' then raise exception 'T15.14 f: %', sqlerrm; end if; end;
  res := public.early_access_transicionar(v_id, 'pending', 'admin:0xADMIN', 'desbloqueio revisado');
  if (select status from public.early_access_signups where id = v_id) <> 'pending'
     or (select status_reason from public.early_access_signups where id = v_id) is not null then
    raise exception 'T15.14: estado final inesperado';
  end if;
  if (select count(*) from public.early_access_events where signup_id = v_id and kind = 'status_changed') <> 5 then
    raise exception 'T15.14: esperava 5 eventos status_changed, achei %',
      (select count(*) from public.early_access_events where signup_id = v_id and kind = 'status_changed');
  end if;
  -- id inexistente
  begin perform public.early_access_transicionar(gen_random_uuid(), 'approved', 'admin:0xADMIN', null); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_nao_encontrado' then raise exception 'T15.14 g: %', sqlerrm; end if; end;
  raise notice 'T15.14a OK — matriz 4x4 (% pares) e fluxo completo com motivo obrigatorio; 5 eventos gravados', n;
end $$;
reset role;

-- conversão: approved convertido não pode ir a rejected, mas pode ir a blocked
do $$
declare v_id uuid;
begin
  select id into v_id from public.early_access_signups where email_normalized = 'davi@example.com';
  perform public.early_access_transicionar(v_id, 'approved', 'admin:0xADMIN', null);
  update public.early_access_signups
     set wallet_address = '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A', wallet_chain = 'evm',
         wallet_verified_at = now(), converted_at = now(),
         converted_wallet = '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A'
   where id = v_id;
  begin perform public.early_access_transicionar(v_id, 'rejected', 'admin:0xADMIN', 'mudou de ideia'); raise exception 'X';
  exception when others then if sqlerrm <> 'early_access_ja_convertido' then raise exception 'T15.14b: %', sqlerrm; end if; end;
  perform public.early_access_transicionar(v_id, 'blocked', 'admin:0xADMIN', 'fraude apos conversao');
  raise notice 'T15.14b OK — convertido nao volta a rejected; blocked continua possivel';
end $$;

-- ── T15.15 ──────────────────────────────────────────────────────────────────
-- Força o INSERT do evento a falhar; o UPDATE da transição tem de voltar junto.
alter table public.early_access_events add constraint t15_falha_forcada check (to_status is distinct from 'approved') not valid;
do $$
declare v_id uuid; ok boolean := false;
begin
  select id into v_id from public.early_access_signups where email_normalized = 'edu@example.com';
  begin
    perform public.early_access_transicionar(v_id, 'approved', 'admin:0xADMIN', null);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'T15.15: transicao passou sem evento'; end if;
  if (select status from public.early_access_signups where id = v_id) <> 'pending' then
    raise exception 'T15.15: status mudou sem evento — audit NAO e atomico';
  end if;
  raise notice 'T15.15 OK — evento que falha desfaz a transicao (sem evento, sem mudanca)';
end $$;
alter table public.early_access_events drop constraint t15_falha_forcada;

-- ── T15.16 ──────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  -- carteira DECLARADA igual em duas inscrições: permitido
  update public.early_access_signups set wallet_address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', wallet_chain = 'solana'
   where email_normalized in ('bia@example.com','caio@example.com');
  update public.early_access_signups set wallet_verified_at = now() where email_normalized = 'bia@example.com';
  begin
    update public.early_access_signups set wallet_verified_at = now() where email_normalized = 'caio@example.com';
  exception when unique_violation then ok := true;
  end;
  if not ok then raise exception 'T15.16: carteira verificada duplicada aceita'; end if;
  raise notice 'T15.16a OK — declarada repete; verificada e unica por (chain, carteira)';
end $$;

-- F-06: EVM compara sem caixa (checksum x minúscula colidem); Solana preserva
-- a caixa (strings que só diferem na caixa são carteiras DIFERENTES).
do $$
declare ok boolean := false;
begin
  update public.early_access_signups set wallet_address = '0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A',
         wallet_chain = 'evm', wallet_verified_at = now() where email_normalized = 'davi@example.com';
  begin
    update public.early_access_signups set wallet_address = lower('0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A'),
           wallet_chain = 'evm', wallet_verified_at = now() where email_normalized = 'edu@example.com';
  exception when unique_violation then ok := true;
  end;
  if not ok then raise exception 'T15.16b: EVM checksum x minuscula NAO colidiu'; end if;

  -- Solana: a mesma string em minúscula é outra chave pública → aceita.
  update public.early_access_signups set wallet_address = lower('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'),
         wallet_chain = 'solana', wallet_verified_at = now() where email_normalized = 'caio@example.com';
  if (select count(*) from public.early_access_signups
       where wallet_chain = 'solana' and wallet_verified_at is not null
         and lower(wallet_address) = lower('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')) <> 2 then
    raise exception 'T15.16c: Solana com caixa diferente deveria coexistir';
  end if;
  raise notice 'T15.16b OK — EVM: checksum x minuscula colidem; Solana: caixa diferente coexiste (sem lower)';
end $$;

-- ── T15.17 ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name in ('early_access_events','early_access_consents')
                and column_name like '%email%') then
    raise exception 'T15.17: evento/consentimento carrega email';
  end if;
  raise notice 'T15.17 OK — events e consents nao tem coluna de email';
end $$;

rollback;
