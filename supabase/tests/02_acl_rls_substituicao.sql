\set ON_ERROR_STOP on
-- ── T7: TODA security definer tem search_path fixo ──────────────────────
do $$
declare r record; n int := 0;
begin
  for r in select p.proname, p.proconfig from pg_proc p
            join pg_namespace ns on ns.oid=p.pronamespace
           where ns.nspname='public' and p.prosecdef loop
    n := n + 1;
    if r.proconfig is null
       or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%') then
      raise exception 'T7: % e security definer SEM search_path fixo', r.proname;
    end if;
  end loop;
  raise notice 'T7 OK — % funcoes security definer, todas com search_path fixo', n;
end $$;

-- ── T8: ACL — anon/authenticated NAO executam as RPCs financeiras ───────
do $$
declare r record; n int := 0;
begin
  for r in select p.oid::regprocedure::text as sig, p.proname from pg_proc p
            join pg_namespace ns on ns.oid=p.pronamespace
           where ns.nspname='public' and p.prosecdef
             and (p.proname like 'cex_%' or p.proname like 'autopilot_%') loop
    n := n + 1;
    if has_function_privilege('anon', r.sig, 'EXECUTE') then
      raise exception 'T8a: anon PODE executar %', r.sig; end if;
    if has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception 'T8b: authenticated PODE executar %', r.sig; end if;
    if not has_function_privilege('service_role', r.sig, 'EXECUTE') then
      raise exception 'T8c: service_role NAO pode executar %', r.sig; end if;
  end loop;
  raise notice 'T8 OK — % RPCs financeiras fechadas para anon/authenticated', n;
end $$;

-- ── T9: sem overload inseguro das funcoes redefinidas ───────────────────
do $$
declare r record;
begin
  for r in select proname, count(*) c from pg_proc p
            join pg_namespace ns on ns.oid=p.pronamespace
           where ns.nspname='public'
             and proname in ('autopilot_compromisso_vivo','autopilot_taxa_do_intent_em_usd',
                             'cex_ingest_order_snapshot','cex_ingest_trades',
                             'autopilot_pendencias_financeiras','autopilot_projecoes_pendentes',
                             'autopilot_efeito_incompleto','autopilot_marcar_contabilidade')
           group by proname loop
    if r.c <> 1 then raise exception 'T9: % tem % versoes (overload)', r.proname, r.c; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
              where ns.nspname='public' and proname='autopilot_projecoes_pendentes') then
    raise exception 'T9b: a varredura antiga sobreviveu'; end if;
  raise notice 'T9 OK — nenhuma redefinida ficou com overload; a antiga foi derrubada';
end $$;

-- ── T10: RLS ligada e sem policy nas tabelas financeiras ────────────────
do $$
declare r record; n int := 0;
begin
  for r in select c.relname, c.relrowsecurity,
                  (select count(*) from pg_policy where polrelid=c.oid) pol
             from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
            where ns.nspname='public' and c.relkind='r'
              and c.relname in ('cex_execution_intents','cex_fills','cex_conexoes',
                                'autopilot_positions','autopilot_position_effects') loop
    n := n + 1;
    if not r.relrowsecurity then raise exception 'T10a: % sem RLS', r.relname; end if;
    if r.pol <> 0 then raise exception 'T10b: % tem % policies', r.relname, r.pol; end if;
    if has_table_privilege('anon', 'public.'||r.relname, 'SELECT') then
      raise exception 'T10c: anon le %', r.relname; end if;
  end loop;
  raise notice 'T10 OK — % tabelas com RLS default-deny e sem leitura anonima', n;
end $$;

-- ── T11: synthetic -> real preserva o ajuste de RECEBIDO ────────────────
do $$
declare r jsonb; fq numeric;
begin
  delete from cex_fills where intent_id='44444444-4444-4444-4444-444444444444';
  delete from cex_execution_intents where id='44444444-4444-4444-4444-444444444444';
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state, external_order_id)
  values ('44444444-4444-4444-4444-444444444444','cQ','0xCONC','autopilot_cron',
          true,false,'33333333-3333-3333-3333-333333333333','binance','BTC/USDT',
          'sell','limit',0.01,'SUBMITTED','ORD-Q');
  -- trade real primeiro: nenhum sintetico de quantidade sobra
  perform public.cex_ingest_trades('44444444-4444-4444-4444-444444444444','ORD-Q',
    '[{"trade_id":"TQ1","qty":0.01,"price":9800,"quote":98,"fee":1,"fee_currency":"USDT","order":"ORD-Q"}]'::jsonb);
  -- a venue corrige o custo para cima DEPOIS: ajuste de qty ZERO com quote
  perform public.cex_ingest_order_snapshot('44444444-4444-4444-4444-444444444444',
    'ORD-Q', 0.01, 10000, 100, 1, 'USDT', null);
  select filled_quote into fq from cex_execution_intents where id='44444444-4444-4444-4444-444444444444';
  if fq <> 100 then raise exception 'T11a: ajuste de quote nao entrou (%)', fq; end if;
  -- releitura do historico: os MESMOS trades, nada novo
  -- ⚠️ A PROPRIEDADE, nao o nome do portao: a substituicao e RECUSADA e o
  -- recebido sobrevive. Aqui o ajuste carrega fee E quote, entao o portao de
  -- fee dispara primeiro — os dois protegem o mesmo fato.
  r := public.cex_ingest_trades('44444444-4444-4444-4444-444444444444','ORD-Q',
    '[{"trade_id":"TQ1","qty":0.01,"price":9800,"quote":98,"fee":1,"fee_currency":"USDT","order":"ORD-Q"}]'::jsonb);
  if (r->>'ok')::boolean is not false
     or r->>'porque' not in ('cobertura_quote_incompleta','cobertura_fee_incompleta') then
    raise exception 'T11b: a substituicao nao foi segurada: %', r; end if;
  select filled_quote into fq from cex_execution_intents where id='44444444-4444-4444-4444-444444444444';
  if fq <> 100 then raise exception 'T11c: o recebido foi APAGADO pela substituicao (%)', fq; end if;
  raise notice 'T11 OK — sintetico com recebido sobrevive a lote dedupado';
end $$;

-- ── T11-BIS: o portao de QUOTE isolado (ajuste sem fee nenhuma) ─────────
do $$
declare r jsonb; fq numeric;
begin
  delete from cex_fills where intent_id='55555555-5555-5555-5555-555555555555';
  delete from cex_execution_intents where id='55555555-5555-5555-5555-555555555555';
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state, external_order_id)
  values ('55555555-5555-5555-5555-555555555555','cQ2','0xCONC','autopilot_cron',
          true,false,'33333333-3333-3333-3333-333333333333','binance','BTC/USDT',
          'sell','limit',0.01,'SUBMITTED','ORD-Q2');
  -- trade real SEM fee: nenhum sintetico com fee existira
  perform public.cex_ingest_trades('55555555-5555-5555-5555-555555555555','ORD-Q2',
    '[{"trade_id":"TR1","qty":0.01,"price":9800,"quote":98,"order":"ORD-Q2"}]'::jsonb);
  -- a venue corrige o custo para cima: ajuste de qty ZERO, quote 2, fee NULL
  perform public.cex_ingest_order_snapshot('55555555-5555-5555-5555-555555555555',
    'ORD-Q2', 0.01, 10000, 100, null, null, null);
  select filled_quote into fq from cex_execution_intents where id='55555555-5555-5555-5555-555555555555';
  if fq <> 100 then raise exception 'T11-BIS a: ajuste de quote nao entrou (%)', fq; end if;
  if not exists (select 1 from cex_fills where intent_id='55555555-5555-5555-5555-555555555555'
                   and sintetico and qty = 0 and quote_amount = 2 and fee is null) then
    raise exception 'T11-BIS b: o ajuste de quote puro nao existe'; end if;
  -- lote dedupado: SO o portao de quote pode segurar
  r := public.cex_ingest_trades('55555555-5555-5555-5555-555555555555','ORD-Q2',
    '[{"trade_id":"TR1","qty":0.01,"price":9800,"quote":98,"order":"ORD-Q2"}]'::jsonb);
  if r->>'porque' <> 'cobertura_quote_incompleta' then
    raise exception 'T11-BIS c: esperava cobertura_quote_incompleta, veio %', r; end if;
  select filled_quote into fq from cex_execution_intents where id='55555555-5555-5555-5555-555555555555';
  if fq <> 100 then raise exception 'T11-BIS d: o recebido foi apagado (%)', fq; end if;
  raise notice 'T11-BIS OK — o portao de QUOTE segura sozinho, sem fee envolvida';
end $$;

-- ── T12: regressao de quantidade e de recebido sao acusadas ─────────────
do $$
declare r jsonb;
begin
  r := public.cex_ingest_order_snapshot('44444444-4444-4444-4444-444444444444',
        'ORD-Q', 0.01, 10000, 80, 1, 'USDT', null);
  if (r->>'regrediu')::boolean is not true then
    raise exception 'T12a: recebido MENOR nao foi acusado: %', r; end if;
  if (select filled_quote from cex_execution_intents
       where id='44444444-4444-4444-4444-444444444444') <> 100 then
    raise exception 'T12b: o livro foi rebaixado por um snapshot'; end if;
  r := public.cex_ingest_order_snapshot('44444444-4444-4444-4444-444444444444',
        'ORD-Q', 0.004, 10000, 100, 1, 'USDT', null);
  if (r->>'regrediu')::boolean is not true then
    raise exception 'T12c: quantidade MENOR nao foi acusada: %', r; end if;
  raise notice 'T12 OK — regressao de qty e de quote acusadas, livro intacto';
end $$;
