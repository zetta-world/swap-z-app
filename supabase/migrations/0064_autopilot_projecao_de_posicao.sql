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

  -- ⚠️⚠️ A RESERVA MORA AQUI, E NÃO NUM CONTADOR AGREGADO — achado A137.
  --
  -- A primeira versão somava `reservado_qty` na POSIÇÃO e
  -- `exposicao_reservada_usd` na SESSÃO, com prazo de validade. Duas coisas
  -- erradas de uma vez:
  --
  --   · o prazo esquecia ordem VIVA. Uma limitada aceita sem preencher, dez
  --     minutos depois, liberava o compromisso — a segunda entrada passava, e
  --     as duas preenchiam: teto de 200 fechando em 210;
  --   · sem dono, a projeção de uma ordem antiga subtraía do agregado e podia
  --     consumir a reserva de OUTRA ordem mais nova.
  --
  -- Agora a reserva tem dono: o intent. O compromisso vivo de um intent é
  -- `greatest(reservado − applied, 0)` enquanto ele puder preencher, e ZERO
  -- quando ele está provadamente morto (`CANCELED`/`FAILED_PRE_SUBMIT`).
  -- Não há prazo: o que encerra um compromisso é o estado do intent.
  reservado_qty numeric     not null default 0 check (reservado_qty >= 0),
  reservado_usd numeric     not null default 0 check (reservado_usd >= 0),

  -- ⚠️⚠️ E O P&L TAMBÉM PRECISA DE EXACTLY-ONCE — achado A138.
  --
  -- A posição tinha marcador e o resultado não: o P&L era gravado numa
  -- chamada separada. Gravando o P&L e falhando a posição, a passada seguinte
  -- somava o MESMO resultado de novo; falhando o P&L e gravando a posição, o
  -- débito sumia sem ninguém para retentá-lo. Este campo é o quanto DESTE
  -- intent já entrou no `pnl_today` da sessão.
  pnl_aplicado_usd numeric  not null default 0,

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
  -- ⚠️ A138: a taxa em USD e o dia UTC entram porque o P&L realizado é
  -- aplicado NESTA transação. A conversão da taxa continua sendo a de sempre
  -- (`taxaEmUsd`), feita por quem chama; o que muda é que o débito na sessão
  -- deixou de ser uma segunda escrita.
  p_taxa_usd          numeric default 0,
  p_hoje              text default null
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
  v_realizado     numeric := 0;
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

  /**
   * ⚠️⚠️ A ABSORÇÃO SAIU DAQUI (A136/A139).
   *
   * Havia dois parâmetros para a liquidação da saída armada registrar o que
   * ela tinha aplicado direto. Eles existiam porque a liquidação escrevia a
   * posição por fora; hoje ela tem transação própria
   * (`autopilot_liquidar_saida_armada`), e esta função não precisa acreditar
   * em número nenhum de quem chama: ela lê `filled_qty`/`filled_quote` da
   * linha do intent.
   *
   * ⚠️ E as duas marcas d'água (`applied` × `ledger`) continuam, porque a
   * liquidação ainda pode adiantar `applied` antes de os fills serem
   * ingeridos — só que agora por uma transação que também move a posição.
   */

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

  /**
   * ⚠️⚠️ O P&L REALIZADO ENTRA AQUI, NA MESMA TRANSAÇÃO — achado A138.
   *
   * Ele era uma segunda escrita (`apply_session_pnl`), e por isso não tinha
   * exactly-once: gravando o P&L e falhando a posição, a passada seguinte
   * somava o mesmo resultado; gravando a posição e falhando o P&L, o débito
   * sumia sem ninguém para retentá-lo. `pnl_aplicado_usd` é o quanto DESTE
   * intent já entrou no `pnl_today`, e só o delta é aplicado.
   *
   * ⚠️ A conta é a de sempre: recebido − custo removido − taxa. Nenhum modelo
   * contábil novo.
   */
  if v_i.side = 'sell' and v_delta_quote > 0 then
    v_realizado := v_delta_quote - coalesce(v_custo_removido, 0) - coalesce(p_taxa_usd, 0);
    if v_realizado <> 0 then
      update public.autopilot_sessions
         set pnl_today        = pnl_today + v_realizado,
             frozen_until_day = case
               when (pnl_today + v_realizado) <= -daily_loss_stop_usd
                 then coalesce(p_hoje, frozen_until_day)
               else frozen_until_day end,
             updated_at       = now()
       where id = v_i.session_id;
    end if;
  end if;

  -- ⚠️ A RESERVA NÃO PRECISA SER "SOLTA": o compromisso vivo é
  -- `greatest(reservado − applied, 0)`, e `applied` acabou de crescer. Era o
  -- contador agregado que exigia uma subtração — e era ela que podia comer a
  -- reserva de outro intent (A137).
  update public.autopilot_position_effects
     set applied_qty      = greatest(applied_qty,  v_i.filled_qty),
         applied_quote    = greatest(applied_quote, v_i.filled_quote),
         ledger_qty       = greatest(ledger_qty,    v_i.filled_qty),
         ledger_quote     = greatest(ledger_quote,  v_i.filled_quote),
         pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
         updated_at       = now()
   where intent_id = p_intent_id;

  return jsonb_build_object(
    'ok', true, 'motivo', 'aplicado',
    'side', v_i.side, 'base', v_base,
    'aplicado_qty', v_delta_qty, 'aplicado_quote', v_delta_quote,
    'custo_removido', coalesce(v_custo_removido, 0), 'fechou', v_fechou,
    'pnl_realizado', v_realizado);
end; $$;

comment on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, text) is
  'A131-C: projeta em autopilot_positions o efeito AINDA NAO APLICADO de um '
  'intent autonomo, numa transacao, por delta cumulativo (ledger - applied). '
  'Idempotente por intent; regressao e venda sem posicao falham FECHADO.';

-- ── 3-BIS. AS RESERVAS DE INVENTÁRIO (A134 / A135) ────────────────────────
--
-- ⚠️⚠️⚠️ CONFERIR NÃO É RESERVAR.
--
-- A posse e a exposição eram lidas, conferidas, e só depois a ordem saía —
-- READ-THEN-ACT puro. Duas requisições simultâneas leem o MESMO estado e as
-- duas passam:
--
--     posição do bot = 0,01 · duas vendas de 0,01 → saem 0,02, e 0,01 é do dono
--     exposição 190, teto 200 · duas compras de 10 → 210 > 200
--
-- O teto DIÁRIO já era atômico (compare-and-swap, A132), e isso não substitui
-- nada: havendo duas vagas no dia, as duas ordens passam pelo contador e se
-- atropelam no inventário. São perguntas diferentes.
--
-- A reserva mora onde o dado mora, e é tomada DENTRO da transação que a
-- confere — `for update` na linha, escrita no mesmo comando. Lock em memória
-- não serve: cada invocação serverless é outro processo.
-- ⚠️⚠️⚠️ A SAÍDA ARMADA PRECISA DE IDENTIDADE HISTÓRICA — achado A139.
--
-- A posição guardava só `exit_order_id`, e a liquidação redescobria o intent
-- por `(exchange_id, external_order_id)`. Dois problemas:
--
--   · `external_order_id` NÃO é identificador global da exchange — duas contas
--     da mesma corretora podem trazer o mesmo número, e a busca atribuiria a
--     ordem de uma à posição da outra;
--   · a liquidação consultava a venue com a credencial ATUAL da sessão. Uma
--     sessão rearmada de C1 para C2 iria perguntar a C2 por uma ordem que
--     nasceu em C1 — exatamente o que o A127 existe para impedir.
--
-- O elo passa a ser o intent, que já carrega `conexao_id` histórico.
alter table public.autopilot_positions
  add column if not exists exit_intent_id uuid
    references public.cex_execution_intents(id) on delete set null;

comment on column public.autopilot_positions.exit_intent_id is
  'A139: o intent EXATO da ordem de saida armada. A liquidacao carrega a '
  'credencial por intent.conexao_id (A127), nunca pela sessao atual.';

-- ⚠️⚠️ NÃO EXISTE MAIS PRAZO DE RESERVA, e a ausência é o conserto.
--
-- A versão anterior expirava a reserva em 10 minutos "para não trancar a
-- posição". Só que o que ela trancava não era um fantasma: era uma ordem
-- possivelmente VIVA. Quem encerra um compromisso é o estado do intent —
-- `CANCELED`/`FAILED_PRE_SUBMIT` provam que nada mais sai; `UNKNOWN`,
-- `SUBMITTED` e `PARTIALLY_FILLED` não provam nada e seguram o remanescente.

-- ── 3-BIS-a. O COMPROMISSO VIVO DE UM INTENT (A137) ───────────────────────
--
-- ⚠️ É a peça que substitui o prazo. Enquanto o intent puder preencher, o que
-- ele reservou e ainda não virou posição continua comprometido. Provado morto,
-- o compromisso é zero na mesma hora — sem esperar relógio nenhum.
create or replace function public.autopilot_compromisso_vivo(
  p_reservado numeric, p_aplicado numeric, p_estado text
) returns numeric
language sql immutable as $$
  select case
    when p_estado in ('CANCELED', 'FAILED_PRE_SUBMIT') then 0
    else greatest(coalesce(p_reservado, 0) - coalesce(p_aplicado, 0), 0)
  end
$$;

-- ── 3-BIS-b. RESERVAR QUANTIDADE PARA VENDA AUTÔNOMA (A134/A137) ──────────
--
-- ⚠️ RECEBE O INTENT, não a sessão solta: o executor grava o intent ANTES da
-- costura de reserva, então a reserva nasce com dono. É o que impede a
-- projeção de uma ordem antiga de consumir o compromisso de uma nova.
create or replace function public.autopilot_reservar_venda_do_intent(
  p_intent_id uuid, p_qty numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_i record; v_pos record; v_base text;
  v_comprometido numeric; v_disponivel numeric; v_conceder numeric;
begin
  if p_qty is null or not (p_qty > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'quantidade_invalida');
  end if;
  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); end if;
  if v_i.simulated then return jsonb_build_object('ok', false, 'motivo', 'simulado'); end if;
  if v_i.side <> 'sell' then return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_venda'); end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma');
  end if;
  if v_i.session_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;

  v_base := upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1));

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;
  if not found or v_pos.status = 'closed' or not (v_pos.base_amount > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posicao');
  end if;
  if v_pos.status = 'exit_armed' then
    return jsonb_build_object('ok', false, 'motivo', 'saida_ja_armada',
      'ordem_armada', v_pos.exit_order_id);
  end if;

  -- ⚠️ O QUE OUTROS INTENTS JÁ PROMETERAM. A linha da posição está travada, e
  -- esta soma roda dentro da mesma transação: duas reservas concorrentes se
  -- enfileiram, e a segunda vê a primeira.
  select coalesce(sum(public.autopilot_compromisso_vivo(e.reservado_qty, e.applied_qty, i.state::text)), 0)
    into v_comprometido
    from public.autopilot_position_effects e
    join public.cex_execution_intents i on i.id = e.intent_id
   where e.session_id = v_i.session_id and e.base = v_base and e.side = 'sell'
     and e.intent_id <> p_intent_id;

  v_disponivel := v_pos.base_amount - v_comprometido;
  if v_disponivel <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'quantidade_ja_reservada',
      'na_posicao', v_pos.base_amount, 'comprometido', v_comprometido);
  end if;

  -- ⚠️ LIMITA em vez de recusar (A131): vender só o que é do bot.
  v_conceder := least(p_qty, v_disponivel);

  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side, reservado_qty)
  values (p_intent_id, v_i.session_id, v_i.exchange_id, v_base, 'sell', v_conceder)
  on conflict (intent_id) do update set reservado_qty = excluded.reservado_qty,
                                        updated_at = now();

  return jsonb_build_object('ok', true, 'qtd', v_conceder,
    'limitada', (v_conceder < p_qty), 'na_posicao', v_pos.base_amount);
end; $$;

-- ── 3-BIS-c. RESERVAR CAPITAL PARA ENTRADA AUTÔNOMA (A135/A137) ───────────
create or replace function public.autopilot_reservar_exposicao_do_intent(
  p_intent_id uuid, p_usd numeric, p_teto numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_i record; v_s record; v_comprometido numeric; v_exposicao numeric;
begin
  if p_usd is null or not (p_usd > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'nocional_nao_mensuravel');
  end if;
  if p_teto is null or not (p_teto > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'teto_invalido');
  end if;
  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); end if;
  if v_i.simulated then return jsonb_build_object('ok', false, 'motivo', 'simulado'); end if;
  if v_i.side <> 'buy' then return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_compra'); end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma');
  end if;
  if v_i.session_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;

  -- ⚠️ A LINHA DA SESSÃO É O PONTO DE SERIALIZAÇÃO das entradas concorrentes.
  select * into v_s from public.autopilot_sessions where id = v_i.session_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sessao_inexistente'); end if;

  select coalesce(sum(cost_usd), 0) into v_exposicao
    from public.autopilot_positions
   where session_id = v_i.session_id and status <> 'closed';

  select coalesce(sum(public.autopilot_compromisso_vivo(e.reservado_usd, e.applied_quote, i.state::text)), 0)
    into v_comprometido
    from public.autopilot_position_effects e
    join public.cex_execution_intents i on i.id = e.intent_id
   where e.session_id = v_i.session_id and e.side = 'buy'
     and e.intent_id <> p_intent_id;

  if v_exposicao + v_comprometido + p_usd > p_teto then
    return jsonb_build_object('ok', false, 'motivo', 'teto_estourado',
      'exposicao', v_exposicao, 'comprometido', v_comprometido, 'teto', p_teto);
  end if;

  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side, reservado_usd)
  values (p_intent_id, v_i.session_id, v_i.exchange_id,
          upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1)), 'buy', p_usd)
  on conflict (intent_id) do update set reservado_usd = excluded.reservado_usd,
                                        updated_at = now();

  return jsonb_build_object('ok', true, 'exposicao', v_exposicao,
    'comprometido', v_comprometido + p_usd, 'teto', p_teto);
end; $$;

-- ── 3-BIS-d. DEVOLVER (só na recusa PROVADA) ──────────────────────────────
--
-- ⚠️ ZERA O COMPROMISSO DESTE INTENT, e de nenhum outro — era isso que o
-- contador agregado não sabia fazer.
create or replace function public.autopilot_liberar_reserva_do_intent(
  p_intent_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.autopilot_position_effects
     set reservado_qty = 0, reservado_usd = 0, updated_at = now()
   where intent_id = p_intent_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ── 3-TER. A LIQUIDAÇÃO DA SAÍDA ARMADA, NUMA TRANSAÇÃO (A136) ────────────
--
-- ⚠️⚠️⚠️ ERAM DUAS ESCRITAS, E QUALQUER ORDEM DELAS PERDIA.
--
-- `settleArmedExits` lê a ordem na corretora e aplica a redução direto, porque
-- o P&L realizado é calculado contra a posição AINDA INTEIRA. Ela precisava
-- registrar isso no marcador para a reconciliação não reduzir de novo — e as
-- duas escritas eram separadas:
--
--   marcador OK + posição falha  → marcador diz "aplicado", a posição continua
--                                  cheia, e a reconciliação vê delta zero para
--                                  sempre: a venda nunca entra no livro;
--   posição OK + marcador falha  → a posição já reduziu e o marcador ficou
--                                  atrás: a reconciliação reduz DE NOVO.
--
-- Inverter a ordem só troca qual dos dois cenários acontece. Telemetria alta
-- não conserta exactly-once. Aqui as duas viram uma.
--
-- ⚠️ E ELA PODE TOCAR NUMA POSIÇÃO ARMADA — é a única que pode. A projeção
-- pela reconciliação devolve `saida_em_liquidacao` justamente para deixar esta
-- função ser a dona daquela redução.
create or replace function public.autopilot_liquidar_saida_armada(
  p_intent_id uuid,
  -- ⚠️ O que a CORRETORA disse que saiu. É a única entrada de quantidade que
  -- não vem do livro, e existe porque a liquidação acontece ANTES de os fills
  -- serem ingeridos.
  p_qty_vendida numeric,
  p_quote_recebido numeric,
  -- ⚠️ A138: taxa em USD e dia UTC — o P&L realizado entra NESTA transação.
  p_taxa_usd numeric default 0,
  p_hoje text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i record; v_e record; v_pos record; v_base text;
  v_delta numeric; v_delta_quote numeric; v_realizado numeric := 0;
  v_restante numeric; v_custo_restante numeric; v_custo_removido numeric := 0;
  v_fechou boolean := false;
  v_eps constant numeric := 1e-12;
  v_ruido constant numeric := 1e-9;
begin
  if p_qty_vendida is null or not (p_qty_vendida > 0) then
    return jsonb_build_object('ok', false, 'motivo', 'quantidade_invalida');
  end if;

  select * into v_i from public.cex_execution_intents where id = p_intent_id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'intent_inexistente'); end if;
  if v_i.simulated then return jsonb_build_object('ok', false, 'motivo', 'simulado'); end if;
  if v_i.side <> 'sell' then return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_venda'); end if;
  if v_i.origin not in ('autopilot_browser', 'autopilot_cron') or v_i.autonomous is not true then
    return jsonb_build_object('ok', false, 'motivo', 'origem_nao_autonoma');
  end if;
  if v_i.session_id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sessao'); end if;

  v_base := upper(split_part(replace(v_i.symbol, '-', '/'), '/', 1));

  /**
   * ⚠️ O MARCADOR VEM ANTES DA POSIÇÃO, e a ordem importa: repetir uma
   * liquidação já aplicada é NO-OP, não erro. Depois que ela reduz, a posição
   * deixa de estar armada — conferir o armamento primeiro faria a segunda
   * chamada (uma retentativa legítima) parecer divergência.
   */
  insert into public.autopilot_position_effects
    (intent_id, session_id, exchange_id, base, side)
  values (p_intent_id, v_i.session_id, v_i.exchange_id, v_base, v_i.side)
  on conflict (intent_id) do nothing;
  select * into v_e from public.autopilot_position_effects
   where intent_id = p_intent_id for update;

  v_delta := p_qty_vendida - v_e.applied_qty;
  if v_delta <= v_eps then
    return jsonb_build_object('ok', true, 'motivo', 'sem_delta',
      'aplicado_qty', 0, 'custo_removido', 0, 'fechou', false, 'pnl_realizado', 0);
  end if;
  v_delta_quote := greatest(coalesce(p_quote_recebido, 0) - v_e.applied_quote, 0);

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_posicao', 'base', v_base);
  end if;

  /**
   * ⚠️⚠️⚠️ A IDENTIDADE DA SAÍDA É CONFERIDA AQUI — achado A139.
   *
   * A liquidação redescobria o intent por `(exchange_id, external_order_id)`,
   * e `external_order_id` NÃO é identificador global: duas contas da mesma
   * corretora podem trazer o mesmo número, e a ordem de uma seria atribuída à
   * posição da outra. Agora o elo é o intent gravado ao ARMAR, e cada peça é
   * conferida contra ele. Qualquer divergência: FALHA FECHADA.
   *
   * ⚠️ LEGADO SEM `exit_intent_id` NÃO É ADIVINHADO. Uma posição armada antes
   * desta migration não tem elo — e procurar por número de ordem é exatamente
   * o que o achado proíbe. Ela vira caso de reconciliação humana.
   */
  if v_pos.status <> 'exit_armed' then
    return jsonb_build_object('ok', false, 'motivo', 'posicao_nao_armada',
      'status', v_pos.status);
  end if;
  if v_pos.exit_intent_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'saida_sem_identidade',
      'base', v_base, 'ordem_armada', v_pos.exit_order_id);
  end if;
  if v_pos.exit_intent_id <> p_intent_id then
    return jsonb_build_object('ok', false, 'motivo', 'intent_nao_e_a_saida_armada',
      'esperado', v_pos.exit_intent_id);
  end if;
  if v_i.exchange_id <> v_pos.exchange_id then
    return jsonb_build_object('ok', false, 'motivo', 'corretora_divergente');
  end if;
  if v_pos.exit_order_id is not null
     and v_i.external_order_id is not null
     and v_i.external_order_id <> v_pos.exit_order_id then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_externa_divergente');
  end if;

  v_restante := v_pos.base_amount - v_delta;
  if v_restante <= v_pos.base_amount * v_ruido then
    v_custo_removido := v_pos.cost_usd;
    v_fechou := true;
    delete from public.autopilot_positions where id = v_pos.id;
  else
    v_custo_restante := v_pos.cost_usd * (v_restante / v_pos.base_amount);
    v_custo_removido := v_pos.cost_usd - v_custo_restante;
    update public.autopilot_positions
       set base_amount    = v_restante,
           cost_usd       = v_custo_restante,
           -- ⚠️ A ordem armada ACABOU de ser resolvida por quem chama (ela leu
           -- a corretora). O remanescente precisa poder armar de novo — e este
           -- é o único caminho que tem essa prova.
           status         = 'open',
           exit_order_id  = null,
           exit_armed_at  = null,
           exit_intent_id = null,
           updated_at     = now()
     where id = v_pos.id;
  end if;

  -- ⚠️⚠️ A138: o P&L realizado entra na MESMA transação que reduziu a posição.
  v_realizado := v_delta_quote - v_custo_removido - coalesce(p_taxa_usd, 0);
  if v_realizado <> 0 then
    update public.autopilot_sessions
       set pnl_today        = pnl_today + v_realizado,
           frozen_until_day = case
             when (pnl_today + v_realizado) <= -daily_loss_stop_usd
               then coalesce(p_hoje, frozen_until_day)
             else frozen_until_day end,
           updated_at       = now()
     where id = v_i.session_id;
  end if;

  update public.autopilot_position_effects
     set applied_qty      = greatest(applied_qty, p_qty_vendida),
         applied_quote    = greatest(applied_quote, coalesce(p_quote_recebido, 0)),
         pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
         updated_at       = now()
   where intent_id = p_intent_id;

  return jsonb_build_object('ok', true, 'motivo', 'aplicado',
    'aplicado_qty', v_delta, 'aplicado_quote', v_delta_quote,
    'custo_removido', v_custo_removido, 'fechou', v_fechou, 'base', v_base,
    'pnl_realizado', v_realizado);
end; $$;

comment on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric, numeric, text) is
  'A136: reduz/fecha a posicao de uma saida armada E avanca o marcador na MESMA '
  'transacao. Antes eram duas escritas, e qualquer ordem delas quebrava '
  'exactly-once.';

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
revoke all on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, text)
  to service_role;

revoke all on function public.autopilot_projecoes_pendentes(int)
  from public, anon, authenticated;
grant execute on function public.autopilot_projecoes_pendentes(int)
  to service_role;

revoke all on function public.autopilot_reservar_venda_do_intent(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_reservar_venda_do_intent(uuid, numeric)
  to service_role;

revoke all on function public.autopilot_reservar_exposicao_do_intent(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_reservar_exposicao_do_intent(uuid, numeric, numeric)
  to service_role;

revoke all on function public.autopilot_liberar_reserva_do_intent(uuid)
  from public, anon, authenticated;
grant execute on function public.autopilot_liberar_reserva_do_intent(uuid)
  to service_role;

revoke all on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric, numeric, text)
  to service_role;

revoke all on function public.autopilot_compromisso_vivo(numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.autopilot_compromisso_vivo(numeric, numeric, text)
  to service_role;

-- ⚠️ A TABELA TAMBÉM: RLS ligada sem policies já fecha para anon/authenticated,
-- mas o GRANT de tabela é outra porta. Ela nasce sem nenhum.
revoke all on table public.autopilot_position_effects from public, anon, authenticated;
grant select, insert, update on table public.autopilot_position_effects to service_role;
