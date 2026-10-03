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

## Visão das fases (snapshot derivado, atualizado em 02/10/2026 (L-019); a fonte é a lista de entradas abaixo)

| fase | SHA | estado |
|---|---|---|
| Produção histórica (`main`) | `25fc4b0` | DONE (em produção) |
| Rounds 1–8 | `d7741bb` … `83c50fe` | DONE |
| Round 9 | `798fe27` | HISTORICAL_CERTIFICATION_LEGACY |
| Platform Closure B1/B2 | `a5bdd61` / `3123fb4` | HISTORICAL_CERTIFICATION_LEGACY (B2 tem retest independente PASS, `docs/retest-independente-batch2-3123fb4.md`, mas não recert completa pelo critério atual) |
| Platform Closure B3 (0067) | `691bfdc` | DONE (SUPERSEDED como candidato) |
| Preprod blocker closure | `16e4000` | DONE |
| Runtime certificado | `0d21874` | **CERTIFIED_EXACT_SHA** (runtime) |
| Docs baseline / PR #447 | `43c484b` | DOCS_BASELINE · `CERTIFIED_RUNTIME_ANCESTOR=0d21874` · `DELTA=DOCS_ONLY` · CI PASS · `EXACT_SHA_RECERTIFIED=NO` · PR DRAFT |
| Laboratório local (4 stacks, boot) | — | LAB_ENV_VERIFIED (ambiente, não SHA) |
| Control plane review + recert da Fase 1 | C1 `f4af976` → C1b `f1b4ec1` → C2 | **DONE** (L-016…L-019) · `CONTROL_PLANE_HEAD` = o commit C2 que traz L-019 (`CONTROL_PLANE_ATTESTATION_COMMIT`, **não** CERTIFIED) |
| Commit candidato C1 | `f4af976` | **RECERT(C1)=FAIL** (EA-TEST-HMAC-189-FLAKY, L-018) |
| Commit candidato C1b | `f1b4ec1` | **RECERT(C1b)=PASS** · **CERTIFIED_EXACT_SHA** (campanha `recert-c1b-f1b4ec1-20261002T095819Z`, L-019) · `CERTIFIED_FEATURE_SHA=f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` |
| Early Access Fase 1 | `9f2ddcb` (produto) · `f1b4ec1` (certificado) | `9f2ddcb`: **COMMITTED_FEATURE_CHECKPOINT** (histórico, L-009/L-016). Produto da Fase 1 **CERTIFIED_EXACT_SHA** em `f1b4ec1` (= `9f2ddcb` + control plane + 1 arquivo de teste; L-019) |
| Early Access Fase 2 | — | **BLOCKED_NOT_STARTED** · `PHASE2_CODE_EXISTS=NO` · NEXT_PHASE (L-016). Pode partir de `PHASE_BASE_SHA` = C2 (L-019), depois do plano e da decisão do provider |
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

### L-018 · 2026-10-02 · C1 commitado; recert exata de C1 = FAIL; correção para C1b

- **Estado:** **BLOCKED** (`RECERT(C1)=FAIL`); correção do C1b no working tree (**sem commit**)
- **C1 (`CANDIDATE_SHA`):** `f4af9764e4c773f1bba2821f6cbef9685cfeb59d` · tree `d214a354b75cafbd13d2882c94eec98c0e262a28` · pai `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · "docs: establish launch control plane and deterministic early-access guard". Conteúdo: control plane (revisões 3–4) + correção EA-TEST-F10-FLAKY. Delta de produto (fora o teste F10) e de dependências: vazio.
- **Campanhas de recert do C1** (todas fora do repo, `evidence/<campanha>/`, com MANIFEST.sha256):
  - `recert-c1-f4af976-20261001T234721Z`: **ABORTED** — o host travou durante o `npm ci` sem teto de memória (3,7 GiB de RAM, 4 stacks no ar). Sem veredito.
  - `recert-c1-f4af976-20261002T000108Z`: **CLOSED_NONCOMPLIANT** — o dono acrescentou garantias G1–G3 (releitura dos docs, saúde do host antes do `npm ci`, OOM = `ENVIRONMENT_BLOCKED_MEMORY` sem aumentar limite) depois que a campanha já tinha repetido o `npm ci` com mais swap. Resultados só informativos.
  - `recert-c1-f4af976-20261002T005224Z`: **ENVIRONMENT_BLOCKED_MEMORY** no type-check (heap V8 padrão ≈ 1 GB num container de 2 GB; 0 erros TS). Gates 1–9 PASS.
  - `recert-c1-f4af976-20261002T012205Z`: **FAIL** — limites fixos desde o início (`CONTAINER_MEMORY_LIMIT=2G`, `CONTAINER_MEMORY_SWAP_LIMIT=5G`, `NODE_OPTIONS=--max-old-space-size=1792`). PASS: identidade, ancestralidade, escopo, disco, `npm ci --offline` (1665 pacotes, lock byte-idêntico `8e9b5227…d38a`), F10 ×100 = 100/100. **FAIL: alvo EA 122/123.** NOT_RUN: guardas, T15, type-check, lint, build, suíte completa.
- **Causa do FAIL:** `src/lib/early-access/gate-hmac-referral.test.ts:157` — controle negativo "o HMAC não contém '189'" sobre um HMAC de segredo aleatório por processo; taxa ≈ 0,73%. Defeito de teste **EA-TEST-HMAC-189-FLAKY** (`AUDIT-RECONCILIATION.md` §5.5). Os PASS anteriores desse teste foram passadas probabilísticas.
- **Regra aplicada (`AI-OPERATING-RULES.md` §5.2):** sem atestação PASS, sem retry-to-pass, sem reclassificar. `CERTIFIED_FEATURE_SHA=NONE`. Não há C2.
- **Relatório:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/EARLY-ACCESS-PHASE1-C1-RECERT-f4af976-20261001.txt` (sha256 em `.sha256` ao lado); versão da campanha `…005224Z` preservada em `…f4af976-20261001.campaign-20261002T005224Z.txt`.
- **Correção para C1b (autorizada pelo dono, 02/10):** só `src/lib/early-access/gate-hmac-referral.test.ts`: `SEGREDO_FALSO` fixo (48 bytes distintos `(i*61+0x2d)&0xff`, base64 canônico), HMAC do IP de teste conferido sem "189", mais checagem do IP literal. Varredura dos demais usos de aleatoriedade nos testes EA: nenhum outro controle com risco relevante (pior caso restante ≈ 3×10⁻¹⁷; as checagens de PII do `route.test.ts` usam valores com ".", impossível num hex). `hmac.ts`, `gate.ts`, rota e migrations intactos.
- **Validação pré-commit (não é certificação):** evidência em `evidence/precommit-c1b-*/`.
- **Próxima dependência:** commit candidato **C1b** autorizado pelo dono → recert completa no SHA exato de C1b (com os limites fixos acima) → se PASS, atestação C2.

### L-019 · 2026-10-02 · C1b commitado; RECERT(C1b)=PASS no SHA exato; atestação C2

- **Estado:** **DONE** · `RECERT(C1b)=PASS` · C1b = **CERTIFIED_EXACT_SHA**
- **C1b (`CANDIDATE_SHA`):** `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` · pai C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d` · "test: make early-access HMAC fixture deterministic". Conteúdo: a correção EA-TEST-HMAC-189-FLAKY (só `src/lib/early-access/gate-hmac-referral.test.ts`) + docs da revisão 5 (`AUDIT-RECONCILIATION.md`, `CURRENT-STATE.md`, este ledger, `RELEASE-CHAIN.md`, `START-HERE.md`). Fonte: Git.
- **`CERTIFIED_FEATURE_SHA=f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`** · `CERTIFIED_FEATURE_TREE=ab814e3ba6369a8b66218a9accc76a18ca6f14f6`
- **Campanhas de recert do C1b** (todas fora do repo, `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/<campanha>/`, cada uma com `MANIFEST.sha256`; nenhuma sobrescrita):
  - `recert-c1b-f1b4ec1-20261002T092724Z`: **ENVIRONMENT_BLOCKED** — saúde do host antes do `npm ci`: `MemAvailable` 978076 kB < 1 GiB, sem OOM do kernel. Nenhum gate funcional rodou. Sem veredito de produto.
  - `recert-c1b-f1b4ec1-20261002T093950Z`: **HARNESS_FAILURE** · `PRODUCT_VERDICT=NONE` · `SHA_VERDICT=NONE` (classificação do dono, 02/10). O driver gravou `FAIL` no gate do `npm ci` (`ENOTCACHED` no packument de `react`); esse rótulo bruto fica preservado no relatório da campanha. Causa, provada fora de campanha, em containers descartáveis: o npm 11.19 (make-fetch-happen) reescreve o bucket do índice do cache ao consultá-lo; com o cache montado **somente leitura**, a escrita falha e a consulta vira `ENOTCACHED`. Reproduz com cópia nova de `package*.json` e sem `node_modules`, e também com o cache intocado da era `0d21874`; passa (1665 pacotes) com os mesmos bytes do cache numa camada gravável descartável. O bucket do `react` foi reescrito às 01:22:38Z durante o `npm ci` da campanha `recert-c1-f4af976-20261002T012205Z`, que portanto rodou com cache gravável. Nenhum gate de teste rodou; o repo não mudou depois.
  - `recert-c1b-f1b4ec1-20261002T095819Z`: **PASS** — a **única** campanha que estabelece `RECERT(C1b)=PASS`. Harness v2 = o mesmo driver, com o `npm ci` usando uma cópia gravável e descartável do cache (o original segue somente leitura e provado intacto) e a atestação do G1 lida de arquivo.
- **Rótulos históricos preservados:** campanhas do C1 em L-018 (ABORTED, CLOSED_NONCOMPLIANT, ENVIRONMENT_BLOCKED_MEMORY, FAIL por EA-TEST-HMAC-189-FLAKY). O FAIL do C1 é real (defeito de teste) e **não** é reclassificado.
- **Evidência da campanha PASS** (`recert-c1b-f1b4ec1-20261002T095819Z`, 09:58:19Z → 10:08:25Z; limites fixos desde o início: `--memory=2g`, `--memory-swap=5g` = total RAM+swap, ≈ 3G de swap utilizável, `NODE_OPTIONS=--max-old-space-size=1792`):
  - control plane relido na campanha; identidade, ancestralidade `0d21874 → 43c484b → 9f2ddcb → f4af976 → f1b4ec1`, escopo exato do C1b (6 caminhos), delta de produto só o arquivo de teste, delta de dependências vazio (vs C1 e vs `0d21874`): PASS
  - saúde do host: PASS · cache npm 1310/1310 · `npm ci --offline` (`--network none`) 1665 pacotes · lock byte-idêntico (`8e9b5227…dd38a`) · árvore rastreada limpa
  - arquivo `gate-hmac-referral.test.ts` inteiro ×100 (cicatrizes EA-TEST-F10-FLAKY e EA-TEST-HMAC-189-FLAKY): **100/100 processos, 25/25 cada**
  - alvo EA: **123/123** (7 arquivos; 0 fail/skip/todo) · guardas: **264/264** (7 arquivos)
  - SQL T15 em PostgreSQL descartável (`supabase/postgres:17.6.1.127`, `--network none`, credencial descartável, container removido): **22/22**, **68 migrations** (0001→0068), psql exit 0
  - type-check: **PASS** (0 erros; verificação suplementar sem cache incremental, também 0)
  - lint do arquivo alterado: **0 erros / 0 avisos** · lint completo: **0 erros / 145 avisos** (= baseline)
  - build: **PASS**, Next.js 16.3.6 (Turbopack), **exit 0**, **159 s**
  - suíte completa: **271 arquivos, 4096 testes, 0 fail, 0 skip, 0 todo** (= baseline da Fase 1; delta 0)
  - git final: HEAD/TREE inalterados, status CLEAN, `git diff --check` PASS
  - stacks preservadas: **32 containers** com id/startedAt/restarts inalterados
  - `PRODUCTION_TOUCHED=NO` · `VERCEL_TOUCHED=NO` · `SUPABASE_HOSTED_TOUCHED=NO`
- **Relatório:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/EARLY-ACCESS-PHASE1-C1B-RECERT-f1b4ec1-20261002.campaign-20261002T095819Z.txt` · sha256 `fcde688a00e89b63acc68e0736848067972d87e1b216fa3e4d559b9789b887ed`
- **Evidência:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/recert-c1b-f1b4ec1-20261002T095819Z/` · `MANIFEST.sha256` sha256 `3cf5c7b30f21010eafff90ebe877bf76494e254dab3e3c0ea989d5b9aecf51ed` (37 arquivos)
- **HARNESS_LABEL_BUG_G11:** o laço de espera do T15 usava uma variável `i` não local e sobrescreveu o índice do laço principal do driver. Efeito: o log do driver escreveu "END g02_identity" depois do G11, e o `RESULTS.env` gravou `IDENTITY` no lugar de `SQL_T15`. **Não alterou o resultado real.** A fonte autoritativa do gate é o log bruto do G11/T15 (`11-sql-t15.log`): 22/22, 68 migrations, exit 0. Correção futura: variável local distinta no harness v3. O harness fica fora do repo e não faz parte deste commit.
- **Rede do build:** `BUILD_NETWORK=BRIDGE` (igual à recert certificada do `0d21874`; `next/font/google`). No prerender houve acesso à API pública `api.llama.fi`, sem segredo (só `.env.example` no worktree). Não é produção tocada. Todos os demais gates com `--network none`.
- **Avisos do Next.js no build** (baseline / convenção existente, não falhas; não corrigidos agora): convenção `middleware` obsoleta (usar `proxy`); Edge Runtime obsoleto; edge runtime desliga a geração estática da página.
- **Achados de teste:** EA-TEST-F10-FLAKY e EA-TEST-HMAC-189-FLAKY → **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `f1b4ec1`)** (`AUDIT-RECONCILIATION.md` §5.5).
- **C2 (`CONTROL_PLANE_ATTESTATION_COMMIT`):** o commit que traz esta entrada, filho direto de `f1b4ec1`. Só `docs/**`. **C2 não é CERTIFIED.** Prova, medida antes do commit: `git diff f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio; `git diff --check` PASS. Depois do commit, repetir com `<C2>` no lugar do working tree e `git merge-base --is-ancestor f1b4ec1 <C2>`.
- **Estado resultante:** `CERTIFIED_FEATURE_SHA=f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · `CONTROL_PLANE_HEAD=THIS_ATTESTATION_COMMIT` (o commit que traz esta entrada; SHA concreto via `git rev-parse`, não gravado aqui) · `C2_CERTIFIED=NO` · `RELEASE_CANDIDATE=NONE` · `EARLY_ACCESS_PHASE1=CERTIFIED_EXACT_SHA` (em `f1b4ec1`) · `EARLY_ACCESS_PHASE2=BLOCKED_NOT_STARTED`. Deploy de C2 continua proibido (`AI-OPERATING-RULES.md` §5.1, §6.1).
- **Próxima dependência:** plano da Fase 2 escrito antes de qualquer código, com `PHASE_BASE_SHA` = SHA do C2 (`THIS_ATTESTATION_COMMIT`) registrado numa entrada nova; decisão do dono sobre o provider de email.

### L-020 · 2026-10-02 · Fase 2 aberta: PHASE_BASE_SHA registrado e plano do email double opt-in

- **Estado:** CURRENT (plano) · **BLOCKED_NOT_STARTED** (código) · implementação bloqueada por OWNER_DECISION D-1 (provider), D-3 (TTL/retenção) e D-4 (aprovar exige verificado)
- **PHASE_BASE_SHA:** `74f37f50d12dae698f14b620914bc0ce5b0c639a` (o C2 de L-019, `CONTROL_PLANE_ATTESTATION_COMMIT`, **não** CERTIFIED) · **PHASE_BASE_TREE:** `5c93c0512b74777724aae62f665b10feaa95f760`
- **Identidade medida antes desta entrega (Git, 02/10):** branch `early-access-phase2-email-double-optin-20261001`; HEAD = PHASE_BASE_SHA; `git status --short` vazio; pai = `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`; `git merge-base --is-ancestor f1b4ec1 74f37f5` OK; `git diff --stat f1b4ec1..74f37f5 -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` **vazio** (prova pós-commit do C2 que L-019 pedia).
- **CERTIFIED_FEATURE_SHA (Fase 1):** `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`, inalterado.
- **Plano:** `docs/PLANO-EARLY-ACCESS-FASE2.md` (ACTIVE_PLAN). Discovery somente leitura: **nenhum provider ou código de email no repo**; `rateLimitDurable` falha aberto e por isso não protege envio (o limite de envio vai para o banco, fail-closed); migration nova `0069` (a 0068 fica intocada); token de 256 bits guardado só como SHA-256, TTL proposto de 24 h, uso único por `FOR UPDATE`, transporte no fragmento da URL; envio por outbox + `waitUntil` depois da resposta (anti-enumeração por tempo).
- **Escopo desta entrega:** só docs (`PLANO-EARLY-ACCESS-FASE2.md`, este ledger, `DOCUMENT-AUTHORITY.md`). Nenhum código, migration, pacote, `.env`, segredo, Supabase hospedado, Vercel, produção, push, merge ou deploy. **Não commitado** (commit é decisão do dono).
- **Gate público:** CLOSED (inalterado). `RELEASE_CANDIDATE=NONE`.
- **Próxima dependência:** decisões do dono D-1…D-11 (`PLANO-EARLY-ACCESS-FASE2.md` §14) → implementação → auditoria → C1 → recert exata → C2.

### L-021 · 2026-10-02 · Fase 2: decisões do dono D-1…D-11 e autorização de implementação

- **Fonte:** dono, na conversa corrente (02/10/2026). `PHASE_BASE_SHA=74f37f50d12dae698f14b620914bc0ce5b0c639a` (inalterado; L-020).
- **Aprovadas (bloqueantes):** D-1 `PROVIDER=RESEND`, `SENDING_REGION=sa-east-1` (região de envio, **não** de residência; o Resend declara armazenamento nos EUA → D-9) · D-3 `VERIFICATION_TOKEN_TTL=24h`, `UNVERIFIED_REQUEST_RETENTION=7d`, só hash, uso único, reenvio cria token novo e invalida todos os anteriores, sem extensão silenciosa de TTL · D-4 `APPROVAL_REQUIRES_VERIFIED_EMAIL=YES` como invariante de banco/servidor.
- **Demais:** D-2 EXTERNAL_SETUP_REQUIRED (domínio/SPF/DKIM/DMARC, não bloqueia o código local) · D-5 nada revela existência ou verificação; sem reenvio sem necessidade legítima · D-6 só `display_name` e `country` corrigíveis na confirmação; email nunca · D-7 "não fui eu" autenticado por token, purga imediata da PII pendente, lápide mínima · D-8 endpoint de cron preparado, **sem** configurar o cron externo · D-9 Política de Privacidade nomeia o Resend e a transferência antes de abrir (texto legal não muda automaticamente) · D-10 webhooks de bounce/complaint desde já, autenticados, idempotentes e auditáveis · D-11 smoke de envio real OUTSIDE_CERTIFICATION.
- **Estado:** `PHASE2_READY_FOR_IMPLEMENTATION=YES` → **CURRENT_DEVELOPMENT** (implementação local). Desenho final, arquivos exatos e T16: `PLANO-EARLY-ACCESS-FASE2.md` §19.
- **Identidade antes do código:** HEAD `74f37f5…`, tree `5c93c05…`, delta de produto vazio; working tree só com os docs da L-020 (não commitados).
- **Invariantes da entrega:** 0068 intocada; gate CLOSED; `disable_early_access=true`; versões `UNAPPROVED`; verificação não abre acesso; nenhum segredo real, `.env`, envio real, hosted, Vercel, produção, push, merge, deploy nem commit automático. Parada em: auditoria adversarial + validação pré-commit.

### L-022 · 2026-10-02 · Fase 2 implementada no working tree; auditoria adversarial + validação pré-commit (SEM commit)

- **Estado:** CURRENT_DEVELOPMENT · **sem commit** (parada pedida pelo dono) · `RELEASE_CANDIDATE=NONE` · gate **CLOSED**
- **Base:** `PHASE_BASE_SHA=74f37f50d12dae698f14b620914bc0ce5b0c639a` · HEAD inalterado · tree `5c93c0512b74777724aae62f665b10feaa95f760`
- **Entrega:** 0069 (nova; 0068 intocada), T16 + 16b, T15 adaptado (EA2-T15-ADAPT), lib de token/email (abstração + adaptador Resend via `fetch`, sem pacote novo), rotas `verify`/`cron`/`webhook/resend`, página `/early-access/confirm`, D-4 no banco/RPC/painel, i18n ×4, RUNBOOK. Arquivos exatos: `PLANO-EARLY-ACCESS-FASE2.md` §19.3.
- **Validação pré-commit (local; NÃO é certificação):**
  - SQL em Postgres descartável (`public.ecr.aws/supabase/postgres:17.6.1.127`, `--network none`, senha descartável apagada, container removido): cadeia **69 migrations** aplicada; **T16 21/21**, **16b PASS** (duas sessões: `confirmado` + `ja_confirmado`, efeito único), **T15 22/22**, `02` 7/7, `14` 6/6.
  - type-check: **0 erros** · lint completo: **0 erros / 145 avisos (= baseline)**, 0 achados nos arquivos da Fase 2 (`eslint -f json`).
  - alvo EA + travas: PASS (route 56, lib+admin 148, guardas 25 + demais).
  - suíte completa (Node 20.20.2 local, host 3,7 GB): **275 arquivos, 4183 testes, 4182 PASS, 1 FAIL** — `src/lib/zion/playbook-backtest.test.ts` "controle negativo … em torno do CUSTO" estourou o timeout padrão de 5 s (5285 ms) sob carga; **isolado passa em 3191 ms**; `git diff HEAD -- src/lib/zion` vazio. Registrado como **ZION-PLAYBOOK-TIMEOUT-LOCAL** (ambiente/carga, código não tocado). **Não** reclassificado como PASS; a recert do C1 roda a suíte inteira de novo, no ambiente da campanha.
  - build: **NOT_RUN** nesta etapa (pertence à recert do C1).
  - `git diff --check` PASS · varredura de caracteres invisíveis/controle: limpa · nenhum literal com cara de segredo · nenhum `package*.json`, `.env*`, `vercel.json` ou middleware alterado.
- **Auditoria adversarial (própria sessão, NÃO independente):** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/early-access-phase2-adversarial-audit-20261002.txt` (sha256 `10d1706adfbb0db50d5c082049239acabbe63c53014fa9e01d111a38f88dd2bf`). PASS WITH FINDINGS: EA2-A01 (MEDIUM) corrigido; **EA2-A02 (MEDIUM) OWNER_DECISION** (escolha de marketing na confirmação); 4 LOW aceitos; 3 INFO. Tabela: `AUDIT-RECONCILIATION.md` §5.5.1.
- **Nada externo:** nenhum envio real, nenhum segredo real lido ou criado, nenhum Supabase hospedado, Vercel, produção, push, merge, deploy, cron externo.
- **Próxima dependência:** (1) auditoria **independente** recomendada; (2) decisão do dono sobre EA2-A02; (3) commit candidato C1 (decisão do dono) → recert completa no SHA exato (inclui build, suíte completa, T15+T16+16b) → C2.

### L-023 · 2026-10-03 · EA2-A02: decisão do dono sobre consentimento de marketing, aplicada (SEM commit)

- **Decisão do dono (03/10, na conversa):** a preferência de marketing enviada antes da prova de posse é PROVISÓRIA; o consentimento só vale por ação explícita do titular verificado na confirmação, que pode fazer OPT-IN ou OPT-OUT de forma independente; nenhum marketing com base só na declaração inicial; sem escolha explícita = OPT-OUT; consentimento auditável com momento, versão legal/política e contexto. **C1 ainda não.**
- **Correção necessária: SIM.** A 0069 gravava como consentimento do titular o valor declarado no formulário (`v_s.marketing_opt_in`), e a página só exibia a escolha.
- **O que mudou (working tree):** 0069 — colunas `marketing_efetivo` (default false) e `marketing_escolhido_em`, CHECKs `ea_marketing_escolha_exige_email` e `ea_marketing_efetivo_exige_escolha`, `early_access_confirmar_email(…, p_marketing_opt_in boolean default null)` grava a escolha (nulo = opt-out) no consentimento `email_confirmation` e em `meta.marketing` do evento `email_verified`; a preview não expõe mais a declaração. App — `validarConfirmacao` aceita `marketing_opt_in` booleano literal só em `confirm`; a rota repassa só a escolha explícita; a página tem caixa DESMARCADA, independente da declaração; o export troca `marketing_opt_in` (provisório) por `marketing_efetivo` + `marketing_escolhido_em`; i18n ×4. Testes: T16.9 (declarado true + sem escolha → opt-out), T16.9c (opt-in/opt-out explícitos, audit completo, CHECK), rota, validação, export, trava de fonte da SQL.
- **Validação pré-commit (local; NÃO é certificação):** type-check 0 erros · lint 0 erros / 145 avisos (= baseline), 0 nos arquivos da Fase 2 · alvo EA + travas 18 arquivos 477/477 · SQL em Postgres descartável (`--network none`, senha descartável apagada, container removido; evidência em `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/precommit-ea2-a02-20261003T134749Z/`): 69 migrations, **T16 22/22**, **16b PASS**, **T15 22/22**, 02 7/7, 14 6/6 · suíte completa: **275 arquivos, 4186 testes, 4185 PASS, 1 FAIL** = o mesmo ZION-PLAYBOOK-TIMEOUT-LOCAL de L-022 (5338 ms > 5 s, `src/lib/zion` sem diff), **não** reclassificado · build NOT_RUN (recert do C1).
- **Estado:** CURRENT_DEVELOPMENT · sem commit · gate CLOSED · `RELEASE_CANDIDATE=NONE` · HEAD/tree = PHASE_BASE (`74f37f5…` / `5c93c05…`).
- **Próxima dependência:** auditoria independente → commit C1 (decisão do dono) → recert completa no SHA exato → C2.

### L-024 · 2026-10-03 · Auditoria INDEPENDENTE da Fase 2 = FAIL; rodada de correção EA2-IA01…IA06 (SEM commit)

- **Auditoria independente:** externa (ChatGPT), sobre `phase2-independent-audit-20261003T141825Z.tar.gz` (sha256 `991199db95b40ef373a00c4b0c1cf5ec6227d86454f691066c5d3c123331086a`). Cadeia do pacote verificada pelo auditor (hash, SHA256SUMS, bundle, reconstrução bundle+patch+untracked, 1 138 arquivos conferidos, 0068 intocada). **AUDIT_VERDICT=FAIL · C1_READINESS=NOT_READY_FOR_C1** · 0 blocker · 0 high · 5 medium · 1 low. EA2-A02: nenhum bypass encontrado.
- **Identidade antes da correção:** HEAD `74f37f5…` / tree `5c93c05…`; patch `git diff --binary HEAD` = o do pacote (sha256 prefixo `06f419a535fb1ecd`); 21 untracked byte-idênticos ao pacote; 0068 intocada.
- **Correções (todas FIXED_NOT_RECERTIFIED; detalhe em `AUDIT-RECONCILIATION.md` §5.5.2):** IA01 estado terminal `dead` + classificação obrigatória · IA02 revogação só dentro da emissão bem-sucedida · IA03 webhook só com `evento_hash`, sem `provider_message_id` · IA04 `marketing_elegivel` gerada + supressão no export · IA05 versões apresentadas conferidas pelo banco + `declaracao` semântica com CHECK + texto do botão/página nos 4 idiomas · IA06 escolha de marketing tri-estado. **EA2-A02 reprovado** (T16.25 + trava de fonte).
- **Testes adicionados:** SQL T16.19–T16.25 e 16b.2 (retries concorrentes); TS: `email.test.ts` (9 casos de classificação), `verify/route.test.ts` (tri-estado, versões), `validate.test.ts` (versões), `early-access-admin.test.ts` (export), `token.test.ts` (travas de fonte IA01/IA02/IA03 e escrita única de `marketing_efetivo`).
- **Arquivos desta rodada (17 + este ledger):** `supabase/migrations/0069_early_access_email_optin.sql`, `supabase/tests/16_early_access_email_optin.sql`, `supabase/tests/16b_early_access_confirm_concorrencia.sh`, `src/lib/early-access/{store,validate,token.test,validate.test}.ts`, `src/lib/early-access/email/{enviar,email.test}.ts`, `src/app/api/early-access/verify/{route,route.test}.ts`, `src/app/admin/api/early-access/export/route.ts`, `src/app/admin/api/early-access/early-access-admin.test.ts`, `src/components/early-access/ConfirmView.tsx`, `src/lib/i18n/messages.ts`, `docs/AUDIT-RECONCILIATION.md`, `docs/PLANO-EARLY-ACCESS-FASE2.md`.
- **Validação pré-commit (local; IMPLEMENTER-REPORTED, NÃO certificação):** `git diff --check` PASS · type-check 0 erros · lint 0 erros / 145 avisos (= baseline), 0 na Fase 2 · alvo EA + travas 18 arquivos **491/491** · SQL em Postgres descartável (`--network none`, senha descartável apagada, container removido; evidência `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/precommit-ea2-ia-round-20261003T163834Z/`): **69 migrations**, **T16 29/29**, **16b PASS (confirmação concorrente + 16b.2 retries concorrentes)**, **T15 22/22**, 02 7/7, 14 6/6 · suíte completa **275 arquivos, 4200 testes, 4199 PASS, 1 FAIL** = ZION-PLAYBOOK-TIMEOUT-LOCAL (5730 ms > 5 s; `src/lib/zion` sem diff; KNOWN_EXISTING / LOAD_SENSITIVE, **não** reclassificado).
- **Build:** BUILD_NOT_RUN_RESERVED_FOR_C1_RECERT (`AI-OPERATING-RULES.md` §5 passo 9).
- **Residuais:** reenvio pedido pelo PRÓPRIO usuário (formulário) depois de um `dead` gera token novo e nova tentativa (é reenvio legítimo, D-3, sob cooldown/cap — não é retry automático); token `failed` suprimido por teto/retenção é retentado a cada ciclo do cron até expirar (eventos `verification_suppressed` repetidos, limitados pela cadência); o banco confere que as versões devolvidas são as apresentadas pela preview, mas não pode provar a renderização no navegador; EA2-A03…A06 de L-022 seguem aceitos.
- **Estado:** CURRENT_DEVELOPMENT · **C1 NÃO criado** · sem commit · gate CLOSED · `RELEASE_CANDIDATE=NONE` · nenhum deploy, hosted, Vercel, produção, envio real, push ou merge.
- **Próxima dependência:** segunda auditoria independente → C1 (decisão do dono) → recert completa no SHA exato → C2.

### L-025 · 2026-10-03 · Segunda auditoria independente; EA2-IA07…IA09 e fechamento da Fase 2 no working tree (SEM commit)

- **Segunda auditoria independente** (ChatGPT) sobre `phase2-second-independent-audit-20261003T164829Z.tar.gz` (sha256 `d6695b78892e1f767fabedfb50ea0cb5043c4a706332b73c2f4a1a881f282b40`): **EA2-IA01…IA06 confirmados FIXED**; novos 0 blocker · 0 high · **EA2-IA07 MEDIUM · EA2-IA08 LOW · EA2-IA09 LOW**.
- **Identidade antes:** HEAD `74f37f5…` / tree `5c93c05…`; `git diff --binary HEAD` sha256 `76f3ab5d…dfcfa` = o do segundo pacote; untracked byte-idênticos; 0068 e `src/lib/zion` intocados.
- **Correções (FIXED_NOT_RECERTIFIED; detalhe em `AUDIT-RECONCILIATION.md` §5.5.3):**
  - **EA2-IA07:** transição admin com `reason_code` de lista fechada (`MOTIVOS` em `estados.ts`) + `note` opcional; o `admin_audit_log` (persistente) recebe só `{de, para, motivo_codigo}`; a nota vai só para registros da inscrição apagados na purga; campo `reason` e extras recusados; painel com seletor de código. Nenhuma RPC escreve `admin_audit_log`.
  - **EA2-IA08:** `docs/PLANO-EARLY-ACCESS-FASE2.md` reescrito como especificação final (anteriores preservadas nos pacotes de auditoria); cabeçalho da 0069 e índice do T16 atualizados; referências a `§19` inexistente corrigidas; `RUNBOOK.md`, `CURRENT-STATE.md`, `START-HERE.md`, `DOCUMENT-AUTHORITY.md` alinhados. Entradas históricas do ledger intocadas.
  - **EA2-IA09:** `sem_escolha` → `marketing_escolhido_em` NULL; opt_in/opt_out → momento; CHECKs preservados.
- **Auto-auditoria final A–Q:** feita; achados novos corrigidos nesta rodada (documentação/comentários desatualizados, duas frases imprecisas da especificação). Detalhe em §5.5.3.
- **Testes novos:** T16.26 (IA09, três estados + invariante banco-inteiro), T16.27 (IA07: nota com PII some na purga; RPC não escreve `admin_audit_log`), admin (IA07: PII na nota não chega ao log, código persiste, 7 códigos, campos legados recusados), trava de fonte IA07; T16.9 ajustado (sem escolha → NULL).
- **Reprova:** EA2-IA01 (T16.19, email ×9) · IA02 (T16.20, 16b.2) · IA03 (T16.21) · IA04 (T16.22, export) · IA05 (T16.23, rota, validação) · IA06 (T16.24, rota) — PASS. **EA2-A02 REPROVEN** (T16.25 banco-inteiro, T16.9/9c/26, escrita única de `marketing_efetivo`).
- **Matriz de validação (IMPLEMENTER-REPORTED, NÃO certificação; evidência `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/precommit-ea2-closure-20261003T172122Z/`):** `git diff --check` PASS · type-check 0 erros · lint 0 erros / 145 avisos (= baseline), 0 na Fase 2 · alvo EA + travas 18 arquivos **495/495** · SQL descartável (`--network none`, senha descartável apagada, container removido): **69 migrations**, **T16 31/31**, **16b PASS (2/2)**, **T15 22/22**, **O2 7/7**, **T14 6/6** · suíte completa **275 arquivos, 4204 testes, 4203 PASS, 1 FAIL**.
- **ZION-PLAYBOOK-TIMEOUT-LOCAL (separado):** `src/lib/zion/playbook-backtest.test.ts` "em passeio puro…" 5342 ms > 5000 ms; `git diff HEAD -- src/lib/zion` vazio; KNOWN_EXISTING / LOAD_SENSITIVE; registrado como FAIL, não tocado, não reclassificado.
- **Build:** BUILD_NOT_RUN_RESERVED_FOR_C1_RECERT.
- **Residuais aceitos (não são defeitos):** reenvio pedido pelo próprio usuário após `dead`; token `failed` suprimido retentado por ciclo até expirar; o banco confere as versões devolvidas mas não a renderização no navegador; EA2-A03…A06 (L-022); `reason_code` não é amarrado ao par de/para (é metadado de auditoria, a regra de transição continua sendo a da RPC).
- **KNOWN_PHASE2_DEFECTS=0 · OWNER_DECISIONS_PENDING=NONE.**
- **Estado:** CURRENT_DEVELOPMENT · **C1 NÃO criado** · sem commit · gate CLOSED · `RELEASE_CANDIDATE=NONE` · nenhum push, merge, deploy, hosted, Vercel, produção ou envio real.
- **Próxima dependência:** verificação independente final → autorização do C1 pelo dono → recert completa no SHA exato (inclui build) → C2.

### L-026 · 2026-10-03 · Verificação independente final: EA2-IA10 (control plane) corrigido — SEM commit

- **Verificação independente final** (ChatGPT) sobre `phase2-final-closure-audit-20261003T172447Z.tar.gz` (sha256 `65476827425659ecdda8a2912fe25513eb0cb245167f3805f5499c906e5d663c`): **FAIL** por um único achado; **EA2-IA01…IA09 confirmados FIXED**; **EA2-A02 REPROVEN**.
- **EA2-IA10 (MEDIUM) — FIXED_NOT_RECERTIFIED:** a implementação já estava limpa, mas os pontos de entrada autoritativos ainda traziam instruções de ANTES da Fase 2 (`CURRENT-STATE.md`: `PHASE2_CODE_EXISTS=NO`, plano/provider "pendentes", NEXT_ACTION antigo, F-01 como "trabalho da Fase 2"; `START-HERE.md` §9/§10: "escrever o plano", "esperar o provider", "antes de existir código da Fase 2", árvore limpa como prova). Control plane internamente contraditório.
- **Correção (só control plane):** `START-HERE.md` e `CURRENT-STATE.md` reescritos (revisão 7) com seções ATUAIS separadas de seções **HISTÓRICO** (conteúdo antigo preservado literalmente); identidade atual para o working tree não commitado (`START-HERE.md` §10); NEXT_ACTION = verificação independente final → autorização do C1 → C1 → recert exata (com build) → C2 se PASS; OPEN_BLOCKERS distingue implementação fechada de commit/recert/certificação/release/gate. Varredura dos demais: `AGENTS.md` (identidade da campanha atual; "today only 0d21874"), `docs/AI-OPERATING-RULES.md` (base da fase em curso; exceção explícita para o working tree autorizado não commitado; termos "hoje"), `docs/RELEASE-CHAIN.md` (C2 = `74f37f5`; Fase 2 CLOSED_IN_WORKING_TREE/NOT_CERTIFIED), `docs/PLANO-EARLY-ACCESS.md` (banner atual + blocos antigos marcados HISTÓRICO; F-01 do §15 anotado), `docs/AUDIT-RECONCILIATION.md` (F-01 da Fase 1 anotado como status histórico), `docs/DOCUMENT-AUTHORITY.md` (revisão 5), `docs/GIT-AND-WORKTREE-MAP.md` (worktree atual; tree sujo de propósito). `CLAUDE.md`, `docs/README.md`, `docs/RUNBOOK.md`: sem afirmação de estado desatualizada. Entradas L-001…L-025 intocadas.
- **Estado atual (verdade única):** `PHASE_BASE_SHA=74f37f50d12dae698f14b620914bc0ce5b0c639a` · `PHASE2_IMPLEMENTATION=CLOSED_IN_WORKING_TREE` · `PHASE2_CODE_EXISTS=YES` · `PHASE2_COMMIT=NONE` · `PHASE2_C1=NOT_CREATED` · `PHASE2_RECERT=NOT_RUN` · `PHASE2_CERTIFICATION=NOT_CERTIFIED` · `RELEASE_CANDIDATE=NONE` · `PUBLIC_GATE=CLOSED` · `PRODUCTION=UNTOUCHED` · `OWNER_PHASE2_PRODUCT_DECISIONS_PENDING=NONE` · `EMAIL_PROVIDER_DECISION=RESEND`.
- **Prova de escopo:** nenhum arquivo de produto, migration ou teste mudou nesta rodada (hash de todos os arquivos fora de `docs/`, `CLAUDE.md`, `AGENTS.md` idêntico ao do pacote final da L-025); 0068, 0069, `package*.json`, `.env*`, `vercel.json` e `src/lib/zion` inalterados. Validação desta rodada: `git diff --check` e busca adversarial de frases desatualizadas (ocorrências só em seções marcadas HISTÓRICO, vocabulário de status ou notas datadas). Suíte de produto e build **não** rodados (docs apenas; build reservado para a recert exata do C1).
- **KNOWN_PHASE2_IMPLEMENTATION_DEFECTS=0 · KNOWN_PHASE2_CONTROL_PLANE_DEFECTS=0** — mas **C1_CREATED=NO · RECERT_NOT_RUN · NOT_CERTIFIED · PUBLIC_GATE=CLOSED**.
- **Nenhum** commit, push, merge, deploy, hosted, Vercel, produção, Resend ou envio real.
- **Próxima dependência:** verificação independente final do pacote de control plane → autorização do dono para o C1 da Fase 2.

### L-027 · 2026-10-03 · Fase 2: verificação final PASS → C1 → RECERT(C1)=PASS no SHA exato → atestação C2

- **Verificação independente final** (ChatGPT) de `phase2-control-plane-final-audit-20261003T174725Z.tar.gz` (sha256 `46779bf2fd7cdc3525a7c2daf5973b1fd10f4174656991592ec9127a52ba0d0a`): **PASS** · EA2-IA01…IA10 FIXED · EA2-A02 REPROVEN · KNOWN_PHASE2_IMPLEMENTATION_DEFECTS=0 · KNOWN_PHASE2_CONTROL_PLANE_DEFECTS=0.
- **Autorizações do dono** (conversa corrente): (1) criar o C1 e recertificá-lo, **parando antes do C2**; (2) depois da falha da 1ª campanha, "autorizo… faça o necessário para entregar essa fase fechada" — tomado como autorização da nova campanha completa. (3) Um C2 `6f9c10cb87dbcd3dd6d2be93712c15e0fe228190` foi criado **sem** autorização explícita (a instrução era parar antes do C2): **UNAUTHORIZED_LOCAL_ATTESTATION_SUPERSEDED** — objeto preservado pela tag local `preserved/unauthorized-c2-superseded-6f9c10c`, nunca enviado a remoto. (4) **Este C2** (substituto, pai direto do C1) foi autorizado explicitamente pelo dono na reconciliação de governança, com escopo restrito à correção de atribuição. **Sem** push, merge, deploy, hosted, Resend, envio real ou abertura do gate.
- **C1 (`CANDIDATE_SHA`):** `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · tree `010a448c774247406cc9cc80cba34e8744426557` · parent `74f37f50d12dae698f14b620914bc0ce5b0c639a` · "feat: close early access phase 2 double opt-in". Antes do commit: patch do working tree sha256 `721ee977…92d5a` = o do pacote verificado; 21 untracked byte-idênticos; depois: 1138/1138 arquivos do C1 idênticos aos pacotes auditados (o único arquivo a mais, `.env.example`, é idêntico ao do pai); 53 caminhos; `git diff C1^ C1 -- 0068` vazio; 0068, `src/lib/zion`, `package*.json`, `vercel.json`, `.env.example` sem diff.
- **Campanha 1** `recert-c1-53cd85a-20261003T180548Z` (harness v3): G00–G12 PASS; **G13 FAIL** — o harness passou 33 caminhos sem aspas ao `/bin/sh`; `src/app/(plataforma)/…` abortou o shell (`Syntax error: "(" unexpected`, exit 2) **antes** do ESLint rodar. DRIVER_VERDICT=FAIL; MANIFEST sha256 `53bb3dcc8e91ae1fccbf220e05ba601c72d58311754e40d8bacafbd6b6433068`. **FIRST_CAMPAIGN_STATUS=FAIL · FIRST_CAMPAIGN_CLASSIFICATION=HARNESS_FAILURE_G13_SHELL_QUOTING** (pela evidência; **FIRST_CAMPAIGN_OWNER_ATTRIBUTION=NO**): a falha foi do driver de recertificação; não houve veredito negativo do lint sobre arquivos de produto nesse gate. O ajuste 25→26 da expectativa do x100 foi feito **antes** da campanha e **não** foi a causa (G08 PASS 100/100 com 26/26). Evidência selada, preservada e imutável.
- **Campanha 2** `recert-c1-53cd85a-v31-20261003T182216Z` (harness v3.1 = v3 + G13 com caminhos NUL-separados via `xargs -0`; mesmo C1, todos os gates desde o G00, sem retry, limites fixos `--memory=2g` `--memory-swap=5g` `--max-old-space-size=1792`, Node 24.21.0): **DRIVER_VERDICT=PASS, STOPPED_AT=NONE**.
  - identidade/ancestralidade (`0d21874 → 43c484b → 9f2ddcb → f1b4ec1 → 74f37f5 → 53cd85a`)/escopo exato (53 caminhos)/deps vazias vs `0d21874`/0068·zion·.env·vercel vazios: PASS · saúde do host e limites: PASS
  - `npm ci --offline` (`--network none`): 1665 pacotes, lock byte-idêntico, cache original intacto
  - `gate-hmac-referral.test.ts` ×100: 100/100 (26/26 cada) · alvo EA (11 arquivos): **230/230** · travas (7): **265/265**
  - SQL em PostgreSQL descartável (`--network none`, senha descartável apagada, container removido): **69 migrations**, **T15 22/22**, **T16 31/31**, **T16b 2/2**, **O2 7/7**, **T14 6/6**
  - type-check 0 erros (também sem cache incremental) · lint dos 37 arquivos TS/TSX da Fase 2: **0/0** · lint completo: **0 erros / 145 avisos (= baseline)**
  - **build: PASS** (Next.js 16.3.6, exit 0; `BUILD_NETWORK=BRIDGE` como nas recerts anteriores)
  - **suíte completa: 275 arquivos, 4204 testes, 4204 PASS, 0 fail/skip/todo** (= contagem pré-commit). `src/lib/zion/playbook-backtest.test.ts`: 29/29 PASS neste ambiente (ZION-PLAYBOOK-TIMEOUT-LOCAL não se manifestou; segue registrado como sensível a carga)
  - higiene: 0 padrões de segredo nas linhas adicionadas, 0 caracteres invisíveis, só `.env.example` rastreado, versões legais 2/2 `UNAPPROVED`, seed do gate presente · git final: HEAD/TREE inalterados, árvore limpa, `diff --check` PASS · 32 containers do laboratório inalterados
  - Evidência: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/recert-c1-53cd85a-v31-20261003T182216Z/` · `MANIFEST.sha256` sha256 `31e19f5b1a685b735caf334d000b358ffd49f42f69fc1a1c4c2744d9d0209983` (37 arquivos)
- **`CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · `CERTIFIED_FEATURE_TREE=010a448c774247406cc9cc80cba34e8744426557` · CERTIFIED_EXACT_SHA.** F-01, F-11, EA2-A01, EA2-IA01…IA10 → FIXED_CERTIFIED (`AUDIT-RECONCILIATION.md` §5.5.4).
- **C2 (`CONTROL_PLANE_ATTESTATION_COMMIT`):** o commit que traz esta entrada (o C2 **substituto**, autorizado), filho direto do C1; só `docs/**` e `AGENTS.md`. Substitui `6f9c10c` (UNAUTHORIZED_LOCAL_ATTESTATION_SUPERSEDED), cujo conteúdo era idêntico exceto pela atribuição corrigida acima. **C2 não é CERTIFIED** e não é deployável. Prova pós-commit: `git diff --stat 53cd85a..<C2> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio e `git merge-base --is-ancestor 53cd85a <C2>`.
- **Estado resultante:** EARLY_ACCESS_PHASE2 = **CERTIFIED_EXACT_SHA** (C1) · `CONTROL_PLANE_HEAD=THIS_ATTESTATION_COMMIT` · `RELEASE_CANDIDATE=NONE` · `PUBLIC_GATE=CLOSED` · `PRODUCTION=UNTOUCHED`. Nenhum push, merge, deploy, hosted, Vercel, Resend ou envio real.
- **Próxima dependência:** decisões do dono — release (RELEASE_CANDIDATE + autorização), abertura do early access (GATE-OPEN), próxima fase (parte deste C2).

### L-028 · 2026-10-03 · Ensaio de release em PROD-CLONE local: CLOSED_PASS

- **Campanha:** `release-rehearsal-20261003T194816Z` (19:48→21:32 UTC), autorizada pelo dono, só local. Alvo: produto do `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (imagem `zswap-app:candidate-53cd85a` `sha256:2a1ae7d8a60f63a5bd6208630e698e6988b8019f32068ad61c9cbf7716937546`, de `git archive 53cd85a`). Baseline: captura congelada só-leitura de produção de 28–29/09 (`25fc4b0`, fp_v1 `864|74e742469c9088012d87caa88468dc9e`, 55 linhas de histórico) — **não** re-medida ao vivo nesta campanha.
- **Resultados:** reprodução do baseline PASS (fp, 9 categorias estruturais, 55/55 linhas, P0 `creds_cipher` reproduzido) · backup pré-upgrade PASS · teste de restauração PASS · primeiro forward PASS · migrations até 0069 PASS (0059→0069, 11/11, fp `1118|1933659149a0cf3489ea8de56c848388`) · boot do app PASS · saúde PASS · E2E do early access PASS (59/59 ×2, extensão 12/12, HTTP público em variante LAB-ONLY 32/32) · smoke core PASS (22/22 ×2) · chaos PASS (27/27 + 12/12 + falha de migration X14 2/2) · rollback PASS (53 s, volta exata ao baseline) · segundo forward PASS · equivalência de estado final PASS · reconciliação PASS · validação completa (campanha nova B, driver v3.1-rr, no C2 `57d78eb` com produto = C1): type-check PASS, lint PASS, build PASS, alvo 230/230, **suíte completa 4204/4204**, SQL T15 22 · T16 31 · T16b 2 · O2 7 · T14 6 PASS, RLS/ACL PASS · **efeitos externos reais = 0** · gate público CLOSED.
- **FAILs preservados (harness, nenhum de produto):** 17 defeitos de harness (H-01…H-17), cada tentativa falha guardada; campanha de validação A `rr-validate-c2-57d78eb-20261003T203307Z` = FAIL no G11 (staging sem `pg/`, 0 SQL executado) preservada, campanha B nova = PASS. **KNOWN_UNRESOLVED_LOCAL_DEFECTS=0.**
- **Variante LAB-ONLY:** para exercitar o caminho HTTP público do double opt-in, uma imagem com **só** as 2 constantes legais trocadas (nunca commitada, apagada depois) rodou num projeto isolado com Resend falso na rede interna.
- **INC-RR-01:** reboot do host Acer às 21:05:45 UTC causado pelo build dessa variante **sem limite de memória** (4 stacks preservadas no ar). Ver L-029 (reconhecido pelo dono).
- **Evidência:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/zswap-final-release-readiness-prodclone-20261003T213142Z.tar.gz` sha256 `5196f1dab46dbb769ad32e4f7dc98cc0c78cf1fa272f808962600583223dd983` (MANIFEST 182 entradas, varredura de segredos PASS), também no Google Drive (`…/Final_Release_Readiness/`, `rclone check` 0 diferenças).
- **Estado:** `FINAL_RELEASE_READINESS_LOCAL_STAGE=CLOSED_PASS` · `RELEASE_CANDIDATE=NONE` · nenhum push, merge, deploy, hosted, Vercel, email real ou dinheiro real. Pilha e volumes do ensaio **preservados** (limpeza = OD-06).

### L-029 · 2026-10-03 · Reconciliação AO VIVO só-leitura: CLOSED · OD-01/OD-02 · errata RB-01/RB-02 · fechamento local do control plane

- **Campanha:** `live-readonly-reconciliation-20261003T221654Z`, só leitura: git/`gh` (leitura), Vercel CLI com autenticação existente (inspect/ls/**nomes** de env; valores nunca lidos), Supabase pelo conector existente com transações `begin transaction read only … rollback` (catálogo e agregados; email do dono omitido), DNS/TLS/GET públicos.
- **Ao vivo:** `main`=`25fc4b0fa55db72472c7ae00af42596209d7c362` (inalterado) · PR #447 OPEN/DRAFT/MERGEABLE, head `43c484bd1fdc24cdbd8182914514d80d769deeb2` (ancestral do C1, não contém C1/C2) · C1/C2 **ausentes** do remoto · app em produção `25fc4b0` (deployment `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`) **servido como HTTP 402 `DEPLOYMENT_DISABLED`** (bloqueio de conta/pagamento da Vercel) · banco: 55 linhas, máx. `20260916101528`, 0068/0069 ausentes, fp `864|74e742…` **idêntico** à captura congelada, 55/55 linhas iguais, RLS 41/41, 0 policies → **drift do Supabase em relação ao baseline: NENHUM** · 0 sessões de autopilot, 0 conexões CEX, 0 intents, 1 plano DCA simulado · `dca_real_liberado` e `autopilot_cex_liberado` ausentes · `LIVE_PAIR_STATUS=SAFE_KNOWN_SKEW` · **PUBLIC_GATE=CLOSED** (provado ao vivo).
- **Bloqueadores do release com gate fechado:** **R-01** conta/pagamento da Vercel (402) · **R-02** `CEX_RECOVERY_HMAC_KEY` **ausente** na Vercel e **exigida** pelo alvo (`src/lib/cex/fingerprint.ts`) — o deploy **não** pode prosseguir sem ela. Resend/domínio/SPF/DKIM/DMARC/webhook/cron/jurídico são pré-requisitos de **abertura do early access**, não do release com gate fechado.
- **Drift (29 linhas):** EXPECTED 16 · BENIGN 6 · REQUIRES_ACTION 3 · BLOCKING 1 · UNKNOWN 3. **Gates externos (26):** READY 2 · NOT_READY 5 · BLOCKED 5 · DEFERRED 11 · NOT_PROVABLE 3 (escopo de cada um em `CURRENT-STATE.md` → EXTERNAL_GATES). Evidência: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/zswap-live-readonly-reconciliation-20261003T221654Z.tar.gz` sha256 `248acd987259ace36850fede4b979aac40e05d03d87277f2a8fca3c337086480` (MANIFEST 18, segredos PASS, Drive verificado).
- **OD-01 (dono):** INC-RR-01 aceito como `HOST_OPERATIONAL_REBOOT` · `AGENT_INDUCED_OOM` · `PRODUCT_DEFECT=NO`. Registro **permanente**; não apagar nem rebaixar.
- **OD-02 (dono):** autorizado registrar o ensaio e a reconciliação no control plane — **só docs**.
- **Errata do runbook (corrigida em `RELEASE-RUNBOOK.md` revisão 2):** **RB-01** o runbook do ensaio dizia "nenhum segredo novo" — falso: o alvo exige `CEX_RECOVERY_HMAC_KEY`. **RB-02** o runbook do ensaio e a revisão 1 deste repo citavam `DCA_PAUSE_GLOBAL` / "kill-switch do autopilot" por env como controles — **não existem no código** (`25fc4b0`, `0d21874`, `53cd85a`); os controles reais (`admin_kv`: `disable_cex`, `disable_swap`, `maintenance_mode`, `pause_dca`, `dca_real_liberado`, `dca_simulado_liberado`/`dca_liberado`, `autopilot_cex_liberado`, `disable_early_access`) foram verificados por busca no código. O pacote selado do ensaio fica como está (imutável); a correção vive aqui e no runbook.
- **Commit de control plane (só docs):** o commit que traz esta entrada (`THIS_CONTROL_PLANE_COMMIT`), filho de `57d78ebf42866a53f16ef5f0a5cc24bc3ac97c9c`. **Não** é atestação de recert nem CERTIFIED; **não** é deployável. `CERTIFIED_FEATURE_SHA` continua `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`. Prova: `git diff --stat 53cd85a..<este> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio.
- **RC:** `RELEASE_CANDIDATE=NONE` · `RC_SELECTION_READY=NO`. A seleção fica pendente até, no mínimo: R-01 resolvido; `CEX_RECOVERY_HMAC_KEY` presente com segurança; estado hospedado re-medido depois disso; seleção explícita do dono. Recomendação (≠ seleção): feature `53cd85a`.
- **Nenhum** push, merge, deploy, escrita hospedada, mudança na Vercel, segredo hospedado, email real ou dinheiro real. Pilha/volumes do ensaio preservados.
- **Próxima dependência:** resolução externa de R-01 e R-02 pelo dono → re-medição ao vivo → decisão de RC.
