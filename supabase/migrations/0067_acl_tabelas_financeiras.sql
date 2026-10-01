-- ═══════════════════════════════════════════════════════════════════════════
-- 0067 — ACL DAS TABELAS FINANCEIRAS (Platform Closure Batch 3)
-- Finding: DB-ACL-FINANCIAL-TABLES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ AS TABELAS FINANCEIRAS SÃO SERVER-SIDE / SERVICE_ROLE ONLY.
--
-- ONDE ISTO FOI ACHADO. A Release Phase 2 rodou o arnês SQL num PostgreSQL
-- 17.6 com os DEFAULT PRIVILEGES reproduzidos do Supabase de produção
-- (`pg_default_acl` de `postgres` e `supabase_admin` no schema `public`). Ali,
-- toda tabela criada em `public` nasce com ALL (arwdDxtm) para `anon`,
-- `authenticated` e `service_role`. O teste certificado
-- `supabase/tests/02_acl_rls_substituicao.sql` / T10c — "anon não tem SELECT
-- nas tabelas financeiras" — reprovou em `autopilot_positions`. Em PostgreSQL
-- puro ele passava porque esses defaults não existem lá: o teste estava certo,
-- o ambiente de prova é que não era o de produção.
--
-- ⚠️ POR QUE RLS NÃO SUBSTITUI ACL. As cinco tabelas têm RLS ligada e ZERO
-- policies, e isso de fato devolve 0 linhas para SELECT e recusa INSERT/UPDATE
-- de `anon`. Mas RLS NÃO SE APLICA A TRUNCATE: medido na Phase 2, `anon`
-- executou `truncate public.cex_fills` com sucesso (em transação revertida,
-- banco descartável). REFERENCES e TRIGGER também não passam por RLS. RLS é a
-- segunda porta; o GRANT de tabela é a primeira, e ela estava aberta.
--
-- ⚠️ O PADRÃO JÁ EXISTIA. A 0064 criou `autopilot_position_effects` com
-- `revoke all on table ... from public, anon, authenticated` explícito — e por
-- isso ela nasceu fechada mesmo sob os defaults do Supabase. As quatro tabelas
-- mais antigas nasceram antes desse cuidado e ficaram com os grants da
-- plataforma. Esta migration RETROFITA o mesmo padrão nelas e reafirma o da
-- quinta, para que a lista fique completa num lugar só.
--
-- O QUE ELA NÃO FAZ, DE PROPÓSITO:
--   · não toca `service_role` — a aplicação acessa estas tabelas SOMENTE pelo
--     service role (`getSupabaseAdmin`), e os privilégios dele ficam como estão;
--   · não altera owner, RLS, policies, constraints, funções nem dados;
--   · não mexe em DEFAULT PRIVILEGES (isso é da plataforma, e mudaria todas as
--     tabelas futuras);
--   · não amplia para as outras tabelas de `public` — o escopo é o finding.
--
-- IDEMPOTENTE: REVOKE de privilégio já ausente é no-op em PostgreSQL.

revoke all on table public.cex_execution_intents      from public, anon, authenticated;
revoke all on table public.cex_fills                  from public, anon, authenticated;
revoke all on table public.cex_conexoes               from public, anon, authenticated;
revoke all on table public.autopilot_positions        from public, anon, authenticated;
revoke all on table public.autopilot_position_effects from public, anon, authenticated;
