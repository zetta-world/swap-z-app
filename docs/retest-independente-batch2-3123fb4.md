# Z-SWAP — Platform Closure Batch 2

## Reteste independente final do SHA publicado

**Data:** 2026-09-26  
**Função:** retester independente  
**Branch remota:** `platform-closure`  
**SHA testado:** `3123fb4972cd0ea46a152e00c0bd1c625efb12e5`  
**Base do Batch 2:** `a5bdd61d9915c84799d200b22645fe85de7ee4b5`

## Status

**INDEPENDENT RETEST PASS**  
**PLATFORM CLOSURE BATCH 2 — CLOSED AT**  
**3123fb4972cd0ea46a152e00c0bd1c625efb12e5**

**PRODUCTION = NOT UPDATED**  
**DCA REAL = NO-GO**  
**PILOT REAL = NO-GO**  
**MAIN = UNCHANGED**

O fechamento deste batch não autoriza produção.

## IDENTIDADE — PASS

Refs verificadas após `git fetch origin`, antes e depois do reteste:

| Ref | SHA observado | Esperado |
|---|---|---|
| `origin/platform-closure` | `3123fb4972cd0ea46a152e00c0bd1c625efb12e5` | igual |
| `origin/round9-surgical` | `798fe2762370d3e2c7b57115c4caee350e82d104` | igual |
| `origin/main` | `25fc4b0fa55db72472c7ae00af42596209d7c362` | igual |

O SHA foi testado em worktree detached. O intervalo contém exatamente seis commits:

```text
3123fb4 ESTADO-ATUAL: linha platform-closure fora da main, aguardando retest
124e834 PC-B2: cicatrizes da 0064 de volta na auth; SQL 12 exige o motivo
356d68c PC-B2: pause_dca pausa entrada nova, não o recovery
0ff4f61 PC-B2: teto diário não encerra plano; NULL de gasto falha fechado
ff23612 PC-B2: adiciona regressões e negative controls
21ac739 PC-B2: fecha safety/accounting do DCA
```

`git diff --check` passou. O delta tem 20 arquivos, 2.263 inserções e 189 remoções. A única migration adicionada é `0066_dca_safety_accounting.sql`; migrations anteriores não foram modificadas.

Evidências: `00-authoritative-identity.txt`, `01-detached-delta.txt`, `02-full-delta.patch`, `03-scope-search.txt`, `60-final-integrity-before-disposal.log`.

## FULL APP GATES — PASS, COM LIMITAÇÕES LOCAIS EXPLÍCITAS

O ambiente local não conseguiu concluir um `npm ci` pela rede:

- tentativa Node 20: `ENETUNREACH`, exit 155;
- tentativa Node 24: `ENETUNREACH`, exit 155;
- tentativa offline: cache incompleto, `ENOTCACHED`, exit 1;
- a tentativa auxiliar de instalar Node 22 foi abortada após o download ficar estagnado.

`package.json` e `package-lock.json` são idênticos entre a base e o SHA. Para continuar o reteste local, foi usada uma cópia física da árvore de dependências já instalada a partir do mesmo lockfile. Isso é evidência suplementar; não foi declarado como `npm ci` local bem-sucedido.

| Gate | Resultado local | Evidência oficial no SHA |
|---|---|---|
| `npm ci` | indisponível por rede/cache | PASS no GitHub Actions, Node 22 |
| `npm run lint` | PASS — 0 erros, 145 warnings | PASS |
| `npm run type-check` | PASS | PASS |
| `npm test` | 262/263 arquivos; 3.955/3.956; um timeout local de 5 s | PASS — 263/263 e 3.956/3.956 |
| `mesa-real.test.ts` isolado | PASS — 11/11, sem aumentar timeout | incluído no PASS oficial |
| `npm run build` | PASS — compilação e 36/36 páginas | não é etapa do workflow |

O único erro da suíte agregada local foi o timeout conhecido em `mesa-real.test.ts`; o arquivo passou isoladamente. Nenhum teste novo do Batch 2 falhou. O build limpo passou depois que o fallback de dependências deixou de ser symlink e virou cópia física. Uma tentativa anterior de build foi descartada porque o Turbopack recusou o symlink externo antes de compilar o código.

Warnings relevantes:

- lint: 145 warnings, 0 errors;
- Next.js: convenção `middleware` e Edge Runtime marcadas como deprecated;
- `npm audit` oficial: 46 vulnerabilidades, sendo 1 low, 39 moderate e 6 high; continua advisory/`continue-on-error`.

Evidências: `10-npm-ci.log`, `12-npm-ci-authoritative.log`, `13-npm-ci-offline.log`, `14-dependency-fallback.txt`, `20-*.log`, `21-npm-test.log`, `22-mesa-isolated.log`, `23-build.log`, `24-dependency-physical-copy.txt`, `25-build-physical-deps.log`, `50-github-job-api.log`.

## POSTGRES MIGRATIONS — PASS

Foi criado um cluster novo e descartável PostgreSQL 16.15, isolado de bancos do usuário e de qualquer Supabase remoto.

| Verificação | Resultado |
|---|---|
| Cluster | novo `initdb` |
| Banco | `zswap_batch2_independent` |
| Migrations encontradas | 66 |
| Aplicação `0001` → `0066` | 66/66 PASS |
| Erros | zero |
| Migrations anteriores modificadas | nenhuma |

Evidências: `30-initdb.log`, `30-postgres-environment.txt`, `31-migrations.log`.

## SQL REGRESSION — PASS

| Teste | Resultado |
|---|---|
| `01_invariantes_financeiros.sql` | PASS — T1–T6 |
| `02_acl_rls_substituicao.sql` | PASS — T7–T12; 19 SECURITY DEFINER com search path fixo |
| `04_conc_venda.sh` | PASS — A=0.01, B recusada, total reservado 0.01 |
| `05_conc_compra.sh` | PASS — exposição 190 + compromisso 10; segunda compra recusada |
| `06_conc_liquidacao_x_projecao.sh` | PASS — P&L -2, aplicado -2, posição LTC 0 |
| `08_cr_retest_independente.sql` | PASS — CR-1, CR-2, CR-5 |
| `09_fronteira_final_toctou.sql` | PASS — B1–B6 |
| `10_crx1_regressao_na_varredura.sql` | PASS — CRX-1.1–CRX-1.4 |
| `11_a51_rearm_preserva_rails.sql` | PASS — R1–R6 |
| `12_dca_batch2.sql` | PASS |

Os scripts 04/05/06 foram executados com as RPCs e transações originais, alterando somente socket/porta/usuário/banco para o cluster descartável. `pg_blocking_pids()` observou um blocker real em cada cenário concorrente.

Evidências: `32-*.log`, `33-*.log`, `34-*.log`, `35-*.log`, `36-*.log`, `37-*.log`, `38-*.log`, `39-*.log`.

## A58 — PASS

O script versionado `13_dca_a58_concorrencia.sh` foi executado contra o PostgreSQL real:

- pause→auth: auth esperou, recusou e o intent permaneceu `RESERVED`;
- auth→pause: auth marcou `SUBMITTING`; pause bloqueou por aproximadamente 1.036 ms; intent permaneceu `SUBMITTING`; plano terminou pausado;
- exit 0.

Também foi comprovado que plano pausado com intent `UNKNOWN`:

- não aparece na fila ativa;
- aparece na fila independente de recovery;
- não gera ordem nova nos testes de rota.

Evidências: `40-a58-concurrency.log`, `39-12_dca_batch2.log`, `44-a96-a97-a86-vitest.log`, `45-a96-historical-nonusd-recovery.log`.

## A59 — PASS

O fill 60/80 foi criado por `cex_ingest_order_snapshot`, sem update manual de `filled_quote`:

```text
state=PARTIALLY_FILLED
requested=60
durable_fill=80
total_first=80
total_replay=80
```

Outras propriedades observadas:

- repetição não duplicou o gasto;
- `FAILED_PRE_SUBMIT=0`;
- `SUBMITTING=100` + `UNKNOWN=80` produziram compromisso 180;
- fill conhecido maior que requested usou o fill maior;
- fechamento posterior de `dca_ciclo`, inclusive com `custo_usd=999`, não mudou o total autoritativo do livro: 40→40;
- filled qty sem custo afirmável falhou com `tem fill sem custo afirmavel`;
- partial `ETH/BTC` falhou com `fill em quote nao USD-like: BTC`;
- requested NULL em `UNKNOWN` falhou com `sem requested_notional_usd valido`.

Cada caso fail-closed validou o motivo da exceção, sem aceitar `WHEN OTHERS` genérico.

Evidências: `39-12_dca_batch2.log`, `41-a59-independent.log` (primeiro harness rejeitado corretamente por fixture sem certificado), `42-a59-independent-authoritative.log`, `a59-independent-evidence.sql`.

## A96 — PASS

Allowlist confirmada no código e nos testes: somente `USD`, `USDT`, `USDC`.

| Par | Resultado |
|---|---|
| `BTC/USDT` | permitido |
| `ETH/USDC` | permitido |
| `ETH/BTC` | recusado — `quote_nao_usd_like` |
| `SOL/ETH` | recusado — `quote_nao_usd_like` |

A rota de criação chama `unidadeDca(symbol)` antes de capacidade, cofre e qualquer efeito externo. Um intent histórico `ETH/BTC` em plano pausado permaneceu fora da fila ativa e acessível pela fila de recovery. A regra nova não apagou nem reclassificou o histórico.

Evidências: `44-a96-a97-a86-vitest.log`, `45-a96-historical-nonusd-recovery.log`, `02-full-delta.patch`.

## A97 — PASS

Os testes direcionados comprovaram:

- `fetchBalance` lança → `leitura_falhou`, zero callback, zero reserva, zero execução;
- `FREE=0` → saldo livre insuficiente;
- TOTAL 500 e FREE 20 para necessidade 100 → recusa;
- quote ausente → `quote_ausente`;
- FREE suficiente → caminho posterior pode prosseguir;
- TOTAL nunca autoriza BUY;
- `reservarCiclo` está dentro do callback autorizado pelo preflight.

O precheck continua sendo somente preflight; nenhuma atomicidade com a venue foi alegada.

Evidência: `44-a96-a97-a86-vitest.log`.

## A86 — PASS

Testes da rota com mocks versionados comprovaram:

- falha da fila ativa → HTTP 503, `processed=0`, nenhuma execução;
- falha da fila recovery → HTTP 503, `processed=0`, nenhuma execução;
- filas genuinamente vazias → HTTP healthy, `processed=0`;
- com `pause_dca`, fila ativa não é lida e recovery continua;
- com `pause_dca`, erro de recovery continua 503;
- nenhuma nova ordem nasce durante a pausa.

Se qualquer fila falha, ambas são lidas antes de o primeiro plano ser processado; não existe processamento parcial disfarçado de healthy.

Evidência: `44-a96-a97-a86-vitest.log`.

## ROUND9/BATCH1 REGRESSION — PASS

`0064_autopilot_projecao_de_posicao.sql` permaneceu byte a byte sem alteração no delta. A função efetiva redefinida pela 0066 foi exercitada no banco real.

Gates confirmados:

- sessão ativa;
- expiração;
- daily loss stop e P&L;
- freeze;
- contabilidade incompleta;
- quarentena;
- certificado ainda não vigente, expirado e revogado;
- strategy id/version/hash;
- venue;
- symbol;
- `maxTradeUsd`;
- controle positivo termina em `SUBMITTING`.

Todas as recusas mantiveram o intent `RESERVED`. SQL 08/09/10/11 passou. A51 rearm passou R1–R6. O recovery continua chamando `credenciaisDoIntentParaRecovery` com o intent histórico; 11/11 testes direcionados de conexão histórica/releitura passaram.

Evidências: `39-08*`, `39-09*`, `39-10*`, `39-11*`, `46-historical-connection-tests.log`, `46-round9-batch1-summary.log`, `48-round9-effective-0066.log` (fixture incompleta rejeitada), `49-round9-effective-0066-authoritative.log`, `round9-effective-0066.sql`.

## ACL — PASS

O catálogo real listou 19 funções `SECURITY DEFINER`; nenhuma está sem `search_path` fixo.

| Função | PUBLIC | anon | authenticated | service_role | SECURITY DEFINER | search_path |
|---|---:|---:|---:|---:|---:|---|
| `dca_planos_com_intent_vivo_para_recovery(integer)` | false | false | false | true | true | `public, pg_temp` |
| `dca_gasto_real_comprometido_hoje(text)` | false | false | false | true | true | `public, pg_temp` |
| `cex_autorizar_e_submeter(uuid)` | false | false | false | true | true | `public, pg_temp` |

Evidências: `47-acl-catalog.log`, `47-acl-search-path-summary.txt`.

## DELIBERATE BREAKS — PASS

Em uma cópia externa da migration 0066, somente:

```sql
greatest(r.requested_notional_usd, v_realizado)
```

foi trocado por:

```sql
r.requested_notional_usd
```

Um banco descartável novo recebeu 66/66 migrations, usando a 0066 mutante. O SQL 12 falhou como exigido:

```text
A59 total esperado 390 (requested 60 / fill 80), obtido 370
```

Exit 3. O banco mutante foi descartado. O repositório não foi alterado.

Evidências: `0066-deliberate-break-requested-only.sql`, `43-a59-break-migrations.log`, `43-a59-break-test12.log`, `43-a59-break-summary.log`.

## GITHUB CI — PASS

Workflow oficial existente, sem novo disparo:

| Campo | Valor |
|---|---|
| Run ID | `36231021269` |
| Job ID | `108374070760` |
| SHA | `3123fb4972cd0ea46a152e00c0bd1c625efb12e5` |
| Branch | `platform-closure` |
| Status | `completed` |
| Conclusion | `success` |
| Node | 22 |
| Checkout | `fetch-depth: 0` |
| Test files | 263/263 |
| Tests | 3.956/3.956 |

`npm ci`, lint, type-check e unit tests terminaram `success`. O `npm audit` continua advisory e reportou 46 vulnerabilidades.

Evidências: `50-github-run.json`, `50-github-summary.log`, `50-github-job-api.log`.

## WORKING TREE — PASS

Antes do descarte:

- worktree detached no SHA exato;
- branch vazia, como esperado para detached HEAD;
- `git status --short --untracked-files=all`: vazio;
- checkout fonte: limpo;
- seis commits no intervalo;
- `git diff --check`: exit 0.

Depois dos testes:

- banco principal descartado;
- banco mutante descartado;
- cluster PostgreSQL parado;
- worktree descartável removido;
- checkout fonte permaneceu limpo;
- refs remotos permaneceram nos SHAs autorizados.

Evidências: `60-final-integrity-before-disposal.log`, `61-postgres-disposal.log`, `62-worktree-disposal.log`.

## Confirmação operacional

Não houve implementação, correção do SHA, edição de arquivo versionado, commit, push, PR, merge, workflow novo, deploy Vercel, acesso ao Supabase de produção, migration remota, DCA real, Pilot real ou trade real. O relatório do implementador não foi usado como prova.
