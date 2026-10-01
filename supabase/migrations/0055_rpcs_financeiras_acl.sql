-- ═══════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER SEM ACL É PORTA ABERTA — achado A116 (Round 2)
--
-- ⚠️⚠️ A VARREDURA DE PRODUÇÃO (16/09) mediu as cinco funções abaixo com
-- EXECUTE para PUBLIC, anon e authenticated. São funções `security definer`
-- que mexem em DINHEIRO: gravam fills, mudam o estado de um intent de
-- execução e revertem o genoma de um agente. Com o anon key público do
-- PostgREST, qualquer um na internet podia chamá-las direto — burlando toda
-- a cadeia de autorização da aplicação, que vive NAS ROTAS.
--
-- `bancada_marcar_adiado` (0045) já estava correta — revogada na própria
-- migration que a cria. Este arquivo aplica o mesmo padrão às cinco que
-- ficaram para trás, e a guarda estrutural
-- (`src/lib/cex/execucao/rpcs-acl.test.ts`) impede que uma sexta nasça sem.
--
-- ⚠️ QUEM CHAMA DE VERDADE é o backend com a service_role (as rotas e os
-- crons), então o GRANT explícito abaixo é o que mantém o caminho legítimo
-- de pé. A verificação real em produção (anon → 42501, service_role → ok)
-- é feita pelo orquestrador via Supabase MCP após aplicar.
-- ═══════════════════════════════════════════════════════════════════════

-- ── cex_recalcular_intent: a única porta por onde `filled_qty` muda ──
revoke execute on function public.cex_recalcular_intent(uuid)
  from public, anon, authenticated;
grant execute on function public.cex_recalcular_intent(uuid)
  to service_role;

-- ── cex_ingest_trades: grava fills (fatos financeiros) ──
revoke execute on function public.cex_ingest_trades(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.cex_ingest_trades(uuid, text, jsonb)
  to service_role;

-- ── cex_ingest_order_snapshot: grava fills sintéticos ──
revoke execute on function public.cex_ingest_order_snapshot(uuid, text, numeric, numeric, numeric, numeric, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cex_ingest_order_snapshot(uuid, text, numeric, numeric, numeric, numeric, text, timestamptz)
  to service_role;

-- ── cex_transicionar: move o intent na máquina de estados ──
revoke execute on function public.cex_transicionar(uuid, public.cex_intent_state, text, text)
  from public, anon, authenticated;
grant execute on function public.cex_transicionar(uuid, public.cex_intent_state, text, text)
  to service_role;

-- ── celeiro_reverter_genoma: muda genoma/parâmetros financeiros (0048) ──
revoke execute on function public.celeiro_reverter_genoma(text)
  from public, anon, authenticated;
grant execute on function public.celeiro_reverter_genoma(text)
  to service_role;
