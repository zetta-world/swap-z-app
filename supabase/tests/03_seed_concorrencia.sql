\set ON_ERROR_STOP on
delete from autopilot_position_effects where session_id='33333333-3333-3333-3333-333333333333';
delete from autopilot_positions where session_id='33333333-3333-3333-3333-333333333333';
delete from cex_fills where intent_id in (select id from cex_execution_intents where session_id='33333333-3333-3333-3333-333333333333');
delete from cex_execution_intents where session_id='33333333-3333-3333-3333-333333333333';
delete from autopilot_sessions where id='33333333-3333-3333-3333-333333333333';
delete from strategy_certificates where strategy_id='conc';

insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
  max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
  pnl_today, trades_today, last_reset_day)
values ('33333333-3333-3333-3333-333333333333','0xCONC','binance','moderado',
        1000, 50, 20, true, now()+interval '6 hours', 0, 0,
        (current_timestamp at time zone 'UTC')::date::text);

insert into strategy_certificates (id, strategy_id, strategy_version, strategy_hash,
  evidence, risk_limits, allowed_venues, allowed_symbols)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','conc',1,'h',
        '{}'::jsonb,'{}'::jsonb, array['binance'], array['BTC/USDT']);

-- duas VENDAS concorrentes sobre uma posicao de 0,01
insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
  autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
  requested_qty, state)
values ('aaaaaaaa-0000-0000-0000-00000000000a','cA','0xCONC','autopilot_cron',
        true,false,'33333333-3333-3333-3333-333333333333','binance','BTC/USDT','sell','limit',0.01,'CREATED'),
       ('bbbbbbbb-0000-0000-0000-00000000000b','cB','0xCONC','autopilot_cron',
        true,false,'33333333-3333-3333-3333-333333333333','binance','BTC/USDT','sell','limit',0.01,'CREATED');

-- duas COMPRAS concorrentes com exposicao 190 e teto 200
insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
  autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
  requested_qty, state, certificate_id)
values ('dddddddd-0000-0000-0000-00000000000d','cD','0xCONC','autopilot_cron',
        true,false,'33333333-3333-3333-3333-333333333333','binance','ETH/USDT','buy','limit',1,'CREATED',
        'cccccccc-cccc-cccc-cccc-cccccccccccc'),
       ('eeeeeeee-0000-0000-0000-00000000000e','cE','0xCONC','autopilot_cron',
        true,false,'33333333-3333-3333-3333-333333333333','binance','ETH/USDT','buy','limit',1,'CREATED',
        'cccccccc-cccc-cccc-cccc-cccccccccccc');

insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
  pair, entry_price, base_amount, cost_usd, status)
values ('33333333-3333-3333-3333-333333333333','0xCONC','binance','BTC','BTC/USDT',10000,0.01,100,'open'),
       ('33333333-3333-3333-3333-333333333333','0xCONC','binance','SOL','SOL/USDT',100,0.9,90,'open');
