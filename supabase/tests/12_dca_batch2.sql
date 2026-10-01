\set ON_ERROR_STOP on
begin;

-- Batch 2 — A58/A59. Executar somente em PostgreSQL descartável após 0001→0066.

-- ── A58: final auth relê/locka o plano ───────────────────────────────────
do $$
declare
  v_plano uuid;
  v_intent uuid;
  v_r jsonb;
begin
  insert into public.dca_planos
    (wallet_address, exchange_id, symbol, orcamento_total_usd, por_ciclo_usd,
     ciclos_total, intervalo, next_run_at, modo, status)
  values
    ('batch2-a58', 'binance', 'BTC/USDT', 1000, 100, 10, 'daily', now(), 'simulado', 'ativo')
  returning id into v_plano;

  -- Plano ativo autoriza e marca SUBMITTING.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('batch2-a58-active', 'dca_cron', true, v_plano, 1,
     'binance', 'BTC/USDT', 'buy', 'market', 1, 100, true, 'RESERVED')
  returning id into v_intent;

  v_r := public.cex_autorizar_e_submeter(v_intent);
  if coalesce((v_r->>'ok')::boolean, false) is not true then
    raise exception 'A58 ativo deveria autorizar: %', v_r;
  end if;
  if (select state from public.cex_execution_intents where id=v_intent) <> 'SUBMITTING' then
    raise exception 'A58 ativo nao marcou SUBMITTING';
  end if;

  -- Revisão A58: auth COMMITOU primeiro; depois o dono pausa e a chamada fica
  -- UNKNOWN. Na PASSADA SEGUINTE o plano já não está na fila status=ativo, mas
  -- precisa aparecer na fila independente de recovery.
  update public.dca_planos set status='pausado' where id=v_plano;
  perform public.cex_transicionar(v_intent, 'UNKNOWN', 'fixture pos-auth');
  if (select state from public.cex_execution_intents where id=v_intent) <> 'UNKNOWN' then
    raise exception 'A58 fixture nao chegou a UNKNOWN';
  end if;
  if exists (select 1 from public.dca_planos where id=v_plano and status='ativo') then
    raise exception 'A58 plano pausado apareceu como ativo';
  end if;
  if not exists (
    select 1 from public.dca_planos_com_intent_vivo_para_recovery(20) r
     where r.id = v_plano and r.status = 'pausado'
  ) then
    raise exception 'A58 auth->pause->UNKNOWN ficou orfao da fila de recovery';
  end if;

  -- Pausado antes da final auth recusa.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('batch2-a58-paused', 'dca_cron', true, v_plano, 2,
     'binance', 'BTC/USDT', 'buy', 'market', 1, 100, true, 'RESERVED')
  returning id into v_intent;
  v_r := public.cex_autorizar_e_submeter(v_intent);
  if coalesce((v_r->>'ok')::boolean, false) is true then
    raise exception 'A58 pausado autorizou indevidamente';
  end if;
  if (select state from public.cex_execution_intents where id=v_intent) <> 'RESERVED' then
    raise exception 'A58 pausado alterou estado do intent';
  end if;

  -- Encerrado antes da final auth recusa.
  update public.dca_planos set status='encerrado' where id=v_plano;
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('batch2-a58-closed', 'dca_cron', true, v_plano, 3,
     'binance', 'BTC/USDT', 'buy', 'market', 1, 100, true, 'RESERVED')
  returning id into v_intent;
  v_r := public.cex_autorizar_e_submeter(v_intent);
  if coalesce((v_r->>'ok')::boolean, false) is true then
    raise exception 'A58 encerrado autorizou indevidamente';
  end if;

  -- FK torna plan_id dangling impossível; ausência representável = NULL.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('batch2-a58-no-plan', 'dca_cron', true, null, 4,
     'binance', 'BTC/USDT', 'buy', 'market', 1, 100, true, 'RESERVED')
  returning id into v_intent;
  v_r := public.cex_autorizar_e_submeter(v_intent);
  if coalesce((v_r->>'ok')::boolean, false) is true then
    raise exception 'A58 dca_cron sem plano autorizou indevidamente';
  end if;
end $$;

-- ACL das duas RPCs novas/redefinidas: SECURITY DEFINER só service_role.
do $$
begin
  if has_function_privilege('anon', 'public.cex_autorizar_e_submeter(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cex_autorizar_e_submeter(uuid)', 'EXECUTE') then
    raise exception 'A58 cex_autorizar_e_submeter exposta fora de service_role';
  end if;
  if has_function_privilege('anon', 'public.dca_planos_com_intent_vivo_para_recovery(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.dca_planos_com_intent_vivo_para_recovery(integer)', 'EXECUTE') then
    raise exception 'A58 fila de recovery exposta fora de service_role';
  end if;
  if not has_function_privilege('service_role', 'public.dca_planos_com_intent_vivo_para_recovery(integer)', 'EXECUTE') then
    raise exception 'A58 service_role sem acesso a fila de recovery';
  end if;
end $$;

-- ── A59: orçamento real derivado de intents/fills, sem dupla contagem ─────
do $$
declare
  v_conn uuid;
  v_plan uuid;
  v_cert uuid;
  v_i uuid;
  v_total numeric;
  v_filled_intent uuid;
begin
  insert into public.cex_conexoes
    (wallet_address, exchange_id, creds_cipher, is_active,
     credential_identity, is_current)
  values
    ('batch2-a59', 'binance', 'cipher-fixture', true, repeat('a',64), true)
  returning id into v_conn;

  insert into public.dca_planos
    (conexao_id, wallet_address, exchange_id, symbol, orcamento_total_usd,
     por_ciclo_usd, ciclos_total, intervalo, next_run_at, modo, status)
  values
    (v_conn, 'batch2-a59', 'binance', 'BTC/USDT', 5000, 100, 20,
     'daily', now(), 'real', 'ativo')
  returning id into v_plan;

  insert into public.strategy_certificates
    (strategy_id, strategy_version, strategy_hash, evidence, risk_limits,
     allowed_venues, allowed_symbols)
  values
    ('batch2-dca', 1, 'batch2-hash', '{}'::jsonb,
     '{"maxTradeUsd":1000}'::jsonb, array['binance'], array['BTC/USDT'])
  returning id into v_cert;

  -- Helper inline: sete intents inconclusivos; cada um compromete requested,
  -- inclusive PARTIAL mesmo tendo fill durável.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     strategy_id, strategy_version, strategy_hash, certificate_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('b2-submit', 'dca_cron', true, v_plan, 1, v_conn, 'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1,100,false,'SUBMITTING'),
    ('b2-unknown','dca_cron', true, v_plan, 2, v_conn, 'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1, 80,false,'UNKNOWN'),
    ('b2-partial','dca_cron', true, v_plan, 3, v_conn, 'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1, 60,false,'SUBMITTED'),
    ('b2-submitted','dca_cron',true,v_plan,4,v_conn,'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1,30,false,'SUBMITTED'),
    ('b2-cancel-pending','dca_cron',true,v_plan,5,v_conn,'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1,20,false,'CANCEL_PENDING'),
    ('b2-reconcile','dca_cron',true,v_plan,6,v_conn,'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1,10,false,'RECONCILIATION_REQUIRED'),
    ('b2-quarantine','dca_cron',true,v_plan,7,v_conn,'batch2-dca',1,'batch2-hash',v_cert,'binance','BTC/USDT','buy','market',1,5,false,'QUARANTINED');

  -- A59 revisão: requested=60, mas a ingestão AUTORITATIVA prova fill=80.
  -- O estado vira PARTIALLY_FILLED pela própria cex_recalcular_intent.
  select id into v_i from public.cex_execution_intents where client_order_id='b2-partial';
  perform public.cex_ingest_order_snapshot(
    v_i, 'b2-partial-ext', .8, 100, 80, null, null, now()
  );
  if (select state from public.cex_execution_intents where id=v_i) <> 'PARTIALLY_FILLED' then
    raise exception 'A59 fixture 60/80 nao virou PARTIALLY_FILLED';
  end if;

  -- CANCELED partial: depois de resolvida a dúvida, só realizado = 25.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     strategy_id, strategy_version, strategy_hash, certificate_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state, filled_qty, filled_quote, canceled_qty)
  values
    ('b2-canceled','dca_cron',true,v_plan,8,v_conn,'batch2-dca',1,'batch2-hash',v_cert,
     'binance','BTC/USDT','buy','market',1,100,false,'CANCELED',.25,25,.75)
  returning id into v_i;
  insert into public.cex_fills
    (intent_id, exchange_id, symbol, side, qty, price, quote_amount, dedupe_key, executed_at)
  values (v_i,'binance','BTC/USDT','buy',.25,100,25,'batch2-canceled-fill',now());

  -- FILLED + ciclo ainda reservado simula fecharCiclo falhando. O gasto não some.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     strategy_id, strategy_version, strategy_hash, certificate_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state, filled_qty, filled_quote)
  values
    ('b2-filled','dca_cron',true,v_plan,9,v_conn,'batch2-dca',1,'batch2-hash',v_cert,
     'binance','BTC/USDT','buy','market',1,40,false,'FILLED',1,40)
  returning id into v_filled_intent;
  insert into public.cex_fills
    (intent_id, exchange_id, symbol, side, qty, price, quote_amount, dedupe_key, executed_at)
  values (v_filled_intent,'binance','BTC/USDT','buy',1,40,40,'batch2-filled-fill',now());
  insert into public.dca_ciclos(plano_id,ciclo_numero,status,agendado_para)
  values(v_plan,9,'reservado',now());

  -- FAILED_PRE_SUBMIT é zero.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     strategy_id, strategy_version, strategy_hash, certificate_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('b2-failed-pre','dca_cron',true,v_plan,10,v_conn,'batch2-dca',1,'batch2-hash',v_cert,
     'binance','BTC/USDT','buy','market',1,70,false,'FAILED_PRE_SUBMIT');

  -- Inconclusivos: 100+80+MAX(60,80)+30+20+10+5 = 325.
  -- Terminais: 25 cancelado parcial + 40 filled = 65. Total = 390.
  v_total := public.dca_gasto_real_comprometido_hoje('batch2-a59');
  if v_total <> 390 then
    raise exception 'A59 total esperado 390 (requested 60 / fill 80), obtido %', v_total;
  end if;

  -- Repetição/restart não duplica.
  if public.dca_gasto_real_comprometido_hoje('batch2-a59') <> 390 then
    raise exception 'A59 repeticao duplicou gasto';
  end if;

  -- Fechar o ciclo depois não altera o orçamento: autoridade já era livro/intent.
  update public.dca_ciclos set status='feito', executado_em=now(), custo_usd=40
   where plano_id=v_plan and ciclo_numero=9;
  if public.dca_gasto_real_comprometido_hoje('batch2-a59') <> 390 then
    raise exception 'A59 dca_ciclos alterou indevidamente a autoridade do teto';
  end if;
end $$;

-- A59 revisão: filled_qty conhecido sem custo financeiro afirmável falha fechado.
do $$
declare
  v_plan uuid;
  v_conn uuid;
  v_cert uuid;
  v_i uuid;
begin
  select id into v_plan from public.dca_planos where wallet_address='batch2-a59' limit 1;
  select conexao_id into v_conn from public.dca_planos where id=v_plan;
  select id into v_cert from public.strategy_certificates where strategy_id='batch2-dca' limit 1;

  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     strategy_id, strategy_version, strategy_hash, certificate_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('b2-partial-sem-custo','dca_cron',true,v_plan,12,v_conn,'batch2-dca',1,'batch2-hash',v_cert,
     'binance','BTC/USDT','buy','market',1,60,false,'SUBMITTED')
  returning id into v_i;

  -- Ingestão oficial cria qty > 0 com quote_amount = 0: estado parcial, mas o
  -- custo em USD continua não afirmável.
  perform public.cex_ingest_order_snapshot(
    v_i, 'b2-sem-custo-ext', .5, 100, 0, null, null, now()
  );
  if (select filled_qty from public.cex_execution_intents where id=v_i) <= 0 then
    raise exception 'A59 fixture sem custo nao gravou quantidade';
  end if;

  begin
    perform public.dca_gasto_real_comprometido_hoje('batch2-a59');
    raise exception 'A59 partial com custo nao afirmavel deveria falhar fechado';
  exception when others then
    if sqlerrm = 'A59 partial com custo nao afirmavel deveria falhar fechado' then raise; end if;
    -- ⚠️ Qualquer erro passava aqui (`when others`). Falha fechada pelo
    -- motivo ERRADO não prova a guarda: exige-se a mensagem dela.
    if sqlerrm not like '%tem fill sem custo afirmavel%' then
      raise exception 'motivo errado para "A59 partial com custo nao afirmavel deveria falhar fechado": %', sqlerrm;
    end if;
  end;

  -- Limpa a fixture fail-closed para os testes seguintes da mesma carteira.
  delete from public.cex_fills where intent_id=v_i;
  delete from public.cex_execution_intents where id=v_i;
end $$;

-- A59/A96 revisão: partial histórico não-USD com fill conhecido não pode usar
-- quote como se fosse USD.
do $$
declare
  v_conn uuid;
  v_plan uuid;
  v_i uuid;
begin
  insert into public.cex_conexoes
    (wallet_address, exchange_id, creds_cipher, is_active, credential_identity, is_current)
  values
    ('batch2-partial-nonusd', 'binance', 'cipher-fixture-partial-nonusd', true, repeat('c',64), true)
  returning id into v_conn;

  insert into public.dca_planos
    (conexao_id, wallet_address, exchange_id, symbol, orcamento_total_usd,
     por_ciclo_usd, ciclos_total, intervalo, next_run_at, modo, status)
  values
    (v_conn,'batch2-partial-nonusd','binance','ETH/BTC',1000,100,10,'daily',now(),'real','pausado')
  returning id into v_plan;

  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('b2-partial-nonusd','dca_cron',false,v_plan,1,v_conn,
     'binance','ETH/BTC','buy','market',1,100,false,'SUBMITTED')
  returning id into v_i;

  perform public.cex_ingest_order_snapshot(
    v_i, 'b2-partial-nonusd-ext', .5, .01, .005, null, null, now()
  );

  begin
    perform public.dca_gasto_real_comprometido_hoje('batch2-partial-nonusd');
    raise exception 'A59 partial nao-USD nao deveria ser batizado como USD';
  exception when others then
    if sqlerrm = 'A59 partial nao-USD nao deveria ser batizado como USD' then raise; end if;
    -- ⚠️ Qualquer erro passava aqui (`when others`). Falha fechada pelo
    -- motivo ERRADO não prova a guarda: exige-se a mensagem dela.
    if sqlerrm not like '%inconclusivo % com fill em quote nao USD-like: BTC%' then
      raise exception 'motivo errado para "A59 partial nao-USD nao deveria ser batizado como USD": %', sqlerrm;
    end if;
  end;
end $$;

-- NULL solicitado em estado inconclusivo deve falhar fechado.
do $$
declare
  v_plan uuid;
  v_conn uuid;
  v_cert uuid;
begin
  select id into v_plan from public.dca_planos where wallet_address='batch2-a59' limit 1;
  select conexao_id into v_conn from public.dca_planos where id=v_plan;
  select id into v_cert from public.strategy_certificates where strategy_id='batch2-dca' limit 1;

  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     strategy_id, strategy_version, strategy_hash, certificate_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state)
  values
    ('b2-null-requested','dca_cron',true,v_plan,11,v_conn,'batch2-dca',1,'batch2-hash',v_cert,
     'binance','BTC/USDT','buy','market',1,null,false,'UNKNOWN');

  begin
    perform public.dca_gasto_real_comprometido_hoje('batch2-a59');
    raise exception 'A59 NULL requested deveria falhar fechado';
  exception when others then
    if sqlerrm = 'A59 NULL requested deveria falhar fechado' then raise; end if;
    -- ⚠️ Qualquer erro passava aqui (`when others`). Falha fechada pelo
    -- motivo ERRADO não prova a guarda: exige-se a mensagem dela.
    if sqlerrm not like '%em UNKNOWN sem requested_notional_usd valido%' then
      raise exception 'motivo errado para "A59 NULL requested deveria falhar fechado": %', sqlerrm;
    end if;
  end;
end $$;

-- A96: histórico terminal não-USD não é reclassificado como USD.
do $$
declare
  v_conn uuid;
  v_plan uuid;
  v_i uuid;
begin
  insert into public.cex_conexoes
    (wallet_address, exchange_id, creds_cipher, is_active,
     credential_identity, is_current)
  values
    ('batch2-nonusd', 'binance', 'cipher-fixture-2', true, repeat('b',64), true)
  returning id into v_conn;

  insert into public.dca_planos
    (conexao_id, wallet_address, exchange_id, symbol, orcamento_total_usd,
     por_ciclo_usd, ciclos_total, intervalo, next_run_at, modo, status)
  values
    (v_conn,'batch2-nonusd','binance','ETH/BTC',1000,100,10,'daily',now(),'real','ativo')
  returning id into v_plan;

  -- autonomous=false apenas para representar histórico legado sem exigir criar
  -- um certificado fora da unidade; a função de gasto filtra por origem/mode.
  insert into public.cex_execution_intents
    (client_order_id, origin, autonomous, plan_id, cycle_number, conexao_id,
     exchange_id, symbol, side, order_type, requested_qty,
     requested_notional_usd, simulated, state, filled_qty, filled_quote)
  values
    ('b2-nonusd-filled','dca_cron',false,v_plan,1,v_conn,
     'binance','ETH/BTC','buy','market',1,100,false,'FILLED',1,.01)
  returning id into v_i;
  insert into public.cex_fills
    (intent_id, exchange_id, symbol, side, qty, price, quote_amount, dedupe_key, executed_at)
  values (v_i,'binance','ETH/BTC','buy',1,.01,.01,'batch2-nonusd-fill',now());

  begin
    perform public.dca_gasto_real_comprometido_hoje('batch2-nonusd');
    raise exception 'A96 terminal ETH/BTC nao deveria ser tratado como USD';
  exception when others then
    if sqlerrm = 'A96 terminal ETH/BTC nao deveria ser tratado como USD' then raise; end if;
    -- ⚠️ Qualquer erro passava aqui (`when others`). Falha fechada pelo
    -- motivo ERRADO não prova a guarda: exige-se a mensagem dela.
    if sqlerrm not like '%intent DCA terminal % com quote nao USD-like: BTC%' then
      raise exception 'motivo errado para "A96 terminal ETH/BTC nao deveria ser tratado como USD": %', sqlerrm;
    end if;
  end;
end $$;

rollback;
