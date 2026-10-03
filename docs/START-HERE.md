# START HERE — Z-SWAP

> **IF YOU ARE A HUMAN OR AI STARTING WORK ON Z-SWAP:
> READ THIS FILE FIRST.**
>
> **DO NOT infer current state from another PLANO/AUDITORIA file.**
> Planos antigos são histórico, mesmo quando dizem "status 🟢" ou "vivo".
> O estado atual é definido AQUI e em `docs/CURRENT-STATE.md`.

**Revisão 7 (03/10/2026, ledger L-026, achado EA2-IA10):** este arquivo foi
reescrito para descrever SÓ o estado atual nas seções operacionais (§1–§10).
Tudo o que valia antes da implementação da Fase 2 está no §11, marcado como
HISTÓRICO. Revisões 1–6 (01–02/10): ver §11 e o ledger L-011…L-019.

---

## 1. O que é o Z-SWAP?

Um agregador de DEX multi-chain (Solana + ~10 EVM) com assistente de trading
por IA (ZION), execução em corretora (autopilot e DCA) e um painel admin tipo
terminal. Stack: Next.js 16.3.6 · Supabase (Postgres) · Vercel. Mapa do código:
`CLAUDE.md`.

## 2. Bases fixas e estado do HEAD

**A base de produto é fixa; o HEAD não é um invariante** (commits de control
plane — `CLAUDE.md`, `AGENTS.md`, `docs/**` — o movem legitimamente).

| | |
|---|---|
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · tree `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` (Early Access Fase 1, último commit de produto) |
| PHASE_BASE_SHA (Fase 2) | `74f37f50d12dae698f14b620914bc0ce5b0c639a` · tree `5c93c0512b74777724aae62f665b10feaa95f760` (o C2 da Fase 1; registrado no ledger L-020 antes de qualquer código da Fase 2) |
| HEAD atual | = PHASE_BASE_SHA (nenhum commit da Fase 2 ainda) |
| EXPECTED_BRANCH | `early-access-phase2-email-double-optin-20261001` (só local, sem upstream) |
| WORKING TREE | **NÃO limpo, de propósito:** contém a implementação da Fase 2, fechada e não commitada (ledger L-025/L-026). Veja §10 para provar que o delta é exatamente o autorizado |

## 3. Certificação

`CERTIFIED` só para SHA com recertificação no SHA exato em PASS
(`docs/AI-OPERATING-RULES.md` §7).

| campo | valor |
|---|---|
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5`: CERTIFIED_EXACT_SHA (lab local), não deployado |
| EARLY_ACCESS_PHASE1 | **CERTIFIED_EXACT_SHA** em `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` (`CERTIFIED_FEATURE_SHA`, L-019) |
| CONTROL_PLANE_HEAD | `74f37f50d12dae698f14b620914bc0ce5b0c639a` (C2 da Fase 1, só docs, **não** CERTIFIED, não deployável) |
| EARLY_ACCESS_PHASE2 | **NOT_CERTIFIED** — implementação fechada no working tree; sem commit, sem C1, sem recert |
| RELEASE_CANDIDATE | **NONE** |

## 4. Qual worktree usar?

```
/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001
```

⚠️ **`/home/zetta/swap-z-app` NÃO é o estado atual** (está em
`kimi/round2-audit-fixes` = `d7741bb`, fim do Round 1). Mapa completo:
`docs/GIT-AND-WORKTREE-MAP.md`.

## 5. Em que trabalho estamos?

| campo | valor |
|---|---|
| CURRENT_WORK | **EARLY_ACCESS_PHASE2_EMAIL_DOUBLE_OPT_IN** |
| PHASE2_IMPLEMENTATION | **CLOSED_IN_WORKING_TREE** (L-025; controle de documentos fechado em L-026) |
| PHASE2_CODE_EXISTS | **YES** — só no working tree (o produto COMMITADO continua o da Fase 1) |
| PHASE2_COMMIT | **NONE** |
| PHASE2_C1 | **NOT_CREATED** |
| PHASE2_RECERT | **NOT_RUN** |
| PHASE2_CERTIFICATION | **NOT_CERTIFIED** |
| OWNER_PHASE2_PRODUCT_DECISIONS_PENDING | **NONE** (D-1…D-11 em L-021; EA2-A02 em L-023) |
| EMAIL_PROVIDER_DECISION | **RESEND** (D-1; região de envio `sa-east-1`) |
| ESPECIFICAÇÃO | `docs/PLANO-EARLY-ACCESS-FASE2.md` (comportamento final implementado) |
| AUDITORIAS | própria (L-022) · 1ª independente FAIL → EA2-IA01…IA06 corrigidos (L-024) · 2ª independente → EA2-IA07…IA09 corrigidos (L-025) · verificação final → EA2-IA10 (control plane) corrigido (L-026) |

**Os status são distintos e não se implicam:** implementação fechada ≠
commitada ≠ recertificada ≠ certificada ≠ deployada ≠ gate público aberto.
Hoje só o primeiro vale.

## 6. O que está bloqueado?

- **F-01 (EMAIL_DOUBLE_OPT_IN):** a implementação está **fechada no working
  tree** (FIXED_NOT_RECERTIFIED). Ainda **não** está commitada, recertificada,
  certificada nem em produção. Abrir o gate público continua bloqueado até: C1
  + recert PASS + C2; texto jurídico aprovado (inclui D-9: o Resend na Política
  de Privacidade); setup externo do domínio remetente (D-2); segredos
  configurados; migrations 0068/0069 aplicadas; decisão do dono de abrir.
- **Release para produção:** BLOQUEADO (autorização do dono, leitura das
  migrations em produção, Vercel `DEFERRED_EXTERNAL_PAYMENT`, PR #447 DRAFT).
- **Automação com dinheiro real:** NO-GO (DCA, Pilot e Autopilot reais).

Lista completa: `docs/CURRENT-STATE.md` → OPEN_BLOCKERS.

## 7. O que não pode ser tocado?

> ⛔ **Proibido: produção, Vercel, Supabase hospedado, credenciais reais,
> push, merge, deploy, trade real, exposição pública e envio real de email.**
> Qualquer um deles exige **autorização explícita do dono, na conversa corrente**.
>
> ⛔ **NUNCA FAZER DEPLOY DE WORKTREE OU BRANCH POR NOME.** Deploy só sai de um
> SHA marcado `RELEASE_CANDIDATE` em `docs/RELEASE-CHAIN.md`. **Hoje nenhum
> SHA tem essa marca.**
>
> ⛔ Não apagar branches nem worktrees. Não editar nem renomear documento
> histórico. Nunca editar migration existente (correção é migration nova).
> **Não limpar, stashar nem resetar o working tree da Fase 2.**
>
> ⛔ **POLÍTICA DE DEPLOY (decisão do dono, 01/10/2026):** a regra de 31/08
> *"tudo vai para produção sempre"* está **FORMALMENTE SUSPENSA**. Deploy só
> com: SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização
> explícita do dono. Até lá: `PRODUCTION=UNTOUCHED` ·
> `VERCEL=DEFERRED_EXTERNAL_PAYMENT`. Ver `docs/AI-OPERATING-RULES.md` §6.

## 8. Quais documentos ler depois? (nesta ordem)

1. `docs/AI-OPERATING-RULES.md`: o método. Obrigatório para IA.
2. `docs/CURRENT-STATE.md`: onde estamos agora.
3. `docs/LAUNCH-READINESS-LEDGER.md` L-020…L-026: a Fase 2.
4. `docs/PLANO-EARLY-ACCESS-FASE2.md`: a especificação final da Fase 2.
5. `docs/AUDIT-RECONCILIATION.md` §5.5.1–§5.5.3: findings da Fase 2.
6. `docs/RELEASE-CHAIN.md`: qual commit veio de qual.
7. Só se precisar: `docs/DOCUMENT-AUTHORITY.md`, `docs/GIT-AND-WORKTREE-MAP.md`.

## 9. Qual é o próximo passo exato?

Ciclo de vida (`docs/AI-OPERATING-RULES.md` §5). A Fase 2 está entre os passos
7 (validação pré-commit, feita) e 8 (C1). A sequência a partir de agora:

1. **Verificação independente final** do pacote de control plane (L-026).
2. **Autorização do dono para o C1 da Fase 2.** Sem ela, nada é commitado.
3. **C1** (commit candidato): o working tree da Fase 2 exatamente como
   registrado em L-025/L-026.
4. **Recertificação COMPLETA no SHA exato de C1:** `npm ci`, **build**,
   type-check, lint, suíte completa, SQL 0001→0069 (T15, T16, T16b, 02, 14),
   evidência fora do repo com `MANIFEST.sha256`. O build só roda aqui.
   FAIL → registrar, corrigir, C1b, recert do C1b (sem retry-to-pass).
5. **C2** (atestação só docs) **se e só se** a recert passar, registrando
   `CERTIFIED_FEATURE_SHA=<C1>`.

Conhecido e separado (não é da Fase 2): o timeout de carga de
`src/lib/zion/playbook-backtest.test.ts` (ZION-PLAYBOOK-TIMEOUT-LOCAL).

## 10. Como provar que estou no lugar certo? (estado ATUAL, Fase 2 não commitada)

```bash
cd /home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001
PRODUCT_BASE_SHA=9f2ddcbe45f9f93c9a33c331e31e32c45d410019
PHASE_BASE_SHA=74f37f50d12dae698f14b620914bc0ce5b0c639a
git branch --show-current                      # early-access-phase2-email-double-optin-20261001
git rev-parse HEAD HEAD^{tree}                 # hoje = PHASE_BASE_SHA / 5c93c05… (até existir o C1)
git merge-base --is-ancestor "$PRODUCT_BASE_SHA" HEAD && echo OK-ANCESTOR
git status --short                             # NÃO vazio: o delta da Fase 2 (ver abaixo)
git diff --name-only HEAD; git ls-files --others --exclude-standard
git diff --quiet HEAD -- supabase/migrations/0068_early_access.sql && echo 0068-INTOCADA
```

A identidade é válida quando **todas** valem:

1. a branch é a esperada e `PRODUCT_BASE_SHA` é ancestral do HEAD;
2. HEAD = `PHASE_BASE_SHA` (enquanto o C1 não existir) e todo commit posterior
   ao `PRODUCT_BASE_SHA` está explicado no ledger / `RELEASE-CHAIN.md`;
3. o working tree contém **exatamente** o delta da Fase 2 registrado no ledger
   (L-025: arquivos de produto, 0069, testes; L-026: só docs) — conferível
   contra o pacote de auditoria final listado em L-026 (patch e arquivos
   untracked byte a byte);
4. `0068`, `package*.json`, `.env*`, `vercel.json` e `src/lib/zion` sem diff.

Qualquer outro resultado é mismatch: **ABORTAR**, reportar, e seguir
`docs/AI-OPERATING-RULES.md` §1. **Não** "consertar" com checkout, reset,
stash ou rebase.

---

## 11. HISTÓRICO (não são instruções atuais)

> Tudo abaixo descreve estados e instruções que **já foram cumpridos ou
> superados**. Mantido para rastreabilidade; não executar.

- **Revisões 1–6 (01–02/10/2026):** criação do control plane sobre
  `9f2ddcb` (L-011), correções dos reviews independentes (L-016, L-017),
  política de deploy (L-012), recert da Fase 1: `9f2ddcb` FAIL
  (EA-TEST-F10-FLAKY), C1 `f4af976` FAIL (EA-TEST-HMAC-189-FLAKY), C1b
  `f1b4ec1` **PASS** (L-018, L-019); atestação C2 = `74f37f5` (L-019).
- **Antes da Fase 2 começar**, este arquivo instruía: registrar o
  `PHASE_BASE_SHA` = C2 (feito, L-020); escrever o plano da Fase 2 antes de
  qualquer código (feito, L-020; hoje é a especificação final); esperar o dono
  escolher o provider de email (feito: RESEND, L-021); e tratar a árvore
  limpa e "nenhum código da Fase 2" como prova de identidade (não vale mais:
  hoje a prova é o §10). Na época, `EARLY_ACCESS_PHASE2_STATUS` era
  `BLOCKED_NOT_STARTED` e `PHASE2_CODE_EXISTS=NO`.
- Detalhe completo dessas revisões: ledger L-011…L-019 e as versões anteriores
  deste arquivo dentro dos pacotes de auditoria da Fase 2 (`PHASE2-DOCS.tar.gz`).
