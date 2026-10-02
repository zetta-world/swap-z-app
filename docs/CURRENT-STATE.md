# CURRENT STATE — onde estamos AGORA

> Responde só "onde estamos agora?". Não é diário: o histórico vai para
> `docs/LAUNCH-READINESS-LEDGER.md`. Ao mudar de estado, **substitua** este
> arquivo e **acrescente** uma entrada no ledger.
>
> **Medido em:** 01/10/2026, depois de `git fetch origin --tags --prune`.
> Revisão 3: correções da auditoria independente do control plane, round 1
> (CP-01…CP-08) + correção do teste EA-TEST-F10-FLAKY no working tree.
> Revisão 4: round 2 (CP-01…CP-08 e F10 PASS no review do pacote v2);
> correções CP-09 (atestação C2) e CP-10 (terminologia).
> Revisão 5 (02/10/2026): C1 `f4af976` commitado; RECERT(C1)=FAIL
> (EA-TEST-HMAC-189-FLAKY); correção para o C1b no working tree (ledger L-018).

---

| campo | valor | fonte |
|---|---|---|
| CURRENT_WORKTREE | `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001` | `git worktree list` |
| CURRENT_BRANCH | `early-access-phase2-email-double-optin-20261001`, **só local**, sem upstream | Git |
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`, "feat: add closed-by-default early access foundation", 01/10 17:08 −03 | Git |
| PRODUCT_BASE_TREE | `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` | Git |
| WORKTREE_HEAD_AT_LAST_MEASUREMENT | `f4af9764e4c773f1bba2821f6cbef9685cfeb59d` (02/10, revisão 5: o C1, tree `d214a354b75cafbd13d2882c94eec98c0e262a28`). **Snapshot informativo**: o HEAD muda legitimamente com commits de control plane; a regra de identidade está em `START-HERE.md` §10 | Git |
| WORKING_TREE | sujo **pela correção do C1b**: docs do control plane (revisão 5) + **1 arquivo de teste** (`src/lib/early-access/gate-hmac-referral.test.ts`, EA-TEST-HMAC-189-FLAKY). Nenhum código de produto, nenhuma migration | `git status --short` |
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5` (tree `62ad70e36a8bcc57331297d8ce929f232fadad2c`): **CERTIFIED_EXACT_SHA** — RUNTIME RECERTIFICATION: PASS (local). É o único SHA com essa marca | `reports/recert-0d21874-20261001T010514Z/FINAL-RUNTIME-RECERTIFICATION.md`; `docs/RELEASE-RUNBOOK.md` |
| EARLY_ACCESS_PHASE1_CHECKPOINT | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`: **COMMITTED_FEATURE_CHECKPOINT**. O dono o designou antes "certified feature checkpoint" (histórico, L-009); o control plane reserva `CERTIFIED` para recert exata em PASS | `docs/PLANO-EARLY-ACCESS.md` §14–§15; ledger L-009, L-016 |
| PHASE1_RECERT | **BLOCKED.** `9f2ddcb`: FAIL 1/123 (EA-TEST-F10-FLAKY). C1 `f4af976`: **RECERT(C1)=FAIL**, alvo EA 122/123 (EA-TEST-HMAC-189-FLAKY) | `reports/EARLY-ACCESS-PHASE1-RECERT-9f2ddcb-20261001.txt`; `reports/EARLY-ACCESS-PHASE1-C1-RECERT-f4af976-20261001.txt` |
| CANDIDATE_SHA | C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d`: **RECERT FAIL** (ledger L-018). Próximo candidato: **C1b** (ainda não existe) | Git; ledger L-018 |
| CERTIFIED_FEATURE_SHA | **NONE**. Vai ser o C1b se RECERT(C1b)=PASS | este documento |
| CONTROL_PLANE_HEAD | **NOT_YET_COMMITTED**: não há C2 (o C1 falhou na recert; o control plane commitado no C1 não é atestação). Vai ser o commit de atestação C2 (só docs) sobre o C1b. `CERTIFIED_FEATURE_SHA` ≠ necessariamente `CONTROL_PLANE_HEAD`; C2 nunca é CERTIFIED | `AI-OPERATING-RULES.md` §5.1 |
| LIFECYCLE | branch → base → plano → implementação → auditoria → correções → pré-commit → **C1** → **recert exata de C1** → **atestação C2 (só docs)** → próxima fase | `AI-OPERATING-RULES.md` §5 |
| RELEASE_CANDIDATE | **NONE** | `docs/RELEASE-CHAIN.md` |
| CURRENT_WORK | **CONTROL_PLANE_REVIEW_AND_PHASE1_RECERT** | este documento |
| NEXT_PHASE | **EARLY_ACCESS_PHASE2_EMAIL_DOUBLE_OPT_IN** | `docs/PLANO-EARLY-ACCESS.md` §13–§15 |
| EARLY_ACCESS_PHASE2_STATUS | **BLOCKED_NOT_STARTED** · `PHASE2_CODE_EXISTS=NO`. Vira `CURRENT_DEVELOPMENT` só depois de: control plane aprovado e commitado; recert da Fase 1 PASS no SHA novo; plano da Fase 2 escrito; decisão do provider quando necessária | Git (nenhum código da Fase 2 no tree) |
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
| ENTRYPOINTS | `CLAUDE.md` (integrado, topo), `AGENTS.md` (novo), `docs/README.md` (bloco START HERE + banner LEGACY no índice antigo) → `docs/START-HERE.md`. **Sem commit** | working tree |

## Recertificação da Fase 1 no SHA commitado

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

## Recertificação do C1 no SHA exato (02/10)

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

## OPEN_BLOCKERS

| id | bloqueia | estado |
|---|---|---|
| **F-01** EMAIL_DOUBLE_OPT_IN | abrir o gate público | OPEN_BLOCKER, trabalho da Fase 2 |
| **EA-RECERT / EA-TEST-HMAC-189-FLAKY** | dar a Fase 1 por recertificada; promover qualquer SHA da linha EA | BLOCKED. RECERT(C1)=FAIL; correção no working tree (revisão 5); faltam commit C1b + recert completa no SHA exato de C1b. EA-TEST-F10-FLAKY: FIXED_NOT_RECERTIFIED (no C1) |
| **CP-REVIEW** | commit do control plane; início da Fase 2 | round 1 e round 2 auditados (CP-01…CP-08 e F10 PASS; MANIFEST PASS, sem segredo). CP-09/CP-10 corrigidos na revisão 4. Control plane commitado no C1 `f4af976` (02/10); não há atestação C2 porque RECERT(C1)=FAIL |
| **REL-AUTH** | qualquer push, merge, deploy ou migration hospedada | OWNER_DECISION (política de deploy formalizada) |
| **VERCEL** | deploy, preview e check do PR | EXTERNAL_DEPENDENCY (pagamento) |
| **P0-SKEW** | o autopilot em produção (função indisponível desde 16/09) | OPEN_BLOCKER de produção; só o release resolve (`LEDGER-MESTRE-RELEASE.md` §Y) |
| **MIG-READ** | aplicar 0059→0067 (+0068) | é preciso ler o `schema_migrations` de produção antes, com autorização (`RELEASE-RUNBOOK.md` §6.2) |
| **AP-LOCK hosted** | fechar a disposição do PostgREST | OWNER_AUTH_REQUIRED (PASS local em PostgREST 14.17) |
| **LEGAL / HMAC / 0068** | abrir o gate (além do F-01) | OWNER_DECISION: textos de Termos e Privacidade, segredo HMAC (estado em produção NOT_VERIFIED), aplicar a 0068 |
| **REAL-AUTOMATION** | DCA, Pilot e Autopilot reais | NO-GO até os gates finais (`LEDGER-MESTRE-RELEASE.md` §0.5) |

## DEFERRED_FINDINGS (não bloqueiam a Fase 2)

F-05, F-09, F-11 (escopo da Fase 2), F-13, F-14, F-15, F-16; R8-CORRIDA,
HARNESS-001/002, 36 moderate / 1 low do `npm audit`, HOST-CRED-001, AUTOLOGIN.
**A08, A09, A10 e A17 da auditoria externa:** SOURCE_NOT_FOUND depois da
2ª busca forense; seguem UNKNOWN_REQUIRES_REVIEW. Nenhuma correção
**conhecida e identificável** foi encontrada fora da linha; A08/A09/A10/A17
permanecem sem fonte e não permitem conclusão. Tabela completa:
`docs/AUDIT-RECONCILIATION.md` §5.

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

## Artefatos locais desta revisão (fora do Git)

- `node_modules/` na worktree, criado pelo `npm ci` da recert. É ignorado
  pelo `.gitignore` e não aparece no `git status`.
- `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/recert-ea1-9f2ddcb-20261001T213835Z/`:
  cópia verificada do cache npm (~1,8 GB) para uma recert futura.

## NEXT_ACTION

1. Decisão do dono: **commit candidato C1b** (correção EA-TEST-HMAC-189-FLAKY
   + docs da revisão 5) sobre o C1 `f4af976`.
2. **Recertificação completa no SHA exato de C1b** (npm ci, build, type-check,
   lint, alvo, guardas, suíte completa, SQL T15), com os limites de memória
   fixos desde o início.
3. PASS → **commit de atestação C2**, só docs: `CERTIFIED_FEATURE_SHA=<C1b>`,
   `RECERT_RESULT=PASS`, evidência, e prova de diff de produto `C1..C2`
   vazio. Daí `CONTROL_PLANE_HEAD=<C2>`.
   FAIL → registrar o FAIL, sem atestação PASS, sem retry-to-pass; corrigir,
   novo commit candidato, recert dele inteiro.
4. Só então: o plano da Fase 2 (PHASE_BASE_SHA = C2) e a escolha do provider
   de email.
