-- ═══════════════════════════════════════════════════════════════════════
-- AS INVARIANTES VIRAM PROPRIEDADE DO BANCO — FASE 1, parte 2
--
-- Achados A80, A100, A101, A108, A109.
--
-- ⚠️ POR QUE plpgsql E NÃO CÓDIGO. O briefing pergunta: "se esta função rodar
-- duas vezes, produz um segundo efeito financeiro?". Para somar um fill é
-- preciso LER o total e ESCREVER o novo — duas passadas concorrentes leem o
-- mesmo total e escrevem o mesmo resultado, perdendo um fill. O corpo de uma
-- função plpgsql roda numa transação só, e o `for update` serializa. É o mesmo
-- motivo de `apply_session_pnl` e `celeiro_reverter_genoma` existirem.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- TRANSIÇÕES LEGAIS
--
-- ⚠️⚠️ DE `SUBMITTING` NÃO SE CHEGA A `FAILED_PRE_SUBMIT`. Esta é a regra mais
-- importante do arquivo (INVARIANTE 3). `SUBMITTING` é gravado imediatamente
-- ANTES da chamada externa: a partir dali, "nada aconteceu" deixou de ser algo
-- que se possa concluir sem olhar a corretora. O caminho é `UNKNOWN`.
--
-- ⚠️ `FILLED`, `CANCELED` e `FAILED_PRE_SUBMIT` são TERMINAIS: não saem.
-- `QUARANTINED` só sai para `RECONCILIATION_REQUIRED` — por mão humana que
-- reexamina, nunca por automação que desiste.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_transicao_permitida(
  p_de public.cex_intent_state, p_para public.cex_intent_state
) returns boolean language sql immutable as $$
  select case p_de
    when 'CREATED'    then p_para in ('AUTHORIZED','FAILED_PRE_SUBMIT','QUARANTINED')
    when 'AUTHORIZED' then p_para in ('RESERVED','FAILED_PRE_SUBMIT','QUARANTINED')
    when 'RESERVED'   then p_para in ('SUBMITTING','FAILED_PRE_SUBMIT','QUARANTINED')
    -- ⚠️ sem FAILED_PRE_SUBMIT aqui, de propósito. Ver o cabeçalho.
    -- ⚠️ CANCELED cobre a RECUSA PROVADA: a corretora respondeu e disse não.
    --    Chegou lá, nada executou, nada ficou vivo. Lista curta e explícita.
    when 'SUBMITTING' then p_para in ('SUBMITTED','UNKNOWN','CANCELED','QUARANTINED')
    when 'SUBMITTED'  then p_para in ('PARTIALLY_FILLED','FILLED','CANCEL_PENDING','CANCELED',
                                      'UNKNOWN','RECONCILIATION_REQUIRED','QUARANTINED')
    when 'PARTIALLY_FILLED'
                      then p_para in ('PARTIALLY_FILLED','FILLED','CANCEL_PENDING','CANCELED',
                                      'UNKNOWN','RECONCILIATION_REQUIRED','QUARANTINED')
    when 'CANCEL_PENDING'
                      then p_para in ('CANCELED','PARTIALLY_FILLED','FILLED',
                                      'UNKNOWN','RECONCILIATION_REQUIRED','QUARANTINED')
    when 'UNKNOWN'    then p_para in ('SUBMITTED','PARTIALLY_FILLED','FILLED','CANCELED',
                                      'RECONCILIATION_REQUIRED','QUARANTINED')
    when 'RECONCILIATION_REQUIRED'
                      then p_para in ('SUBMITTED','PARTIALLY_FILLED','FILLED','CANCELED',
                                      'UNKNOWN','QUARANTINED')
    when 'QUARANTINED' then p_para in ('RECONCILIATION_REQUIRED')
    else false   -- FILLED, CANCELED, FAILED_PRE_SUBMIT: terminais
  end;
$$;

comment on function public.cex_transicao_permitida is
  'Maquina de estados do intent. De SUBMITTING nunca se conclui FAILED_PRE_SUBMIT (INVARIANTE 3).';

-- ─────────────────────────────────────────────────────────────────────────
-- RECÁLCULO DOS DERIVADOS — a única porta por onde `filled_qty` muda.
--
-- ⚠️ O ESTADO SAI DO LIVRO, NÃO DA OPINIÃO DE QUEM CHAMA. Cheio vira FILLED,
-- parcial vira PARTIALLY_FILLED. É isto que torna o A81 impossível: sem linha
-- no livro, `filled_qty` é 0 e o estado não pode ser FILLED.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_recalcular_intent(p_intent_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_qty numeric; v_quote numeric; v_fee numeric; v_moeda text;
  v_pedido numeric; v_estado public.cex_intent_state; v_novo public.cex_intent_state;
begin
  select coalesce(sum(qty),0), coalesce(sum(quote_amount),0),
         nullif(sum(coalesce(fee,0)),0), max(fee_currency)
    into v_qty, v_quote, v_fee, v_moeda
    from public.cex_fills where intent_id = p_intent_id;

  select requested_qty, state into v_pedido, v_estado
    from public.cex_execution_intents where id = p_intent_id;

  v_novo := v_estado;
  -- ⚠️ Só promove a partir de estados pós-envio. Um fill contra um intent
  -- pré-envio é contradição, e quem insere já a recusa antes de chegar aqui.
  if v_estado in ('SUBMITTED','PARTIALLY_FILLED','UNKNOWN','CANCEL_PENDING',
                  'RECONCILIATION_REQUIRED') then
    if v_qty >= v_pedido - 1e-12 then
      v_novo := 'FILLED';
    elsif v_qty > 0 then
      v_novo := 'PARTIALLY_FILLED';
    end if;
  end if;

  update public.cex_execution_intents
     set filled_qty   = v_qty,
         filled_quote = v_quote,
         fee_total    = v_fee,
         fee_currency = coalesce(v_moeda, fee_currency),
         state        = v_novo,
         terminal_at  = case when v_novo = 'FILLED' then now() else terminal_at end,
         updated_at   = now()
   where id = p_intent_id;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- INGESTÃO NÍVEL TRADE — identidade de verdade
--
-- ⚠️ TODOS OS TRADES DA ORDEM DE UMA VEZ, e não um por chamada. Os sintéticos
-- daquela ordem são apagados na MESMA transação: ingerir um trade de cada vez
-- deixaria o total transitoriamente MENOR que a verdade, e uma leitura no meio
-- veria uma posição que nunca existiu.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_ingest_trades(
  p_intent_id uuid,
  p_external_order_id text,
  p_trades jsonb            -- [{trade_id, qty, price, quote, fee, fee_currency, executed_at}]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_t jsonb; v_inseridos integer := 0;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;

  -- ⚠️ FILL CONTRA INTENT PRÉ-ENVIO É CONTRADIÇÃO, não dado. Quem chama tem de
  -- levar o intent a RECONCILIATION_REQUIRED e olhar — nunca gravar por cima.
  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'fill contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  -- O sintético é estimativa; o trade é fato. O fato substitui.
  delete from public.cex_fills
   where intent_id = p_intent_id and sintetico
     and external_order_id is not distinct from p_external_order_id;

  for v_t in select * from jsonb_array_elements(coalesce(p_trades,'[]'::jsonb)) loop
    insert into public.cex_fills (
      intent_id, exchange_id, external_order_id, external_trade_id, client_order_id,
      symbol, side, qty, price, quote_amount, fee, fee_currency, executed_at,
      sintetico, dedupe_key
    ) values (
      p_intent_id, v_intent.exchange_id, p_external_order_id,
      v_t->>'trade_id', v_intent.client_order_id,
      v_intent.symbol, v_intent.side,
      (v_t->>'qty')::numeric, (v_t->>'price')::numeric, (v_t->>'quote')::numeric,
      nullif(v_t->>'fee','')::numeric, nullif(v_t->>'fee_currency',''),
      nullif(v_t->>'executed_at','')::timestamptz,
      false, 'trade:' || (v_t->>'trade_id')
    )
    on conflict (exchange_id, dedupe_key) do nothing;
    if found then v_inseridos := v_inseridos + 1; end if;
  end loop;

  if p_external_order_id is not null and v_intent.external_order_id is null then
    update public.cex_execution_intents set external_order_id = p_external_order_id
     where id = p_intent_id;
  end if;

  perform public.cex_recalcular_intent(p_intent_id);
  select * into v_intent from public.cex_execution_intents where id = p_intent_id;
  return jsonb_build_object('inseridos', v_inseridos, 'filled_qty', v_intent.filled_qty,
                            'state', v_intent.state);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- INGESTÃO NÍVEL ORDEM — só o acumulado, sem id de trade
--
-- ⚠️ O DELTA É CONTRA O LIVRO, NÃO CONTRA O ACUMULADO ANTERIOR. Se trades reais
-- já somam 5 e a corretora reporta acumulado 5, o delta é ZERO e nada entra —
-- é isto que torna seguro misturar os dois modos de ingestão.
--
-- ⚠️ ACUMULADO MENOR QUE O LIVRO É DIVERGÊNCIA, não correção. Ninguém
-- "desexecuta" um trade: o intent vai para RECONCILIATION_REQUIRED e para.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_ingest_order_snapshot(
  p_intent_id uuid,
  p_external_order_id text,
  p_cumulative_qty numeric,
  p_avg_price numeric,
  p_cumulative_quote numeric,
  p_fee numeric,
  p_fee_currency text,
  p_executed_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_ja numeric; v_delta numeric; v_quote numeric; v_preco numeric;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;
  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'snapshot contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  select coalesce(sum(qty),0), coalesce(sum(quote_amount),0)
    into v_ja, v_quote from public.cex_fills where intent_id = p_intent_id;

  if p_cumulative_qty is null or p_cumulative_qty <= v_ja + 1e-12 then
    -- Nada novo. Menor que o livro é divergência e quem chama decide.
    perform public.cex_recalcular_intent(p_intent_id);
    return jsonb_build_object('inseridos', 0, 'regrediu',
      coalesce(p_cumulative_qty, 0) < v_ja - 1e-9);
  end if;

  v_delta := p_cumulative_qty - v_ja;
  v_preco := case when p_avg_price > 0 then p_avg_price
                  when p_cumulative_quote > 0 and p_cumulative_qty > 0
                    then p_cumulative_quote / p_cumulative_qty
                  else null end;
  if v_preco is null or v_preco <= 0 then
    -- ⚠️ SEM PREÇO NÃO SE GRAVA FILL. "Não sabemos a que preço" não vira zero
    -- nem vira o preço de referência: vira reconciliação.
    raise exception 'snapshot sem preco utilizavel para a ordem %', p_external_order_id;
  end if;

  insert into public.cex_fills (
    intent_id, exchange_id, external_order_id, external_trade_id, client_order_id,
    symbol, side, qty, price, quote_amount, fee, fee_currency, executed_at,
    sintetico, dedupe_key
  ) values (
    p_intent_id, v_intent.exchange_id, p_external_order_id, null, v_intent.client_order_id,
    v_intent.symbol, v_intent.side,
    v_delta, v_preco,
    greatest(coalesce(p_cumulative_quote,0) - v_quote, 0),
    p_fee, p_fee_currency, p_executed_at,
    true, 'ordercum:' || coalesce(p_external_order_id,'?') || ':' || p_cumulative_qty::text
  )
  on conflict (exchange_id, dedupe_key) do nothing;

  if p_external_order_id is not null and v_intent.external_order_id is null then
    update public.cex_execution_intents set external_order_id = p_external_order_id
     where id = p_intent_id;
  end if;

  perform public.cex_recalcular_intent(p_intent_id);
  select * into v_intent from public.cex_execution_intents where id = p_intent_id;
  return jsonb_build_object('inseridos', 1, 'filled_qty', v_intent.filled_qty,
                            'state', v_intent.state, 'regrediu', false);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- TRANSIÇÃO DE ESTADO
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_transicionar(
  p_intent_id uuid,
  p_para public.cex_intent_state,
  p_motivo text default null,
  p_external_order_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_de public.cex_intent_state; v_pedido numeric; v_filled numeric;
begin
  select state, requested_qty, filled_qty into v_de, v_pedido, v_filled
    from public.cex_execution_intents where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;

  if v_de = p_para then
    return jsonb_build_object('ok', true, 'de', v_de, 'para', p_para, 'noop', true);
  end if;
  if not public.cex_transicao_permitida(v_de, p_para) then
    return jsonb_build_object('ok', false, 'de', v_de, 'para', p_para,
      'porque', 'transicao proibida');
  end if;

  update public.cex_execution_intents
     set state        = p_para,
         state_reason = coalesce(p_motivo, state_reason),
         external_order_id = coalesce(p_external_order_id, external_order_id),
         submitting_at = case when p_para = 'SUBMITTING' then now() else submitting_at end,
         submitted_at  = case when p_para = 'SUBMITTED'  then coalesce(submitted_at, now()) else submitted_at end,
         authorized_at = case when p_para = 'AUTHORIZED' then now() else authorized_at end,
         -- ⚠️ A101: CANCELAR ATINGE SÓ O REMANESCENTE. O que já executou é fato
         -- imutável; `canceled_qty` é o que sobrou, nunca o pedido inteiro.
         canceled_qty  = case when p_para = 'CANCELED'
                              then greatest(v_pedido - v_filled, 0) else canceled_qty end,
         terminal_at   = case when p_para in ('FILLED','CANCELED','FAILED_PRE_SUBMIT')
                              then now() else terminal_at end,
         updated_at    = now()
   where id = p_intent_id;

  return jsonb_build_object('ok', true, 'de', v_de, 'para', p_para);
end; $$;

comment on function public.cex_transicionar is
  'Transicao de estado do intent. CANCELED cancela apenas o remanescente (achado A101).';
