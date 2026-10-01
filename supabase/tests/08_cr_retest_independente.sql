\set ON_ERROR_STOP on
-- ══ CR-1: BUY terminal sem quote mantem o compromisso ═══════════════════
do $$
declare r jsonb; c numeric; n int;
begin
  delete from autopilot_position_effects where session_id='77777777-7777-7777-7777-777777777777';
  delete from autopilot_positions where session_id='77777777-7777-7777-7777-777777777777';
  delete from cex_execution_intents where session_id='77777777-7777-7777-7777-777777777777';
  delete from autopilot_sessions where id='77777777-7777-7777-7777-777777777777';
  delete from strategy_certificates where strategy_id='cr1';
  insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
    max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
    pnl_today, trades_today, last_reset_day)
  values ('77777777-7777-7777-7777-777777777777','0xCR1','binance','moderado',
          1000,50,20,true,now()+interval '6 hours',0,0,
          (current_timestamp at time zone 'UTC')::date::text);
  insert into strategy_certificates (id, strategy_id, strategy_version, strategy_hash,
    evidence, risk_limits, allowed_venues, allowed_symbols)
  values ('c1111111-1111-1111-1111-111111111111','cr1',1,'h','{}'::jsonb,'{}'::jsonb,
          array['binance'], array['ETH/USDT']);
  insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
    pair, entry_price, base_amount, cost_usd, status)
  values ('77777777-7777-7777-7777-777777777777','0xCR1','binance','SOL','SOL/USDT',
          100,1.9,190,'open');
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state, certificate_id)
  values ('a1111111-1111-1111-1111-111111111111','cA1','0xCR1','autopilot_cron',
          true,false,'77777777-7777-7777-7777-777777777777','binance','ETH/USDT',
          'buy','limit',1,'CREATED','c1111111-1111-1111-1111-111111111111'),
         ('b1111111-1111-1111-1111-111111111111','cB1','0xCR1','autopilot_cron',
          true,false,'77777777-7777-7777-7777-777777777777','binance','ETH/USDT',
          'buy','limit',1,'CREATED','c1111111-1111-1111-1111-111111111111');

  r := public.autopilot_reservar_exposicao_do_intent('a1111111-1111-1111-1111-111111111111',10,200);
  if (r->>'ok')::boolean is not true then raise exception 'CR1a: reserva de A recusada: %', r; end if;

  -- a venue confirma QUANTIDADE, o custo ainda e desconhecido
  update cex_execution_intents set state='SUBMITTED' where id='a1111111-1111-1111-1111-111111111111';
  update cex_execution_intents set filled_qty=0.004, filled_quote=0, state='FILLED'
   where id='a1111111-1111-1111-1111-111111111111';
  perform public.autopilot_projetar_efeito_do_intent('a1111111-1111-1111-1111-111111111111');

  -- ⚠️ o compromisso NAO desaba
  r := public.autopilot_reservar_exposicao_do_intent('b1111111-1111-1111-1111-111111111111',10,200);
  if (r->>'ok')::boolean is not false then
    raise exception 'CR1b: B foi ACEITA — 190+10+10=210 num teto de 200: %', r; end if;
  -- ⚠️ e o intent nao some do recovery
  select count(*) into n from public.autopilot_pendencias_financeiras(50)
   where intent_id='a1111111-1111-1111-1111-111111111111';
  if n <> 1 then raise exception 'CR1c: A sumiu do recovery'; end if;
  -- ⚠️ e a sessao esta bloqueada para COMPRA
  if (select contabilidade_incompleta_em from autopilot_sessions
       where id='77777777-7777-7777-7777-777777777777') is null then
    raise exception 'CR1d: a sessao nao foi bloqueada'; end if;

  -- o custo chega: 10
  update cex_execution_intents set filled_quote=10 where id='a1111111-1111-1111-1111-111111111111';
  perform public.autopilot_projetar_efeito_do_intent('a1111111-1111-1111-1111-111111111111');
  select coalesce(sum(cost_usd),0) into c from autopilot_positions
   where session_id='77777777-7777-7777-7777-777777777777';
  if c <> 200 then raise exception 'CR1e: exposicao convergiu para % (esperado 200)', c; end if;
  if (select contabilidade_incompleta_em from autopilot_sessions
       where id='77777777-7777-7777-7777-777777777777') is not null then
    raise exception 'CR1f: a bandeira nao caiu depois de convergir'; end if;
  raise notice 'CR-1 OK — compromisso mantido, B recusada, exposicao converge para 200';
end $$;

-- ══ CR-2: regressao de quote na VENDA e corrigida e cruza o stop ════════
do $$
declare r jsonb;
begin
  delete from autopilot_position_effects where session_id='88888888-8888-8888-8888-888888888888';
  delete from autopilot_positions where session_id='88888888-8888-8888-8888-888888888888';
  delete from cex_fills where intent_id='a2222222-2222-2222-2222-222222222222';
  delete from cex_execution_intents where session_id='88888888-8888-8888-8888-888888888888';
  delete from autopilot_sessions where id='88888888-8888-8888-8888-888888888888';
  insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
    max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
    pnl_today, trades_today, last_reset_day)
  values ('88888888-8888-8888-8888-888888888888','0xCR2','binance','moderado',
          1000,50,20,true,now()+interval '6 hours',-30,0,
          (current_timestamp at time zone 'UTC')::date::text);
  insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
    pair, entry_price, base_amount, cost_usd, status)
  values ('88888888-8888-8888-8888-888888888888','0xCR2','binance','BTC','BTC/USDT',
          10000,0.01,100,'open');
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state, external_order_id)
  values ('a2222222-2222-2222-2222-222222222222','cV2','0xCR2','autopilot_cron',
          true,false,'88888888-8888-8888-8888-888888888888','binance','BTC/USDT',
          'sell','limit',0.01,'SUBMITTED','ORD-CR2');

  perform public.cex_ingest_order_snapshot('a2222222-2222-2222-2222-222222222222',
    'ORD-CR2', 0.01, 10000, 100, 2, 'USDT', null);
  r := public.autopilot_projetar_efeito_do_intent('a2222222-2222-2222-2222-222222222222');
  if (r->>'pnl_realizado')::numeric <> -2 then raise exception 'CR2a: %', r; end if;
  if (select pnl_today from autopilot_sessions
       where id='88888888-8888-8888-8888-888888888888') <> -32 then
    raise exception 'CR2b: pnl_today nao foi para -32'; end if;

  -- os trades REAIS dizem 80
  perform public.cex_ingest_trades('a2222222-2222-2222-2222-222222222222','ORD-CR2',
    '[{"trade_id":"TCR2","qty":0.01,"price":8000,"quote":80,"fee":2,"fee_currency":"USDT","order":"ORD-CR2"}]'::jsonb);
  if (select filled_quote from cex_execution_intents
       where id='a2222222-2222-2222-2222-222222222222') <> 80 then
    raise exception 'CR2c: o livro nao regrediu para 80'; end if;
  r := public.autopilot_projetar_efeito_do_intent('a2222222-2222-2222-2222-222222222222');
  if (r->>'ok')::boolean is not true then raise exception 'CR2d: a correcao foi recusada: %', r; end if;
  if (r->>'pnl_realizado')::numeric <> -20 then
    raise exception 'CR2e: delta esperado -20, veio %', r->>'pnl_realizado'; end if;
  if (select pnl_today from autopilot_sessions
       where id='88888888-8888-8888-8888-888888888888') <> -52 then
    raise exception 'CR2f: pnl_today %', (select pnl_today from autopilot_sessions where id='88888888-8888-8888-8888-888888888888'); end if;
  if (select frozen_until_day from autopilot_sessions
       where id='88888888-8888-8888-8888-888888888888')
     is distinct from (current_timestamp at time zone 'UTC')::date::text then
    raise exception 'CR2g: o stop nao congelou o dia'; end if;
  raise notice 'CR-2 OK — venda corrige para -52 e o loss-stop dispara';
end $$;

-- ══ CR-5: a virada do dia nao apaga um resultado de hoje ════════════════
do $$
declare r jsonb;
begin
  delete from autopilot_position_effects where session_id='99999999-9999-9999-9999-999999999999';
  delete from autopilot_positions where session_id='99999999-9999-9999-9999-999999999999';
  delete from cex_execution_intents where session_id='99999999-9999-9999-9999-999999999999';
  delete from autopilot_sessions where id='99999999-9999-9999-9999-999999999999';
  insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
    max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
    pnl_today, trades_today, last_reset_day)
  values ('99999999-9999-9999-9999-999999999999','0xCR5','binance','moderado',
          1000,50,20,true,now()+interval '6 hours',0,7,
          ((current_timestamp at time zone 'UTC')::date - 1)::text);
  insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
    pair, entry_price, base_amount, cost_usd, status)
  values ('99999999-9999-9999-9999-999999999999','0xCR5','binance','BTC','BTC/USDT',
          10000,0.01,100,'open');
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state, filled_qty, filled_quote, fee_total, fee_currency)
  values ('a5555555-5555-5555-5555-555555555555','cV5','0xCR5','autopilot_cron',
          true,false,'99999999-9999-9999-9999-999999999999','binance','BTC/USDT',
          'sell','limit',0.01,'FILLED',0.01,49,2,'USDT');

  r := public.autopilot_projetar_efeito_do_intent('a5555555-5555-5555-5555-555555555555');
  if (r->>'pnl_realizado')::numeric <> -53 then raise exception 'CR5a: %', r; end if;
  -- ⚠️ QUEM APLICA O P&L CARIMBA O DIA: a virada ja aconteceu aqui
  if (select last_reset_day from autopilot_sessions
       where id='99999999-9999-9999-9999-999999999999')
     is distinct from (current_timestamp at time zone 'UTC')::date::text then
    raise exception 'CR5b: last_reset_day nao foi carimbado'; end if;
  if (select pnl_today from autopilot_sessions
       where id='99999999-9999-9999-9999-999999999999') <> -53 then
    raise exception 'CR5c: pnl_today %', (select pnl_today from autopilot_sessions where id='99999999-9999-9999-9999-999999999999'); end if;
  if (select trades_today from autopilot_sessions
       where id='99999999-9999-9999-9999-999999999999') <> 0 then
    raise exception 'CR5d: o contador de ontem sobreviveu'; end if;
  if (select frozen_until_day from autopilot_sessions
       where id='99999999-9999-9999-9999-999999999999')
     is distinct from (current_timestamp at time zone 'UTC')::date::text then
    raise exception 'CR5e: o stop nao congelou'; end if;
  -- replay
  for i in 1..3 loop
    r := public.autopilot_projetar_efeito_do_intent('a5555555-5555-5555-5555-555555555555');
    if (r->>'pnl_realizado')::numeric <> 0 then raise exception 'CR5f: replay somou %', r; end if;
  end loop;
  if (select pnl_today from autopilot_sessions
       where id='99999999-9999-9999-9999-999999999999') <> -53 then
    raise exception 'CR5g: replay mexeu no pnl'; end if;
  raise notice 'CR-5 OK — recovery carimba o dia: -53, contador 0, freeze, replay estavel';
end $$;
