\set ON_ERROR_STOP on
-- ══ CRX-1: a reducao do recebido nao some da varredura ═════════════════
do $$
declare r jsonb; n int; mot text; pv boolean;
begin
  delete from autopilot_position_effects where session_id='cccc0000-0000-0000-0000-0000000000cc';
  delete from cex_fills where intent_id='dddd0000-0000-0000-0000-0000000000dd';
  delete from cex_execution_intents where session_id='cccc0000-0000-0000-0000-0000000000cc';
  delete from autopilot_positions where session_id='cccc0000-0000-0000-0000-0000000000cc';
  delete from autopilot_sessions where id='cccc0000-0000-0000-0000-0000000000cc';
  insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
    max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
    pnl_today, trades_today, last_reset_day)
  values ('cccc0000-0000-0000-0000-0000000000cc','0xCRX','binance','moderado',
          1000,50,20,true,now()+interval '6 hours',-30,0,
          (current_timestamp at time zone 'UTC')::date::text);
  insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
    pair, entry_price, base_amount, cost_usd, status)
  values ('cccc0000-0000-0000-0000-0000000000cc','0xCRX','binance','BTC','BTC/USDT',
          10000,0.01,100,'open');
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state, external_order_id)
  values ('dddd0000-0000-0000-0000-0000000000dd','cCRX','0xCRX','autopilot_cron',
          true,false,'cccc0000-0000-0000-0000-0000000000cc','binance','BTC/USDT',
          'sell','limit',0.01,'SUBMITTED','ORD-CRX');

  -- snapshot sintetico: quote 100, fee 2 → projecao aplica −2
  perform public.cex_ingest_order_snapshot('dddd0000-0000-0000-0000-0000000000dd',
    'ORD-CRX', 0.01, 10000, 100, 2, 'USDT', null);
  r := public.autopilot_projetar_efeito_do_intent('dddd0000-0000-0000-0000-0000000000dd');
  if (r->>'pnl_realizado')::numeric <> -2 then raise exception 'CRX1a: %', r; end if;
  if (select pnl_today from autopilot_sessions
       where id='cccc0000-0000-0000-0000-0000000000cc') <> -32 then
    raise exception 'CRX1b: pnl nao foi para -32'; end if;

  -- os TRADES REAIS dizem 80 — e a projecao NAO e chamada (interrupcao)
  perform public.cex_ingest_trades('dddd0000-0000-0000-0000-0000000000dd','ORD-CRX',
    '[{"trade_id":"TCRX","qty":0.01,"price":8000,"quote":80,"fee":2,"fee_currency":"USDT","order":"ORD-CRX"}]'::jsonb);
  if (select filled_quote from cex_execution_intents
       where id='dddd0000-0000-0000-0000-0000000000dd') <> 80 then
    raise exception 'CRX1c: o livro nao regrediu'; end if;
  if (select applied_quote from autopilot_position_effects
       where intent_id='dddd0000-0000-0000-0000-0000000000dd') <> 100 then
    raise exception 'CRX1d: o aplicado deveria seguir em 100'; end if;

  -- ⚠️ A VARREDURA TEM DE ENXERGAR A QUEDA
  select count(*), min(motivo), bool_and(precisa_venue) into n, mot, pv
    from public.autopilot_pendencias_financeiras(50)
   where intent_id='dddd0000-0000-0000-0000-0000000000dd';
  if n <> 1 then raise exception 'CRX-1 ABERTO: a reducao sumiu da varredura'; end if;
  if mot <> 'recebido_regrediu' then raise exception 'CRX1e: motivo %', mot; end if;
  if pv then raise exception 'CRX1f: o livro ja tem a verdade, nao precisa da venue'; end if;
  raise notice 'CRX-1.1 OK — a queda do recebido e DESCOBERTA (%)', mot;
end $$;

-- ── o recovery aplica o delta, cruza o stop, e CONVERGE ────────────────
do $$
declare r jsonb; n int;
begin
  r := public.autopilot_projetar_efeito_do_intent('dddd0000-0000-0000-0000-0000000000dd');
  if (r->>'ok')::boolean is not true then raise exception 'CRX1g: recusada: %', r; end if;
  if (r->>'pnl_realizado')::numeric <> -20 then
    raise exception 'CRX1h: delta esperado -20, veio %', r->>'pnl_realizado'; end if;
  if (select pnl_today from autopilot_sessions
       where id='cccc0000-0000-0000-0000-0000000000cc') <> -52 then
    raise exception 'CRX1i: pnl %', (select pnl_today from autopilot_sessions where id='cccc0000-0000-0000-0000-0000000000cc'); end if;
  if (select frozen_until_day from autopilot_sessions
       where id='cccc0000-0000-0000-0000-0000000000cc')
     is distinct from (current_timestamp at time zone 'UTC')::date::text then
    raise exception 'CRX1j: o stop nao congelou'; end if;

  -- ⚠️ E CONVERGE: tres ciclos a mais nao movem nada e a pendencia FECHA
  for i in 1..3 loop
    r := public.autopilot_projetar_efeito_do_intent('dddd0000-0000-0000-0000-0000000000dd');
    if (r->>'pnl_realizado')::numeric <> 0 then
      raise exception 'CRX1k: ciclo % moveu %', i, r->>'pnl_realizado'; end if;
  end loop;
  select count(*) into n from public.autopilot_pendencias_financeiras(50)
   where intent_id='dddd0000-0000-0000-0000-0000000000dd';
  if n <> 0 then raise exception 'CRX1l: pendencia eterna (%)', n; end if;
  if (select pnl_today from autopilot_sessions
       where id='cccc0000-0000-0000-0000-0000000000cc') <> -52 then
    raise exception 'CRX1m: os ciclos mexeram no pnl'; end if;
  raise notice 'CRX-1.2 OK — delta -20, dia -52, freeze, e a pendencia FECHA';
end $$;

-- ── a COMPRA nova nao sai mais: a fronteira final recusa ───────────────
do $$
declare r jsonb;
begin
  delete from strategy_certificates where strategy_id='crx';
  insert into strategy_certificates (id, strategy_id, strategy_version, strategy_hash,
    evidence, risk_limits, allowed_venues, allowed_symbols)
  values ('cccc1111-1111-1111-1111-111111111111','crx',1,'hx','{}'::jsonb,'{}'::jsonb,
          array['binance'], array['ETH/USDT']);
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, requested_notional_usd, state, certificate_id,
    strategy_id, strategy_version, strategy_hash)
  values ('eeee0000-0000-0000-0000-0000000000ee','cBuyCRX','0xCRX','autopilot_cron',
          true,false,'cccc0000-0000-0000-0000-0000000000cc','binance','ETH/USDT',
          'buy','limit',1,10,'CREATED','cccc1111-1111-1111-1111-111111111111',
          'crx',1,'hx');
  perform public.cex_transicionar('eeee0000-0000-0000-0000-0000000000ee','AUTHORIZED',null,null);
  perform public.cex_transicionar('eeee0000-0000-0000-0000-0000000000ee','RESERVED',null,null);
  r := public.cex_autorizar_e_submeter('eeee0000-0000-0000-0000-0000000000ee');
  if (r->>'ok')::boolean is not false then
    raise exception 'CRX1n: a COMPRA passou com o stop ultrapassado: %', r; end if;
  if (select state from cex_execution_intents
       where id='eeee0000-0000-0000-0000-0000000000ee') <> 'RESERVED' then
    raise exception 'CRX1o: o intent avancou'; end if;
  raise notice 'CRX-1.3 OK — a COMPRA nova e recusada (%)', r->>'porque';
end $$;

-- ── regressao de QUANTIDADE tambem e descoberta, e fecha a porta ───────
do $$
declare r jsonb; n int; mot text;
begin
  update cex_execution_intents set filled_qty = 0.004
   where id='dddd0000-0000-0000-0000-0000000000dd';
  select count(*), min(motivo) into n, mot from public.autopilot_pendencias_financeiras(50)
   where intent_id='dddd0000-0000-0000-0000-0000000000dd';
  if n <> 1 or mot <> 'quantidade_regrediu' then
    raise exception 'CRX1p: regressao de qty nao descoberta (n=%, motivo=%)', n, mot; end if;
  r := public.autopilot_projetar_efeito_do_intent('dddd0000-0000-0000-0000-0000000000dd');
  if (r->>'ok')::boolean is not false then raise exception 'CRX1q: %', r; end if;
  if (select divergencia from autopilot_position_effects
       where intent_id='dddd0000-0000-0000-0000-0000000000dd') is null then
    raise exception 'CRX1r: a divergencia nao ficou gravada'; end if;
  raise notice 'CRX-1.4 OK — regressao de quantidade descoberta, gravada e fail-closed';
end $$;
