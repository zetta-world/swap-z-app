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
--    mesmos trades, dedupados). O fato sintético só é substituído quando os
--    NOVOS trades únicos do lote COBREM o estimado (A121, abaixo): se a soma
--    das quantidades novas < `sum(qty)` sintética, a RPC NÃO deleta sintético
--    e NÃO insere trade (inserir somaria em dobro na próxima tentativa
--    completa), e devolve `{ok:false, porque:'cobertura_incompleta'}` — o
--    reconciliador registra como ADIADO e segue; o intent permanece para a
--    próxima passada.
--
-- 3. A121 (round 4) — a fórmula original da guarda (`real existente + novos
--    >= sintético`) ainda permitia apagar sintético criado DEPOIS do real
--    existente: real 5, snapshot 8 → sintético 3; um lote só com os trades
--    ANTIGOS (dedupados) fechava 5 ≥ 3, apagava os 3 e o total caía de 8
--    para 5 — um fato sumia sem nenhum trade novo. O real existente é
--    ANTERIOR ao sintético e não prova nada sobre o que veio depois: a
--    cobertura de QUANTIDADE é provada só pelos NOVOS trades únicos
--    (`v_novos >= v_sint`), somados por (intent_id, external_order_id is not
--    distinct from, exchange_id) — external_order_id null é tratado
--    explicitamente e uma ordem nunca cobre outra.
--
--    E a cobertura de FEE: sintético com fee CONHECIDA carrega um fato que
--    os trades novos têm de trazer EXPLÍCITO e na MESMA moeda, senão a
--    substituição o apaga. Trade novo com fee null →
--    `{ok:false, porque:'cobertura_fee_incompleta'}`; fee_currency divergente
--    → `{ok:false, porque:'fee_currency_incompativel'}` (sem conversão
--    inventada, sem null=0, sem somar moedas). Fee MENOR mas explícita e
--    completa → substitui: o real é fato (final pode ser 0.048 contra 0.05
--    estimado). Sintético SEM fee → trades sem fee não destroem informação
--    e a substituição procede. Os dois motivos novos são ADIADOS para o
--    reconciliador, como `cobertura_incompleta`.
--
--    ATOMICIDADE DECLARADA: PL/pgSQL roda na transação do chamador; todas as
--    validações acima retornam ANTES de qualquer delete/insert, e qualquer
--    exceção desfaz a transação inteira — ou a substituição acontece
--    completa (delete + inserts) ou o livro fica byte-a-byte intacto.
--
-- 4. A121 (round 4, revisão) — quatro correções na `cex_ingest_trades`:
--
--    a. O GATE DE FEE DISPARA PELA EXISTÊNCIA de sintético DA ORDEM com fee
--       conhecida — INDEPENDENTE de v_sint > 0. Um ajuste de fee de QTY ZERO
--       (correção da corretora, item 1) é um fato tanto quanto um fill com
--       qty: sem o gate, um lote todo dedupado (v_novos = 0) pulava as duas
--       guardas e o delete apagava o ajuste — fee_total regredia 0.07→0.05
--       sem nenhuma evidência substituta. Agora a correção de fee é
--       PRESERVADA ATÉ EVIDÊNCIA SUBSTITUTA EXPLÍCITA: sem trades novos
--       únicos, ou com algum sem fee explícita na mesma moeda, retorna
--       'cobertura_fee_incompleta' e NADA deleta/insere; com os trades novos
--       cobrindo, a substituição libera o delete dos sintéticos incluindo os
--       ajustes zero-qty (o real é fato).
--
--    b. SINTÉTICO NÃO ATRIBUÍDO (external_order_id NULL): o ACK sem id grava
--       o sintético com ordem NULL, e ele nunca entrava em v_sint nem no
--       delete quando os trades chegavam com o id descoberto — sintético 5 +
--       real 5 fechavam filled 10 sobre pedido 8. Decisão declarada:
--       sintéticos do MESMO INTENT com external_order_id NULL são "não
--       atribuídos" — entram em v_sint e no delete da ingestão de trades
--       daquele intent (os trades com o id descoberto SÃO a atribuição).
--       Sintéticos com external_order_id de OUTRA ordem continuam fora:
--       uma ordem nunca cobre outra. A cobertura N≥S e os gates de fee
--       protegem a substituição.
--
--    c. (banco-falso) fee "" ou não-numérico/ausente é SEM fee — a mesma
--       semântica do `nullif(t->>'fee','')` do SQL, para o teste não aprovar
--       o que o banco recusa.
--
--    d. DEFESA EM PROFUNDIDADE no nível da RPC: itens do lote com
--       `t->>'order'` não nulo e diferente de `p_external_order_id` são
--       IGNORADOS — não inseridos, não contam em v_novos (pertencem a outra
--       ingestão). O caller já filtra; a RPC não confia.
--
-- 5. ROUND 4 (brecha do verificador, RPC irmã): na `cex_ingest_order_snapshot`
--    a base do delta de fee (`v_fee_ja`) e a guarda de moeda filtravam só
--    `external_order_id is not distinct from p_external_order_id` e ficavam
--    CEGAS ao sintético NULL do mesmo intent — enquanto a base de qty
--    (`v_ja`) já é do intent inteiro. Medido: ACK sem id → sintético NULL
--    5/0.05 → snapshot ORD-1 5/0.05 via `v_fee_ja = 0`, inseria ajuste
--    zero-qty de 0.05 e fee_total fechava 0.10 (esperado 0.05); e sintético
--    NULL USDT + snapshot ORD-1 BNB não levantava exceção de moeda. A base
--    de fee e a guarda de moeda passam a usar o MESMO predicado "não
--    atribuído" do achado 2 (`is not distinct from` OU `is null`): o
--    sintético NULL do mesmo intent entra nas duas; fills com id de OUTRA
--    ordem seguem fora. A base de qty/quote (`v_ja`/`v_quote`) já era
--    intent-wide e não muda.
--
-- 6. A122 (round 5) — DEDUPE INTRA-LOTE na `cex_ingest_trades`. O NOT EXISTS
--    da cobertura só olhava fills PERSISTIDOS: duas cópias do MESMO trade_id
--    no mesmo lote somavam 2× em v_novos, mas colidiam na dedupe key na
--    inserção e entravam 1× — a cobertura era enganada (real 5, sintético 3,
--    lote [T9 1.5, T9 1.5]: N=3 ≥ 3 liberava a substituição e o livro caía
--    de 8 para 6.5). Ordem lógica OBRIGATÓRIA (cada passo antes do seguinte):
--
--      LOTE BRUTO → valida ids → filtro de ordem (achado d) → dedupe
--      intra-lote por trade_id → conflito? → remove já persistidos NESTE
--      INTENT → N → cobertura de qty → cobertura de fee → delete → insert
--      → recalc.
--
--    a. TRADE SEM ID: qualquer item do LOTE BRUTO sem `trade_id` não-vazio
--       → `{ok:false, porque:'trade_sem_id'}`, zero delete/insert — antes de
--       qualquer coverage. A validação precede o filtro de ordem: id ausente
--       é dado corrompido mesmo num item que seria ignorado, e o caller
--       (`ingerirTrades`) já recusa antes — isto é defesa em profundidade.
--    b. PAYLOAD IDÊNTICO CONTA UMA VEZ: cópias do mesmo trade_id com os
--       campos financeiros idênticos (qty, price, quote, fee, fee_currency,
--       order, executed_at — comparação NUMÉRICA via `is distinct from`, com
--       `nullif(...,'')` para fee/moeda/executed_at, a mesma política do R4)
--       colapsam na primeira ocorrência; N, a cobertura de fee e o insert
--       usam SEMPRE o lote normalizado, nunca o bruto.
--    c. PAYLOAD DIVERGENTE É FAIL-CLOSED: mesmo trade_id com qualquer campo
--       divergente → `{ok:false, porque:'trade_id_conflitante'}` — ZERO
--       mudança, livro byte-a-byte intacto. Nunca escolher uma versão: duas
--       versões do mesmo fato significam leitura corrompida, e decidir qual
--       vale seria inventar execução.
--
-- 7. A123 (round 5) — DEDUPE COM ESCOPO DE INTENT. A trava era
--    `unique (exchange_id, dedupe_key)` (0050) — GLOBAL na corretora: dois
--    intents nossos na mesma venue podem carregar o mesmo id de trade (ids
--    não são universalmente únicos — venues e símbolos diferentes colidem),
--    e o segundo fill legítimo caía no `on conflict do nothing` e SUMIA do
--    livro. Todos os `on conflict` e NOT EXISTS de dedupe passam a usar
--    `intent_id` (a constraint nova é `cex_fills_intent_dedupe`, criada na
--    0062 — PL/pgSQL planeja no primeiro uso, então a ordem 0059→0062 é
--    segura). ⚠️ A COBERTURA NÃO MUDA DE ESCOPO (§27): dedupe persistente é
--    por intent, mas a COBERTURA synthetic→real segue por (intent_id,
--    external_order_id is not distinct from, incluindo null = não atribuído)
--    — propriedades diferentes; uma ordem continua sem cobrir outra.
--
-- ACL: mesma disciplina da 0055 (A116) — REVOKE/GRANT repetidos aqui são
-- idempotentes, e o CATALOGO de `rpcs-acl.test.ts` aponta estas duas funções
-- para esta migration (regra: ACL file ≥ def file).
--
-- NOTA (round 5, revisão) — divergência de CANAL conhecida e inalcançável:
-- na checagem `trade_id_conflitante` o SQL faz `fee::numeric` por par, então
-- um trade com fee NÃO-numérico (ex.: "abc") ABORTA com exceção (transação
-- desfeita, nada muda); o banco-falso trata o mesmo valor como "sem fee" e
-- devolve `{ok:false, porque:'trade_sem_id'|'cobertura_fee_incompleta'}`
-- conforme o caso. Os dois são fail-closed (zero efeito) e o valor só
-- chegaria via fetchMyTrades já normalizado pelo executor TS — declarado
-- aqui para o auditor não tratar como divergência de comportamento.
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
  -- ⚠️ SINTÉTICO NÃO ATRIBUÍDO (mesmo predicado do achado 2 da
  -- cex_ingest_trades): fills do MESMO INTENT com external_order_id NULL
  -- (ACK sem id) entram na guarda — o snapshot que chega com o id descoberto
  -- É a atribuição. Fills com external_order_id de OUTRA ordem seguem fora.
  if p_fee is not null or p_fee_currency is not null then
    select count(*), min(f.fee_currency) into v_incomp, v_moeda_livro
      from public.cex_fills f
     where f.intent_id = p_intent_id
       and (f.external_order_id is not distinct from p_external_order_id
            or f.external_order_id is null)
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
  -- ⚠️ SINTÉTICO NÃO ATRIBUÍDO (brecha do verificador, round 4): o sintético
  -- gravado com external_order_id NULL (ACK sem id) é do MESMO INTENT e tem
  -- de entrar na base — sem isso, ACK sem id → sintético NULL 5/0.05 →
  -- snapshot com o id descoberto ORD-1 5/0.05 via v_fee_ja = 0 e inseria um
  -- ajuste zero-qty de 0.05, fechando fee_total 0.10 (esperado 0.05). O
  -- predicado é o mesmo do achado 2 da cex_ingest_trades: `is not distinct
  -- from` OU null; fills com external_order_id de OUTRA ordem seguem fora.
  select coalesce(sum(f.fee),0) into v_fee_ja
    from public.cex_fills f
   where f.intent_id = p_intent_id
     and (f.external_order_id is not distinct from p_external_order_id
          or f.external_order_id is null)
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
      on conflict (intent_id, dedupe_key) do nothing;
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
  on conflict (intent_id, dedupe_key) do nothing;

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
-- ⚠️ A121: a cobertura é provada SÓ PELOS NOVOS TRADES ÚNICOS do lote
-- (`v_novos >= v_sint`). O real existente é ANTERIOR ao sintético e nunca
-- cobre o que veio depois dele — somá-lo permitia apagar um sintético
-- criado depois do real sem nenhum trade novo (real 5, snapshot 8 → sint 3,
-- lote só dedupado → 5 ≥ 3 apagava os 3 e o total caía de 8 para 5).
--
-- ⚠️ E a FEE também é coberta: sintético com fee conhecida exige fee
-- explícita na MESMA moeda nos trades novos — fee null é
-- 'cobertura_fee_incompleta', moeda divergente é 'fee_currency_incompativel'
-- (os dois ADIADOS, como 'cobertura_incompleta'); fee menor mas explícita e
-- completa substitui — o real é fato.
--
-- ⚠️ ROUND 4 (revisão): o gate de fee dispara pela EXISTÊNCIA do sintético
-- com fee, mesmo com v_sint = 0 (ajuste de fee de qty zero é fato — sem
-- evidência substituta explícita, NADA é deletado); sintéticos NÃO
-- ATRIBUÍDOS (external_order_id NULL, ACK sem id) entram em v_sint e no
-- delete; e itens do lote que declaram OUTRA ordem são ignorados (a RPC não
-- confia no caller). Detalhes no cabeçalho, item 4.
--
-- ⚠️ TODOS OS TRADES DA ORDEM DE UMA VEZ, e não um por chamada: a substituição
-- (delete + insert) continua na MESMA transação quando a cobertura fecha, e
-- qualquer validação que falha retorna ANTES de tocar o livro (atomicidade).
--
-- ⚠️ A122 (round 5): antes de qualquer coverage, trade sem id é recusado
-- ('trade_sem_id'), cópias IDÊNTICAS do mesmo trade_id no lote contam UMA vez
-- e cópias DIVERGENTES são fail-closed ('trade_id_conflitante') — o lote
-- normalizado é a única base de N, da cobertura de fee e do insert.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cex_ingest_trades(
  p_intent_id uuid,
  p_external_order_id text,
  p_trades jsonb            -- [{trade_id, qty, price, quote, fee, fee_currency, executed_at}]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_t jsonb; v_inseridos integer := 0;
  v_sint numeric; v_novos numeric; v_qtd_novos integer;
  v_lote jsonb; v_sem_id boolean;
begin
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then raise exception 'intent % nao existe', p_intent_id; end if;

  -- ⚠️ FILL CONTRA INTENT PRÉ-ENVIO É CONTRADIÇÃO, não dado. Quem chama tem de
  -- levar o intent a RECONCILIATION_REQUIRED e olhar — nunca gravar por cima.
  if v_intent.state in ('CREATED','AUTHORIZED','RESERVED','FAILED_PRE_SUBMIT') then
    raise exception 'fill contra intent em % — estado pre-envio nao admite execucao', v_intent.state;
  end if;

  -- A122 (round 5), passo 1 — TRADE SEM ID, sobre o LOTE BRUTO e ANTES de
  -- qualquer coverage: id ausente é dado corrompido mesmo num item que o
  -- filtro de ordem ignoraria, e decidir cobertura sobre um lote assim seria
  -- provar com fato sem identidade. Zero delete/insert. A leitura bruta de
  -- p_trades acontece UMA vez, nesta varredura que já produz o lote filtrado
  -- (ordem lógica: valida ids → filtra; a recusa sai antes de v_lote ser
  -- usado para qualquer coisa).
  --
  -- DEFESA EM PROFUNDIDADE (A121 round 4, achado d): itens do lote que
  -- declaram OUTRA ordem (`t->>'order'` não nulo e diferente de
  -- p_external_order_id) são IGNORADOS — não inseridos, não contam em
  -- v_novos: pertencem a outra ingestão, e sem este filtro cobririam o
  -- sintético DESTA ordem e seriam carimbados com o external_order_id errado.
  -- O caller já filtra; a RPC não confia. Item sem `order` segue: o caller
  -- nem sempre conhece o id da ordem de cada trade.
  select coalesce(jsonb_agg(u.t order by u.ord)
                  filter (where u.t->>'order' is null or u.t->>'order' = p_external_order_id),
                  '[]'::jsonb),
         coalesce(bool_or(nullif(u.t->>'trade_id','') is null), false)
    into v_lote, v_sem_id
    from jsonb_array_elements(coalesce(p_trades,'[]'::jsonb)) with ordinality as u(t, ord);
  if v_sem_id then
    return jsonb_build_object('ok', false, 'porque', 'trade_sem_id');
  end if;

  -- A122 (round 5), passo 2 — DEDUPE INTRA-LOTE por trade_id. O NOT EXISTS da
  -- cobertura só enxerga fills PERSISTIDOS: duas cópias do mesmo trade_id no
  -- mesmo lote somavam 2× em v_novos e entravam 1× (colisão na dedupe key),
  -- enganando a cobertura — real 5, sintético 3, lote [T9 1.5, T9 1.5]
  -- derrubava o livro de 8 para 6.5.
  --
  -- PAYLOAD DIVERGENTE É CONTRADIÇÃO, fail-closed: mesmo trade_id com
  -- qualquer campo financeiro divergente → zero mudança, livro byte-a-byte
  -- intacto — nunca escolher uma versão. Comparação NUMÉRICA via
  -- `is distinct from` (1.5 ≡ 1.50), com `nullif(...,'')` em fee/fee_currency/
  -- executed_at — a mesma política do R4 ("" é ausência, null ≠ 0). O `order`
  -- compara NORMALIZADO: item sem `order` vale p_external_order_id (é o que o
  -- insert gravaria), então null explícito e ausência são a mesma ordem.
  if exists (
    select 1
      from jsonb_array_elements(v_lote) a
      join jsonb_array_elements(v_lote) b
        on a->>'trade_id' = b->>'trade_id'
     where (a->>'qty')::numeric   is distinct from (b->>'qty')::numeric
        or (a->>'price')::numeric is distinct from (b->>'price')::numeric
        or (a->>'quote')::numeric is distinct from (b->>'quote')::numeric
        or nullif(a->>'fee','')::numeric
           is distinct from nullif(b->>'fee','')::numeric
        or nullif(a->>'fee_currency','')
           is distinct from nullif(b->>'fee_currency','')
        or coalesce(nullif(a->>'order',''), p_external_order_id)
           is distinct from coalesce(nullif(b->>'order',''), p_external_order_id)
        or nullif(a->>'executed_at','')
           is distinct from nullif(b->>'executed_at','')) then
    return jsonb_build_object('ok', false, 'porque', 'trade_id_conflitante');
  end if;

  -- PAYLOAD IDÊNTICO CONTA UMA VEZ: o lote normalizado tem UM item por
  -- trade_id (a primeira ocorrência, ordem do lote preservada). Cobertura de
  -- qty, cobertura de fee e insert trabalham SEMPRE sobre ele.
  select coalesce(jsonb_agg(d.t order by d.ord), '[]'::jsonb) into v_lote
    from (select distinct on (e.t->>'trade_id') e.t as t, e.ord as ord
            from jsonb_array_elements(v_lote) with ordinality as e(t, ord)
           order by e.t->>'trade_id', e.ord) d;

  -- Cobertura de QUANTIDADE (A121): só os NOVOS trades únicos do lote
  -- provam o que veio DEPOIS do sintético. O real já existente é anterior a
  -- ele e não entra na conta — somas sempre por (intent_id, ordem,
  -- exchange_id) e uma ordem nunca cobre outra.
  -- ⚠️ O LOTE AQUI JÁ É O NORMALIZADO (A122): um item por trade_id, payload
  -- idêntico colapsado — duplicata intra-lote não infla v_novos.
  -- ⚠️ DEDUPE POR INTENT (A123): "já persistido" é NESTE intent — outro
  -- intent com o mesmo trade_id tem fill próprio e legítimo. A COBERTURA
  -- segue por ordem (acima); o dedupe é por intent — propriedades distintas.
  -- ⚠️ SINTÉTICO NÃO ATRIBUÍDO (A121 round 4, achado b): o sintético gravado
  -- com external_order_id NULL (ACK sem id) é do MESMO INTENT e entra em
  -- v_sint e no delete — os trades que chegam com o id descoberto SÃO a
  -- atribuição; sem isso o sintético null (5) + o real (5) double-countavam
  -- (filled 10 sobre pedido 8). Sintético com external_order_id de OUTRA
  -- ordem continua fora: ordem A nunca cobre B.
  select coalesce(sum(qty),0) into v_sint from public.cex_fills
   where intent_id = p_intent_id and sintetico
     and (external_order_id is not distinct from p_external_order_id
          or external_order_id is null)
     and exchange_id = v_intent.exchange_id;

  select coalesce(sum((t->>'qty')::numeric),0), count(*) into v_novos, v_qtd_novos
    from jsonb_array_elements(v_lote) t
   where not exists (select 1 from public.cex_fills f
          where f.intent_id = p_intent_id
            and f.dedupe_key = 'trade:' || (t->>'trade_id'));

  if v_sint > 0 and v_novos < v_sint - 1e-12 then
    return jsonb_build_object('ok', false, 'porque', 'cobertura_incompleta',
                              'novos', v_novos, 'sintetico', v_sint);
  end if;

  -- Cobertura de FEE (A121): sintético com fee CONHECIDA é um fato que a
  -- substituição não pode apagar. Os trades novos precisam trazer a fee
  -- EXPLÍCITA e na MESMA moeda — sem conversão inventada, sem null=0, sem
  -- somar moedas. Fee MENOR mas explícita e completa substitui (o real é
  -- fato). Sintético sem fee: trades sem fee não destroem nada, procede.
  -- Qualquer falha aqui retorna ANTES do delete/insert: livro intacto.
  --
  -- ⚠️ O GATE DISPARA PELA EXISTÊNCIA DO SINTÉTICO COM FEE, INDEPENDENTE de
  -- v_sint > 0 (A121 round 4, achado a): um ajuste de fee de QTY ZERO é um
  -- fato tanto quanto um fill com qty, e um lote todo dedupado (v_novos = 0)
  -- não é evidência substituta — sem esta guarda o delete apagava o ajuste e
  -- o fee_total regredia (0.07 → 0.05) sem nenhum trade novo. A correção de
  -- fee é PRESERVADA ATÉ EVIDÊNCIA SUBSTITUTA EXPLÍCITA: sem trades novos
  -- únicos, ou com algum sem fee explícita na mesma moeda, NADA é deletado
  -- nem inserido. Quando os trades novos cobrem (todos com fee explícita,
  -- mesma moeda), a substituição libera o delete dos sintéticos incluindo os
  -- ajustes zero-qty — o real é fato.
  if exists (select 1 from public.cex_fills f
         where f.intent_id = p_intent_id and f.sintetico
           and (f.external_order_id is not distinct from p_external_order_id
                or f.external_order_id is null)
           and f.exchange_id = v_intent.exchange_id
           and f.fee is not null) then
    if v_qtd_novos = 0 or exists (
        select 1 from jsonb_array_elements(v_lote) t
         where not exists (select 1 from public.cex_fills f
                where f.intent_id = p_intent_id
                  and f.dedupe_key = 'trade:' || (t->>'trade_id'))
           and nullif(t->>'fee','') is null) then
      return jsonb_build_object('ok', false, 'porque', 'cobertura_fee_incompleta',
                                'novos', v_novos, 'sintetico', v_sint);
    end if;
    if exists (
        with novos as (
          select nullif(t->>'fee_currency','') as moeda
            from jsonb_array_elements(v_lote) t
           where not exists (select 1 from public.cex_fills f
                  where f.intent_id = p_intent_id
                    and f.dedupe_key = 'trade:' || (t->>'trade_id'))
        ), moedas_sint as (
          select distinct f.fee_currency as moeda from public.cex_fills f
           where f.intent_id = p_intent_id and f.sintetico
             and (f.external_order_id is not distinct from p_external_order_id
                  or f.external_order_id is null)
             and f.exchange_id = v_intent.exchange_id
             and f.fee is not null
        )
        select 1 from novos n
         where not exists (select 1 from moedas_sint m
                where m.moeda is not distinct from n.moeda)) then
      return jsonb_build_object('ok', false, 'porque', 'fee_currency_incompativel',
                                'novos', v_novos, 'sintetico', v_sint);
    end if;
  end if;

  -- O sintético é estimativa; o trade é fato. O fato substitui. Entram no
  -- delete os sintéticos desta ordem E os não atribuídos (external_order_id
  -- NULL do mesmo intent — achado b); os de OUTRA ordem jamais.
  delete from public.cex_fills
   where intent_id = p_intent_id and sintetico
     and (external_order_id is not distinct from p_external_order_id
          or external_order_id is null);

  for v_t in select * from jsonb_array_elements(v_lote) loop
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
    on conflict (intent_id, dedupe_key) do nothing;
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
