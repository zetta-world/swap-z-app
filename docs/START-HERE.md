# START HERE — Z-SWAP

> **IF YOU ARE A HUMAN OR AI STARTING WORK ON Z-SWAP:
> READ THIS FILE FIRST.**
>
> **DO NOT infer current state from another PLANO/AUDITORIA file.**
> Planos antigos são histórico, mesmo quando dizem "status 🟢" ou "vivo".
> O estado atual é definido AQUI e em `docs/CURRENT-STATE.md`.

Control plane criado em 01/10/2026 e reconciliado contra o Git local, os refs
`origin/*` (depois de `git fetch`), o GitHub (via `gh`, somente leitura) e os
relatórios locais do laboratório. Revisão 3 (01/10/2026): correções da
auditoria independente, round 1 (CP-01…CP-08). Revisão 4 (01/10/2026):
round 2 (CP-09 atestação pós-recert, CP-10 terminologia de certificação).
Revisão 5 (02/10/2026): C1 `f4af976` commitado; RECERT(C1)=FAIL
(EA-TEST-HMAC-189-FLAKY); correção para o C1b no working tree.

---

## 1. O que é o Z-SWAP?

Um agregador de DEX multi-chain (Solana + ~10 EVM) com assistente de trading
por IA (ZION), execução em corretora (autopilot e DCA) e um painel admin tipo
terminal. Stack: Next.js 16.3.6 · Supabase (Postgres) · Vercel. Mapa do código:
`CLAUDE.md`.

## 2. Qual é a base de produto e qual é o HEAD?

O control plane separa dois conceitos. **A base de produto é fixa; o HEAD
não é um invariante.** Commits de control plane (`CLAUDE.md`, `AGENTS.md`,
`docs/**`) mudam o HEAD legitimamente, sem mudar o produto.

| | |
|---|---|
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` (último commit de **produto**) |
| PRODUCT_BASE_TREE | `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` |
| EXPECTED_BRANCH | `early-access-phase2-email-double-optin-20261001` (só local, sem upstream) |
| WORKTREE_HEAD_AT_LAST_MEASUREMENT | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` (01/10/2026, revisão 3, antes do commit do control plane). **Snapshot informativo, não regra** |

Quando a Fase 2 começar, ela registra um **PHASE_BASE_SHA** novo no ledger
**antes** da implementação. A regra de identidade está no §10.

## 3. Qual é o último checkpoint certificado?

`CERTIFIED` fica reservado para SHA cuja **recertificação no SHA exato** esteja
PASS (`docs/AI-OPERATING-RULES.md` §7): `CERTIFIED_EXACT_SHA`. SHAs chamados
"certified" antes da revisão 3 sem essa prova são
`HISTORICAL_CERTIFICATION_LEGACY`; `43c484b` é `CERTIFIED_RUNTIME_ANCESTOR`
(ver `RELEASE-CHAIN.md`).

| campo | valor |
|---|---|
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5`: **CERTIFIED_EXACT_SHA** (recert de runtime no laboratório local, PASS), não deployado |
| EARLY_ACCESS_PHASE1_CHECKPOINT | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`: **COMMITTED_FEATURE_CHECKPOINT** (gate fechado) |
| PHASE1_RECERT | **BLOCKED**: `9f2ddcb` FAIL (EA-TEST-F10-FLAKY); C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d` **RECERT FAIL** (EA-TEST-HMAC-189-FLAKY). Ver `CURRENT-STATE.md` |
| CERTIFIED_FEATURE_SHA | **NONE** (será o C1b, se RECERT(C1b)=PASS) |
| CONTROL_PLANE_HEAD | **NOT_YET_COMMITTED** (não há C2; o control plane commitado no C1 não é atestação) |
| RELEASE_CANDIDATE | **NONE** |

**`CERTIFIED_FEATURE_SHA` não é necessariamente o `CONTROL_PLANE_HEAD`.** O
primeiro é o commit candidato C1 cujo produto foi recertificado no SHA exato;
o segundo é o commit de atestação C2 (só docs) por cima dele. C2 nunca é
chamado `CERTIFIED`, e deploy de C2 segue proibido (`AI-OPERATING-RULES.md`
§5.1).

Histórico: o dono designou `9f2ddcb` como "certified feature checkpoint"
antes da recertificação no SHA commitado. Essa designação fica registrada
(ledger L-009), mas o control plane não chama o SHA de `CERTIFIED` enquanto a
recert exata não der PASS.

## 4. Qual worktree usar?

```
/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001
```

⚠️ **`/home/zetta/swap-z-app` NÃO é o estado atual.** Está em
`kimi/round2-audit-fixes` = `d7741bb`, o fim do Round 1 (15/09). Mapa completo
das worktrees: `docs/GIT-AND-WORKTREE-MAP.md`.

## 5. Em que trabalho estamos, e qual é a próxima fase?

| campo | valor |
|---|---|
| CURRENT_WORK | **CONTROL_PLANE_REVIEW_AND_PHASE1_RECERT** |
| NEXT_PHASE | **EARLY_ACCESS_PHASE2_EMAIL_DOUBLE_OPT_IN** |
| EARLY_ACCESS_PHASE2_STATUS | **BLOCKED_NOT_STARTED** |
| PHASE2_CODE_EXISTS | **NO** |

A Fase 2 só passa a `CURRENT_DEVELOPMENT` depois de **todas** estas coisas:

1. control plane aprovado e commitado;
2. recert da Fase 1 em PASS no SHA novo;
3. plano da Fase 2 escrito;
4. decisão do provider de email, quando a implementação depender dela.

## 6. O que está bloqueado?

- **Abrir o gate público do early access está BLOQUEADO por F-01
  (EMAIL_DOUBLE_OPT_IN).** O gate está CLOSED.
- **O release para produção está BLOQUEADO.** Depende de autorização do dono,
  de uma leitura das migrations em produção, da Vercel
  (DEFERRED_EXTERNAL_PAYMENT) e do PR #447, que está DRAFT.
- **Automação com dinheiro real está em NO-GO:** DCA real, Pilot real e
  Autopilot real.
- **A recertificação da Fase 1 está BLOCKED.** No `9f2ddcb`, o teste
  `gate-hmac-referral.test.ts:121` falhava em ~13,1% das execuções
  (EA-TEST-F10-FLAKY, corrigido no C1). No C1 `f4af976`, o teste
  `gate-hmac-referral.test.ts:157` falhou (~0,73% das execuções,
  EA-TEST-HMAC-189-FLAKY). Relatórios:
  `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/EARLY-ACCESS-PHASE1-RECERT-9f2ddcb-20261001.txt`,
  `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/EARLY-ACCESS-PHASE1-C1-RECERT-f4af976-20261001.txt`.
  A correção do segundo existe **no working tree** (revisão 5, sem commit) e
  vai no commit candidato C1b.

Lista completa: `docs/CURRENT-STATE.md` → OPEN_BLOCKERS.

## 7. O que não pode ser tocado?

> ⛔ **Proibido: produção, Vercel, Supabase hospedado, credenciais reais,
> push, merge, deploy, trade real e exposição pública.** Qualquer um deles
> exige **autorização explícita do dono, na conversa corrente**.
>
> ⛔ **NUNCA FAZER DEPLOY DE WORKTREE OU BRANCH POR NOME.** Deploy só sai de um
> SHA marcado `RELEASE_CANDIDATE` em `docs/RELEASE-CHAIN.md`. **Hoje nenhum
> SHA tem essa marca.**
>
> ⛔ Não apagar branches nem worktrees. Não editar nem renomear documento
> histórico. Nunca editar migration existente: correção é migration nova.
>
> ⛔ **POLÍTICA DE DEPLOY (decisão do dono, 01/10/2026).** A regra de 31/08
> *"tudo vai para produção sempre"* está **FORMALMENTE SUSPENSA**. Nenhum
> commit, branch ou worktree vai para produção automaticamente. Deploy só
> quando houver as quatro coisas:
> 1. um SHA explícito;
> 2. esse SHA marcado `RELEASE_CANDIDATE` em `docs/RELEASE-CHAIN.md`;
> 3. a certificação correspondente em PASS;
> 4. autorização explícita do dono para aquele deploy.
>
> Até lá: `PRODUCTION=UNTOUCHED` · `VERCEL=DEFERRED_EXTERNAL_PAYMENT`.
> Ver `docs/AI-OPERATING-RULES.md` §6.

## 8. Quais documentos ler depois? (nesta ordem)

1. `docs/AI-OPERATING-RULES.md`: o método. Obrigatório para IA.
2. `docs/CURRENT-STATE.md`: onde estamos agora.
3. `docs/RELEASE-CHAIN.md`: qual commit veio de qual.
4. `docs/LAUNCH-READINESS-LEDGER.md`: as fases, a evidência e a próxima
   dependência.
5. `docs/PLANO-EARLY-ACCESS.md` §13–§15: o escopo da Fase 2 (F-01).
6. Só se precisar: `docs/AUDIT-RECONCILIATION.md` (prova de que as correções
   **conhecidas e identificáveis** estão na linha; A08/A09/A10/A17 seguem sem
   fonte), `docs/DOCUMENT-AUTHORITY.md` (em qual documento confiar) e
   `docs/GIT-AND-WORKTREE-MAP.md` (branches e worktrees).

## 9. Qual é o próximo passo exato?

Ciclo de vida obrigatório (`docs/AI-OPERATING-RULES.md` §5): branch/worktree
→ base registrada → plano → implementação → auditoria → correções →
validação pré-commit → **commit candidato C1** → **recert no SHA exato de
C1** → **commit de atestação C2, só docs** → próxima fase. O SHA exato só
existe depois do commit; o resultado da recert só pode ser registrado num
commit posterior (C2).

0. Review independente: round 1 (pacote v1) e round 2 (pacote v2) feitos;
   CP-01…CP-08 PASS, correção F10 PASS. CP-09/CP-10 corrigidos na revisão 4
   (working tree).
1. ~~Commit candidato C1~~: feito, `f4af9764e4c773f1bba2821f6cbef9685cfeb59d`
   (control plane + correção EA-TEST-F10-FLAKY). **RECERT(C1)=FAIL** (ledger
   L-018).
2. **Commit candidato C1b**, com autorização do dono: a correção
   EA-TEST-HMAC-189-FLAKY (`src/lib/early-access/gate-hmac-referral.test.ts`,
   já no working tree) e os docs da revisão 5. Filho de `f4af976`.
3. **Recertificar C1b inteiro, no SHA exato**: `npm ci`, build, type-check,
   lint, testes alvo, guardas, suíte completa e SQL T15. Se falhar: registrar
   o FAIL, sem atestação PASS, sem retry-to-pass, sem reclassificar;
   corrigir, novo commit candidato, recert dele inteiro. Se PASS: **commit
   de atestação C2**, só docs, registrando `CERTIFIED_FEATURE_SHA=<C1b>`,
   `RECERT_RESULT=PASS` e a evidência; provar
   `git diff --stat <C1b>..<C2> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'`
   vazio. Daí `CONTROL_PLANE_HEAD=<C2>`.
4. Escrever o plano da Fase 2 **antes de qualquer código**: uma seção nova em
   `docs/PLANO-EARLY-ACCESS.md` ou um `docs/PLANO-EARLY-ACCESS-FASE2.md` novo.
   Registrar o PHASE_BASE_SHA (= C2) no ledger. O plano cobre:
   - a escolha do provider de email (decisão do dono);
   - o token de uso único, guardado como hash e com expiração;
   - a rota de verificação;
   - o consentimento confirmado no ato da verificação;
   - a limpeza das inscrições não verificadas;
   - a correção dos dados pelo próprio titular;
   - a anti-enumeração preservada.
5. Esperar o dono escolher o provider de email. Isso é OWNER_DECISION e
   bloqueia a implementação.

## 10. Como provar que estou no lugar certo?

```bash
cd /home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001
PRODUCT_BASE_SHA=9f2ddcbe45f9f93c9a33c331e31e32c45d410019
pwd
git branch --show-current   # esperado early-access-phase2-email-double-optin-20261001
git rev-parse HEAD HEAD^{tree}   # registrar; NÃO é comparado com um valor fixo
git merge-base --is-ancestor "$PRODUCT_BASE_SHA" HEAD && echo OK-ANCESTOR
git status --short          # esperado vazio (exceto durante uma campanha autorizada em curso)
git log --oneline "$PRODUCT_BASE_SHA"..HEAD     # cada commit tem de estar explicado no ledger/RELEASE-CHAIN
git diff --stat "$PRODUCT_BASE_SHA"..HEAD -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'
```

Antes de existir código da Fase 2, a identidade é válida quando **todas**
valem:

1. a branch é a esperada;
2. `PRODUCT_BASE_SHA` é ancestral do HEAD;
3. a árvore de trabalho está limpa;
4. todo commit posterior ao `PRODUCT_BASE_SHA` está explicado no ledger ou no
   `RELEASE-CHAIN.md`;
5. não há delta de **produto** não autorizado: o último comando acima sai
   vazio, **ou** o delta é exatamente o autorizado e registrado no ledger
   (hoje, o único arquivo de produto autorizado é o teste
   `src/lib/early-access/gate-hmac-referral.test.ts`: EA-TEST-F10-FLAKY,
   commitado no C1, e EA-TEST-HMAC-189-FLAKY, para o C1b).

O control plane não usa "HEAD = `9f2ddcb`" nem "diff fora de `docs/` vazio"
como regra: as duas se invalidariam com o próprio commit do control plane
(que toca `CLAUDE.md` e `AGENTS.md`).

Depois do C2, a regra continua valendo com mais uma prova: o diff de produto
`C1..C2` (mesma exclusão) sai vazio. Quando a Fase 2 começar, a referência
passa a ser o **PHASE_BASE_SHA** (= C2) registrado no ledger antes da
implementação.

Qualquer outro resultado é mismatch: **ABORTAR**, reportar, e seguir
`docs/AI-OPERATING-RULES.md` §1.
