-- ═══════════════════════════════════════════════════════════════════════════
-- 0079 — R4/M1 (Admin CC 2.0, ADM-010): TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
-- fora de PUBLIC/anon/authenticated nas 34 tabelas ainda abertas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ RLS NÃO SEGURA TRUNCATE. As 34 tabelas abaixo têm RLS ligada e zero
-- policies (devolvem 0 linhas a `anon`), mas nasceram sob os DEFAULT
-- PRIVILEGES do Supabase com ALL para `anon`/`authenticated` — e TRUNCATE
-- não passa por RLS (prova da 0067: `anon` truncou `cex_fills` num PG 17.6
-- descartável). Inventário e catálogo: `docs/ADMIN-SECURITY-DB-ACL.md` §3–§4.
--
-- ESCOPO MÍNIMO DE PROPÓSITO. Só os privilégios que o PostgREST nunca usa.
-- SELECT/INSERT/UPDATE/DELETE continuam (fechá-los é o M5, por grupo, com
-- autorização própria). Nada do app muda: todo acesso a estas tabelas é por
-- `service_role` (§4 — `getSupabaseAdmin`), que não é tocado aqui.
--
-- LISTA FECHADA, não `ALL TABLES`: tabela nova é assunto da 0082 (default
-- privileges). Tabela ausente (desvio local × hospedado) é pulada com aviso —
-- revogar o que não existe não protege nada, e falhar a cadeia por isso
-- esconderia o resto.
--
-- MAINTAIN só existe no PostgreSQL 17 (hospedado 17.6; local 16.15): emitido
-- só quando `server_version_num >= 170000`.
--
-- ROLLBACK: `grant truncate, references, trigger[, maintain] on table
-- public.<t> to anon, authenticated;` (ACL anterior em db-acl.json, Fase A).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  privs text := case when current_setting('server_version_num')::int >= 170000
                     then 'truncate, references, trigger, maintain'
                     else 'truncate, references, trigger' end;
  tabelas text[] := array[
    -- G1 identidade/tier
    'platform_admins','tier_cache','users','auth_nonces',
    -- G2 autopilot/dca
    'autopilot_sessions','autopilot_runs','dca_planos','dca_ciclos','strategy_certificates',
    -- G3 eventos/IA
    'platform_events','zion_suggestions','agent_lessons','market_brain','ulfhednar_mensagens',
    -- G4 laboratório/papel/mercado
    'paper_accounts','paper_positions','lab_strategies','lab_runs','lab_results','lab_capital_log',
    'bancada_estrategia','bancada_rodada','bancada_operacao','bancada_posicao','bancada_resultado',
    'bancada_arrendamento','celeiro_genoma','celeiro_mutacoes','celeiro_fluxos','celeiro_posicoes',
    'mercado_vela','mercado_cobertura','pro_piscina_medicao','pro_piscina_veredito'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      raise notice '0079: public.% ausente — pulada', t;
      continue;
    end if;
    execute format('revoke %s on table public.%I from public, anon, authenticated', privs, t);
  end loop;
end $$;
