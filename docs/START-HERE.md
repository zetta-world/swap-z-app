# START HERE — Z-SWAP

> **IF YOU ARE A HUMAN OR AI STARTING WORK ON Z-SWAP:
> READ THIS FILE FIRST.**
>
> **DO NOT infer current state from another PLANO/AUDITORIA file.**
> Planos antigos são histórico, mesmo quando dizem "status 🟢" ou "vivo".
> O estado atual é definido AQUI e em `docs/CURRENT-STATE.md`.

**Revisão 10 (06/10/2026, ledger L-043/L-044): Founders Economics + Commercial Truth fechado localmente no candidato `c2bfc4a`, recertificação exata implementer-reported PASS, aguardando auditoria independente; não é release nem publicação.** Revisão 9 (03/10/2026, ledger L-028/L-029): ensaio de release em PROD-CLONE local CLOSED_PASS e reconciliação AO VIVO só-leitura CLOSED; bloqueadores externos R-01 (Vercel) e R-02 (`CEX_RECOVERY_HMAC_KEY`). Revisão 8 (L-027): Fase 2 CERTIFIED_EXACT_SHA no C1 e atestada no C2. Revisão 7 (L-026, EA2-IA10): este arquivo foi
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
| PHASE_BASE_SHA (Founders closure) | `b464dd7fbec0941ffb26ab391a1783328dd876f9` (registrado na L-043 antes do código) |
| HEAD atual | `THIS_CONTROL_PLANE_COMMIT`, somente docs, filho do candidato `c2bfc4ab93801fc8084e952564afde0cde5ceae6` |
| EXPECTED_BRANCH | `founders-commercial-economics-closure-20261006` (só local, sem upstream) |
| WORKING TREE | **limpo** após a atestação L-044 |

## 3. Certificação

`CERTIFIED` só para SHA com recertificação no SHA exato em PASS
(`docs/AI-OPERATING-RULES.md` §7).

| campo | valor |
|---|---|
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5`: CERTIFIED_EXACT_SHA (lab local), não deployado |
| EARLY_ACCESS_PHASE1 | **CERTIFIED_EXACT_SHA** em `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` (L-019) |
| CERTIFIED_FEATURE_SHA (atual) | **`53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`** (C1 da Fase 2; L-027). O anterior era `f1b4ec1` (Fase 1) |
| CONTROL_PLANE_HEAD | o commit da L-030 (`THIS_CONTROL_PLANE_COMMIT`; só docs; **não** CERTIFIED, não deployável). Anteriores: L-029 `762224843fa8d7e340416d05ac2a99488945d541` · C2 `57d78ebf42866a53f16ef5f0a5cc24bc3ac97c9c` |
| EARLY_ACCESS_PHASE2 | **CERTIFIED_EXACT_SHA** em `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · tree `010a448c774247406cc9cc80cba34e8744426557` (C1; recert `recert-c1-53cd85a-v31-20261003T182216Z` PASS, L-027) — **não** deployado; gate CLOSED |
| FOUNDERS_CLOSURE_CANDIDATE | `c2bfc4ab93801fc8084e952564afde0cde5ceae6` · tree `52c8cac23a27f48e25be3498090db1e31d098c43` · recert local exata PASS reportada pelo implementador · auditoria independente pendente |
| RELEASE_CANDIDATE | **NONE** · `RC_SELECTION_READY=NO` |

## 4. Qual worktree usar?

```
/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/founders-closure-20261006
```

⚠️ **`/home/zetta/swap-z-app` NÃO é o estado atual** (está em
`kimi/round2-audit-fixes` = `d7741bb`, fim do Round 1). Mapa completo:
`docs/GIT-AND-WORKTREE-MAP.md`.

## 5. Em que trabalho estamos?

| campo | valor |
|---|---|
| CURRENT_WORK | **FOUNDERS ECONOMICS + COMMERCIAL TRUTH — READY_FOR_INDEPENDENT_AUDIT** (L-044); não release, não publicado |
| FOUNDERS_RECERT | candidato `c2bfc4a`: npm ci/build/lint/type-check PASS; escopo 288/288; suíte 313 arquivos / 4.654 testes PASS; evidence manifest `feafb658…` |
| FOUNDERS_OPEN | auditoria independente; preço final; telemetria real; disposição da supply chain; jurídico/publicação |
| LOCAL_PRODCLONE_REHEARSAL | **CLOSED_PASS** (suíte 4204/4204; efeitos externos reais 0) — L-028 |
| LIVE_READONLY_RECONCILIATION | **CLOSED** — produção `25fc4b0` fora do ar (402), banco sem drift desde 28/09 (55 linhas, 0068/0069 ausentes) — L-029 |
| INC-RR-01 | `HOST_OPERATIONAL_REBOOT` · `AGENT_INDUCED_OOM` · `PRODUCT_DEFECT=NO` (reconhecido pelo dono, permanente) |
| PHASE2_IMPLEMENTATION | **CLOSED** e commitada em C1 |
| PHASE2_CODE_EXISTS | **YES** — commitado em C1 |
| PHASE2_COMMIT | C1 `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` + C2 (atestação, só docs) |
| PHASE2_C1 | **CREATED** `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (parent `74f37f50d12dae698f14b620914bc0ce5b0c639a`) |
| PHASE2_RECERT | **PASS** (`recert-c1-53cd85a-v31-20261003T182216Z`; MANIFEST sha256 `31e19f5b1a685b73…`). Campanha anterior `recert-c1-53cd85a-20261003T180548Z` = FAIL · HARNESS_FAILURE_G13_SHELL_QUOTING (classificação pela evidência; **não** atribuída ao dono) |
| PHASE2_CERTIFICATION | **CERTIFIED_EXACT_SHA** `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` |
| OWNER_PHASE2_PRODUCT_DECISIONS_PENDING | **NONE** (D-1…D-11 em L-021; EA2-A02 em L-023) |
| EMAIL_PROVIDER_DECISION | **RESEND** (D-1; região de envio `sa-east-1`) |
| ESPECIFICAÇÃO | `docs/PLANO-EARLY-ACCESS-FASE2.md` (comportamento final implementado) |
| AUDITORIAS | própria (L-022) · 1ª independente → EA2-IA01…IA06 (L-024) · 2ª → EA2-IA07…IA09 (L-025) · verificação final → EA2-IA10 (L-026) · verificação final PASS + C1 + recert PASS + C2 (L-027) |

**Os status são distintos e não se implicam:** implementação fechada ≠
commitada ≠ recertificada ≠ certificada ≠ deployada ≠ gate público aberto.
Hoje valem os quatro primeiros (fechada, commitada, recertificada, certificada no C1);
**não** está deployada e o gate público está **fechado**.

## 6. O que está bloqueado?

- **F-01 (EMAIL_DOUBLE_OPT_IN):** **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `53cd85a`)** — implementado,
  commitado no C1 e recertificado. **Não** está em produção. Abrir o gate público continua bloqueado
  até os passos do dono: texto jurídico aprovado (inclui D-9: Resend na Política de Privacidade),
  domínio remetente (D-2), segredos configurados por mecanismo autorizado, migrations 0068/0069
  aplicadas (exige release), agendar o cron (D-8) e a decisão de abrir.
- **Release para produção (gate fechado):** BLOQUEADO por **R-01** (conta/pagamento da Vercel: produção
  responde 402 `DEPLOYMENT_DISABLED`) e **R-02** (`CEX_RECOVERY_HMAC_KEY` ausente na Vercel e exigida
  pelo alvo); além disso: seleção do RC e autorização do dono. Resend/domínio/jurídico **não** bloqueiam
  este release — são pré-requisitos de abertura do early access.
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
>
> ⛔ **POLÍTICA DE DEPLOY (decisão do dono, 01/10/2026):** a regra de 31/08
> *"tudo vai para produção sempre"* está **FORMALMENTE SUSPENSA**. Deploy só
> com: SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização
> explícita do dono. Até lá: `PRODUCTION=UNTOUCHED` ·
> `VERCEL=DEFERRED_EXTERNAL_PAYMENT`. Ver `docs/AI-OPERATING-RULES.md` §6.
>
> **Medido ao vivo em 03/10/2026 (L-029):** a Vercel está `BLOCKED_BY_ACCOUNT_PAYMENT` — produção
> responde HTTP 402 `DEPLOYMENT_DISABLED` (R-01). A política acima continua valendo sem alteração.

## 8. Quais documentos ler depois? (nesta ordem)

1. `docs/AI-OPERATING-RULES.md`: o método. Obrigatório para IA.
2. `docs/CURRENT-STATE.md`: onde estamos agora.
3. `docs/LAUNCH-READINESS-LEDGER.md` L-020…L-027 (Fase 2) e L-028/L-029 (ensaio e reconciliação ao vivo).
   `docs/RELEASE-RUNBOOK.md` revisão 2: o runbook vigente.
4. `docs/PLANO-EARLY-ACCESS-FASE2.md`: a especificação final da Fase 2.
5. `docs/AUDIT-RECONCILIATION.md` §5.5.1–§5.5.3: findings da Fase 2.
6. `docs/RELEASE-CHAIN.md`: qual commit veio de qual.
7. Só se precisar: `docs/DOCUMENT-AUTHORITY.md`, `docs/GIT-AND-WORKTREE-MAP.md`.

## 9. Qual é o próximo passo exato?

Nada é automático. A próxima ação desta lane é a **auditoria independente do
candidato `c2bfc4a` e do pacote de fechamento**. `RELEASE_CANDIDATE=NONE` ·
`RC_SELECTION_READY=NO`. Publicação e preço final continuam bloqueados.

A seleção de RC da linha geral continua pendente até, no mínimo:

1. **R-01** resolvido (conta/pagamento da Vercel) — dono + provedor;
2. **R-02** resolvido (`CEX_RECOVERY_HMAC_KEY` presente com segurança no ambiente de produção) — dono;
3. estado hospedado **re-medido** depois disso (só leitura, como na L-029);
4. o dono **selecionar** o RC. Recomendação (≠ seleção): feature `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`.

Separado: abrir o early access (§6) e modos de dinheiro real (NO-GO). Próxima fase de produto parte do
`CONTROL_PLANE_HEAD` com ledger novo antes de qualquer código.

Conhecido e separado (não é da Fase 2): o timeout de carga de
`src/lib/zion/playbook-backtest.test.ts` (ZION-PLAYBOOK-TIMEOUT-LOCAL) — passou na recert do C1 e no ensaio.

## 10. Como provar que estou no lugar certo? (estado ATUAL: atestação L-044 sobre candidato Founders)

```bash
cd /home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/founders-closure-20261006
CANDIDATE=c2bfc4ab93801fc8084e952564afde0cde5ceae6
git branch --show-current                      # founders-commercial-economics-closure-20261006
git rev-parse HEAD HEAD^{tree} HEAD^           # HEAD = atestação L-044; HEAD^ = candidato
git merge-base --is-ancestor "$CANDIDATE" HEAD && echo OK-ANCESTOR-CANDIDATE
git status --short                             # vazio
git diff --stat "$CANDIDATE"..HEAD -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'  # vazio
```

Válido quando: branch esperada; candidato ancestral do HEAD; árvore limpa; diff de produto candidato..HEAD vazio;
todo commit posterior explicado no ledger. Qualquer outro resultado: **ABORTAR** e reportar
(`AI-OPERATING-RULES.md` §1), sem checkout/reset/stash/rebase.

---

## 11. HISTÓRICO (não são instruções atuais)

> Tudo abaixo descreve estados e instruções que **já foram cumpridos ou
> superados**. Mantido para rastreabilidade; não executar.

- **Revisão 8 (03/10/2026, L-027):** HEAD = C2 `57d78ebf42866a53f16ef5f0a5cc24bc3ac97c9c` (HEAD^ = C1); release
  bloqueado por "autorização, leitura das migrations, Vercel `DEFERRED_EXTERNAL_PAYMENT`, PR #447 DRAFT";
  próximo passo = decisões do dono. Atualizado por L-028/L-029 (produção medida ao vivo; R-01/R-02).

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
- **Revisão 7 (03/10/2026, L-026):** a Fase 2 estava fechada **no working tree, sem commit**; o
  §10 provava identidade pelo delta não commitado; o próximo passo era a verificação final e a
  autorização do C1. Cumprido em L-027.
