-- ═══════════════════════════════════════════════════════════════════════
-- A118 — FEE CUMULATIVA DUPLICADA EM SNAPSHOTS + COBERTURA SYNTHETIC→REAL
--
-- Dois fatos medidos no reteste:
--
-- 1. `p_fee` é CUMULATIVO DA ORDEM (`order.fee.cost` do CCXT), igual
--    `p_cumulative_qty` e `p_cumulative_quote`. A versão da 0051 gravava o
--    cumulativo INTEIRO em cada fill sintético cujo qty é DELTA, e
--    `cex_recalcular_intent` soma por linha: snapshots progressivos de uma
--    mesma ordem (0.03, depois 0.05) fechavam `fee_total = 0.08`. A dedupe
--    key `ordercum:<ordem>:<qty>` não protegia — a qty muda.
--
--    A correção trata fee EXATAMENTE como qty/quote: grava o DELTA contra o
--    que o LIVRO INTEIRO DAQUELA ORDEM já contabilizou NA MESMA MOEDA
--    (`v_fee_delta := greatest(p_fee - v_fee_ja, 0)`). `p_fee` null continua
--    null — não se inventa fee.
--
--    A base do delta são os fills DA ORDEM, reais E sintéticos — qty/quote
--    já são assim (`v_ja`/`v_quote` somam o intent inteiro), e a fee não pode
--    ser diferente: depois que trades reais substituem os sintéticos (guarda
--    de cobertura, item 2), NÃO HÁ MAIS sintético na ordem, e um delta que
--    olhasse só sintéticos veria zero e regravaria a fee cumulativa INTEIRA
--    no snapshot seguinte (medido na revisão do round 3: snapshot 5/0.05 →
--    trades completos → snapshot 8/0.08 fechava fee_total 0.13; replay do
--    5/0.05 após os trades fechava 0.10).
--
--    ⚠️ ASSIMETRIA DECLARADA: fee RETROCEDENDO entre snapshots é clampada a
--    delta ZERO (`greatest(p_fee - v_fee_ja, 0)`) — correção para baixo não
--    entra e o `fee_total` pode ficar SUPerestimado até os trades reais
--    chegarem. Declarado, não escondido: errar o pedágio para CIMA é
--    conservador (não libera gasto a mais), e subtrair do livro faria um
--    replay fora de ordem apagar fee legítima.
--
--    A dedupe key passa a incluir o fee: `ordercum:<ordem>:<qty>:<fee>`.
--    Replay idêntico cai no `on conflict do nothing` (ou no caminho "nada
--    novo" com delta zero); uma fee CORRIGIDA pela corretora gera chave nova
--    e entra como AJUSTE DE QTY ZERO (qty=0, quote=0, fee=delta) — é por
--    isso que a constraint `qty > 0` vira `qty > 0 or quote_amount = 0`:
--    fill sem qty só existe para carregar correção de fee, nunca quote.
--
--    ⚠️ MOEDA DE FEE INCOMPATÍVEL É EXCEÇÃO (fail-closed). Se o livro já tem
--    fills da ordem com fee não nula cuja `fee_currency` DIVERGE da que o
--    snapshot traz, somar seria misturar moedas e converter exigiria um
--    preço inventado — os dois proibidos. E O NULL TAMBÉM FECHA: o CCXT pode
--    trazer `cost` sem `currency`, então a guarda usa `is distinct from` e
--    cobre null↔'USDT' nos DOIS sentidos (livro USDT + snapshot sem moeda é
--    exceção, não soma cega). Snapshot com `p_fee`/`p_fee_currency` ambos
--    null segue como antes: fee null, sem inventar. Limitação documentada:
--    `fee_total` é um numérico único por intent e `cex_recalcular_intent` já
--    assume moeda única (`max(fee_currency)`); multi-moeda na mesma ordem
--    vai para reconciliação, não para soma.
--
--    Invariante: o `fee_total` final INDEPENDE do número de snapshots
--    (1 snapshot direto de 0.05 ≡ 10 progressivos terminando em 0.05).
--
-- 2. `cex_ingest_trades` deletava os sintéticos da ordem na mesma transação
--    e inseria o lote recebido — mas `fetchMyTrades` é PÁGINA ÚNICA de 200,
--    SEM PROVA DE COMPLETUDE. Um lote parcial substituía a estimativa por
--    um fato menor, e o restante nunca voltava (a próxima leitura traria os
--    mesmos trades, dedupados). O fato sintético só é substituído quando o
--    conjunto real COBRE o estimado: se `sum(qty)` real (livro + lote novo)
--    < `sum(qty)` sintética, a RPC NÃO deleta sintético e NÃO insere trade
--    (inserir somaria em dobro na próxima tentativa completa), e devolve
--    `{ok:false, porque:'cobertura_incompleta'}` — o reconciliador registra
--    como ADIADO e segue; o intent permanece para a próxima passada.
--
-- ACL: mesma disciplina da 0055 (A116) — REVOKE/GRANT repetidos aqui são
-- idempotentes, e o CATALOGO de `rpcs-acl.test.ts` aponta estas duas funções
-- para esta migration (regra: ACL file ≥ def file).
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- FILL DE AJUSTE DE FEE TEM QTY ZERO. A constraint original (`qty > 0`)
-- impediria a correção de fee com qty parada; a forma nova admite qty=0
-- SOMENTE com quote zero — um fill que não move qty não pode mover quote.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.cex_fills drop constraint if exists cex_fills_qty_check;
alter table public.cex_fills
  add constraint cex_fills_qty_check check (qty > 0 or (qty = 0 and quote_amount = 0));

comment on constraint cex_fills_qty_check on public.cex_fills is
  'qty zero só em ajuste de fee (quote zero). A118: fee cumulativa corrigida com qty parada.';

-- ─────────────────────────────────────────────────────────────────────────
-- INGESTÃO NÍVEL ORDEM — fee como CUMULATIVA, igual qty/quote (A118)
--
-- ⚠️ O DELTA (de qty, quote E fee) é contra o livro, não contra o acumulado
-- anterior. Replay idêntico não soma nada; correção de fee entra como ajuste
-- de qty zero com chave nova.
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
  v_fee_ja numeric; v_fee_delta numeric; v_moeda_livro text; v_incomp integer;
  v_chave text; v_ajuste boolean := false;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;
  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'snapshot contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  -- ⚠️ MOEDA DE FEE INCOMPATÍVEL É EXCEÇÃO, não conversão — e o NULL também
  -- fecha. O CCXT pode trazer `cost` sem `currency`: um livro USDT seguido de
  -- snapshot sem moeda NÃO pode somar como se fosse USDT. Fail-closed quando
  -- o snapshot traz fee (ou moeda) e existe fill DA ORDEM (real ou sintético)
  -- com fee não nula cuja moeda diverge — `is distinct from` cobre
  -- null↔'USDT' nos dois sentidos. p_fee e p_fee_currency ambos null: segue
  -- sem exceção, fee null, sem inventar.
  if p_fee is not null or p_fee_currency is not null then
    select count(*), min(f.fee_currency) into v_incomp, v_moeda_livro
      from public.cex_fills f
     where f.intent_id = p_intent_id
       and f.external_order_id is not distinct from p_external_order_id
       and f.fee is not null
       and f.fee_currency is distinct from p_fee_currency;
    if v_incomp > 0 then
      raise exception 'fee_currency incompativel na ordem %: livro tem %, snapshot traz % — sem conversao inventada',
        p_external_order_id, coalesce(v_moeda_livro, '(null)'), coalesce(p_fee_currency, '(null)');
    end if;
  end if;

  select coalesce(sum(qty),0), coalesce(sum(quote_amount),0)
    into v_ja, v_quote from public.cex_fills where intent_id = p_intent_id;

  -- Fee já contabilizada pelos fills DESTA ordem — reais E sintéticos, NA
  -- MESMA moeda. O livro inteiro da ordem é a base do delta, como qty/quote
  -- já são: depois da substituição synthetic→real não há mais sintético, e
  -- filtrar por ele regravaria a fee cumulativa inteira (achado 1, round 3).
  select coalesce(sum(f.fee),0) into v_fee_ja
    from public.cex_fills f
   where f.intent_id = p_intent_id
     and f.external_order_id is not distinct from p_external_order_id
     and f.fee_currency is not distinct from p_fee_currency;
  v_fee_delta := case when p_fee is null then null
                      else greatest(p_fee - v_fee_ja, 0) end;
  -- A chave inclui o fee: replay idêntico é no-op; fee corrigida é fato novo.
  v_chave := 'ordercum:' || coalesce(p_external_order_id,'?')
             || ':' || p_cumulative_qty::text || ':' || coalesce(p_fee::text,'-');

  if p_cumulative_qty is null or p_cumulative_qty <= v_ja + 1e-12 then
    -- Qty parou, mas a fee pode ter sido CORRIGIDA pela corretora: a
    -- diferença entra como ajuste de qty ZERO (quote zero), com chave nova.
    -- Regressão de qty NÃO gera ajuste: é divergência, e quem chama decide.
    if p_cumulative_qty is not null and v_fee_delta is not null and v_fee_delta > 0
       and p_cumulative_qty > v_ja - 1e-9 then
      v_preco := case when p_avg_price > 0 then p_avg_price
                      when p_cumulative_quote > 0 and p_cumulative_qty > 0
                        then p_cumulative_quote / p_cumulative_qty
                      else (select f.price from public.cex_fills f
                             where f.intent_id = p_intent_id
                               and f.external_order_id is not distinct from p_external_order_id
                             order by f.created_at desc limit 1) end;
      if v_preco is null or v_preco <= 0 then
        raise exception 'ajuste de fee sem preco utilizavel para a ordem %', p_external_order_id;
      end if;
      insert into public.cex_fills (
        intent_id, exchange_id, external_order_id, external_trade_id, client_order_id,
        symbol, side, qty, price, quote_amount, fee, fee_currency, executed_at,
        sintetico, dedupe_key
      ) values (
        p_intent_id, v_intent.exchange_id, p_external_order_id, null, v_intent.client_order_id,
        v_intent.symbol, v_intent.side,
        0, v_preco, 0, v_fee_delta, p_fee_currency, p_executed_at,
        true, v_chave
      )
      on conflict (exchange_id, dedupe_key) do nothing;
      v_ajuste := found;
    end if;
    perform public.cex_recalcular_intent(p_intent_id);
    -- Nada novo de qty. Menor que o livro é divergência e quem chama decide.
    return jsonb_build_object('inseridos', case when v_ajuste then 1 else 0 end,
      'regrediu', coalesce(p_cumulative_qty, 0) < v_ja - 1e-9);
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
    -- ⚠️ O DELTA da fee, nunca o cumulativo inteiro (A118).
    v_fee_delta, p_fee_currency, p_executed_at,
    true, v_chave
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
-- INGESTÃO NÍVEL TRADE — com GUARDA DE COBERTURA synthetic→real (A118)
--
-- ⚠️ `fetchMyTrades` É PÁGINA ÚNICA SEM PROVA DE COMPLETUDE — o fato
-- sintético só é substituído quando o conjunto real cobre o estimado. Lote
-- parcial: NADA é deletado, NADA é inserido (inserir somaria em dobro quando
-- o lote completo chegasse), retorno `{ok:false, porque:'cobertura_incompleta'}`
-- e o reconciliador trata como ADIADO — não marca FAILED, o intent permanece
-- para a próxima tentativa.
--
-- ⚠️ TODOS OS TRADES DA ORDEM DE UMA VEZ, e não um por chamada: a substituição
-- (delete + insert) continua na MESMA transação quando a cobertura fecha.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_ingest_trades(
  p_intent_id uuid,
  p_external_order_id text,
  p_trades jsonb            -- [{trade_id, qty, price, quote, fee, fee_currency, executed_at}]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_t jsonb; v_inseridos integer := 0;
  v_sint numeric; v_real numeric;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;

  -- ⚠️ FILL CONTRA INTENT PRÉ-ENVIO É CONTRADIÇÃO, não dado. Quem chama tem de
  -- levar o intent a RECONCILIATION_REQUIRED e olhar — nunca gravar por cima.
  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'fill contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  -- Cobertura: o real (livro + lote novo, sem recontar trade já dedupado)
  -- tem de cobrir o sintético que vai ser apagado.
  select coalesce(sum(qty),0) into v_sint from public.cex_fills
   where intent_id = p_intent_id and sintetico
     and external_order_id is not distinct from p_external_order_id;

  select coalesce(sum(qty),0) into v_real from public.cex_fills
   where intent_id = p_intent_id and not sintetico
     and external_order_id is not distinct from p_external_order_id;

  select v_real + coalesce(sum((t->>'qty')::numeric),0) into v_real
    from jsonb_array_elements(coalesce(p_trades,'[]'::jsonb)) t
   where not exists (select 1 from public.cex_fills f
          where f.exchange_id = v_intent.exchange_id
            and f.dedupe_key = 'trade:' || (t->>'trade_id'));

  if v_real < v_sint - 1e-12 then
    return jsonb_build_object('ok', false, 'porque', 'cobertura_incompleta',
                              'real', v_real, 'sintetico', v_sint);
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
  return jsonb_build_object('ok', true, 'inseridos', v_inseridos,
                            'filled_qty', v_intent.filled_qty, 'state', v_intent.state);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ACL (A116, mesma disciplina da 0055): idempotente, repetida aqui porque o
-- `create or replace` acima é a definição vigente — ACL file ≥ def file.
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.cex_ingest_trades(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.cex_ingest_trades(uuid, text, jsonb)
  to service_role;

revoke execute on function public.cex_ingest_order_snapshot(uuid, text, numeric, numeric, numeric, numeric, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cex_ingest_order_snapshot(uuid, text, numeric, numeric, numeric, numeric, text, timestamptz)
  to service_role;
