\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 18 — VENDA FOUNDERS (0071): ACL, snapshot congelado imutável, trilha append-only, cascata LGPD.
-- Tudo dentro de BEGIN … ROLLBACK: nenhum dado fica. Dados SINTÉTICOS (carteiras base58 de teste, e-mail
-- em domínio .invalid, país "ZZ" de uso privado).
-- ⚠️ Rodar onde existem os DEFAULT PRIVILEGES do Supabase (senão T18.1 passa à toa — ver nota do teste 17).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── T18.1: ACL de catálogo ──────────────────────────────────────────────────
do $$
declare t text; r text; p text; n int := 0;
  tabelas text[] := array['founders_allowlist_snapshots','founders_allowlist_entries','founders_demand_signals','founders_sale_events'];
begin
  foreach t in array tabelas loop
    if to_regclass('public.'||t) is null then raise exception 'T18.1: tabela % nao existe', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.'||t)::regclass) then raise exception 'T18.1: RLS desligada em %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then raise exception 'T18.1: % tem policy', t; end if;
    if exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = ('public.'||t)::regclass and a.grantee = 0) then
      raise exception 'T18.1: PUBLIC tem privilegio em %', t; end if;
    foreach r in array array['anon','authenticated'] loop
      foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(r, 'public.'||t, p) then raise exception 'T18.1: % tem % em %', r, p, t; end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  if exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = any(tabelas) and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception 'T18.1: privilegio de coluna para PUBLIC/anon/authenticated'; end if;
  raise notice 'T18.1 OK — % combinacoes negadas; RLS ligada; 0 policies', n;
end $$;

-- ── T18.2: service_role com o mínimo ────────────────────────────────────────
do $$
begin
  if not has_table_privilege('service_role', 'public.founders_allowlist_snapshots', 'SELECT')
     or not has_table_privilege('service_role', 'public.founders_allowlist_snapshots', 'INSERT') then raise exception 'T18.2: snapshots sem select/insert'; end if;
  if has_table_privilege('service_role', 'public.founders_allowlist_snapshots', 'UPDATE')
     or has_table_privilege('service_role', 'public.founders_allowlist_snapshots', 'DELETE') then raise exception 'T18.2: snapshots com update/delete de tabela'; end if;
  if not has_column_privilege('service_role', 'public.founders_allowlist_snapshots', 'congelado_em', 'UPDATE') then raise exception 'T18.2: sem update de congelado_em'; end if;
  if has_column_privilege('service_role', 'public.founders_allowlist_snapshots', 'raiz', 'UPDATE') then raise exception 'T18.2: update de raiz permitido'; end if;
  if has_table_privilege('service_role', 'public.founders_sale_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.founders_sale_events', 'DELETE')
     or has_table_privilege('service_role', 'public.founders_sale_events', 'TRUNCATE') then raise exception 'T18.2: eventos mutaveis pelo service_role'; end if;
  raise notice 'T18.2 OK — service_role: select/insert; congelar só pela coluna; eventos só insert';
end $$;

-- ── T18.3: anon/authenticated barrados por PRIVILÉGIO (42501) ───────────────
do $$
declare r text; t text; ok int := 0;
begin
  foreach r in array array['anon','authenticated'] loop
    foreach t in array array['founders_allowlist_snapshots','founders_allowlist_entries','founders_demand_signals','founders_sale_events'] loop
      begin
        execute format('set local role %I', r);
        execute format('select 1 from public.%I limit 1', t);
        reset role;
        raise exception 'T18.3: % leu %', r, t;
      exception when insufficient_privilege then reset role; ok := ok + 1;
      end;
    end loop;
  end loop;
  raise notice 'T18.3 OK — % leituras recusadas com 42501', ok;
end $$;

-- ── dados sintéticos ───────────────────────────────────────────────────────
insert into public.founders_allowlist_snapshots (id, versao, raiz, entradas)
values (repeat('a', 64), 9001, repeat('b', 64), 2);
insert into public.founders_allowlist_entries (snapshot_id, carteira, tier, quantidade, origem, motivo_curadoria) values
  (repeat('a', 64), '1111111111111111111111111111111111111111111', 'PRO', 1, 'early_access', null),
  (repeat('a', 64), '2222222222222222222222222222222222222222222', 'PILOT', 1, 'curada', 'apoiador fundador sintetico');

-- ── T18.4: congelar exige contagem certa; congelado é imutável ──────────────
do $$
begin
  begin
    update public.founders_allowlist_snapshots set entradas = 3 where id = repeat('a', 64);
    raise exception 'T18.4: mudou entradas';
  exception when sqlstate '55000' then null; end;
  begin
    insert into public.founders_allowlist_entries (snapshot_id, carteira, tier, quantidade, origem) values (repeat('a', 64), '3333333333333333333333333333333333333333333', 'PRO', 1, 'early_access');
    update public.founders_allowlist_snapshots set congelado_em = now() where id = repeat('a', 64);
    raise exception 'T18.4: congelou com contagem errada';
  exception when sqlstate '55000' then null; end;
  delete from public.founders_allowlist_entries where carteira = '3333333333333333333333333333333333333333333';
  update public.founders_allowlist_snapshots set congelado_em = now() where id = repeat('a', 64);
  begin update public.founders_allowlist_entries set quantidade = 5 where snapshot_id = repeat('a', 64); raise exception 'T18.4: alterou entrada congelada';
  exception when sqlstate '55000' then null; end;
  begin insert into public.founders_allowlist_entries (snapshot_id, carteira, tier, quantidade, origem) values (repeat('a', 64), '4444444444444444444444444444444444444444444', 'PRO', 1, 'early_access'); raise exception 'T18.4: inseriu em congelado';
  exception when sqlstate '55000' then null; end;
  begin delete from public.founders_allowlist_entries where snapshot_id = repeat('a', 64); raise exception 'T18.4: apagou entrada congelada';
  exception when sqlstate '55000' then null; end;
  begin update public.founders_allowlist_snapshots set congelado_em = now() + interval '1 day' where id = repeat('a', 64); raise exception 'T18.4: recongelou';
  exception when sqlstate '55000' then null; end;
  begin delete from public.founders_allowlist_snapshots where id = repeat('a', 64); raise exception 'T18.4: apagou snapshot congelado';
  exception when sqlstate '55000' then null; end;
  begin insert into public.founders_allowlist_entries (snapshot_id, carteira, tier, quantidade, origem) values (repeat('a', 64), '5555555555555555555555555555555555555555555', 'PRO', 1, 'curada'); raise exception 'T18.4: curada sem motivo';
  exception when sqlstate '55000' or check_violation then null; end;
  raise notice 'T18.4 OK — congelamento exige contagem; entradas/snapshot congelados imutáveis';
end $$;

-- ── T18.5: trilha append-only ──────────────────────────────────────────────
insert into public.founders_sale_events (tipo, dados, anterior, hash) values ('admin_audit', '{"evento":"teste"}', 'GENESIS', repeat('c', 64));
do $$
begin
  begin update public.founders_sale_events set dados = '{}' where hash = repeat('c', 64); raise exception 'T18.5: update'; exception when sqlstate '55000' then null; end;
  begin delete from public.founders_sale_events where hash = repeat('c', 64); raise exception 'T18.5: delete'; exception when sqlstate '55000' then null; end;
  begin truncate public.founders_sale_events; raise exception 'T18.5: truncate'; exception when sqlstate '55000' then null; end;
  begin insert into public.founders_sale_events (tipo, dados, anterior, hash) values ('nao_existe', '{}', 'GENESIS', repeat('d', 64)); raise exception 'T18.5: tipo invalido'; exception when check_violation then null; end;
  raise notice 'T18.5 OK — eventos: só insert; update/delete/truncate recusados; tipo fechado';
end $$;

-- ── T18.6: sinal de demanda NÃO VINCULANTE some com a inscrição (purga LGPD) ─
do $$
declare sid uuid; n int;
begin
  insert into public.early_access_signups (email_normalized, display_name, country, referral_code, source, terms_version, privacy_version, accepted_at)
  values ('sintetico-18@example.invalid', 'Sintetico', 'ZZ', 'ABCDEFGHJK', 'teste_18', 'TESTE', 'TESTE', now()) returning id into sid;
  insert into public.founders_demand_signals (signup_id, tier_preference, intencao_nao_vinculante, fonte) values (sid, 'TRADER', 'talvez', 'teste_18');
  begin insert into public.founders_demand_signals (signup_id, tier_preference, fonte) values (sid, 'PRO', 'teste_18'); raise exception 'T18.6: dois sinais'; exception when unique_violation then null; end;
  begin insert into public.founders_demand_signals (signup_id, tier_preference, intencao_nao_vinculante, fonte) values (sid, 'GOLD', null, 'x'); raise exception 'T18.6: tier invalido'; exception when check_violation or unique_violation then null; end;
  delete from public.early_access_signups where id = sid;
  select count(*) into n from public.founders_demand_signals where signup_id = sid;
  if n <> 0 then raise exception 'T18.6: sinal sobreviveu a purga'; end if;
  raise notice 'T18.6 OK — sinal único por inscrição; domínio fechado; cascata na purga';
end $$;

rollback;
\echo 'TESTE 18: TODOS OK (rollback — nenhum dado ficou)'
