# AI OPERATING RULES — protocolo para qualquer IA (e humano) no Z-SWAP

> Função deste documento: **método**. Ele não descreve o estado: o estado está
> em `docs/START-HERE.md` e `docs/CURRENT-STATE.md`.
> Criado em 01/10/2026 sobre `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`.
> Revisão 3 (01/10/2026): ciclo de vida com commit candidato antes da recert
> (CP-01), identidade por base de produto (CP-02), termos de certificação
> (CP-03), mural (CP-06).

---

## 1. Antes de QUALQUER trabalho: verificar identidade

```bash
pwd
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --short
```

Compare com `docs/START-HERE.md` §2 e §10. O HEAD **não** é um valor fixo:
commits de control plane (`CLAUDE.md`, `AGENTS.md`, `docs/**`) o mudam
legitimamente. A referência fixa é o `PRODUCT_BASE_SHA`
(`9f2ddcbe45f9f93c9a33c331e31e32c45d410019`) e, para a fase em curso, o
`PHASE_BASE_SHA` registrado no ledger antes da implementação (a Fase 2 usou
`74f37f50d12dae698f14b620914bc0ce5b0c639a`, L-020, e está fechada desde L-027;
a próxima fase parte do C2 da Fase 2).

Delta de produto, com exclusão explícita do control plane:

```bash
git diff --stat "$PRODUCT_BASE_SHA"..HEAD -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'
```

| resultado | ação |
|---|---|
| branch esperada; `PRODUCT_BASE_SHA` ancestral; árvore limpa; todo commit depois da base explicado no ledger/`RELEASE-CHAIN.md`; delta de produto vazio ou exatamente o autorizado no ledger | prosseguir; registrar o HEAD medido |
| sem ancestralidade, commit sem explicação no ledger, ou delta de produto não autorizado | **ABORT** e reportar |
| worktree suja que você não criou | **ABORT** e reportar; não fazer stash, reset ou checkout — **exceto** quando o `START-HERE.md` §10 declara uma campanha autorizada ainda não commitada e o delta confere exatamente com o registrado no ledger: aí prossiga **sem** limpar nada (hoje não há nenhuma: a Fase 2 foi commitada, L-027) |

> Não crie verificação que se invalida quando o próprio documento é
> commitado (ex.: "HEAD = SHA fixo" ou "diff fora de `docs/` vazio" quando o
> commit toca `CLAUDE.md`/`AGENTS.md`).

> ⛔ **Mismatch = ABORT.** Não "conserte" o lugar com `checkout`, `reset`,
> `stash` ou `rebase` sem autorização. O lugar errado pode ser a worktree
> certificada de outra campanha.

## 2. Se a tarefa depende do GitHub

```bash
git fetch origin --tags --prune     # permitido: só lê
```

Depois meça **separadamente** os refs locais (`refs/heads/*`) e os remotos
(`refs/remotes/origin/*`). `gh` é **somente leitura**: `pr view`, `pr list`,
`run list`. Nenhuma mutação: sem comentário, label, review, merge ou rerun.

## 3. Nunca assumir

| ❌ suposição | por que é falsa aqui |
|---|---|
| branch local == GitHub | `9f2ddcb` **não existe no GitHub** (sem push); `main` local e `origin/main` coincidem hoje por acaso |
| GitHub == runtime do Acer | as stacks LAB/DEMO/PRODCLONE rodam imagens e bancos locais com fingerprints próprios |
| runtime do Acer == produção | a produção roda `25fc4b0` (último registro: 26/09) com o banco no nível 0058 |
| nome de worktree == estado | `candidate/` está em `691bfdc`, que **não** é o candidato atual |
| nome de documento mais novo == autoridade maior | ver `docs/DOCUMENT-AUTHORITY.md` |
| "status 🟢" num PLANO == verdade hoje | muitos planos 🟢 são históricos |
| SHA diferente == correção ausente | squash-merge muda o SHA; ver `docs/AUDIT-RECONCILIATION.md` |
| texto parecido == correção presente | é preciso provar por ancestralidade, patch-id ou diff |

## 4. Nunca, sem autorização explícita do dono na conversa corrente

> ⛔ **merge** · **push** · **deploy** (Vercel, preview ou produção) ·
> **banco de produção** (leitura ou escrita) · **Supabase hospedado**, inclusive
> o staging `nvbrzifyurslegudlhaz` · **credencial real** · **trade real** ·
> **exposição pública** (Tailscale Funnel/Serve, porta pública) ·
> **reiniciar serviço ou stack** do laboratório · **sudo**

Também nunca, nem com pressa:

- editar migration existente (corrige-se com migration NOVA);
- apagar branch, worktree, evidência ou documento histórico;
- "melhorar" número do flywheel ou de backtest sem entender os filtros (ver
  `CLAUDE.md`);
- marcar um SHA `RELEASE_CANDIDATE` sem certificação correspondente;
- transformar FAIL em PASS por retry: falha intermediária fica na evidência.

## 5. Toda nova fase segue estes 11 passos, nesta ordem

O SHA exato só existe **depois** do commit. Por isso a recertificação vem
depois do commit candidato (C1), e o registro do resultado vai num segundo
commit, só de control plane (C2). Revisões 3 (CP-01) e 4 (CP-09).

1. **Branch e worktree isoladas**, com nome datado.
2. **Base medida e registrada** (`PHASE_BASE_SHA`) em
   `docs/LAUNCH-READINESS-LEDGER.md` (entrada nova).
3. **Plano** em `docs/PLANO-*.md`, com status, **antes** do código.
4. **Implementação.**
5. **Auditoria**: adversarial, de preferência independente.
6. **Correções** dos findings.
7. **Validação pré-commit** (type-check, lint, testes alvo). Ela não é
   certificação.
8. **Commit candidato C1** (`CANDIDATE_SHA`): implementação, correções e docs
   autorizados.
9. **Recertificação COMPLETA no SHA exato de C1**: `npm ci`, build,
   type-check, lint, suíte completa, arneses SQL relevantes. Evidência fora do
   repo, com `MANIFEST.sha256`.
10. **Commit de atestação C2** (`CONTROL_PLANE_ATTESTATION_COMMIT`), só se
    RECERT(C1)=PASS (§5.1).
11. **Só então** a próxima fase, partindo de C2.

### 5.1 O commit de atestação C2

Registrar o resultado da recert muda o working tree (ledger,
`CURRENT-STATE.md`, …), e esse delta precisa ser commitado. Esse commit é C2.

- **Conteúdo:** **somente** `docs/**`; `CLAUDE.md`/`AGENTS.md` só se for
  realmente necessário. Nada de código, teste, migration ou `package*.json`.
- **Registra:** `CERTIFIED_FEATURE_SHA=<C1>`, `RECERT_RESULT=PASS`, o caminho
  da evidência da recert e o `MANIFEST.sha256` dela.
- **C2 NÃO é chamado `CERTIFIED`.** Quem é certificado é C1.
- **Prova obrigatória** (registrada no ledger):

  ```bash
  git diff --stat <C1>..<C2> -- . ':!docs/**' ':!CLAUDE.md' ':!AGENTS.md'   # TEM que sair vazio
  git merge-base --is-ancestor <C1> <C2> && echo OK-ANCESTOR
  ```

- **Depois:** `CONTROL_PLANE_HEAD=<C2>` e `CERTIFIED_FEATURE_SHA=<C1>`.
  **`CERTIFIED_FEATURE_SHA` não é necessariamente o `CONTROL_PLANE_HEAD`**: o
  primeiro é o SHA cujo produto foi recertificado; o segundo é o último commit
  de control plane por cima dele.
- A próxima fase pode partir de C2 (vira o `PHASE_BASE_SHA` dela) porque o
  produto de C2 é byte-equivalente ao de C1, exceto pelo control plane.
- **Deploy de C2 continua proibido**, a menos que C2 (ou um descendente) seja
  recertificado no SHA exato e marcado `RELEASE_CANDIDATE` (§6.1).

### 5.2 Se RECERT(C1) falhar

- **não** criar atestação PASS;
- **não** fazer retry-to-pass nem reclassificar o FAIL;
- registrar o FAIL no ledger (entrada nova; pode ir num commit só de docs, que
  **não** é atestação PASS);
- corrigir, criar um commit novo **C1b** e recertificar **C1b inteiro**;
- só um PASS no SHA exato de C1b abre a atestação C2.

## 6. Política de deploy e conflitos de regra

### 6.1 POLÍTICA DE DEPLOY: decisão formal do dono, 01/10/2026

> ⛔ A regra de 31/08 *"todas as correções… têm que ir para produção
> sempre"* (`ESTADO-ATUAL.md`) está **FORMALMENTE SUSPENSA** para a atual
> linha de fechamento e release.
>
> **Nenhum commit, branch ou worktree pode ir para produção
> automaticamente.** Deploy só pode ocorrer quando houver as quatro coisas:
>
> 1. um **SHA explícito**;
> 2. esse SHA **marcado `RELEASE_CANDIDATE`** no ledger
>    (`docs/RELEASE-CHAIN.md` + `docs/LAUNCH-READINESS-LEDGER.md`);
> 3. a **certificação correspondente em PASS** naquele SHA;
> 4. **autorização explícita do dono** para aquele deploy.
>
> Até lá: `PRODUCTION=UNTOUCHED` · `VERCEL=DEFERRED_EXTERNAL_PAYMENT` ·
> `RELEASE_CANDIDATE=NONE`.

Registro: `LAUNCH-READINESS-LEDGER.md` L-012. Aviso no topo de
`ESTADO-ATUAL.md`.

### 6.2 Outros conflitos

| regra | origem | vale para esta linha? |
|---|---|---|
| "todas as correções… têm que ir para produção sempre" | dono, 31/08 | **NÃO: SUSPENSA formalmente** (§6.1) |
| "Retomada de sessão: `docs/ESTADO-ATUAL.md` primeiro" | `CLAUDE.md` (antigo) | **Substituída.** `CLAUDE.md` agora começa pelo bloco "Claude Code Entry Point" → `docs/START-HERE.md`. `ESTADO-ATUAL.md` vale para lições e armadilhas |
| "documentar ANTES de implementar" | `CLAUDE.md` | **SIM**, sempre |
| "escrever no mural antes de mexer em algo grande" | `CLAUDE.md` (antigo) | **Substituída (revisão 3).** `scripts/mural.mjs` usa Supabase hospedado com credencial real: **não usar automaticamente**. Só com autorização explícita do dono para o Supabase hospedado. Sem ela, registrar a coordenação no ledger, na documentação ou no chat corrente |
| "best-effort em volta de dinheiro" | `CLAUDE.md` (antigo) | **Reescrita (revisão 3).** Best-effort só para telemetria/observabilidade não crítica onde o código já o desenha assim. Autorização, estado financeiro, risco, ordem, settlement, credencial, recovery e todo caminho que possa mover dinheiro **falham fechado** conforme os gates atuais. Única exceção documentada no código: o kill-switch de `/api/quote` falha aberto (o usuário ainda assina a transação), com falha de leitura registrada como evento de segurança (`src/lib/admin/kill-switches.ts`) |

Quando duas regras conflitam e nenhuma linha acima resolve: **a mais
restritiva vence**, e o conflito vira OWNER_DECISION no ledger.

## 7. Linguagem obrigatória nos documentos

- Status em palavras fixas: `CURRENT`, `CERTIFIED`, `HISTORICAL`,
  `SUPERSEDED`, `BLOCKED`, `DEFERRED`, `NOT_STARTED`, `RELEASE_CANDIDATE`,
  `COMMITTED_FEATURE_CHECKPOINT`, `BLOCKED_NOT_STARTED`, `CURRENT_DEVELOPMENT`.
- **`CERTIFIED` é reservado** para SHA cuja recertificação no SHA exato esteja
  PASS. SHA commitado sem essa recert é `COMMITTED_FEATURE_CHECKPOINT`, mesmo
  que tenha sido designado antes de outra forma (preservar a designação
  antiga no histórico).
- Toda ocorrência de "certified" num documento do control plane tem de ser
  uma destas (revisão 4, CP-10):

  | termo | significa | hoje |
  |---|---|---|
  | `CERTIFIED_EXACT_SHA` | recertificação completa **naquele SHA exato** em PASS, com evidência | `0d21874b4147bb8a0b232aa0abc2302471a720e5` (runtime) e `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (Early Access Fase 1, L-019) e `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (Early Access Fase 2, L-027) |
  | `CERTIFIED_RUNTIME_ANCESTOR` | o SHA não foi recertificado; um **ancestral** dele foi, e o delta é conhecido (ex.: só docs) | `43c484b` → ancestral `0d21874`, `DELTA=DOCS_ONLY` |
  | `HISTORICAL_CERTIFICATION_LEGACY` | chamado "certified" antes da revisão 3, sem prova de recert exata pelo critério atual. História preservada, não vale como certificação hoje | R9 `798fe27`, PC-B1 `a5bdd61`, PC-B2 `3123fb4` |

  Ambiente (laboratório Acer, host) não é SHA: usa `LAB_ENV_VERIFIED`.
  Finding usa `FIXED_CERTIFIED` qualificado por um dos três termos acima.
- `CONTROL_PLANE_ATTESTATION_COMMIT` (C2) **nunca** é chamado `CERTIFIED`.
- Contagens de auditoria separam o conhecido do desconhecido:
  `KNOWN_MISSING_CORRECTIONS` e `UNKNOWN_FINDINGS`. Nunca afirmar "nenhuma
  correção está fora da linha" enquanto houver finding sem fonte.
- Estado de segredo/ambiente não medido não é afirmado como "inexistente":
  usar `NOT_VERIFIED` ou `NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN`.
- Proibido "deve estar", "parece", "provavelmente", "o último" **sem SHA ou
  evidência** ao lado.
- Todo SHA importante aparece completo (40 hex) pelo menos uma vez.
- Caminho operacional local é sempre absoluto.
- Toda afirmação diz a fonte: Git, CI, documento, relatório local, ou
  "dono, não provado".

## 8. Onde cada coisa é escrita

| quero registrar… | escrevo em |
|---|---|
| "o estado agora mudou" | `docs/CURRENT-STATE.md` (substitui) + `docs/LAUNCH-READINESS-LEDGER.md` (acrescenta) |
| uma fase nova, um SHA novo ou uma certificação | `docs/LAUNCH-READINESS-LEDGER.md` + `docs/RELEASE-CHAIN.md` |
| um finding novo ou uma mudança de status de finding | `docs/AUDIT-RECONCILIATION.md` §5 (acrescenta, não apaga) |
| um documento novo, ou um que deixou de valer | `docs/DOCUMENT-AUTHORITY.md` |
| uma worktree ou branch nova | `docs/GIT-AND-WORKTREE-MAP.md` |
| evidência bruta (logs, saída de teste) | **fora do repo**: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/{evidence,reports}` |
