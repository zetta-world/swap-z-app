# GIT AND WORKTREE MAP

> Função: organizar o Git, ou seja, as worktrees, as branches locais e os refs
> remotos. **Nada aqui autoriza apagar.** As classificações dizem o papel de
> cada coisa; remover qualquer uma é decisão do dono.
>
> Medido em 01/10/2026, depois de `git fetch origin --tags --prune` (exit 0).
> Repositório: `https://github.com/zetta-world/swap-z-app.git`. Todas as 9
> worktrees estavam **limpas** (0 entradas em `git status --short`).
>
> Revisão 3 (01/10/2026): os HEADs abaixo são **snapshots da medição**, não
> invariantes. Commits de control plane mudam o HEAD da worktree de trabalho
> legitimamente; a regra de identidade (por `PRODUCT_BASE_SHA`) está em
> `START-HERE.md` §10.
>
> Revisão 4 (02/10/2026, atestação C2): a linha da worktree de trabalho e da
> branch dela foi atualizada para o HEAD medido antes do commit C2 (o C1b,
> `f1b4ec1`). As demais linhas continuam sendo a medição de 01/10.
>
> Revisão 5 (03/10/2026, L-026): a linha da worktree de trabalho foi
> atualizada para o HEAD `74f37f5` e para a Fase 2 fechada no working tree,
> **não commitada** (working tree sujo de propósito). A frase "todas as 9
> worktrees estavam limpas" é da medição de 01/10.
>
> Revisão 6 (03/10/2026, L-027): Fase 2 commitada (C1 `53cd85a`, CERTIFIED_EXACT_SHA) e atestada
> (C2); working tree limpo.
>
> Revisão 7 (03/10/2026, L-029): HEAD da worktree de trabalho = commit de control plane da L-029 (só docs),
> filho do C2 `57d78ebf42866a53f16ef5f0a5cc24bc3ac97c9c`. Nenhuma worktree nem branch nova; working tree limpo.
>
> Revisão 8 (03/10/2026, L-030): HEAD = commit da L-030 (só docs), filho de `762224843fa8d7e340416d05ac2a99488945d541`.
> Estado atual: `START-HERE.md`, `CURRENT-STATE.md`, ledger e `RELEASE-CHAIN.md`.

---

## 1. Worktrees

| caminho | HEAD (completo) | branch | classificação | papel |
|---|---|---|---|---|
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/founders-final-microdelta-20261006` | `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67` na abertura | `founders-final-microdelta-20261006` (sem upstream) | **CURRENT_WORK** | Micro-delta L-046: deadline exato de 14 dias e copy Founder duradoura associada ao passe; não release. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/founders-final-sale-liability-20261006` | `THIS_CONTROL_PLANE_COMMIT` após candidato `8ef9bbe27ff1f74dd8d1f7f6e6f7abb180497150` | `founders-sale-rules-final-delta-20261006` (sem upstream) | **CURRENT_CONTROL_PLANE** | Delta final pós-auditoria implementado e recertificado localmente; auditoria independente pendente; não release. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001` | o commit da L-030 (03/10, revisão 8; só docs; filho do commit da L-029 `7622248`, → C2 `57d78eb` → C1 `53cd85a`; SHA via `git rev-parse`) | `early-access-phase2-email-double-optin-20261001` | **CURRENT_WORK** (Fase 2 fechada) | Linha `9f2ddcb` → C1 `f4af976` (FAIL) → C1b `f1b4ec1` (CERTIFIED_EXACT_SHA, Fase 1) → C2 `74f37f5` → **C1 `53cd85a` (CERTIFIED_EXACT_SHA, Fase 2, L-027)** → C2 da Fase 2 `57d78eb` (só docs, não CERTIFIED) → commit da L-029 (só docs: ensaio + reconciliação ao vivo). Working tree **limpo**. **Única worktree onde se trabalha.** Tem `node_modules/` e `.next/` (gitignored). *(Linhas anteriores: revisão 4 HEAD `f1b4ec1`; revisão 5 HEAD `74f37f5` com a Fase 2 não commitada — histórico.)* |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/whitelist-fundraising-readiness-20261001` | `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` | `whitelist-fundraising-readiness-20261001` | **COMMITTED_FEATURE_CHECKPOINT** (Fase 1; recert de `9f2ddcb` BLOCKED) | Onde a Fase 1 foi feita e commitada. Congelar e não desenvolver aqui. A Fase 1 certificada é o C1b `f1b4ec1`, na worktree de trabalho. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/recert-0d21874-20261001T010514Z` | `0d21874b4147bb8a0b232aa0abc2302471a720e5` | detached | **CERTIFIED_EXACT_SHA** (era "CERTIFIED_BASE") | Árvore exata da recertificação do runtime. Referência de bytes. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/final-closure-20260930T131123Z` | `43c484bd1fdc24cdbd8182914514d80d769deeb2` | `preprod-final-closure-20260930T131123Z` (upstream origin, 0/0) | **DOCS_BASELINE** (era "CERTIFIED_BASE") · `CERTIFIED_RUNTIME_ANCESTOR=0d21874` · `DELTA=DOCS_ONLY` · `EXACT_SHA_RECERTIFIED=NO` | Head do PR #447. O código é o de `0d21874`, mais docs. |
| `/home/zetta/zswap-claude-audit` | `43c484bd1fdc24cdbd8182914514d80d769deeb2` | detached | **AUDIT_CHECKOUT** | Checkout de leitura para auditoria independente do `43c484b`. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/blocker-closure-20260929T111136Z` | `16e4000f969674aa704b6ea304587709b13de6c3` | `preprod-blocker-closure-20260929T111136Z` (sem upstream) | **HISTORICAL_EVIDENCE** | Campanha de blocker closure de 29/09. Substituída por `0d21874`. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/candidate` | `691bfdc6917de621b59d1092eec3ceeeea5d8c90` | detached | **HISTORICAL_EVIDENCE** | ⚠️ O **nome engana**: era o candidato de 26–28/09 (PC-B3). **Não é** o candidato atual. |
| `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/prod-current` | `25fc4b0fa55db72472c7ae00af42596209d7c362` | detached | **HISTORICAL_EVIDENCE** (espelho da produção) | Código que a produção roda segundo o último registro `[VERCEL]` (26/09). Usado como baseline do PRODCLONE. |
| `/home/zetta/swap-z-app` | `d7741bb1c10552a61810ed86f76d86715b087115` | `kimi/round2-audit-fixes` (sem upstream) | **OBSOLETE_PRESERVE** | ⚠️ Worktree **principal** do repo, parada no **fim do Round 1** (15/09). O nome "round2" engana: o HEAD é o do Round 1. Ela guarda o `.git` comum a todas as outras, então **nunca** a remova. |

Nenhuma worktree é **SAFE_TO_REMOVE_LATER** sem decisão do dono.
`blocker-closure`, `candidate` e `/home/zetta/zswap-claude-audit` são
candidatas naturais, porque os SHAs delas continuam alcançáveis por outros
refs. A remoção só pode acontecer depois que as campanhas que citam esses
caminhos forem arquivadas.

## 2. Branches locais (`refs/heads/*`)

| branch | SHA | upstream | observação |
|---|---|---|---|
| `early-access-phase2-email-double-optin-20261001` | commit da L-030 (03/10, revisão 8; filho de `7622248`) | nenhum | CURRENT_WORK; **não existe no GitHub** |
| `whitelist-fundraising-readiness-20261001` | `9f2ddcb` | nenhum | Fase 1; **não existe no GitHub** |
| `preprod-final-closure-20260930T131123Z` | `43c484b` | `origin/…` 0/0 | PR #447 |
| `preprod-blocker-closure-20260929T111136Z` | `16e4000` | nenhum | histórico |
| `main` | `25fc4b0` | `origin/main` | = produção |
| `kimi/round2-audit-fixes` | `d7741bb` | nenhum (`vscode-merge-base` → `origin/claude/swap-z-recovery-deploy-b7y2cw`) | fim do Round 1 |
| `claude/swap-z-recovery-deploy-b7y2cw` | `d7741bb` | `origin/…` | fim do Round 1 (head dos PRs da auditoria externa, p.ex. #423–#446) |

## 3. Refs remotos (`refs/remotes/origin/*`) contra o PRODUCT_BASE_SHA `9f2ddcb`

Método: `merge-base --is-ancestor`, `git cherry` (patch-id) e, para os commits
`+`, comparação de conteúdo com o squash correspondente. O detalhe por
branch está em `docs/AUDIT-RECONCILIATION.md` §2.

| ref | SHA | relação com `9f2ddcb` |
|---|---|---|
| `origin/main`, `origin/HEAD` | `25fc4b0` | ANCESTOR |
| `origin/round9-surgical` | `798fe27` | ANCESTOR (congelada) |
| `origin/preprod-final-closure-20260930T131123Z` | `43c484b` | ANCESTOR (PR #447) |
| `origin/claude/swap-z-recovery-deploy-b7y2cw` | `d7741bb` | ANCESTOR |
| `origin/backup`, `origin/backup-pre-desktop-20260706`, `origin/preview`, `origin/feature/hybrid-ai-orchestrator` | vários | ANCESTOR |
| `origin/platform-closure` | `4cf073a` | **DIVERGENTE**: 10 commits à frente, **todos só em `docs/`** (§4) |
| 22 branches `origin/claude/*` + `origin/vercel-agent/function-regions-gru1` | — | 1 commit cada, **patch-equivalente** a um squash na linha (`git cherry` = `-`) |
| `origin/claude/estado-atual-vazamento` | `0b12daf` | 3 commits `+`; o conteúdo de `src/` e `supabase/` é **idêntico** ao squash `08c4f82` (#346) |
| `origin/claude/plano-dca-automatico` | `c9e12a5` | 8 commits `+`; os arquivos DCA são **idênticos** ao squash `628089e` (#348) |
| `origin/claude/pools-soon-tier` | `0701327` | 1 commit `+`, **ausente da linha**: SUPERSEDED pela decisão oposta, `e369cc6` (#376, "/pools aberta para todos") |

Nenhum ref remoto contém `9f2ddcb`: `git branch -r --contains 9f2ddcb` sai vazio.
Na revisão 4 (02/10), `git branch -r --contains f1b4ec1` também sai vazio:
C1 e C1b são só locais.

## 4. A divergência `platform-closure` × linha atual

`origin/platform-closure` (`4cf073a69d293ccd2ed28d48f92367656621bc12`) e a
linha preprod saem do mesmo pai, `691bfdc6917de621b59d1092eec3ceeeea5d8c90`
(`git merge-base` = `691bfdc`).

| commit exclusivo de `platform-closure` | data | tipo |
|---|---|---|
| `391c633` LEDGER-MESTRE §Z + ESTADO-ATUAL: Release Phases 1–3 e Batch 3 | 26/09 | docs |
| `e5027dc` LEDGER-MESTRE §ZB + ESTADO-ATUAL: Release Phase 3B | 27/09 | docs |
| `5fd960b` LEDGER-MESTRE §ZB: P2 Attempt 2 | 27/09 | docs |
| `c3a9aca` LEDGER-MESTRE §ZB: relatório 0059→0067 | 27/09 | docs |
| `5dee152` PLANO-MESTRE-AUDITORIA (FASE 0→33) | 28/09 | docs |
| `fff6a7b`, `22ff06e`, `ec0dc0c`, `4140207`, `4cf073a` PLANO-PROD-CLONE-LAB | 28/09 | docs |

`git diff --stat 691bfdc origin/platform-closure` toca **só** estes arquivos:
`docs/ESTADO-ATUAL.md`, `docs/LEDGER-MESTRE-RELEASE.md`,
`docs/PLANO-MESTRE-AUDITORIA.md`, `docs/PLANO-PROD-CLONE-LAB.md` e
`docs/README.md`.

**Conclusão:** nenhuma correção de código ficou só em `platform-closure`
(medido: o diff exclusivo toca só `docs/`). Isso não fala de A08/A09/A10/A17,
que seguem sem fonte (`AUDIT-RECONCILIATION.md` §4.1). O que
ficou de fora da linha atual é **documentação**: o ledger §Z/§ZB, o plano mestre
da auditoria (FASE 0→33) e o plano do prod-clone lab. Isso é uma lacuna
documental, OPEN_NONBLOCKING. `RELEASE-RUNBOOK.md` §8 já registra que ela deve
ser mesclada à parte. **Nenhum merge foi feito.**

Para ler esses documentos sem merge:

```bash
git show origin/platform-closure:docs/PLANO-MESTRE-AUDITORIA.md
git show origin/platform-closure:docs/PLANO-PROD-CLONE-LAB.md
git show origin/platform-closure:docs/LEDGER-MESTRE-RELEASE.md   # §Z, §ZB
```

## 5. Runtime local (Acer) ≠ Git

| stack | porta | fingerprint do history | o que representa |
|---|---|---|---|
| LAB | 3310 | `d3f1586033084188` (67 migrations) | repo 0001→0067 |
| DEMO | 3410 | `d3f1586033084188` (67) | repo 0001→0067 |
| PRODCLONE baseline | 3510 | `c450508f51dd4be2` (55 linhas) | history real de produção, capturado |
| PRODCLONE candidate | 3520 | `16db731d771055ff` (64 = 55 + 0059–0067) | produção + delta do release |

Fonte: `reports/postreboot-20261001T1225Z/POST-REBOOT-CLOSURE.md` e o check das
14:40 em `state/unattended-boot-20261001T1557Z/evidence/`. **Nenhuma stack tem
a 0068** (Early Access): ela só foi provada em Postgres descartável.
