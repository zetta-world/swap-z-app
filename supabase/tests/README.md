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

Depois aplique `supabase/migrations/*.sql` em ordem e rode os arquivos deste
diretório.

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
