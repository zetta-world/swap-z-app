-- ═══════════════════════════════════════════════════════════════════════════
-- 0080 — R4/M3 (Admin CC 2.0): EXECUTE das 4 funções INVOKER abertas e a
-- sequência de founders_sale_events fora de PUBLIC/anon/authenticated
-- ═══════════════════════════════════════════════════════════════════════════
--
-- As 36 SECURITY DEFINER já estão fechadas (só postgres/service_role). Sobraram
-- 4 INVOKER com `{=X, anon=X, authenticated=X}` — EXECUTE a PUBLIC é o padrão
-- do PostgreSQL para função nova (`docs/ADMIN-SECURITY-DB-ACL.md` §3.5):
--
--   apply_session_pnl / bump_session_trades — UPDATE em autopilot_sessions
--     (insumo de gate do autopilot); hoje só a RLS devolve 0 linhas. Código
--     morto no app (positions-server.ts / sessions.ts).
--   consume_rate_limit — usada SÓ por service_role (src/lib/rate-limit.ts).
--   cex_transicao_permitida — chamada só DENTRO de definers dono postgres.
--
-- E a sequência: a 0071 fechou `founders_sale_events`, mas não a sequência —
-- anon tinha USAGE/SELECT/UPDATE (nextval/setval).
--
-- service_role recebe EXECUTE/USAGE explícito: é a identidade do app e não
-- pode depender do grant a PUBLIC que sai aqui.
--
-- ROLLBACK: `grant execute on function … to public, anon, authenticated;` e
-- `grant usage, select, update on sequence … to anon, authenticated;`.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  f text;
  funcoes text[] := array[
    'public.apply_session_pnl(uuid,numeric,text)',
    'public.bump_session_trades(text,text,integer)',
    'public.consume_rate_limit(text,integer,integer)',
    'public.cex_transicao_permitida(public.cex_intent_state,public.cex_intent_state)'
  ];
begin
  foreach f in array funcoes loop
    if to_regprocedure(f) is null then
      raise notice '0080: % ausente — pulada', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  if to_regclass('public.founders_sale_events_seq_seq') is not null then
    revoke all on sequence public.founders_sale_events_seq_seq from public, anon, authenticated;
    grant usage, select on sequence public.founders_sale_events_seq_seq to service_role;
  else
    raise notice '0080: public.founders_sale_events_seq_seq ausente — pulada';
  end if;
end $$;
