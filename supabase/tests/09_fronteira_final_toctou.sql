\set ON_ERROR_STOP on
-- ══ BLOCKER: o estado financeiro participa da autorizacao FINAL ═════════
do $$
declare r jsonb;
begin
  delete from autopilot_position_effects where session_id='aaaa0000-0000-0000-0000-00000000aaaa';
  delete from cex_execution_intents where session_id='aaaa0000-0000-0000-0000-00000000aaaa';
  delete from autopilot_positions where session_id='aaaa0000-0000-0000-0000-00000000aaaa';
  delete from autopilot_sessions where id='aaaa0000-0000-0000-0000-00000000aaaa';
  delete from strategy_certificates where strategy_id='toctou';
  insert into autopilot_sessions (id, wallet_address, exchange_id, risk_mode,
    max_trade_usd, daily_loss_stop_usd, max_trades_per_day, is_active, expires_at,
    pnl_today, trades_today, last_reset_day)
  values ('aaaa0000-0000-0000-0000-00000000aaaa','0xTOC','binance','moderado',
          1000,50,20,true,now()+interval '6 hours',-49,0,
          (current_timestamp at time zone 'UTC')::date::text);
  insert into strategy_certificates (id, strategy_id, strategy_version, strategy_hash,
    evidence, risk_limits, allowed_venues, allowed_symbols)
  values ('cbbb0000-0000-0000-0000-00000000bbbb','toctou',1,'h9','{}'::jsonb,
          '{}'::jsonb, array['binance'], array['ETH/USDT']);
end $$;

-- helper: cria um intent RESERVED pronto para a autorizacao final
create or replace function pg_temp.novo_intent(p_id uuid) returns void
language plpgsql as $$
begin
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, requested_notional_usd, state, certificate_id,
    strategy_id, strategy_version, strategy_hash)
  values (p_id, 'c'||replace(p_id::text,'-',''), '0xTOC','autopilot_cron',
          true,false,'aaaa0000-0000-0000-0000-00000000aaaa','binance','ETH/USDT',
          'buy','limit',1,10,'CREATED','cbbb0000-0000-0000-0000-00000000bbbb',
          'toctou',1,'h9');
  perform public.cex_transicionar(p_id,'AUTHORIZED',null,null);
  perform public.cex_transicionar(p_id,'RESERVED',null,null);
end $$;

-- ── B1: controle POSITIVO — estado saudavel autoriza ───────────────────
do $$
declare r jsonb;
begin
  update autopilot_sessions set pnl_today=-10, frozen_until_day=null,
    contabilidade_incompleta_em=null, quarentena_em=null
   where id='aaaa0000-0000-0000-0000-00000000aaaa';
  perform pg_temp.novo_intent('0000aaaa-0000-0000-0000-00000000000a');
  r := public.cex_autorizar_e_submeter('0000aaaa-0000-0000-0000-00000000000a');
  if (r->>'ok')::boolean is not true then
    raise exception 'B1: estado saudavel foi RECUSADO: %', r; end if;
  if (select state from cex_execution_intents
       where id='0000aaaa-0000-0000-0000-00000000000a') <> 'SUBMITTING' then
    raise exception 'B1b: nao virou SUBMITTING'; end if;
  raise notice 'B1 OK — estado saudavel autoriza e vira SUBMITTING';
end $$;

-- ── B2: o loss-stop COMITADO antes da autorizacao final RECUSA ─────────
do $$
declare r jsonb;
begin
  perform pg_temp.novo_intent('0000aaaa-0000-0000-0000-00000000000b');
  -- T1: um writer financeiro comita entre o precheck e a autorizacao final
  perform public.autopilot_aplicar_pnl('aaaa0000-0000-0000-0000-00000000aaaa', -45);
  if (select pnl_today from autopilot_sessions
       where id='aaaa0000-0000-0000-0000-00000000aaaa') <> -55 then
    raise exception 'B2a: o writer nao aplicou'; end if;
  r := public.cex_autorizar_e_submeter('0000aaaa-0000-0000-0000-00000000000b');
  if (r->>'ok')::boolean is not false then
    raise exception 'B2b: BLOCKER ABERTO — autorizou com o stop ja atingido: %', r; end if;
  if (select state from cex_execution_intents
       where id='0000aaaa-0000-0000-0000-00000000000b') <> 'RESERVED' then
    raise exception 'B2c: o intent avancou mesmo recusado'; end if;
  raise notice 'B2 OK — stop de perda comitado antes da final auth RECUSA (%)', r->>'porque';
end $$;

-- ── B3: contabilidade incompleta comitada antes RECUSA ─────────────────
do $$
declare r jsonb;
begin
  update autopilot_sessions set pnl_today=-10, frozen_until_day=null,
    last_reset_day=(current_timestamp at time zone 'UTC')::date::text
   where id='aaaa0000-0000-0000-0000-00000000aaaa';
  perform pg_temp.novo_intent('0000aaaa-0000-0000-0000-00000000000c');
  update autopilot_sessions set contabilidade_incompleta_em=now()
   where id='aaaa0000-0000-0000-0000-00000000aaaa';
  r := public.cex_autorizar_e_submeter('0000aaaa-0000-0000-0000-00000000000c');
  if (r->>'ok')::boolean is not false then
    raise exception 'B3: autorizou com contabilidade incompleta: %', r; end if;
  raise notice 'B3 OK — contabilidade incompleta RECUSA na final auth';
end $$;

-- ── B4: quarentena e freeze comitados antes RECUSAM ────────────────────
do $$
declare r jsonb;
begin
  update autopilot_sessions set contabilidade_incompleta_em=null, quarentena_em=now()
   where id='aaaa0000-0000-0000-0000-00000000aaaa';
  perform pg_temp.novo_intent('0000aaaa-0000-0000-0000-00000000000d');
  r := public.cex_autorizar_e_submeter('0000aaaa-0000-0000-0000-00000000000d');
  if (r->>'ok')::boolean is not false then raise exception 'B4a: quarentena passou: %', r; end if;

  update autopilot_sessions set quarentena_em=null,
    frozen_until_day=(current_timestamp at time zone 'UTC')::date::text
   where id='aaaa0000-0000-0000-0000-00000000aaaa';
  perform pg_temp.novo_intent('0000aaaa-0000-0000-0000-00000000000e');
  r := public.cex_autorizar_e_submeter('0000aaaa-0000-0000-0000-00000000000e');
  if (r->>'ok')::boolean is not false then raise exception 'B4b: freeze passou: %', r; end if;
  raise notice 'B4 OK — quarentena e freeze RECUSAM na final auth';
end $$;

-- ── B5: a VENDA nao e presa pelo gate financeiro ────────────────────────
do $$
declare r jsonb;
begin
  -- sessao congelada E com contabilidade incompleta
  update autopilot_sessions set contabilidade_incompleta_em=now(),
    frozen_until_day=(current_timestamp at time zone 'UTC')::date::text
   where id='aaaa0000-0000-0000-0000-00000000aaaa';
  insert into cex_execution_intents (id, client_order_id, wallet_address, origin,
    autonomous, simulated, session_id, exchange_id, symbol, side, order_type,
    requested_qty, state)
  values ('0000aaaa-0000-0000-0000-00000000000f','cSell','0xTOC','autopilot_cron',
          true,false,'aaaa0000-0000-0000-0000-00000000aaaa','binance','ETH/USDT',
          'sell','limit',1,'CREATED');
  perform public.cex_transicionar('0000aaaa-0000-0000-0000-00000000000f','AUTHORIZED',null,null);
  perform public.cex_transicionar('0000aaaa-0000-0000-0000-00000000000f','RESERVED',null,null);
  r := public.cex_autorizar_e_submeter('0000aaaa-0000-0000-0000-00000000000f');
  if (r->>'ok')::boolean is not true then
    raise exception 'B5: a VENDA foi presa pelo gate financeiro: %', r; end if;
  raise notice 'B5 OK — saida/reducao atravessa: o freio e so de ENTRADA';
end $$;

-- ── B6: DCA (autonomous, sem sessao do piloto) nao e afetado ────────────
do $$
declare r jsonb; n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='cex_autorizar_e_submeter';
  if n <> 1 then raise exception 'B6a: overload de final auth (%)', n; end if;
  -- o escopo do gate e explicito no corpo
  if position('autopilot_browser'', ''autopilot_cron' in
      (select prosrc from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
        where ns.nspname='public' and p.proname='cex_autorizar_e_submeter')) = 0 then
    raise exception 'B6b: o gate financeiro nao esta escopado as origens do autopilot'; end if;
  raise notice 'B6 OK — gate escopado ao autopilot; DCA/manual fora, sem overload';
end $$;
