# Admin — Inventário real de ACL do banco (R4, somente leitura)

Status: 🟡 INVENTÁRIO MEDIDO + PLANO — **nenhuma migration escrita, nenhuma aplicada**. Este documento é o
*before-state* do R4 do `docs/PLANO-ADMIN-COMMAND-CENTER-2-20261025.md` (§4 R4, §7.D, ADM-010).

| campo | valor |
|---|---|
| medido em | 26/10/2026, projeto Supabase `vuvvftdsfmagmtbovzgq`, PostgreSQL **17.6** |
| repo | varredura em `ec63cb9`; HEAD atual `5e27a66` só acrescenta docs (`src/` e `supabase/` idênticos a `main` `10ebd12`) — branch `claude/admin-command-center-2-20261025` |
| método | MCP `execute_sql` só com catálogo (`pg_class`, `pg_proc`, `pg_default_acl`, `pg_roles`, `pg_namespace`, `pg_policy`, `pg_depend`, `information_schema`, `has_*_privilege`) e `COUNT(*)`; MCP `list_migrations`; MCP `get_advisors(security)`. **Nenhuma linha de tabela de aplicação lida; nenhum DDL/DML/GRANT/REVOKE/SET ROLE.** |
| dado bruto | `admin-cc2/db-acl.json` (scratchpad da sessão; gerado por `acl/build_db_acl2.py` a partir de `acl/raw/q01…q15`, `mig-diff2.json`, `consumers2.json`) |
| integridade da transcrição | Q3 (51 funções): md5 calculado no banco `af078577…5f8d` = md5 local da transcrição ✅ |

## 1. Números medidos × handoff

| item | handoff (25/10) | medido (26/10) | diferença |
|---|---:|---:|---|
| tabelas em `public` | 54 | **54** | 0 |
| com RLS ligada / forçada | 54 / — | **54 / 0** | 0 |
| policies em `public` | 0 | **0** | 0 |
| tabelas com TRUNCATE/REFERENCES/TRIGGER para `anon`/`authenticated` | 34 | **34** (as mesmas 34 têm ALL = `arwdDxtm`, inclusive SELECT/INSERT/UPDATE/DELETE/MAINTAIN) | 0 |
| tabelas fechadas para `anon`/`authenticated` | — | **20** (todas fechadas por migration explícita, §3.3) | — |
| funções em `public` / SECURITY DEFINER | — / 36 | **51 / 36** | 0 |
| SECURITY DEFINER sem `search_path` | 0 | **0** — mas **9** com `search_path=public` **sem `pg_temp`** | novo achado |
| SECURITY DEFINER executáveis por `anon`/`authenticated`/PUBLIC | — | **0** | — |
| funções INVOKER executáveis por PUBLIC/`anon`/`authenticated` | — | **4** (§3.5) | novo achado |
| advisor `rls_enabled_no_policy` (INFO) | 54 | **54** | 0 |
| advisor `function_search_path_mutable` (WARN) | não citado | **5** (todas INVOKER) | novo achado |
| `auth.users` | 0 | **0** (também 0 `identities`, `sessions`, `mfa_factors`, `sso_providers`) | 0 |
| `platform_admins` / `admin_audit_log` / `admin_kv` / `operations` (linhas) | 1 / 54 / 680 / 19 | **1 / 54 / 680 / 19** | 0 |
| migrations remotas / arquivos locais | — | **76 / 78** (§5) | — |

**Diferença contra o estado documentado** (não contra o handoff): `docs/START-HERE.md:72`, `docs/CURRENT-STATE.md:151`
e `docs/AUDIT-RECONCILIATION.md:497` (leitura de 14/10) dizem **35/53**. Hoje são **34/54**: a `0077` criou
`solana_tx_em_voo` já fechada (+1 tabela, +0 aberta; `0077_solana_tx_em_voo.sql:54-55`) e a `0078` fechou
`operations` (−1 aberta; `0078_operations_verificacao_onchain.sql:61-62`). Os três documentos ficam desatualizados
nesse número até a próxima atualização de estado (não editados aqui por regra da tarefa).

## 2. Consultas usadas (texto exato; todas `SELECT` de catálogo ou `COUNT(*)`)

<details><summary>Q1–Q15</summary>

```sql
-- Q1: relações por schema, RLS, policies
SELECT n.nspname AS schema,
       count(*) FILTER (WHERE c.relkind IN ('r','p')) AS tables,
       count(*) FILTER (WHERE c.relkind IN ('r','p') AND c.relrowsecurity) AS rls_on,
       count(*) FILTER (WHERE c.relkind IN ('r','p') AND c.relforcerowsecurity) AS rls_forced,
       count(*) FILTER (WHERE c.relkind = 'p') AS partitioned,
       count(*) FILTER (WHERE c.relkind = 'v') AS views, count(*) FILTER (WHERE c.relkind = 'm') AS matviews,
       count(*) FILTER (WHERE c.relkind = 'S') AS sequences,
       (SELECT count(*) FROM pg_policy p JOIN pg_class pc ON pc.oid=p.polrelid WHERE pc.relnamespace=n.oid) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%'
GROUP BY n.nspname, n.oid ORDER BY 1;

-- Q2b: tabelas de public agrupadas por ACL + privilégio efetivo por papel
WITH p AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr),
t AS (SELECT c.oid, c.relname, c.relacl::text acl, c.relrowsecurity rls,
  (SELECT count(*) FROM pg_policy x WHERE x.polrelid=c.oid) pol,
  (SELECT coalesce(string_agg(pr,',' ORDER BY pr),'') FROM p WHERE has_table_privilege('anon',c.oid,pr)) anon,
  (SELECT coalesce(string_agg(pr,',' ORDER BY pr),'') FROM p WHERE has_table_privilege('authenticated',c.oid,pr)) auth,
  (SELECT coalesce(string_agg(pr,',' ORDER BY pr),'') FROM p WHERE has_table_privilege('service_role',c.oid,pr)) svc,
  (SELECT coalesce(string_agg(pr,',' ORDER BY pr),'') FROM p WHERE has_table_privilege('public',c.oid,pr)) pub
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
SELECT acl, anon, auth, svc, pub, bool_and(rls) all_rls, sum(pol) pols, count(*) n, string_agg(relname,' ' ORDER BY relname) tables
FROM t GROUP BY acl, anon, auth, svc, pub ORDER BY n DESC;

-- Q3: funções de public (SECURITY DEFINER, proconfig, owner, ACL, EXECUTE efetivo)
SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS f, p.prosecdef AS secdef, p.prokind, l.lanname,
  array_to_string(p.proconfig,';') AS cfg, pg_get_userbyid(p.proowner) AS owner, p.proacl::text AS acl,
  has_function_privilege('anon',p.oid,'EXECUTE') x_anon, has_function_privilege('authenticated',p.oid,'EXECUTE') x_auth,
  has_function_privilege('service_role',p.oid,'EXECUTE') x_svc, has_function_privilege('public',p.oid,'EXECUTE') x_pub,
  p.prorettype::regtype::text ret, p.provolatile vol
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' ORDER BY p.prosecdef DESC, 1;
-- Q3v: md5(string_agg(f||'|'||prosecdef||'|'||coalesce(cfg,'')||'|'||proacl, E'\n' ORDER BY f COLLATE "C")) → conferido localmente

-- Q4: default privileges
SELECT pg_get_userbyid(d.defaclrole) role, coalesce(n.nspname,'<global>') schema,
  CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'f' THEN 'functions' WHEN 'S' THEN 'sequences' WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' END objtype,
  d.defaclacl::text acl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 2,1,3;

-- Q5: papéis (atributos, pertença, pg_db_role_setting) para anon, authenticated, service_role, authenticator, postgres,
--     supabase_admin, supabase_read_only_user, supabase_privileged_role, dashboard_user, supabase_*_admin, pgbouncer
SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcanlogin, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
  (SELECT string_agg(g.rolname,',' ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid) member_of,
  (SELECT string_agg(array_to_string(s.setconfig,';'),' | ') FROM pg_db_role_setting s WHERE s.setrole=r.oid) role_settings
FROM pg_roles r WHERE r.rolname IN (…lista acima…) ORDER BY 1;

-- Q6: schemas — dono, ACL, USAGE/CREATE por papel (has_schema_privilege)
-- Q7: sequências de public (has_sequence_privilege anon), attacl não nulo, pg_trigger não internos, pg_extension,
--     pg_publication (+ nº de tabelas), pg_event_trigger
-- Q8: fora de public: relações com qualquer privilégio de anon/authenticated (has_table_privilege), prosecdef por schema,
--     funções com EXECUTE para anon em auth/extensions/graphql*/realtime/storage/vault
-- Q9: COUNT(*) de auth.users, auth.identities, auth.sessions, auth.mfa_factors, auth.sso_providers, storage.buckets,
--     storage.objects, policies de storage, zswap_backup.operations_pre_0078_20261021, supabase_migrations.schema_migrations
-- Q10: SELECT json_object_agg(t,n) FROM (SELECT 'admin_audit_log' t, count(*) n FROM public.admin_audit_log UNION ALL … 54 tabelas)
-- Q11: migrations remotas — só metadados e hash, sem devolver o SQL
SELECT json_agg(json_build_array(version, name, coalesce(array_length(statements,1),0), length(array_to_string(statements,E'\n')),
  md5(array_to_string(statements,E'\n')),
  md5(btrim(regexp_replace(regexp_replace(array_to_string(statements,E'\n'),'--[^\n]*','','g'),'[ \t\n\r\f\v]+',' ','g'),' ')))
  ORDER BY version) FROM supabase_migrations.schema_migrations;
-- Q12: presença no catálogo dos objetos das migrations locais sem linha remota (information_schema.columns, pg_indexes,
--      pg_constraint, to_regclass, proconfig)
-- Q13: pg_database.datacl + has_database_privilege(anon/authenticated, CONNECT/TEMP/CREATE); tipos de public;
--      pg_settings LIKE 'pgrst.%'; pg_db_role_setting LIKE '%pgrst%'; server_version
-- Q14: funções × tabelas citadas no corpo: f.prosrc ~ ('\m'||relname||'\M') (só nomes; corpo não devolvido)
-- Q15: pg_depend das funções INVOKER (índices/constraints/defaults/views que dependam delas)
```
</details>

## 3. Before-state medido

### 3.1 Papéis (Q5)

| papel | login | bypassrls | super | pertence a | configuração |
|---|---|---|---|---|---|
| `anon` | não | não | não | — | `statement_timeout=3s` |
| `authenticated` | não | não | não | — | `statement_timeout=8s` |
| `service_role` | não | **sim** | não | — | — |
| `authenticator` | sim | não | não | `anon`, `authenticated`, `service_role` (noinherit) | `session_preload_libraries=supautils, safeupdate` |
| `postgres` (dono das 54 tabelas e das 51 funções de `public`) | sim | **sim** | não | `anon`, `authenticated`, `authenticator`, `service_role`, `pg_read_all_data`, `pg_monitor`, … | `search_path="$user", public, extensions` |
| `supabase_admin` | sim | sim | **sim** | — | — |
| `supabase_read_only_user` | sim | sim | não | `pg_read_all_data`, `pg_monitor` | `default_transaction_read_only=on` |

`postgres` **não** é membro de `supabase_admin` → uma migration do projeto não consegue alterar os default
privileges de `supabase_admin` (§7 M3). Banco: `datacl = {=Tc/postgres,…}` → PUBLIC (logo `anon`/`authenticated`)
tem `CONNECT` e **`TEMP`**; nenhum tem `CREATE` (Q13).

### 3.2 Schemas e Data API (Q1, Q6, Q7, Q13)

| schema | tabelas (RLS) | `anon` USAGE | observação |
|---|---|---|---|
| `public` | 54 (54) · 1 sequência · 1 enum (`cex_intent_state`) · 0 views | sim | dono `pg_database_owner`; nenhum papel de API tem `CREATE` |
| `auth` | 27 (16) | sim | 0 usuários; tabelas sem grant a `anon` (Q8 não as lista) |
| `storage` | 8 (8), **0 policies**, 0 buckets, 0 objetos | sim | `anon`/`authenticated` têm ALL em `objects`, `buckets`, `buckets_analytics` (padrão Supabase) |
| `realtime` | 10 (1), 1 particionada | sim | `messages`: `anon` S/I/U com RLS e 0 policies; `subscription`: S sem RLS. Partições diárias → contagem varia |
| `extensions` | 0 · 2 views | sim | `anon` SELECT em `pg_stat_statements(_info)` |
| `graphql_public` / `graphql` | — | sim | **extensão `pg_graphql` não instalada** (extensões: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`) |
| `vault` | 1 · 1 view | não (`service_role` sim) | 2 SECURITY DEFINER |
| `zswap_backup` | 1 (**RLS off**), 18 linhas | não (só `postgres`) | `operations_pre_0078_20261021`, criada pela migration remota `20261021153619` **sem arquivo no repo** |
| `supabase_migrations` | 1 | não | 76 linhas |

**Schemas expostos na Data API: NÃO VERIFICÁVEL pelo catálogo** — não há `pgrst.*` em `pg_settings` nem em
`pg_db_role_setting` (Q13); o PostgREST do Supabase recebe `db_schemas` da configuração do projeto. Pendência do dono:
conferir em Dashboard → API (padrão Supabase: `public`, `graphql_public`). Publicações: `supabase_realtime` com **0**
tabelas (nenhum `postgres_changes` possível); `supabase_realtime_messages_publication` com 7 (partições de
`realtime.messages`).

### 3.3 Tabelas de `public` — cinco padrões de ACL (Q2b)

| padrão `relacl` | `anon` / `authenticated` | `service_role` | nº |
|---|---|---|---:|
| `{postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}` | **ALL** (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) | ALL | **34** |
| `{postgres=arwdDxtm,service_role=arwdDxtm}` | nada | ALL | 10 |
| `{postgres=arwdDxtm,service_role=r}` | nada | SELECT | 6 |
| `{postgres=arwdDxtm,service_role=ar}` (+ UPDATE de coluna) | nada | INSERT, SELECT (+ `UPDATE(col)`) | 3 |
| `{postgres=arwdDxtm,service_role=ard}` | nada | DELETE, INSERT, SELECT | 1 |

PUBLIC não tem privilégio direto em nenhuma tabela. Todas: dono `postgres`, RLS ligada, não forçada, 0 policies.
As 34 abertas somam **75.466 linhas** (Q10). As 20 fechadas (cada uma por `revoke all … from public, anon,
authenticated` explícito):

| tabela | linhas | `service_role` | fechada por |
|---|---:|---|---|
| `admin_audit_log`, `admin_kv`, `rate_limits` | 54 / 680 / 290 | ALL | 0070 |
| `autopilot_position_effects` | 0 | ALL | 0064, 0067 |
| `autopilot_positions`, `cex_conexoes`, `cex_execution_intents`, `cex_fills` | 0 / 0 / 0 / 0 | ALL | 0067 |
| `early_access_consents`, `_events`, `_signups` | 0 | SELECT | 0068 |
| `early_access_purges`, `_verificacoes`, `_webhook_eventos` | 0 | SELECT | 0069 |
| `founders_allowlist_entries` | 0 | DELETE, INSERT, SELECT | 0071 |
| `founders_allowlist_snapshots` | 0 | INSERT, SELECT, `UPDATE(congelado_em)` | 0071 |
| `founders_demand_signals` | 0 | INSERT, SELECT, `UPDATE(tier_preference, intencao_nao_vinculante, fonte, atualizado_em, preco_intencao_usd)` | 0071, 0072 |
| `founders_sale_events` | 0 | INSERT, SELECT | 0071 |
| `operations` | 19 | ALL | 0078 |
| `solana_tx_em_voo` | 2 | ALL | 0077 |

Observação: onde a migration só fez `revoke … from public, anon, authenticated` + `grant select, insert, update …
to service_role` (`0064`, `0077:54-55`, `0078:61-62`), o `service_role` **continua com ALL** (inclusive TRUNCATE), porque
o grant da plataforma a ele não foi revogado. Só as famílias `early_access_*` e `founders_*` revogam também de
`service_role` e regrantam o mínimo.

### 3.4 Default privileges (Q4) — a origem das 34

24 linhas em `pg_default_acl`; nenhuma global. As que importam para `public`:

| papel criador | objeto | ACL padrão |
|---|---|---|
| `postgres` | tables | `postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm` |
| `postgres` | functions | `postgres=X, anon=X, authenticated=X, service_role=X` (+ EXECUTE a PUBLIC pelo padrão do PostgreSQL) |
| `postgres` | sequences | `postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU` |
| `supabase_admin` | tables / functions / sequences | idem, concedido por `supabase_admin` |

O mesmo padrão aberto existe para `postgres` em `storage` e para `supabase_admin` em `graphql`/`graphql_public`
(gerenciados pela plataforma). Consequência: **toda tabela criada por migration em `public` nasce com ALL para
`anon`/`authenticated`**; a proteção hoje depende de cada migration lembrar do `revoke` (padrão que só começou na
`0064`; `0067:8-23` documenta a reprovação medida em PG 17.6 com estes defaults e `anon` executando `truncate
public.cex_fills`).

### 3.5 Funções de `public` (Q3, Q14, advisors)

51 funções, todas dono `postgres`. **36 SECURITY DEFINER**, nenhuma executável por `anon`/`authenticated`/PUBLIC
(`proacl = {postgres=X, service_role=X}`), todas com `search_path` fixo:

| família | nº | `search_path` | tabelas no corpo (Q14) |
|---|---:|---|---|
| `autopilot_*` | 9 | `public, pg_temp` | `autopilot_sessions`, `autopilot_positions`, `autopilot_position_effects`, `cex_execution_intents` |
| `bancada_*` | 6 | **`public` (sem `pg_temp`)** | `bancada_estrategia`, `bancada_posicao`, `bancada_rodada`, `bancada_arrendamento` |
| `celeiro_reverter_genoma` | 1 | **`public`** | `celeiro_genoma` |
| `cex_*` | 6 | `public, pg_temp` (4) · **`public`** (`cex_recalcular_intent`, `cex_transicionar`) | `cex_execution_intents`, `cex_fills`, `cex_conexoes`, `autopilot_sessions`, `dca_planos`, `strategy_certificates` |
| `dca_*` | 2 | `public, pg_temp` | `dca_planos`, `dca_ciclos`, `cex_*` |
| `early_access_*` | 10 | `public, pg_temp` | `early_access_*` |
| `solana_tx_*` | 2 | `public, pg_temp` | `solana_tx_em_voo` |

15 INVOKER: `ea_interno_emitir/purgar` (só `postgres`), 9 só `service_role`, e **4 com EXECUTE para PUBLIC, `anon` e
`authenticated`** (`proacl = {=X, postgres=X, anon=X, authenticated=X, service_role=X}`):

| função | tipo | toca | chamada pelo app? | efeito hoje se chamada por `anon` via `/rest/v1/rpc` |
|---|---|---|---|---|
| `apply_session_pnl(uuid,numeric,text)` | SQL volatile | UPDATE `autopilot_sessions` | **não** (código morto: `src/lib/autopilot/positions-server.ts:263-267`) | roda como `anon`; `anon` tem UPDATE na tabela, **só a RLS** devolve 0 linhas |
| `bump_session_trades(text,text,integer)` | SQL volatile | UPDATE `autopilot_sessions` | **não** (`src/lib/autopilot/sessions.ts:410-413`; ausência trancada por `src/lib/autopilot/escritas-conferidas.test.ts`) | idem |
| `consume_rate_limit(text,integer,integer)` | plpgsql | `rate_limits` | sim, via `service_role` (`src/lib/rate-limit.ts:97-100`) | 42501 (`rate_limits` fechada pela 0070) |
| `cex_transicao_permitida(cex_intent_state,cex_intent_state)` | SQL immutable | — | só dentro de RPC definer (`0051_execucao_cex_rpcs.sql:258`, `0057_executor_autoriza_submissao.sql:127`) | devolve booleano da máquina de estados (sem efeito) |

Advisor WARN `function_search_path_mutable` (5): `cex_transicao_permitida`, `autopilot_projecao_pendente`,
`autopilot_taxa_do_intent_em_usd`, `autopilot_efeito_incompleto`, `autopilot_compromisso_vivo` — todas INVOKER,
SQL immutable, sem dependentes em `pg_depend` (Q15: 0 linhas). Fora de `public`: SECURITY DEFINER em `vault` (2) e
`pgbouncer` (1), da plataforma.

### 3.6 Sequência, colunas e triggers (Q7)

- `public.founders_sale_events_seq_seq`: `anon`/`authenticated` com **USAGE, SELECT, UPDATE** (`rwU`) — veio do default
  de sequências; a 0071 fechou a tabela mas não a sequência.
- ACL de coluna: só `service_role` (UPDATE) nas 6 colunas de `founders_*` listadas em §3.3.
- Triggers de `public`: 4, todos em `founders_*` (guarda de snapshot/entrada, append-only, sem TRUNCATE).
- Event triggers: só os da plataforma (`pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_*`).

## 4. Consumidores no código (Q14 + varredura `src/` e `scripts/`)

**Prova de que o app só alcança as tabelas por `service_role`:**

| evidência | arquivo |
|---|---|
| Só há **dois** `createClient` em `src/`: o de service role e o do Realtime | `src/lib/supabase/server.ts:27-38` (`getSupabaseAdmin`, `SUPABASE_SERVICE_ROLE_KEY`) · `src/components/admin/AdminRealtimeProvider.tsx:57` |
| O cliente com chave anon só assina o canal **broadcast** `admin:refresh`; não chama `.from()`/`.rpc()` | `AdminRealtimeProvider.tsx:57,67-68`; chave entregue só a admin autenticado em `src/app/admin/layout.tsx:9,15-17` |
| Único `fetch` a `/rest/v1` é o **teste negativo** com a chave anon (passa se nenhuma linha voltar) | `src/lib/admin/audit.ts:101-129` (tabelas em `:112`) |
| 101 arquivos com `.from()`/`.rpc()`: 90 importam `getSupabaseAdmin`, 10 recebem o cliente por parâmetro (de quem o importa), 1 é `scripts/mural.mjs` (service role de `.env.local`, fora do app; exige autorização do dono) | `acl/consumers2.json` |
| Nenhum `postgres_changes`; publicação `supabase_realtime` com 0 tabelas | Q7 |

Mapa das **34 tabelas abertas** (agrupadas para o plano §7 M2; `ᴰ` = SECURITY DEFINER, `ᴵ` = INVOKER):

| grupo | tabela | linhas | `.from()` (arquivos) | principais consumidores | RPC/funções que tocam | caminho |
|---|---|---:|---:|---|---|---|
| G1 | `platform_admins` | 1 | 6 (3) | `admin/api/admins`, `admin/api/traffic`, `lib/admin/require.ts` | — | service_role |
| G1 | `tier_cache` | 5 | 21 (13) | `admin/api/admins`, `admin/api/finance`, `admin/api/growth`, `admin/api/margin` +9 | — | service_role |
| G1 | `users` | 4 | 18 (7) | `admin/api/command`, `admin/api/growth`, `admin/api/stats`, `admin/api/tier` +3 | — | service_role |
| G1 | `auth_nonces` | 2 | 2 (2) | `api/auth/verify`, `lib/auth/challenge.ts` | — | service_role |
| G2 | `autopilot_sessions` | 0 | 23 (8) | `admin/api/command`, `admin/api/growth`, `admin/api/stats`, `admin/api/users` +4 | `autopilot_aplicar_pnl`ᴰ, `autopilot_marcar_contabilidade`ᴰ, `autopilot_rearm_preserva_rails`ᴰ, `autopilot_reservar_exposicao_do_intent`ᴰ, `cex_autorizar_e_submeter`ᴰ, `apply_session_pnl`ᴵ, `bump_session_trades`ᴵ | service_role |
| G2 | `autopilot_runs` | 0 | 5 (3) | `admin/api/operations`, `admin/api/stats`, `lib/autopilot/sessions.ts` | — | service_role |
| G2 | `dca_planos` | 1 | 7 (1) | `lib/dca/store.ts` | `cex_autorizar_e_submeter`ᴰ, `dca_gasto_real_comprometido_hoje`ᴰ, `dca_planos_com_intent_vivo_para_recovery`ᴰ | service_role |
| G2 | `dca_ciclos` | 3 | 5 (1) | `lib/dca/store.ts` | `dca_gasto_real_comprometido_hoje`ᴰ | service_role |
| G2 | `strategy_certificates` | 0 | 1 (1) | `lib/autopilot/certificado.ts` | `cex_autorizar_e_submeter`ᴰ | service_role |
| G3 | `platform_events` | 51226 | 30 (18) | `admin/api/alerts`, `admin/api/analytics`, `admin/api/arbiter-cohort`, `admin/api/command` +14 | — | service_role |
| G3 | `zion_suggestions` | 5938 | 27 (17) | `admin/api/aprendizado`, `admin/api/backtest`, `admin/api/command`, `admin/api/ragnarok` +13 | — | service_role |
| G3 | `agent_lessons` | 34 | 4 (2) | `admin/api/aprendizado`, `lib/zion/retro.ts` | — | service_role |
| G3 | `market_brain` | 5 | 2 (1) | `lib/zion/market-brain.ts` | — | service_role |
| G3 | `ulfhednar_mensagens` | 15 | 6 (2) | `lib/ulfhednar/mensagens.ts`, `scripts/mural.mjs` | — | service_role (+ script) |
| G4 | `paper_accounts` | 23 | 26 (12) | `admin/api/arbiter-cohort`, `admin/api/paper`, `admin/api/ragnarok`, `admin/api/tournament` +8 | — | service_role |
| G4 | `paper_positions` | 3497 | 27 (12) | idem `paper_accounts` | — | service_role |
| G4 | `lab_strategies` | 29 | 7 (3) | `admin/api/autopilot-liberacao`, `admin/api/lab/ultima`, `lib/lab/store.ts` | — | service_role |
| G4 | `lab_runs` | 100 | 7 (2) | `admin/api/lab/ultima`, `lib/lab/store.ts` | — | service_role |
| G4 | `lab_results` | 100 | 3 (1) | `lib/lab/store.ts` | — | service_role |
| G4 | `lab_capital_log` | 0 | 1 (1) | `lib/lab/store.ts` | — | service_role |
| G4 | `bancada_estrategia` | 3 | 9 (1) | `lib/bancada/store.ts` | `bancada_abrir_posicao_papel`ᴰ, `bancada_gravar_ultimos_tiques`ᴰ, `bancada_marcar_adiado`ᴰ | service_role |
| G4 | `bancada_rodada` | 9 | 4 (1) | `lib/bancada/store.ts` | `bancada_reservar_rodada`ᴰ | service_role |
| G4 | `bancada_operacao` | 47 | 1 (1) | `lib/bancada/store.ts` | — | service_role |
| G4 | `bancada_posicao` | 2 | 3 (1) | `lib/bancada/store.ts` | `bancada_abrir_posicao_papel`ᴰ | service_role |
| G4 | `bancada_resultado` | 9 | 1 (1) | `lib/bancada/store.ts` | — | service_role |
| G4 | `bancada_arrendamento` | 0 | 0 (0) | — | `bancada_tique_arrendar`ᴰ, `bancada_tique_liberar`ᴰ | só RPC definer |
| G4 | `celeiro_genoma` | 19 | 6 (1) | `lib/celeiro/store.ts` | `celeiro_reverter_genoma`ᴰ | service_role |
| G4 | `celeiro_mutacoes` | 9 | 6 (1) | `lib/celeiro/store.ts` | — | service_role |
| G4 | `celeiro_fluxos` | 2290 | 5 (2) | `admin/api/celeiro`, `lib/celeiro/store.ts` | — | service_role |
| G4 | `celeiro_posicoes` | 318 | 6 (3) | `admin/api/celeiro`, `api/celeiro/cron`, `lib/celeiro/store.ts` | — | service_role |
| G4 | `mercado_vela` | 11651 | 2 (1) | `lib/mercado/store.ts` | — | service_role |
| G4 | `mercado_cobertura` | 3 | 2 (1) | `lib/mercado/store.ts` | — | service_role |
| G4 | `pro_piscina_medicao` | 69 | 1 (1) | `admin/api/pro-piscinas` | — | service_role |
| G4 | `pro_piscina_veredito` | 54 | 1 (1) | `admin/api/pro-piscinas` | — | service_role |

Contagem de `.from()` inclui chamadas por constante (`.from(TABELA)`, ex.: `src/lib/dca/store.ts:98`,
`src/lib/ulfhednar/mensagens.ts:61`). Sítios dinâmicos não resolvidos: `src/lib/admin/audit.ts:92` (checagem de schema
por service role) e `src/lib/bancada/store.ts:41` (união fechada de tabelas `bancada_*`). Testes de integração já
exercitam `anon`/`authenticated` só para **negação** (`bench/integracao/postgrest.integration.ts:105-120`).

**Conclusão:** nenhum caminho do app usa privilégio de tabela de `anon`/`authenticated`. Os grants abertos não têm
consumidor; a RLS sem policy é a única barreira para DML e **nenhuma** barreira para TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.

## 5. Migrations: remoto × repo (Q11, Q12, `acl/mig_diff2.py`)

| medida | valor |
|---|---:|
| linhas em `schema_migrations` / arquivos `supabase/migrations/*.sql` | 76 / 78 |
| pareadas por nome (com ou sem prefixo numérico) | 69 |
| pareada por conteúdo normalizado idêntico (rename) | 1 (`20260613104306 admin_wallet_solana2` = `0003_admin_wallet_phantom.sql`) |
| conteúdo normalizado igual / diferente (entre as 70 pareadas) | 55 / 15 |
| remotas **sem arquivo** | 6 |
| arquivos **sem linha remota** | 8 |

- **Remotas sem arquivo:** `20260823182219 celeiro_motivo_saida_liquidacao` (provável equivalente de `0049`, cujo
  `CHECK` com `liquidacao` está no banco; hash difere) · `20260914084234 indice_vitrine_das_mesas` +
  `20260914084311 desfaz_indice_vitrine_sem_ganho_medido` (cria e desfaz índice; efeito líquido nulo) ·
  `20260915180419 execucao_cex_rls` (provavelmente embutida em `0050`, que difere no hash) ·
  `20260916021505 0050_celeiro_alavancado_geometria_medida` (número colide com `0050_execucao_cex_intents_e_fills.sql`;
  `0049:16-17` cita o tema — não verificado por hash) · `20261021153619 backup_operations_pre_0078_20261021` (cria
  `zswap_backup.operations_pre_0078_20261021`, 18 linhas, RLS off, acesso só `postgres`).
- **Arquivos sem linha remota** (`0004`, `0014`, `0015`, `0016`, `0019`, `0026`, `0034`, `0049`): **todos os objetos
  presentes no banco** (Q12: tabelas, colunas, 7 índices, `CHECK` e `search_path` das 3 funções da `0026`) — foram
  aplicados por outro caminho (SQL editor) antes do registro.
- **Conteúdo diferente com o mesmo nome (15):** `0001`, `0002`, `0021`, `0025`, `0027`, `0030`, `0031`, `0032`, `0033`,
  `0048`, `0050`, `0051`, `0052`, `0053`, `0058` (lista em `acl/mig-diff2.json`). O repo não reconstrói o banco
  byte a byte; a prova de equivalência é o catálogo, não o histórico.

Gate R4 ("migrações reconciliadas remoto↔repo") **não está cumprido**. Reconciliar exige escrever em
`supabase_migrations.schema_migrations` do hospedado (`supabase migration repair`) ou aceitar o desvio documentado —
decisão do dono; nada feito aqui.

## 6. Riscos (ordenados)

| # | risco | evidência | severidade hoje | explorável hoje? |
|---|---|---|---|---|
| R1 | **RLS é a única barreira de DML nas fontes de autorização admin.** `anon` tem INSERT/UPDATE/DELETE em `platform_admins` e `tier_cache`, lidas por `requireAdmin` (`src/lib/admin/require.ts:57,69,77`). Desligar RLS ou criar uma policy permissiva (o próprio advisor sugere "criar policy") daria admin a quem tem a chave anon — que o app entrega ao navegador de todo admin (`src/app/admin/layout.tsx:15-17`) | Q2b, §4 | **Alta (condicional)** | não — RLS ligada, 0 policies |
| R2 | TRUNCATE/REFERENCES/TRIGGER/MAINTAIN para `anon`/`authenticated` em 34 tabelas; RLS não cobre nenhum deles | Q2b; `0067:18-23` (TRUNCATE por `anon` medido em PG 17.6 descartável) | Média (defesa em profundidade) | não pela Data API (PostgREST não emite esses comandos); só com outro defeito (SQL dinâmico executável por `anon`, sessão SQL como `anon`) |
| R3 | **Default privileges abertos**: toda tabela/função/sequência nova em `public` nasce aberta | Q4; 20 tabelas fechadas uma a uma (0064–0078) | Média-Alta (risco de processo) | depende de esquecimento numa migration futura |
| R4 | 4 funções INVOKER com EXECUTE para PUBLIC/`anon`; 2 delas escrevem em `autopilot_sessions` (P&L e `trades_today`, insumos de gates do autopilot) | §3.5 | Baixa hoje; **Alta** se R1 acontecer em `autopilot_sessions` | não (RLS → 0 linhas; `rate_limits` → 42501) |
| R5 | 9 SECURITY DEFINER com `search_path=public` sem `pg_temp` (temporários são buscados primeiro para relações; PUBLIC tem `TEMP`) | §3.5, Q13 | Baixa | não — EXECUTE só `service_role`/`postgres` |
| R6 | 5 funções INVOKER sem `search_path` (advisor WARN) | advisors | Baixa | não |
| R7 | Sequência `founders_sale_events_seq_seq` com USAGE/UPDATE para `anon` | Q7 | Baixa (furos na numeração do livro append-only) | não pela Data API |
| R8 | Schemas expostos da Data API não verificáveis pelo catálogo | Q13 | Pendência | — |
| R9 | Desvio de migrations (6/8/15) e tabela de backup sem arquivo no repo, com RLS off e dados de `operations` | §5 | Média (governança, gate R4) | não (ACL só `postgres`) |
| R10 | `storage.*` com ALL para `anon` e 0 policies; `realtime.messages` S/I/U; `pg_stat_statements` legível por `anon` | Q8 | Baixa (padrões da plataforma; Storage sem uso) | não com 0 buckets / canais públicos |
| R11 | Canal broadcast público `admin:refresh`: quem tem a chave anon pode publicar "refresh" falso (sem dado) | `AdminRealtimeProvider.tsx:67-68` | Baixa (incômodo) | sim, mas sem efeito em dado |
| R12 | Migrations hospedadas aplicadas **sem** backup `pg_dump` + restauração validada | `docs/START-HERE.md` §6 | Pré-requisito | — |

## 7. Plano de migration LOCAL (proposta — **arquivos não escritos**)

Regras: uma migration por passo, numeração a partir de `0079`, cada uma com teste SQL próprio em
`supabase/tests/` no molde de `17_acl_tabelas_operacionais.sql`, rodado num PostgreSQL **17** com os default
privileges de produção reproduzidos (Q4) — em PG puro os testes passam sem a migration (`17:6-8`). O PostgreSQL
local desta máquina é **16.15**: `MAINTAIN` não existe em PG16 — M1 precisa emitir o `MAINTAIN` só quando
`server_version_num >= 170000` (bloco `DO`); M5 usa `revoke all`, que cobre `MAINTAIN` em PG17. Nada é aplicado no hospedado sem: backup
validado (R12), diff before/after com Q2b/Q3/Q4, autorização explícita do dono.

| passo | proposta | objetos | impacto no app | impacto na Data API | rollback |
|---|---|---|---|---|---|
| **M1** | `revoke truncate, references, trigger, maintain on table public.<t> from public, anon, authenticated` | as 34 tabelas de §4 (lista fechada no arquivo, não `ALL TABLES`) | nenhum: 0 consumidores `anon`/`authenticated` (§4) | nenhum: PostgREST não usa esses privilégios | `grant truncate, references, trigger, maintain … to anon, authenticated` (ACL anterior em `db-acl.json`) |
| **M2** | `alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;` idem `on sequences`; idem `on functions`; e **global** `alter default privileges for role postgres revoke execute on functions from public;` | `pg_default_acl` de `postgres` (`public`) + global de funções | tabelas/funções/sequências **novas** nascem fechadas; o default de `service_role` permanece. O revoke global de EXECUTE a PUBLIC vale para toda função criada por `postgres` em qualquer schema (inclusive extensão instalada por `postgres`): conferir Q3/Q8 após qualquer `create extension` | tabela nova deixa de aparecer para `anon` até grant explícito (desejado) | `alter default privileges … grant …` com as ACLs de Q4 |
| **M3** | funções: `revoke execute on function public.apply_session_pnl(uuid,numeric,text), public.bump_session_trades(text,text,integer), public.consume_rate_limit(text,integer,integer), public.cex_transicao_permitida(public.cex_intent_state,public.cex_intent_state) from public, anon, authenticated` + `grant execute … to service_role`; sequência: `revoke all on sequence public.founders_sale_events_seq_seq from anon, authenticated` | 4 funções + 1 sequência | nenhum: `consume_rate_limit` só por service role (`src/lib/rate-limit.ts:100`); `cex_transicao_permitida` roda dentro de definer dono `postgres`; as outras duas não são chamadas; `service_role` mantém USAGE da sequência (necessário ao INSERT em `founders_sale_events`) | `/rest/v1/rpc/<fn>` com chave anon passa de 200/0 linhas para 401 | regrant das ACLs de Q3/Q7 |
| **M4** | `alter function … set search_path = public, pg_temp` | 9 SECURITY DEFINER (`bancada_*` ×6, `celeiro_reverter_genoma`, `cex_recalcular_intent`, `cex_transicionar`) + 5 INVOKER do advisor | nenhum funcional (`pg_temp` passa a ser buscado por último); nas 5 SQL immutable o `SET` impede *inlining* — irrelevante nos volumes atuais (tabelas `autopilot_*`/`cex_*` com 0 linhas) | nenhum | `alter function … set search_path = public` / `reset search_path` |
| **M5** | fechamento total por grupo: `revoke all on table … from public, anon, authenticated` (padrão 0067/0070/0078), **uma migration por grupo**, ordem G1 → G2 → G3 → G4 | G1 4 · G2 5 · G3 5 · G4 20 tabelas | nenhum caminho do app (§4). O teste `checkRls` (`src/lib/admin/audit.ts:101-129`) continua passando: o GET anon passa de `200 []` para 401 (`res.ok` falso → sem vazamento) | tabelas somem do OpenAPI do `anon`; erro muda de "0 linhas/RLS" para 42501 | `grant all … to anon, authenticated` por grupo |

Fora do plano, de propósito: `service_role` (fica com ALL — é a identidade do app; reduzir é trabalho próprio, com teste
de cada rota); RLS/policies (continuam ligadas e sem policy; **não** criar policy `TO authenticated` — plano §4 R4);
`storage`, `realtime`, `extensions`, `graphql*` (gerenciados pela plataforma; Storage sem uso); default privileges de
`supabase_admin` (exigem papel que `postgres` não tem — registrar como residual; hoje nenhum objeto de `public` é dele);
`DROP` de `apply_session_pnl`/`bump_session_trades` e da tabela `zswap_backup.*` (decisão de retenção do dono);
reconciliação de `schema_migrations` (§5). Schemas privados para identidade/RBAC seguem o desenho de
`docs/ADMIN-SSO-MFA-RBAC-DESIGN.md:315-318`, com uma correção: `alter default privileges in schema … revoke execute
on functions from public` **não** remove o EXECUTE a PUBLIC (é default global do PostgreSQL; o per-schema só soma) —
usar a forma global de M2 ou `revoke execute … from public` explícito por função.

Ordem recomendada: M1 → M3 → M4 → M2 → M5(G1…G4). M1/M3/M4 não mudam comportamento observável do app; M2 só afeta
objetos futuros; M5 muda a resposta da Data API para a chave anon e por isso vai por último e em grupos.

## 8. Matriz de testes por papel (antes → depois)

Execução: `begin; set local role <papel>; <comando>; … rollback;` num PG 17 descartável com a cadeia de migrations
e os default privileges de Q4 reproduzidos; distinguir **ACL** (`42501` + `permission denied for table|function|sequence`)
de **RLS** (`42501` + `new row violates row-level security policy`, ou 0 linhas), como em `17_acl_tabelas_operacionais.sql`.
Depois de autorizado, repetir Q2b/Q3/Q4 no hospedado (só leitura) como *after-state*.

| ID | papel | operação | objeto | antes (derivado do catálogo medido; não executado no hospedado) | depois (esperado) | passo |
|---|---|---|---|---|---|---|
| T-ACL-01 | `anon`, `authenticated` | `TRUNCATE` | 34 tabelas | **permitido pela ACL** (RLS não se aplica; `0067:18-23` mediu `anon` truncando `cex_fills` em PG 17.6 descartável) | 42501 ACL | M1 (ADM-010) |
| T-ACL-02 | `anon`, `authenticated` | `has_table_privilege(…, 'REFERENCES'/'TRIGGER'/'MAINTAIN')` | 34 tabelas | `true` | `false` | M1 |
| T-ACL-03 | `anon`, `authenticated` | `ANALYZE`/`VACUUM` na tabela; `LOCK TABLE … ACCESS EXCLUSIVE` | 34 tabelas | executa (MAINTAIN, PG17); LOCK permitido (UPDATE/DELETE/TRUNCATE/MAINTAIN) | ANALYZE/VACUUM: `WARNING … skipping` (sem efeito); **LOCK continua permitido até M5** (UPDATE/DELETE permanecem) | M1, M5 |
| T-ACL-04 | `anon` | `SELECT count(*)` | 34 tabelas | 0 linhas (RLS) | 0 linhas (RLS) após M1; **42501 ACL** após M5 | M5 |
| T-ACL-05 | `anon` | `INSERT … default values` | `platform_admins`, `tier_cache` | 42501 **RLS** | 42501 **ACL** | M5-G1 |
| T-ACL-06 | `authenticated` | `UPDATE … set …` | `autopilot_sessions` | 0 linhas (RLS) | 42501 ACL | M5-G2 |
| T-ACL-07 | `service_role` | SELECT/INSERT/UPDATE/DELETE | 54 tabelas (respeitando os mínimos de `early_access_*`/`founders_*`) | permitido | **inalterado** | todos |
| T-ACL-08 | `postgres` (cria tabela de teste em `public` dentro da transação) | `has_table_privilege('anon', nova, 'SELECT')` | tabela nova | `true` | `false`; `service_role` continua `true` | M2 |
| T-ACL-09 | idem, cria função/sequência nova | `has_function_privilege('anon'|'public', nova, 'EXECUTE')`, `has_sequence_privilege('anon', nova, 'USAGE')` | objetos novos | `true` | `false` | M2 |
| T-ACL-10 | `anon`, `authenticated` | `select public.apply_session_pnl(…)`, `bump_session_trades`, `consume_rate_limit`, `cex_transicao_permitida` | 4 funções | executa (efeito 0 / 42501 na tabela) | 42501 `permission denied for function` | M3 |
| T-ACL-11 | `service_role` | `select public.consume_rate_limit('t',1,60)`; `cex_transicionar` chamando `cex_transicao_permitida` | 2 funções | ok | **inalterado** | M3 |
| T-ACL-12 | `anon` | `select nextval/setval('public.founders_sale_events_seq_seq')` | sequência | executa | 42501 | M3 |
| T-ACL-13 | `service_role` | `insert into founders_sale_events …` (usa a sequência) | tabela + sequência | ok | **inalterado** | M3 |
| T-ACL-14 | catálogo | `proconfig` das 14 funções contém `search_path=public, pg_temp`; advisor `function_search_path_mutable` = 0 | 14 funções | 9 sem `pg_temp`, 5 sem `search_path` | 0 / 0 | M4 |
| T-ACL-15 | catálogo | SECURITY DEFINER com EXECUTE para `anon`/`authenticated`/PUBLIC | 36 funções | 0 | 0 (regressão) | todos |
| T-ACL-16 | PostgREST (harness `bench/integracao`, `jwt('anon'|'authenticated'|'service_role')`) | GET `/{tabela}`, POST `/rpc/{fn}` | amostra G1–G4 + 4 funções | anon: 200 `[]`; rpc 200 | anon: 401/403; service_role 200 | M3, M5 |
| T-ACL-17 | app | `checkRls` de `src/lib/admin/audit.ts:101-129` e suítes `vitest` existentes | — | pass | pass | todos |
| T-ACL-18 | catálogo | RLS ligada e 0 policies nas 54 (o desenho não muda) | 54 tabelas | 54/0 | 54/0 | todos |

## 9. Pendências que não se resolvem por código

1. Confirmar os schemas expostos da Data API no Dashboard (R8).
2. Autorizar (ou não) a aplicação hospedada de M1–M5, depois de backup `pg_dump` + restauração validada (R12).
3. Decidir a reconciliação de `schema_migrations` (repair × desvio documentado) e a retenção de
   `zswap_backup.operations_pre_0078_20261021` (R9).
4. Atualizar `docs/START-HERE.md:72` / `docs/CURRENT-STATE.md:151` de 35/53 para 34/54 na próxima entrega de estado.

## 10. Reprodução

Scripts no scratchpad da sessão (`admin-cc2/acl/`): `mig_diff2.py` (diff remoto × repo com a normalização de Q11),
`consumers2.py` (tabelas/RPCs → consumidores; resolve `.from(CONST)`; lista todo `createClient` e `/rest/v1`),
`build_db_acl2.py` (monta `db-acl.json` só dos arquivos medidos `raw/q01…q15` + advisors). Rodar com `python3 -I`.
