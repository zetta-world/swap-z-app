-- ═══════════════════════════════════════════════════════════════════════════
-- 0081 — R4/M4 (Admin CC 2.0): search_path = public, pg_temp nas 9 SECURITY
-- DEFINER sem pg_temp e nas 5 INVOKER do advisor function_search_path_mutable
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Com `search_path = public` (sem pg_temp), o esquema temporário é buscado
-- PRIMEIRO para relações — e PUBLIC tem TEMP. Uma definer que resolve nome de
-- tabela sem qualificar podia achar uma tabela temporária de quem chama.
-- Hoje o EXECUTE dessas 9 é só postgres/service_role (risco R5, baixo), mas
-- o padrão certo é o das outras 27: `public, pg_temp` (pg_temp por último).
--
-- As 5 INVOKER são SQL immutable sem search_path (advisor WARN). O SET impede
-- inlining — irrelevante nos volumes atuais (`autopilot_*`/`cex_*` vazias).
--
-- POR NOME, não por assinatura fixa: aplica a TODAS as sobrecargas do nome
-- (a 02_acl_rls_substituicao prova que não há sobrecarga). Nome ausente =
-- aviso, não falha.
--
-- ROLLBACK: `alter function … set search_path = public` (as 9) /
-- `alter function … reset search_path` (as 5).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  fn regprocedure;
  nome text;
  nomes text[] := array[
    -- 9 SECURITY DEFINER
    'bancada_marcar_adiado','bancada_gravar_ultimos_tiques','bancada_tique_liberar',
    'bancada_tique_arrendar','bancada_reservar_rodada','bancada_abrir_posicao_papel',
    'celeiro_reverter_genoma','cex_recalcular_intent','cex_transicionar',
    -- 5 INVOKER (advisor)
    'cex_transicao_permitida','autopilot_projecao_pendente','autopilot_taxa_do_intent_em_usd',
    'autopilot_efeito_incompleto','autopilot_compromisso_vivo'
  ];
  achou int;
begin
  foreach nome in array nomes loop
    achou := 0;
    for fn in select p.oid::regprocedure from pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = nome loop
      execute format('alter function %s set search_path = public, pg_temp', fn);
      achou := achou + 1;
    end loop;
    if achou = 0 then raise notice '0081: public.% ausente — pulada', nome; end if;
  end loop;
end $$;
