\set ON_ERROR_STOP on
delete from autopilot_position_effects where intent_id='66666666-6666-6666-6666-666666666666';
delete from autopilot_positions where session_id='33333333-3333-3333-3333-333333333333' and base='LTC';
delete from cex_fills where intent_id='66666666-6666-6666-6666-666666666666';
delete from cex_execution_intents where id='66666666-6666-6666-6666-666666666666';
insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
  autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
  requested_qty, state, external_order_id)
values ('66666666-6666-6666-6666-666666666666','cL','0xCONC','autopilot_cron',
        true,false,'33333333-3333-3333-3333-333333333333','binance','LTC/USDT',
        'sell','limit',0.01,'SUBMITTED','ORD-L');
insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
  pair, entry_price, base_amount, cost_usd, status, exit_order_id, exit_intent_id)
values ('33333333-3333-3333-3333-333333333333','0xCONC','binance','LTC','LTC/USDT',
        10000, 0.01, 100, 'exit_armed','ORD-L','66666666-6666-6666-6666-666666666666');
-- o livro JA tem o fill completo com taxa: os dois caminhos podem agir
select public.cex_ingest_trades('66666666-6666-6666-6666-666666666666','ORD-L',
  '[{"trade_id":"TL1","qty":0.01,"price":10000,"quote":100,"fee":2,"fee_currency":"USDT","order":"ORD-L"}]'::jsonb);
update autopilot_sessions set pnl_today = 0, frozen_until_day = null,
  contabilidade_incompleta_em = null where id='33333333-3333-3333-3333-333333333333';
