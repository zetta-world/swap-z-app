-- ═══════════════════════════════════════════════════════════════════════════
-- 0066 — DCA SAFETY ACCOUNTING (Batch 2: A58 + A59)
-- Base autoritativa: a5bdd61d9915c84799d200b22645fe85de7ee4b5
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A58: fecha o TOCTOU PAUSAR/ENCERRAR → nova submissão DCA na MESMA fronteira
-- transacional que já marca SUBMITTING. A versão desta RPC é a resultante da
-- 0064; todos os gates do Round 9 são preservados. O acréscimo DCA ocorre só
-- para origin='dca_cron'. O lock NÃO atravessa HTTP: esta função comita antes
-- de createOrder.
--
-- A59: o teto diário REAL deixa de depender de `dca_ciclos.status='feito'`.
-- A função abaixo deriva o risco das autoridades já existentes:
-- `cex_execution_intents` + `cex_fills`. Não cria ledger paralelo.

-- ──────────────────────────────────────────────────────────────────────────
-- A58 — AUTORIZAÇÃO FINAL DCA LÊ/LOCKA O PLANO
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.cex_autorizar_e_submeter(
  p_intent_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_cert   public.strategy_certificates%rowtype;
  v_teto   numeric;
  v_s      public.autopilot_sessions%rowtype;
  v_hoje   text;
  v_virou  boolean;
  v_pnl    numeric;
  v_freeze text;
  v_plano  public.dca_planos%rowtype;
begin
  -- ⚠️⚠️ O INTENT É A AUTORIDADE SOBRE TUDO. A RPC não acredita em parâmetro
  -- NENHUM sobre a ordem: lê `autonomous`, `side`, `simulated`, `strategy_id`,
  -- `strategy_version`, `certificate_id`, `exchange_id` (venue), `symbol`,
  -- `requested_notional_usd` (nocional) e `strategy_hash` da própria linha,
  -- sob lock. O caller não tem COMO mentir: a assinatura não recebe nada além
  -- do id.
  select * into v_intent from public.cex_execution_intents
   where id = p_intent_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'porque', 'intent nao existe');
  end if;

  if v_intent.state not in ('AUTHORIZED', 'RESERVED') then
    return jsonb_build_object('ok', false,
      'porque', 'estado ' || v_intent.state || ' nao admite submissao');
  end if;

  -- A58 — somente NOVA submissão DCA passa por aqui. Recovery não chama esta
  -- RPC, portanto um intent histórico continua reconciliável mesmo se o plano
  -- foi pausado/encerrado depois.
  --
  -- Fronteira provada:
  --   pause/encerrar COMMIT primeiro -> este FOR UPDATE vê status != ativo e
  --                                     recusa antes de SUBMITTING;
  --   auth COMMIT primeiro           -> SUBMITTING já foi gravado e é o ponto
  --                                     sem volta; pause posterior não apaga o
  --                                     fato nem segura lock durante HTTP.
  if v_intent.origin = 'dca_cron' then
    if v_intent.plan_id is null then
      return jsonb_build_object('ok', false,
        'porque', 'dca_cron sem plan_id — nova submissao recusada');
    end if;

    select * into v_plano from public.dca_planos
     where id = v_intent.plan_id for update;
    if not found then
      return jsonb_build_object('ok', false,
        'porque', 'plano DCA inexistente na autorizacao final');
    end if;
    if v_plano.status <> 'ativo' then
      return jsonb_build_object('ok', false,
        'porque', 'plano DCA ' || v_plano.status || ' na autorizacao final');
    end if;
  end if;

  -- ── A VALIDAÇÃO — só entrada autônoma com dinheiro de verdade ─────────
  -- Manual tem um humano como sujeito; simulado não move dinheiro; SELL é a
  -- exceção documentada no cabeçalho. Todo o resto deste caminho exige
  -- certificado VIVO e COERENTE, conferido aqui, não na rota.
  if v_intent.autonomous and v_intent.side = 'buy' and not v_intent.simulated then
    /**
     * ⚠️⚠️⚠️ O ESTADO FINANCEIRO ENTRA NA AUTORIZAÇÃO FINAL — blocker do
     * retest independente.
     *
     * O precheck financeiro (`autorizarAumentoDeExposicao`, nos dois canais)
     * lê o banco imediatamente antes das reservas. Entre esse `select` e ESTA
     * transação ainda cabe um writer financeiro: o recovery aplica P&L e
     * congela o dia, a projeção levanta `contabilidade_incompleta_em`, a
     * reconciliação grava quarentena. Tudo isso COMITA antes do SUBMITTING —
     * e a autorização final não sabia de nada disso.
     *
     * A janela era pequena. Pequena não é fechada: a propriedade que o
     * produto precisa é "se o loss-stop já foi atingido e COMITADO antes da
     * autorização final, nenhuma BUY nova sai". Só dá para afirmar isso se o
     * estado financeiro for lido na MESMA transação que vira RESERVED →
     * SUBMITTING.
     *
     * ⚠️ ORDEM DOS LOCKS: intent (acima) → sessão. É a mesma ordem de
     * `autopilot_reservar_exposicao_do_intent` e da cadeia
     * projeção/liquidação → `autopilot_aplicar_pnl`. Inverter aqui criaria
     * deadlock com elas.
     *
     * ⚠️ E O LOCK NÃO ATRAVESSA HTTP: esta transação COMMITA antes de o
     * executor chamar `createOrder`.
     *
     * ⚠️ ESCOPO: só as origens do autopilot. DCA é `autonomous` também e não
     * tem linha em `autopilot_sessions` — o gate financeiro dele é outro, e
     * prendê-lo aqui seria quebrar um produto para consertar o outro.
     */
    if v_intent.origin in ('autopilot_browser', 'autopilot_cron') then
      if v_intent.session_id is null then
        return jsonb_build_object('ok', false,
          'porque', 'compra autonoma do autopilot sem sessao — sem ela nao se afirma limite nenhum');
      end if;
      select * into v_s from public.autopilot_sessions
       where id = v_intent.session_id for update;
      if not found then
        return jsonb_build_object('ok', false, 'porque', 'sessao do piloto inexistente');
      end if;

      -- ⚠️ Contador e congelamento de ONTEM não valem hoje. Quem carimba o
      -- dia é `autopilot_aplicar_pnl`, junto do resultado.
      v_hoje   := (current_timestamp at time zone 'UTC')::date::text;
      v_virou  := v_s.last_reset_day is not distinct from v_hoje;
      v_pnl    := case when v_virou then coalesce(v_s.pnl_today, 0) else 0 end;
      v_freeze := case when v_virou then v_s.frozen_until_day else null end;

      if not v_s.is_active then
        return jsonb_build_object('ok', false, 'porque', 'sessao do piloto PARADA');
      end if;
      if v_s.expires_at is null or v_s.expires_at <= now() then
        return jsonb_build_object('ok', false, 'porque', 'sessao do piloto expirada');
      end if;
      if v_freeze is not distinct from v_hoje then
        return jsonb_build_object('ok', false,
          'porque', 'sessao congelada hoje pelo stop de perda diaria');
      end if;
      -- ⚠️ O NÚMERO, não só a marca: o freeze pode ter ficado para trás.
      if coalesce(v_s.daily_loss_stop_usd, 0) > 0
         and v_pnl <= -v_s.daily_loss_stop_usd then
        return jsonb_build_object('ok', false,
          'porque', 'stop de perda ja atingido: pnl_today ' || v_pnl::text
                    || ' contra ' || v_s.daily_loss_stop_usd::text);
      end if;
      if v_s.contabilidade_incompleta_em is not null then
        return jsonb_build_object('ok', false,
          'porque', 'contabilidade incompleta desde '
                    || v_s.contabilidade_incompleta_em::text
                    || ' — o P&L realizado nao e afirmavel');
      end if;
      if v_s.quarentena_em is not null then
        return jsonb_build_object('ok', false,
          'porque', 'sessao em quarentena por deriva de inventario');
      end if;
    end if;

    if v_intent.certificate_id is null then
      return jsonb_build_object('ok', false,
        'porque', 'compra autonoma sem certificate_id — a constraint falhou ou foi contornada');
    end if;

    select * into v_cert from public.strategy_certificates
     where id = v_intent.certificate_id;
    if not found then
      return jsonb_build_object('ok', false, 'porque', 'certificado inexistente');
    end if;
    -- ⚠️ INVARIANTE 14, agora no limiar: revogar fecha a torneira NA HORA,
    -- não na próxima passada da rota.
    if v_cert.revoked_at is not null then
      return jsonb_build_object('ok', false,
        'porque', 'certificado revogado em ' || v_cert.revoked_at::text);
    end if;
    if v_cert.valid_from > now() then
      return jsonb_build_object('ok', false, 'porque', 'certificado ainda nao vigente');
    end if;
    if v_cert.valid_until is not null and v_cert.valid_until <= now() then
      return jsonb_build_object('ok', false,
        'porque', 'certificado expirou em ' || v_cert.valid_until::text);
    end if;
    -- ⚠️ O certificado é da MESMA estratégia/versão do intent? A FK garante
    -- que o id existe; NÃO garante que aponta para a estratégia certa.
    if v_cert.strategy_id is distinct from v_intent.strategy_id
       or v_cert.strategy_version is distinct from v_intent.strategy_version then
      return jsonb_build_object('ok', false,
        'porque', 'certificado de outra estrategia ou versao');
    end if;
    -- ⚠️ O hash amarra o certificado ao conteúdo dos parâmetros. Agora ele
    -- vem DO INTENT (gravado na criação, do ctx do caller legítimo) — ausente
    -- ou divergente, a evidência é de outra hipótese, e não medimos não passa.
    if v_intent.strategy_hash is null or v_intent.strategy_hash <> v_cert.strategy_hash then
      return jsonb_build_object('ok', false, 'porque', 'strategy_hash nao confere');
    end if;
    -- ⚠️ VENUE E SÍMBOLO VÊM DO INTENT. O certificado é conferido contra o
    -- que foi gravado antes de qualquer efeito externo — não contra o que
    -- alguém afirmou no instante da submissão.
    if not (v_intent.exchange_id = any(v_cert.allowed_venues)) then
      return jsonb_build_object('ok', false,
        'porque', 'venue ' || coalesce(v_intent.exchange_id, '?') || ' fora do certificado');
    end if;
    if not (v_intent.symbol = any(v_cert.allowed_symbols)) then
      return jsonb_build_object('ok', false,
        'porque', 'simbolo ' || coalesce(v_intent.symbol, '?') || ' fora do certificado');
    end if;
    -- ⚠️ O teto é o envelope da evidência, contra o nocional DURÁVEL do
    -- intent. Com teto definido, nocional desconhecido NÃO passa — "não
    -- medimos" nunca vira "cabe".
    v_teto := nullif(v_cert.risk_limits ->> 'maxTradeUsd', '')::numeric;
    if v_teto is not null and (v_intent.requested_notional_usd is null
       or v_intent.requested_notional_usd > v_teto) then
      return jsonb_build_object('ok', false,
        'porque', 'nocional ' || coalesce(v_intent.requested_notional_usd::text, 'desconhecido')
                  || ' acima do teto certificado ' || v_teto::text);
    end if;
  end if;

  -- ── A SUBMISSÃO — mesma autoridade da `cex_transicionar` ──────────────
  -- A legalidade da transição continua sendo decidida por UMA função. Esta
  -- RPC não abre um segundo critério de máquina de estados.
  if not public.cex_transicao_permitida(v_intent.state, 'SUBMITTING') then
    return jsonb_build_object('ok', false, 'de', v_intent.state,
      'porque', 'transicao proibida para SUBMITTING');
  end if;

  update public.cex_execution_intents
     set state         = 'SUBMITTING',
         submitting_at = now(),
         updated_at    = now()
   where id = p_intent_id;

  return jsonb_build_object('ok', true, 'de', v_intent.state, 'para', 'SUBMITTING');
end; $$;

comment on function public.cex_autorizar_e_submeter(uuid) is
  '0066 Batch 2: preserva autorizacao/certificado e gates financeiros da 0064; '
  'para origin=dca_cron, locka/rele o plano na autorizacao final e so marca '
  'SUBMITTING se o plano ainda estiver ativo (A58).';

revoke execute on function public.cex_autorizar_e_submeter(uuid)
  from public, anon, authenticated;
grant execute on function public.cex_autorizar_e_submeter(uuid)
  to service_role;

-- ──────────────────────────────────────────────────────────────────────────
-- A58 — FILA DE RECOVERY INDEPENDENTE DO STATUS DO PLANO
-- ──────────────────────────────────────────────────────────────────────────
--
-- `status = ativo` continua sendo condição para NOVA entrada. Esta função
-- responde outra pergunta: existe side effect em voo que ainda precisa ser
-- reconciliada? Um pause/encerrar posterior a SUBMITTING não pode apagar essa
-- obrigação operacional. QUARANTINED também permanece visível para o
-- tratamento correspondente.
create or replace function public.dca_planos_com_intent_vivo_para_recovery(
  p_limite int default 201
) returns setof public.dca_planos
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
    from public.dca_planos p
   where exists (
     select 1
       from public.cex_execution_intents i
      where i.origin = 'dca_cron'
        and i.plan_id = p.id
        and i.state in (
          'SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_PENDING',
          'UNKNOWN','RECONCILIATION_REQUIRED','QUARANTINED'
        )
   )
   order by p.atualizado_em asc, p.id asc
   limit greatest(1, least(coalesce(p_limite, 201), 1001));
$$;

comment on function public.dca_planos_com_intent_vivo_para_recovery(int) is
  'A58: fila de recovery DCA independente de dca_planos.status. Plano pausado, '
  'encerrado ou completo com intent vivo continua elegivel a reconciliacao; '
  'isto NAO autoriza nova entrada.';

revoke all on function public.dca_planos_com_intent_vivo_para_recovery(int)
  from public, anon, authenticated;
grant execute on function public.dca_planos_com_intent_vivo_para_recovery(int)
  to service_role;

-- ──────────────────────────────────────────────────────────────────────────
-- A59 — TETO DIÁRIO REAL DERIVADO DO INTENT + LIVRO DE FILLS
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.dca_gasto_real_comprometido_hoje(
  p_wallet_address text
) returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_desde       timestamptz := now() - interval '24 hours';
  v_total       numeric := 0;
  v_realizado   numeric;
  v_fill_qty    numeric;
  v_qtd_fills   bigint;
  v_quote       text;
  v_compromisso numeric;
  r             record;
begin
  if p_wallet_address is null or btrim(p_wallet_address) = '' then
    raise exception 'wallet ausente para teto DCA';
  end if;

  /**
   * Um intent contribui UMA vez:
   *
   *  - SUBMITTING/SUBMITTED/PARTIALLY_FILLED/CANCEL_PENDING/UNKNOWN/
   *    RECONCILIATION_REQUIRED/QUARANTINED: requested_notional_usd é o PISO;
   *    se o livro já prova fill USD-like maior, vale greatest(requested, fill).
   *
   *  - FILLED/CANCELED já resolvidos: conta somente o livro real de fills do
   *    período. CANCELED parcial, portanto, preserva só o executado.
   *
   *  - FAILED_PRE_SUBMIT / CREATED / AUTHORIZED / RESERVED: zero, porque o
   *    ponto sem volta ainda não foi alcançado.
   *
   * Intents inconclusivos são lidos SEM janela de criação: um SUBMITTED antigo
   * ainda pode representar risco hoje. Fills terminais usam a janela de 24h.
   */
  for r in
    select i.*
      from public.cex_execution_intents i
      join public.dca_planos p on p.id = i.plan_id
     where i.origin = 'dca_cron'
       and i.simulated = false
       and i.side = 'buy'
       and p.wallet_address = p_wallet_address
       and (
         i.state in ('SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_PENDING',
                     'UNKNOWN','RECONCILIATION_REQUIRED','QUARANTINED')
         or exists (
           select 1 from public.cex_fills f
            where f.intent_id = i.id
              and coalesce(f.executed_at, f.created_at) >= v_desde
         )
       )
  loop
    if r.state in ('SUBMITTING','SUBMITTED','PARTIALLY_FILLED','CANCEL_PENDING',
                   'UNKNOWN','RECONCILIATION_REQUIRED','QUARANTINED') then
      if r.requested_notional_usd is null or r.requested_notional_usd <= 0 then
        -- NULL financeiro não vira zero: sem valor comprometido afirmável, o
        -- caller recebe erro e falha fechado.
        raise exception 'intent DCA % em % sem requested_notional_usd valido', r.id, r.state;
      end if;

      -- A59 revisão: requested_notional é o piso do compromisso, NÃO um teto
      -- do que a venue pode ter preenchido. O livro durável pode provar um fill
      -- maior (ex.: requested=60, fill=80); nesse caso o orçamento precisa ver
      -- pelo menos 80. A autoridade é `cex_fills`, não `dca_ciclos`.
      select count(*), coalesce(sum(f.qty), 0), coalesce(sum(f.quote_amount), 0)
        into v_qtd_fills, v_fill_qty, v_realizado
        from public.cex_fills f
       where f.intent_id = r.id;

      if v_qtd_fills > 0
         or coalesce(r.filled_qty, 0) > 0
         or coalesce(r.filled_quote, 0) > 0 then
        v_quote := split_part(upper(coalesce(r.symbol, '')), '/', 2);
        if v_quote not in ('USD','USDT','USDC') then
          -- Há fill inconclusivo, mas a unidade conhecida é BTC/ETH/etc. Sem
          -- conversão explícita não existe número USD honesto a somar.
          raise exception 'intent DCA inconclusivo % com fill em quote nao USD-like: %', r.id, v_quote;
        end if;

        -- Se o intent diz que houve quantidade, mas o livro não consegue
        -- afirmar quantidade+quote positivas, custo desconhecido NÃO vira zero.
        if v_qtd_fills <= 0 or v_fill_qty <= 0 or v_realizado <= 0 then
          raise exception 'intent DCA inconclusivo % tem fill sem custo afirmavel', r.id;
        end if;

        v_compromisso := greatest(r.requested_notional_usd, v_realizado);
      else
        v_compromisso := r.requested_notional_usd;
      end if;

      v_total := v_total + v_compromisso;
      continue;
    end if;

    if r.state in ('FILLED','CANCELED') then
      v_quote := split_part(upper(coalesce(r.symbol, '')), '/', 2);
      if v_quote not in ('USD','USDT','USDC') then
        -- A96: filled_quote/quote_amount numa quote histórica não-USD-like não
        -- pode ser batizada de USD. Não reclassifica histórico: bloqueia a
        -- afirmação do teto até existir conversão explícita fora deste batch.
        raise exception 'intent DCA terminal % com quote nao USD-like: %', r.id, v_quote;
      end if;

      select count(*), coalesce(sum(f.quote_amount), 0)
        into v_qtd_fills, v_realizado
        from public.cex_fills f
       where f.intent_id = r.id
         and coalesce(f.executed_at, f.created_at) >= v_desde;

      if v_qtd_fills > 0 then
        if v_realizado is null or v_realizado <= 0 then
          -- Fill com quantidade real e quote total zero não é "gasto zero":
          -- é custo não afirmável. NULL/zero financeiro nunca abre o teto.
          raise exception 'fills sem quote afirmavel no intent DCA %', r.id;
        end if;
        v_total := v_total + v_realizado;
      end if;
    end if;
  end loop;

  return v_total;
end; $$;

comment on function public.dca_gasto_real_comprometido_hoje(text) is
  'A59/A96: teto real DCA derivado de cex_execution_intents + cex_fills. '
  'Inconclusivo apos SUBMITTING compromete greatest(requested_notional_usd, fill USD-like conhecido); terminal '
  'usa fills reais; FAILED_PRE_SUBMIT vale zero; quote nao USD-like/NULL '
  'financeiro falha fechado. Sem ledger paralelo.';

revoke all on function public.dca_gasto_real_comprometido_hoje(text)
  from public, anon, authenticated;
grant execute on function public.dca_gasto_real_comprometido_hoje(text)
  to service_role;
