\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
-- ── seed ────────────────────────────────────────────────────────────────
insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
  max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
  pnl_today, trades_today, last_reset_day)
values ('11111111-1111-1111-1111-111111111111','0xDB','binance','moderado',
        1000, 50, 5, true, now()+interval '6 hours', -49, 0,
        (current_timestamp at time zone 'UTC')::date::text)
on conflict do nothing;

insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
  autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
  requested_qty, state, conexao_id, external_order_id)
values ('22222222-2222-2222-2222-222222222222','cdb1','0xDB','autopilot_cron',
        true,false,'11111111-1111-1111-1111-111111111111','binance','BTC/USDT',
        'sell','limit',0.01,'SUBMITTED',null,'ORD-DB1');

insert into autopilot_positions (session_id, wallet_address, exchange_id, base,
  pair, entry_price, base_amount, cost_usd, status, exit_order_id, exit_intent_id)
values ('11111111-1111-1111-1111-111111111111','0xDB','binance','BTC','BTC/USDT',
        10000, 0.01, 100, 'exit_armed','ORD-DB1','22222222-2222-2222-2222-222222222222');

-- ── T1: a constraint aceita qty ZERO carregando quote (invariante Q) ────
do $$ begin
  perform public.cex_ingest_order_snapshot(
    '22222222-2222-2222-2222-222222222222','ORD-DB1', 0.01, 10000, null, null, null, null);
  if (select filled_qty from cex_execution_intents
       where id='22222222-2222-2222-2222-222222222222') <> 0.01 then
    raise exception 'T1a: filled_qty nao entrou';
  end if;
  if (select filled_quote from cex_execution_intents
       where id='22222222-2222-2222-2222-222222222222') <> 0 then
    raise exception 'T1b: quote ausente virou numero';
  end if;
  -- o recebido chega DEPOIS, com a qty parada: o caso que a 0059 proibia
  perform public.cex_ingest_order_snapshot(
    '22222222-2222-2222-2222-222222222222','ORD-DB1', 0.01, 10000, 100, null, null, null);
  if (select filled_quote from cex_execution_intents
       where id='22222222-2222-2222-2222-222222222222') <> 100 then
    raise exception 'T1c: INVARIANTE Q FALHOU — recebido tardio nao entrou (%)',
      (select filled_quote from cex_execution_intents where id='22222222-2222-2222-2222-222222222222');
  end if;
  if not exists (select 1 from cex_fills
                  where intent_id='22222222-2222-2222-2222-222222222222'
                    and qty = 0 and quote_amount = 100) then
    raise exception 'T1d: o ajuste de qty zero com quote nao existe';
  end if;
  raise notice 'T1 OK — qty=0 com quote=100 aceito, filled_quote=100';
end $$;

-- ── T2: NULL nao e zero na conversao de taxa (item 11) ──────────────────
do $$
declare v numeric;
begin
  v := public.autopilot_taxa_do_intent_em_usd(null,'USDT','BTC/USDT',0.01,100);
  if v is not null then raise exception 'T2a: fee NULL devolveu % (deveria ser NULL)', v; end if;
  v := public.autopilot_taxa_do_intent_em_usd(0,'USDT','BTC/USDT',0.01,100);
  if v is distinct from 0 then raise exception 'T2b: fee 0 devolveu %', v; end if;
  v := public.autopilot_taxa_do_intent_em_usd(2,'USDT','BTC/USDT',0.01,100);
  if v <> 2 then raise exception 'T2c: fee 2 USDT devolveu %', v; end if;
  v := public.autopilot_taxa_do_intent_em_usd(30,'DOGE','BTC/USDT',0.01,100);
  if v is not null then raise exception 'T2d: moeda opaca devolveu %', v; end if;
  raise notice 'T2 OK — NULL/0/2/opaca distinguidos';
end $$;

-- ── T3: a liquidacao com taxa AUSENTE marca a contabilidade ─────────────
do $$
declare r jsonb;
begin
  r := public.autopilot_liquidar_saida_armada(
        '22222222-2222-2222-2222-222222222222', 0.01, 100);
  if (r->>'ok')::boolean is not true then raise exception 'T3a: liquidacao recusada: %', r; end if;
  if (r->>'taxa_nao_precificada')::boolean is not true then
    raise exception 'T3b: taxa ausente nao levantou a bandeira: %', r; end if;
  if (select pnl_today from autopilot_sessions
       where id='11111111-1111-1111-1111-111111111111') <> -49 then
    raise exception 'T3c: P&L foi afirmado com taxa desconhecida'; end if;
  if (select contabilidade_incompleta_em from autopilot_sessions
       where id='11111111-1111-1111-1111-111111111111') is null then
    raise exception 'T3d: I11/I12 FALHOU — sessao nao foi marcada'; end if;
  raise notice 'T3 OK — taxa ausente marca a sessao e nao afirma P&L';
end $$;

-- ── T4: a pendencia e ENCONTRADA, com precisa_venue ─────────────────────
do $$
declare n int; pv boolean; mt text;
begin
  select count(*), bool_and(precisa_venue), min(motivo)
    into n, pv, mt from public.autopilot_pendencias_financeiras(50);
  if n <> 1 then raise exception 'T4a: esperava 1 pendencia, veio %', n; end if;
  if not pv then raise exception 'T4b: precisa_venue deveria ser true'; end if;
  if mt <> 'taxa_desconhecida' then raise exception 'T4c: motivo %', mt; end if;
  raise notice 'T4 OK — terminal com livro incompleto entra no recovery (%)', mt;
end $$;

-- ── T5: os TRADES trazem a taxa, o delta entra, a bandeira cai ──────────
do $$
declare r jsonb; n int;
begin
  perform public.cex_ingest_trades(
    '22222222-2222-2222-2222-222222222222','ORD-DB1',
    '[{"trade_id":"T1","qty":0.01,"price":10000,"quote":100,"fee":2,"fee_currency":"USDT","order":"ORD-DB1"}]'::jsonb);
  if (select fee_total from cex_execution_intents
       where id='22222222-2222-2222-2222-222222222222') <> 2 then
    raise exception 'T5a: a taxa dos trades nao entrou'; end if;
  r := public.autopilot_projetar_efeito_do_intent('22222222-2222-2222-2222-222222222222');
  if (r->>'ok')::boolean is not true then raise exception 'T5b: projecao recusada: %', r; end if;
  if (r->>'pnl_realizado')::numeric <> -2 then
    raise exception 'T5c: delta esperado -2, veio %', r->>'pnl_realizado'; end if;
  if (select pnl_today from autopilot_sessions
       where id='11111111-1111-1111-1111-111111111111') <> -51 then
    raise exception 'T5d: pnl_today %', (select pnl_today from autopilot_sessions where id='11111111-1111-1111-1111-111111111111'); end if;
  if (select frozen_until_day from autopilot_sessions
       where id='11111111-1111-1111-1111-111111111111')
     is distinct from (current_timestamp at time zone 'UTC')::date::text then
    raise exception 'T5e: loss-stop nao congelou o dia'; end if;
  if (select contabilidade_incompleta_em from autopilot_sessions
       where id='11111111-1111-1111-1111-111111111111') is not null then
    raise exception 'T5f: a bandeira nao caiu depois de convergir'; end if;
  select count(*) into n from public.autopilot_pendencias_financeiras(50);
  if n <> 0 then raise exception 'T5g: pendencia sobrou: %', n; end if;
  raise notice 'T5 OK — trades trazem a taxa, delta -2, dia -51, freeze, bandeira limpa';
end $$;

-- ── T6: exactly-once — replay nao soma nada ─────────────────────────────
do $$
declare r jsonb;
begin
  for i in 1..3 loop
    r := public.autopilot_projetar_efeito_do_intent('22222222-2222-2222-2222-222222222222');
    if (r->>'pnl_realizado')::numeric <> 0 then
      raise exception 'T6a: replay % somou %', i, r->>'pnl_realizado'; end if;
  end loop;
  if (select pnl_today from autopilot_sessions
       where id='11111111-1111-1111-1111-111111111111') <> -51 then
    raise exception 'T6b: replay mexeu no pnl_today'; end if;
  raise notice 'T6 OK — exactly-once sob replay';
end $$;
