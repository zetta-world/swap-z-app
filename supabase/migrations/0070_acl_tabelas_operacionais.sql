-- ═══════════════════════════════════════════════════════════════════════════
-- 0070 — ACL DAS TABELAS OPERACIONAIS (finding F-14, lane B, L-033)
-- admin_kv · rate_limits · admin_audit_log
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ ESTAS TRÊS TABELAS SÃO SERVER-SIDE / SERVICE_ROLE ONLY.
--
-- O QUE ELAS GUARDAM. `admin_kv` é o KV de operação: kill-switches
-- (`disable_cex`, `disable_swap`, `maintenance_mode`), gates do flywheel
-- (`pause_*`), capacidades de dinheiro real (`dca_real_liberado`,
-- `autopilot_cex_liberado`), o gate do early access (`disable_early_access`),
-- locks e o disjuntor de IA. `rate_limits` são os buckets de limite.
-- `admin_audit_log` é a trilha do admin. Nenhuma delas é lida ou escrita
-- pelo navegador.
--
-- POR QUE RLS NÃO BASTA (mesma prova da 0067). As três têm RLS ligada e zero
-- policies (0005, 0006, 0014), o que já devolve 0 linhas e recusa
-- INSERT/UPDATE de `anon`. Mas sob os DEFAULT PRIVILEGES do Supabase a tabela
-- nasce com ALL para `anon`/`authenticated`, e RLS NÃO se aplica a TRUNCATE:
-- `anon` com o grant da plataforma poderia truncar `admin_kv` — que apagaria
-- todos os kill-switches e capacidades de uma vez. RLS é a segunda porta; o
-- GRANT é a primeira.
--
-- PROVA DE QUE NADA DO APP DEPENDE DO GRANT (04/10, busca no código):
--   · toda leitura/escrita destas tabelas passa por `getSupabaseAdmin()`
--     (service role, `src/lib/supabase/server.ts`);
--   · o único cliente com chave anon (`AdminRealtimeProvider`) usa canal
--     BROADCAST do Realtime, não `postgres_changes` — não lê tabela.
--
-- O QUE ELA NÃO FAZ, DE PROPÓSITO (igual à 0067): não toca `service_role`;
-- não altera owner, RLS, policies, constraints, funções nem dados; não mexe
-- em DEFAULT PRIVILEGES; não amplia para outras tabelas.
--
-- IDEMPOTENTE: REVOKE de privilégio já ausente é no-op em PostgreSQL.
-- Prova: supabase/tests/17_acl_tabelas_operacionais.sql.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on table public.admin_kv        from public, anon, authenticated;
revoke all on table public.rate_limits     from public, anon, authenticated;
revoke all on table public.admin_audit_log from public, anon, authenticated;
