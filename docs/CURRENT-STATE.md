# CURRENT STATE — onde estamos AGORA

> Responde só "onde estamos agora?". Não é diário: o histórico vai para
> `docs/LAUNCH-READINESS-LEDGER.md`. Ao mudar de estado, **substitua** as seções
> atuais e **acrescente** uma entrada no ledger.
>
> **Medido em:** 14/10/2026 (revisão 16, ledger L-053: **reconciliação de governança depois do release de
> produção de 13–14/10**). Estado medido nesta revisão por leitura (GitHub, CI, Vercel, banco hospedado em
> transação `read only`); evidência fora do repo em `zswap-local/evidence/post-release-governance-*`. A revisão 15
> (08/10, L-052) e anteriores estão em **HISTÓRICO**, inalteradas.
> As seções atuais abaixo descrevem só o estado de hoje.

---

## Atualização L-062B — Jupiter Swap V2 `/build` (16/10/2026)

Código certificado em `feat/jupiter-swap-v2@6722b5c` (preview: taxa confirmada na instrução, transação v0 montada no
servidor, 0 × 401/403/429). Produção **ainda na `/swap/v1` autenticada** até o dono autorizar o deploy.

## Atualização L-062A — chave da Jupiter (16/10/2026)

Em produção desde 16/10 (`main` `a738e7c`, `dpl_3VqE1Ex1RGta87E7gVHUffX1kT82`): toda chamada à Jupiter vai para
`api.jup.ag` com `x-api-key` (logs `[jupiter] modo autenticada`); smoke 0 × 401/403/429, taxa Solana 100 bps intacta.
Plano Free da Jupiter = 1 req/s. Swap V2: ver L-062B acima.

## Atualização L-061 — taxa na Solana (16/10/2026)

A Solana passa a cobrar a mesma escada das EVM (Jupiter em pares com USDC ou SOL; LI.FI saindo da Solana).
Contas de taxa USDC `En1J8…` e wSOL `7PPDQ…` da carteira `H7zw…`. Conta indisponível → swap segue sem taxa + alerta.

## Atualização L-060 — taxa LI.FI ativa (16/10/2026)

O cross-chain saindo de redes EVM cobra a taxa do plano via LI.FI (`LIFI_INTEGRATOR=zswap` + key). Um valor
errado nessas variáveis não derruba mais as cotações (`12b898f`): a taxa LI.FI desliga e um alerta diz o motivo.
Taxa na Solana segue desligada (rodada própria pendente).

## Atualização L-059 — taxa LI.FI pronta para ativar (15/10/2026)

Integrator `zswap` cadastrado e validado na API real; a detecção da taxa (somada à do LI.FI) foi corrigida em
`2b8118d`. A taxa no cross-chain saindo de EVM liga quando o dono definir `LIFI_INTEGRATOR=zswap` na Vercel.

## Atualização L-058 — LiFi (cross-chain) restaurado (15/10/2026)

LIFI-UPSTREAM-01: desde `dfff405` (10/08) o LiFi recusava toda cotação (taxa com integrator "z-swap" não
cadastrado no portal deles, 400/1011), e o cross-chain ficou sem rota. Corrigido em `2719e38`: sem
`LIFI_INTEGRATOR`, as rotas LiFi não levam taxa e divulgam 0%. Para voltar a cobrar: cadastro em portal.li.fi
+ env (ver `RUNBOOK.md`). Auditoria externa segue fechada; A33 intocado.

Em produção desde 15/10 ~10:54 UTC: `dpl_DCsP5Gbz6kyu9Y1RubfoZ3t9ZN3D` (`a19d2c1`, código `2719e38`); LiFi cotando
em produção; sem runtime errors.

## Atualização L-057 — A33 corrigido; auditoria externa encerrada (15/10/2026)

`/api/quote` em `mode=list` não devolve mais nada executável (DTO `ListQuote`, allowlist); `mode=quote` segue a
única porta de execução, sob o kill-switch. Corrigido em `4ba6694`. Os 33 achados da auditoria externa estão
fechados: `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=0`. Observação aberta fora de escopo: LiFi sem
cotação (LIFI-UPSTREAM-01). Banco, migrations, flags, Autopilot e DCA real inalterados.

Em produção desde 15/10 ~10:00 UTC: `dpl_3E65QrD59LprRzkkS7EMrMukEzRw` (`d390880`, código `4ba6694`); smoke 25/25;
lista sem payload executável; sem runtime errors. Rollback: `dpl_EvGv264czgmaBRPuhaQvFDgMDKxQ` (`5af0504`).

## Atualização L-056 — A31 e A32 corrigidos (14/10/2026)

A31 (mint Solana em minúsculas: preço `null` para SPL) e A32 (preço desconhecido como patrimônio zero)
corrigidos em `d047673`, junto com o vigia de ordens que não achava preço de token com contrato.
`KNOWN_MISSING_CORRECTIONS=1` (A33, decisão do dono) · `UNKNOWN_FINDINGS=0`. Candidato e gates:
`RELEASE-CHAIN.md` "Atualização L-056". Banco, migrations, flags, Autopilot e DCA real inalterados.

Em produção desde 15/10 ~00:47 UTC: `dpl_2R8vsDxZNEDMyACbsR1TJ6npPwYB` (`6c66c13`, código `d047673`); smoke
25/25; preços SPL em produção; sem runtime errors. Rollback: `dpl_DT9haCV1YucfhoFJkxjRNnrqfDNT` (`27bf8eb`).

## Atualização L-055 — fechamento final da auditoria externa (14/10/2026)

A08, A09 e A17 da auditoria externa: ALREADY_FIXED_PROVEN. A10: corrigido em `5c2306e` (teto de símbolos por
mesa no tique de papel). Fonte original recuperada; `UNKNOWN_FINDINGS=0`. A31/A32/A33, da mesma auditoria e
nunca registrados antes, estão OPEN: `KNOWN_MISSING_CORRECTIONS=3`. Candidato e gates: `RELEASE-CHAIN.md`
"Atualização L-055". Banco, migrations, flags, Autopilot e DCA real inalterados.

Em produção desde 14/10 ~11:31 UTC: `dpl_BhiwniCtsqX7iUTGM3mkhrXFzMSj` (`2c0c7c9`, código `5c2306e`); smoke
25/25; sem runtime errors. Rollback: `dpl_2NrEVzr9U2FM3Y8fqAzAa4Y6237v` (`2e3e397`).

## Atualização de navegação L-054 (14/10/2026)

A inclusão autorizada de Founder Pass no menu parte de 415ac35; código 34e9159. O candidato é o commit desta atualização, com CI/build no SHA final antes da publicação. SHA servido e resultados pós-publicação: `zswap-local/evidence/founders-menu-20261014/`. As tabelas L-053 abaixo são o snapshot anterior a esse microdelta de navegação. Não há alteração de banco, venda ou flags.

## Estado anterior ao microdelta L-054

| campo | valor | fonte |
|---|---|---|
| RELEASE_CODE_SHA | `6d1295bf43f4967b7e15498f1496c132fc09fa7a` · tree `22a3a409e6f43d2b5bb8f7e727ef4c8bba0e364a` (= `e2f61d1` + 2 commits que só mudam `src/lib/bancada/motor.complexidade.test.ts`) | Git; L-053 |
| MAIN | `origin/main` avançada por fast-forward `25fc4b0` → `6d1295b` em 14/10 ~00:26 UTC (PR #447 marcado MERGED pelo GitHub às 00:26:37 UTC porque seu head ficou alcançável); depois disso, o commit **só de docs** da L-053 (`THIS_CONTROL_PLANE_COMMIT`), pai `6d1295b` | Git, `gh pr view 447`; L-053 |
| CI | `6d1295b`: run 38488966914 (branch `release/production-20261013`) e 38490205461 (`main`) — success. O CI do commit da L-053 está registrado na evidência externa da L-053 | GitHub Actions |
| PRODUCTION | deployment original do release `dpl_A5PDW653HtRyH4HN6CUdhGC7LLrC` (`6d1295b`, READY, criado 2026-10-14T00:26:41Z; aliases `swap-z-app.vercel.app`, `swap-z-app-jose-carlos-projects-dd9e3e78.vercel.app`, `swap-z-app-git-main-jose-carlos-projects-dd9e3e78.vercel.app`). O push da L-053 pode gerar um deployment novo do mesmo código: ID e SHA servidos ficam na evidência externa da L-053 | Vercel API, 14/10 |
| ROLLBACK_CANDIDATE | `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ` (`25fc4b0fa55db72472c7ae00af42596209d7c362`), servido com sucesso sobre o schema 0076 antes do merge (rotas 200) | `release/production-20261013/evidence` |
| DATABASE | Supabase `vuvvftdsfmagmtbovzgq`: `schema_migrations` 73 linhas, head `20261014002550`; 0059–0076 aplicadas em 14/10 (18 linhas, versões `20261014002533`…`20261014002550`); 53 tabelas, RLS 53/53, 0 policies | SQL `read only`, 14/10 |
| FLAGS | `disable_cex=false`, `disable_swap=false`, `maintenance_mode=false`, `disable_early_access=true`; `dca_real_liberado`, `autopilot_cex_liberado`, `pause_dca` **ausentes** | SQL `read only`, 14/10 |
| REAL_MONEY_STATE | autopilot_sessions 0 · cex_conexoes 0 · cex_execution_intents 0 · cex_fills 0 · dca_planos não simulados 0 · dca_ciclos 3 (todos `simulado`, 25–26/08) — **leitura de 14/10; não prova ausência de atividade fora dessas tabelas** | SQL `read only`, 14/10 |
| AUTOPILOT | IMPLEMENTED · **DISABLED** | flags acima |
| DCA_REAL | **DISABLED** | flags acima |
| R-01 VERCEL | **CLOSED** — time `pro`/`active`, sem softBlock; deploys de preview e produção concluídos; produção 200 | Vercel API/HTTP, 14/10 |
| R-02 CEX_RECOVERY_HMAC_KEY | **CLOSED** pelo critério do runbook (presença do nome): tipo `sensitive`, targets production+preview, criada 2026-10-13T23:50:14Z, valor nunca exibido. Caminho autenticado que a usa **não exercitado** em produção | Vercel API (nomes), 14/10; L-053 |
| AP-LOCK_HOSTED | **PASS** (sonda comportamental: PATCH anônimo com o filtro `or=(locked_until…)` + `select=id` do `tryLockSession` → HTTP 200 `[]`, sem `42703`). Não exercitou o cron real (0 sessões) | transcript da rodada; evidência L-053 |
| P0-SKEW (`creds_cipher`) | o código `6d1295b` não usa mais a coluna em `autopilot_sessions` (credencial em `cex_conexoes`, 0063); sem sessões para exercitar | Git |
| PUBLIC_GATE | **CLOSED** (`disable_early_access=true`; smoke: `POST /api/early-access` → 503 `closed`) | L-053 |
| CERTIFICATION | `LAST_CERTIFIED_RUNTIME=0d21874b4147bb8a0b232aa0abc2302471a720e5` e `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (ancestrais). `6d1295b` **não** é `CERTIFIED_EXACT_SHA`: gates medidos com desvios documentados (`RELEASE-CHAIN.md` nó 27) | L-053 |
| RELEASE_CANDIDATE | **nenhum candidato novo em andamento**; o de 13–14/10 (`6d1295b`) foi executado sem marcação prévia nos documentos (lacuna registrada) | `RELEASE-CHAIN.md` |
| DEPLOY_POLICY | **inalterada:** regra de 31/08 SUSPENSA; deploy só com SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização explícita do dono | `AI-OPERATING-RULES.md` §6 |
| NPM_AUDIT | **snapshot do release** (`e2f61d1`/`6d1295b`, 13/10): 0 critical / 25 high / 40 moderate / 0 low; `--omit=dev` 0/20/37; portão R-03 OK com exceção **mantida, não corrigida** (`braces`, GHSA-vfj7-8cjw-p6xm). Não é contagem atual | `release/production-20261013/evidence/audit*.txt` |
| INC-RR-01 | reconhecido pelo dono, permanente; no release o guarda de memória recusou um build local (funcionou como projetado) | L-028, L-053 |
| AUDIT_RECONCILIATION | `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=4` (A08/A09/A10/A17) · findings pós-release em §5.7 | `docs/AUDIT-RECONCILIATION.md` |

## OPEN_BLOCKERS

| id | bloqueia | estado |
|---|---|---|
| **ACL-DEFAULT-GRANTS** | defesa em profundidade das tabelas | **OPEN** — 35/53 tabelas com privilégios de tabela padrão para `anon`/`authenticated`; PATCH anônimo testado em `autopilot_sessions` alterou 0 linhas. **Não** prova contenção completa (RLS não cobre todos os privilégios/caminhos). Revisão própria + eventual REVOKE em rodada separada |
| **CE-01-MARGIN** | estabilidade do CI | MONITOR — runner: motor 5,4–7,1× vs quadrático 14,8× (limite 10×) |
| **BUILD-WARNINGS** | — | OPEN_NONBLOCKING — `middleware` → `proxy`; Edge runtime deprecado; cache da llama.fi > 2 MB |
| **R-03** | futuro RC | exceção `npm audit` mantida, revisada no release; não corrigida |
| **EVIDENCE-QUALIFICATIONS** | — | OPEN — smoke histórico com 2 FAIL conciliados como expectativa errada/registro pós-processado; caminho autenticado de `/api/cex/order` não exercitado; RC sem registro prévio; **sem backup `pg_dump` + restauração validada antes das migrations hospedadas** (só o rollback A, redeploy de `25fc4b0`, foi provado) |
| **GATE-OPEN** | abrir o early access | passos do dono: Termos/Privacidade aprovados, domínio remetente, segredos `EARLY_ACCESS_*`, cron, `disable_early_access=false` |
| **REAL-AUTOMATION** | DCA, Pilot e Autopilot reais | NO-GO |
| **FOUNDERS-INDEPENDENT-AUDIT** | finalizar/abrir a venda Founders | PENDING (a página pública está em produção, venda não aberta; data, supply e preço finais pendentes) |

## DEFERRED_FINDINGS (não bloqueiam a Fase 2)

F-05, F-09, F-13, F-14, F-15, F-16; R8-CORRIDA,
HARNESS-001/002, 36 moderate / 1 low do `npm audit`, HOST-CRED-001, AUTOLOGIN.
**A08, A09, A10 e A17 da auditoria externa:** SOURCE_NOT_FOUND depois da
2ª busca forense; seguem UNKNOWN_REQUIRES_REVIEW. Nenhuma correção
**conhecida e identificável** foi encontrada fora da linha; A08/A09/A10/A17
permanecem sem fonte e não permitem conclusão. Tabela completa:
`docs/AUDIT-RECONCILIATION.md` §5. (F-11, antes listado aqui como "escopo da
Fase 2", está FIXED_CERTIFIED: `CERTIFIED_EXACT_SHA` `53cd85a`.)

## Lacunas de documentação

- **Fechadas na revisão 2** (banner no topo, histórico preservado):
  `ESTADO-ATUAL.md`, `PLANO-EARLY-ACCESS.md` (+ status operacional),
  `PLANO-DCA-AUTOMATICO.md`, `PLANO-MURAL-DE-AGENTES.md`, `docs/README.md`
  (bloco START HERE) e `CLAUDE.md` (entrada).
- **Fechadas na revisão 3:** `docs/README.md` (banner LEGACY antes do índice
  "Vivos"), `CLAUDE.md` (Next.js 16.3.6, regra fail-closed precisa, mural só
  com autorização), status Fase 2 no banner de `PLANO-EARLY-ACCESS.md`.
- **Abertas:**
  - `WHITELIST-FUNDRAISING-DISCOVERY.md` ainda diz "Fase 1 não iniciada";
    o `DOCUMENT-AUTHORITY.md` cobre isso.
  - `LEDGER-MESTRE-RELEASE.md` ainda chama `3123fb4` de certificado.
  - Os docs só de `origin/platform-closure` (DOC-PC-DIVERGE).

## Artefatos locais (fora do Git)

- `node_modules/` na worktree (ignorado; não aparece no `git status`).
- Pacotes de auditoria da Fase 2 e evidência das validações:
  `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/phase2-*` e
  `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/precommit-ea2-*` (lista com hashes no ledger L-022…L-026).
- Cache npm verificado e harness da recert da Fase 1: ver o artefato histórico abaixo.

## NEXT_ACTION

Nada é automático. Nenhum release candidate novo, nenhuma fase aberta. Cada próximo trabalho exige autorização
explícita do dono: revisão de ACL (ACL-DEFAULT-GRANTS), GATE-OPEN, auditoria independente Founders, ou novo release
(caminho completo do `RELEASE-CHAIN.md` §3 com marcação `RELEASE_CANDIDATE` **antes** do deploy). Dinheiro real: NO-GO.

## HISTÓRICO (NÃO são instruções atuais)

### Revisão 15 (08/10/2026, L-052) — superada pela revisão 16 (L-053, pós-release)

Cabeçalho, seções atuais e NEXT_ACTION da revisão 15, **literalmente**:

> **Medido em:** 08/10/2026 (revisão 15, ledger L-052: os dois blockers da
> experiência pública Founders foram fechados no candidato `fd68c4f`: Next.js
> 16.3.8 sem `GHSA-cjq9-62q9-8jv4` e matriz pública certificada; aguardando
> auditoria independente, sem deploy/publicação/venda). Revisão 13, ledger L-049:
> correção AF-01 no candidato `efdf6ee`. Revisão 12, ledger L-047: micro-delta entregue
> e depois reprovado pela auditoria independente. Revisão 11, ledger L-045:
> Founders Final Sale + Liability Closure. Revisão 10, ledger
> L-043/L-044: Founders Economics + Commercial Truth. Revisão 9, ledger L-028/L-029: ensaio de release em PROD-CLONE local
> CLOSED_PASS e reconciliação AO VIVO só-leitura CLOSED; produção medida ao vivo às ~22:20 UTC.
> Revisão 8, L-027: Fase 2 certificada no C1 `53cd85a` e atestada no C2 `57d78eb`. Revisão 7, ledger L-026 — achado EA2-IA10 da
> verificação independente final: este arquivo ainda trazia instruções de antes
> da Fase 2). As seções atuais abaixo descrevem só o estado de hoje; tudo o que
> valia nas revisões 3–6 está na seção final **HISTÓRICO**, inalterado.


#### [HISTÓRICO rev. 15] Estado atual

| campo | valor | fonte |
|---|---|---|
| CURRENT_WORKTREE | `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/sales-page-final-blockers-20261008` | `git worktree list` |
| CURRENT_BRANCH | `sales-page-final-blockers-20261008`, **só local**, sem upstream | Git |
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`, "feat: add closed-by-default early access foundation", 01/10 17:08 −03 | Git |
| PRODUCT_BASE_TREE | `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` | Git |
| PHASE_BASE_SHA | `4db8f78ae67fb6634427f48c92a856d1f81f7cfb` (fechamento documental local da Sales Page anterior) | ledger L-051/L-052 |
| HEAD | `THIS_CONTROL_PLANE_COMMIT`, atestação docs-only da L-052; pai candidato `fd68c4f663ced81c3e040367c62697e473b5d542`, tree `aea9a29aa766304a80dc6394d40377632966ce1f` | Git |
| WORKING_TREE | **limpo** após a atestação docs-only; candidato exato, primeiras falhas ambientais e evidências anteriores preservados | `git status --short` |
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5` (tree `62ad70e36a8bcc57331297d8ce929f232fadad2c`): **CERTIFIED_EXACT_SHA** — RUNTIME RECERTIFICATION: PASS (local). Último runtime certificado; o outro SHA com `CERTIFIED_EXACT_SHA` é o C1b `f1b4ec1` (feature) | `reports/recert-0d21874-20261001T010514Z/FINAL-RUNTIME-RECERTIFICATION.md`; `docs/RELEASE-RUNBOOK.md` |
| EARLY_ACCESS_PHASE1 | **CERTIFIED_EXACT_SHA** em `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (= produto de `9f2ddcb` + control plane + 1 arquivo de teste). `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` segue **COMMITTED_FEATURE_CHECKPOINT** (histórico: o dono o designou "certified feature checkpoint", L-009) | ledger L-009, L-016, L-019 |
| CERTIFIED_FEATURE_SHA | **`53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`** · tree `010a448c774247406cc9cc80cba34e8744426557` · **CERTIFIED_EXACT_SHA** (C1 da Fase 2; antes: `f1b4ec1`, Fase 1) | ledger L-027 |
| CONTROL_PLANE_HEAD | `THIS_CONTROL_PLANE_COMMIT`, somente docs, filho de `fd68c4f`; não foi recertificado e não é deployável | `AI-OPERATING-RULES.md` §5.1; L-052 |
| CURRENT_WORK | **FOUNDERS SALES PAGE FINAL BLOCKERS: READY_FOR_INDEPENDENT_AUDIT.** Next.js 16.3.8 remove o advisory de image optimizer; Dashboard/Pools estão certificados como `AVAILABLE` e Portfolio/Orders como `PARTIAL`; publicação, preço final, supply final, data e lançamento continuam bloqueados | L-052 |
| FOUNDERS_CLOSURE_CANDIDATE | `fd68c4f663ced81c3e040367c62697e473b5d542` · tree `aea9a29aa766304a80dc6394d40377632966ce1f` · `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` · 320/320 arquivos, 4.702/4.702 testes | L-052 |
| FOUNDERS_CLOSURE_EVIDENCE | `zswap-local/evidence/founders-sales-final-blockers-20261008T100038Z/`; pacote e manifesto externos fechados depois da atestação docs-only | L-052 |
| LOCAL_PRODCLONE_REHEARSAL | **CLOSED_PASS** (`release-rehearsal-20261003T194816Z`): baseline, backup, restauração, 1º forward, migrations até 0069, boot, saúde, E2E do early access, smoke core, chaos, rollback, 2º forward, equivalência final, reconciliação, type-check, lint, build — todos PASS; suíte completa **4204/4204**; SQL T15/T16/T16b/O2/T14 PASS; RLS/ACL PASS; efeitos externos reais **0** | L-028 |
| LIVE_READONLY_RECONCILIATION | **CLOSED** (`live-readonly-reconciliation-20261003T221654Z`) | L-029 |
| INC-RR-01 | reboot do host Acer durante o ensaio: `HOST_OPERATIONAL_REBOOT` · `AGENT_INDUCED_OOM` · `PRODUCT_DEFECT=NO` · ensaio recuperado · **reconhecido pelo dono (OD-01), registro permanente** | L-028, L-029 |
| STRATEGY_INTELLIGENCE_WORKSTREAM | **DOCUMENTED · NOT_YET_EXECUTING** — `docs/PLANO-STRATEGY-INTELLIGENCE-FORENSIC-LEARNING.md` (FSL-01…10, H1–H6, fases A–G não iniciadas; nenhuma estratégia alterada; `REAL_MONEY_AUTONOMY=NO`) | L-030 |
| RELEASE_RUNBOOK | `docs/RELEASE-RUNBOOK.md` **revisão 2** (alvo `53cd85a`), com errata **RB-01** (`CEX_RECOVERY_HMAC_KEY` obrigatória) e **RB-02** (`DCA_PAUSE_GLOBAL`/kill-switch de autopilot por env não existem) | L-029 |
| PHASE2_IMPLEMENTATION | **CLOSED** e commitada | L-027 |
| PHASE2_CODE_EXISTS | **YES** (commitado no C1) | Git |
| PHASE2_COMMIT | C1 `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` + C2 (atestação, só docs) | Git |
| PHASE2_C1 | **CREATED** `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · parent `74f37f50d12dae698f14b620914bc0ce5b0c639a` | Git |
| PHASE2_RECERT | **PASS** — campanha `recert-c1-53cd85a-v31-20261003T182216Z` (MANIFEST sha256 `31e19f5b1a685b735caf334d000b358ffd49f42f69fc1a1c4c2744d9d0209983`). Campanha anterior `recert-c1-53cd85a-20261003T180548Z`: FAIL · HARNESS_FAILURE_G13_SHELL_QUOTING (classificação pela evidência; **não** atribuída ao dono) | evidência em `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/` |
| PHASE2_CERTIFICATION | **CERTIFIED_EXACT_SHA** `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` | L-027 |
| EARLY_ACCESS_PHASE2_STATUS | **CERTIFIED_EXACT_SHA** (C1) · atestada (C2) · não deployada · gate CLOSED · especificação `docs/PLANO-EARLY-ACCESS-FASE2.md` | L-027 |
| OWNER_PHASE2_PRODUCT_DECISIONS_PENDING | **NONE** (D-1…D-11 em L-021; EA2-A02 em L-023) | ledger |
| EMAIL_PROVIDER_DECISION | **RESEND**, região de envio `sa-east-1` (D-1). Domínio remetente/SPF/DKIM/DMARC = setup externo (D-2), não decisão pendente | L-021 |
| PHASE2_RECERT_RESULTS (certificação) | npm ci 1665 pacotes, lock idêntico · HMAC ×100 100/100 · alvo EA 230/230 · travas 265/265 · SQL 0001→0069: T15 22, T16 31, T16b 2/2, O2 7, T14 6 · type-check 0 · lint 37 arquivos da Fase 2 0/0, completo 0 erros/145 avisos (= baseline) · **build PASS** (Next.js 16.3.6) · **suíte completa 275 arquivos / 4204 testes, 0 falhas** · higiene/segredos PASS · git final limpo · stacks preservadas | `recert-c1-53cd85a-v31-20261003T182216Z` |
| KNOWN_PHASE2_DEFECTS | **0** | L-025…L-027 |
| RELEASE_CANDIDATE | **NONE** | `docs/RELEASE-CHAIN.md` |
| PUBLIC_GATE | **CLOSED** — provado ao vivo (L-029): a superfície pública do early access não existe em produção (app `25fc4b0` sem a rota, banco sem tabelas EA, borda 402) e, no alvo, as 5 condições estão fechadas (`disable_early_access=true` pela 0068, versões `UNAPPROVED`, sem `EARLY_ACCESS_*` na Vercel) | L-029; `src/lib/early-access/gate.ts` |
| EARLY_ACCESS_HMAC_SECRET | **NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN** (nenhum segredo real foi lido) | regra da campanha |
| PRODUCTION_SECRET_STATE | **NOMES medidos ao vivo, valores nunca lidos** (L-029): 24 variáveis na Vercel; **`CEX_RECOVERY_HMAC_KEY` AUSENTE** (exigida pelo alvo → R-02); nenhuma `EARLY_ACCESS_*` | L-029 |
| AUDIT_RECONCILIATION | `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=4` (A08/A09/A10/A17: SOURCE_NOT_FOUND, UNKNOWN_REQUIRES_REVIEW) | `docs/AUDIT-RECONCILIATION.md` |
| DEPLOY_POLICY | **Regra de 31/08 FORMALMENTE SUSPENSA** (dono, 01/10). Deploy só com: SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização explícita do dono | `docs/AI-OPERATING-RULES.md` §6 |
| PRODUCTION | **UNTOUCHED, medida ao vivo em 03/10 (L-029).** App `25fc4b0fa55db72472c7ae00af42596209d7c362` (deployment `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`), **fora do ar: HTTP 402 `DEPLOYMENT_DISABLED`**. Banco: 55 linhas de histórico (nível 0058), 0068/0069 ausentes, fp `864\|74e742469c9088012d87caa88468dc9e` = captura de 28/09 → **drift do Supabase: NENHUM**. `LIVE_PAIR_STATUS=SAFE_KNOWN_SKEW` (P0 `creds_cipher`; 0 sessões, 0 conexões, 0 intents) | L-029 |
| VERCEL | **BLOCKED_BY_ACCOUNT_PAYMENT** (R-01): todas as URLs respondem 402 `DEPLOYMENT_DISABLED`; check do PR #447 "Account is blocked" | L-029 |
| PR447 | **OPEN · DRAFT · MERGEABLE · mergeState UNSTABLE** (03/10). head `43c484bd1fdc24cdbd8182914514d80d769deeb2` (ancestral do C1; **não** contém C1/C2), base `main`. CI `checks` success ×2; check Vercel FAIL (conta bloqueada). C1/C2 não estão em nenhum branch remoto | `gh pr view/checks 447`, L-029 |
| GITHUB_HAS_PRODUCT_BASE | **NÃO.** `9f2ddcb` não está em nenhum ref `origin/*`, então não há CI oficial para ele | `git branch -r --contains 9f2ddcb` vazio |
| ACER_LAB | `LAB_ENV_VERIFIED` (ambiente, não SHA): 4 stacks 25/25 PASS, egress BLOCKED, `BOOT_RESILIENCE=PASS`, `UNATTENDED_BOOT=PASS` (boot 13:18, checado 14:40). **Não tocadas** pela recert | `state/unattended-boot-20261001T1557Z/evidence/post-reboot-unattended-20261001T173957Z.txt` |
| LIFECYCLE | branch → base → plano → implementação → auditoria → correções → pré-commit → **C1** → **recert exata de C1** → **atestação C2 (só docs)** → próxima fase. A Fase 2 completou o ciclo | `AI-OPERATING-RULES.md` §5 |

**Os status não se implicam:** implementação fechada ≠ commitada ≠
recertificada ≠ certificada ≠ deployada ≠ gate público aberto. Hoje valem os
quatro primeiros (no C1); **não** está deployada e o gate público está **fechado**.

#### [HISTÓRICO rev. 15] OPEN_BLOCKERS

| id | bloqueia | estado |
|---|---|---|
| **F-01** EMAIL_DOUBLE_OPT_IN | abrir o gate público | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `53cd85a`)**. Não está em produção; abrir o gate depende dos passos do dono em GATE-OPEN e do release |
| **REL-AUTH** | qualquer push, merge, deploy ou migration hospedada | OWNER_DECISION (política de deploy formalizada) |
| **R-01 VERCEL** | **o release com gate fechado** (e a produção já está fora do ar: 402) | BLOCKED — conta/pagamento da Vercel; dono + provedor |
| **R-02 CEX_RECOVERY_HMAC_KEY** | **o release com gate fechado**: o alvo exige a variável; o deploy **não** pode prosseguir sem ela no ambiente hospedado | REQUIRED_BEFORE_DEPLOY · `CURRENT_HOSTED_STATE=ABSENT` · dono autoriza a alteração de env (valor nunca impresso/versionado) |
| **P0-SKEW** | o autopilot em produção (função indisponível desde 16/09) | OPEN_BLOCKER de produção; só o release resolve (`LEDGER-MESTRE-RELEASE.md` §Y) |
| **MIG-READ** | aplicar 0059→0069 | **leitura feita (L-029)**: 55 linhas, 0059–0069 ausentes; re-ler imediatamente antes da janela. Mecanismo/nomenclatura das versões no hospedado = decisão do dono (EG-05) |
| **AP-LOCK hosted** | fechar a disposição do PostgREST | OWNER_AUTH_REQUIRED (PASS local em PostgREST 14.17) |
| **GATE-OPEN** | abrir o gate (além do F-01 certificado) — **não** bloqueia o release com gate fechado | passos do dono, todos já decididos ou externos: textos de Termos e Privacidade aprovados (inclui D-9: Resend e transferência na Política), domínio remetente (D-2), segredos (HMAC, Resend, webhook) por mecanismo autorizado, aplicar 0068/0069, agendar o cron (D-8), gravar `disable_early_access=false` |
| **REAL-AUTOMATION** | DCA, Pilot e Autopilot reais | NO-GO até os gates finais (`LEDGER-MESTRE-RELEASE.md` §0.5) |
| **FOUNDERS-INDEPENDENT-AUDIT** | publicar/finalizar a experiência pública Founders | PENDING — candidato `fd68c4f` entregue para nova auditoria independente; nenhuma publicação autorizada |
| **FOUNDERS-SUPPLY-CHAIN** | release/publicação do candidato | NEXT HIGH FIXED LOCALLY — `GHSA-cjq9-62q9-8jv4` ausente em Next.js 16.3.8; residual `braces` mantém a disposição condicional anterior e requer auditoria independente |

#### [HISTÓRICO rev. 15] EXTERNAL_GATES (recalculados ao vivo, L-029)

`READY=2 · NOT_READY=5 · BLOCKED=5 · DEFERRED=11 · NOT_PROVABLE=3`. Escopo: **REL** = bloqueia o
release com gate fechado · **EA** = bloqueia a abertura do early access · **$** = bloqueia modos de
dinheiro real · **ND** = diferido/não bloqueante.

| id | gate | status | escopo |
|---|---|---|---|
| EG-01 | deploy do RC na Vercel | BLOCKED | REL |
| EG-02 | re-medição ao vivo do banco | READY (03/10; repetir antes da janela) | REL |
| EG-03 | backup/PITR hospedado e tempo de restauração | NOT_PROVABLE (painel) | REL (rollback B) |
| EG-04 | identidade do deployment de produção | READY (`dpl_C1Ag…` = `25fc4b0`) | REL |
| EG-05 | mecanismo/nomenclatura das migrations no hospedado | NOT_READY (decisão do dono) | REL |
| EG-06 | pagamento/desbloqueio da Vercel (R-01) | BLOCKED | REL |
| EG-07 | DNS/domínio próprio do Z-SWAP | DEFERRED | EA |
| EG-08 | domínio remetente no Resend | DEFERRED | EA |
| EG-09 | SPF | DEFERRED | EA |
| EG-10 | DKIM | DEFERRED | EA |
| EG-11 | DMARC (ausente até para o email atual) | DEFERRED | EA |
| EG-12 | segredos `EARLY_ACCESS_*` / Resend | DEFERRED | EA |
| EG-13 | seleção do RC | NOT_READY | REL |
| EG-14 | aprovação jurídica (Termos/Privacidade, D-9) | BLOCKED | EA |
| EG-15 | smoke de email real | BLOCKED | EA |
| EG-16 | cron do early access no cron-job.org (D-8) | DEFERRED | EA |
| EG-17 | abrir o early access | BLOCKED | EA |
| EG-18 | push/PR/CI de C1–C2 | NOT_READY | REL |
| EG-19 | canário com dinheiro real | DEFERRED | $ |
| EG-20 | DCA real | DEFERRED | $ |
| EG-21 | Pilot real | DEFERRED | $ |
| EG-22 | Autopilot real | DEFERRED | $ |
| EG-23 | P0 `creds_cipher` em produção | NOT_READY (resolvido pelo deploy do alvo) | ND (dormente) |
| EG-24 | `CEX_RECOVERY_HMAC_KEY` na Vercel (R-02) | NOT_READY | REL |
| EG-25 | agendamentos existentes no cron-job.org | NOT_PROVABLE | ND |
| EG-26 | observabilidade hospedada (logs/alertas) | NOT_PROVABLE (app fora do ar) | ND (pós-deploy) |

#### [HISTÓRICO rev. 15] NEXT_ACTION

Nada é automático. `RELEASE_CANDIDATE=NONE` · `RC_SELECTION_READY=NO`.

1. **Dono / provedores (externo):** resolver **R-01** (conta/pagamento da Vercel) e **R-02** (`CEX_RECOVERY_HMAC_KEY`
   no ambiente de produção, por mecanismo autorizado, valor nunca impresso).
2. **Re-medição ao vivo só-leitura** depois disso (mesmas consultas da L-029).
3. **Seleção explícita do RC pelo dono.** Recomendação (≠ seleção): feature `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`;
   qualquer SHA de deploy diferente dele precisa de certificação no SHA exato antes de ser RC.
4. Depois: push/PR/merge e a janela de release conforme `docs/RELEASE-RUNBOOK.md` revisão 2.
5. Separado: abrir o early access (GATE-OPEN) e modos de dinheiro real (NO-GO).



### Revisão 8 (03/10/2026, L-027) — superada pela revisão 9

HEAD/CONTROL_PLANE_HEAD = C2 `57d78ebf42866a53f16ef5f0a5cc24bc3ac97c9c`; produção **não** reverificada
(`PRODUCTION_SECRET_STATE=NOT_VERIFIED`, VERCEL `DEFERRED_EXTERNAL_PAYMENT`, nível 0058 pela captura de
26–29/09); MIG-READ pendente; NEXT_ACTION = decisões do dono (release, abertura, próxima fase).
Cumprido/atualizado em L-028 (ensaio) e L-029 (medição ao vivo).

### Revisão 7 (03/10/2026, L-026) — superada pela revisão 8

Fase 2 fechada **no working tree, sem commit**; `PHASE2_COMMIT=NONE`, `PHASE2_C1=NOT_CREATED`,
`PHASE2_RECERT=NOT_RUN`, `PHASE2_CERTIFICATION=NOT_CERTIFIED`; NEXT_ACTION era a verificação
independente final → autorização do C1 → C1 → recert → C2. Tudo cumprido em L-027. O texto
completo da revisão 7 está no pacote `phase2-control-plane-final-audit-20261003T174725Z.tar.gz`.

### Revisões 3–6 (01–02/10/2026)

> Tudo abaixo foi o estado/instrução **antes** da implementação da Fase 2 e
> está cumprido ou superado. Mantido literalmente para rastreabilidade.

### Cabeçalho anterior a esta revisão (revisões 3–6)

> # CURRENT STATE — onde estamos AGORA
>
> > Responde só "onde estamos agora?". Não é diário: o histórico vai para
> > `docs/LAUNCH-READINESS-LEDGER.md`. Ao mudar de estado, **substitua** este
> > arquivo e **acrescente** uma entrada no ledger.
> >
> > **Medido em:** 01/10/2026, depois de `git fetch origin --tags --prune`.
> > Revisão 3: correções da auditoria independente do control plane, round 1
> > (CP-01…CP-08) + correção do teste EA-TEST-F10-FLAKY no working tree.
> > Revisão 4: round 2 (CP-01…CP-08 e F10 PASS no review do pacote v2);
> > correções CP-09 (atestação C2) e CP-10 (terminologia).
> > Revisão 5 (02/10/2026): C1 `f4af976` commitado; RECERT(C1)=FAIL
> > (EA-TEST-HMAC-189-FLAKY); correção para o C1b no working tree (ledger L-018).
> > Revisão 6 (02/10/2026): C1b `f1b4ec1` commitado; **RECERT(C1b)=PASS** no SHA
> > exato; esta revisão é a atestação **C2**, só docs (ledger L-019).


### Tabela de estado anterior a esta revisão (revisão 6 + linhas atualizadas em L-022…L-025)

| campo | valor | fonte |
|---|---|---|
| CURRENT_WORKTREE | `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001` | `git worktree list` |
| CURRENT_BRANCH | `early-access-phase2-email-double-optin-20261001`, **só local**, sem upstream | Git |
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`, "feat: add closed-by-default early access foundation", 01/10 17:08 −03 | Git |
| PRODUCT_BASE_TREE | `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` | Git |
| WORKTREE_HEAD_AT_LAST_MEASUREMENT | `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (02/10, revisão 6: o C1b, tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6`), medido antes do commit C2. **Snapshot informativo**: o HEAD muda legitimamente com commits de control plane; a regra de identidade está em `START-HERE.md` §10 | Git |
| WORKING_TREE | limpo no C1b; a revisão 6 muda **só docs** (a atestação C2). Nenhum código, teste, migration ou `package*.json` | `git status --short`; `git diff f1b4ec1 -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio |
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5` (tree `62ad70e36a8bcc57331297d8ce929f232fadad2c`): **CERTIFIED_EXACT_SHA** — RUNTIME RECERTIFICATION: PASS (local). Último runtime certificado; o outro SHA com `CERTIFIED_EXACT_SHA` é o C1b `f1b4ec1` (feature) | `reports/recert-0d21874-20261001T010514Z/FINAL-RUNTIME-RECERTIFICATION.md`; `docs/RELEASE-RUNBOOK.md` |
| EARLY_ACCESS_PHASE1 | **CERTIFIED_EXACT_SHA** em `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (= produto de `9f2ddcb` + control plane + 1 arquivo de teste). `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` segue **COMMITTED_FEATURE_CHECKPOINT** (histórico: o dono o designou "certified feature checkpoint", L-009) | ledger L-009, L-016, L-019 |
| PHASE1_RECERT | **PASS** no C1b `f1b4ec1` (campanha `recert-c1b-f1b4ec1-20261002T095819Z`). Histórico: `9f2ddcb` FAIL 1/123 (EA-TEST-F10-FLAKY); C1 `f4af976` FAIL 122/123 (EA-TEST-HMAC-189-FLAKY) | `reports/EARLY-ACCESS-PHASE1-C1B-RECERT-f1b4ec1-20261002.campaign-20261002T095819Z.txt` (sha256 `fcde688a…87ed`); relatórios anteriores preservados |
| CANDIDATE_SHA | C1b `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`: **RECERT PASS** (L-019). C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d`: RECERT FAIL (L-018) | Git; ledger L-018, L-019 |
| CERTIFIED_FEATURE_SHA | **`f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`** · tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` · **CERTIFIED_EXACT_SHA** | ledger L-019 |
| CONTROL_PLANE_HEAD | o commit **C2** que traz esta revisão (`CONTROL_PLANE_ATTESTATION_COMMIT`, filho direto de `f1b4ec1`, só docs). **C2 não é CERTIFIED** e não pode ser deployado. `CERTIFIED_FEATURE_SHA` (C1b) ≠ `CONTROL_PLANE_HEAD` (C2) | `AI-OPERATING-RULES.md` §5.1; ledger L-019 |
| LIFECYCLE | branch → base → plano → implementação → auditoria → correções → pré-commit → **C1** → **recert exata de C1** → **atestação C2 (só docs)** → próxima fase | `AI-OPERATING-RULES.md` §5 |
| RELEASE_CANDIDATE | **NONE** | `docs/RELEASE-CHAIN.md` |
| CURRENT_WORK | **EARLY_ACCESS_PHASE2 FECHADA no working tree, SEM commit, C1 NÃO criado** (03/10, L-025): auditoria própria (L-022) + duas auditorias independentes (L-024: EA2-IA01…IA06; L-025: EA2-IA07…IA09) corrigidas; `KNOWN_PHASE2_DEFECTS=0`; aguardando verificação independente final e autorização do C1. `PHASE_BASE_SHA=74f37f50d12dae698f14b620914bc0ce5b0c639a` | ledger L-020…L-025 |
| NEXT_PHASE | **EARLY_ACCESS_PHASE2_EMAIL_DOUBLE_OPT_IN** | `docs/PLANO-EARLY-ACCESS.md` §13–§15 |
| EARLY_ACCESS_PHASE2_STATUS | **CURRENT_DEVELOPMENT** · fechada no working tree, sem commit (L-025); especificação final em `docs/PLANO-EARLY-ACCESS-FASE2.md`. Histórico desta linha antes de 02/10: **BLOCKED_NOT_STARTED** · `PHASE2_CODE_EXISTS=NO`. Feito: control plane commitado (C1/C1b) e recert da Fase 1 PASS (C1b). Falta: o plano da Fase 2 escrito (com `PHASE_BASE_SHA` = SHA do commit de atestação C2, `THIS_ATTESTATION_COMMIT`) e a decisão do provider de email | Git (nenhum código da Fase 2 no tree) |
| PUBLIC_GATE | **CLOSED**, independente do segredo: `disable_early_access=true` semeado na 0068, versões legais `UNAPPROVED`, e requisitos fail-closed; o gate é um AND de 4 condições | `supabase/migrations/0068_early_access.sql`, `src/lib/early-access/gate.ts` |
| EARLY_ACCESS_HMAC_SECRET | **NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN** (nenhum segredo real foi lido) | regra da campanha |
| PRODUCTION_SECRET_STATE | **NOT_VERIFIED** (produção e Supabase/Vercel hospedados não foram inspecionados) | regra da campanha |
| AUDIT_RECONCILIATION | `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=4` (A08/A09/A10/A17: SOURCE_NOT_FOUND, UNKNOWN_REQUIRES_REVIEW) | `docs/AUDIT-RECONCILIATION.md` |
| DEPLOY_POLICY | **Regra de 31/08 FORMALMENTE SUSPENSA** (dono, 01/10). Deploy só com: SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização explícita do dono | `docs/AI-OPERATING-RULES.md` §6 |
| PRODUCTION | **UNTOUCHED.** Código `25fc4b0fa55db72472c7ae00af42596209d7c362` (`main`), banco no nível **0058** por conteúdo. P0-SKEW: armar autopilot falha em produção desde 16/09 (0 sessões, 0 intents) | `docs/LEDGER-MESTRE-RELEASE.md` §0, §Y (`[VERCEL]` + `[PROD]` de 26/09). **Não reverificado em 01/10**: a regra é não tocar |
| VERCEL | **DEFERRED_EXTERNAL_PAYMENT.** O check Vercel do PR #447 está em FAILURE (diferido) | relatórios `postreboot-*`, `fourstack-*` |
| PR447 | **OPEN · DRAFT · não mergeado · MERGEABLE.** head `43c484bd1fdc24cdbd8182914514d80d769deeb2`, base `main`. CI `success` (runs 36838326106, 36838252838) | `gh pr view 447` + `gh run list`, 01/10 |
| GITHUB_HAS_PRODUCT_BASE | **NÃO.** `9f2ddcb` não está em nenhum ref `origin/*`, então não há CI oficial para ele | `git branch -r --contains 9f2ddcb` vazio |
| ACER_LAB | `LAB_ENV_VERIFIED` (ambiente, não SHA): 4 stacks 25/25 PASS, egress BLOCKED, `BOOT_RESILIENCE=PASS`, `UNATTENDED_BOOT=PASS` (boot 13:18, checado 14:40). **Não tocadas** pela recert | `state/unattended-boot-20261001T1557Z/evidence/post-reboot-unattended-20261001T173957Z.txt` |
| ENTRYPOINTS | `CLAUDE.md` (integrado, topo), `AGENTS.md`, `docs/README.md` (bloco START HERE + banner LEGACY no índice antigo) → `docs/START-HERE.md`. Commitados no C1 `f4af976` | Git |

### Recertificação da Fase 1 no SHA commitado

Campanha `recert-ea1-9f2ddcb-20261001T213835Z` (Node 24.21.0 / npm 11.19.0,
mesmas imagens da recert de `0d21874`; testes com `--network none`).

| gate | resultado |
|---|---|
| identidade (HEAD, tree, `git diff HEAD -- src supabase package*.json` vazio) | PASS |
| cache npm (1310/1310) + `npm ci --offline` (1665 pacotes, lock byte-idêntico) | PASS |
| type-check | PASS |
| lint | PASS: 0 erros / 145 avisos (= baseline), 0 nos arquivos de early access |
| testes alvo de early access (7 arquivos) | **FAIL: 1/123** |
| guardas (areas, painel-desenhado, portao, conexoes-0063, rpcs-acl, quatro-idiomas, nao-vaza) | PASS 264/264 |
| build, suíte completa, SQL T15 | **NOT_RUN** (campanha parada no 1º gate que falhou, por regra) |

**Causa:** em `src/lib/early-access/gate-hmac-referral.test.ts:121`, o
controle negativo `randomBytes(48).toString("base64url")` espera rejeição.
Quando os 64 caracteres aleatórios não têm `-` nem `_`, a string também é
base64 padrão canônico de 48 bytes aleatórios, e o código **corretamente**
a aceita. Taxa de falha: teórica (62/64)^64 = 13,1%; empírica 12,97% em
200 000 amostras.

- É um **defeito de teste** (EA-TEST-F10-FLAKY). Nenhum impacto de produto foi
  identificado.
- Não foi corrigido durante a recert (regra da missão). O "PASS" registrado
  no `PLANO-EARLY-ACCESS.md` §14 foi uma passada probabilística.
- **Revisão 3 (autorizada pelo dono, sem commit):** o controle negativo agora
  é determinístico. 48 bytes fixos e distintos cujo base64url contém `-`/`_`,
  com o gêmeo em base64 padrão provado aceito. `hmac.ts` **não** mudou.
  Validação pré-commit: F10 100/100, testes alvo EA, type-check, lint dos
  arquivos alterados e `git diff --check` (ledger L-016). **Não é
  recertificação**: ela acontece no SHA do commit candidato, completa (build,
  suíte, T15 inclusos).

### Recertificação do C1 no SHA exato (02/10)

C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d`. Campanha válida:
`recert-c1-f4af976-20261002T012205Z`, com limites fixos desde o início
(`CONTAINER_MEMORY_LIMIT=2G`, `CONTAINER_MEMORY_SWAP_LIMIT=5G`,
`NODE_OPTIONS=--max-old-space-size=1792`). Três campanhas anteriores do mesmo
C1 não deram veredito (ABORTED, CLOSED_NONCOMPLIANT, ENVIRONMENT_BLOCKED_MEMORY;
ledger L-018).

| gate | resultado |
|---|---|
| identidade, ancestralidade, escopo, disco | PASS |
| `npm ci --offline` (1665 pacotes, lock byte-idêntico) | PASS |
| F10 ×100 | PASS 100/100 |
| testes alvo de early access (7 arquivos) | **FAIL: 122/123** |
| guardas, T15, type-check, lint, build, suíte completa | NOT_RUN (parada no 1º gate que falhou) |

**Causa:** `gate-hmac-referral.test.ts:157`. Com o segredo de teste aleatório
por processo, o controle negativo "o HMAC não contém '189'" falha em ≈ 0,73%
das execuções (EA-TEST-HMAC-189-FLAKY). Defeito de teste; nenhum impacto de
produto identificado. **Correção (revisão 5, autorizada, sem commit):**
segredo de teste fixo e determinístico; só o arquivo de teste muda. Vai no
commit candidato C1b, que precisa de recert completa no SHA exato.

### Recertificação do C1b no SHA exato (02/10): PASS

C1b `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (tree
`ab814e3ba6369a8b66218a9accc76a18ca6f14f6`). **Única campanha que estabelece
`RECERT(C1b)=PASS`:** `recert-c1b-f1b4ec1-20261002T095819Z`, com limites fixos
desde o início (`--memory=2g`; `--memory-swap=5g` = total RAM+swap, ≈ 3G de
swap utilizável; `NODE_OPTIONS=--max-old-space-size=1792`).

| gate | resultado |
|---|---|
| control plane relido, identidade, ancestralidade, escopo (6 caminhos), delta de produto (só o teste), delta de dependências (vazio) | PASS |
| saúde do host | PASS |
| cache npm 1310/1310 + `npm ci --offline` (`--network none`) | PASS: 1665 pacotes, lock byte-idêntico, árvore limpa |
| `gate-hmac-referral.test.ts` inteiro ×100 | PASS: 100/100 processos, 25/25 cada |
| alvo EA (7 arquivos) | PASS 123/123 |
| guardas (7 arquivos) | PASS 264/264 |
| SQL T15 (PostgreSQL descartável, `--network none`) | PASS 22/22, 68 migrations |
| type-check | PASS (0 erros; também sem cache incremental) |
| lint do arquivo alterado / lint completo | PASS 0/0 · 0 erros / 145 avisos (= baseline) |
| build | PASS: Next.js 16.3.6, exit 0, 159 s |
| suíte completa | PASS: 271 arquivos, 4096 testes, 0 fail / 0 skip / 0 todo |
| git final · stacks preservadas | PASS: HEAD/TREE inalterados, status CLEAN, `diff --check` PASS · 32 containers inalterados |

Produção, Vercel e Supabase hospedado: **não tocados**. Relatório:
`/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/EARLY-ACCESS-PHASE1-C1B-RECERT-f1b4ec1-20261002.campaign-20261002T095819Z.txt`
(sha256 `fcde688a00e89b63acc68e0736848067972d87e1b216fa3e4d559b9789b887ed`).
Evidência: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/recert-c1b-f1b4ec1-20261002T095819Z/`
(`MANIFEST.sha256` sha256 `3cf5c7b30f21010eafff90ebe877bf76494e254dab3e3c0ea989d5b9aecf51ed`).

Outras campanhas do C1b, preservadas (ledger L-019):

- `…092724Z`: **ENVIRONMENT_BLOCKED** (memória do host abaixo de 1 GiB antes do
  `npm ci`; nenhum gate funcional rodou).
- `…093950Z`: **HARNESS_FAILURE** · `PRODUCT_VERDICT=NONE` · `SHA_VERDICT=NONE`.
  O npm 11.19 precisa escrever no índice do cache; com o cache montado somente
  leitura, deu `ENOTCACHED`. A campanha PASS usou uma cópia gravável e
  descartável do cache, e o repo não mudou.

Notas da campanha PASS:

- **HARNESS_LABEL_BUG_G11:** o laço do T15 sobrescreveu o índice do driver, e
  o `RESULTS.env` gravou `IDENTITY` no lugar de `SQL_T15`. Não alterou o
  resultado real; a fonte autoritativa é o log bruto do T15 (22/22, 68
  migrations, exit 0). Correção no harness v3, fora do repo.
- **`BUILD_NETWORK=BRIDGE`** (como na recert do `0d21874`, por causa do
  `next/font/google`). No prerender houve acesso à API pública `api.llama.fi`,
  sem segredo. Não é produção tocada.
- **Avisos do Next.js no build** (baseline / convenção existente, não falhas):
  convenção `middleware` obsoleta; Edge Runtime obsoleto; edge runtime desliga
  a geração estática da página.

### OPEN_BLOCKERS anteriores a esta revisão

| id | bloqueia | estado |
|---|---|---|
| **F-01** EMAIL_DOUBLE_OPT_IN | abrir o gate público | OPEN_BLOCKER, trabalho da Fase 2 |
| **REL-AUTH** | qualquer push, merge, deploy ou migration hospedada | OWNER_DECISION (política de deploy formalizada) |
| **VERCEL** | deploy, preview e check do PR | EXTERNAL_DEPENDENCY (pagamento) |
| **P0-SKEW** | o autopilot em produção (função indisponível desde 16/09) | OPEN_BLOCKER de produção; só o release resolve (`LEDGER-MESTRE-RELEASE.md` §Y) |
| **MIG-READ** | aplicar 0059→0067 (+0068) | é preciso ler o `schema_migrations` de produção antes, com autorização (`RELEASE-RUNBOOK.md` §6.2) |
| **AP-LOCK hosted** | fechar a disposição do PostgREST | OWNER_AUTH_REQUIRED (PASS local em PostgREST 14.17) |
| **LEGAL / HMAC / 0068** | abrir o gate (além do F-01) | OWNER_DECISION: textos de Termos e Privacidade, segredo HMAC (estado em produção NOT_VERIFIED), aplicar a 0068 |
| **REAL-AUTOMATION** | DCA, Pilot e Autopilot reais | NO-GO até os gates finais (`LEDGER-MESTRE-RELEASE.md` §0.5) |

Fechados na revisão 6 (L-019): **EA-RECERT** (RECERT(C1b)=PASS),
**EA-TEST-F10-FLAKY** e **EA-TEST-HMAC-189-FLAKY** (FIXED_CERTIFIED,
`CERTIFIED_EXACT_SHA` `f1b4ec1`), **CP-REVIEW** (control plane commitado e
atestado pelo C2).

### Artefatos locais anteriores a esta revisão

- `node_modules/` na worktree, criado pelo `npm ci` da recert. É ignorado
  pelo `.gitignore` e não aparece no `git status`.
- `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/recert-ea1-9f2ddcb-20261001T213835Z/`:
  cópia verificada do cache npm (~1,8 GB) para uma recert futura.
  Para o npm 11.19 ele precisa ser usado por uma **cópia gravável e
  descartável** (o harness v2 copia para dentro do container); montado
  somente leitura direto, dá `ENOTCACHED` (L-019).
- Harness v2 da recert: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/recert-c1b-f1b4ec1-20261002T095819Z/`
  (fora do repo; o v3 deve declarar `local` a variável do laço do T15).

### NEXT_ACTION anterior a esta revisão (cumprido: C2 = `74f37f5`; plano da Fase 2 escrito; provider decidido = RESEND)

1. Commit do C2 (esta revisão, só docs) sobre o C1b `f1b4ec1`, por decisão
   do dono. O commit que traz esta revisão **é** o C2: `CONTROL_PLANE_HEAD` =
   `THIS_ATTESTATION_COMMIT` (SHA concreto: `git rev-parse` desse commit; o C2 não guarda o
   próprio SHA). Conferir com `git diff --stat f1b4ec1..<SHA do C2> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'`
   vazio e `git merge-base --is-ancestor f1b4ec1 <SHA do C2>`, registrados na
   próxima entrada do ledger.
2. Plano da Fase 2 **antes de qualquer código** (`START-HERE.md` §9 item 4),
   com `PHASE_BASE_SHA` = SHA do C2 (`THIS_ATTESTATION_COMMIT`) registrado no ledger.
3. Decisão do dono: provider de email (OWNER_DECISION; bloqueia a
   implementação da Fase 2).
4. Release continua bloqueado: `RELEASE_CANDIDATE=NONE`; C2 não é deployável
   (`AI-OPERATING-RULES.md` §5.1, §6.1).
