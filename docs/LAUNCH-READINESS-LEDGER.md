# LAUNCH READINESS LEDGER — livro-razão

> Função: **registrar**. Uma entrada por marco, sempre **acrescentada no fim**.
> Quando um estado muda, **não se edita a entrada antiga**: acrescenta-se uma
> nova que cita a anterior.
>
> Estados: `DONE` · `CERTIFIED_EXACT_SHA` · `CERTIFIED_RUNTIME_ANCESTOR` · `HISTORICAL_CERTIFICATION_LEGACY` · `LAB_ENV_VERIFIED` · `CURRENT` · `BLOCKED` · `DEFERRED` ·
> `NOT_STARTED` · `COMMITTED_FEATURE_CHECKPOINT` · `BLOCKED_NOT_STARTED` ·
> `CURRENT_DEVELOPMENT`. **`CERTIFIED` só para SHA com recert exata em PASS**
> (desde a revisão 3, L-016). Desde a revisão 4 (L-017), toda certificação é
> qualificada: `CERTIFIED_EXACT_SHA` · `CERTIFIED_RUNTIME_ANCESTOR` ·
> `HISTORICAL_CERTIFICATION_LEGACY`; ambiente usa `LAB_ENV_VERIFIED`. As
> palavras "CERTIFIED" nas entradas L-001…L-015 ficam como foram escritas
> (história) e levam uma anotação `[CP-10: …]` com o termo atual.
>
> Ancestralidade: `docs/RELEASE-CHAIN.md`. Findings: `docs/AUDIT-RECONCILIATION.md`
> §5. Evidência bruta (fora do repo): `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/{reports,evidence,state}`.

---

## Visão das fases (snapshot derivado, revisão 4 de 01/10/2026; a fonte é a lista de entradas abaixo)

| fase | SHA | estado |
|---|---|---|
| Produção histórica (`main`) | `25fc4b0` | DONE (em produção) |
| Rounds 1–8 | `d7741bb` … `83c50fe` | DONE |
| Round 9 | `798fe27` | HISTORICAL_CERTIFICATION_LEGACY |
| Platform Closure B1/B2 | `a5bdd61` / `3123fb4` | HISTORICAL_CERTIFICATION_LEGACY (B2 tem retest independente PASS, `docs/retest-independente-batch2-3123fb4.md`, mas não recert completa pelo critério atual) |
| Platform Closure B3 (0067) | `691bfdc` | DONE (SUPERSEDED como candidato) |
| Preprod blocker closure | `16e4000` | DONE |
| Runtime certificado | `0d21874` | **CERTIFIED_EXACT_SHA** |
| Docs baseline / PR #447 | `43c484b` | DOCS_BASELINE · `CERTIFIED_RUNTIME_ANCESTOR=0d21874` · `DELTA=DOCS_ONLY` · CI PASS · `EXACT_SHA_RECERTIFIED=NO` · PR DRAFT |
| Laboratório local (4 stacks, boot) | — | LAB_ENV_VERIFIED (ambiente, não SHA) |
| Control plane review + recert da Fase 1 | (working tree, sem commit) | **CURRENT_WORK** (L-016, L-017) · `CONTROL_PLANE_HEAD=NOT_YET_COMMITTED` |
| Commit candidato C1 → recert exata → atestação C2 | — | NOT_STARTED (aguarda o dono) |
| Early Access Fase 1 | `9f2ddcb` | **COMMITTED_FEATURE_CHECKPOINT** (o dono o designou "certified feature checkpoint" em L-009; termo reservado desde L-016) · **PHASE1_RECERT: BLOCKED** (L-013) · `CERTIFIED_FEATURE_SHA=NONE` |
| Early Access Fase 2 | — | **BLOCKED_NOT_STARTED** · `PHASE2_CODE_EXISTS=NO` · NEXT_PHASE (L-016) |
| Fundraising (`fundraising_*`) | — | NOT_STARTED (namespace reservado) |
| Deploy Vercel / produção | — | BLOCKED / DEFERRED (pagamento externo, dono) |
| Automação real (DCA/Pilot/Autopilot) | — | BLOCKED (NO-GO) |
| FINAL RELEASE CANDIDATE | — | NOT_STARTED · `RELEASE_CANDIDATE=NONE` |

---

## Entradas

### L-001 · 2026-09-15 · Produção histórica: auditoria externa de 30 achados

- **Estado:** DONE
- **SHA:** `25fc4b0fa55db72472c7ae00af42596209d7c362` · tree `176a4fdaa877082b6abd1925ae60bc4ae86af70e`
- **Evidência:** PRs #417–#446, todos MERGED e ANCESTRY (`gh pr view`, 01/10); CI run 34986267827 SUCCESS.
- **Testes:** 3.068 testes / 207 arquivos (mensagem do commit).
- **Findings:** A01–A30; A08/A09/A10/A17 UNKNOWN_REQUIRES_REVIEW; 5 OWNER_DECISION.
- **Produção:** é o código que roda em produção (`[VERCEL]`, deploy `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`, por `LEDGER-MESTRE` §0.1; não reverificado em 01/10).
- **Próxima dependência:** Round 1.

### L-002 · 2026-09-15 → 2026-09-19 · Rounds 1–8

- **Estado:** DONE
- **SHAs:** R1 `d7741bb1c10552a61810ed86f76d86715b087115` · R2 `6b081723689aad549c64aa6a6b8b31589fef2215` · R3 `1325bd3dcfd6bc2b9bdbcdb61b62b4de374c7d86` · R4 `1cb82ce9aa8bfe39884d1370baf3f8ed46266bb0` · R5 `bd30dea3cb71c2de0bdbfc3a906c32753a1696ee` · R6 `e536c409c8400a23ca28c4b0bc5689e8be48f5bc` · R7 `15b89c8809c6a475b2808b415f2e61ca09208938` · R8 `83c50fe3acb8f019cd56ed2018f712cd0f2acf49`
- **Evidência:** corpo dos commits; `LEDGER-MESTRE-RELEASE.md` §C–§J. Não há SPEC nem entrega versionados para R1–R7.
- **Testes:** R8 3586/3586 `[LOCAL]`. Retests independentes: HISTORICAL GAP.
- **Findings:** A80–A130-B. R8-CORRIDA segue OPEN_NONBLOCKING.
- **Migrations:** 0050–0063 criadas. 0050–0058 **aplicadas em produção** (15–16/09); 0059+ não.
- **Próxima dependência:** Round 9.

### L-003 · 2026-09-22 · Round 9

- **Estado:** CERTIFIED `[CP-10: HISTORICAL_CERTIFICATION_LEGACY — L-017]`
- **SHA:** `798fe2762370d3e2c7b57115c4caee350e82d104` · tree `087f82d035d4a06ed053864903bb0bcee1510eae` · `origin/round9-surgical` (congelada)
- **Evidência:** `docs/SPEC-round9.md`, `docs/entrega-round9.md`, `supabase/tests/01–10`. Retest I1–I12 `[DONO]`; reconfirmado `[RETEST]` em `3123fb4`.
- **Testes:** 3872/3872 (local); CI #968 FAIL **ambiental** (checkout raso), corrigido em `a5bdd61`.
- **Próxima dependência:** Platform Closure.

### L-004 · 2026-09-24 → 2026-09-26 · Platform Closure B1, B2, B3

- **Estado:** CERTIFIED (B1, B2) · DONE (B3) `[CP-10: B1/B2 = HISTORICAL_CERTIFICATION_LEGACY — L-017]`
- **SHAs:** B1 `a5bdd61d9915c84799d200b22645fe85de7ee4b5` · B2 `3123fb4972cd0ea46a152e00c0bd1c625efb12e5` · B3 `691bfdc6917de621b59d1092eec3ceeeea5d8c90` (tree `93a5a5386215b66efeb18ed09dedc02c4fe8e394`)
- **Evidência:** B1 CI 35985516785; B2 `docs/retest-independente-batch2-3123fb4.md` (PASS) + CI 36231021269; B3 `supabase/tests/14`, "PASS WITH DELTA 0059→0067" `[DONO]`.
- **Findings:** A51, A61, A62, PC-3, A58, A59, A86, A96, A97, DB-ACL-FIN.
- **Divergência:** `origin/platform-closure` (`4cf073a`) continuou com 10 commits **só de docs**. Não entraram na linha atual (DOC-PC-DIVERGE).
- **Staging hospedado** `nvbrzifyurslegudlhaz`: Release Phase 3 INCOMPLETE (falta prova de rollback/rebuild).
- **Próxima dependência:** preprod.

### L-005 · 2026-09-29 · Preprod blocker closure

- **Estado:** DONE
- **SHA:** `16e4000f969674aa704b6ea304587709b13de6c3` (pais `c230b92b4e6db80bc2f9483a2c8bc249dabe23ea`, `56b06bde053c50ca4ffb2f284b17c3213bc5203e`)
- **Evidência:** `reports/blocker-closure-20260929T111136Z/27-BLOCKER-CLOSURE-FINAL.md`.
- **Testes:** suíte 3961/3961 ×2; T13 estável 20/20; C1/C4 10/10.
- **Bloqueios na época:** supply chain (6 HIGH), storage, egress, secrets duráveis. Todos resolvidos em L-006/L-007.
- **Próxima dependência:** supply chain.

### L-006 · 2026-10-01 · Runtime certificado `0d21874`

- **Estado:** CERTIFIED (laboratório local) `[CP-10: CERTIFIED_EXACT_SHA — L-017]`
- **SHA:** `0d21874b4147bb8a0b232aa0abc2302471a720e5` · tree `62ad70e36a8bcc57331297d8ce929f232fadad2c`
- **Evidência:** `reports/recert-0d21874-20261001T010514Z/FINAL-RUNTIME-RECERTIFICATION.md` ("RUNTIME RECERTIFICATION: PASS"); evidência com 607 arquivos, manifest verificado; `docs/RELEASE-RUNBOOK.md`.
- **Testes:** npm ci, build, lint (0 erros / 145 avisos), type-check, suíte 264/3971 ×2, T13 estável, C1–C4, secret audit, demo, egress.
- **Supply chain:** 0 critical / 0 high (36 moderate, 1 low).
- **Próxima dependência:** commit de docs `43c484b` e PR #447.

### L-007 · 2026-10-01 · Docs baseline `43c484b` e PR #447

- **Estado:** CERTIFIED (o código é idêntico ao de `0d21874`; o delta é só `docs/`) · PR **DRAFT** `[CP-10: DOCS_BASELINE · CERTIFIED_RUNTIME_ANCESTOR=0d21874 · DELTA=DOCS_ONLY · CI=PASS · EXACT_SHA_RECERTIFIED=NO — L-017]`
- **SHA:** `43c484bd1fdc24cdbd8182914514d80d769deeb2` · tree `1c6505a6c6bd12ac06d2d3ef6eb9f9a0598814d7`
- **Evidência:** `gh pr view 447` em 01/10: OPEN, draft, não mergeado, MERGEABLE. CI runs 36838326106 e 36838252838 SUCCESS. Check Vercel FAILURE (diferido).
- **Próxima dependência:** Early Access Fase 1.

### L-008 · 2026-10-01 · Laboratório local (Acer): 4 stacks e resiliência de boot

- **Estado:** CERTIFIED (lab) `[CP-10: LAB_ENV_VERIFIED, ambiente, não SHA — L-017]`
- **Evidência:** `reports/fourstack-20261001T094248Z/`, `reports/postreboot-20261001T1225Z/`, `reports/wifi-recovery-20261001T1459Z/`, `reports/unattended-boot-20261001T1557Z/` e o check final `state/unattended-boot-20261001T1557Z/evidence/post-reboot-unattended-20261001T173957Z.txt` (boot 13:18:33, checado 14:39:57).
- **Resultado:** 4 stacks 25/25 PASS, egress BLOCKED, fingerprints inalterados. `WIFI_SELF_RECOVERY=PASS` (L3, 54 s), `REMOTE_SSH_BOOT=PASS`, `BOOT_RESILIENCE=PASS`, `AUTOLOGIN=PASS`, `UNATTENDED_BOOT=PASS`.
- **Findings aceitos:** HOST-CRED-001 e AUTOLOGIN (DEFERRED_ACCEPTED).
- **Próxima dependência:** nenhuma para a Fase 2.

### L-009 · 2026-10-01 · Early Access Fase 1 `9f2ddcb`

- **Estado:** CERTIFIED (feature checkpoint, por designação do dono) `[CP-03/CP-10: COMMITTED_FEATURE_CHECKPOINT, não certificado — L-016]`. **Ressalva:** falta o artefato de recert pós-hardening no SHA exato (EA-RECERT).
- **SHA:** `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · tree `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` · **só local** (sem push, sem CI)
- **Evidência:** `reports/early-access-phase1-adversarial-audit-20261001.txt` (antes do hardening: PASS WITH FINDINGS, 0C/0H/1M/9L/6I); `docs/PLANO-EARLY-ACCESS.md` §14–§15 (gates do implementador depois do hardening).
- **Testes (implementador):** tsc 0; lint 0 erros / 145 avisos; vitest 269 arquivos / 4073 testes; SQL `15` T15.1–T15.17.
- **Gate público:** CLOSED. A 0068 **não** foi aplicada em nenhum banco hospedado nem nas 4 stacks.
- **Findings:** F-01 OPEN_BLOCKER; F-02/03/04/06/07/08/10/12 FIXED_NOT_RECERTIFIED; os demais em `AUDIT-RECONCILIATION.md` §5.5.
- **Próxima dependência:** Fase 2 (F-01).

### L-010 · 2026-10-01 · Early Access Fase 2: email double opt-in

- **Estado:** CURRENT (plano) · NOT_STARTED (código)
- **Base:** `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · branch `early-access-phase2-email-double-optin-20261001` · worktree `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001`
- **Prova de "nenhum código ainda":** HEAD = `9f2ddcb`; `git status` limpo antes desta entrega de docs.
- **Escopo (de `PLANO-EARLY-ACCESS.md` §15):**
  - o provider de email;
  - o token de uso único, guardado como hash, com expiração;
  - a rota de verificação que grava `email_verified_at`;
  - o consentimento confirmado pelo titular;
  - a limpeza das inscrições não verificadas;
  - a correção dos dados pelo titular;
  - a anti-enumeração mantida;
  - F-11.
- **Dependências:** escolha do provider (OWNER_DECISION); EA-RECERT (recomendado antes).
- **Próxima dependência:** plano escrito → implementação → auditoria → recert → commit (`AI-OPERATING-RULES.md` §5).

### L-011 · 2026-10-01 · Control plane de documentação

- **Estado:** DONE (arquivos criados, **sem commit**: o commit é decisão do dono)
- **Base:** `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`
- **Arquivos:** `docs/START-HERE.md`, `docs/CURRENT-STATE.md`, `docs/LAUNCH-READINESS-LEDGER.md`, `docs/DOCUMENT-AUTHORITY.md`, `docs/GIT-AND-WORKTREE-MAP.md`, `docs/AUDIT-RECONCILIATION.md`, `docs/RELEASE-CHAIN.md`, `docs/AI-OPERATING-RULES.md`
- **Evidência:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/MASTER-RECONCILIATION-20261001.txt`
- **Resultado:** 0 correções de código ausentes; 4 findings UNKNOWN_REQUIRES_REVIEW (A08/A09/A10/A17); 1 feature remota SUPERSEDED (`pools-soon-tier`); lacuna documental `platform-closure`.
- **Próxima dependência:** o dono decide sobre o commit destes docs e sobre GOV-ENTRY e GOV-DEPLOY-RULE.

### L-012 · 2026-10-01 · Política de deploy formalizada (decisão do dono)

- **Estado:** DONE (decisão registrada)
- **Decisão:** a regra de 31/08 "tudo vai para produção sempre" fica **FORMALMENTE SUSPENSA** para a linha de fechamento/release. Nenhum commit, branch ou worktree vai para produção automaticamente. Deploy exige:
  1. SHA explícito;
  2. o SHA marcado `RELEASE_CANDIDATE` neste ledger e em `RELEASE-CHAIN.md`;
  3. certificação correspondente em PASS;
  4. autorização explícita do dono.
- **Até lá:** `PRODUCTION=UNTOUCHED` · `VERCEL=DEFERRED_EXTERNAL_PAYMENT` · `RELEASE_CANDIDATE=NONE`.
- **Registrada em:** `AI-OPERATING-RULES.md` §6.1, `START-HERE.md` §7, `CURRENT-STATE.md`, `RELEASE-CHAIN.md`, `DOCUMENT-AUTHORITY.md` §4, banner no topo de `ESTADO-ATUAL.md`, `CLAUDE.md`, `AGENTS.md`.
- **Substitui:** a linha GOV-DEPLOY-RULE (OWNER_DECISION) de L-011.

### L-013 · 2026-10-01 · Recertificação da Early Access Fase 1 no SHA commitado

- **Estado:** **BLOCKED**
- **SHA:** `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · tree `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b`
- **Evidência:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/EARLY-ACCESS-PHASE1-RECERT-9f2ddcb-20261001.txt`; campanha `evidence/recert-ea1-9f2ddcb-20261001T213835Z/` (MANIFEST.sha256).
- **Ambiente:** Node 24.21.0 / npm 11.19.0 (`node:24-bookworm-slim` `sha256:0e0ff40c…`, runner `sha256:7b90b568…`); `npm ci --offline` sem rede, com o cache verificado 1310/1310; lock byte-idêntico (`8e9b5227…d38a` = o de `0d21874`).
- **Gates:**
  - PASS: identidade; `npm ci` (1665 pacotes); type-check; lint 0 erros / 145 avisos (baseline), 0 nos arquivos EA; guardas 264/264.
  - **FAIL:** testes alvo EA 1/123.
  - NOT_RUN: build, suíte completa, SQL T15.
- **Causa:** `gate-hmac-referral.test.ts:121`. O controle negativo `randomBytes(48).toString("base64url")` vira base64 padrão canônico quando nenhum dos 64 caracteres é `-`/`_`, e o código aceita corretamente. Taxa de falha: 13,1% (teórica) / 12,97% (empírica, n=200 000). Defeito de teste: **EA-TEST-F10-FLAKY**.
- **Regra aplicada:** sem correção automática, sem retry, campanha parada.
- **Consequência:** `RECERTIFIED_AT_COMMITTED_SHA=NO`. O status de feature checkpoint fica como designação do dono, com recert BLOCKED.
- **Próxima dependência:** correção do teste autorizada pelo dono → SHA novo → recert completa (todos os gates).

### L-014 · 2026-10-01 · Segunda busca forense A08/A09/A10/A17

- **Estado:** DONE: **SOURCE_NOT_FOUND** para os quatro.
- **Escopo (somente leitura):**
  - `git log --all` (assuntos + corpos);
  - git notes (não existem);
  - conteúdo de todos os refs locais e `origin/*`;
  - `src/`, `supabase/`, `scripts/`, `.github`;
  - `reports/`, `evidence/`, `state/`;
  - `origin/claude/auditoria-*`;
  - GitHub (somente leitura): PRs #417–#446 (30 corpos, 31 comentários, 5 reviews, 4 comentários de review), issues (0 no repo), PRs #180/#297.
- **Achado-chave:**
  - Os PRs e o código citam A01–A30 **exceto exatamente** A08, A09, A10 e A17.
  - "A1–A8" em `PLANO-MELHORIAS-AUDITORIA.md` é outra auditoria (julho, outro espaço de IDs) e **não** conta.
  - O texto original da auditoria externa (14–15/09) não está em nenhuma fonte acessível.
- **Evidência:** `evidence/forensic-a08-a09-a10-a17-20261001/` (MANIFEST.sha256); adendo em `reports/MASTER-RECONCILIATION-20261001.txt`.
- **Status:** seguem UNKNOWN_REQUIRES_REVIEW. Fechar exige o documento original, fornecido pelo dono.

### L-015 · 2026-10-01 · Pontos de entrada automáticos e banners

- **Estado:** DONE (sem commit)
- **Arquivos:**
  - `CLAUDE.md`: bloco "Claude Code Entry Point" no topo; a "Retomada de sessão" agora aponta para START-HERE; o resto foi preservado.
  - `AGENTS.md`: novo, vendor-neutral.
  - `docs/README.md`: bloco START HERE com os 8 docs no topo; o índice antigo foi preservado.
  - Banners em `ESTADO-ATUAL.md`, `PLANO-EARLY-ACCESS.md` (+ status operacional: Fase 1 COMMITTED `9f2ddcb`, Fase 2 CURRENT sem código), `PLANO-DCA-AUTOMATICO.md` e `PLANO-MURAL-DE-AGENTES.md`.
- **Pacote para auditoria independente:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/control-plane-review-20261001.tar.gz` (sha256 em `.sha256` ao lado).
- **Próxima dependência:** auditoria independente do pacote → decisão do dono sobre o commit.

---

<!-- Novas entradas abaixo desta linha. Formato: ### L-NNN · AAAA-MM-DD · título -->

### L-016 · 2026-10-01 · Control plane: correções do review independente, round 1 (revisão 3)

- **Estado:** DONE no working tree (**sem commit**; o commit candidato é decisão do dono)
- **PRODUCT_BASE_SHA:** `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · tree `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` · `WORKTREE_HEAD_AT_LAST_MEASUREMENT` = o mesmo SHA
- **Review round 1:** pacote `reports/control-plane-review-20261001.tar.gz` auditado: MANIFEST=PASS, nenhum segredo. Findings CP-01…CP-08 (`AUDIT-RECONCILIATION.md` §5.6).
- **Correções:**
  - CP-01: ciclo de vida com **commit candidato → recert no SHA commitado**; recert que falha gera commit novo e recert do SHA novo inteiro (`AI-OPERATING-RULES.md` §5).
  - CP-02: identidade por `PRODUCT_BASE_SHA` + diff de produto com exclusão explícita de `docs/**`, `CLAUDE.md`, `AGENTS.md`; o HEAD virou snapshot informativo; a Fase 2 registra um `PHASE_BASE_SHA` antes de implementar.
  - CP-03: `9f2ddcb` = **COMMITTED_FEATURE_CHECKPOINT**; `PHASE1_RECERT=BLOCKED`; `CERTIFIED_FEATURE_SHA=NONE`; `LAST_CERTIFIED_RUNTIME=0d21874b4147bb8a0b232aa0abc2302471a720e5`. **Corrige a terminologia de L-009** (a designação do dono fica preservada lá).
  - CP-04: `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=4`. **Corrige a leitura de L-011** ("0 correções de código ausentes" vale só para correções conhecidas e identificáveis; A08/A09/A10/A17 permanecem sem fonte e não permitem conclusão).
  - CP-05: `CLAUDE.md` com Next.js 16.3.6 e a regra fail-closed precisa (conferida no código).
  - CP-06: `CURRENT_WORK=CONTROL_PLANE_REVIEW_AND_PHASE1_RECERT`; `NEXT_PHASE=EARLY_ACCESS_PHASE2_EMAIL_DOUBLE_OPT_IN`; `EARLY_ACCESS_PHASE2_STATUS=BLOCKED_NOT_STARTED`; `PHASE2_CODE_EXISTS=NO`. **Substitui o estado "CURRENT (plano)" de L-010.** Mural só com autorização do dono para o Supabase hospedado.
  - CP-07: `docs/README.md` com banner LEGACY antes do índice antigo.
  - CP-08: `EARLY_ACCESS_HMAC_SECRET=NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN`; `PRODUCTION_SECRET_STATE=NOT_VERIFIED`. O gate segue CLOSED.
- **Única alteração fora da documentação (autorizada):** `src/lib/early-access/gate-hmac-referral.test.ts` (EA-TEST-F10-FLAKY): controle negativo base64url determinístico. `hmac.ts`, `gate.ts`, rota e migrations **não** mudaram.
- **Validação pré-commit (não é certificação):** F10 ×100, testes alvo EA (7 arquivos), type-check, lint dos arquivos alterados, `git diff --check`. Resultados e evidência em `reports/control-plane-review-v2-20261001.tar.gz` (`F10-REPEAT-100.txt`, `PRECOMMIT-VALIDATION.txt`).
- **Não rodado (de propósito):** build, suíte completa, SQL. Rodam na recert do SHA do commit candidato.
- **Pacote para auditoria:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/control-plane-review-v2-20261001.tar.gz` (sha256 em `.sha256` ao lado).
- **Próxima dependência:** auditoria do pacote v2 → commit candidato autorizado → recert completa no SHA exato → nova entrada aqui.

### L-017 · 2026-10-01 · Control plane: review independente round 2 — CP-09 e CP-10 (revisão 4)

- **Estado:** DONE no working tree (**sem commit**)
- **Review round 2 (pacote v2):** CP-01…CP-08 PASS; correção F10 PASS; F10 ×100 = 100/100; alvo EA 123/123; type-check/lint/diff-check PASS; MANIFEST PASS. Restaram CP-09 e CP-10.
- **CP-09 — atestação pós-recert.** Registrar o resultado da recert gera um delta novo, que precisa de commit. Modelo formal (`AI-OPERATING-RULES.md` §5, §5.1, §5.2):
  - **C1 = `CANDIDATE_SHA`**: implementação, correções e docs autorizados; recebe a recert **completa** no SHA exato.
  - Se RECERT(C1)=PASS → **C2 = `CONTROL_PLANE_ATTESTATION_COMMIT`**: só `docs/**` (`CLAUDE.md`/`AGENTS.md` só se necessário); registra `CERTIFIED_FEATURE_SHA=<C1>`, `RECERT_RESULT=PASS` e a evidência; prova `git diff <C1>..<C2> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio. C2 **não** é CERTIFIED. Depois: `CONTROL_PLANE_HEAD=<C2>`, `CERTIFIED_FEATURE_SHA=<C1>`; a próxima fase parte de C2. Deploy de C2 proibido salvo recert própria + `RELEASE_CANDIDATE`.
  - Se RECERT(C1)=FAIL → sem atestação PASS; registrar o FAIL; corrigir; C1b; recert de C1b inteiro.
  - Ciclo: 1 branch/worktree · 2 base · 3 plano · 4 implementação · 5 auditoria · 6 correções · 7 pré-commit · 8 C1 · 9 recert exata de C1 · 10 atestação C2 · 11 próxima fase.
- **CP-10 — terminologia.** "Certified" sempre qualificado:
  - `CERTIFIED_EXACT_SHA`: só `0d21874b4147bb8a0b232aa0abc2302471a720e5` (`reports/recert-0d21874-20261001T010514Z/FINAL-RUNTIME-RECERTIFICATION.md`).
  - `43c484bd1fdc24cdbd8182914514d80d769deeb2`: `DOCS_BASELINE` · `CERTIFIED_RUNTIME_ANCESTOR=0d21874b4147bb8a0b232aa0abc2302471a720e5` · `DELTA=DOCS_ONLY` · `CI=PASS` · `EXACT_SHA_RECERTIFIED=NO`.
  - R9 `798fe27`, PC-B1 `a5bdd61`, PC-B2 `3123fb4`: `HISTORICAL_CERTIFICATION_LEGACY` (chamados "certified" antes da revisão 3; não há recert exata pelo critério atual, ainda que o PC-B2 tenha retest independente PASS). Código não reauditado; só a terminologia mudou, com base na evidência já reconciliada.
  - Laboratório/host: `LAB_ENV_VERIFIED` (ambiente, não SHA).
  - Entradas L-003, L-004, L-006, L-007, L-008 e L-009 receberam anotação `[CP-10: …]`; o texto original foi mantido.
- **Arquivos:** `START-HERE.md`, `AI-OPERATING-RULES.md`, `AGENTS.md`, `CLAUDE.md`, `CURRENT-STATE.md`, este ledger, `RELEASE-CHAIN.md`, `GIT-AND-WORKTREE-MAP.md`, `AUDIT-RECONCILIATION.md`.
- **Não mudou:** código, teste F10 (sha256 `93ad3c0dae32df242b7552d338b1d234420adb23bb77335deef2053b091ec587`, o mesmo da revisão 3), migrations.
- **Validação:** só `git diff --check` (por instrução).
- **Estado resultante:** `CERTIFIED_FEATURE_SHA=NONE` · `CONTROL_PLANE_HEAD=NOT_YET_COMMITTED` · `RELEASE_CANDIDATE=NONE`.
- **Próxima dependência:** autorização do dono para o commit candidato C1 → recert exata → atestação C2.
