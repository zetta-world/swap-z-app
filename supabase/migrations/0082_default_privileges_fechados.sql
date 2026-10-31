-- ═══════════════════════════════════════════════════════════════════════════
-- 0082 — R4/M2 (Admin CC 2.0): objeto NOVO em public nasce fechado
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A causa raiz das 34 tabelas abertas (0079) é o DEFAULT PRIVILEGES do papel
-- `postgres` em `public`: toda tabela/sequência/função nova nasce com ALL para
-- anon/authenticated. Cada migration desde a 0067 fechou à mão as suas — e a
-- próxima que esquecer reabre o buraco. Aqui o padrão muda:
--
--   · tabelas, sequências e funções novas de `postgres` em `public`: sem
--     grant para anon/authenticated (service_role mantém o seu);
--   · GLOBAL: `revoke execute on functions from public` para `postgres`.
--     ⚠️ A forma por schema (`in schema public … from public`) NÃO remove o
--     EXECUTE a PUBLIC — ele é default global do PostgreSQL e o per-schema só
--     SOMA. (Correção do desenho em ADMIN-SSO-MFA-RBAC-DESIGN.md.) Vale para
--     toda função criada por `postgres` em qualquer schema, inclusive extensão
--     instalada por ele: conferir Q3/Q8 após `create extension`.
--
-- Só afeta objetos FUTUROS. Nenhum objeto existente muda.
--
-- Fora do alcance: default privileges de `supabase_admin` (exigem papel que
-- `postgres` não tem — residual registrado; hoje nenhum objeto de public é dele).
--
-- ROLLBACK: `alter default privileges for role postgres in schema public
-- grant all on tables/sequences/functions to anon, authenticated;` e
-- `alter default privileges for role postgres grant execute on functions to public;`.
-- ═══════════════════════════════════════════════════════════════════════════
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
