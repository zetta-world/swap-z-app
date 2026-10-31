# Testes contra PostgreSQL de verdade

O banco falso (`src/lib/cex/execucao/banco-falso.ts`) reproduz a aritmética das
RPCs para que os testes do executor rodem sem banco. Ele **não prova
PostgreSQL**: não tem `FOR UPDATE`, não tem constraint, não tem ACL, não tem
`search_path`, e não descobre que uma migration simplesmente não aplica.

Estes arquivos rodam contra um cluster **descartável**. Nunca contra produção.

## Como subir

```bash
initdb -D /var/tmp/zswap-pg/pgdata -U postgres --auth=trust -E UTF8
pg_ctl -D /var/tmp/zswap-pg/pgdata -o "-p 55432 -k /var/tmp/zswap-pg/pgsock" start
createdb -h /var/tmp/zswap-pg/pgsock -p 55432 -U postgres zswap
```

Os papéis do Supabase não existem num Postgres puro e precisam ser criados
antes da cadeia:

```sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
```

⚠️ **E os default privileges da plataforma**, sem os quais os testes de ACL
(14, 17, 26…) passam no vazio — em Postgres puro nada nasce com grant para
`anon` (Q4 de `docs/ADMIN-SECURITY-DB-ACL.md`):

```sql
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
```

Depois aplique `supabase/migrations/*.sql` em ordem e rode os arquivos deste
diretório.

`26_acl_endurecimento_0079_0082.sql` (R4 do Admin CC 2.0) prova M1–M4: sem
TRUNCATE/REFERENCES/TRIGGER para `anon` nas 34 tabelas (e o TRUNCATE de `anon`
recusado com 42501), as 4 INVOKER e a sequência de `founders_sale_events`
fechadas, `search_path = public, pg_temp` nas 14 funções, e objeto novo
nascendo fechado (inclusive função fora de `public` — forma global). Com a
cadeia só até 0078 ele FALHA no T26.1; aplicando 0079→0082 uma a uma, cada
migration vira o teste dela.

`27_admin_private.sql` (0083) prova o schema `admin_private`: sem USAGE para
`anon`/`authenticated`/PUBLIC, RLS sem policy, ninguém concede papel a si,
`superadmin`/`security_admin` só com segunda pessoa, sessão corp ativa só com
`aal2`, e `admin_audit` append-only (UPDATE/DELETE/TRUNCATE recusados até para
`postgres`).

## O que cada um prova

| arquivo | prova |
|---|---|
| `01_invariantes_financeiros.sql` | invariante Q (ajuste de qty zero carregando recebido), `NULL` ≠ taxa zero, taxa ausente marcando a contabilidade, a pendência financeira sendo **encontrada**, os trades trazendo a taxa e o P&L recebendo só o delta, e exactly-once sob replay |
| `02_acl_rls_substituicao.sql` | `search_path` fixo em toda `security definer`, ACL fechada para `anon`/`authenticated`, ausência de overload, RLS default-deny, `synthetic→real` preservando o recebido, e regressão de qty/quote acusada |
| `03_seed_concorrencia.sql` | semeia o cenário de duas ordens concorrentes (ver abaixo) |

## Concorrência

Duas transações **de verdade**, em processos separados, disputando a mesma
linha. É o único jeito de provar que o `FOR UPDATE` das reservas serializa:

```bash
# VENDA: posição 0,01, dois intents pedindo 0,01 cada
psql ... <<'Q' &      # processo 1 segura a linha
begin;
select public.autopilot_reservar_venda_do_intent('<A>', 0.01);
select pg_sleep(2);
commit;
Q
sleep 0.5
psql ... <<'Q'        # processo 2 bloqueia no lock e só então decide
begin;
select public.autopilot_reservar_venda_do_intent('<B>', 0.01);
commit;
Q
```

Esperado: A concede 0,01 · B recusa `quantidade_ja_reservada` · total
reservado **0,01**.

E para a COMPRA, com exposição 190 e teto 200: D concede 10 · E recusa
`teto_estourado` · o total **nunca chega a 210**.
