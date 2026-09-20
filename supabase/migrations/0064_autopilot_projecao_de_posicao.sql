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
  -- débito sumia sem ninguém para retentá-lo.
  --
  -- ⚠️⚠️⚠️ E A TAXA É CUMULATIVA COMO O RESTO — achado A140.
  --
  -- `fee_total` do intent é a taxa ACUMULADA da ordem (0059: o valor final
  -- independe do número de snapshots). Descontá-la inteira a cada parcial
  -- cobra a mesma taxa duas vezes. Com US$ 600 de custo:
  --
  --     parcial 1: recebido 320, taxa acumulada 1 → +19
  --     parcial 2: recebido 640, taxa acumulada 2 → delta +19 (total 38)
  --
  -- Sem watermark, o segundo parcial subtraía 2 de novo e fechava 37.
  --
  -- ⚠️ O CONTRATO DOS QUATRO CAMPOS, escrito porque quatro watermarks sem
  -- contrato é como se volta a errar:
  --
  --     applied_qty        quanto da QUANTIDADE do intent já está na posição
  --     applied_quote      quanto do RECEBIDO/GASTO já está na posição
  --     fee_aplicada_usd   quanta TAXA (USD) já foi descontada do P&L
  --     custo_removido_usd quanto CUSTO a posição já perdeu por este intent
  --     pnl_aplicado_usd   quanto RESULTADO já entrou no `pnl_today`
  --
  -- Os quatro primeiros são as entradas da conta; o último é o que ela
  -- produziu. A conta é ACUMULADA, não somada por deltas independentes:
  --
  --     realizado_total = applied_quote − custo_removido_usd − fee_aplicada_usd
  --     delta           = realizado_total − pnl_aplicado_usd
  --
  -- É isso que torna a ordem de chegada dos fatos irrelevante — quantidade
  -- primeiro, recebido depois, taxa por último, tudo converge no mesmo número.
  fee_aplicada_usd numeric  not null default 0 check (fee_aplicada_usd >= 0),

  -- ⚠️⚠️⚠️ E O CUSTO REMOVIDO TAMBÉM É WATERMARK — achado A142.
  --
  -- O A140 deu delta próprio à taxa e ninguém deu ao RECEBIDO. `filled_quote`
  -- pode crescer com `filled_qty` PARADO: a corretora nem sempre devolve
  -- `cost` no ACK, o executor manda `cumulativeQuote = 0`, e só quando
  -- `cex_ingest_trades` traz os trades reais o recebido aparece. O P&L estava
  -- atrás de `v_delta_quote > 0`, então:
  --
  --     1ª projeção: qty 0,01 · quote 0 → posição FECHADA, custo 600 sai do
  --                  livro, e ZERO entra no `pnl_today`
  --     2ª projeção: quote 640 chega, qty parada → `sem_delta`
  --
  -- Resultado: US$ 600 de custo somem e nenhum resultado é contado. Com o
  -- preço para o outro lado, é o PREJUÍZO que some — e o stop de perda nunca
  -- dispara.
  --
  -- O conserto é parar de somar deltas independentes e passar a calcular o
  -- resultado ACUMULADO, comparando-o com o que já foi contado:
  --
  --     realizado_total = applied_quote − custo_removido_usd − fee_aplicada_usd
  --     delta do P&L    = realizado_total − pnl_aplicado_usd
  --
  -- ⚠️ E O P&L SÓ É CONTADO QUANDO O RECEBIDO EXISTE. Enquanto `applied_quote`
  -- for zero, a redução da posição fica registrada aqui e o resultado espera —
  -- senão fechar a posição sem saber por quanto viraria um prejuízo de
  -- `−custo` inteiro, que foi exatamente o segundo defeito deste achado.
  custo_removido_usd numeric not null default 0 check (custo_removido_usd >= 0),

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
  -- ⚠️⚠️ NÃO RECEBE MAIS TAXA NEM DIA — achado A140.
  --
  -- A taxa vinha de quem chamava, e a varredura de pendências não tinha como
  -- saber dela: o mesmo preenchimento rendia P&L diferente conforme quem o
  -- descobrisse. O dia vinha de quem chamava, e `null` fazia o freeze do stop
  -- de perda simplesmente não acontecer. Os dois agora saem do banco, que é
  -- a única autoridade que todos os caminhos compartilham.
  p_intent_id         uuid
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
  v_taxa_total    numeric;
  v_taxa_delta    numeric := 0;
  v_taxa_opaca    boolean := false;
  v_custo_acum    numeric := 0;
  v_quote_novo    numeric := 0;
  v_realizado_total numeric := 0;
  v_hoje          text;
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

  /**
   * ⚠️⚠️⚠️ A REGRESSÃO DO RECEBIDO — auditoria SINTÉTICO → REAL do A145.
   *
   * `cex_ingest_trades` SUBSTITUI os fills sintéticos da ordem pelos reais
   * (0059). Quando o sintético estimou ALTO — ACK diz `cost = 600`, os trades
   * somam 580 — `filled_quote` CAI, com `filled_qty` parado.
   *
   * Nenhum `greatest()` desta função reclamava disso, e dois deles escondiam:
   *
   *     v_delta_quote := greatest(filled_quote − applied_quote, 0)   → 0
   *     v_quote_novo  := greatest(applied_quote, filled_quote)       → 600
   *
   * Na VENDA o segundo é o estrago: o resultado do dia segue calculado sobre
   * um recebido que não existiu, US$ 20 OTIMISTA — e é exatamente o número
   * que alimenta o stop de perda diária. Um freio calibrado por um recebido
   * inflado é um freio que não freia.
   *
   * ⚠️ POR QUE FAIL-CLOSED E NÃO CORREÇÃO AUTOMÁTICA. A conta acumulada do
   * A142 saberia aplicar um delta negativo de P&L; a POSIÇÃO não sabe
   * desfazer. Na compra, `cost_usd` já somou os 600 — devolvê-los exigiria
   * saber quanto daquele custo ainda está na linha depois de vendas
   * parciais, e a linha pode já ter sido apagada. Corrigir metade da conta é
   * pior que parar: vira lucro artificial com aparência de conserto.
   *
   * O livro de EXECUÇÕES continua certo (é ele que regrediu, para a verdade).
   * O que para é a PROJEÇÃO daquele intent, com evento de severidade alta —
   * reconciliação de mão humana, como a regressão de quantidade e a de taxa.
   */
  if v_i.filled_quote < v_e.ledger_quote - v_eps then
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_quote',
      'aplicado', v_e.ledger_quote, 'no_livro', v_i.filled_quote);
  end if;

  -- ⚠️ O DELTA É CONTRA `applied`: o que já está DENTRO da posição, tenha
  -- entrado pela projeção ou pela liquidação.
  v_delta_qty   := greatest(v_i.filled_qty   - v_e.applied_qty,   0);
  v_delta_quote := greatest(v_i.filled_quote - v_e.applied_quote, 0);

  /**
   * ⚠️⚠️⚠️ A TAXA TEM DELTA PRÓPRIO — achado A140.
   *
   * `fee_total` é CUMULATIVA (0059). Descontá-la inteira a cada parcial cobra
   * duas vezes. E ela pode crescer SEM quantidade nova: a 0059 permite ajuste
   * de taxa depois, quando os trades reais substituem o sintético. Nesse caso
   * `delta_qty` é zero e o P&L ainda precisa mudar — por isso o `sem_delta`
   * abaixo confere as DUAS coisas.
   */
  v_taxa_total := public.autopilot_taxa_do_intent_em_usd(
    v_i.fee_total, v_i.fee_currency, v_i.symbol, v_i.filled_qty, v_i.filled_quote);
  if v_taxa_total is null then
    -- ⚠️ Moeda não precificável: não se inventa preço, e não se finge que é
    -- zero exato. A taxa não entra, e quem chama recebe a bandeira.
    v_taxa_opaca := true;
    v_taxa_total := v_e.fee_aplicada_usd;
  end if;
  v_taxa_delta := v_taxa_total - v_e.fee_aplicada_usd;
  if v_taxa_delta < -v_eps then
    -- ⚠️ REGRESSÃO DE TAXA: aplicar um delta negativo viraria LUCRO
    -- artificial. Fail-closed, como a regressão de quantidade.
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_taxa',
      'aplicado', v_e.fee_aplicada_usd, 'no_livro', v_taxa_total);
  end if;

  -- ⚠️⚠️ A142: o RECEBIDO entra na decisão. Ele cresce com a quantidade
  -- parada (ACK sem `cost`, trades reais depois), e sem isto a chegada dele
  -- caía em `sem_delta` — o resultado inteiro ia embora.
  if v_delta_qty <= v_eps and v_taxa_delta <= v_eps and v_delta_quote <= v_eps then
    -- ⚠️ O LIVRO AVANÇOU SEM DELTA? Ainda assim é o novo piso da regressão.
    update public.autopilot_position_effects
       set ledger_qty   = greatest(ledger_qty,   v_i.filled_qty),
           ledger_quote = greatest(ledger_quote, v_i.filled_quote),
           updated_at   = now()
     where intent_id = p_intent_id;
    return jsonb_build_object('ok', true, 'motivo', 'sem_delta',
      'aplicado_qty', 0, 'aplicado_quote', 0, 'fechou', false,
      'pnl_realizado', 0, 'taxa_nao_precificada', v_taxa_opaca);
  end if;

  /**
   * ⚠️⚠️ AJUSTE SEM QUANTIDADE NOVA (A140 §7 e A142): o livro descobriu o
   * RECEBIDO ou a TAXA depois, e o resultado do dia muda sem que nada tenha
   * sido vendido a mais. Este ramo existe porque o caminho normal exige
   * `delta_qty > 0` para tocar a posição, e aqui não há posição a tocar.
   */
  if v_delta_qty <= v_eps then
    if v_i.side = 'sell' then
      v_quote_novo := greatest(v_e.applied_quote, v_i.filled_quote);
      v_custo_acum := v_e.custo_removido_usd;
      -- ⚠️ Sem recebido não se conta resultado: a redução já está guardada em
      -- `custo_removido_usd` e espera o quote chegar.
      if v_quote_novo > 0 then
        v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;
        v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
      end if;
      if v_realizado <> 0 then
        v_hoje := (current_timestamp at time zone 'UTC')::date::text;
        update public.autopilot_sessions
           set pnl_today        = pnl_today + v_realizado,
               frozen_until_day = case
                 when (pnl_today + v_realizado) <= -daily_loss_stop_usd
                   then v_hoje else frozen_until_day end,
               updated_at       = now()
         where id = v_i.session_id;
      end if;
    /**
     * ⚠️⚠️⚠️ ACHADO A145 — O CUSTO DA COMPRA QUE CHEGOU ATRASADO.
     *
     * Este ramo tratava só a venda. Na compra ele avançava
     * `applied_quote = greatest(applied_quote, filled_quote)` e ia embora:
     * o marcador dizia "600 aplicados" e `autopilot_positions.cost_usd`
     * continuava ZERO. É o caso comum, não o exótico — uma ordem aceita sem
     * `cost` no ACK (a venue responde a quantidade e o dinheiro só aparece
     * nos trades depois) entra no livro com `filled_qty` já cheio e
     * `filled_quote` zerado. O `delta_qty` da passada seguinte é zero, e o
     * recebido cai exatamente aqui.
     *
     * O estrago é PERMANENTE e silencioso: base de custo perdida para
     * sempre. A exposição do teto conta menos capital do que existe (e o bot
     * compra mais do que pode), e a venda futura calcula
     * `recebido − 0 − taxa` — LUCRO INVENTADO do tamanho da compra.
     *
     * ⚠️ QUANTIDADE NÃO SE TOCA AQUI. `delta_qty` é zero por definição deste
     * ramo; somar base seria inventar moeda.
     *
     * ⚠️⚠️ E SEM POSIÇÃO NÃO SE MARCA NADA COMO APLICADO. Se o custo não
     * tiver onde entrar, avançar `applied_quote` faria a varredura de
     * pendências responder `sem_delta` para sempre — o mesmo erro do A136,
     * absorver antes da escrita. Fail-closed VISÍVEL, na mesma transação.
     */
    elsif v_i.side = 'buy' and v_delta_quote > v_eps then
      select * into v_pos from public.autopilot_positions
       where session_id = v_i.session_id and base = v_base for update;
      if not found then
        return jsonb_build_object('ok', false, 'motivo', 'sem_posicao_para_custo',
          'base', v_base, 'delta_quote', v_delta_quote);
      end if;
      update public.autopilot_positions
         set cost_usd    = cost_usd + v_delta_quote,
             entry_price = case when base_amount > 0
                                then (cost_usd + v_delta_quote) / base_amount
                                else entry_price end,
             updated_at  = now()
       where id = v_pos.id;
    end if;
    update public.autopilot_position_effects
       set fee_aplicada_usd = v_taxa_total,
           applied_quote    = greatest(applied_quote, v_i.filled_quote),
           pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
           ledger_qty       = greatest(ledger_qty,   v_i.filled_qty),
           ledger_quote     = greatest(ledger_quote, v_i.filled_quote),
           updated_at       = now()
     where intent_id = p_intent_id;
    return jsonb_build_object('ok', true, 'motivo', 'ajuste_sem_quantidade',
      'aplicado_qty', 0, 'aplicado_quote', greatest(v_delta_quote, 0),
      'fechou', false, 'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
      'taxa_nao_precificada', v_taxa_opaca);
  end if;

  select * into v_pos from public.autopilot_positions
   where session_id = v_i.session_id and base = v_base for update;

  /**
   * ⚠️⚠️ POSIÇÃO JÁ FECHADA POR ESTE MESMO INTENT — achado A142 (P1-4).
   *
   * A liquidação fecha a posição com o que a CORRETORA disse ter saído; os
   * trades reais podem trazer um pouco mais depois. A quantidade a mais não
   * tem posição para reduzir — o custo inteiro já saiu — e voltar
   * `sem_posicao` relistava o intent a cada cinco minutos por três dias, com
   * evento de severidade alta, até a janela fechar sem nunca contar o
   * resultado.
   *
   * O que sobra é receita sem custo novo, e a conta acumulada sabe lidar com
   * isso. Só vale quando ESTE intent já aplicou algo — sem isso, `sem_posicao`
   * continua sendo fail-closed de verdade.
   */
  if not found and v_i.side = 'sell' and v_e.applied_qty > 0 then
    v_quote_novo := greatest(v_e.applied_quote, v_i.filled_quote);
    if v_quote_novo > 0 then
      v_realizado_total := v_quote_novo - v_e.custo_removido_usd - v_taxa_total;
      v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
    end if;
    if v_realizado <> 0 then
      v_hoje := (current_timestamp at time zone 'UTC')::date::text;
      update public.autopilot_sessions
         set pnl_today        = pnl_today + v_realizado,
             frozen_until_day = case
               when (pnl_today + v_realizado) <= -daily_loss_stop_usd
                 then v_hoje else frozen_until_day end,
             updated_at       = now()
       where id = v_i.session_id;
    end if;
    update public.autopilot_position_effects
       set applied_qty      = greatest(applied_qty,  v_i.filled_qty),
           applied_quote    = greatest(applied_quote, v_i.filled_quote),
           ledger_qty       = greatest(ledger_qty,    v_i.filled_qty),
           ledger_quote     = greatest(ledger_quote,  v_i.filled_quote),
           fee_aplicada_usd = greatest(fee_aplicada_usd, v_taxa_total),
           pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
           updated_at       = now()
     where intent_id = p_intent_id;
    return jsonb_build_object('ok', true, 'motivo', 'posicao_ja_encerrada',
      'aplicado_qty', v_delta_qty, 'aplicado_quote', v_delta_quote,
      'custo_removido', 0, 'fechou', false, 'pnl_realizado', v_realizado,
      'taxa_delta', v_taxa_delta, 'taxa_nao_precificada', v_taxa_opaca);
  end if;

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
  if v_i.side = 'sell' then
    /**
     * ⚠️⚠️ A CONTA É ACUMULADA (A142), não uma soma de deltas independentes.
     *
     * Era `v_delta_quote − custo_removido − taxa_delta`, atrás de um
     * `v_delta_quote > 0`. Quando o ACK não trazia `cost`, a posição era
     * reduzida e o resultado NÃO entrava — e a chegada do recebido, depois,
     * caía em `sem_delta`. O custo sumia da conta do dia.
     *
     * Com o acumulado, a ordem de chegada dos fatos deixa de importar: o que
     * falta é sempre `realizado_total − pnl_aplicado`.
     */
    v_custo_acum := v_e.custo_removido_usd + coalesce(v_custo_removido, 0);
    v_quote_novo := greatest(v_e.applied_quote, v_i.filled_quote);
    -- ⚠️ Sem recebido não se conta resultado — fechar a posição sem saber por
    -- quanto viraria um prejuízo de `−custo` inteiro.
    if v_quote_novo > 0 then
      v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;
      v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
    end if;
    if v_realizado <> 0 then
      /**
       * ⚠️⚠️ O DIA É DO BANCO — achado A140 §11.
       *
       * Ele vinha do caller, e `null` fazia o `case` cair no
       * `frozen_until_day` antigo: o stop de perda cruzava e NÃO congelava. A
       * varredura de pendências chamava exatamente assim. Agora fill imediato,
       * fill tardio e recovery usam a mesma autoridade temporal.
       */
      v_hoje := (current_timestamp at time zone 'UTC')::date::text;
      update public.autopilot_sessions
         set pnl_today        = pnl_today + v_realizado,
             frozen_until_day = case
               when (pnl_today + v_realizado) <= -daily_loss_stop_usd
                 then v_hoje else frozen_until_day end,
             updated_at       = now()
       where id = v_i.session_id;
    end if;
  end if;

  -- ⚠️ A RESERVA NÃO PRECISA SER "SOLTA": o compromisso vivo é
  -- `greatest(reservado − applied, 0)`, e `applied` acabou de crescer. Era o
  -- contador agregado que exigia uma subtração — e era ela que podia comer a
  -- reserva de outro intent (A137).
  update public.autopilot_position_effects
     set applied_qty        = greatest(applied_qty,  v_i.filled_qty),
         applied_quote      = greatest(applied_quote, v_i.filled_quote),
         ledger_qty         = greatest(ledger_qty,    v_i.filled_qty),
         ledger_quote       = greatest(ledger_quote,  v_i.filled_quote),
         -- ⚠️ A140: a taxa também é watermark. Sem isto, o próximo parcial
         -- desconta a acumulada inteira outra vez.
         fee_aplicada_usd   = greatest(fee_aplicada_usd, v_taxa_total),
         -- ⚠️ A142: e o custo que saiu da posição, para o resultado poder ser
         -- calculado quando o recebido chegar.
         custo_removido_usd = custo_removido_usd + coalesce(v_custo_removido, 0),
         pnl_aplicado_usd   = pnl_aplicado_usd + v_realizado,
         updated_at         = now()
   where intent_id = p_intent_id;

  return jsonb_build_object(
    'ok', true, 'motivo', 'aplicado',
    'side', v_i.side, 'base', v_base,
    'aplicado_qty', v_delta_qty, 'aplicado_quote', v_delta_quote,
    'custo_removido', coalesce(v_custo_removido, 0), 'fechou', v_fechou,
    'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
    'taxa_nao_precificada', v_taxa_opaca);
end; $$;

comment on function public.autopilot_projetar_efeito_do_intent(uuid) is
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
-- `UNKNOWN`, `SUBMITTED` e `PARTIALLY_FILLED` não provam nada e seguram o
-- remanescente reservado.
--
-- ⚠️ E O ESTADO TERMINAL NÃO ZERA SOZINHO (A144): só `FAILED_PRE_SUBMIT`
-- prova que nada saiu. `CANCELED` e `FILLED` provam que nada mais SAI — o que
-- já executou e ainda não foi projetado continua comprometido.

-- ── 3-PRE. A TAXA ACUMULADA EM USD, DERIVADA DO LIVRO (A140) ──────────────
--
-- ⚠️⚠️⚠️ A RECUPERAÇÃO NÃO PODE TER MEMÓRIA DA REQUISIÇÃO ORIGINAL.
--
-- A taxa em USD era calculada em TypeScript e passada como parâmetro. Quem
-- chamava do caminho imediato tinha a resposta da corretora na mão; quem
-- chamava da varredura de pendências, cinco minutos depois, não tinha — e
-- projetava com taxa ZERO. O mesmo preenchimento produzia P&L diferente
-- conforme QUEM o descobriu.
--
-- Agora a conversão mora aqui, sobre fatos duráveis (`fee_total`,
-- `fee_currency`, `filled_qty`, `filled_quote` do intent). Fill imediato,
-- fill tardio e recovery chegam ao mesmo número porque leem a mesma linha.
--
-- ⚠️ A SEMÂNTICA É A MESMA DO `taxaEmUsd` DE SEMPRE, inclusive a limitação:
--   · moeda estável           → o valor é o próprio;
--   · moeda BASE do par       → converte pelo preço médio do próprio fill;
--   · qualquer outra          → NÃO se inventa preço. Devolve `null`, e quem
--                               chama registra — o P&L sai otimista e o stop
--                               afrouxa, que é a política declarada.
create or replace function public.autopilot_taxa_do_intent_em_usd(
  p_fee numeric, p_moeda text, p_symbol text,
  p_filled_qty numeric, p_filled_quote numeric
) returns numeric
language sql immutable as $$
  select case
    when p_fee is null or p_fee <= 0 then 0
    when p_moeda is null or p_moeda = '' then null
    when upper(p_moeda) in ('USDT','USDC','USD','BUSD','DAI','TUSD','FDUSD') then p_fee
    when upper(p_moeda) = upper(split_part(replace(p_symbol, '-', '/'), '/', 1))
         and coalesce(p_filled_qty, 0) > 0 and coalesce(p_filled_quote, 0) > 0
      then p_fee * (p_filled_quote / p_filled_qty)
    else null
  end
$$;

comment on function public.autopilot_taxa_do_intent_em_usd(numeric, text, text, numeric, numeric) is
  'A140: taxa acumulada do intent em USD, derivada do livro. NULL = moeda nao '
  'precificavel — quem chama registra e o P&L sai otimista (politica declarada).';

-- ── 3-BIS-a. O COMPROMISSO VIVO DE UM INTENT (A137 / A144) ────────────────
--
-- ⚠️ É a peça que substitui o prazo. Enquanto o intent puder preencher, o que
-- ele reservou e ainda não virou posição continua comprometido. Provado morto,
-- o compromisso é zero na mesma hora — sem esperar relógio nenhum.
--
-- ⚠️⚠️⚠️ ACHADO A144 — `CANCELED` NÃO QUER DIZER "NADA EXECUTOU".
--
-- A primeira versão mandava `CANCELED` e `FAILED_PRE_SUBMIT` para ZERO, os
-- dois juntos, como se cancelar fosse desfazer. Uma ordem limitada que vendeu
-- 0,004 de 0,01 e DEPOIS foi cancelada é terminal com fill — e o compromisso
-- dela desabava para zero antes de a projeção aplicar aquele 0,004:
--
--     posição 0,01 · A reservou 0,01, preencheu 0,004, applied 0, CANCELED
--     → compromisso 0 → B via 0,01 disponível → B vendia 0,01
--     → 0,004 + 0,01 = 0,014 vendidos de uma bolsa de 0,01.
--
-- Do lado da compra o mesmo buraco furava o TETO: reserva de 40 com 30
-- preenchido e cancelada liberava os 40 inteiros, e a entrada seguinte
-- somava exposição sobre um capital que já saiu.
--
-- ⚠️ A REGRA CERTA TEM TRÊS FAIXAS, e a diferença entre elas é o que se
-- PROVOU:
--
--   · `FAILED_PRE_SUBMIT` → a requisição não chegou à corretora. Zero, e é o
--     único zero incondicional.
--   · terminal (`FILLED`, `CANCELED`) → nada mais sai. A verdade final é o que
--     EXECUTOU: `greatest(executado − aplicado, 0)`. Cancelada sem fill dá
--     zero pela própria conta; `FILLED` já projetado, idem.
--   · qualquer outro estado → ainda pode preencher, e o RESERVADO continua
--     comprometido: `greatest(reservado − aplicado, 0)`.
--
-- ⚠️ `p_executado` é `filled_qty` na venda e `filled_quote` na compra — a
-- mesma unidade de `p_aplicado` (`applied_qty` / `applied_quote`). Misturar
-- as duas unidades aqui seria comparar BTC com dólar.
drop function if exists public.autopilot_compromisso_vivo(numeric, numeric, text);
create or replace function public.autopilot_compromisso_vivo(
  p_reservado numeric, p_aplicado numeric, p_estado text, p_executado numeric
) returns numeric
language sql immutable as $$
  select case
    when p_estado = 'FAILED_PRE_SUBMIT' then 0
    when p_estado in ('FILLED', 'CANCELED')
      then greatest(coalesce(p_executado, 0) - coalesce(p_aplicado, 0), 0)
    else greatest(coalesce(p_reservado, 0) - coalesce(p_aplicado, 0), 0)
  end
$$;

comment on function public.autopilot_compromisso_vivo(numeric, numeric, text, numeric) is
  'A144: terminal com fill ainda compromete o que EXECUTOU e nao foi projetado. '
  'CANCELED nao desfaz preenchimento parcial.';

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
  -- ⚠️ A144: na venda a unidade é BASE — `filled_qty` contra `applied_qty`.
  select coalesce(sum(public.autopilot_compromisso_vivo(
           e.reservado_qty, e.applied_qty, i.state::text, i.filled_qty)), 0)
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

  -- ⚠️ A144: na compra a unidade é QUOTE — `filled_quote` contra
  -- `applied_quote`. É o capital que já saiu e ainda não virou custo no livro.
  select coalesce(sum(public.autopilot_compromisso_vivo(
           e.reservado_usd, e.applied_quote, i.state::text, i.filled_quote)), 0)
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
  p_quote_recebido numeric
  -- ⚠️ A140: taxa e dia saíram dos parâmetros. Ela é derivada do livro e ele
  -- do relógio do banco — o mesmo para liquidação, projeção e recovery.
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
  v_taxa_total numeric; v_taxa_delta numeric := 0; v_taxa_opaca boolean := false;
  v_custo_acum numeric := 0; v_quote_novo numeric := 0;
  v_realizado_total numeric := 0; v_hoje text;
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
  -- ⚠️ A140: a taxa acumulada vem do LIVRO, e tem delta próprio.
  v_taxa_total := public.autopilot_taxa_do_intent_em_usd(
    v_i.fee_total, v_i.fee_currency, v_i.symbol, v_i.filled_qty, v_i.filled_quote);
  if v_taxa_total is null then
    v_taxa_opaca := true;
    v_taxa_total := v_e.fee_aplicada_usd;
  end if;
  v_taxa_delta := v_taxa_total - v_e.fee_aplicada_usd;
  if v_taxa_delta < -v_eps then
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_taxa',
      'aplicado', v_e.fee_aplicada_usd, 'no_livro', v_taxa_total);
  end if;
  /**
   * ⚠️⚠️ A MESMA GUARDA DO RECEBIDO (auditoria sintético→real). Desde o A143
   * `p_quote_recebido` vem do LIVRO, e o livro pode REGREDIR quando os trades
   * reais substituem o sintético superestimado. Os dois `greatest(applied,
   * recebido)` abaixo manteriam o P&L no valor antigo — otimista — e o stop
   * de perda com ele. Divergência não se absorve: fail-closed.
   */
  if p_quote_recebido is not null
     and p_quote_recebido < v_e.applied_quote - v_eps then
    return jsonb_build_object('ok', false, 'motivo', 'regressao_de_quote',
      'aplicado', v_e.applied_quote, 'no_livro', p_quote_recebido);
  end if;
  if v_delta <= v_eps and v_taxa_delta <= v_eps then
    return jsonb_build_object('ok', true, 'motivo', 'sem_delta',
      'aplicado_qty', 0, 'custo_removido', 0, 'fechou', false, 'pnl_realizado', 0,
      'taxa_nao_precificada', v_taxa_opaca);
  end if;
  if v_delta <= v_eps then
    -- ⚠️ Ajuste sem quantidade (A140 §7 / A142): nada a reduzir, e o P&L muda.
    v_quote_novo := greatest(v_e.applied_quote, coalesce(p_quote_recebido, 0));
    if v_quote_novo > 0 then
      v_realizado_total := v_quote_novo - v_e.custo_removido_usd - v_taxa_total;
      v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
    end if;
    if v_realizado <> 0 then
      v_hoje := (current_timestamp at time zone 'UTC')::date::text;
      update public.autopilot_sessions
         set pnl_today        = pnl_today + v_realizado,
             frozen_until_day = case
               when (pnl_today + v_realizado) <= -daily_loss_stop_usd
                 then v_hoje else frozen_until_day end,
             updated_at       = now()
       where id = v_i.session_id;
    end if;
    update public.autopilot_position_effects
       set fee_aplicada_usd = v_taxa_total,
           applied_quote    = greatest(applied_quote, coalesce(p_quote_recebido, 0)),
           pnl_aplicado_usd = pnl_aplicado_usd + v_realizado,
           updated_at       = now()
     where intent_id = p_intent_id;
    return jsonb_build_object('ok', true, 'motivo', 'ajuste_sem_quantidade',
      'aplicado_qty', 0, 'custo_removido', 0, 'fechou', false,
      'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
      'taxa_nao_precificada', v_taxa_opaca);
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
  /**
   * ⚠️⚠️ NULL TAMBÉM É DIVERGÊNCIA — hardening do A139.
   *
   * A condição exigia que os DOIS fossem não-nulos para comparar. Uma posição
   * armada em `ABC` com o intent sem `external_order_id` passava — e é
   * exatamente o estado de quem ainda não sabe qual ordem está lá fora. Uma
   * saída ARMADA tem identidade ou não é liquidada: `is distinct from` cobre
   * null↔valor nos dois sentidos.
   */
  if v_i.external_order_id is distinct from v_pos.exit_order_id then
    return jsonb_build_object('ok', false, 'motivo', 'ordem_externa_divergente',
      'na_posicao', v_pos.exit_order_id, 'no_intent', v_i.external_order_id);
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

  /**
   * ⚠️⚠️ A138/A140/A142: conta ACUMULADA, e o dia vem do banco.
   *
   * Era `v_delta_quote − v_custo_removido − v_taxa_delta`, INCONDICIONAL. A
   * liquidação recebe o recebido da corretora, e ele chega `0` quando o ACK
   * não traz `cost` (`order.cost` → `Number.isFinite(quote) ? quote : 0`).
   * A conta virava `0 − 600 − 0` e a sessão levava um prejuízo de US$ 600 que
   * não existiu — congelando o dia inteiro pelo stop de perda.
   *
   * Sem recebido, o custo removido fica GUARDADO e o resultado espera o livro.
   */
  v_custo_acum := v_e.custo_removido_usd + v_custo_removido;
  v_quote_novo := greatest(v_e.applied_quote, coalesce(p_quote_recebido, 0));
  if v_quote_novo > 0 then
    v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;
    v_realizado := v_realizado_total - v_e.pnl_aplicado_usd;
  end if;
  if v_realizado <> 0 then
    v_hoje := (current_timestamp at time zone 'UTC')::date::text;
    update public.autopilot_sessions
       set pnl_today        = pnl_today + v_realizado,
           frozen_until_day = case
             when (pnl_today + v_realizado) <= -daily_loss_stop_usd
               then v_hoje else frozen_until_day end,
           updated_at       = now()
     where id = v_i.session_id;
  end if;

  update public.autopilot_position_effects
     set applied_qty        = greatest(applied_qty, p_qty_vendida),
         applied_quote      = greatest(applied_quote, coalesce(p_quote_recebido, 0)),
         fee_aplicada_usd   = greatest(fee_aplicada_usd, v_taxa_total),
         custo_removido_usd = custo_removido_usd + v_custo_removido,
         pnl_aplicado_usd   = pnl_aplicado_usd + v_realizado,
         updated_at         = now()
   where intent_id = p_intent_id;

  return jsonb_build_object('ok', true, 'motivo', 'aplicado',
    'aplicado_qty', v_delta, 'aplicado_quote', v_delta_quote,
    'custo_removido', v_custo_removido, 'fechou', v_fechou, 'base', v_base,
    'pnl_realizado', v_realizado, 'taxa_delta', v_taxa_delta,
    'taxa_nao_precificada', v_taxa_opaca);
end; $$;

comment on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric) is
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
     -- ⚠️⚠️ A140: quantidade OU taxa pendente. `fee_total` pode crescer sem
     -- quantidade nova (a 0059 permite o ajuste quando os trades reais
     -- substituem o sintético), e esse P&L também precisa entrar.
     and (e.intent_id is null
          or i.filled_qty > e.applied_qty + 1e-12
          -- ⚠️ A142: o RECEBIDO pode chegar depois da quantidade.
          or i.filled_quote > e.applied_quote + 1e-12
          or coalesce(public.autopilot_taxa_do_intent_em_usd(
               i.fee_total, i.fee_currency, i.symbol, i.filled_qty, i.filled_quote),
             e.fee_aplicada_usd) > e.fee_aplicada_usd + 1e-12)
   order by i.updated_at asc
   limit greatest(coalesce(p_limite, 50), 0);
$$;

comment on function public.autopilot_projecoes_pendentes(int) is
  'A131-C: intents autonomos com execucao no livro e projecao atrasada. '
  'Existe porque FILLED e terminal e o recuperador de intents nao volta nele.';

-- ── 5. ACL — NASCE FECHADA (lição A116) ───────────────────────────────────
revoke all on function public.autopilot_projetar_efeito_do_intent(uuid)
  from public, anon, authenticated;
grant execute on function public.autopilot_projetar_efeito_do_intent(uuid)
  to service_role;

revoke all on function public.autopilot_taxa_do_intent_em_usd(numeric, text, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_taxa_do_intent_em_usd(numeric, text, text, numeric, numeric)
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

revoke all on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_liquidar_saida_armada(uuid, numeric, numeric)
  to service_role;

revoke all on function public.autopilot_compromisso_vivo(numeric, numeric, text, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_compromisso_vivo(numeric, numeric, text, numeric)
  to service_role;

-- ⚠️ A TABELA TAMBÉM: RLS ligada sem policies já fecha para anon/authenticated,
-- mas o GRANT de tabela é outra porta. Ela nasce sem nenhum.
revoke all on table public.autopilot_position_effects from public, anon, authenticated;
grant select, insert, update on table public.autopilot_position_effects to service_role;
