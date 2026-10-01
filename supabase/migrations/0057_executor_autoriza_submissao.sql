-- ═══════════════════════════════════════════════════════════════════════
-- O CERTIFICADO COMO AUTORIDADE FINAL, DENTRO DO EXECUTOR — ROUND 2, A110.
--
-- ⚠️⚠️ O QUE AINDA FALTAVA. O Round 1 (migration 0052) criou o certificado e
-- a constraint que exige `certificate_id` em intent autônomo de compra; o
-- `avaliarCertificado` em TypeScript ficou como PRECHECK nas rotas. Mas entre
-- o precheck e o envio existia uma janela: revogar o certificado DEPOIS da
-- decisão da rota não impedia a ordem — o executor marcava SUBMITTING sem
-- perguntar nada a ninguém. Existência não é validade: a constraint garante
-- que HÁ um certificado apontado; esta RPC garante que ele VALE no instante
-- da submissão.
--
-- A PROPRIEDADE ARQUITETURAL: a autorização final do certificado é
-- TRANSACIONAL no banco, na mesma passada que marca SUBMITTING sob
-- `for update`. Não existe mais recorte temporal entre "o certificado vale" e
-- "o ponto sem volta foi registrado" DENTRO do banco.
--
-- ⚠️ JANELA RESIDUAL, DECLARADA HONESTAMENTE: uma revogação comitada DEPOIS
-- do commit desta RPC e ANTES do HTTP `createOrder` na corretora não é pega
-- por ela. Eliminar essa janela exigiria segurar o lock através de uma
-- chamada externa — o que transformaria qualquer lentidão da corretora em
-- lock de banco. É o menor recorte possível sem esse custo, e fica declarado
-- aqui em vez de escondido em "agora é transacional".
--
-- ⚠️⚠️ EXCEÇÃO DOCUMENTADA — SELL É ISENTA. Certificado porteia ENTRADA, que
-- é tomar risco. Exigi-lo para VENDER seria exigir licença para REDUZIR
-- exposição: uma estratégia revogada ficaria com a posição presa, sem poder
-- sair — o mecanismo de segurança criando exatamente o perigo que existe
-- para evitar. Uma estratégia revogada ainda consegue vender, e é o
-- comportamento desejado (mesma decisão da constraint na 0052).
--
-- ⚠️ ACL NA MESMA MIGRATION — lição do A116: função `security definer` que
-- nasce exposta a PUBLIC/anon/authenticated é um achado esperando a varredura
-- seguinte. Esta nasce fechada: só `service_role` executa.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.cex_autorizar_e_submeter(
  p_intent_id uuid,
  p_strategy_hash text,
  p_venue text,
  p_symbol text,
  p_notional numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_intent public.cex_execution_intents%rowtype;
  v_cert   public.strategy_certificates%rowtype;
  v_teto   numeric;
begin
  -- ⚠️ O INTENT É A AUTORIDADE SOBRE SI MESMO. A RPC não acredita em
  -- parâmetro sobre QUEM o intent é: lê `autonomous`, `side`, `simulated`,
  -- `strategy_id`, `strategy_version` e `certificate_id` da própria linha,
  -- sob lock. Quem chama informa apenas o que o intent não guarda: o hash
  -- dos parâmetros com que a estratégia vai rodar, a venue, o símbolo e o
  -- nocional desta ordem.
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
    -- ⚠️ O hash amarra o certificado ao conteúdo dos parâmetros. Ausente ou
    -- divergente, a evidência é de outra hipótese — e não medimos não passa.
    if p_strategy_hash is null or p_strategy_hash <> v_cert.strategy_hash then
      return jsonb_build_object('ok', false, 'porque', 'strategy_hash nao confere');
    end if;
    if not (p_venue = any(v_cert.allowed_venues)) then
      return jsonb_build_object('ok', false,
        'porque', 'venue ' || coalesce(p_venue, '?') || ' fora do certificado');
    end if;
    if not (p_symbol = any(v_cert.allowed_symbols)) then
      return jsonb_build_object('ok', false,
        'porque', 'simbolo ' || coalesce(p_symbol, '?') || ' fora do certificado');
    end if;
    -- ⚠️ O teto é o envelope da evidência. Com teto definido, nocional
    -- desconhecido NÃO passa — "não medimos" nunca vira "cabe".
    v_teto := nullif(v_cert.risk_limits ->> 'maxTradeUsd', '')::numeric;
    if v_teto is not null and (p_notional is null or p_notional > v_teto) then
      return jsonb_build_object('ok', false,
        'porque', 'nocional ' || coalesce(p_notional::text, 'desconhecido')
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

comment on function public.cex_autorizar_e_submeter is
  'Autorizacao final transacional do certificado + marcacao SUBMITTING, numa transacao so (A110, round 2). SELL e simulado isentos por decisao documentada.';

-- ─────────────────────────────────────────────────────────────────────────
-- ACL — NASCE FECHADA (lição A116). Só a service_role executa.
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.cex_autorizar_e_submeter(uuid, text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.cex_autorizar_e_submeter(uuid, text, text, text, numeric)
  to service_role;
