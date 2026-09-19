-- ═══════════════════════════════════════════════════════════════════════════
-- 0064 — A PROJEÇÃO IDEMPOTENTE DO EFEITO DE UM INTENT NA POSIÇÃO (A131-C)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️⚠️ POR QUE O ESQUEMA ATUAL NÃO BASTAVA.
--
-- `autopilot_positions` tem `unique (session_id, base)`. Isso garante UMA
-- linha por par sessão/moeda — e não diz nada sobre QUAIS execuções já estão
-- dobradas dentro dela. A pergunta que a reconciliação precisa responder é
-- outra:
--
--     "quanto DESTE intent já foi aplicado nesta posição?"
--
-- Sem essa resposta, reconciliar o mesmo intent duas vezes soma a mesma compra
-- duas vezes, e um preenchimento que cresce de 0,010 para 0,015 aplica 0,015
-- em cima dos 0,010 que já estavam lá. `cex_fills` é deduplicado por
-- `(exchange_id, dedupe_key)` — isso protege o LIVRO de execuções, não a
-- PROJEÇÃO dele na posição. São dois fatos diferentes, e o segundo não tinha
-- onde morar.
--
-- ⚠️ E NÃO PODE SER MEMÓRIA DE PROCESSO. Recovery acontece depois de restart,
-- em outra invocação serverless, em outro deployment. Um `Set` em memória ou
-- "já rodei nesta função" é exatamente o que não sobrevive ao caso que a
-- reconciliação existe para atender.
--
-- ⚠️ MIGRATION CRIADA E NUNCA APLICADA (Round 9, §24). Nenhuma das anteriores
-- foi tocada para encaixá-la.

-- ── 1. O MARCADOR ─────────────────────────────────────────────────────────
--
-- Uma linha por intent. `applied_*` é CUMULATIVO: o quanto daquele intent já
-- está dentro da posição. O delta a aplicar é sempre `ledger − applied`.
create table if not exists public.autopilot_position_effects (
  intent_id     uuid primary key
                  references public.cex_execution_intents(id) on delete restrict,
  session_id    uuid        not null
                  references public.autopilot_sessions(id) on delete cascade,
  exchange_id   text        not null,
  base          text        not null,
  side          text        not null check (side in ('buy','sell')),

  -- ⚠️ NUNCA DECRESCEM. O que já entrou na posição, venha da projeção pelo
  -- livro ou da absorção da liquidação da saída armada.
  applied_qty   numeric     not null default 0 check (applied_qty   >= 0),
  applied_quote numeric     not null default 0 check (applied_quote >= 0),

  -- ⚠️⚠️ E ESTES SÃO OUTRA COISA: o que o LIVRO dizia na última projeção.
  --
  -- Sem separá-los, a absorção (que adianta `applied` sem o livro ter
  -- ingerido o fill) viraria "regressão" na chamada seguinte: `filled_qty`
  -- legitimamente menor que `applied_qty`. A regressão que importa — livro
  -- ENCOLHENDO — só pode ser medida contra o próprio livro.
  ledger_qty    numeric     not null default 0 check (ledger_qty    >= 0),
  ledger_quote  numeric     not null default 0 check (ledger_quote  >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_autopilot_effects_por_posicao
  on public.autopilot_position_effects (session_id, base);

comment on table public.autopilot_position_effects is
  'A131-C: quanto de cada intent ja foi projetado em autopilot_positions. '
  'Marcador durable de exactly-once; o delta e sempre ledger - applied.';

-- ⚠️ RLS LIGADA, ZERO POLICIES — o padrão desta casa. Só o cliente
-- service-role (que passa por cima de RLS) enxerga a tabela.
alter table public.autopilot_position_effects enable row level security;

-- ── 2. POSIÇÕES LEGADAS (§38) ─────────────────────────────────────────────
--
-- ⚠️ NENHUM BACKFILL. Marcar intents antigos como "já aplicados" sem prova
-- seria inventar história: não existe registro de quais fills entraram nas
-- posições que já estão lá. As posições existentes continuam valendo como
-- ESTADO DE ABERTURA, e o marcador só descreve o que a projeção fez a partir
-- daqui. A consequência declarada: um intent antigo, ainda não terminal, que
-- for reconciliado depois desta migration aplica o preenchimento dele sobre a
-- posição atual — o que é o comportamento correto para um fill que ninguém
-- tinha projetado, e não dá para distinguir do caso já contado sem inventar
-- dado. Por isso a projeção nasce junto com a leitura do livro (Round 9) e
-- não é retroativa.

-- ── 3. A PROJEÇÃO ─────────────────────────────────────────────────────────
create or replace function public.autopilot_projetar_efeito_do_intent(
  p_intent_id         uuid,
  -- ⚠️⚠️ SÓ PARA A LIQUIDAÇÃO DA SAÍDA ARMADA. `settleArmedExits` aplica a
  -- redução direto a partir da ordem lida na corretora, ANTES de o livro de
  -- fills ter ingerido aquele preenchimento. Sem registrar isso aqui, a
  -- reconciliação seguinte veria `applied = 0` e reduziria a MESMA venda de
  -- novo. Estes parâmetros ABSORVEM o que já foi aplicado — eles nunca
  -- movem a posição, só impedem a segunda aplicação.
  p_qty_ja_aplicada   numeric default null,
  p_quote_ja_aplicada numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i             record;
  v_e             record;
  v_pos           record;
  v_base          text;
  v_delta_qty     numeric;
  v_delta_quote   numeric;
  v_restante      numeric;
  v_custo_restante numeric;
  v_custo_removido numeric;
  v_fechou        boolean := false;
  v_eps  constant numeric := 1e-12;
  -- Ruído relativo de ponto flutuante ao vender "tudo": 0,1 − 0,1 pode deixar
  -- 1e-17. Mesma convenção de `oQueSobrou` em venda-limitada.ts.
  v_ruido constant numeric := 1e-9;
begin
  -- ⚠️⚠️ TUDO NUMA TRANSAÇÃO, COM LOCK. Duas reconciliações simultâneas do
  -- MESMO intent não podem calcular o mesmo delta: a segunda espera o lock do
  -- intent, relê o marcador já atualizado e encontra delta zero.
  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente');
  end if;

  -- ── ORIGEM (§31): patrimônio manual não vira posse do bot ───────────────
  if v_i.simulated then
    return jsonb_build_object('ok', false, 'motivo', 'simulado');
  end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma',
                              'origin', v_i.origin);
  end if;
  if v_i.session_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;

  -- ⚠️ `BTC-USDT` E `BTC/USDT` SÃO O MESMO ATIVO. A rota aceita os dois
  -- separadores (`split(/[\/\-]/)`), e derivar a base só por `/` criaria uma
  -- linha `base = 'BTC-USDT'` que a checagem de posse nunca encontraria: o bot
  -- ficaria com uma bolsa que não consegue vender, e duas linhas para o mesmo
  -- ativo somando na exposição.
  v_base := upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1));

  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side)
  values
    (p_intent_id, v_i.session_id, v_i.exchange_id, v_base, v_i.side)
  on conflict (intent_id) do nothing;

  select * into v_e from public.autopilot_position_effects
   where intent_id = p_intent_id for update;

  -- Absorção do que a liquidação já aplicou direto (ver o comentário do
  -- parâmetro). Não toca na posição — só no marcador.
  if p_qty_ja_aplicada is not null and p_qty_ja_aplicada > v_e.applied_qty then
    update public.autopilot_position_effects
       set applied_qty   = p_qty_ja_aplicada,
           applied_quote = greatest(applied_quote, coalesce(p_quote_ja_aplicada, 0)),
           updated_at    = now()
     where intent_id = p_intent_id;
    select * into v_e from public.autopilot_position_effects
     where intent_id = p_intent_id;
  end if;

  -- ── REGRESSÃO (§28): fail-closed, sem corromper a posição ──────────────
  -- ⚠️ CONTRA `ledger_qty`, não contra `applied_qty`: a absorção adianta o
  -- segundo de propósito, e compará-la com o livro acusaria regressão onde há
  -- apenas uma liquidação que chegou antes da ingestão dos fills.
  if v_i.filled_qty < v_e.ledger_qty - v_eps then
    return jsonb_build_object('ok', false, 'motivo', 'regressao',
      'aplicado', v_e.ledger_qty, 'no_livro', v_i.filled_qty);
  end if;

  -- ⚠️ O DELTA É CONTRA `applied`: o que já está DENTRO da posição, tenha
  -- entrado pela projeção ou pela liquidação.
  v_delta_qty   := greatest(v_i.filled_qty   - v_e.applied_qty,   0);
  v_delta_quote := greatest(v_i.filled_quote - v_e.applied_quote, 0);

  if v_delta_qty <= v_eps then
    -- ⚠️ O LIVRO AVANÇOU SEM DELTA? Ainda assim é o novo piso da regressão.
    update public.autopilot_position_effects
       set ledger_qty   = greatest(ledger_qty,   v_i.filled_qty),
           ledger_quote = greatest(ledger_quote, v_i.filled_quote),
           updated_at   = now()
     where intent_id = p_intent_id;
    return jsonb_build_object('ok', true, 'motivo', 'sem_delta',
      'aplicado_qty', 0, 'aplicado_quote', 0, 'fechou', false);
  end if;

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;

  if v_i.side = 'buy' then
    if found then
      /**
       * ⚠️⚠️ A COMPRA NÃO MEXE NO `status` NEM EM `exit_order_id` — achado da
       * revisão adversarial.
       *
       * A primeira versão punha `status = 'open'` ("uma compra nova reabre"),
       * e deixava `exit_order_id`/`exit_armed_at` apontando para uma ordem de
       * VENDA que continua viva na corretora. `settleArmedExits` filtra por
       * `status = 'exit_armed'`: a ordem virava órfã, ninguém a liquidava, e o
       * P&L dela nunca seria realizado.
       *
       * A saída armada cobre a quantidade que ela cobria; a nova entra por
       * cima e o resto continua sendo liquidado por quem já o acompanha.
       */
      update public.autopilot_positions
         set base_amount = base_amount + v_delta_qty,
             cost_usd    = cost_usd + v_delta_quote,
             entry_price = case when (base_amount + v_delta_qty) > 0
                                then (cost_usd + v_delta_quote) / (base_amount + v_delta_qty)
                                else entry_price end,
             updated_at  = now()
       where id = v_pos.id;
    else
      insert into public.autopilot_positions
        (session_id, wallet_address, exchange_id, base, pair,
         entry_price, base_amount, cost_usd, status, entry_ts, updated_at)
      values
        (v_i.session_id, coalesce(v_i.wallet_address, ''), v_i.exchange_id, v_base,
         upper(v_i.symbol),
         case when v_delta_qty > 0 then v_delta_quote / v_delta_qty else 0 end,
         v_delta_qty, v_delta_quote, 'open', now(), now());
    end if;
    v_custo_removido := 0;
  else
    -- ── VENDA ──────────────────────────────────────────────────────────
    if not found then
      -- ⚠️ Não se inventa posição negativa nem se marca como aplicado: sem
      -- posição, esta venda não descreve inventário do bot. Fail-closed
      -- VISÍVEL — quem chama registra e um humano olha.
      return jsonb_build_object('ok', false, 'motivo', 'sem_posicao',
        'base', v_base, 'delta_qty', v_delta_qty);
    end if;
    /**
     * ⚠️⚠️⚠️ SAÍDA ARMADA PERTENCE À LIQUIDAÇÃO — achado da revisão adversarial.
     *
     * `settleArmedExits` é o ÚNICO lugar do produto que realiza P&L de uma
     * saída limitada: ele lê a ordem na corretora, chama `realizedFromSell`
     * contra a posição AINDA INTEIRA e alimenta `apply_session_pnl` (que puxa
     * o stop de perda diária). Se a projeção reduzir ou apagar a posição
     * antes, a liquidação não a encontra mais — e o prejuízo do dia
     * simplesmente não é contado. O dono descobre pelo extrato.
     *
     * ⚠️ E O PARCIAL ERA PIOR. A versão anterior limpava `status`/
     * `exit_order_id` em TODA venda projetada, inclusive num
     * `PARTIALLY_FILLED` cuja ordem continua trabalhando o restante: a passada
     * seguinte via a posição `open` e armava uma SEGUNDA venda da mesma bolsa,
     * com a primeira viva. É exatamente o desfecho que `markServerExitArmed`
     * teme por escrito.
     *
     * Enquanto houver saída armada, a projeção NÃO TOCA na posição. A
     * liquidação aplica a redução e ABSORVE o valor aqui — e o marcador
     * continua sendo a prova de exactly-once.
     */
    if v_pos.status = 'exit_armed' and v_pos.exit_order_id is not null then
      return jsonb_build_object('ok', true, 'motivo', 'saida_em_liquidacao',
        'aplicado_qty', 0, 'aplicado_quote', 0, 'fechou', false,
        'base', v_base, 'ordem_armada', v_pos.exit_order_id);
    end if;
    v_restante := v_pos.base_amount - v_delta_qty;
    if v_restante <= v_pos.base_amount * v_ruido then
      -- Saída total: a mesma semântica de `closeServerPosition` (a linha sai).
      v_custo_removido := v_pos.cost_usd;
      v_fechou := true;
      delete from public.autopilot_positions where id = v_pos.id;
    else
      -- ⚠️ CUSTO SAI EM PROPORÇÃO — a mesma convenção de `oQueSobrou`, para o
      -- P&L realizado e o custo que fica não contarem a mesma moeda duas vezes.
      v_custo_restante := v_pos.cost_usd * (v_restante / v_pos.base_amount);
      v_custo_removido := v_pos.cost_usd - v_custo_restante;
      /**
       * ⚠️ O PARCIAL NÃO DESARMA NADA. Só a quantidade e o custo mudam. Quem
       * chegou aqui com posição armada já voltou lá em cima; e limpar o elo
       * com uma ordem que pode estar viva é como nasce a segunda venda da
       * mesma bolsa.
       */
      update public.autopilot_positions
         set base_amount   = v_restante,
             cost_usd      = v_custo_restante,
             updated_at    = now()
       where id = v_pos.id;
    end if;
  end if;

  update public.autopilot_position_effects
     set applied_qty   = greatest(applied_qty,  v_i.filled_qty),
         applied_quote = greatest(applied_quote, v_i.filled_quote),
         ledger_qty    = greatest(ledger_qty,    v_i.filled_qty),
         ledger_quote  = greatest(ledger_quote,  v_i.filled_quote),
         updated_at    = now()
   where intent_id = p_intent_id;

  return jsonb_build_object(
    'ok', true, 'motivo', 'aplicado',
    'side', v_i.side, 'base', v_base,
    'aplicado_qty', v_delta_qty, 'aplicado_quote', v_delta_quote,
    'custo_removido', coalesce(v_custo_removido, 0), 'fechou', v_fechou);
end; $$;

comment on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, numeric) is
  'A131-C: projeta em autopilot_positions o efeito AINDA NAO APLICADO de um '
  'intent autonomo, numa transacao, por delta cumulativo (ledger - applied). '
  'Idempotente por intent; regressao e venda sem posicao falham FECHADO.';

-- ── 4. AS PENDÊNCIAS — PORQUE `FILLED` É TERMINAL ─────────────────────────
--
-- ⚠️⚠️⚠️ ACHADO DA REVISÃO ADVERSARIAL DO ROUND 9.
--
-- A projeção pode falhar no momento em que o dinheiro se move: banco fora,
-- timeout, RPC ainda não aplicada. O comentário da rota prometia que "a
-- reconciliação chama a MESMA RPC e aplica o delta que faltar" — e isso era
-- FALSO para o caso mais comum: uma compra a mercado que preenche na hora vira
-- `FILLED`, que é TERMINAL. `intentsParaReconciliar` só olha os NÃO-terminais.
-- Ninguém voltava naquele intent. O bot comprava e nunca saberia que possui.
--
-- Esta função é a varredura que faltava: intents autônomos com execução no
-- livro cuja projeção está atrasada (marcador ausente, ou `applied` abaixo do
-- `filled_qty`). O cron chama, projeta cada um, e a idempotência do marcador
-- garante que repetir não some nada.
--
-- ⚠️ JANELA CURTA DE PROPÓSITO: três dias. Mais que isso não é pendência de
-- projeção, é inventário para conferir com mão humana — e varrer o histórico
-- inteiro a cada 5 minutos seria um `seq scan` no caminho do dinheiro.
create or replace function public.autopilot_projecoes_pendentes(p_limite int default 50)
returns table (intent_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id
    from public.cex_execution_intents i
    left join public.autopilot_position_effects e on e.intent_id = i.id
   where i.simulated = false
     and i.autonomous = true
     and i.origin in ('autopilot_browser', 'autopilot_cron')
     and i.session_id is not null
     and i.filled_qty > 0
     and i.updated_at > now() - interval '3 days'
     and (e.intent_id is null or i.filled_qty > e.applied_qty + 1e-12)
   order by i.updated_at asc
   limit greatest(coalesce(p_limite, 50), 0);
$$;

comment on function public.autopilot_projecoes_pendentes(int) is
  'A131-C: intents autonomos com execucao no livro e projecao atrasada. '
  'Existe porque FILLED e terminal e o recuperador de intents nao volta nele.';

-- ── 5. ACL — NASCE FECHADA (lição A116) ───────────────────────────────────
revoke all on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, numeric)
  to service_role;

revoke all on function public.autopilot_projecoes_pendentes(int)
  from public, anon, authenticated;
grant execute on function public.autopilot_projecoes_pendentes(int)
  to service_role;

-- ⚠️ A TABELA TAMBÉM: RLS ligada sem policies já fecha para anon/authenticated,
-- mas o GRANT de tabela é outra porta. Ela nasce sem nenhum.
revoke all on table public.autopilot_position_effects from public, anon, authenticated;
grant select, insert, update on table public.autopilot_position_effects to service_role;
