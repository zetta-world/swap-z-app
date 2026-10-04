\set ON_ERROR_STOP on
-- ═══════════════════════════════════════════════════════════════════════════
-- 19 — SINAL DE DEMANDA (0072): preço exibido obrigatório para "pretende_comprar", versão da regra, ACL.
-- BEGIN … ROLLBACK; dados SINTÉTICOS (e-mail .invalid, país "ZZ").
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── T19.1: colunas e ACL ───────────────────────────────────────────────────
do $$
declare r text; c text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'founders_demand_signals' and column_name = 'preco_intencao_usd' and data_type = 'numeric') then
    raise exception 'T19.1: preco_intencao_usd ausente'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'founders_demand_signals' and column_name = 'regra_versao' and column_default = '1' and is_nullable = 'NO') then
    raise exception 'T19.1: regra_versao ausente/sem default 1'; end if;
  foreach r in array array['anon','authenticated'] loop
    foreach c in array array['preco_intencao_usd','regra_versao'] loop
      if has_column_privilege(r, 'public.founders_demand_signals', c, 'SELECT') or has_column_privilege(r, 'public.founders_demand_signals', c, 'UPDATE')
         or has_column_privilege(r, 'public.founders_demand_signals', c, 'INSERT') then raise exception 'T19.1: % tem privilégio em %', r, c; end if;
    end loop;
  end loop;
  if not has_column_privilege('service_role', 'public.founders_demand_signals', 'preco_intencao_usd', 'UPDATE') then raise exception 'T19.1: service_role sem update do preço'; end if;
  if has_column_privilege('service_role', 'public.founders_demand_signals', 'regra_versao', 'UPDATE') then raise exception 'T19.1: regra_versao atualizável'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'founders_demand_signals') then raise exception 'T19.1: policy apareceu'; end if;
  raise notice 'T19.1 OK — colunas novas; anon/authenticated sem nada; service_role corrige só o preço; 0 policies';
end $$;

-- ── T19.2: regras de linha ─────────────────────────────────────────────────
do $$
declare s1 uuid; s2 uuid; s3 uuid; v smallint;
begin
  insert into public.early_access_signups (email_normalized, display_name, country, referral_code, source, terms_version, privacy_version, accepted_at)
  values ('sintetico-19a@example.invalid', 'Sintetico', 'ZZ', 'ABCDEFGHJM', 'teste_19', 'TESTE', 'TESTE', now()) returning id into s1;
  insert into public.early_access_signups (email_normalized, display_name, country, referral_code, source, terms_version, privacy_version, accepted_at)
  values ('sintetico-19b@example.invalid', 'Sintetico', 'ZZ', 'ABCDEFGHJN', 'teste_19', 'TESTE', 'TESTE', now()) returning id into s2;
  insert into public.early_access_signups (email_normalized, display_name, country, referral_code, source, terms_version, privacy_version, accepted_at)
  values ('sintetico-19c@example.invalid', 'Sintetico', 'ZZ', 'ABCDEFGHJP', 'teste_19', 'TESTE', 'TESTE', now()) returning id into s3;
  begin
    insert into public.founders_demand_signals (signup_id, tier_preference, intencao_nao_vinculante, fonte) values (s1, 'PRO', 'pretende_comprar', 'teste_19');
    raise exception 'T19.2: intenção sem preço aceita';
  exception when check_violation then null; end;
  insert into public.founders_demand_signals (signup_id, tier_preference, intencao_nao_vinculante, preco_intencao_usd, fonte) values (s1, 'PRO', 'pretende_comprar', 149, 'teste_19');
  select regra_versao into v from public.founders_demand_signals where signup_id = s1;
  if v <> 1 then raise exception 'T19.2: regra_versao padrão %', v; end if;
  insert into public.founders_demand_signals (signup_id, tier_preference, intencao_nao_vinculante, fonte) values (s2, 'TRADER', 'talvez', 'teste_19');
  begin
    insert into public.founders_demand_signals (signup_id, tier_preference, intencao_nao_vinculante, preco_intencao_usd, fonte) values (s3, 'PILOT', 'pretende_comprar', 0, 'teste_19');
    raise exception 'T19.2: preço zero aceito';
  exception when check_violation then null; end;
  begin
    insert into public.founders_demand_signals (signup_id, tier_preference, regra_versao, fonte) values (s3, 'PILOT', 0, 'teste_19');
    raise exception 'T19.2: regra_versao 0 aceita';
  exception when check_violation then null; end;
  delete from public.early_access_signups where id in (s1, s2, s3);
  if exists (select 1 from public.founders_demand_signals where signup_id in (s1, s2, s3)) then raise exception 'T19.2: cascata quebrou'; end if;
  raise notice 'T19.2 OK — pretende_comprar exige preço > 0; versão padrão 1; cascata LGPD mantida';
end $$;

rollback;
\echo 'TESTE 19: TODOS OK (rollback — nenhum dado ficou)'
