-- ============================================================================
-- A51 — REARME NÃO É RESET FINANCEIRO (PLATFORM CLOSURE BATCH 1, PC-2)
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE.
--
-- `src/lib/platform-closure-batch1.test.ts` prova a PC-2 LENDO A MIGRATION
-- como texto: afirma que a 0065 contém `on conflict` e não contém
-- `creds_cipher`. Isso é evidência de forma, não de comportamento — e a regra
-- desta casa é que teste textual nunca é a única prova de uma propriedade
-- financeira. O que estava em jogo no A51 é dinheiro: o UPSERT antigo
-- sobrescrevia `trades_today`, `pnl_today`, `last_reset_day` e
-- `frozen_until_day`, então bastava reconectar a credencial para reabrir, no
-- mesmo dia, os trilhos que o stop de perda tinha fechado.
--
-- Aqui a RPC roda de verdade, em PostgreSQL de verdade, e o veredito sai dos
-- NÚMEROS que ficaram na linha — não de uma regex.
--
-- R1  mesmo dia: rearmar PRESERVA trades/pnl/freeze/last_reset_day
-- R2  dia novo:  rearmar faz o rollover previsto (e só ele)
-- R3  quarentena e contabilidade incompleta SOBREVIVEM aos dois caminhos
-- R4  `p_conexao_id` nulo: recusa — sessão sem elo não nasce
-- R5  a sessão não tem onde guardar credencial (0056) e a RPC não inventa uma
-- R6  rearme não duplica a linha; reativa e atualiza a config
-- ============================================================================
create extension if not exists pgcrypto;

do $$
declare
  v_cx    uuid;
  v_sid   uuid;
  v_hoje  text := (current_timestamp at time zone 'UTC')::date::text;
  v_ontem text := ((current_timestamp at time zone 'UTC')::date - 1)::text;
  v_r     record;
  v_n     integer;
  v_erro  text;
begin
  -- ---------------------------------------------------------------- cenário
  delete from public.autopilot_sessions where wallet_address = '0xA51';
  delete from public.cex_conexoes       where wallet_address = '0xA51';

  insert into public.cex_conexoes (wallet_address, exchange_id, creds_cipher)
       values ('0xA51', 'binance', 'cifra-irrelevante-para-este-teste')
    returning id into v_cx;

  -- Sessão JÁ CASTIGADA hoje: 4 trades, −37 de P&L, congelada, em quarentena
  -- e com a contabilidade incompleta. Exatamente o estado que um rearme
  -- oportunista gostaria de apagar.
  insert into public.autopilot_sessions (
    wallet_address, exchange_id, risk_mode, market_type,
    max_trade_usd, daily_loss_stop_usd, max_trades_per_day,
    allowed_symbols, lang, conexao_id, is_active, expires_at,
    trades_today, pnl_today, last_reset_day, frozen_until_day,
    quarentena_em, quarentena_motivo, contabilidade_incompleta_em
  ) values (
    '0xA51', 'binance', 'moderado', 'spot',
    50, 30, 5,
    '{BTC/USDT}', 'pt', v_cx, false, now() - interval '1 hour',
    4, -37, v_hoje, v_hoje,
    now(), 'saldo_baseline_ausente', now()
  ) returning id into v_sid;

  -- ------------------------------------------------------------------- R1
  perform public.autopilot_rearm_preserva_rails(
    '0xA51', 'binance', 'agressivo', 'spot',
    999, 999, 50, '{ETH/USDT}', 'en', v_cx,
    'so_negocia', 'rearme no mesmo dia', now() + interval '24 hours');

  select * into v_r from public.autopilot_sessions where id = v_sid;

  if v_r.trades_today <> 4 then
    raise exception 'R1 FALHOU: trades_today virou % (esperado 4) — rearme zerou o contador do dia', v_r.trades_today;
  end if;
  if v_r.pnl_today <> -37 then
    raise exception 'R1 FALHOU: pnl_today virou % (esperado -37) — rearme apagou a perda do dia', v_r.pnl_today;
  end if;
  if v_r.frozen_until_day is distinct from v_hoje then
    raise exception 'R1 FALHOU: frozen_until_day virou % (esperado %) — rearme descongelou o stop de perda', v_r.frozen_until_day, v_hoje;
  end if;
  if v_r.last_reset_day <> v_hoje then
    raise exception 'R1 FALHOU: last_reset_day virou %', v_r.last_reset_day;
  end if;
  -- ⚠️ E a config PRECISA ter mudado: se nada mudou, a preservação acima
  -- poderia ser só "a RPC não fez nada", que passaria por engano.
  if v_r.risk_mode <> 'agressivo' or v_r.lang <> 'en'
     or v_r.max_trade_usd <> 999 or v_r.allowed_symbols <> '{ETH/USDT}'::text[] then
    raise exception 'R1 FALHOU: a config NAO foi atualizada — o rearme nao aconteceu de verdade';
  end if;
  raise notice 'R1 OK — mesmo dia: 4 trades, pnl -37 e freeze preservados; config atualizada';

  -- ------------------------------------------------------------------- R3a
  if v_r.quarentena_em is null or v_r.contabilidade_incompleta_em is null then
    raise exception 'R3a FALHOU: rearme no mesmo dia limpou quarentena/contabilidade';
  end if;
  raise notice 'R3a OK — quarentena e contabilidade incompleta sobreviveram ao rearme do mesmo dia';

  -- ------------------------------------------------------------------- R2
  -- A linha passa a ser de ONTEM. Agora o rollover é o comportamento certo:
  -- contador e congelamento de ontem não valem hoje.
  update public.autopilot_sessions
     set last_reset_day = v_ontem, frozen_until_day = v_ontem,
         trades_today = 4, pnl_today = -37
   where id = v_sid;

  perform public.autopilot_rearm_preserva_rails(
    '0xA51', 'binance', 'moderado', 'spot',
    50, 30, 5, '{BTC/USDT}', 'pt', v_cx,
    'so_negocia', 'rearme no dia seguinte', now() + interval '24 hours');

  select * into v_r from public.autopilot_sessions where id = v_sid;

  if v_r.trades_today <> 0 or v_r.pnl_today <> 0 then
    raise exception 'R2 FALHOU: dia novo nao zerou os rails (trades=%, pnl=%)', v_r.trades_today, v_r.pnl_today;
  end if;
  if v_r.frozen_until_day is not null then
    raise exception 'R2 FALHOU: congelamento de ONTEM (%) sobreviveu ao dia novo', v_r.frozen_until_day;
  end if;
  if v_r.last_reset_day <> v_hoje then
    raise exception 'R2 FALHOU: last_reset_day nao virou para hoje (%)', v_r.last_reset_day;
  end if;
  raise notice 'R2 OK — dia novo: rollover de trades/pnl/freeze, last_reset_day = hoje';

  -- ------------------------------------------------------------------- R3b
  -- ⚠️ A virada do dia zera o QUE É DO DIA. Quarentena e contabilidade
  -- incompleta não são do dia: elas descrevem um livro que ainda não fecha, e
  -- o relógio não fecha livro nenhum.
  if v_r.quarentena_em is null or v_r.contabilidade_incompleta_em is null then
    raise exception 'R3b FALHOU: o rollover do dia apagou quarentena/contabilidade incompleta';
  end if;
  raise notice 'R3b OK — quarentena e contabilidade incompleta sobreviveram tambem a virada do dia';

  -- ------------------------------------------------------------------- R4
  begin
    perform public.autopilot_rearm_preserva_rails(
      '0xA51', 'binance', 'moderado', 'spot',
      50, 30, 5, '{BTC/USDT}', 'pt', null,
      'so_negocia', 'sem elo', now() + interval '24 hours');
    raise exception 'R4 FALHOU: sessao foi armada com conexao_id NULO';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro like 'R4 FALHOU%' then raise; end if;
    if v_erro not like '%conexao_id obrigatoria%' then
      raise exception 'R4 FALHOU: recusou por outro motivo: %', v_erro;
    end if;
  end;
  raise notice 'R4 OK — conexao_id nulo recusado: sessao sem elo com o cofre nao nasce';

  -- ------------------------------------------------------------------- R5
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'autopilot_sessions'
     and column_name in ('creds_cipher', 'api_key', 'api_secret');
  if v_n <> 0 then
    raise exception 'R5 FALHOU: a sessao voltou a ter onde guardar credencial (% colunas)', v_n;
  end if;
  -- E o elo continua sendo o elo, apontando para a linha do cofre:
  if v_r.conexao_id is distinct from v_cx then
    raise exception 'R5 FALHOU: conexao_id = % (esperado %)', v_r.conexao_id, v_cx;
  end if;
  raise notice 'R5 OK — a sessao guarda o elo, e nao ha coluna de credencial para a RPC preencher';

  -- ------------------------------------------------------------------- R6
  select count(*) into v_n from public.autopilot_sessions
   where wallet_address = '0xA51' and exchange_id = 'binance';
  if v_n <> 1 then
    raise exception 'R6 FALHOU: % linhas para a mesma conta — rearme duplicou a sessao', v_n;
  end if;
  if v_r.is_active is not true then
    raise exception 'R6 FALHOU: rearme nao reativou a sessao';
  end if;
  raise notice 'R6 OK — uma unica linha por conta, reativada pelo rearme';

  -- ---------------------------------------------------------------- limpeza
  delete from public.autopilot_sessions where wallet_address = '0xA51';
  delete from public.cex_conexoes       where wallet_address = '0xA51';
end $$;
