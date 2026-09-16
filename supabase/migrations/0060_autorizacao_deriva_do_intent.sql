-- ═══════════════════════════════════════════════════════════════════════
-- A110 HARDENING — A AUTORIZAÇÃO FINAL DERIVA DO INTENT, NÃO DO CALLER.
-- ROUND 3 CIRÚRGICO.
--
-- ⚠️⚠️ O QUE A 0057 AINDA DEIXAVA ABERTO. A RPC `cex_autorizar_e_submeter`
-- já validava o certificado NO BANCO, sob `for update`, na mesma transação
-- que marca SUBMITTING — mas recebia do CALLER quatro fatos que decidem a
-- autorização: `p_strategy_hash`, `p_venue`, `p_symbol`, `p_notional`. O
-- intent durável JÁ guardava venue (`exchange_id`), símbolo (`symbol`) e
-- nocional (`requested_notional_usd`) desde a 0050; só o hash ia por fora.
-- Uma autorização cuja matéria-prima chega por parâmetro confia em quem
-- chama para dizer a verdade — e a função existia exatamente para não
-- precisar confiar. Qualquer bug ou maldade no caminho entre a sessão e a
-- RPC podia trocar o símbolo, a venue ou o nocional DEPOIS do precheck, e a
-- validação conferiria o certificado contra a mentira.
--
-- A CORREÇÃO: a assinatura nova recebe APENAS `p_intent_id`. Venue, símbolo,
-- nocional e hash são lidos DA PRÓPRIA LINHA do intent, sob o MESMO lock que
-- autoriza. O caller mentiroso deixa de ser um caso a detectar: é um caso
-- IMPOSSÍVEL DE EXPRESSAR — não existe parâmetro para mentir.
--
-- O HASH VIROU DURÁVEL: `strategy_hash` agora é coluna do intent, gravada na
-- criação pelo executor a partir do ctx (que o cron tira de
-- `s.strategy_hash` e a rota do navegador de `hashDoPiloto`). Nulo numa
-- compra autônoma real com certificado = recusa ("strategy_hash nao
-- confere"), igual antes.
--
-- A VALIDAÇÃO DO CERTIFICADO É A MESMA DA 0057, INALTERADA: revogado,
-- vigência, strategy_id+version, hash, venue, símbolo, nocional ≤ teto
-- (nocional null com teto → recusa, "não medimos nunca vira cabe"). A
-- máquina de estados continua sendo `cex_transicao_permitida`. SELL,
-- simulado e manual seguem isentos, pela mesma decisão documentada na 0057:
-- certificado porteia ENTRADA; prender a SAÍDA de uma estratégia revogada
-- seria o mecanismo de segurança criando o perigo que existe para evitar.
--
-- ⚠️ A ASSINATURA ANTIGA É APAGADA, não apenas substituída: `create or
-- replace` NÃO remove overloads — sem o `drop function` abaixo, a versão de
-- cinco parâmetros continuaria callable, com o GRANT a service_role da 0057
-- intacto, e o caminho duro ficaria convivendo com o mole. O drop é parte
-- da correção, e a guarda estrutural (executor.test.ts, bloco ⑧) exige este
-- texto.
--
-- ⚠️ JANELA RESIDUAL, herdada da 0057 e inalterada: uma revogação comitada
-- DEPOIS do commit desta RPC e ANTES do HTTP à corretora não é pega.
-- Eliminar essa janela exigiria segurar o lock através de chamada externa —
-- custo pior que o risco. Fica declarada.
--
-- ⚠️ ACL NA MESMA MIGRATION (lição A116): a assinatura nova nasce fechada —
-- só `service_role` executa.
-- ═══════════════════════════════════════════════════════════════════════

-- O hash dos parâmetros, durável. Gravado na criação do intent pelo executor.
alter table public.cex_execution_intents
  add column if not exists strategy_hash text;

-- ⚠️ A ASSINATURA VELHA MORRE AQUI. Sem este drop, o overload de cinco
-- parâmetros (que confia no caller) seguiria callable para a service_role.
drop function if exists public.cex_autorizar_e_submeter(uuid, text, text, text, numeric);

create or replace function public.cex_autorizar_e_submeter(
  p_intent_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_cert   public.strategy_certificates%rowtype;
  v_teto   numeric;
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

  -- ── A VALIDAÇÃO — só entrada autônoma com dinheiro de verdade ─────────
  -- Manual tem um humano como sujeito; simulado não move dinheiro; SELL é a
  -- exceção documentada no cabeçalho. Todo o resto deste caminho exige
  -- certificado VIVO e COERENTE, conferido aqui, não na rota.
  if v_intent.autonomous and v_intent.side = 'buy' and not v_intent.simulated then
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
  'Autorizacao final transacional do certificado + marcacao SUBMITTING, numa transacao so (A110, round 3). Deriva venue/simbolo/nocional/hash DO INTENT sob for update — o caller nao tem parametro para mentir. SELL e simulado isentos por decisao documentada.';

-- ─────────────────────────────────────────────────────────────────────────
-- ACL — NASCE FECHADA (lição A116). Só a service_role executa. A assinatura
-- antiga não precisa de revoke: foi apagada acima, e o drop leva os grants.
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.cex_autorizar_e_submeter(uuid)
  from public, anon, authenticated;
grant execute on function public.cex_autorizar_e_submeter(uuid)
  to service_role;
