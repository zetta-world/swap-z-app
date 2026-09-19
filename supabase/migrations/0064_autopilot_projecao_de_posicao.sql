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

  v_base := upper(split_part(v_i.symbol, '/', 1));

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
      update public.autopilot_positions
         set base_amount = base_amount + v_delta_qty,
             cost_usd    = cost_usd + v_delta_quote,
             entry_price = case when (base_amount + v_delta_qty) > 0
                                then (cost_usd + v_delta_quote) / (base_amount + v_delta_qty)
                                else entry_price end,
             -- ⚠️ Uma compra nova reabre: a saída que estava armada não cobre
             -- a quantidade que acabou de entrar.
             status      = 'open',
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
      update public.autopilot_positions
         set base_amount   = v_restante,
             cost_usd      = v_custo_restante,
             -- A saída que estava armada acabou de ser resolvida; o
             -- remanescente precisa poder armar de novo.
             status        = 'open',
             exit_order_id = null,
             exit_armed_at = null,
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

-- ── 4. ACL — NASCE FECHADA (lição A116) ───────────────────────────────────
revoke all on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.autopilot_projetar_efeito_do_intent(uuid, numeric, numeric)
  to service_role;

-- ⚠️ A TABELA TAMBÉM: RLS ligada sem policies já fecha para anon/authenticated,
-- mas o GRANT de tabela é outra porta. Ela nasce sem nenhum.
revoke all on table public.autopilot_position_effects from public, anon, authenticated;
grant select, insert, update on table public.autopilot_position_effects to service_role;
