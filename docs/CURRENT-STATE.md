# CURRENT STATE — onde estamos AGORA

> Responde só "onde estamos agora?". Não é diário: o histórico vai para
> `docs/LAUNCH-READINESS-LEDGER.md`. Ao mudar de estado, **substitua** as seções
> atuais e **acrescente** uma entrada no ledger.
>
> **Medido em:** 03/10/2026 (revisão 8, ledger L-027: Fase 2 certificada no C1 `53cd85a` e atestada
> neste C2. Revisão 7, ledger L-026 — achado EA2-IA10 da
> verificação independente final: este arquivo ainda trazia instruções de antes
> da Fase 2). As seções atuais abaixo descrevem só o estado de hoje; tudo o que
> valia nas revisões 3–6 está na seção final **HISTÓRICO**, inalterado.

---

## Estado atual

| campo | valor | fonte |
|---|---|---|
| CURRENT_WORKTREE | `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001` | `git worktree list` |
| CURRENT_BRANCH | `early-access-phase2-email-double-optin-20261001`, **só local**, sem upstream | Git |
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`, "feat: add closed-by-default early access foundation", 01/10 17:08 −03 | Git |
| PRODUCT_BASE_TREE | `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` | Git |
| PHASE_BASE_SHA | `74f37f50d12dae698f14b620914bc0ce5b0c639a` · tree `5c93c0512b74777724aae62f665b10feaa95f760` (C2 da Fase 1) | ledger L-020 |
| HEAD | o C2 da Fase 2 (`THIS_ATTESTATION_COMMIT`, só docs; filho direto do C1 `53cd85a`; SHA concreto via `git rev-parse HEAD`) | Git |
| WORKING_TREE | **limpo** (Fase 2 commitada no C1, atestada no C2) | `git status --short` |
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5` (tree `62ad70e36a8bcc57331297d8ce929f232fadad2c`): **CERTIFIED_EXACT_SHA** — RUNTIME RECERTIFICATION: PASS (local). Último runtime certificado; o outro SHA com `CERTIFIED_EXACT_SHA` é o C1b `f1b4ec1` (feature) | `reports/recert-0d21874-20261001T010514Z/FINAL-RUNTIME-RECERTIFICATION.md`; `docs/RELEASE-RUNBOOK.md` |
| EARLY_ACCESS_PHASE1 | **CERTIFIED_EXACT_SHA** em `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (= produto de `9f2ddcb` + control plane + 1 arquivo de teste). `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` segue **COMMITTED_FEATURE_CHECKPOINT** (histórico: o dono o designou "certified feature checkpoint", L-009) | ledger L-009, L-016, L-019 |
| CERTIFIED_FEATURE_SHA | **`53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`** · tree `010a448c774247406cc9cc80cba34e8744426557` · **CERTIFIED_EXACT_SHA** (C1 da Fase 2; antes: `f1b4ec1`, Fase 1) | ledger L-027 |
| CONTROL_PLANE_HEAD | o C2 da Fase 2 (`THIS_ATTESTATION_COMMIT`, só docs; **não** CERTIFIED, não deployável). `CERTIFIED_FEATURE_SHA` (C1) ≠ `CONTROL_PLANE_HEAD` (C2) | `AI-OPERATING-RULES.md` §5.1 |
| CURRENT_WORK | **EARLY_ACCESS_PHASE2 FECHADA**: C1 certificado (recert exata PASS) e atestado no C2. Sem fase de produto em curso; próximos passos são decisões do dono (release, abertura) | ledger L-027 |
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
| PUBLIC_GATE | **CLOSED**: `disable_early_access=true` (seed da 0068), versões legais `UNAPPROVED`, sem segredo HMAC, sem provider de email configurado — o gate exige as 5 condições | `src/lib/early-access/gate.ts`, 0068 |
| EARLY_ACCESS_HMAC_SECRET | **NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN** (nenhum segredo real foi lido) | regra da campanha |
| PRODUCTION_SECRET_STATE | **NOT_VERIFIED** (produção e Supabase/Vercel hospedados não foram inspecionados) | regra da campanha |
| AUDIT_RECONCILIATION | `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=4` (A08/A09/A10/A17: SOURCE_NOT_FOUND, UNKNOWN_REQUIRES_REVIEW) | `docs/AUDIT-RECONCILIATION.md` |
| DEPLOY_POLICY | **Regra de 31/08 FORMALMENTE SUSPENSA** (dono, 01/10). Deploy só com: SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização explícita do dono | `docs/AI-OPERATING-RULES.md` §6 |
| PRODUCTION | **UNTOUCHED.** Código `25fc4b0fa55db72472c7ae00af42596209d7c362` (`main`), banco no nível **0058** por conteúdo. P0-SKEW: armar autopilot falha em produção desde 16/09 (0 sessões, 0 intents) | `docs/LEDGER-MESTRE-RELEASE.md` §0, §Y (`[VERCEL]` + `[PROD]` de 26/09). **Não reverificado em 01/10**: a regra é não tocar |
| VERCEL | **DEFERRED_EXTERNAL_PAYMENT.** O check Vercel do PR #447 está em FAILURE (diferido) | relatórios `postreboot-*`, `fourstack-*` |
| PR447 | **OPEN · DRAFT · não mergeado · MERGEABLE.** head `43c484bd1fdc24cdbd8182914514d80d769deeb2`, base `main`. CI `success` (runs 36838326106, 36838252838) | `gh pr view 447` + `gh run list`, 01/10 |
| GITHUB_HAS_PRODUCT_BASE | **NÃO.** `9f2ddcb` não está em nenhum ref `origin/*`, então não há CI oficial para ele | `git branch -r --contains 9f2ddcb` vazio |
| ACER_LAB | `LAB_ENV_VERIFIED` (ambiente, não SHA): 4 stacks 25/25 PASS, egress BLOCKED, `BOOT_RESILIENCE=PASS`, `UNATTENDED_BOOT=PASS` (boot 13:18, checado 14:40). **Não tocadas** pela recert | `state/unattended-boot-20261001T1557Z/evidence/post-reboot-unattended-20261001T173957Z.txt` |
| LIFECYCLE | branch → base → plano → implementação → auditoria → correções → pré-commit → **C1** → **recert exata de C1** → **atestação C2 (só docs)** → próxima fase. A Fase 2 completou o ciclo | `AI-OPERATING-RULES.md` §5 |

**Os status não se implicam:** implementação fechada ≠ commitada ≠
recertificada ≠ certificada ≠ deployada ≠ gate público aberto. Hoje valem os
quatro primeiros (no C1); **não** está deployada e o gate público está **fechado**.

## OPEN_BLOCKERS

| id | bloqueia | estado |
|---|---|---|
| **F-01** EMAIL_DOUBLE_OPT_IN | abrir o gate público | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `53cd85a`)**. Não está em produção; abrir o gate depende dos passos do dono em GATE-OPEN e do release |
| **REL-AUTH** | qualquer push, merge, deploy ou migration hospedada | OWNER_DECISION (política de deploy formalizada) |
| **VERCEL** | deploy, preview e check do PR | EXTERNAL_DEPENDENCY (pagamento) |
| **P0-SKEW** | o autopilot em produção (função indisponível desde 16/09) | OPEN_BLOCKER de produção; só o release resolve (`LEDGER-MESTRE-RELEASE.md` §Y) |
| **MIG-READ** | aplicar 0059→0067 (+0068, 0069) | é preciso ler o `schema_migrations` de produção antes, com autorização (`RELEASE-RUNBOOK.md` §6.2) |
| **AP-LOCK hosted** | fechar a disposição do PostgREST | OWNER_AUTH_REQUIRED (PASS local em PostgREST 14.17) |
| **GATE-OPEN** | abrir o gate (além do F-01 certificado) | passos do dono, todos já decididos ou externos: textos de Termos e Privacidade aprovados (inclui D-9: Resend e transferência na Política), domínio remetente (D-2), segredos (HMAC, Resend, webhook) por mecanismo autorizado, aplicar 0068/0069, agendar o cron (D-8), gravar `disable_early_access=false` |
| **REAL-AUTOMATION** | DCA, Pilot e Autopilot reais | NO-GO até os gates finais (`LEDGER-MESTRE-RELEASE.md` §0.5) |

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

A Fase 2 está **fechada** (C1 `53cd85a` CERTIFIED_EXACT_SHA + C2 de atestação). Nada é automático; tudo
abaixo é decisão do dono:

1. **Release** (push/PR/merge/deploy): exige marcar um SHA `RELEASE_CANDIDATE` com certificação PASS
   e autorização explícita; inclui MIG-READ (ler o `schema_migrations` de produção) antes de aplicar
   0059→0069. Hoje `RELEASE_CANDIDATE=NONE`.
2. **Abrir o early access**: os passos de GATE-OPEN (jurídico/D-9, domínio/D-2, segredos, migrations,
   cron/D-8, `disable_early_access=false`).
3. **Próxima fase de produto**: parte do C2 como `PHASE_BASE_SHA`, com ledger novo antes de qualquer código.

## HISTÓRICO (NÃO são instruções atuais)

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
