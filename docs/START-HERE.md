# START HERE — Z-SWAP

> **IF YOU ARE A HUMAN OR AI STARTING WORK ON Z-SWAP:
> READ THIS FILE FIRST.**
>
> **DO NOT infer current state from another PLANO/AUDITORIA file.**
> Planos antigos são histórico, mesmo quando dizem "status 🟢" ou "vivo".
> O estado atual é definido AQUI e em `docs/CURRENT-STATE.md`.

**Revisão 14 (14/10/2026, ledger L-053): reconciliação de governança DEPOIS do release de produção de 13–14/10.** O código do release é `6d1295bf43f4967b7e15498f1496c132fc09fa7a`; `main` foi avançada por fast-forward para ele e a produção passou a servi-lo; migrations 0059–0076 aplicadas no banco hospedado; R-01 e R-02 fechados. Este arquivo foi atualizado só depois do release: o registro de seleção do candidato **não** existia nos documentos antes do deploy (lacuna registrada em L-053). Revisão 13 (L-049) e anteriores: §11.

---

## 1. O que é o Z-SWAP?

Um agregador de DEX multi-chain (Solana + ~10 EVM) com assistente de trading
por IA (ZION), execução em corretora (autopilot e DCA) e um painel admin tipo
terminal. Stack: Next.js 16.3.8 · Supabase (Postgres) · Vercel. Mapa do código:
`CLAUDE.md`.

## 2. Bases fixas e estado do HEAD

**A base de produto é fixa; o HEAD não é um invariante** (commits de control
plane — `CLAUDE.md`, `AGENTS.md`, `docs/**` — o movem legitimamente).

| | |
|---|---|
| PRODUCT_BASE_SHA | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` · tree `6cd43386ab1f1a1d3181e61d1fec36c251a27b8b` (Early Access Fase 1; referência histórica de identidade) |
| RELEASE CODE SHA (em produção desde 14/10) | `6d1295bf43f4967b7e15498f1496c132fc09fa7a` · tree `22a3a409e6f43d2b5bb8f7e727ef4c8bba0e364a` |
| `main` (GitHub) | `THIS_CONTROL_PLANE_COMMIT` da L-053: commit **só de docs** cujo pai é `6d1295b`; nenhum arquivo fora de `docs/**` e `AGENTS.md` difere de `6d1295b` |
| EXPECTED_BRANCH | `main` (`origin/main`). Branches e worktrees locais antigos são históricos; inventário de 13/10 em `zswap-local/release/production-20261013/PRE-RELEASE-RECONCILIATION.md` |
| WORKING TREE | **limpo** |

## 3. Certificação e release

`CERTIFIED` só para SHA com recertificação no SHA exato em PASS
(`docs/AI-OPERATING-RULES.md` §7).

| campo | valor |
|---|---|
| LAST_CERTIFIED_RUNTIME | `0d21874b4147bb8a0b232aa0abc2302471a720e5`: CERTIFIED_EXACT_SHA (lab local, 01/10) — ancestral do código em produção |
| CERTIFIED_FEATURE_SHA | `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (Early Access Fase 2, L-027) — ancestral do código em produção |
| RELEASE EXECUTADO | `6d1295bf43f4967b7e15498f1496c132fc09fa7a` — selecionado e implantado na rodada de 13–14/10 sob a missão do dono "PRODUCTION RELEASE / TOTAL RECONCILIATION / VERCEL DEPLOY" (13/10). **Não** recebeu a classificação `CERTIFIED_EXACT_SHA`: os gates foram medidos com desvios documentados (L-053; `RELEASE-CHAIN.md` nó 27) |
| RELEASE_CANDIDATE | **nenhum candidato novo em andamento**; o candidato do release de 13–14/10 (`6d1295b`) já foi executado. A marcação `RELEASE_CANDIDATE` **não** foi registrada nos documentos antes do deploy (lacuna, L-053) |

## 4. Qual worktree usar?

Para trabalho novo: uma worktree **nova**, isolada, criada a partir de `origin/main` depois de
`git fetch origin --tags --prune`. ⚠️ `/home/zetta/swap-z-app` **não** é o estado atual (está em
`kimi/round2-audit-fixes` = `d7741bb`), e o `main` local desse checkout pode estar atrás de `origin/main`.
Mapa: `docs/GIT-AND-WORKTREE-MAP.md` (revisão com refs atualizadas em L-053).

## 5. Em que trabalho estamos?

| campo | valor |
|---|---|
| CURRENT_WORK | **POST-RELEASE: release de 13–14/10 concluído; reconciliação de governança registrada em L-053.** Nenhuma fase de produto aberta |
| PRODUCTION | app servindo o código `6d1295b` (deployment original do release `dpl_A5PDW653HtRyH4HN6CUdhGC7LLrC`; o deployment servido depois do commit da L-053 está registrado na evidência externa da L-053) · banco com 73 linhas de histórico, head `20261014002550` |
| MIGRATIONS | 0059–0076 **aplicadas** no banco hospedado em 14/10 (uma transação por arquivo, com a linha de histórico) |
| R-01 VERCEL | **CLOSED** (conta ativa; deploys de preview e produção concluídos; produção responde 200) |
| R-02 `CEX_RECOVERY_HMAC_KEY` | **CLOSED** — presente por nome (tipo `sensitive`, production + preview) desde 13/10 23:50 UTC; valor nunca exibido. O caminho autenticado que a usa **não** foi exercitado em produção |
| AP-LOCK hosted | **PASS** por sonda comportamental (padrão exato da trava do cron gerou SQL válido no PostgREST hospedado; função real não exercitada: 0 sessões) |
| PUBLIC_GATE (early access) | **CLOSED** (`disable_early_access=true`) |
| REAL-MONEY | Autopilot **DISABLED**, DCA real **DISABLED**, Pilot autônomo **NOT ENABLED**; 0 sessões, 0 conexões CEX, 0 intents, 0 fills (leitura de 14/10) |
| FOUNDERS | página pública `/founders-pass` em produção (venda **não** aberta: data, supply final e preço final pendentes) |

**Os status são distintos e não se implicam:** release executado ≠ `CERTIFIED_EXACT_SHA` ≠ auditoria
global sem pendências ≠ autorização para dinheiro real.

## 6. O que está aberto?

- **ACL-DEFAULT-GRANTS (OPEN):** 35/53 tabelas mantêm privilégios de tabela padrão para `anon`/`authenticated`;
  um PATCH anônimo testado alterou 0 linhas. Isso **não** prova contenção completa de todos os privilégios e
  caminhos. Revisão própria de privilégios/exposição, com eventual REVOKE, em rodada separada.
- **CE-01 (monitorar):** margem da trava de complexidade no runner do CI (motor 5,4–7,1× vs quadrático 14,8×, limite 10×).
- **Warnings técnicos:** `middleware` → `proxy`, Edge runtime, cache da llama.fi > 2 MB.
- **npm audit (snapshot do release, não contagem atual):** 0 critical / 25 high / 40 moderate; exceção **R-03** mantida (não corrigida).
- **Ressalvas de evidência:** smoke histórico com 2 linhas FAIL conciliadas como expectativa errada/registro (L-053);
  caminho autenticado de `/api/cex/order` não exercitado; lacuna de registro prévio do RC; migrations hospedadas
  aplicadas **sem** backup `pg_dump` + restauração validada (runbook R2.3 item 6; só o rollback A foi provado).
- **Separado:** abrir o early access (GATE-OPEN) e modos de dinheiro real (NO-GO).

Lista completa: `docs/CURRENT-STATE.md` → OPEN_BLOCKERS e `docs/AUDIT-RECONCILIATION.md` §5.7.

## 7. O que não pode ser tocado?

> ⛔ **Proibido: produção, Vercel, Supabase hospedado, credenciais reais,
> push, merge, deploy, trade real, exposição pública e envio real de email.**
> Qualquer um deles exige **autorização explícita do dono, na conversa corrente**.
>
> ⛔ **NUNCA FAZER DEPLOY DE WORKTREE OU BRANCH POR NOME.** Deploy só sai de um
> SHA marcado `RELEASE_CANDIDATE` em `docs/RELEASE-CHAIN.md`. Hoje **nenhum candidato novo** tem essa marca.
>
> ⛔ Não apagar branches nem worktrees. Não editar nem renomear documento
> histórico. Nunca editar migration existente (correção é migration nova).
>
> ⛔ **POLÍTICA DE DEPLOY (decisão do dono, 01/10/2026):** a regra de 31/08
> *"tudo vai para produção sempre"* está **FORMALMENTE SUSPENSA**. Deploy só
> com: SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização
> explícita do dono. Ver `docs/AI-OPERATING-RULES.md` §6.
>
> ⛔ `CEX_RECOVERY_HMAC_KEY` precisa ser **estável**: não recriar, não sobrescrever, não "reinstalar" a variável.
>
> **Registro (L-053):** o release de 13–14/10 foi executado por autorização explícita do dono para a missão,
> mas sem a marcação `RELEASE_CANDIDATE` prévia nos documentos — divergência registrada, não precedente.

## 8. Quais documentos ler depois? (nesta ordem)

1. `docs/AI-OPERATING-RULES.md`: o método. Obrigatório para IA.
2. `docs/CURRENT-STATE.md`: onde estamos agora.
3. `docs/LAUNCH-READINESS-LEDGER.md` L-053 (release e reconciliação) e L-028/L-029 (ensaio e medição de 03/10).
4. `docs/RELEASE-CHAIN.md`: qual commit veio de qual (nós 25–28 = release).
5. `docs/AUDIT-RECONCILIATION.md` §5.7: findings pós-release.
6. Só se precisar: `docs/RELEASE-RUNBOOK.md`, `docs/DOCUMENT-AUTHORITY.md`, `docs/GIT-AND-WORKTREE-MAP.md`.

Evidência externa (fora do repo): `zswap-local/release/production-20261013/` (release) e
`zswap-local/evidence/post-release-governance-*` (esta reconciliação).

## 9. Qual é o próximo passo exato?

Nada é automático. Não há release candidate novo nem fase aberta. Próximos trabalhos possíveis, cada um
**só com autorização explícita do dono**: revisão de ACL (ACL-DEFAULT-GRANTS), abertura do early access
(GATE-OPEN), auditoria independente pendente das entregas Founders, e qualquer novo release (que volta a
exigir o caminho completo do `RELEASE-CHAIN.md` §3, incluindo a marcação `RELEASE_CANDIDATE` **antes** do deploy).
Modos de dinheiro real seguem NO-GO.

## 10. Como provar que estou no lugar certo?

```bash
git fetch origin --tags --prune
RELEASE_CODE=6d1295bf43f4967b7e15498f1496c132fc09fa7a
git rev-parse origin/main origin/main^{tree}           # HEAD documental atual (L-053 ou posterior)
git merge-base --is-ancestor "$RELEASE_CODE" origin/main && echo OK-RELEASE-ANCESTOR
git diff --stat "$RELEASE_CODE" origin/main -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'   # vazio enquanto nenhum código novo entrar
git status --short                                     # vazio na sua worktree
```

Válido quando: `6d1295b` é ancestral de `origin/main`, o diff fora do control plane é vazio (ou todo commit de
código posterior está explicado no ledger) e a árvore está limpa. Qualquer outro resultado: **ABORTAR** e reportar
(`AI-OPERATING-RULES.md` §1), sem checkout/reset/stash/rebase.

---

## 11. HISTÓRICO (não são instruções atuais)

> Tudo abaixo descreve estados e instruções que **já foram cumpridos ou
> superados**. Mantido para rastreabilidade; não executar.

- **Revisão 13 (07/10/2026, L-049) e anteriores desde a 9:** estado anterior ao release — HEAD = atestação L-049 sobre o
  candidato Founders AF-01 `efdf6ee` (worktree `founders-af01-partial-schedule-fix-20261007`); `RELEASE_CANDIDATE=NONE`,
  `RC_SELECTION_READY=NO`; release bloqueado por R-01 (Vercel 402) e R-02 (`CEX_RECOVERY_HMAC_KEY` ausente);
  recomendação de feature `53cd85a`. Depois vieram L-050…L-052 (supply chain, página pública, blockers) e o release
  de 13–14/10 (L-053). Texto integral da revisão 13: histórico do Git (`git show 6d1295b:docs/START-HERE.md`).
  Linha original do topo:
  > **Revisão 13 (07/10/2026, ledger L-049): o candidato `58bcf8e` permanece FAIL histórico de `IA-AF01-001`; a correção cirúrgica foi recertificada localmente no novo candidato `efdf6ee` e aguarda nova auditoria independente. Não é release nem publicação.** Revisão 12 (L-047): Founders Final Micro-Delta entregue e depois reprovado pela auditoria independente. Revisão 11 (L-045): Founders Final Sale + Liability Closure. Revisão 10 (L-043/L-044): Founders Economics + Commercial Truth. Revisão 9 (03/10/2026, ledger L-028/L-029): ensaio de release em PROD-CLONE local CLOSED_PASS e reconciliação AO VIVO só-leitura CLOSED; bloqueadores externos R-01 (Vercel) e R-02 (`CEX_RECOVERY_HMAC_KEY`). Revisão 8 (L-027): Fase 2 CERTIFIED_EXACT_SHA no C1 e atestada no C2. Revisão 7 (L-026, EA2-IA10): este arquivo foi
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
