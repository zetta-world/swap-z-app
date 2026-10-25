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

### L-030 · 2026-10-03 · Trilha STRATEGY INTELLIGENCE & FORENSIC LEARNING documentada (só docs)

- **Origem:** auditoria forense **só-leitura** sobre os dados do Supabase de produção, trazida pelo dono no programa PRE-VERCEL ACCELERATION (fonte dos números: **dono**; não re-medidos pelo agente que escreveu o documento). Nenhuma estratégia, genoma, parâmetro, linha de banco ou estado de produção foi modificado.
- **Documento:** `docs/PLANO-STRATEGY-INTELLIGENCE-FORENSIC-LEARNING.md` (`ACTIVE_PLAN`, status `DOCUMENTED · NOT_YET_EXECUTING_STRATEGY_CHANGES`): snapshot do dataset (`paper_positions` 3497 · `celeiro_posicoes` 318 · `celeiro_fluxos` 2290 · `celeiro_mutacoes` 9 · `lab_runs` 100 · `lab_results` 100 · `bancada_operacao` 47 · `mercado_vela` 11651 · `lab_strategies` 29 — retrato da data, não totais imutáveis; nomes de tabela conferidos nas migrations), achados **FSL-01…FSL-10**, hipóteses **pré-registradas H1–H6** (não são regras), plano futuro **A–G** (não iniciado), padrão de sucesso (pré-registro → fora da amostra → custos → benchmark → amostra → repetibilidade → só então certificar).
- **Ligações:** `DOCUMENT-AUTHORITY.md` (revisão 8, nova linha), `docs/README.md` (bloco de entrada), `CURRENT-STATE.md` (`STRATEGY_INTELLIGENCE_WORKSTREAM`). `PLANO-MESTRE.md` é SUPERSEDED e não foi editado.
- **Invariantes:** `REAL_MONEY_AUTONOMY=NO` · `STRATEGY_CERTIFICATE=NO` · `PILOT_PERMISSION=NO`.
- **Commit de control plane (só docs):** o commit que traz esta entrada (`THIS_CONTROL_PLANE_COMMIT`), filho de `762224843fa8d7e340416d05ac2a99488945d541`. **Não** CERTIFIED, **não** deployável. `CERTIFIED_FEATURE_SHA` segue `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`. Prova: diff de produto `53cd85a..`este vazio.
- **Estado inalterado:** `RELEASE_CANDIDATE=NONE` · `RC_SELECTION_READY=NO` · `PUBLIC_GATE=CLOSED` · bloqueadores R-01/R-02 abertos. Nenhum push, merge, deploy, escrita hospedada, email ou dinheiro real.
- **Próximo (programa PRE-VERCEL):** lane B de desenvolvimento local numa worktree/branch nova a partir deste commit; a lane de release (este branch) não recebe bytes de produto.

### L-031 · 2026-10-03 · LANE B aberta: `pre-vercel-forward-20261003T234200Z` (desenvolvimento local, NÃO release)

- **Base registrada antes de qualquer código:** `PHASE_BASE_SHA=d896ce29c68b5c298d8146b72f06722d0e9d7db1` · tree `aa5fdecdec20da1a67a7dd1ba01d286ab2365cc9` (commit da L-030, lane A).
- **Worktree/branch:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/pre-vercel-forward-20261003T234200Z` · `pre-vercel-forward-20261003T234200Z` (só local, sem upstream).
- **Lane A intocada:** `early-access-phase2-email-double-optin-20261001` segue em `d896ce2`; `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`; `RELEASE_CANDIDATE=NONE`.
- **Plano:** `docs/PLANO-PRE-VERCEL-FORWARD.md` (inventário mestre A–F + itens desta rodada). Commits deste branch = `COMMITTED_FEATURE_CHECKPOINT`, não CERTIFIED, não deployáveis.
- Proibido nesta lane: push, merge, deploy, escrita hospedada, Vercel, email real, transação on-chain, dinheiro real.

### L-032 · 2026-10-04 · Lane B: itens A desta rodada concluídos (checkpoint local, NÃO release)

- **Feito:** PV-A01 (catálogo de env exigida + check admin `required_server_env` + `scripts/release/check-env-names.mjs`: contra os nomes vivos da Vercel, só `CEX_RECOVERY_HMAC_KEY` ausente) · PV-A02 (trava de controles do runbook; mutação provou que pega RB-02) · PV-A03 (`scripts/release/*`: fp, estrutura, histórico, forward com pulo, verificação de estado — provado em PG descartável a partir do B0: baseline CONFERE, 55/55 linhas = captura congelada, 11/11 PASS, alvo `1118|1933…` CONFERE, reexecução só SKIP) · PV-A04 (T16.17h por delta: 31/31 em banco vazio e povoado; bytes do C1 falham no povoado; aviso de modo commit no teste 02) · PV-A05 (HARNESS-001) · PV-A06 (`scripts/preprod/capped-build.sh`, INC-RR-01) · PV-A07 (`docs/EXTERNAL-GATES-PREP.md`; `CEX_RECOVERY_HMAC_KEY` no `docs/RUNBOOK.md`) · PV-A08 (fundações Founders NFT independentes de decisão, `src/lib/founders-sale/*`, `docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md`; `NFT_REAL_SALE=OFF`, `MAINNET_MINT=OFF`, `PUBLIC_SALE=OFF` travados por teste) · PV-A10 (banner de status atual na discovery).
- **Validação (IMPLEMENTER-REPORTED, NÃO certificação; container `--memory=2g --memory-swap=5g`, heap 1792 MB):** type-check 0 erros · lint 0 erros / 145 avisos (= baseline) · **suíte completa 280 arquivos / 4254 testes, 0 falhas** (+5 arquivos / +50 testes sobre 4204) · build PASS via `capped-build.sh`. Evidência: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/pre-vercel-forward-20261003T234200Z/`.
- **Estado:** `COMMITTED_FEATURE_CHECKPOINT` neste branch · não CERTIFIED · não RC · lane A intocada (`d896ce2`) · `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · nenhum push, merge, deploy, escrita hospedada, email, transação on-chain ou dinheiro real.
- **Pendente nesta lane (A, próximas rodadas):** PV-A09, PV-A11…A16; UI/telemetria/persistência da venda (sem decisão); para levar algo desta lane ao release: decisão do dono + novo C1 + recert no SHA exato.

### L-033 · 2026-10-04 · Lane B, 2ª parte: PV-A09/A11/A14/A15/A16 feitos · A12/A13 → B · achado novo R-03 (SUPPLY-BRACES)

- **Feito:** PV-A09 (F-09: `portao.test.ts` exige chamada real de `requireAdmin(`; nenhuma superfície `/admin` descoberta) · PV-A11 (F-14: migration **0070** `revoke` de PUBLIC/anon/authenticated em `admin_kv`, `rate_limits`, `admin_audit_log` + teste SQL 17; na linhagem de produção (B0 + 0059…0069) `anon`/`authenticated` tinham TRUNCATE nas três → T17 0/6 antes, **6/6 depois**; service_role lê/escreve; T14 6 · T15 22 · T16 31 · T16b 2/2 · O2 7/7; reexecutável; fp com 0070 `1118|5346e57d025843ac805382a6975ad983`, **só lane B**) · PV-A14 (RR-O-04: leitura da chave do gate com orçamento de 3 s; banco pendurado → FECHADO em < 1 s) · PV-A15 (timeouts explícitos nos testes pesados de `playbook-backtest`, asserções inalteradas) · PV-A16 (HARNESS-002 diagnosticado com exit 4). Guarda `conexoes-0063.test.ts` atualizada conscientemente para a 0070 ("sétima vez").
- **Reclassificados para B:** PV-A12 (`middleware`→`proxy` move o portão do admin do runtime Edge para Node — decisão de topologia de produção) · PV-A13 (correções restantes só MAJOR ou inexistentes).
- **ACHADO NOVO R-03 — SUPPLY-BRACES (relevante para o release):** `npm audit` hoje = 25 high / 34 moderate / 1 low (deps de produção: 20 high), todos os high de um único advisory novo, `braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm), via `tailwindcss@3.4.19` → `chokidar`/`micromatch`. **Não existe versão corrigida** (3.0.3 é a última). O lockfile é o mesmo certificado desde `0d21874` (sha `8e9b5227…`; em 01/10: 0 high), e o passo `npm audit --audit-level=high` do `ci.yml` **sai 1** → o CI do GitHub do C1/C2 falharia hoje (afeta EG-18). Decisão do dono: Tailwind v4 (MAJOR, novo C1 + recert) **ou** exceção documentada no CI para este advisory. Evidência `08-supply-braces-ci-audit.txt`.
- **Validação (IMPLEMENTER-REPORTED, container capado):** execução 4 — type-check 0 · lint 0 erros / 145 avisos (= baseline) · **suíte 280 arquivos / 4257 testes, 0 falhas** · build PASS via `capped-build.sh`. A execução 2 teve 1 FAIL determinístico (guarda de inventário de migrations sem a 0070), corrigido; registrada. A execução 1 (L-032) teve o arquivo de evidência sobrescrito por defeito do harness (mesmo caminho); os números dela estão na L-032.
- **Correção de registro:** no checkpoint `f0f461cf…` o plano tinha a linha PV-A10 do inventário trocada pela de status (erro de substituição); corrigido neste commit.
- **Estado:** `COMMITTED_FEATURE_CHECKPOINT` · não CERTIFIED · não RC · lane A intocada (`d896ce2`) · nenhum push, merge, deploy, escrita hospedada, email, transação on-chain ou dinheiro real. Todas as linhas A do inventário desta lane foram feitas ou reclassificadas com motivo.

### L-034 · 2026-10-04 · Lane B, 3ª parte: Founders UI local (WS1) · ferramenta da Fase A (WS3) · spike Tailwind v4 / R-03 (WS2)

- **WS1 — Founders (sem rota, sem decisão do dono):** 14 estados de UI (nenhum sucesso falso: `confirmada` sem id de transação continua PENDING), relógio autoritativo do servidor + contagem (janela início/fim futura), progresso mintado/reservado/disponível sem percentual inventado, alocação abstrata, segurança do admin **local** (pedido → confirmação com frase, validade, segundo operador, snapshot congelado, auditoria), evidência imutável encadeada (7 tipos), esquema fechado de 11 eventos de telemetria sem PII, painel `src/components/founders/FoundersSalePanel.tsx` nas 4 línguas. Testes determinísticos sem rede (founders 3 arquivos + painel 6 testes × 14 estados × 4 línguas). Checagem em Chrome (file://, rede bloqueada): 375/768/1280 px, teclado, árvore de acessibilidade, reduced motion — **41 PASS / 0 FAIL**. Trava: nenhum arquivo de `src/app` importa founders. `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF`. Checkpoint `5e0e632`.
- **WS3 — Strategy Intelligence Fase A (só leitura):** `src/lib/strategy-truth/reconciliacao.ts` (motor puro, relatório canônico, classificação EXPLAINED/VERSIONED_SEMANTICS/ARCHIVAL_EFFECT/RESET_EFFECT/DATA_GAP/UNKNOWN), `atribuicao.ts` (esquema de atribuição de perda, destino só `local_somente`), `scripts/strategy/{exportar,relatorio,somente-leitura}.mjs` + SQL. 19 testes. Prova viva no banco **descartável** com linhas **sintéticas** (o B0 não tem linhas de estratégia): fingerprint e `pg_stat_user_tables` idênticos antes/depois, escrita no embrulho = `25006`, SQL de escrita recusado (exit 65), hospedado sem `--dono-autorizou` recusado (exit 77); sintéticos removidos, stack só parado (volumes preservados). **Nenhuma** estratégia, genoma, parâmetro, agente ou dado de produção tocado. Checkpoint `bfef705`.
- **WS2 — spike Tailwind v4 (branch `spike-tailwind-v4-20261004T113734Z`, HEAD `7776436`, NÃO mesclar):** `R03_REMEDIATION=PARTIAL` · `MIGRATION_RISK=MEDIUM` · `RECOMMENDED_ACTION=TEMPORARY_CI_EXCEPTION`. O v4 remove só o caminho `tailwindcss`; `braces` continua via `@solana/wallet-adapter-react` (**produção**, 24 caminhos) e `eslint-config-next`; `npm audit --audit-level=high` continua exit 1 (25→23 high). type-check/lint/build PASS, 4330 testes depois de adaptar a trava de tokens ao `@theme`. CSS principal +51% (gzip total +16%). Mudança visual real (precedência `leading-*`×`text-*`, `space-y-*`), 21/30 capturas diferentes, controle v3×v3 ≈ 0%. **⚠️ Achado:** a ferramenta oficial de upgrade reescreveu o modo do guarda de transação Solana `"shadow"`→`"shadow-sm"` em `solana-guard.ts`/`audit.ts`/rotas `swap-guard` — revertido no spike; qualquer migração real precisa limitar a ferramenta a componentes/CSS. Relatório `docs/R03-TAILWIND-V4-SPIKE.md` (no branch do spike) e evidência `zswap-local/evidence/spike-tailwind-v4-20261004T113734Z/`.
- **Validação da lane B (execução 5, IMPLEMENTER-REPORTED, container capado):** HEAD `bfef705`, árvore limpa · type-check 0 · lint 0 erros / 145 avisos (= baseline) · **suíte 283 arquivos / 4330 testes, 0 falhas** · guardas (subconjunto explícito) 11 arquivos / 141 testes · build PASS (`capped-build.sh`) · `git diff --check` limpo. Evidência `06e-lane-b-full-validation-run5.txt`.
- **Itens de lane B e um futuro candidato (o dono decide):** migration **0070** (revoke de anon/authenticated/PUBLIC em `admin_kv`/`rate_limits`/`admin_audit_log`) · orçamento de 3 s da leitura do gate (`GATE_KV_TIMEOUT_MS`) · travas F-09 / runbook-controls / catálogo de env. Avaliação: **adequados para um futuro RC** — pequenos, fecham risco, falham fechado, provados na linhagem de produção (0070: T17 0/6→6/6) e com a suíte inteira verde; exigem novo C1 + recert completa no SHA exato. Nada movido para a lane de release.
- **Estado:** `COMMITTED_FEATURE_CHECKPOINT` · não CERTIFIED · `CURRENT_RELEASE_CANDIDATE=NONE` · lane A intocada (`d896ce2`, limpa) · `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · nenhum push, merge, deploy, escrita hospedada, email real, transação on-chain ou dinheiro real.

### L-035 · 2026-10-04 · Decisões do dono: R-03 = exceção estreita · Fase A executada (só leitura, hospedado) · decisões Founders

- **OD R-03 (dono):** `R03_DECISION=TEMPORARY_NARROW_CI_EXCEPTION`; Tailwind v4 **não** adotado (spike preservado:
  branch `spike-tailwind-v4-20261004T113734Z` `7776436` + evidência). Implementado só na lane B:
  `scripts/release/audit-gate.mjs` + `lib/audit-gate.mjs` + `audit-exceptions.json` (advisory `braces` 1240992 /
  GHSA-vfj7-8cjw-p6xm `<=3.0.3`, cadeia de 25 pacotes registrada item a item, `status: TEMPORARIA`,
  `revisar_antes_do_rc: true`, `corrigido: false`); passo do `ci.yml` agora **bloqueante**: reprova CRITICAL, HIGH
  novo, advisory alterado, deriva da cadeia e relatório ilegível. Provas: audit real da lane B → passa; audit real do
  spike v4 → `DERIVA_CADEIA` (exit 1); offline → falha fechada; 9 testes (`src/lib/release/audit-gate.test.ts`).
  Revisão obrigatória antes da seleção de RC registrada em `docs/RELEASE-CHAIN.md`. Doc `docs/R03-AUDIT-EXCEPTION.md`.
- **Correção de registro (L-033):** o passo antigo tinha `continue-on-error: true` — R-03 deixava o **passo** vermelho,
  não reprovava o **job**. "O CI do C1/C2 falharia hoje" estava impreciso. O portão novo é mais estrito que o antigo.
- **OD Fase A (dono): leitura só-leitura do Supabase hospedado autorizada.** Executada pelo conector Supabase
  (projeto `z-swap`), toda consulta em `begin transaction read only … rollback`; `pg_stat_user_tables` idêntico
  antes/depois → **0 escritas**; sem PII (dono da bancada reduzido a hash dentro da consulta). Resultado:
  `PLANO-STRATEGY-INTELLIGENCE-FORENSIC-LEARNING.md` §8; evidência selada
  `zswap-local/evidence/strategy-intelligence-phase-a-20261004T125509Z/` (MANIFEST `5d5e9436…`, 19 arquivos,
  segredos/PII PASS; **não** enviada a lugar nenhum).
- **Founders:** `docs/FOUNDERS-NFT-OWNER-DECISIONS.md` — 14 decisões realmente em aberto (3 com padrão seguro).
- **0070 / timeout do gate / travas:** continuam **LANE_B_ONLY**; nenhuma evidência nova muda a avaliação (L-034).
- **Estado:** `COMMITTED_FEATURE_CHECKPOINT` · não CERTIFIED · `CURRENT_RELEASE_CANDIDATE=NONE` · lane A intocada
  (`d896ce2`) · nenhum push, merge, deploy, escrita hospedada, email real, transação on-chain ou dinheiro real ·
  nenhuma estratégia/genoma/parâmetro/mesa alterado.
- **Adendo L-035 — arquivamento da evidência da lane B (04/10/2026): `PRE_VERCEL_LANE_B_EVIDENCE_ARCHIVED=PASS`.**
  Destino `gdrive:01_ZETTA_WORLD/01_Z-SWAP/Auditorias_e_Rounds/Pre_Vercel_Forward/`. Diretório local
  `pre-vercel-forward-20261003T234200Z/` com **43** arquivos; **41** enviados; os **2** com linhas sintéticas de banco
  (`strategy-phase-a/seed-sintetico-descartavel.sql`, `strategy-phase-a/exportacao.json`) omitidos de propósito,
  documentados com sha256 em `pre-vercel-forward-20261003T234200Z.UPLOAD-EXCLUSIONS.txt` (nome real do arquivo no Drive)
  e preservados localmente sem alteração. Arquivo `pre-vercel-forward-20261003T234200Z.tar.gz` (3.432.880 B, 41
  arquivos) sha256 `bd4f96e699af7a8ff88260bc70fac233a4da8bd333cd91b445c2055bf8cd0806`. `MANIFEST_STATUS=PASS` (local
  43/43; cópia no Drive 41/41 — as 2 exclusões aparecem como ausentes por desenho) · `SECRET_SCAN_STATUS=PASS`
  (varredura nova antes do envio; `pre-vercel-forward-20261003T234200Z.PRE-UPLOAD-SCAN.txt`) ·
  `DIRECTORY_REMOTE_CHECK=PASS` (rclone check 0 diferenças / 41) · `ARCHIVE_REMOTE_CHECK=PASS` (rclone check 0
  diferenças; sha256 do arquivo baixado de volta = local). **Não** enviados: dump bruto do banco hospedado, segredos,
  PII, node_modules, cache Docker, linhas sintéticas.
  Spike Tailwind v4 arquivado à parte e verificado no mesmo destino: `spike-tailwind-v4-20261004T113734Z/` (202
  arquivos, rclone check 0 diferenças / 202) e `spike-tailwind-v4-20261004T113734Z.tar.gz` (23.433.787 B) sha256
  `27fb19a21c43cd1b562bb14251e60602ba1b82b91839c919fa882820a593162c` (conferido por download). Sem volume de
  node_modules nem cache. Commit só de docs; nenhum push, merge, deploy ou escrita hospedada.

### L-036 · 2026-10-04 · P0 = captação: estágio de decisões do dono da venda Founders (só docs)

- **Direção do dono:** P0 passa a ser geração de capital via venda Founders NFT. Este estágio **não** implementa: fecha
  decisões. Strategy Intelligence não é o P0.
- **Recuperado do repositório** (com fonte por item): propósito, 2 camadas, supply 1.500/500/50, tiers e benefícios,
  escada de taxa (implementada), leitura do passe via Helius (implementada), regra de framing, narrativa, planos
  normais +30%, fundações locais da venda (lane B). **Conflitos registrados** (não resolvidos em silêncio): preço
  (`plans.ts` USD-pegged × briefing SOL), royalty (copy "5% … distributed to holders" × briefing aberto + revisão
  jurídica), allowlist ("first-come" × nada autoritativo), data vencida ("July 2026"), "treasury governance", chain
  (código Solana × briefing "confirmada?"). Moldura: venda de **produto**, não captação de investimento (discovery §0 G,
  briefing §4).
- **Docs:** `FOUNDERS-NFT-OWNER-DECISIONS.md` revisão 2 (19 cartões + formulário) · novos `FOUNDERS-NFT-SALE-DESIGN.md`,
  `FOUNDERS-NFT-CAPITAL-MODEL.md` (cenários A/B/C, sem valor aprovado), `FOUNDERS-NFT-LAUNCH-FUNNEL.md` (funil, métricas,
  14 itens construíveis antes da Vercel).
- **Estado:** aguardando o formulário do dono; nenhuma implementação. Diff de produto vazio. `CURRENT_RELEASE_CANDIDATE=NONE`
  · lane A intocada · nenhum push, merge, deploy, escrita hospedada, email real, transação on-chain ou dinheiro real.

### L-037 · 2026-10-04 · Founders NFT: decisões do dono aplicadas — 36 meses, supply 2.850, preços provisórios (só docs)

- **OD-NFT-14 = APPROVED:** `PREMIUM_TERM_MONTHS=36` do encerramento oficial da venda; `VERSION_BASED_EXPIRY=REMOVED`
  (nenhuma versão/"v3"/renome encurta o prazo). Texto "3 anos OU v3" neutralizado em `NFT-BRIEFING.md`,
  `PLANO-FOUNDERS-NFT-SALE-READINESS.md`, `POLISH-PLAN.md`, `IDEIAS-ESTACIONADAS.md`, `PLANO-MESTRE.md`,
  `CONTEXTO-ZETTAWORD.md` e nos docs FOUNDERS-NFT-*.
- **OD-NFT-02 = PARTIALLY_APPROVED:** Pro $149 · Trader $399 · Pilot $1.990, `PRICE_STATUS=PROVISIONAL_FOR_DEMAND_VALIDATION`,
  âncora USD, pagamento SOL, `SNAPSHOT_AND_FREEZE` por fase (fonte da referência não decidida). Gate de validação de
  demanda em `FOUNDERS-NFT-LAUNCH-FUNNEL.md` §D.
- **Supply pago:** 2.000 / 750 / 100 = **2.850** (antes 1.500/500/50); reserva (OD-NFT-04) fora.
- **Capital (cenário, não previsão):** máximo **796.250 USD** (298.000 + 299.250 + 199.000); 25% 198.863 · 50% 398.125 ·
  75% 596.988 (unidades inteiras); antigo 834.500 → **−38.250 (−4,58%)**. Líquido não estimado (custos não documentados).
- **Status:** APPROVED 13 (01, 03, 05, 07, 08, 09, 10, 12, 13, 14, 15, 18, 19) · PARTIALLY_APPROVED 4 (02, 04, 06, 11) ·
  DEFERRED 2 (16, 17 — jurídico) · UNRESOLVED 3 novos (20 regra "+30%" dos planos mensais deixou de fechar com os preços
  novos; 21 critérios da validação de demanda; 22 signatários/política da tesouraria). Formulário reduzido a 6 entradas.
- **Conflito de instrução registrado:** a correção de copy (OD-NFT-19, aprovada) vive em `src/lib/i18n/messages.ts`
  (código de produto); esta rodada exige diff de produto vazio → texto novo nas 4 línguas pronto em
  `FOUNDERS-NFT-COPY-CORRECTION.md`, **aplicação pendente** de uma rodada de produto autorizada. O código ainda carrega
  supply/preços antigos (`plans.ts`).
- **Estado:** só docs; nenhuma implementação; `CURRENT_RELEASE_CANDIDATE=NONE`; lane A intocada; nenhum push, merge,
  deploy, escrita hospedada, email real, mainnet ou dinheiro real.

### L-038 · 2026-10-04 · Founders NFT: prontidão LOCAL da venda fechada (lane B, NÃO release)

- **Implementado e testado (lane B, commits locais, sem push):** `a8378d9` copy corrigida (OD-NFT-19) + preço público
  "Pricing being finalized" + guardas · `7921f8a` domínio `src/lib/founders-sale/` (config aprovada como dado e
  pendências como estado, máquina de estados autoritativa, preço USD→SOL com congelamento por fase, estoque/reservas,
  allowlist híbrida + Merkle, validação de demanda, carteira/chain falsas, admin de dois passos, benefícios 36 meses,
  telemetria sem PII, funil) · `d601a99` página `/founders-pass` (17 seções, 4 línguas, a11y 261/0) atrás de
  `FOUNDERS_SALE_PREVIEW=1` + verificador de tesouraria · `beeeb19` migration **0071** (snapshot congelado imutável,
  sinais de demanda com cascata LGPD, trilha append-only; provada em banco descartável, **não aplicada em produção**) ·
  `8c8f150` ensaio de flags + `docs/FOUNDERS-SALE-RUNBOOK.md` · `d9f10a4` **defeito achado e corrigido:** com a flag
  desligada a rota respondia corpo 404 com **status 200** (o `loading.tsx` de `(plataforma)` começava a transmitir antes
  do `notFound()`); movida para o grupo `(previa)` sem fronteira de loading, provado em `next start` (OFF 404 · ON 200)
  · `fe49b6d` marcos de progresso 0/25/50/75/99/última/100 %.
- **Validação (código `fe49b6d`):** diff-check PASS · tsc PASS · lint 0 erros (145 avisos, base) · suíte completa 294
  arquivos / 4.449 testes PASS · Founders 14 arquivos / 186 · build capado PASS · adversarial 14 · E2E 4 · caos 10 ·
  ensaio: todas as flags PASS, **OVERSELL = 0**.
- **Status de negócio:** `PRICE_STATUS=PROVISIONAL_FOR_DEMAND_VALIDATION` · `DEMAND_VALIDATION_STATUS=PENDING_OWNER_THRESHOLD`
  · supply pago 2.850 · cenário bruto máximo US$ 796.250 (não previsão).
- **Pendente do dono (7):** OD-NFT-02 preço FINAL + fonte SOL/USD · 04 reserva · 08 datas · 11 royalty % · 20 plano
  mensal · 21 limiares de demanda · 22 signatários/conversão. **Jurídico:** OD-NFT-16 jurisdição/KYC · 17 reembolso e
  divulgação ao consumidor · Termos/Privacidade · consentimento dos sinais de demanda · revisão da copy final.
  **Vercel:** deploy da página/rotas, admin hospedado, adapter da 0071. **Mainnet:** programa/coleção, multisig 2-de-3,
  snapshot de preço real. **Provedores:** e-mail/DNS, RPC/DAS, wallet adapter, bot.
- **Evidência:** `zswap-local/evidence/founders-nft-local-readiness-20261004T192353Z/` (24 docs + raw, MANIFEST 45
  arquivos PASS, SECRET-SCAN PASS) · arquivo `.tar.gz` sha256
  `1a30466ab2f6136c4e406f0facfbfdebe2a548b7e8f37c98efad0a67417ffa6b` · Drive
  `01_ZETTA_WORLD/01_Z-SWAP/Auditorias_e_Rounds/Founders_NFT/` (rclone check 0 diferenças; download de volta idêntico).
- **Estado:** `FOUNDERS_LOCAL_SALE_READINESS=CLOSED_PASS` · `CURRENT_RELEASE_CANDIDATE=NONE` · lane A intocada
  (`d896ce2`) · nenhum push, merge, deploy, escrita hospedada, e-mail real, tx, mainnet ou dinheiro real.

### L-039 · 2026-10-04 · Founders: política de tesouraria/capital aprovada e decisões do dono fechadas (lane B, NÃO release)

- **Política de capital (APPROVED):** `docs/FOUNDERS-TREASURY-AND-CAPITAL-POLICY.md` (autoritativa) — runway mínimo de
  **24 meses**, recursos não especulativos, orçamento de referência R$ 4.149.100 em 11 linhas (18,0 / 12,1 / 8,7 / 8,7 /
  7,2 / 17,4 / 6,0 / 5,8 / 1,9 / 10,8 / 3,4 % — aritmética conferida em código e teste), cascata "runway primeiro",
  patamares ≈ 2,1 / 2,5 / 3,2 / 4,15 mi, portão do escritório (operacional + razão de negócio + ≥ 18 meses), conversão
  com princípio aprovado e parâmetros pendentes de análise de risco + contador/jurídico.
- **Decisões:** OD-04 APPROVED (reserva 30/10/0 = 40, fora dos 2.850, coleção máx. 2.890) · OD-11
  APPROVED_SUBJECT_TO_LEGAL_AND_TECHNICAL_COMPATIBILITY (2,5 % → tesouraria, nunca benefício) · OD-20 APPROVED ("+30 %" =
  NON_BINDING_PRICING_GUIDANCE, com evidência) · OD-21 APPROVED (regra v1: 35 %/20 % do supply pago, teto inteiro;
  700/400 · 263/150 · 35/20) · OD-22 PARTIALLY_CLOSED (multisig 2-de-3, papéis A/B/C; identidades com o dono) · OD-02
  PENDING_REAL_DEMAND_VALIDATION · OD-08 PENDING_EXTERNAL_READINESS · OD-16/17 PENDING_LEGAL. **UNRESOLVED 0.**
- **Commits locais (sem push):** `62417b3` docs (política + decisões rev. 4 + varredura) · `40af92f` domínio (reserva
  divulgada + `LivroDaReserva`, royalty interno, regra de demanda v1, papéis, simulador de conversão, travas de segredo,
  divulgação na página em 4 línguas) · `de60d74` alocador de capital (`capital.ts`) · `0ae57a0` migration **0072**
  (preço exibido + versão da regra no sinal de demanda; provada em banco descartável, **não aplicada em produção**).
- **Achado corrigido antes do commit:** a 1ª versão da cascata reduzia a verba de segurança ao destravar o escritório
  (não monotônica); agora a cota do escritório fica não alocada até o patamar e o teste exige monotonia em todas as linhas.
- **Validação (código `0ae57a0`):** diff-check PASS · tsc PASS · lint 0 erros (145 avisos, base) · suíte completa 296
  arquivos / 4.490 testes PASS · Founders 16 / 227 · build capado PASS · rota OFF 404 / ON 200 com reserva divulgada ·
  a11y 261/0 · 0072: forward PASS, rerun SKIP, T17/T18/T19 OK · ensaio refeito: todas as flags PASS, **OVERSOLD = 0**.
- **Pendentes:** dono — identidades dos signatários · preço final após coleta real · data após prontidão externa ·
  jurídico — OD-16/17, Termos/Privacidade, consentimento, royalty, parâmetros de conversão, gross-up do CEO · Vercel ·
  provedores · chain (multisig, coleção, compatibilidade de royalty, snapshot real).
- **Evidência:** `zswap-local/evidence/founders-capital-policy-and-decision-closure-20261004T232957Z/` (13 docs + raw,
  MANIFEST 35 PASS, SECRET-SCAN PASS) · `.tar.gz` sha256 `1107d27d4abc69c1efb927f106e177e7b2a304924a95af338bd39429db76c3ae`
  · Drive `01_ZETTA_WORLD/01_Z-SWAP/Auditorias_e_Rounds/Founders_NFT/` (rclone check 0 diferenças; download idêntico).
- **Estado:** `FOUNDERS_CAPITAL_AND_LOCAL_DECISIONS_CLOSED` · `CURRENT_RELEASE_CANDIDATE=NONE` · lane A intocada
  (`d896ce2`) · nenhum push, merge, deploy, escrita hospedada, e-mail real, tx, mainnet ou dinheiro real.

### L-040 · 2026-10-05 · COST ENGINEERING ROUND aberto (lane B, desenvolvimento local, NÃO release)

- **Base registrada antes de qualquer código:** `PHASE_BASE_SHA=0afa8414636ec6eb73bf9e1d600272aff9367228` · tree
  `26198edd6896a767bc6bbea09a1874c5593eb1b3` (commit da L-039, HEAD de `pre-vercel-forward-20261003T234200Z`), base
  autorizada pelo dono para forward development.
- **Divergência medida e preservada:** `/home/zetta/swap-z-app` está em `kimi/round2-audit-fixes` = `d7741bb`, ancestral
  da base (127 commits atrás) — não é o estado atual (START-HERE §4); nada foi alterado ali, sem reset/checkout.
- **Worktree/branch:** `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/cost-engineering-20261005` ·
  `cost-engineering-round-20261005` (só local, sem upstream), criada a partir de `0afa841`; a branch
  `pre-vercel-forward-20261003T234200Z` não foi movida.
- **Plano:** `docs/PLANO-COST-ENGINEERING-ROUND.md`. Relatório: `docs/COST-ENGINEERING-ROUND-REPORT.md`.
- **Baseline (IMPLEMENTER-REPORTED, container capado 2g/5g, heap 1792, `npm ci --offline`, sem rede):** suíte completa
  **296 arquivos / 4.490 testes PASS** na base. A 1ª execução teve 1 FAIL ambiental (`git: not found` na imagem slim,
  `conexoes-0063.test.ts`); repetida na imagem com git (`zswap-autoclose-testrunner:node24-git-20261001t003707z`):
  PASS. Evidência: `zswap-local/evidence/cost-engineering-20261005T*/`.
- Proibido neste round: push, merge, deploy, Vercel, escrita/migration hospedada, Lane A, preço/supply/política
  comercial, treasury, referral/reserve definitivos, dinheiro real.

### L-041 · 2026-10-05 · COST ENGINEERING ROUND entregue para auditoria independente (lane B, NÃO release)

- **Base:** `0afa8414636ec6eb73bf9e1d600272aff9367228` (L-040). **HEAD de código validado:** `037d3a66efef48ee73121e9555779be86a6d4114`;
  o commit desta entrada é só docs. Branch `cost-engineering-round-20261005`, worktree `worktrees/cost-engineering-20261005`, sem upstream.
- **Defeitos confirmados e corrigidos (medidos contra PostgREST + Postgres reais descartáveis):** RSI O(N²) do Workbench (HEAVY 64,6 s →
  28 ms, idêntico); modo mesa O(N²) (19,1 s → 1,24 s, idêntico barra a barra); velas sem paginação (1 ano em 1h = 1.000 de 8.761);
  cota do Workbench contada no app e sem trava (Pilot sem teto; corrida) → reserva atômica no banco (0073); tique dos desks com corte
  nas 200 mesas mais antigas e `.in()` estourado acima de ~450 ids (3.250 desks: 3.050 nunca vistos; posições não fechavam) → fila
  justa, leituras por par, rota dedicada (3.250 avaliados/tique); receita/crescimento/resumo do admin truncados em 1.000 linhas;
  tokens cacheados contados em dobro no provedor OpenAI-compatível.
- **Migrations locais (NÃO aplicadas em nenhum banco hospedado):** 0073 (reserva atômica + `custo_unidades`), 0074 (último tique em
  lote), 0075 (métricas de custo na linha da rodada). Aditivas; T20/T20b/T21/T22 PASS; guardas de lista de migrations e de ACL
  atualizadas. ⚠️ A rota da bancada exige a 0073 (falha fechada 503 sem ela).
- **Validação (IMPLEMENTER-REPORTED, NÃO certificação; container 2g/5g, heap 1792, `npm ci --offline`):** type-check 0 · lint 0 erros /
  145 avisos (= baseline) · **suíte completa 304 arquivos / 4.547 testes PASS** (baseline 296 / 4.490) · SQL em cadeia nova 0001→0075:
  18/18 `.sql` rc=0, 20b PASS, 16b PASS, 13-stable 20/20 PASS (13 não estável: FAIL de temporização preexistente; 04/05/06 não rodados
  — exigem o socket/`runuser` de outra campanha) · integração PostgREST real 5/5 · build PASS (2ª execução com rede para `next/font`;
  1ª FAIL ambiental sem rede).
- **Modelo de 36 meses:** `docs/COST-ENGINEERING-36M-MODEL.md` (gerado; premissas MEASURED/ESTIMATED/DECISAO). Depois da engenharia, o
  custo econômico é dominado pela premissa de suporte humano; HEAVY/STRESS negativos — **só matemática, nenhuma decisão comercial**.
- **Decisões que ficam com o dono (nada foi decidido aqui):** fração do orçamento do Pilot (1/16, engenharia) e redação "até X";
  política de retenção (§19 do relatório); premissas de suporte humano/preços do modelo; agendar `/api/bancada/tique`; bloco de fatos
  da plataforma no ZION `ask` + arnês ao vivo (credencial).
- **Relatório:** `docs/COST-ENGINEERING-ROUND-REPORT.md`. **Evidência:** `zswap-local/evidence/cost-engineering-20261005T174907Z/`
  (MANIFEST.sha256).
- **Estado:** `COMMITTED_FEATURE_CHECKPOINT` · não CERTIFIED · não RC · lane A intocada (`d896ce2`) · `CERTIFIED_FEATURE_SHA=53cd85a…` ·
  nenhum push, merge, deploy, Vercel, escrita/migration hospedada, Lane A, preço/supply/política comercial, treasury ou dinheiro real.

### L-042 · 2026-10-05 · COST ENGINEERING — AUDIT REMEDIATION entregue para re-auditoria (lane B, NÃO release)

- **Início:** HEAD auditado `14e5a2089a1f03c1726847089c7ad5f1d7f65dad` (L-041), conferido limpo; branch novo
  `cost-engineering-audit-remediation-20261005` (sem upstream), worktree `worktrees/cost-engineering-remediation-20261005`. O branch
  auditado não foi tocado. **Último commit de código (C1b):** `7aa021d032a4ba706a9447663a8daf7e67431ca1`; o commit desta entrada é só docs.
- **Corrigido (auditoria independente de 14e5a20):** tique do papel sem exclusão real → lease atômico no banco (0076); posição
  duplicada → identidade canônica `v1:<estrategia>:<intervalo>:<vela>` + UNIQUE parcial + RPC idempotente; vela reaberta depois do
  fechamento → `ultima_vela_aberta` autoritativa; `fecharRodada` ignorado → confirmado, rota 503; 0073–0075 sem semântica de release →
  matriz A–E provada, 0076 com pré-condição, unidade aplicável numa transação; `{ error }` ignorado no tique; Growth/resumo com erro
  virando zero; paginação admin por offset → por chave; cache-write e formato DeepSeek no provedor OpenAI-compatível; ZION `ask` com
  fatos oficiais DERIVADOS das constantes. **Novos achados:** gabarito Founders exigia preço provisório (corrigido); tabela de preço
  Kimi/DeepSeek abaixo da lista (corrigida); trava de complexidade instável sob carga (corrigida, limites iguais); subcobrança de 1
  vela/ativo, `reasoning_tokens` somados sempre, rodada não persistida sem reconciliação (OPEN, LOW).
- **Migration local nova (NÃO aplicada em banco hospedado):** 0076 (aditiva; recusa rodar sem 0073–0075). T23/T23b PASS; guardas de
  migrations e ACL atualizadas no mesmo commit.
- **Pilot:** STANDARD_5000_FITS = **YES** para a definição proposta (3 ativos × 1 ano × 4h, estratégia própria; 5.000 reservas reais
  aceitas, a 5.001ª recusada por cota); **NO** no modo mesa com a mesma definição (806/dia). Fração 1/16 e oferta inalteradas.
- **Validação (IMPLEMENTER-REPORTED, NÃO certificação; container 2g/5g, heap 1792, `npm ci --offline`):** recert do C1 `802939c`
  **FALHOU** (1 teste de tempo de relógio) → C1b `7aa021d`: type-check 0 · lint 0 / 145 · **suíte 311 / 4.630 PASS** · build PASS ·
  SQL 0001→0076 19/19 · 20b/23b/16b/13-estável PASS (13 não estável FAIL preexistente; 04/05/06 não rodados) · integração PostgREST
  19 PASS + 1 SKIP (ZION ao vivo, credencial) · matriz A–E PASS · benchmarks sem regressão (razões antes/depois na mesma execução).
- **Modelo de 36 meses:** recalculado (preço de lista do Kimi, bloco de fatos, lease): EXPECTED positivo; **HEAVY/STRESS negativos**;
  humano 55–85% do custo econômico. Suporte com definição provisória (assíncrono, sem 24/7, ZION primeira linha) — hipótese, não contrato.
- **Decisões que ficam com o dono/auditor:** definição comercial do Pilot (e do modo mesa); aplicar 0073–0076 juntas no release
  autorizado; premissas de suporte e preço; agendar `/api/bancada/tique`; credencial para o arnês do ZION ao vivo.
- **Relatório:** `docs/COST-ENGINEERING-AUDIT-REMEDIATION-REPORT.md`. **Evidência:** `zswap-local/evidence/cost-engineering-remediation-20261005/`.
- **Estado:** `COMMITTED_FEATURE_CHECKPOINT` · não CERTIFIED · não RC · lane A intocada · nenhum push, deploy ou escrita hospedada.

### L-043 · 2026-10-06 · FOUNDERS ECONOMICS + COMMERCIAL TRUTH aberto (lane B, NÃO release)

- **Base registrada antes de qualquer código:** `PHASE_BASE_SHA=b464dd7fbec0941ffb26ab391a1783328dd876f9` (control plane da L-042); último commit de código previamente validado `7aa021d032a4ba706a9447663a8daf7e67431ca1`.
- **Worktree/branch:** `zswap-local/worktrees/founders-closure-20261006` · `founders-commercial-economics-closure-20261006`, somente local e sem upstream.
- **Airbag do handoff Claude → Codex:** árvore encontrada limpa, sem untracked nem commit novo do round. Snapshot externo completo em `zswap-local/recovery/founders-handoff-20261006T094736Z`; bundle e SHA-256 verificados antes da primeira edição.
- **Plano:** `docs/PLANO-FOUNDERS-SUPPORT-AND-ECONOMICS-CLOSURE.md`. O round fecha a classificação canônica de benefícios em pricing, prévia Founders, FAQ e ZION, e refaz a economia de 36 meses com staffing brasileiro, deflexão do ZION, escalonamento e reserva por passivo.
- **Achado de abertura confirmado:** a fonte existente marcava `cex_autopilot` e `arb_scanner` como disponíveis; pricing e a página Founders repetiam essas promessas. Nenhuma superfície foi publicada e nenhuma alteração hospedada foi feita.
- **Limites:** lane B local, não release; sem push, merge, deploy, Vercel, Supabase hospedado, migration hospedada, venda real ou dinheiro real.

### L-044 · 2026-10-06 · FOUNDERS ECONOMICS + COMMERCIAL TRUTH entregue para auditoria independente (lane B, NÃO release)

- **Handoff preservado:** estado de entrada `b464dd7fbec0941ffb26ab391a1783328dd876f9` encontrado limpo; snapshot, cópias, bundle e SHA-256 criados antes da primeira edição em `zswap-local/recovery/founders-handoff-20261006T094736Z/`. Nenhum trabalho não commitado do Claude foi descartado.
- **Implementação:** plano `183f4c6`; código/modelo/relatório `3562110`; alinhamento documental `c2bfc4a`. Candidato local exato `c2bfc4ab93801fc8084e952564afde0cde5ceae6`, tree `52c8cac23a27f48e25be3498090db1e31d098c43`; branch local sem upstream; nenhum push.
- **Verdade comercial:** fonte canônica com cinco estados; Autopilot CEX `IMPLEMENTED_DISABLED`; scanner de arbitragem `A_CONFIRMAR`; suporte prioritário Trader/Pilot assíncrono sem SLA/24×7/concierge/CEO pessoal; Pilot avançado roadmap; redes, fees EVM/Solana e definição dos 5.000 backtests normalizadas em pricing, venda/preview, FAQ e ZION.
- **Economia 36 meses:** S1 Lean R$461.023; S2 3×L1 R$691.535; S3 2×L1+lead R$814.258. Recomendação: começar com 2 L1 e contratar o terceiro por ≥70% de utilização, backlog ≥100, >2 dias úteis ou previsão de 60 dias. Meta ZION 70%. Reserva de serviço EXPECTED×1,25: Pro US$79,15; Trader US$181,92; Pilot US$313,79; total full sale US$330.309.
- **Preço/referral:** 149/399/1.990 continuam provisórios e só sustentáveis no EXPECTED; 10% referral condicional/com teto; 15% e 20% não aprovados. Nada publicado.
- **Recertificação exata implementer-reported:** Node 24.21.0/npm 11.19.0; npm ci PASS; build PASS; lint 0/145; type-check PASS; escopo 288/288; suíte completa autoritativa 313 arquivos / 4.654 testes PASS. As duas tentativas anteriores ficam registradas como `FAIL_ENVIRONMENT` (Git ausente; Git common dir não montado), sem reclassificação.
- **Integridade:** modelo regenerado sem diff; package-lock `8e9b522771c06ba6415c025ca363cb5015f8c3dc221b31dd191ab014766dd38a`; migrations/package files sem delta; secret scan PASS.
- **Supply chain aberta:** audit completo 66 (26 high/40 moderate), omit-dev 58 (21 high/37 moderate), 0 critical; não corrigida nem aceita neste round.
- **Evidência:** `zswap-local/evidence/founders-economics-closure-20261006T101806Z/`, 33 entradas; `MANIFEST.sha256` SHA-256 `feafb658068684dc7baefde0bc9dd8f9d1c0cb63f542627e4453893b5b6dc301`.
- **Estado:** `IMPLEMENTATION_COMPLETE` + `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` + `READY_FOR_INDEPENDENT_AUDIT`; não é RC, não é release, não é autorização de publicação. `RELEASE_CANDIDATE=NONE`; produção, Vercel, Supabase hospedado, push, deploy e dinheiro real intocados.

### L-045 · 2026-10-06 · FOUNDERS FINAL SALE + LIABILITY CLOSURE aberto após auditoria independente (lane B, NÃO release)

- **Base medida antes de qualquer código:** `PHASE_BASE_SHA=30366d0e95bcf3222f47fb9ef955a2a1bf294096`, tree `94cc97656ca84be3a21d8b8b3a0cb305bc174fbc`, atestação docs-only da L-044 sobre o candidato `c2bfc4ab93801fc8084e952564afde0cde5ceae6`.
- **Airbag:** árvore de origem limpa, sem modified/untracked; recovery bundle e SHA-256 verificados em `zswap-local/recovery/founders-final-delta-20261006T214345Z/` antes da worktree nova.
- **Worktree/branch:** `zswap-local/worktrees/founders-final-sale-liability-20261006` · `founders-sale-rules-final-delta-20261006`, somente local e sem upstream.
- **Plano:** `docs/PLANO-FOUNDERS-FINAL-SALE-AND-LIABILITY-CLOSURE.md`. Escopo: Pilot disponível na public sale; limites cumulativos 2/2/1 com allowlist 1/1/1; evento de até 14 dias; copy durável sem entitlement futuro; correção do double count de treinamento; reserva dinâmica de passivo remanescente reconciliada com a política de capital.
- **Achados de abertura confirmados:** `pilotSomenteAllowlist=true`; janela máxima modelada como 14 dias só da fase pública; copy em quatro idiomas promete benefícios por todo o ecossistema; modelo somava novamente horas de treinamento já pagas na folha e já refletidas no ramp.
- **Limites:** sem push, merge, deploy, produção, Vercel, Supabase hospedado, migration, dependência, supply-chain remediation, preço/supply final, treasury real, publicação ou dinheiro real.
- **Implementação:** `3a3f659` abriu o plano; `6c638ac` fechou regras/copy; `167816b` corrigiu treinamento e introduziu passivo dinâmico; `1cc619d` fechou o relatório; `8ef9bbe` alinhou guardas históricas com a verdade final. Candidato exato `8ef9bbe27ff1f74dd8d1f7f6e6f7abb180497150`, tree `d489e23e12004782f9620ac8bedf1f9f3a482ad4`.
- **Venda fechada:** allowlist 48h com 1/1/1; tetos cumulativos do evento 2/2/1; Pilot remanescente segue para a public sale; prazo total máximo de 14 dias desde `allowlistAbre`; sold-out somente real; unsold permanece unminted.
- **Copy e economia:** Founder status é propriedade duradoura do passe e segue o holder atual; Premium dura 36 meses; nenhum entitlement futuro automático. A dupla contagem de treinamento foi removida. A reserva é obrigação de serviço remanescente dinâmica, separa front-loaded/recurring/variable e é reconciliada dentro dos 100% da policy de capital.
- **Recertificação do implementador:** Node 24.21.0/npm 11.19.0; `npm ci` PASS e lock inalterado; alvo 18/270 PASS; type-check PASS; lint 0 erros/145 avisos; suíte 314 arquivos/4.669 testes PASS; production build PASS; modelo regenerado com hashes idênticos. Duas falhas iniciais ambientais foram preservadas: Git comum ausente no container e symlink de `node_modules` recusado pelo Turbopack; ambas passaram no mesmo SHA após correção exclusiva do executor.
- **Supply chain aberta:** medição atual: full 68 (1 critical/27 high/40 moderate); omit-dev 60 (1 critical/22 high/37 moderate). Nenhuma dependência foi alterada; disposição em campanha separada.
- **Evidência:** `zswap-local/evidence/founders-final-sale-liability-20261006T215541Z/`; manifesto e pacote são fechados externamente após o commit de atestação para evitar circularidade de hash.
- **Estado:** `IMPLEMENTATION_COMPLETE` + `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` + `READY_FOR_INDEPENDENT_AUDIT`; não é RC, release, publicação ou aprovação do preço. `RELEASE_CANDIDATE=NONE`; produção, Vercel, Supabase hospedado, push, deploy e dinheiro real intocados.

### L-046 · 2026-10-06 · FOUNDERS FINAL MICRO-DELTA aberto após auditoria independente (lane B, NÃO release)

- **Base medida antes de qualquer edição:** `PHASE_BASE_SHA=8f1849eb28a61f1a5f8b477386c3ce0940bc5e67`, tree `11cace84df18f4d8c8e9b72b31d9252bc8cea04a`; último código recertificado `8ef9bbe27ff1f74dd8d1f7f6e6f7abb180497150`.
- **Airbag:** origem encontrada limpa; bundle e SHA-256 verificados em `zswap-local/recovery/founders-final-microdelta-20261007T020548Z/` antes da primeira edição.
- **Worktree/branch:** `zswap-local/worktrees/founders-final-microdelta-20261006` · `founders-final-microdelta-20261006`, somente local e sem upstream.
- **Plano:** `docs/PLANO-FOUNDERS-FINAL-MICRODELTA-CLOSURE.md`. Escopo exclusivo: exigir deadline configurado exatamente em `allowlistAbre + 14 dias`, preservar sold-out real como única saída antecipada normal e tornar inequívoco em EN/PT/ES/ZH que o status Founder duradouro está associado ao passe.
- **Achados de abertura confirmados:** a validação aceitava qualquer janela menor que 14 dias; o cenário local ainda configurava 48h + 7 dias públicos; metadados, pricing e catálogos em quatro idiomas ainda usavam formulações equivalentes a status Founder permanente.
- **Limites:** sem economia, service liability, suporte, pricing, referral, Pilot compute, ZION architecture, supply chain, migration, infra, produção, Vercel, Supabase hospedado, push, merge, deploy, venda real ou dinheiro real.
- **Estado de abertura:** `IN_PROGRESS`; a recertificação exata, o relatório e o pacote de auditoria ainda não existem.

### L-047 · 2026-10-06 · FOUNDERS FINAL MICRO-DELTA entregue para auditoria independente (lane B, NÃO release)

- **Base e candidato:** base `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67`; candidato exato `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`, tree `835084a2ccb117e64a07376f9684d46196466c66`.
- **AF-01 fechado:** a configuração exige `vendaFecha = allowlistAbre + 14 dias` exatamente. 14d−1ms REJECTED, 14d ACCEPTED, 14d+1ms REJECTED e 48h+7d REJECTED. Sold-out real segue como única saída normal antecipada; sem sold-out, a venda permanece aberta até o deadline.
- **AF-02 fechado:** EN/PT/ES/ZH dizem que o status Founder é duradouro e associado ao passe; Premium dura 36 meses; transferência não reinicia a janela. Guardas rejeitam Premium vitalício/permanente e entitlement futuro automático.
- **Regras preservadas:** allowlist 48h e 1/1/1; cumulativo 2/2/1; Pilot na public sale; unsold unminted; preços provisórios. Nenhum arquivo econômico, migration, dependência ou caminho financeiro mudou.
- **Primeira falha preservada:** a primeira execução pré-candidato dos testes novos falhou 3/102 por duas fixtures inválidas e uma regex PT estreita; os testes foram corrigidos e passaram 102/102 antes do candidato. Não foi reclassificada como PASS.
- **Recertificação exata implementer-reported:** sale 9/9; copy 35/35; comerciais 17 arquivos/252 testes; type-check PASS; lint 0 erros/145 avisos; suíte 314 arquivos/4.672 testes PASS; production build PASS; economia regenerada sem diff.
- **Supply chain:** omit-dev 1 critical/22 high/37 moderate, sem correção; campanha separada.
- **Relatório/evidência:** `docs/FOUNDERS-FINAL-MICRODELTA-CLOSURE.md`; `zswap-local/evidence/founders-final-microdelta-20261007T020548Z/`.
- **Estado:** `READY_FOR_INDEPENDENT_AUDIT`; não é RC, release, publicação ou aprovação de preço. `RELEASE_CANDIDATE=NONE`; produção, Vercel, Supabase hospedado, push, merge, deploy, venda e dinheiro real intocados.

### L-048 · 2026-10-07 · FOUNDERS AF-01 SURGICAL CLOSURE aberto após auditoria independente FAIL (lane B, NÃO release)

- **Falha independente preservada:** candidato `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`, tree `835084a2ccb117e64a07376f9684d46196466c66`, reprovado por `IA-AF01-001`: agenda ativa com `vendaFecha = null` passava na validação e podia permanecer em `PUBLIC_SALE` depois de 30 dias. O SHA não foi alterado.
- **Base medida antes do código:** `PHASE_BASE_SHA=d08a1e3a221b5559630f53fb3318d538ee9c383f`, tree `84e1c04f4952e42888150f6472f79591b23672fc`, control plane docs-only sobre o candidato falho e já contendo a correção documental de trailing whitespace.
- **Airbag:** origem limpa; bundle e SHA-256 verificados em `zswap-local/recovery/founders-af01-20261007T092823Z/` antes da worktree nova.
- **Worktree/branch:** `zswap-local/worktrees/founders-af01-partial-schedule-fix-20261007` · `founders-af01-partial-schedule-fix-20261007`, somente local e sem upstream.
- **Plano:** `docs/PLANO-FOUNDERS-AF01-SURGICAL-CLOSURE.md`. Escopo exclusivo: rejeitar as seis agendas parciais, preservar o estado pendente 000 e exigir 48h/14d no estado configurado 111; provar que `ServicoDaVenda` falha fechado.
- **Limites:** nenhuma mudança de copy AF-02, economia, passivo, suporte, preços, referral, supply, Pilot, ZION, migration, dependência ou supply chain; sem produção, Vercel, Supabase hospedado, push, merge, deploy, venda ou dinheiro real.
- **Estado de abertura:** `IN_PROGRESS`; ainda não há novo candidato nem recertificação.

### L-049 · 2026-10-07 · FOUNDERS AF-01 SURGICAL CLOSURE entregue para nova auditoria independente (lane B, NÃO release)

- **Falha histórica preservada:** `58bcf8e359ec209d65f45006d0f71c17cf1a53a5` continua reprovado por `IA-AF01-001`; nenhuma evidência anterior foi reclassificada.
- **Implementação:** plano `8fff64f`; fix/testes `d2c565f`; higiene do plano `efdf6ee`. Candidato exato `efdf6ee5a64d4f5491b806da6258706615b6ffec`, tree `9021c273c1d2e790f3a09da25de8f230ba9ef46e`.
- **Invariante fechada:** somente `000` (pendente) e `111` (configurada) são estados válidos das três datas; as seis combinações parciais falham com `agenda_da_venda_incompleta`. O caso `110` do auditor é rejeitado por `validarConfig` e pela construção de `ServicoDaVenda`.
- **Regressões preservadas:** 48h; 14d−1ms rejeitado, 14d aceito, 14d+1ms rejeitado; 48h+7d rejeitado; sold-out real permitido; sem sold-out encerra exatamente no deadline; allowlist 1/1/1, cumulativo 2/2/1, Pilot público e copy AF-02 inalterados.
- **Primeiras falhas preservadas:** executor direcionado com bind read-only (`FAIL_ENVIRONMENT`); candidato `d2c565f` com quatro linhas de trailing whitespace (`git diff --check` FAIL); dois builds interrompidos por reboot e dois builds `137` por cgroup. Nenhum deles foi reclassificado.
- **Recertificação exata implementer-reported:** Node 24.21.0/npm 11.19.0; `npm ci` PASS e lock idêntico; alvo 11/11; domínio Founders 17 arquivos/254 testes; type-check PASS; lint 0 erros/145 avisos; suíte 314 arquivos/4.674 testes PASS; production build PASS; economia regenerada sem diff.
- **Integridade:** package files, migrations, economics, copy AF-02 e restante do domínio Founders sem delta. Evidência em `zswap-local/evidence/founders-af01-surgical-20261007T093209Z/`.
- **Estado:** `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` + `READY_FOR_INDEPENDENT_AUDIT`; não é certificação independente, RC, release ou publicação. `RELEASE_CANDIDATE=NONE`; produção, Vercel, Supabase hospedado, push, merge, deploy, venda e dinheiro real intocados.

### L-050 · 2026-10-07 · SUPPLY CHAIN CRITICAL/HIGH DISPOSITION entregue de forma condicional (lane B, NÃO release)

- **Base e commits:** start `35b7c727802343c5b6ba55dffa18da6fad19191e`; código/lock/gate `63326edb6d4cd3f6f95be8fc77b9d0382db91dc0`, tree `3cb3affc8da4472b360984274d459157c2faec44`; documentação final local `dd04b7b66ac025c04a0ee4347adcdd8e5ce3b1f4`.
- **Remediações suportadas:** `shell-quote` 1.10.0→1.12.0, `sharp` 0.35.4→0.35.5 e `source-map-js` 1.2.1→1.2.2; nenhuma major, override, remoção de wallet, feature ou mudança financeira.
- **Medição da campanha:** full 1 critical/27 high/40 moderate → 0/25/40; omit-dev 1 critical/22 high/37 moderate → 0/20/37. O residual medido derivava de `braces` sem versão corrigida e foi disposto como `NOT_RUNTIME_REACHABLE` no web artifact, condicionado à auditoria independente.
- **Validação implementer-reported:** npm ci, type-check, lint 0 erros/145 avisos, wallet/security 187/187, Founders 287/287, suíte 314 arquivos/4.674 testes, build, economia sem diff, migration/secret scan e artifact reachability PASS.
- **Relatórios:** `docs/SUPPLY-CHAIN-DISPOSITION.md` e `docs/SUPPLY-CHAIN-RUNTIME-REACHABILITY.md`; evidência `zswap-local/evidence/supply-chain-disposition-20261007T153104Z/`.
- **Estado:** `CONDITIONAL`; não é release ready. Produção, Vercel, Supabase hospedado, push, merge, deploy, venda e dinheiro real intocados.

### L-051 · 2026-10-07 · FOUNDERS PUBLIC SALES EXPERIENCE entregue para auditoria independente (lane B, NÃO release)

- **Base e candidato:** start `dd04b7b66ac025c04a0ee4347adcdd8e5ce3b1f4`; candidato de código exato `acd44d2c85b0568022af49d4e3ebdff286fcc92c`, tree `ee72bc9bdb28575780914ff4ad5e1b824d02deae`; branch local `founders-public-sales-page-20261007`, sem upstream.
- **Experiência pública:** `/founders-pass` passa a explicar plataforma, produtos, Founder/Premium, tiers, fees, redes, venda, custody e risco; 59 FAQs em EN/PT/ES/ZH; nenhum buy/mint/checkout ativo. O simulador anterior exige `FOUNDERS_SALE_PREVIEW=1` e não é o comportamento público padrão.
- **Verdade e pendências:** `ZSWAP-PUBLIC-SOURCE-OF-TRUTH.md` é a projeção pública segura; data, supply final, preço final, payment e itens legais continuam explicitamente pendentes em `FOUNDERS-SALES-PAGE-OPEN-DECISIONS.md`. Nenhuma decisão foi inventada.
- **Validação implementer-reported no candidato exato:** alvo final 3 arquivos/10 testes; suíte completa 318 arquivos/4.689 testes PASS; type-check PASS; lint 0 erros/145 avisos; production build PASS; economia regenerada com hashes idênticos; package-lock e migrations sem delta. Browser HTTP 200 em 390/412/768/1440, sem overflow/erro/controle de compra; Axe 0 violações em mobile/desktop; i18n, FAQ search e beacon 204 PASS.
- **Falha ambiental preservada:** a primeira execução final de type-check recebeu heap V8 de 1,2 GiB no executor e terminou 134/OOM antes de qualquer diagnóstico TypeScript; o executor corrigido para o limite previamente validado de 1,7 GiB passou sem mudança de código.
- **Drift externo de supply chain:** lock inalterado, porém o feed do registry em 07/10 passou a reportar omit-dev 0 critical/21 high/37 moderate. A linha adicional é o HIGH direto de Next.js `GHSA-cjq9-62q9-8jv4`, com fix disponível. Fica `OPEN — SEPARATE DISPOSITION CAMPAIGN` e bloqueia release/publicação; não foi corrigido neste round.
- **Relatório/evidência:** `docs/FOUNDERS-PUBLIC-SALES-EXPERIENCE-CLOSURE.md`; `zswap-local/evidence/founders-public-sales-page-20261007T215055Z/`.
- **Estado:** `IMPLEMENTATION_COMPLETE` + `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` + `READY_FOR_INDEPENDENT_AUDIT`; não é publicação, RC, release, venda ou deploy. Produção, Vercel, Supabase hospedado, push, merge e dinheiro real intocados.

### L-052 · 2026-10-08 · FOUNDERS SALES PAGE FINAL BLOCKERS fechados para nova auditoria (lane B, NÃO release)

- **Base e candidato:** start `4db8f78ae67fb6634427f48c92a856d1f81f7cfb`; candidato anterior preservado `acd44d2c85b0568022af49d4e3ebdff286fcc92c`; novo candidato de código exato `fd68c4f663ced81c3e040367c62697e473b5d542`, tree `aea9a29aa766304a80dc6394d40377632966ce1f`; branch local `sales-page-final-blockers-20261008`, sem upstream.
- **Next HIGH:** `next` 16.3.6→16.3.8 exato; `GHSA-cjq9-62q9-8jv4` ausente nos audits finais. Full 0 critical/26 high/40 moderate→0/25/40; omit-dev 0/21/37→0/20/37. Lock mudou apenas no conjunto Next/env/SWC; SHA-256 final `5d5d05c7d12c3a3905d82f8ee4347c629d6a5acf612483d4f05334c828638816`.
- **Image optimizer:** o wildcard remoto foi removido depois de provar que os consumidores atuais de `next/image` são locais. O artefato final registra `domains=[]` e `remotePatterns=[]`; teste recursivo impede a reintrodução do wildcard ou fonte HTTP(S) literal.
- **Produtos públicos certificados:** Dashboard `AVAILABLE`; Portfolio `PARTIAL`; Orders `PARTIAL`; Pools `AVAILABLE` somente como descoberta read-only. A matriz canônica alimenta cards e testes. Copy de Portfolio/Pools em EN/PT/ES/ZH foi estreitada ao fluxo real; nenhuma feature foi promovida por marketing.
- **Recertificação exata implementer-reported:** alvo 13 arquivos/108 testes; wallet/security 14/187; imports EVM/Solana PASS sem rede/transação; type-check PASS; lint 0 erros/145 avisos; suíte completa 320 arquivos/4.702 testes PASS; build PASS sob limite de memória; browser 73/73 em 390/412/768/1440; FAQ 59 por idioma; Axe 0 violações; economia regenerada sem diff; migrations intactas; full supply-chain gate PASS com a exceção R-03 anterior ainda explícita.
- **Falhas ambientais preservadas:** a primeira full suite no slim passou 4.700/4.702 e falhou apenas nos dois testes que executam `git show`, pois a imagem não continha Git; o runtime Bookworm Node 24 com Git passou 4.702/4.702 sem mudança de produto. A tentativa única de `npm ci` limpo no SHA exato falhou `ECONNRESET` e não foi repetida; as validações usaram snapshot de instalação limpa anterior com o mesmo lock e Next 16.3.8.
- **Verdade pública preservada:** Founders, 59 FAQs, sale mechanics, Premium 36 meses, data/supply pendentes, preços provisórios ocultos, economics, fees e quotas não mudaram. Telemetria passou a ser descrita precisamente como pseudônima; beacon/arquitetura não mudaram.
- **Relatório/evidência:** `docs/FOUNDERS-PUBLIC-SALES-FINAL-BLOCKERS-CLOSURE.md`; `zswap-local/evidence/founders-sales-final-blockers-20261008T100038Z/`; pacote externo `Z-SWAP-FOUNDERS-SALES-FINAL-BLOCKERS-AUDIT-20261008/` fechado depois da atestação docs-only para evitar circularidade.
- **Estado:** `IMPLEMENTATION_COMPLETE` + `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED` + `READY_FOR_INDEPENDENT_AUDIT`; não é publicação, RC, release, venda ou deploy. Produção, Vercel, Supabase hospedado, push, merge e dinheiro real intocados.

### L-053 · 2026-10-14 · Release de produção 13–14/10 (código `6d1295b`) e reconciliação de governança pós-release (só docs)

> Registro escrito **depois** do release, na rodada docs-only "POST-RELEASE GOVERNANCE RECONCILIATION" autorizada pelo dono
> em 14/10. Esta entrada não é prova retroativa de autorização: as autorizações citadas abaixo têm fonte própria.

- **Autorização original:** missão do dono "Z-SWAP — PRODUCTION RELEASE / TOTAL RECONCILIATION / VERCEL DEPLOY · MISSÃO
  AUTORIZADA PELO DONO · DATA: 13/10/2026" (sessão Claude Code `bf97bae1`, mensagem de 2026-10-13T22:59:56Z): autorizou
  reconciliação, branch de release, correções, push da branch, CI, preview, migrations comprovadamente necessárias, merge em
  `main`, deploy e rollback; vedou trade/ordem/dinheiro real, ativação de Autopilot/DCA real, force-push e "secret
  inventado". **R-02:** o dono autorizou explicitamente gerar `CEX_RECOVERY_HMAC_KEY` (resposta de 2026-10-13T23:12:17Z).
  Trechos preservados fora do repo (`evidence/post-release-governance-*/04-authorization-excerpts.txt`).
- **Seleção do SHA:** feita durante a execução (topo do trabalho aprovado `e2f61d1` + 2 commits só de teste). **Não** houve
  registro `RELEASE_CANDIDATE` nem autorização para o SHA específico no ledger antes do deploy (`RELEASE-CHAIN.md` §3 item 7) —
  divergência entre os documentos então vigentes e o release executado. Política de deploy inalterada; não é precedente.
- **Cronologia (UTC, fontes Vercel/GitHub/Supabase/transcript):** 13/10 23:50:14 `CEX_RECOVERY_HMAC_KEY` criada (`sensitive`,
  production+preview) · branch `release/production-20261013` com `e2f61d1`; CI falhou na trava CE-01 (5,0×); correções
  `2352fe1` e `6d1295b` (só `src/lib/bancada/motor.complexidade.test.ts`); CI 38488966914 success; preview
  `dpl_J6K54QHL9xgiQe9CPPLyhu73DKbR` READY · 14/10 ~00:25:33–00:25:50 migrations 0059–0076 no hospedado (versões
  `20261014002533`…`20261014002550`) · 00:26:37 `main` fast-forward `25fc4b0` → `6d1295b` (PR #447 marcado MERGED) ·
  00:26:41 deployment de produção `dpl_A5PDW653HtRyH4HN6CUdhGC7LLrC` (READY).
- **Gates medidos (pacote `release/production-20261013`, MANIFEST 60/60):** reconciliação de 202 commits (0 UNKNOWN); npm ci,
  secret scan, economia e arneses SQL 01–23 + concorrência em `e2f61d1`/migrations idênticas; lint 0 erros/145 avisos,
  type-check, suíte 321/4716 e CI no SHA exato; build local em `2352fe1` (recusado em `6d1295b` pelo guarda INC-RR-01) e build
  Vercel no SHA exato; `npm audit` 0 critical/25 high/40 moderate (snapshot), exceção R-03 revisada e mantida.
  Classificação: **não** `CERTIFIED_EXACT_SHA` (desvios acima).
- **Banco (leitura `read only` de 14/10):** 73 linhas de histórico, head `20261014002550`; RLS 53/53, 0 policies;
  `disable_early_access=true`; `dca_real_liberado`/`autopilot_cex_liberado` ausentes; 0 sessões, 0 conexões CEX, 0 intents,
  0 fills, 0 planos DCA não simulados. Migrations aplicadas **sem** `pg_dump` + restauração validada (runbook R2.3 item 6 não
  cumprido); rollback A provado (`25fc4b0` servindo 200 sobre o schema novo).
- **R-01 CLOSED · R-02 CLOSED** (presença por nome; caminho autenticado não exercitado) · **AP-LOCK hosted PASS** (sonda
  comportamental) · Autopilot e DCA real **DISABLED**.
- **Smoke histórico:** 2 linhas FAIL conciliadas como expectativa errada do script (`/api/cex/order` anônimo → 401;
  `GET /api/radar` → 405) e uma linha de log pós-processada (`AUDIT-RECONCILIATION.md` §5.7, SMOKE-HIST-01/02). Logs originais
  preservados.
- **Abertos:** ACL-DEFAULT-GRANTS · CE-01-MARGIN (monitorar) · BUILD-WARNINGS · R-03 (exceção) · REL-GOV-GAP · GATE-OPEN ·
  REAL-AUTOMATION NO-GO · auditoria independente Founders.
- **Documentos reconciliados neste commit (só docs):** `AGENTS.md`, `docs/START-HERE.md` (rev. 14), `docs/CURRENT-STATE.md`
  (rev. 16), `docs/RELEASE-CHAIN.md` (nós 25–28), `docs/RELEASE-RUNBOOK.md` (R2.0), `docs/AUDIT-RECONCILIATION.md` (§5.7),
  `docs/AI-OPERATING-RULES.md` (§3 e nota em §6.1), `docs/GIT-AND-WORKTREE-MAP.md`, `docs/DOCUMENT-AUTHORITY.md`,
  `docs/EXTERNAL-GATES-PREP.md` (banner), este ledger. SHA do commit, CI, deployment e readback: evidência externa
  `evidence/post-release-governance-*` (não cabem no próprio commit).
- **Estado:** release de código concluído em `6d1295b`; nenhum release candidate novo; nenhuma fase aberta.


## L-054 — Founder Pass no menu (14/10/2026)

Autorização do dono nesta conversa: "Agente tem que por ela no MENU", após autorização para publicar as atualizações. Escopo: expor a página existente /founders-pass na navegação compartilhada desktop/mobile/CommandBar, EN/PT/ES/ZH. Não abre venda, early access, Autopilot ou DCA real.

Base: 415ac35e26c518e27af034dad22708f11ab0249a. Código: 34e9159d3f181f2d3a12c57a02826db55d9c2686 (5 linhas; nav-items.ts e messages.ts). CI 38538847156 PASS: npm ci, lint, typecheck, suíte completa e audit gate R-03. Preview dpl_EJH4AGttXnkQjGdDZASH9nceXbN5 READY; clique desktop/mobile validado. Este commit documental preserva exatamente esse delta de produto.

Candidato de publicação: commit desta entrada (THIS_RELEASE_CANDIDATE_COMMIT), condicionado ao CI e build do seu próprio SHA; identidade exata e resultados preservados externamente em zswap-local/evidence/founders-menu-20261014/. Validação restrita a navegação; não declarar CERTIFIED_EXACT_SHA da plataforma inteira nem novo ensaio SQL. Nenhuma mudança em banco, migrations, dependências, env ou flags. Findings L-053 permanecem abertos. Rollback de aplicação: dpl_HfxpGF9HBrhfAJ9odLxZuLJ5Zy8G (415ac35); schema inalterado nesta rodada.

## L-055 — Fechamento final da auditoria externa: A08/A09/A10/A17 (14/10/2026)

Missão do dono "Z-SWAP — FINAL AUDIT CLOSURE · FORENSIC RECOVERY + INDEPENDENT RE-AUDIT · A08/A09/A10/A17"
(14/10). Autoriza: busca forense, correção em `audit/final-a08-a09-a10-a17-closure`, preview, e merge +
deploy só se houver correção real necessária e todos os gates e o preview passarem. Proíbe trade, ordem,
escrita financeira, DCA/Autopilot real, apagar dados e mexer em flags financeiras.

**Fonte recuperada** (3ª busca): a auditoria de 14–15/09 foi feita numa sessão Codex local que gravava
`audit-swap-z-2026-09-11/ACHADOS-EM-VALIDACAO.md` fora de `zswap-local/`; o texto e as reproduções do
auditor foram extraídos verbatim do log da sessão. Mesmo espaço de IDs conferido contra o mapa achado→PR.
A reauditoria substitutiva não foi necessária.

| ID | estado | prova |
|---|---|---|
| A08 | ALREADY_FIXED_PROVEN | `fc59805` (CE-09) |
| A09 | ALREADY_FIXED_PROVEN | `fc59805` (CE-09) |
| A10 | **FIXED** em `5c2306e` | reproduzia em `2e3e397` (1.000 leituras com teto 400) |
| A17 | ALREADY_FIXED_PROVEN | `a165d73` (#421) |

Regressões: `src/lib/bancada/auditoria-externa-a08-a10.test.ts` (7 casos) e
`src/lib/dca/auditoria-externa-a17.test.ts` (1, pela rota real do cron). Cada correção foi quebrada de
propósito e a quebra foi detectada (A08, A09, A10 teto, A10 rodízio, A17).

**Descoberto:** o relatório final do auditor tinha 33 achados. A31 (mint Solana em minúsculas: preço
`null` em produção, confirmado por GET read-only), A32 (preço desconhecido vira zero no portfólio) e A33
(`mode=list` com taker devolve calldata sem kill-switch) estão **OPEN** e não foram corrigidos aqui: A31
mexe nos preços que o swap usa e A33 contraria uma escolha documentada (decisão do dono).
`KNOWN_MISSING_CORRECTIONS=3` · `UNKNOWN_FINDINGS=0`.

Gates, CI, preview e candidato: `RELEASE-CHAIN.md` "Atualização L-055". Evidência fora do repo:
`zswap-local/evidence/forensic-a08-a09-a10-a17-final-20261014/` (`MANIFEST.sha256`). Resultado do deploy:
registrado no commit seguinte, só de docs.

Resultado do deploy (14/10): `origin/main` avançada por fast-forward `2e3e397` → `2c0c7c9` (sem force), depois
do CI 38556728385 verde nesse SHA. Produção `dpl_BhiwniCtsqX7iUTGM3mkhrXFzMSj` READY em
`2c0c7c9bcf3e1d3e9e4440cd59fb9516c45abb16`, aliases `swap-z-app.vercel.app` (confirmado pela API). Smoke de
produção read-only 25/25 PASS (páginas 200, rotas inexistentes e admin 404, crons/tique/ordem sem segredo
401 com corpo da aplicação, early access `closed`). Runtime errors desde o deploy: nenhum. ⚠️ O tique de papel
depois do deploy **não** foi observado: a API de logs da Vercel não devolveu nenhuma linha para o projeto
(nem das requisições do smoke). Rollback: `dpl_2NrEVzr9U2FM3Y8fqAzAa4Y6237v` (`2e3e397`). Banco, migrations,
flags, Autopilot e DCA real inalterados; 0 ordens, 0 trades, 0 dinheiro movido.

## L-056 — Auditoria externa A31 + A32 corrigidos; A33 intocado (14/10/2026)

Missão do dono "Z-SWAP — AUDIT CLOSURE ROUND · ESCOPO EXCLUSIVO: A31 + A32" (14/10): investigar, corrigir,
testar e, com todos os gates e preview, publicar. **A33 explicitamente fora** (kill-switch de `mode=list`:
decisão do dono). Proíbe trades, ordens, dinheiro real, flags financeiras, schema e migrations.

**Fonte:** texto e testes originais do auditor recuperados da sessão Codex local (14/09, 2ª rodada),
evidência em `zswap-local/evidence/forensic-a31-a32-final-20261014/original-source/`.

**A31 — fronteira, não sintoma.** Toda normalização de endereço no caminho de preço foi mapeada: cliente
(`useTokenPrices`), rota `/api/prices` (pedido e chave da resposta), vigia de ordens e 6 URLs da GeckoTerminal
(info de token usada por `/api/risk` e ZION, pools, OHLCV, trades) mais a carteira do trader nas trades.
Regra única em `src/lib/precos/chave.ts`: hex EVM → minúsculas (semântica EVM inalterada), base58 e `native`
exatos. Comparações por igualdade com `toLowerCase` nos dois lados (store do swap, seletor) não corrompem e
ficaram. GoPlus não atende Solana.
Efeito no swap: tokens SPL passam a usar preço vivo do mint correto em vez do snapshot estático do registro
(WIF estava 1,20 no registro; vivo 0,20) ou `null` (que deixava a guarda de impacto muda: `impactoPct null →
"ok"`). Gorjeta MEV: o preço do SOL vem da chave `native` (inalterada); o notional de SPL passa a ser real.
**Achado novo na mesma fronteira (A31-NB1):** o vigia de ordens procurava o preço pelo endereço cru — com
checksum EVM (21 tokens do registro) ou mint SPL a chave não batia e ordem local de token com contrato nunca
disparava. Corrigido junto.

**A32 — semântica, não cosmética.** `src/lib/portfolio/avaliacao.ts`: zero conhecido ≠ sem preço ≠
indisponível. Linha sem preço diz "preço indisponível" e mantém a quantidade; total soma só o que tem preço,
é marcado parcial e mostra "—" quando nada tem preço; total parcial **não** vira snapshot do histórico; saldo
não lido é contado e dito. Mesmo tratamento no total da carteira do Dashboard e no resumo de carteira enviado
ao ZION. `formatUsd(null) → "$0.00"` (formatador global) não foi alterado: o portfólio deixou de passar
`null` para ele. Fora do escopo e registrados: volume de operações (History/Dashboard) e ordenações de
CEX/Autopilot com `?? 0` (não fabricam patrimônio).

**Prova:** testes idênticos em `27bf8eb` → 14 falham / 6 passam (só controles e gêmeas); em `d047673` → 29/29
(20 de reprodução + 9 de módulo). Cinco quebras deliberadas, todas detectadas. Gates, CI, preview e candidato:
`RELEASE-CHAIN.md` "Atualização L-056". `KNOWN_MISSING_CORRECTIONS=1` (A33) · `UNKNOWN_FINDINGS=0`.
Resultado do deploy: registrado no commit seguinte, só de docs.

Resultado do deploy (14–15/10): `origin/main` avançada por fast-forward `27bf8eb` → `6c66c13` (sem force),
depois do CI 38661654305 verde nesse SHA. Produção `dpl_2R8vsDxZNEDMyACbsR1TJ6npPwYB` READY em
`6c66c132699c06d249c41fd4a07279563cba46f5` (código `d047673`), alias `swap-z-app.vercel.app` confirmado pela
API. Smoke read-only 25/25; `/api/prices` em produção agora devolve USDC Solana 1,002, JUP 0,318, WIF 0,201
(antes `null`), EVM e nativos inalterados; early access `closed`. Runtime errors: nenhum. Rollback:
`dpl_DT9haCV1YucfhoFJkxjRNnrqfDNT` (`27bf8eb`). Banco, migrations, flags, Autopilot e DCA real inalterados;
0 ordens, 0 trades, 0 dinheiro movido. A33 intocado.

## L-057 — Auditoria externa A33 corrigido; os 33 achados fechados (15/10/2026)

Missão do dono "Z-SWAP — FINAL EXTERNAL AUDIT CLOSURE · A33 — EXECUTABLE PAYLOAD BOUNDARY" (15/10). Decisão de
arquitetura do dono: **não** pôr o kill-switch sobre a lista inteira; `mode=list` continua READ-ONLY e
disponível com o swap desligado, mas nunca entrega payload executável/signável; `mode=quote` é a única
superfície de preparação de execução, sob `disable_swap`/`maintenance_mode`. Política de falha aberta da
leitura do kill-switch **não** alterada (exigiria finding próprio).

**Fonte:** teste original do auditor (`quote-killswitch-list.test.ts`, 14/09) recuperado da sessão Codex local.

**Auditoria de todos os provedores da lista** (`raw` atravessava a resposta HTTP inteira):
0x com carteira → `/quote` firme: `transaction.to/data/value/gas`, `permit2`, `issues.allowance.spender`;
0x sem carteira → `/price`: `allowanceTarget`, `issues`; LiFi (cross-chain, só com carteira) →
`transactionRequest` assinável e `estimate.approvalAddress`; Jupiter → `quoteResponse` com `routePlan` (o insumo
direto do `/swap`). Não havia outro provedor na lista (CoW não passa por esta rota).

**Correção:** DTO `ListQuote` + `paraListagem` em `lib/api/quote-types.ts` — allowlist estrutural que copia cada
campo por nome, com tipo coagido (hops: `protocol`, `share`, `color`). As chamadas aos provedores não mudaram
(valores firmes e o booleano `isFirm` que o CTA usa). As quatro telas da lista passaram a `ListQuote`: o
type-check prova que nenhuma lia `raw`. `ExecuteSwap` continua buscando cotação firme NOVA em `mode=quote` ao
abrir o modal (sem reaproveitar nada da lista: frescor de calldata, allowance, rota, preço e taker).

**Prova:** `auditoria-externa-a33.test.ts` (12, rota real, provedores falsos devolvendo o material executável
real de cada um; casos A–J da missão + integridade da comparação). Em `5af0504`: 7 falham (toda a lista), os de
quote passam. Em `4ba6694`: 12/12. Quebras: sem a fronteira; DTO por spread; calldata 0x de volta; quoteResponse
Jupiter de volta — todas detectadas. Prova da allowlist: campo novo com calldata no normalizador 0x não vaza.
Produção antes (15/10, leitura): lista 0x com carteira trazia `transaction.data` real (4490 chars).
Observação fora do escopo: LiFi sem cotação em produção e preview (LIFI-UPSTREAM-01, OPEN_NONBLOCKING).

`KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=0` · AUDIT RECONCILIATION FINAL = PASS. Gates, CI, preview e
candidato: `RELEASE-CHAIN.md` "Atualização L-057". Resultado do deploy: registrado no commit seguinte, só de docs.

Resultado do deploy (15/10): `origin/main` avançada por fast-forward `5af0504` → `d390880` (sem force), depois
do CI 38716563329 verde nesse SHA. Produção `dpl_3E65QrD59LprRzkkS7EMrMukEzRw` READY em
`d390880cf150534a9c9755ac318deb188a23b327` (código `4ba6694`), alias `swap-z-app.vercel.app` confirmado pela API.
Smoke read-only 25/25; listas reais 0x (com e sem carteira) e Jupiter: **zero material executável** (antes: calldata
real na lista 0x com carteira); `mode=quote` 0x com interruptores abertos devolve payload firme; fluxo do swap no
navegador (1440/390) com cotação 0,05 SOL → ~5,15 USDC na tela e lista não executável; early access `closed`.
Runtime errors: nenhum. Kill-switch de `mode=quote` provado pelos testes E/F (mocks), sem mexer em flag de
produção. Rollback: `dpl_EvGv264czgmaBRPuhaQvFDgMDKxQ` (`5af0504`). Banco, migrations, flags, Autopilot e DCA real
inalterados; 0 ordens, 0 trades, 0 dinheiro movido.

## L-058 — LIFI-UPSTREAM-01: LiFi sem cotação desde 10/08; corrigido (15/10/2026)

Missão do dono "LIFI-UPSTREAM-01 — INVESTIGAÇÃO CIRÚRGICA". Auditoria externa fechada e **não** reaberta; A33
intocado; esta investigação não altera `AUDIT-RECONCILIATION.md` (instrução do dono — a linha
LIFI-UPSTREAM-01 de lá fica como registro histórico de 15/10; o desfecho está aqui).

**Causa (provada antes de editar).** Toda cotação LiFi levava `fee` + `integrator=z-swap` + `referrer`: todo
plano EVM tem taxa > 0 e `destinatarioDaTaxa("evm")` cai numa carteira fixa no código. O integrator "z-swap"
nunca foi cadastrado no Partner Portal do LiFi, e a API recusa: HTTP 400, code 1011, *"Integrator "z-swap" is
not configured for collecting fees. Please sign up on https://portal.li.fi/ and configure your fee wallet."*
Provas: chamada direta à API (sem taxa 200; só `integrator` 200; `fee`+integrator 400/1011; `fee` sem
integrator 400/1011) e a `fetchLiFiQuote` real com os argumentos da rota (free/pro/trader/pilot: 400/1011; sem
taxa: OK). Documentação oficial: a taxa exige integrator cadastrado e vai para a carteira configurada no
portal; `referrer` é só rastreio. A rota engolia o erro (lista → `null` com `console.warn`; firme →
`upstream_failed`). Hipóteses de rede, região, chave, token nativo, decimais e parser descartadas: a mesma
chamada sem `fee` funciona.

**Classificação.** Z-SWAP BUG: YES · UPSTREAM: NO · REGRESSION: YES · FIRST BAD: `dfff405` (10/08, Fase 9.2) ·
LAST KNOWN GOOD: `80dc71e` (pai; não mandava taxa ao LiFi). Impacto: LiFi é a única fonte cross-chain da rota —
**Bridge e todo swap entre redes sem rota por ~2 meses**; e a tela ainda anunciava 1% de taxa nessas rotas.

**Decisão do dono (15/10):** restaurar já, sem taxa nas rotas LiFi, até o integrator ser cadastrado.

**Correção (`2719e38`).** `lifi.ts`: `fee` + `integrator` só com integrator informado
(`integradorLiFi()` = env `LIFI_INTEGRATOR`); `referrer` removido. `route.ts`: taxa das cotações LiFi só com
integrator; a taxa DIVULGADA nas rotas LiFi (firme, lista cross-chain, `swap_intent`, alerta de taxa não
retida) é 0 sem ele. Taxas 0x/Jupiter inalteradas; A33 preservado (lista sem nada executável).

**Prova.** `src/app/api/quote/lifi-upstream-01.test.ts` (11; rota e `fetchLiFiQuote` reais, servidor LiFi falso
com a regra 1011): em `835b5b0` 8 falham / 3 controles passam; em `2719e38` 11/11. Quatro quebras deliberadas
detectadas (a primeira só depois de testar a função direto: a rota zerar a taxa mascarava a condição — defesa
em profundidade, agora com teste nas duas camadas). Gates, CI e preview: `RELEASE-CHAIN.md` "Atualização
L-058". Preview real: LiFi devolve lista (não executável) e cotação firme em ETH→Arbitrum, ETH→Optimism e
USDC Ethereum→Base, taxa divulgada 0% (produção: lista vazia, `upstream_failed`, taxa anunciada 100 bps).

**Pendência do dono:** para voltar a cobrar no cross-chain, cadastrar o integrator em portal.li.fi com a
carteira de taxa e definir `LIFI_INTEGRATOR` na Vercel com esse nome exato (ver `RUNBOOK.md`).
Resultado do deploy: registrado no commit seguinte, só de docs.

Resultado do deploy (15/10): `origin/main` avançada por fast-forward `835b5b0` → `a19d2c1` (sem force), depois do
CI 38722925490 verde nesse SHA. Produção `dpl_DCsP5Gbz6kyu9Y1RubfoZ3t9ZN3D` READY em
`a19d2c1a12d00f34ac82b86682cb02a48867a787` (código `2719e38`), alias `swap-z-app.vercel.app` confirmado pela API.
Smoke read-only/quote-only: LiFi com lista (não executável) e cotação firme em ETH→Arbitrum, ETH→Optimism e USDC
Ethereum→Base, taxa divulgada 0% (antes: lista vazia e `upstream_failed`); swap na mesma rede (0x) segue com
taxa 100 bps; smoke geral 25/25; early access `closed`. Runtime errors: nenhum. Rollback:
`dpl_3E65QrD59LprRzkkS7EMrMukEzRw` (`d390880`; deployment de produção anterior ao mesmo código de `835b5b0`).
Banco, migrations, flags, Autopilot e DCA real inalterados; 0 ordens, 0 trades, 0 dinheiro movido.

## L-059 — LIFI-UPSTREAM-01, ativação: integrator `zswap` validado e detecção da taxa corrigida (15/10/2026)

O dono cadastrou o integrator **`zswap`** no Partner Portal do LI.FI (carteiras de taxa por família de rede,
EVM L2 por rede deixado em branco). Antes de ligar `LIFI_INTEGRATOR`, teste só de cotação na API real com
`integrator=zswap` + `fee`: **HTTP 200** (sem 1011) em ETH→Arbitrum, USDC Ethereum→Base (1%) e ETH→Optimism
(0,10%). O LI.FI **soma** a taxa do integrador à dele na linha "LIFI Fixed Fee": sem `fee` 0,0025; `fee=0.01`
0,0125; `fee=0.001` 0,0035 (evidência `lifi-upstream-01-20261015/integrator-check-zswap/`).

**Defeito achado antes de ligar:** a rota procurava a taxa por nome (`integrator|z-swap|referrer`). Com a
variável ligada, toda cotação LI.FI firme dispararia o alerta **falso** "TAXA NÃO RETIDA" no Telegram e gravaria
`taxaAceita: []` no `swap_intent`, com a taxa retida.

**Correção (`2b8118d`).** `taxaDoIntegradorNaCotacao` em `lib/api/lifi.ts`: linha própria do integrador se o
LI.FI um dia separar; senão, nossa parte = total da "LIFI Fixed Fee" − taxa própria do LI.FI
(`LIFI_TAXA_PROPRIA`, env `LIFI_SERVICE_FEE`, padrão 0,0025). Sem prova, `null` — erra para o alarme, nunca para
receita fingida. A rota grava `taxaAceita` com pct, valor da nossa parte, token e total.

**Prova.** `lifi-taxa-integrador.test.ts` (7, com respostas reais aparadas em `__fixtures__/`) + 2 casos na
rota (`lifi-upstream-01.test.ts`: sem alerta falso e receita registrada; gêmea: LI.FI sem a nossa taxa →
alerta dispara). Em `00c9eec` o caso da rota falha (alerta falso reproduzido). 3 quebras deliberadas
detectadas. Gates no SHA exato `2b8118d` (tree `51373b64376f9d52f2e905987260c279108d2164`): `npm ci` 0 · lint
0/145 · type-check 0 · suítes 19/229 · suíte 329/4785 ×2 · build 0 · audit-gate OK · CI 38825991656 · preview
`dpl_4LQyCmZ7rdyaSLqwHenMpwVtDtfV`: sem `LIFI_INTEGRATOR` igual à produção (LI.FI cotando, taxa 0%, lista não
executável), smoke 25/25.

**Ativação (dono):** `LIFI_INTEGRATOR=zswap` e `LIFI_API_KEY` (sensível) em Production+Preview na Vercel +
redeploy; depois, conferência em produção só de cotação. Rollback da ativação: apagar `LIFI_INTEGRATOR` e
redeploy. Resultado do deploy: registrado no commit seguinte.

Resultado do deploy (15/10): `main` → `1611042` (fast-forward, CI verde); produção `dpl_2FBAU1EQesKUDhwzZHVRkEFJUw3z`
READY nesse SHA (código `2b8118d`). Sem `LIFI_INTEGRATOR` ainda: LI.FI cotando com taxa 0% e lista não executável;
smoke 25/25; runtime errors: nenhum. Rollback: `dpl_DCsP5Gbz6kyu9Y1RubfoZ3t9ZN3D` (`a19d2c1`).

## L-060 — Ativação da taxa LI.FI concluída; configuração errada não derruba mais o cross-chain (16/10/2026)

**Ativação (dono, 16/10).** `LIFI_INTEGRATOR` e `LIFI_API_KEY` definidos na Vercel. Duas tentativas derrubaram TODA
cotação LI.FI em produção (cross-chain fora do ar por minutos, cada vez), diagnosticadas pelo log de produção:
1. key/secret colados como valor de `LIFI_INTEGRATOR` → 400/1011 *"/integrator must be an alphanumeric string
   (additionally "-", "_", and "." are allowed) with a maximum length of 23 characters"*;
2. a MÁSCARA da key do painel (a key completa só aparece na criação) colada em `LIFI_API_KEY` → 401/1010
   *"Invalid API key"*. Contornado apagando a key (é opcional) e depois corrigido com a key salva na criação.
Produção final (16/10 01:31 UTC, só cotação): ETH→Arbitrum, ETH→Optimism e USDC Ethereum→Base com lista não
executável e cotação firme; "LIFI Fixed Fee" 0,0125 (1% Z-SWAP + 0,25% LI.FI); taxa divulgada 100 bps; smoke
25/25; sem avisos/erros no log. **O cross-chain saindo de EVM cobra a taxa do plano desde então.** Evidência:
`lifi-upstream-01-20261015/activation-20261016/`.

**Proteção (`12b898f`).** `lerIntegradorLiFi`: remove aspas nas pontas e prefixo `LIFI_INTEGRATOR=` colado;
exige a regra do LI.FI; inválido → sem taxa LI.FI, cotação segue, alerta com tamanho/classes de caractere e
NUNCA o valor. `fetchLiFiQuote`: 401 com key → refaz uma vez SEM a key (opcional) e avisa. Alertas Telegram com
dedup (`lifi:integrator-invalido`, `lifi:key-recusada`). Prova: 9 casos novos em `lifi-upstream-01.test.ts`;
em `7072e60` 7 falham (os dois incidentes reproduzidos); 4 quebras deliberadas detectadas. Gates no SHA exato
`12b898f` (tree `727d8a1f9bafaeee3786db46d81d0efb975b8e6b`): `npm ci` 0 · lint 0/145 · type-check 0 · suíte
329/4794 ×2 · build 0 · audit-gate OK · CI 38875298148 · preview `dpl_4SMypHFBeLHB6j6NUBzMNBhSjndW` smoke 25/25,
LI.FI cotando (o preview mostrou taxa 0%: `LIFI_INTEGRATOR` aparentemente não definido em **Preview** — sem
aviso de valor inválido no log; a regra validada é a mesma que o LI.FI já aceita em produção).

**Pendências do dono:** definir `LIFI_INTEGRATOR` também em Preview, se quiser o preview igual à produção;
apagar no painel do LI.FI a key cujo valor completo ninguém tem. Resultado do deploy: no commit seguinte.

Resultado do deploy (16/10): `main` → `f64c5e2` (fast-forward, CI verde); produção `dpl_ymHCBMGg64jZTmtWncqjuxVZ6qL1`
READY (código `12b898f`). Só cotação: LI.FI segue cobrando 1% nas três rotas ("LIFI Fixed Fee" 0,0125, taxa divulgada
100 bps), lista não executável, smoke 25/25, sem avisos/erros no log. Rollback: `dpl_Fk4xVsGwszBgWz17iRjyEBVUzev8`.

## L-061 — Taxa da plataforma na Solana (16/10/2026)

**Decisão do dono (16/10), revertendo a de 11/08:** cobrar na Solana com a mesma escada das EVM (1% · 0,50% ·
0,25% · 0,10%), recebendo por rede na carteira `H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T`, taxa em USDC e SOL;
ficar na Jupiter Metis (Swap V2 é rodada futura); chave da Jupiter pendente do dono. Plano:
`docs/PLANO-TAXA-SOLANA.md` (motivos de 11/08 revistos com cotação real: piso de 50 bps e gás patrocinado não se
aplicam à Metis; 20% não documentado; API sem chave continua).

**Contas de taxa (conferidas na rede 16/10):** USDC `En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo` e wSOL
`7PPDQWck54V79XwgThz9hcPJQTwWbRT8aP4TV9iT5qFW`, ambas da dona `H7zw…`, inicializadas. ⚠️ Não podem ser fechadas
("recuperar aluguel"): o código detecta e desliga a taxa (o swap segue) com alerta.

**Código (`5f42b44`):** `lib/solana/conta-de-taxa.ts` (conta por par + conferência na rede com cache);
`platformFeeBps` + `feeAccount` sempre juntos na Jupiter; taxa divulgada por par; LI.FI saindo da Solana com o
integrator; ZION, painel de receita, fonte de verdade pública e o FAQ do Founders ("solana-other-fees" dizia que
não havia fee na Solana — reescrito em en/pt/es/zh). Testes: `taxa-solana.test.ts` (14; em `166fd5b` 10 falham);
travas antigas da decisão de 11/08 reescritas; 4 quebras deliberadas detectadas. Gates no SHA exato `5f42b44`
(tree `900a62f201a8e83b163435df950976108452d2b4`): `npm ci` 0 · lint 0/145 · type-check 0 · suíte 330/4806 ×2 ·
build 0 · audit-gate OK · CI 38893612041 · preview `dpl_5CSfJRnf6kQ5FJzUWbzgUJgka5B9` (só cotação, nada assinado):
SOL→USDC e SOL→JUP com `platformFee` 100 bps e transação montada; JUP→WIF sem taxa; lista não executável; FAQ do
Founders novo; smoke 25/25.

**Observações:** cotação firme JUP→WIF dá `upstream_failed` também na produção anterior (pré-existente, fora do
escopo). Em SOL→JUP a cotação mostra a taxa calculada sobre o JUP recebido com `feeAccount` wSOL — Jupiter aceitou
e montou a transação; conferir no primeiro recebimento real em SOL. Pendências: site institucional ("No Solana
platform fee" nas docs), chave da Jupiter. Resultado do deploy: no commit seguinte.

Resultado do deploy (16/10): `main` → `0f64e3a` (fast-forward, CI verde); produção `dpl_6bYoZFKmpjVhdxK6xzdTf9aKFCCE`
READY (código `5f42b44`). Só cotação: SOL→USDC e USDC→SOL com `platformFee` 100 bps, transação montada e taxa
divulgada 1%; JUP→WIF sem taxa; LI.FI EVM segue 1%; lista não executável; FAQ do Founders novo; smoke 25/25.
⚠️ **Jupiter 429 "Too many requests"** em rajadas (`lite-api` sem chave) — derrubou cotações firmes SOL→JUP e
JUP→WIF no smoke, na produção nova, na anterior e no preview; repetida, SOL→JUP volta ok com 1%. É o motivo 4 de
11/08 na prática: **a chave da Jupiter passa a ser prioridade** (usuário real em pico pode pegar o limite).
Rollback: `dpl_ApxmhgHQEzo2NHQmdHGjFjaBBA3A` (`166fd5b`).

## L-062A — Chave da Jupiter ativada no código (16/10/2026)

**Contexto:** 429 em rajadas na `lite-api` sem chave (L-061). O dono criou a chave em portal.jup.ag e cadastrou
`JUPITER_API_KEY` na Vercel (Production + Preview) em 16/10; o segredo vive só na Vercel, o código nunca o contém.
Docs Jupiter (16/10): `api.jup.ag` + `x-api-key` em todos os planos (Free = 1 req/s; sem chave = 0,5 req/s) —
`api.jup.ag` é o endpoint autenticado, **não** "nível pago" (comentário antigo corrigido). Plano:
`docs/PLANO-JUPITER-CHAVE.md`. Swap V2 continua fora.

**Código (`d799d9c` + `37666e9`, branch `feat/jupiter-api-key`):** `configJupiter()` — com chave, sempre
`https://api.jup.ag/swap/v1` + `x-api-key`; `JUPITER_BASE_URL` só vale em `https://api.jup.ag`, outro host é
ignorado (a chave nunca sai para ele) + alerta `jupiter:config`; sem chave, `lite-api` (base `api.jup.ag` sem chave é
ignorada). `jupFetch()` aplica os headers comuns sem sobrescrever os da chamada. 401/403 → refaz uma vez sem a chave
+ alerta `jupiter:chave-recusada`. Produção sem chave → alerta `jupiter:sem-chave` (o swap segue).
`JupiterError {tipo: limite|chave|http|conexao, modo}`, logs `[jupiter] {modo,tipo,status,host}` também no sucesso;
a chave é censurada até do corpo de erro da Jupiter. Sonda de saúde com a mesma base/chave. Taxa Solana
(`platformFeeBps`/`feeAccount`, escada, contas, fail-open) intocada.

**Testes:** `src/lib/api/jupiter-chave.test.ts` (27) + `src/app/api/quote/jupiter-chave.test.ts` (10, rota real:
escada 100/50/25/10 em `api.jup.ag` com `feeAccount`, conta inválida fail-open, alertas sem segredo). No código
anterior 27 dos 35 testes de então falham. 5 quebras deliberadas detectadas (sem header, headers sobrescritos, sem censura, chave
para host do override, sem retry 401/403). Gates no SHA exato `37666e9` (tree
`edd57e1ed27097ca4bf07c49e1b69a579063482e`): `npm ci` 0 · lint 0/145 · type-check 0 · suíte 332/4843 ×2 · build 0 ·
audit-gate OK (R-03) · 0 ocorrência de host/chave Jupiter no bundle do navegador · CI 38932931702 success.
Intermitente fora do escopo: `cex/order/a131-livro-unico.test.ts` ("DÚVIDA não devolve") falhou 1 vez numa suíte
pré-commit e 1 em 9 execuções isoladas; não importa Jupiter.

**Preview `dpl_42NsuWMM4skUAjXpBHcta6XwiCRi` (só cotação, nada assinado, 6 requisições espaçadas):** todas HTTP 200;
SOL→USDC, USDC→SOL e SOL→JUP firmes com `platformFee.feeBps` 100 e transação montada; JUP→WIF firme sem taxa e
transação montada (antes dava 429); listas com taxa 100. Logs: 10 chamadas `[jupiter] modo autenticada, ok, 200,
api.jup.ag`; **0 × 401/403/429**. 10/25/50 bps: só pela suíte (o preview sem sessão é plano free).

**Produção: NÃO feita** — aguarda autorização explícita do dono. Sem evidência de produção nesta entrada.

Resultado do deploy (16/10, autorizado pelo dono: "AUTORIZO PRODUÇÃO DA L-062A"): RC `a738e7c` (docs-only; delta
`06bff5c..a738e7c` = só os 11 arquivos da L-062A), CI 38939893760 success, `main` `06bff5c` → `a738e7c` por
fast-forward (sem force). Produção `dpl_3VqE1Ex1RGta87E7gVHUffX1kT82` READY (alias `swap-z-app.vercel.app`).
Smoke só-cotação 17:31:49–17:32:12Z (nada assinado): 7/7 HTTP 200; SOL→USDC e USDC→SOL firmes com
`platformFee.feeBps` 100 + transação montada, taxa divulgada 100; SOL→JUP 100 bps; JUP→WIF sem taxa com transação
(antes 429); listas sem payload executável; LI.FI EVM 100. Logs do deployment: 12 × `[jupiter] {"modo":"autenticada",
"tipo":"ok","status":200,"host":"api.jup.ag"}` (10 do smoke + 2 externas); **0 × 401/403/429**, 0 `lite-api`, 0 linhas
warning/error (nenhum alerta `jupiter:*` nem `taxa-solana`). Segredo: 38 chunks do navegador sem `JUPITER_API_KEY`,
`x-api-key`, `api.jup.ag` ou `lite-api`; 0 source map servido (0/38 `.map` 200); respostas da API sem esses termos; o
código só loga modo/tipo/status/host (valor da chave nunca lido nesta rodada). Smoke de rotas 25/25. Rollback:
`06bff5c` (deploy anterior de produção).

## L-062B — Jupiter Swap V2, caminho Router `/build` (16/10/2026)

**Decisão do dono (16/10):** Router `/build` em vez do Meta-Aggregator `/order` — no `/build` a Jupiter não cobra
nada e a taxa continua `platformFeeBps` + `feeAccount` (escada 100/50/25/10 inteira, 100% nossa); no `/order` a taxa
de integrador tem mínimo de 50 bps, a Jupiter fica com 20% e cobra a própria do usuário. Plano:
`docs/PLANO-JUPITER-SWAP-V2.md`.

**Medido na API real (sem chave, só cotação):** `/build` exige `taker`; não devolve `platformFee` — com taxa, o
`feeAccount` aparece nas contas da `swapInstruction`; programas = os da allowlist do guard. Prova real: `/build` →
transação montada por este código → `simulateTransaction` na mainnet (taker `H7zw…`, nada assinado): SOL→USDC 10 bps
(conta USDC) e SOL→JUP 25 bps (conta wSOL) **sem erro**, guard aprova.

**Código (`6722b5c`, branch `feat/jupiter-swap-v2`):** `lib/api/jupiter.ts` — `GET /swap/v2/build` (uma chamada
por cotação; o firme era `/quote` + `/swap`); transação v0 montada no servidor (ALTs e blockhash da resposta, pagador =
taker, limite de CU = simulação sem assinatura × 1,2, teto 1,4 M; simulação falhou → teto + log; preço de CU com teto
1.000.000 µlamports); taxa só confirmada com o `feeAccount` na instrução (senão "TAXA NÃO RETIDA" + taxa divulgada 0);
sem chave = `api.jup.ag` sem header (a `lite-api` saiu); lista sem carteira cota com a carteira de taxa como taker.
Contrato com o navegador inalterado (`ExecuteSwap` e guard intocados). Sonda de saúde e sonda do guard no `/build`.
RPC do servidor compartilhado em `lib/solana/rpc-servidor.ts`. Escada, contas de taxa, LI.FI, EVM: intocados.

**Testes:** `src/lib/api/jupiter-chave.test.ts` (39, com a resposta real `__fixtures__/jupiter-build-20261016.json`),
`src/app/api/quote/jupiter-chave.test.ts` (15, rota real), A33/taxa-solana/taxa adaptados. No código anterior 49 de 74
falham. 6 quebras deliberadas detectadas (taxa sempre "confirmada", CU sem simulação, `feeAccount` fora do `/build`,
preço sem teto, rota divulgando taxa sem confirmação, ordem das instruções — esta só depois de um teste novo de ordem).
Gates no SHA exato `6722b5c` (tree `06e739c444e9cd053fbdb28a1c2bdc2682dae7db`): `npm ci` 0 · lint 0/145 · type-check 0 ·
suíte 332/4860 ×2 · build 0 · audit-gate OK (R-03) · 0 host/chave Jupiter no bundle do navegador · CI 38952568486.

**Preview `dpl_Dp1VzZxEUhyTHVghX6iXgqpFDnyo` (só cotação, nada assinado):** 6/6 HTTP 200; SOL→USDC e USDC→SOL firmes
com taxa 100 confirmada na conta USDC, SOL→JUP na conta wSOL, transação v0 com limite de CU da simulação (88 k–327 k);
JUP→WIF sem taxa com transação; lista com e sem carteira, sem payload executável. Logs: 6 × `[jupiter] autenticada ok
200 api.jup.ag` (1 por requisição); 0 × 401/403/429; 0 simulação no teto.

**Produção: NÃO feita** — aguarda autorização explícita do dono.

Produção de `a675ddb` (16/10, autorizada pelo dono): `main` `2a06326` → `a675ddb` (fast-forward), CI 38970070855,
`dpl_HcK5h3H8LYxgd6qqamhsXvFMrUoZ` READY. Smoke: 7/7 HTTP 200, taxa 100 confirmada na instrução, `[jupiter]
autenticada` 0 × 401/403/429 — **mas** a firme JUP→WIF (rota de 5 trechos) saiu com **65 contas** (limite 64):
simulação `TooManyAccountLocks`. Causa: na v1 a Jupiter montava a transação dentro do limite; no `/build` é nosso e
não estava implementado. Impacto: só rotas longas, recusadas no preflight da carteira (`skipPreflight: false`), sem
perda de fundos. **STOP** + **rollback** autorizado pelo dono: `dpl_AcHcoSLXYEeWB1qvMQE9NXqpimrn` (`2a06326`, v1
autenticada) promovido de volta, conferido por cotação real (formato v1, 100 bps).

**Correção C1b `d86c963`:** a transação montada é medida antes de simular/devolver (contas estáticas + via ALT ≤ 64,
≤ 1232 bytes; estouro de serialização conta como "não cabe"); não coube → refaz UMA vez com `maxAccounts=40` (taxa
preservada); ainda não coube → 502, nunca transação inválida. 6 testes novos (inclusive o caso da produção); 4 quebras
deliberadas detectadas. Prova real na mainnet (sem chave, nada assinado): 5 rotas de até 5 trechos com 40–55 contas e
918–1210 bytes, simulação sem erro. Recert no SHA exato `d86c963` (tree `3fbf5d6436a41f4eb54119d1b09345fcd898abec`):
`npm ci` 0 · lint 0/145 · type-check 0 · suíte 332/4866 ×2 · build 0 · audit-gate OK · 0 chave no bundle · CI
38976037886. Preview `dpl_Ef1BQyPLcNKA81ydYCn31WLNRHAi` (só cotação): 9/9 HTTP 200, firmes v0 com 19–55 contas e
593–1229 bytes, taxa confirmada (USDC/wSOL); **a nova tentativa disparou de verdade** (JUP→BONK: 56 contas/1281 bytes
→ refeita, 1212 bytes, 200); 10 × `[jupiter] autenticada ok`, 0 × 401/403/429. Produção da correção: aguarda o dono
(depois do rollback a Vercel não promove a `main` sozinha — exige promoção explícita).

Produção da correção (16/10, autorizada pelo dono: "sim autorizo produção"): RC `fd4172f` (docs-only), CI
38977110571, `main` `a675ddb` → `fd4172f` (fast-forward); `dpl_HcXiT1J7SwzXYNS87oRgq33UQeRc` READY e **promovido
explicitamente** (a Vercel estava em rollback). Smoke só-cotação 22:45:29–22:46:08Z, nada assinado: 10/10 HTTP 200;
SOL→USDC e USDC→SOL firmes com taxa 100 confirmada na conta USDC, SOL→JUP na wSOL; 7 firmes v0 com 29–55 contas e
706–1173 bytes, CU sempre da simulação; rotas de 5 trechos (JUP→BONK, WIF→BONK, JUP→WIF grande) OK; listas sem
payload executável; LI.FI EVM 100. **A nova tentativa disparou em produção** (SOL→JUP: 1233 bytes → refeita, 1173,
200). Logs: 13 × `[jupiter] autenticada ok 200 api.jup.ag`, 1 `tx-grande`, 0 × 401/403/429, 0 erro. Segredo: 0 termos
nas respostas, 38 chunks do navegador sem chave/host Jupiter, 0 source map. Smoke de rotas 25/25. Rollback:
`dpl_AcHcoSLXYEeWB1qvMQE9NXqpimrn` (`2a06326`). **Pendente:** primeiro swap real assinado (sugerido: o dono, valor
pequeno, conferindo a taxa na conta).

## L-063 — W1: carteiras, saldos e mobile (20/10/2026)

**Incidente (dono, Android + Phantom):** `Balance: —` no Swap e duas leituras indisponíveis no Portfólio com a carteira
conectada (Phantom: ≈0,263 SOL / ≈11,501 USDC); sem como adicionar a 2ª carteira no celular. Sem perda de fundos.

**Causa raiz comprovada:** o navegador lia saldo no RPC público (`NEXT_PUBLIC_SOLANA_RPC` não existe → `clusterApiUrl`),
que responde **403 a toda requisição com `Origin`** (medido: sem `Origin` 200; com `Origin` de qualquer site 403;
User-Agent/Referer irrelevantes; CORS 200). O erro ainda era modelado como `isZero: true`. Botão "+" era
`hidden sm:inline-flex`. Valores reais conferidos pelo servidor: `H7zw…` 0,25190507 SOL e 11,501 USDC.

**Código (`de77dae` + `70ba76a`, branch `fix/w1-carteiras-saldos`):** `/api/solana/saldo` (leitura restrita no RPC do
servidor; só `getBalance`/`getTokenAccountsByOwner` por mint; validação, rate limit por IP + global, timeout, cache 10 s
+ dedup; erro tipado, nunca 0; u64 exato); `useTokenBalance` com TanStack (chave dono+mint compartilhada; 6 estados;
resposta de outro dono descartada; retry só transitório; relê ao reconectar/voltar/confirmar swap; sem polling); Swap
"indisponível · Tentar de novo"/"desatualizado", MAX só com saldo lido; Portfólio/ZION tratam erro como indisponível;
chip Solana na mesma leitura; "+" visível no celular; menus "Phantom · Solana"/"· EVM". 1 efeito de UI no `ExecuteSwap`
(invalida saldos em `tx_confirmed`) — envio/confirmação intocados. Plano: `docs/PLANO-W1-CARTEIRAS-SALDOS.md`.

**Testes:** 3 arquivos novos (56 testes) + A32 adaptado; no código de produção os 3 falham; 7 quebras deliberadas
detectadas. Gates no SHA exato `70ba76a` (tree `955a37a9cb82abd025685f24af57262ebf162387`): `npm ci` 0 · lint 0/144 ·
type-check 0 · suíte 335/4922 ×2 · build 0 · 0 credencial no bundle · **audit-gate R-03 FALHOU** (alertas novos de
terceiros publicados em 19–20/10: `follow-redirects` 1.16.0 via `wagmi→@wagmi/connectors→@base-org/account→
@coinbase/cdp-sdk→axios`, e `vite` ≤8.1.5; lockfile idêntico ao da `main` — a `main` falha igual no próximo CI). CI
39502270015: lint/type-check/testes OK, falha só no passo do audit.

**Preview `swap-z-o4xy0g5z2-…` (só leitura, nada assinado):** 7/7 saldos iguais à rede; QA headless 360/1440 com Phantom
simulada só-conexão: PASS (ver evidência). **Não feito:** Android/Phantom real (roteiro manual no plano).

**⚠️ W3 (achado, não corrigido):** `ExecuteSwap` envia e confirma pela conexão do navegador no RPC público → 403;
swap Solana fora do Jito provavelmente falha no envio hoje (sem perda de fundos). **W2:** descoberta de todos os tokens.
Produção: não autorizada. Rollback: produção segue em `986ae75`.

## L-064 — W3: transmissão/confirmação Solana e histórico de tentativas (21/10/2026)

**Incidente:** no preview W1 o dono assinou SOL→USDC na Phantom e recebeu "403 Access forbidden"; sem registro na Phantom
nem na Z-SWAP. **Causa raiz comprovada:** o envio (`sendRawTransaction`) ia pelo RPC público a partir do navegador, que
recusa com 403 na porta toda requisição com `Origin`, antes de ler o corpo. **Etapa: envio, após a assinatura.** Jito
desligado por padrão. **Não transmitida** (`H7zw…` sem transação desde 16/10). Histórico só era gravado após envio OK.

**Código (`9934d11` + `4f002ae`, branch `fix/w3-transmissao-solana`, base W1 `f5319e9`):** `POST /api/solana/transmitir`
(só transação v0 já assinada pela carteira, ≤1232 B, ed25519 conferida, pagador = carteira, Jupiter v6, programas
permitidos; envio único com preflight no RPC do servidor; `enviada`/`nao_enviada`/`incerta` + assinatura pública);
`GET /api/solana/status` (confirmada só com `err` nulo, falhou_na_rede, pendente, expirada); `lib/solana/executar-swap.ts`
(tentativa registrada antes da assinatura; etapas; anti-duplicação; Jito com fallback da MESMA transação); histórico com
etapas, carteira e validade, "Falha no envio" ≠ "Falhou na blockchain", reconciliação ao abrir o app; sync de operações só
`confirmed` e da carteira certa. Não-custodial: servidor sem chave, transmite os mesmos bytes. Plano:
`docs/PLANO-W3-TRANSMISSAO-SOLANA.md`.

**Evidência:** 7 quebras deliberadas detectadas; gates `4f002ae`: lint 0/144, tipos, suíte 337/4977 ×2, build, 0 credencial
no bundle, **audit-gate FALHOU** (herdado). CI 39523037030 (só o audit falha). Preview `swap-z-dklwck7rb`: status real
(confirmada/expirada/pendente/400) e E2E com carteira de teste sem fundos 10/10 (servidor chega ao RPC sem 403, preflight
recusa, "Falha no envio", histórico com assinatura pública). **Falta:** swap real com fundos (autorização específica).
Produção: não autorizada; segue em `986ae75`.

**Revisão independente (ChatGPT, 21/10) — não autorizou o teste com fundos; correções em `5db2564`:** status on-chain estrito
(`confirmada` só com `err === null` explícito; estrutura conferida); "não transmitida" só com recusa estruturada
`fase: antes_do_rpc` (gateway 502/503/504/429 → incerta); identidade de ORIGEM nos registros, sync só com a carteira de
origem conectada, servidor recusa origem ≠ sessão (409) e grava sem atribuição o que não tem origem (CEX/Autopilot/legado
ficam sem atribuição — totais intactos); vínculo HMAC cotação↔transação (hash da mensagem montada pelo servidor + pagador +
taxa decidida + validade 3 min) exigido na transmissão; anti-duplicação documentada como LOCAL (testes fixam o limite;
trava no servidor proposta, não implementada). No código `80e4647`: 16 testes da revisão falham; 6 quebras deliberadas
detectadas. Gates `5db2564` (tree `efb3d3a4a0aaf02d89b036c68a2efdd167abf855`): lint 0/144 · tipos · suíte 338/5009 ×2 ·
build · 0 credencial no bundle · audit-gate FALHOU (herdado; rodada de dependências separada). CI 39528609610 (só o
audit falha). Preview `swap-z-mpg00px97` (sem fundos): vínculo ao vivo — legítima chega ao RPC (preflight
`AccountNotFound`), adulterada+re-assinada/sem vínculo/forjada recusadas antes do RPC; status real confirmada/expirada/
pendente/400; E2E pela tela 10/10. **Parado para a 2ª auditoria; nenhum swap com fundos.**

**2ª auditoria independente (21/10) — NO-GO; correções em `f83e12a`:**
- **W3-A (bloqueador)**: reproduzido no código `5db2564` (sessão de A Pilot + taker B → B pagava 10 bps; 5 de 8 testes
  falham). Corrigido: plano da sessão só quando a sessão É o pagador (`mesmaCarteira`); senão Free. Jupiter, 0x e LI.FI.
  Efeito: plano numa carteira não vale para outra até ela se autenticar (sem vínculo entre carteiras).
- **W3-B (bloqueador)**: `NEXT_PUBLIC_SOLANA_JITO` medido como **"on" em Preview e Production** nos bundles servidos (ramo
  "desligado" eliminado na compilação; sem decriptar nada) — em produção `986ae75`, swaps com exposição ≥ $25 tentam o
  Jito direto do navegador, fora do vínculo. Corrigido: um único caminho de envio (servidor + vínculo); Jito fora do fluxo
  e do bundle (0 ocorrências de `block-engine`); testes travam caminho alternativo. Recomendado ao dono: variável `off`.
- **W3-C**: duplicação entre dois navegadores reproduzida no preview (duas assinaturas, ambas levadas ao RPC). Trava
  durável desenhada (`docs/PROPOSTA-W3-TRAVA-E-RECONCILIACAO.md`), migration NÃO aplicada.
- **W3-D**: livro aceita conteúdo financeiro declarado; o painel separa por atribuição, não por verificação on-chain.
  Reconciliação por assinatura e classes de verificação propostas, NÃO aplicadas.
- 3 quebras deliberadas (após corrigir 2 furos dos próprios testes: caixa EVM e removedor de comentários). Gates
  `f83e12a` (tree `765cb4d9e9313b1c84710ab466fb28862c67b55b`): lockfile intocado · lint 0/144 · tipos · suíte 339/5019 ×2
  · build · 0 credencial · **audit-gate FALHOU** (follow-redirects, vite — rodada de dependências). CI 39583483966 (só
  audit falha). Preview `swap-z-2v9nd3li3` (sem fundos): status real, vínculo/adulteração, E2E 10/10, Jito ausente do
  bundle. **Parado após o Preview; nenhum swap com fundos; W4 não iniciada.**

## L-065 — Recuperação integrada: W1 + W3 + W3-C + W3-D + W4 + dependências (21/10/2026)

**Decisão do dono (missão mestre, 21/10):** concluir a recuperação técnica e publicar em produção para testes reais
controlados (homologação privada, sem lançamento público). Operação financeira só com assinatura do dono na carteira dele.

**Código** (branch `recuperacao/integrada-20261021`, base `fix/w3-transmissao-solana`):
- **Dependências** `04ef49b`: `follow-redirects` 1.16.1 e `vite` 8.1.6 (override na linha 8.1.x) — audit-gate OK sem
  exceção nova (a R-03 de `braces` segue como estava).
- **W3-C** `9ddc3e0`: trava DURÁVEL por carteira no servidor (migration 0077, `solana_tx_em_voo`, advisory lock + índice
  único parcial, RPCs fechadas ao service_role). Sem TTL: só fato on-chain, altura de bloco > `lastValidBlockHeight`
  (gravado do vínculo HMAC, nunca do navegador) ou recusa certa antes da rede encerram a tentativa. Banco fora → 503
  antes do RPC. Reserva só depois da assinatura ed25519 e do vínculo conferidos (terceiro não trava carteira alheia).
- **W3-D** `e8601fa`: livro verificável (migration 0078, colunas aditivas em `operations`; histórico todo `declarada`).
  Reconciliação pela assinatura pública: `err` nulo, Jupiter v6, pagador = carteira de origem, taxa MEDIDA na conta de
  taxa. Duas dimensões separadas (financeiro × identidade). Receita do painel: "verificado na rede" × "declarado".
  `/api/operations/reconciliar` (CRON_SECRET) repete o que ficar `aguardando` — **agendar no cron-job.org é passo do dono**.
  ⚠️ Pagador = dono das contas de taxa (`H7zw…`, a carteira do dono): receita 0 por construção (o delta inclui o swap).
- **W4** `1b9055b`/`b61283d`: Phantom Android — o deeplink `browse` (formato oficial `phantom.com/ul/browse`) leva um
  marcador e a página pede a conexão ao abrir dentro da Phantom; o Mobile Wallet Adapter oficial vem primeiro no Chrome
  Android. Reconexão automática e "manter sessão" opcionais, desligados por padrão (sessão curta: cookie de navegador +
  JWT 12 h). Sessão da carteira A é encerrada se a carteira conectada da mesma rede vira B. Configurações: 8 interruptores
  fictícios (callbacks vazios, inclusive afirmações de segurança falsas) e a aba de RPC nunca usada foram removidos.

**Evidência local:** suíte 341/5059 · tipos · lint 0 erros · build · audit-gate OK · SQL T24/T24b/T25 + regressão de ACL
02/14/17 em Postgres 17.6.1.127 descartável (cadeia 0001→0078, reaplicação idempotente) · E2E W4 12/12 · 0 Jito e 0
credencial no bundle. Fee accounts (`En1J8…`, `7PPDQ…`): 1 transação cada (criação, 16/10) — nenhum swap com taxa pousou.

## PHANTOM-LIGHTHOUSE-20261021 — correção restrita
CURRENT_DEVELOPMENT. PHASE_BASE_SHA=bc6f67acbe6f3f0391ea998cb9a645a15fa7659b.
Missão do dono de21/10: compatibilidade Phantom/Lighthouse preservando W3/W3-C/W3-D/W4. Branch codex/phantom-lighthouse-20261021 isolada; plano PLANO-PHANTOM-LIGHTHOUSE-20261021.md. PR/CI/Preview autorizados; produção depende de aprovação final. Nenhum fundo movimentado.

## PHANTOM-LIGHTHOUSE-V2-20261024 — formato real da Phantom (24/10/2026)
CURRENT_DEVELOPMENT. PHASE_BASE_SHA=cc79fc7886c2918a3cba2a44960cc67727365bfe (tree 8972c2b34b943ca0fe7ba6c25341a4acb25d4f63).
Pedido do dono (24/10): "o swap continua falhando… quero que resolva". Push do branch autorizado pelo dono nesta conversa
(`claude/swap-z-recovery-deploy-b7y2cw` → `cc79fc7`, force-with-lease sobre `d7741bb`, preservado em `platform-closure`).
Deploy NÃO autorizado ainda. Plano: `docs/PLANO-PHANTOM-LIGHTHOUSE-V2-20261024.md`.

**Evidência de produção (logs Vercel, só leitura):** `dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR` (código `cc79fc7`) →
`{"recusada":"lighthouse_instrucao_nao_permitida"}` 21/10 23:48:06 UTC; antes, em `bc6f67a`,
`programa_nao_permitido:L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95`. Banco de produção NÃO consultado nesta fase.

**Evidência externa (fontes públicas, lidas; nenhum código de terceiros executado no repo):** Lighthouse upstream `Jac0xb/lighthouse@4c579479`
(= v2.0.0; instruction.rs:16-94, types/assert/*, log_level.rs; borsh =0.10.3); SDK `lighthouse-sdk@2.1.0` e
`lighthouse-sdk-legacy@2.0.1` (codecs conferidos); instrução Phantom real de mainnet
`06040203000001000000000000000000` (McRitchie-Studio/turf-monster@9eff39c
test/integration/lighthouse_cosign_guard_lifecycle_test.rb:22-25) = AssertAccountInfoMulti, log 4, [KnownOwner System,
DataLength 0]; relatos de prefixos 06 04/06 05 e de AssertTokenAccountMulti (ssadkov/yield-ai-os-sol@323d549 docs:172-240;
cowprotocol/services@7732573 tests/api.rs:968-990; x402-foundation/x402@4241d56 constants.ts:10-17); doc oficial de
priority fee da Phantom (phantom/docs@6e53c267 solana-priority-fees.md:45-53). Causa: o parser do #449 recusa log level 4
e a variante KnownOwner (lighthouse.ts:22 e :33 em `cc79fc7`).

**Auditoria adversarial independente (24/10, workflow `wf_b5b701a5-7cb`, 14 agentes; o crítico de completude caiu por
limite de sessão e é refeito na rodada de verificação das correções):** especificação — 0 divergências contra o upstream
(101.418 casos válidos, 6.349.731 mutações de byte, 300 mil corpos aleatórios; ida e volta pelos codecs do
`lighthouse-sdk@2.1.0`, executado só numa cópia isolada fora do repo); segurança — 120.000 mensagens mutadas e assinadas
de verdade, 0 aceitas mexendo em taxa/rota/valor/destino/privilégio/assinante/pagador/blockhash/preço do compute;
compatibilidade — nenhuma forma documentada da Phantom recusada na resposta REAL do `/build` (3 ALTs). 5 achados
baixos sobreviveram aos céticos e foram corrigidos (plano, itens 5–9): uma cotação, um swap (`em-voo.ts`, 409
`cotacao_ja_enviada`); duplo toque e cotação Jupiter > 30 s renovada (`ExecuteSwap.tsx`, i18n 4 locales); folga para a
carteira no montador (`jupiter.ts`); testes de `original_faltando`/`chave_duplicada`/`alt_leitura_sumiu`/`contas_demais`
e de segredos ausentes nos logs. Achado à parte: a suíte completa precisa do histórico git (`regressao-qualidade.test.ts`
lê `0afa841`) — clone raso completado com `git fetch --unshallow` (só leitura).
**Segunda rodada (25/10, `wf_75fe6f03-adb`, auditoria das correções):** 11 achados baixos/informativos (parte dos
céticos caiu por limite de sessão; avaliados pela reprodução anexada), nenhum de transação maliciosa. Corrigidos (plano,
itens 10–15): texto próprio para `cotacao_ja_enviada`; erro em `processed` não é mais falha final; critério da cotação no
SQL; modal não fecha no meio da execução; nota de renovação só com a cotação nova; rota menor só com a mesma taxa, prazo
de 2,5 s, sem simulação desperdiçada e log do desfecho; testes reforçados (mutantes de taxa/mínimo/prazo e das regras
`original_faltando`/`chave_duplicada`/`alt_leitura_sumiu`/`contas_demais` mortos).
Validação pré-commit (25/10): `tsc` limpo · eslint 0 erros (2 avisos pré-existentes em `ExecuteSwap.tsx`) · suíte
completa 342 arquivos / 5186 testes passando.

**RECERT(C1) = FAIL — 25/10/2026.** `CANDIDATE_SHA=17f7eb3431b767fc2eb129139258eaecb80d41fe` (tree
`561e23574ba85d89e26365941810b3d584f198c2`), worktree limpo (`git status` vazio), Node 22.22.0 / npm 10.9.4. Evidência fora
do repo: `scratchpad/recert-17f7eb3-20261025T084623Z/` (sessão cloud efêmera), `MANIFEST.sha256` sha256
`21ad3d152f923f0b460bd5be41177b1b90bfa3d9e719844b3dcc91cde4c09e48`.
- PASS: `npm ci` · type-check · lint · suíte completa ×2 (342 arquivos / 5186 testes, nas duas) · testes Solana (242) ·
  `next build` · varredura de segredos do delta.
- **FAIL: portão `scripts/release/audit-gate.mjs`** — `npm audit`: critical=1 high=17. Alertas NOVOS publicados contra
  dependências que esta fase NÃO tocou (`package.json`/`package-lock.json` idênticos a `cc79fc7`, que é o código em
  produção): `next` 16.3.8 (faixa 16.0.0–16.4.0; correção sem quebra de major: 16.4.3) — GHSA-2464-fhr4-w9xw (crítico:
  RCE sem autenticação no Image Optimization com SVG), GHSA-673q-mjm6-r5xr (crítico: RCE em funções `use cache`),
  GHSA-p3m5-59mp-jv5r (alto: DoS com Server Actions); `zod` <4.6.6 (alto, GHSA-mrhx-c7xc-m3w5, transitivo, sem correção
  fora de major); e deriva da cadeia da exceção R-03 (pacotes que saíram/entraram). Exposição medida no código (não é
  prova de ausência): sem `images.dangerouslyAllowSVG`/`remotePatterns` em `next.config.mjs`, nenhum `"use cache"`,
  nenhum `"use server"` em `src/`.
- CI oficial no mesmo SHA (run 40178003000): 5186 testes passando, falha SÓ no mesmo portão. O CI de `cc79fc7` (run
  40083160256, 24/10) também está vermelho.
- Conforme §5.2: SEM atestação PASS, sem retry-to-pass, sem reclassificar. `RELEASE_CANDIDATE=NONE`. Próximo passo
  depende de decisão do dono (dependências / revisão da exceção R-03); qualquer correção vira C1b com recert completa.

**Decisões do dono (25/10, nesta conversa):** (1) "Corrigir dependências antes" do deploy; (2) "Aprovo a R-04". C1b
(sobre `6258d7a`): `next` 16.3.8 → 16.4.3 (exato), `eslint-config-next` e `@next/bundle-analyzer` → `^16.4.3` — lockfile
muda SÓ a família Next.js (13 entradas, todas 16.4.3; o campo `libc` que o npm 10.9 local apagava de 26 entradas de
plataforma foi restaurado na ordem original — revisão independente do C1b, `wf_170f8f74-950`); `npm audit` depois:
critical=0. Exceção do portão revista
(`scripts/release/audit-exceptions.json`, `docs/R03-AUDIT-EXCEPTION.md`): R-03 (braces) RETIRADA porque o npm deixou de
reportá-la (braces 3.0.3 segue instalado — não é correção; conteúdo congelado em
`src/lib/release/fixtures/audit-exceptions-r03-20261007.json`); R-04 TEMPORÁRIA só para `zod` GHSA-mrhx-c7xc-m3w5
(1243066, high, `<4.6.6`), cadeia exata de 17 pacotes, lock sha256 `75f6bd2ba0f2336054707a94b917f50e87a05d6af38eaf1e3c3402f86b2e9af8`. Portão com o lock novo: OK (aviso
EXCECAO_EM_USO). Testes do portão: R-03 provada contra a exceção congelada; R-04 contra o `npm audit --json` real do lock
(`fixtures/npm-audit-r04-20261025.json`), inclusive "o relatório do braces reprova contra a exceção viva" e "o next
16.3.8 crítico reprovaria". Validação local: `tsc` limpo · suíte 342 arquivos / 5191 testes · lint 0 erros (144 avisos) · `next build` OK.
Revisão independente do C1b (`wf_170f8f74-950`): sem defeito bloqueante; integridade das 13 entradas Next conferida no
registro; 4 achados leves corrigidos (campo `libc`, caminhos do zod no texto da R-04, contagem de testes).

**RECERT(C1b) = PASS — 25/10/2026 (atestação C2).**
`CERTIFIED_FEATURE_SHA=31920d73e93194113a68ac021bbd370b05621cee` (tree `e317825d6528c23144dd7e7314b4a55bde6957c4`) ·
`RECERT_RESULT=PASS` · `CONTROL_PLANE_HEAD=THIS_CONTROL_PLANE_COMMIT` (este commit, só `docs/**`; NÃO é CERTIFIED).
Worktree limpo no SHA exato (`git status` vazio), Node 22.22.0 / npm 10.9.4, 25/10 10:27 UTC. Evidência fora do repo:
`scratchpad/recert-31920d7-20261025T102726Z/` (sessão cloud efêmera; 14 arquivos), `MANIFEST.sha256` sha256
`33e1ad3df67cf8877a1c5f7a9c757def9a8fe5beda164c5f1161028fc8a243a9`.
- `npm ci` ✓ · type-check ✓ · lint 0 erros (144 avisos) ✓ · suíte completa ×2: 342 arquivos / 5191 testes nas duas ✓ ·
  Solana 242 ✓ · `next build` (Next.js 16.4.3) ✓ · portão `npm audit`: OK com a R-04 (critical=0; aviso EXCECAO_EM_USO) ✓ ·
  varredura de segredos do delta `cc79fc7..31920d7` ✓.
- CI oficial no SHA exato: run 40184848534 — **success**.
- Desvios declarados: arneses SQL não rodados (a fase não muda SQL; a consulta nova de `em-voo.ts` lê `solana_tx_em_voo`
  da 0077 com o grant de SELECT existente — provada com banco falso fiel à 0077, não contra PostgreSQL); smoke não feito
  (exige deploy/preview autorizado); migrations: nenhuma nova nesta fase.
- Prova da atestação: `git diff --stat 31920d7..HEAD -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'` vazio e
  `git merge-base --is-ancestor 31920d7 HEAD` → OK (conferido antes do push deste commit).
- `RELEASE_CANDIDATE=NONE` até a autorização escrita do dono para este SHA (RELEASE-CHAIN §3, item 7). Deploy é outra
  autorização (AI-OPERATING-RULES §6.1).

**RELEASE_CANDIDATE (25/10/2026):** autorização escrita do dono nesta conversa — "Autorizo produção (Recomendado)" — para
`CERTIFIED_FEATURE_SHA=31920d7` (atestação `4110720`). Marcado em `docs/RELEASE-CHAIN.md` (seção PHANTOM-LIGHTHOUSE-V2)
por um commit só de docs, filho de `4110720`. Plano do deploy: CI verde no commit do RC → `main` por fast-forward →
produção Vercel a partir do `main` → conferência do deploy e dos logs → swap pequeno do dono na Phantom. Rollback:
`dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR`.

**PRODUÇÃO (25/10/2026, autorizada pelo dono):** `main` `cc79fc7` → `0430644` por fast-forward depois de CI verde no commit
do RC (run 40185503840). Vercel `dpl_DTzQ9Xy56yZroT1N5XBR8WuW3cAJ` READY (target production, aliases
`swap-z-app.vercel.app`), código = `CERTIFIED_FEATURE_SHA` `31920d7`. Smoke só-cotação: `/api/quote` Solana 200 (Jupiter,
100 bps), home 200; runtime errors nenhum. `PRODUCTION=0430644`. Pendente: swap real do dono na Phantom (logs
`[sol-tx]` / `[sol-tx-lighthouse]` dirão a forma aceita ou a regra recusada). Rollback: `dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR`.
