# START HERE — Z-SWAP

> **IF YOU ARE A HUMAN OR AI STARTING WORK ON Z-SWAP:
> READ THIS FILE FIRST.**
>
> **DO NOT infer current state from another PLANO/AUDITORIA file.**
> Planos antigos são histórico, mesmo quando dizem "status 🟢" ou "vivo".
> O estado atual é definido AQUI e em `docs/CURRENT-STATE.md`.

**Revisão 8 (03/10/2026, ledger L-027): Fase 2 CERTIFIED_EXACT_SHA no C1 e atestada no C2.** Revisão 7 (L-026, EA2-IA10): este arquivo foi
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
| PHASE_BASE_SHA (Fase 2, histórico da fase) | `74f37f50d12dae698f14b620914bc0ce5b0c639a` · tree `5c93c0512b74777724aae62f665b10feaa95f760` (o C2 da Fase 1; registrado no ledger L-020 antes de qualquer código da Fase 2) |
| HEAD atual | o commit **C2 da Fase 2** (`THIS_ATTESTATION_COMMIT`, só docs, filho de C1; SHA concreto via `git rev-parse HEAD`) |
| EXPECTED_BRANCH | `early-access-phase2-email-double-optin-20261001` (só local, sem upstream) |
| WORKING TREE | **limpo** (a Fase 2 está commitada em C1 e atestada em C2) |

## 3. Certificação

`CERTIFIED` só para SHA com recertificação no SHA exato em PASS
(`docs/AI-OPERATING-RULES.md` §7).

| campo | valor |
|---|---|
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5`: CERTIFIED_EXACT_SHA (lab local), não deployado |
| EARLY_ACCESS_PHASE1 | **CERTIFIED_EXACT_SHA** em `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` (L-019) |
| CERTIFIED_FEATURE_SHA (atual) | **`53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`** (C1 da Fase 2; L-027). O anterior era `f1b4ec1` (Fase 1) |
| CONTROL_PLANE_HEAD | o C2 da Fase 2 (`THIS_ATTESTATION_COMMIT`; só docs; **não** CERTIFIED, não deployável) |
| EARLY_ACCESS_PHASE2 | **CERTIFIED_EXACT_SHA** em `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` · tree `010a448c774247406cc9cc80cba34e8744426557` (C1; recert `recert-c1-53cd85a-v31-20261003T182216Z` PASS, L-027) — **não** deployado; gate CLOSED |
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
| CURRENT_WORK | **EARLY_ACCESS_PHASE2 CERTIFIED (C1) e atestada (C2)** — fase fechada; próximo: decisões de release/abertura do dono |
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

A Fase 2 cumpriu o ciclo inteiro (`AI-OPERATING-RULES.md` §5): plano → implementação → auditorias
→ correções → pré-commit → **C1 `53cd85a`** → **recert exata PASS** → **C2 (este commit de atestação)**.
**A fase está FECHADA.** Nada é automático a partir daqui; cada item abaixo é decisão do dono:

1. Release (push/PR/merge/deploy): exige marcar um SHA `RELEASE_CANDIDATE` com certificação PASS e
   autorização explícita (`AI-OPERATING-RULES.md` §6.1). Hoje `RELEASE_CANDIDATE=NONE`.
2. Abrir o early access: os passos do §6 (jurídico, domínio, segredos, migrations, cron, gate).
3. Próxima fase de produto, partindo do C2 como `PHASE_BASE_SHA`.

Conhecido e separado (não é da Fase 2): o timeout de carga de
`src/lib/zion/playbook-backtest.test.ts` (ZION-PLAYBOOK-TIMEOUT-LOCAL) — passou na recert do C1
(container, 6400 ms dentro do limite do arquivo); segue registrado como sensível a carga.

## 10. Como provar que estou no lugar certo? (estado ATUAL: Fase 2 certificada no C1, atestada no C2)

```bash
cd /home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001
C1=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1
git branch --show-current                      # early-access-phase2-email-double-optin-20261001
git rev-parse HEAD HEAD^{tree} HEAD^           # HEAD = C2; HEAD^ = C1
git merge-base --is-ancestor "$C1" HEAD && echo OK-ANCESTOR
git status --short                             # vazio
git diff --stat "$C1"..HEAD -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'   # vazio (C2 é só docs)
```

Válido quando: branch esperada; C1 ancestral (pai direto) do HEAD; árvore limpa; diff de produto
C1..HEAD vazio; todo commit posterior explicado no ledger. Qualquer outro resultado: **ABORTAR** e
reportar (`AI-OPERATING-RULES.md` §1), sem checkout/reset/stash/rebase.

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
- **Revisão 7 (03/10/2026, L-026):** a Fase 2 estava fechada **no working tree, sem commit**; o
  §10 provava identidade pelo delta não commitado; o próximo passo era a verificação final e a
  autorização do C1. Cumprido em L-027.
