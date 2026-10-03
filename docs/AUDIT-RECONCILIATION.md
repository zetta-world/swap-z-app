# AUDIT RECONCILIATION — as correções estão na linha atual?

> Função: **provar**. Este documento responde a pergunta
> **"TODAS AS CORREÇÕES DAS AUDITORIAS ESTÃO NA LINHA ATUAL?"**, campanha por
> campanha, com o método escrito ao lado. Ele também é o **registro único de
> findings** (§5).
>
> Alvo: `9f2ddcbe45f9f93c9a33c331e31e32c45d410019` (PRODUCT_BASE_SHA). Medido
> em 01/10/2026, depois de `git fetch origin --tags --prune`. Revisão 3:
> semântica das contagens corrigida (CP-04) e termos de certificação (CP-03).
> Revisão 4: certificação sempre qualificada (CP-10) — `CERTIFIED_EXACT_SHA`
> (só `0d21874`), `CERTIFIED_RUNTIME_ANCESTOR`, `HISTORICAL_CERTIFICATION_LEGACY`;
> ambiente usa `LAB_ENV_VERIFIED`.
> Revisão 6 (02/10/2026): RECERT(C1b)=PASS; `CERTIFIED_EXACT_SHA` também
> `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (Early Access Fase 1); §5.5 acrescida.

## Resposta curta (a longa está nas tabelas)

| pergunta | resposta |
|---|---|
| alguma correção de **código** de auditoria está fora da linha atual? | **Nenhuma correção CONHECIDA e identificável foi encontrada fora da linha;** A08/A09/A10/A17 permanecem sem fonte e não permitem conclusão. Toda branch `origin/claude/auditoria-*` é patch-equivalente a um squash que já está na linha (§2) |
| algum commit remoto de código está fora da linha? | **Um:** `origin/claude/pools-soon-tier` (`0701327`). É uma feature de produto, **não** correção de auditoria. Está SUPERSEDED pela decisão contrária `e369cc6` (#376) |
| alguma **documentação** de auditoria está fora da linha? | **SIM.** O ledger §Z/§ZB, `PLANO-MESTRE-AUDITORIA.md` e `PLANO-PROD-CLONE-LAB.md` estão só em `origin/platform-closure` (§3) |
| algum finding tem prova incompleta? | **SIM.** A08, A09, A10 e A17 da auditoria externa: **SOURCE_NOT_FOUND** depois de 2 buscas forenses, e seguem UNKNOWN_REQUIRES_REVIEW (§4.1) |

`KNOWN_MISSING_CORRECTIONS = 0` · `UNKNOWN_FINDINGS = 4` (A08, A09, A10, A17:
SOURCE_NOT_FOUND, UNKNOWN_REQUIRES_REVIEW).

> A contagem `0` vale **só para correções conhecidas e identificáveis**. Para
> A08/A09/A10/A17 não há fonte; nada se pode concluir sobre elas estarem ou
> não na linha. Nenhuma descrição foi inventada.

### Legenda do método

| marca | significa | comando |
|---|---|---|
| **ANCESTRY** | o próprio commit está na história do alvo | `git merge-base --is-ancestor <c> 9f2ddcb` |
| **PATCH-EQ** | outro SHA com o mesmo patch está no alvo (squash ou cherry-pick) | `git cherry 9f2ddcb <branch>` → `-`; casamento por `git patch-id --stable` |
| **CONTENT-EQ** | o patch difere, mas o conteúdo final dos arquivos é idêntico ao de um commit do alvo | `git diff <branch> <commit-do-alvo> -- <paths>` vazio |
| **REIMPL** | reimplementado de outra forma (precisa de leitura humana) | — |
| **MISSING** | ausente | — |
| **UNKNOWN_REQUIRES_REVIEW** | sem prova suficiente para nenhum dos acima | — |

---

## 1. Rounds e etapas de fechamento (linha principal)

Todos os SHAs abaixo dão **ANCESTRY = YES** contra `9f2ddcb`. Não há ref
remoto por round (exceto R9), então a evidência é o corpo dos commits e os docs
`[LEDGER-MESTRE-RELEASE.md §B–§M]`.

| etapa | base → fim | commits | findings | migrations | estado | evidência | pendências |
|---|---|---|---|---|---|---|---|
| Auditoria externa (pré-R1) | … → `25fc4b0` | PRs #417–#446 | A01–A30 (8 altos, 21 médios, 1 baixo) | 0047–0049 | **INTEGRATED** (30/30 PRs ANCESTRY, conferido 1 a 1 via `gh pr view`) | CI 34986267827 | A08/A09/A10/A17 sem PR (§4.1); 5 decisões do dono (§5) |
| Round 1 | `25fc4b0` → `d7741bb` | 2 | A80, A81, A100–A115 | 0050–0054 | **INTEGRATED** | corpo dos commits | retest histórico incompleto |
| Round 2 | `d7741bb` → `6b08172` | 12 (3 merges) | A116, A117, A112, A110 r2, A115, A103, Ponto 9 | 0055–0058 | **INTEGRATED** | idem | idem |
| Round 3 | `6b08172` → `1325bd3` | 14 (3 merges) | A118, A119, A110 r3, A103, A80/A102 | 0059, 0060 | **INTEGRATED** | idem | idem |
| Round 4 | `1325bd3` → `1cb82ce` | 7 (2 merges) | A120, A121 | 0061 (0059 editada) | **INTEGRATED** | idem | idem |
| Round 5 | `1cb82ce` → `bd30dea` | 8 (2 merges) | A120-H, A122, A123 | 0062 (0059, 0061 editadas) | **INTEGRATED** | idem | idem |
| Round 6 | `bd30dea` → `e536c40` | 3 | A124 | — | **INTEGRATED** | idem | idem |
| Round 7 | `e536c40` → `15b89c8` | 3 | A125, A126 | — | **INTEGRATED** | idem | idem |
| Round 8 | `15b89c8` → `83c50fe` | 7 | A127, A128, A129, A125-ABSENCE, A130, A130-B | 0063 | **INTEGRATED** | suíte 3586/3586 `[LOCAL]` | R8-CORRIDA aberta |
| Round 9 | `83c50fe` → `798fe27` | 24 (Git; o `LEDGER-MESTRE` §K diz 25) | A131–A145, A139-H, Q/F, CR-1…5, CRX-1, TOCTOU | 0064 (0063 editada) | **INTEGRATED** · HISTORICAL_CERTIFICATION_LEGACY | `docs/SPEC-round9.md`, `docs/entrega-round9.md`, `supabase/tests/01–10` | — |
| PC Batch 1 | `798fe27` → `a5bdd61` | 4 | A51, A61, A62, PC-3 | 0065 | **INTEGRATED** · HISTORICAL_CERTIFICATION_LEGACY | `supabase/tests/11`, CI 35985516785 | — |
| PC Batch 2 | `a5bdd61` → `3123fb4` | 6 | A58, A59, A86, A96, A97 | 0066 | **INTEGRATED** · HISTORICAL_CERTIFICATION_LEGACY | `docs/retest-independente-batch2-3123fb4.md` | — |
| PC Batch 3 | `3123fb4` → `691bfdc` | 3 (`afe2665` docs + `.gitattributes`; `6fded4c` docs; `691bfdc` 0067 + testes) | DB-ACL-FINANCIAL-TABLES | 0067 | **INTEGRATED** | `supabase/tests/14`; "PASS WITH DELTA" `[DONO]` | staging rollback/rebuild INCOMPLETE |
| Preprod | `691bfdc` → `16e4000` | 3 | estabilidade de backtest, achados da auditoria independente do preprod, harnesses, T13 estável | — | **INTEGRATED** | `reports/blocker-closure-20260929T111136Z/27-*` | HARNESS-001/002 |
| Supply chain | `16e4000` → `0d21874` | 1 | GHSA-vcvr-r3jv-pc5j (next/og RCE, CRITICAL), axios HIGH, image-size, `@solana/spl-token` | — | **INTEGRATED** · CERTIFIED_EXACT_SHA (`0d21874`) | `docs/RELEASE-RUNBOOK.md` §2–§3 | 36 moderate / 1 low |
| Early Access F1 | `43c484b` → `9f2ddcb` | 1 | F-01…F-16 (hardening F-02/03/04/06/07/08/10/12) | 0068 | **INTEGRATED** (é o PRODUCT_BASE_SHA; COMMITTED_FEATURE_CHECKPOINT) | `docs/PLANO-EARLY-ACCESS.md` §14–§15 | F-01 OPEN_BLOCKER na Fase 1 (hoje: FIXED_CERTIFIED, `CERTIFIED_EXACT_SHA` `53cd85a`, §5.5.4); recert no SHA commitado `9f2ddcb` BLOCKED (EA-TEST-F10-FLAKY, §5.5) → **RECERT(C1b)=PASS**: Fase 1 `CERTIFIED_EXACT_SHA` em `f1b4ec1` (§5.5, ledger L-019) |

**"Round 0":** não existe nenhuma referência na árvore, nos commits ou nas
branches. A auditoria de 30 achados é "pré-Round 1" (`LEDGER-MESTRE` §B).
**Round 7** existe (`e536c40` → `15b89c8`). **`round8-surgical`** não tem ref
remoto; o histórico dele está dentro de `origin/round9-surgical`.

## 2. Branches remotas de auditoria e correção (fora da linha first-parent)

Cada uma tem 1 commit exclusivo, exceto onde indicado. O alvo do squash foi
encontrado por `git patch-id --stable` contra todos os commits do alvo
posteriores a 01/06/2026.

| branch remota | HEAD | merge-base | encontrado no alvo como | método | estado |
|---|---|---|---|---|---|
| `origin/claude/auditoria-pre-lancamento` | `f9f9781` | `5c2ef17` | `6b8f80f` (#373) "O painel de ordens do Pro nao coloca ordem…" | PATCH-EQ | **INTEGRATED** |
| `origin/claude/auditoria-ponte-correcoes` | `72530b6` | `0187acc` | `2c1339f` (#336) "Auditoria da ponte: o valor que mudava sozinho…" | PATCH-EQ | **INTEGRATED** |
| `origin/claude/auditoria-ponte-lote2` | `632c0c1` | `2c1339f` | `3236738` (#337) "O destinatário de outra rede…" | PATCH-EQ | **INTEGRATED** |
| `origin/claude/auditoria-ponte-lote3` | `f7924c5` | `3236738` | `7814ad1` (#338) "Fecha a ponte…" | PATCH-EQ | **INTEGRATED** |
| `origin/claude/auditoria-limite-dca` | `b429ff6` | `08c4f82` | `9188722` (#347) "Auditoria LIMIT/DCA: os nove achados, e o décimo…" | PATCH-EQ | **INTEGRATED** |
| `origin/claude/autopilot-registro-critico` | `42ea1ff` | `7814ad1` | `f27591e` (#340) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/estado-atual-auditorias` | `5cc9b96` | `af886d7` | `c1b2ec3` (#342) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/dca-cron-medido` | `b8f6a83` | `6e824e4` | `3f425fe` (#357) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/dca-gate-proprio` | `bd26117` | `3f425fe` | `143df6d` (#358) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/dca-modo-simulado` | `693b3b0` | `a2a7f15` | `38fe1fc` (#349) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/dca-sem-cofre` | `9300dc2` | `155900f` | `6e824e4` (#356) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/divida-laranja` | `444789c` | `6dce334` | `155900f` (#353) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/einherjar-plano-migration` | `63242fd` | `c1b2ec3` | `bfb5ab5` (#343) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/einherjar-ui` | `5af4303` | `bfb5ab5` | `f1c9174` (#344) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/einherjar-vazamento-cliente` | `15d8b8a` | `f1c9174` | `7aaf2e8` (#345) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/mural-cli` | `9fcff01` | `38fe1fc` | `2e6271b` (#351) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/mural-env-raiz` | `606ef21` | `2e6271b` | `6dce334` (#352) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/plano-mural` | `d39d627` | `f27591e` | `af886d7` (#341) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/pools-falha-visivel` | `0ea70de` | `6b8f80f` | `cb4a911` (#374) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/pools-faixas-por-tier` | `0d60cc6` | `cb4a911` | `e369cc6` (#376) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/binance-gru1-regiao` | `b2613ab` | `ea111e9` | `fe1a555` (#293) | PATCH-EQ | **INTEGRATED** |
| `origin/claude/zettaword-project-audit-ggsgxx` | `2c33b84` | `0fae331` | `c49b239` (#108) | PATCH-EQ | **INTEGRATED** |
| `origin/vercel-agent/function-regions-gru1` | `11235e0` | `e5d2f3f` | `c4952bb` | PATCH-EQ | **INTEGRATED** |
| `origin/claude/estado-atual-vazamento` (3 commits `+`) | `0b12daf` | `7aaf2e8` | `08c4f82` (#346) ÚLFHÉÐNAR | CONTENT-EQ (`git diff 0b12daf 08c4f82 -- src supabase` vazio) | **INTEGRATED** (squash) |
| `origin/claude/plano-dca-automatico` (8 commits `+`) | `c9e12a5` | `9188722` | `628089e` (#348) DCA automático | CONTENT-EQ (diff vazio em `src/lib/dca`, `DcaPanel.tsx`, 0031, 0032) | **INTEGRATED** (squash) |
| `origin/claude/pools-soon-tier` (1 commit `+`) | `0701327` | `6b8f80f` | **ausente**: `PoolsSoon.tsx` não existe e `/pools` não tem `TierGate` | — | **SUPERSEDED** por `e369cc6` (#376), que abriu `/pools` para todos com TTL por tier (decisão oposta, 31/08). Não é correção de auditoria |

Nota sobre a 2ª auditoria de LIMIT/DCA: `0b87ac1` (#360, "o teto diário era um
teto por plano") entrou direto na `main` e é ANCESTRY.

## 3. Platform Closure: o que entrou e o que não entrou

`origin/platform-closure` = `4cf073a69d293ccd2ed28d48f92367656621bc12`;
merge-base com o alvo = `691bfdc6917de621b59d1092eec3ceeeea5d8c90`.

| pergunta | resposta | prova |
|---|---|---|
| quais commits de runtime entraram na preprod? | **todos** os de `798fe27..691bfdc`: PC-1/2/3, a5bdd61, Batch 2, Batch 3 / 0067 | ANCESTRY |
| quais commits ficaram só na platform-closure? | 10: `391c633`, `e5027dc`, `5fd960b`, `c3a9aca`, `5dee152`, `fff6a7b`, `22ff06e`, `ec0dc0c`, `4140207`, `4cf073a` | `git log 9f2ddcb..origin/platform-closure` |
| esses commits exclusivos são só docs? | **SIM** | `git diff --stat 691bfdc origin/platform-closure` → só `docs/` (5 arquivos) |
| existe correção de código não incorporada? | **NÃO** | idem |
| `round9-surgical`? | ANCESTOR (`798fe27`) | ANCESTRY |
| `preprod-final-closure`? | ANCESTOR (`43c484b`) | ANCESTRY |

Lacuna documental (OPEN_NONBLOCKING, ID `DOC-PC-DIVERGE`): ledger §Z/§ZB,
`PLANO-MESTRE-AUDITORIA.md` e `PLANO-PROD-CLONE-LAB.md`. **Nenhum merge foi
feito.**

## 4. Itens sem prova completa

### 4.1 Auditoria externa: sem PR identificável

`LEDGER-MESTRE-RELEASE.md` §B: **A08, A09, A10, A17** não aparecem em nenhuma
mensagem de commit ou PR. `git log --grep` no alvo também não encontra nada.
Pode ser falso positivo descartado na triagem ("os reais foram corrigidos",
`ESTADO-ATUAL.md` §5.27), mas isso **não está escrito** em lugar nenhum →
**UNKNOWN_REQUIRES_REVIEW**. Para fechar, é preciso o relatório original da
auditoria (ChatGPT, 14–15/09), que não está no repositório.

**2ª busca forense, 01/10/2026 (somente leitura).** Evidência:
`/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/forensic-a08-a09-a10-a17-20261001/`.

| fonte | resultado |
|---|---|
| `git log --all`: assunto e corpo de todo commit | 0 ocorrências |
| git notes | não existem |
| conteúdo de todos os refs locais e `origin/*` | só a própria frase de lacuna do `LEDGER-MESTRE` §B, e "A1–A8" de `PLANO-MELHORIAS-AUDITORIA.md`, que é **outra auditoria (julho, outro espaço de IDs)** e não conta |
| `src/`, `supabase/`, `scripts/`, `.github` no HEAD | 0. O código cita A01–A30 **exceto exatamente** A08/A09/A10/A17 |
| `reports/`, `evidence/`, `state/` (sem segredos) | só cópias da frase de lacuna e um falso positivo (fingerprint TLS) |
| `origin/claude/auditoria-*` (5) | 0 |
| GitHub (read-only): PRs #417–#446, com 30 corpos, 31 comentários, 5 reviews e 4 comentários de review | 0. IDs citados: 1–7, 11–16, 18–30; **nunca** 8, 9, 10 e 17 |
| issues do repo | 0 issues existem |
| PRs #180 e #297 ("auditoria externa", jul/ago) | 0, de outro período |

| ID | resultado |
|---|---|
| A08 | **SOURCE_NOT_FOUND** |
| A09 | **SOURCE_NOT_FOUND** |
| A10 | **SOURCE_NOT_FOUND** |
| A17 | **SOURCE_NOT_FOUND** |

Nenhuma descrição foi inferida pelo número. O estado continua
UNKNOWN_REQUIRES_REVIEW até o dono fornecer o documento original da auditoria.

### 4.2 Retests históricos

A01–A30, A80–A126 (R1–R7) e A127–A130-B (R8) estão **na linha** (ANCESTRY),
mas sem retest independente registrado no repositório ("HISTORICAL GAP",
`LEDGER-MESTRE` §O). As propriedades críticas foram reexercitadas pela suíte
completa da recertificação de `0d21874` (3971 testes ×2). Isso dá cobertura
de regressão, não retest por finding.

---

## 5. Registro único de findings

Estados: `FIXED_CERTIFIED` (desde a revisão 4, sempre qualificado: `CERTIFIED_EXACT_SHA`,
`CERTIFIED_RUNTIME_ANCESTOR` ou `HISTORICAL_CERTIFICATION_LEGACY`) · `FIXED_LAB_ENV_VERIFIED`
(ambiente/host, não SHA) · `FIXED_NOT_RECERTIFIED` · `OPEN_BLOCKER` ·
`OPEN_NONBLOCKING` · `DEFERRED_ACCEPTED` · `OWNER_DECISION` ·
`EXTERNAL_DEPENDENCY` · `SUPERSEDED`, mais `UNKNOWN_REQUIRES_REVIEW` (regra
deste documento).

**Append-only:** mudou o status? Acrescente uma linha nova com a data. Não
apague a anterior.

### 5.1 Auditoria externa pré-R1 (30 achados)

| ID | origem | sev. | descrição curta | correção (PR → SHA) | evidência | estado |
|---|---|---|---|---|---|---|
| A01 | ext. 14–15/09 | — | desafio de autenticação reutilizável | #428 → `a36afaa` | CI `25fc4b0` | FIXED_NOT_RECERTIFIED |
| A02 | ext. | — | home afirmava "seguro"/"14 rotas" | #445 → `5863b04` | idem | FIXED_NOT_RECERTIFIED |
| A03 | ext. | — | "cron do DCA nunca agendado" (falso) | #444 → `d8883d5` | idem | FIXED_NOT_RECERTIFIED |
| A04 | ext. | — | concessão de plano ≠ admin (0047) | #417 → `6e3b64f` | idem | FIXED_NOT_RECERTIFIED |
| A05 | ext. | — | restrição de liquidação faltava no repo (0049) | #444 → `d8883d5` | idem | FIXED_NOT_RECERTIFIED |
| A06 | ext. | — | reverter genoma não atômico (0048) | #442 → `40d70f8` | idem | FIXED_NOT_RECERTIFIED |
| A07 | ext. | — | arrecadação anônima contada como confirmada | #443 → `6ecc9f9` | idem | FIXED_NOT_RECERTIFIED |
| A08 | ext. | — | (sem descrição no repo) | — | — | **UNKNOWN_REQUIRES_REVIEW** |
| A09 | ext. | — | (sem descrição no repo) | — | — | **UNKNOWN_REQUIRES_REVIEW** |
| A10 | ext. | — | (sem descrição no repo) | — | — | **UNKNOWN_REQUIRES_REVIEW** |
| A11–A16, A18–A30 | ext. | — | ver mapa achado → PR em `LEDGER-MESTRE-RELEASE.md` §B | #417–#445 (todos ANCESTRY) | idem | FIXED_NOT_RECERTIFIED |
| A17 | ext. | — | (sem descrição no repo) | — | — | **UNKNOWN_REQUIRES_REVIEW** |
| A08 (2ª busca, 01/10) | ext. | — | fonte não encontrada em Git, GitHub nem lab | — | `evidence/forensic-a08-a09-a10-a17-20261001/` | **UNKNOWN_REQUIRES_REVIEW: SOURCE_NOT_FOUND** |
| A09 (2ª busca, 01/10) | ext. | — | idem | — | idem | **UNKNOWN_REQUIRES_REVIEW: SOURCE_NOT_FOUND** |
| A10 (2ª busca, 01/10) | ext. | — | idem | — | idem | **UNKNOWN_REQUIRES_REVIEW: SOURCE_NOT_FOUND** |
| A17 (2ª busca, 01/10) | ext. | — | idem | — | idem | **UNKNOWN_REQUIRES_REVIEW: SOURCE_NOT_FOUND** |
| EXT-D1 | ext. §5.27 | — | 3 carteiras admin legadas | — | — | OWNER_DECISION |
| EXT-D2 | ext. §5.27 | — | TOCTOU de cota (precisa de constraint no banco) | — | — | OWNER_DECISION |
| EXT-D3 | ext. §5.27 | — | `liquidoCompostoPct` compõe símbolos paralelos | — | — | OWNER_DECISION |
| EXT-D4 | ext. §5.27 | — | venue do `maker_de_faixa` | — | — | OWNER_DECISION |
| EXT-D5 | ext. §5.27 | — | braço dos modelos de IA parado | — | — | OWNER_DECISION |

### 5.2 Ponte, LIMIT/DCA e pré-lançamento (agosto)

| ID | origem | descrição | correção | estado |
|---|---|---|---|---|
| BRIDGE-L1/L2/L3 | auditoria da ponte, 23/08 | valor que mudava, zero que passava, destinatário de outra rede, teto mudo, saída por Solana | #336 `2c1339f`, #337 `3236738`, #338 `7814ad1` | FIXED_NOT_RECERTIFIED |
| LIMIT-DCA-1…10 | auditoria LIMIT/DCA, 24/08 | os nove achados + o décimo do tsc | #347 `9188722` | FIXED_NOT_RECERTIFIED |
| LIMIT-DCA-TETO | 29/08 | teto diário era por plano | #360 `0b87ac1` | FIXED_NOT_RECERTIFIED (o teto foi refeito depois em A58/B2) |
| PRE-LANC-PRO | auditoria pré-lançamento, 30/08 | painel do Pro não coloca ordem e não dizia isso | #373 `6b8f80f` | FIXED_NOT_RECERTIFIED |
| AUTOPILOT-REG | 23/08 | ordem executava e o registro sumia | #340 `f27591e` | FIXED_NOT_RECERTIFIED |

### 5.3 Rounds 1–9 e Platform Closure

| ID | origem | descrição curta | correção | evidência | estado |
|---|---|---|---|---|---|
| A80–A126 | R1–R7 | cadeia autoritativa de execução CEX, ACL, cofre T3, fingerprint, dedupe, escopo de conta | `140c860`…`15b89c8` | corpo dos commits | FIXED_NOT_RECERTIFIED (HISTORICAL GAP) |
| A127–A130-B | R8 | conexões versionadas, deriva tri-state, sessão Pilot no servidor | `a6185a8`…`83c50fe` | 3586/3586 `[LOCAL]` | FIXED_NOT_RECERTIFIED (A127 fechado de fato no R9) |
| A131–A145, A139-H, Q/F, CR-1…5, CRX-1, TOCTOU | R9 | livro de posição único, reservas, P&L exactly-once, autorização final transacional | `38569d3`…`798fe27` | `supabase/tests/01–10`; `[RETEST]` em `3123fb4` | FIXED_CERTIFIED (HISTORICAL_CERTIFICATION_LEGACY; código presente no CERTIFIED_EXACT_SHA `0d21874`) |
| A51, A61, A62, PC-3 | PC-B1 | aritmética exata, rearm preserva rails, DCA cron em gru1 | `519097a`…`a5bdd61` | SQL 11; CI 35985516785 | FIXED_CERTIFIED (HISTORICAL_CERTIFICATION_LEGACY; código presente no CERTIFIED_EXACT_SHA `0d21874`) |
| A58, A59, A86, A96, A97 | PC-B2 | DCA: pausa ≠ recovery, livro é autoridade, allowlist, FREE, fila indisponível ≠ vazia | `21ac739`…`3123fb4` | retest independente PASS | FIXED_CERTIFIED (HISTORICAL_CERTIFICATION_LEGACY; código presente no CERTIFIED_EXACT_SHA `0d21874`) |
| DB-ACL-FIN | PC-B3 / Release Ph. 2 | DEFAULT ACL expunha tabelas financeiras a `anon` | `691bfdc` (0067) | SQL 02/14; recert `0d21874` | FIXED_CERTIFIED (CERTIFIED_EXACT_SHA `0d21874`, local) · não aplicada em produção |
| CI-R9 | R9 | HEAD do R9 sem CI verde (checkout raso) | `a5bdd61` `fetch-depth: 0` | CI verde a partir de `a5bdd61` | SUPERSEDED |
| R8-CORRIDA | R8 | cron↔navegador pode fechar o dia 1 trade acima do teto | — | limitação declarada | OPEN_NONBLOCKING (vira bloqueador antes de autopilot real) |
| FLAKY-MESA | retest B2 | `mesa-real.test.ts` estourava 5 s sob carga | `56b06bd`, `c230b92`, `16e4000` | recert: alvo ×5 PASS 5/5 | FIXED_CERTIFIED (CERTIFIED_EXACT_SHA `0d21874`) |
| T13-ORIG | preprod | T13 original FAIL (limiar fixo de 700 ms) | T13 estável (`supabase/tests/13_*_stable.sh`) | 20/20 PASS | SUPERSEDED (o FAIL fica como evidência histórica, nunca reclassificado) |
| P0-SKEW | leitura de produção, 26/09 | 0056 aplicada × código `25fc4b0` grava `creds_cipher` → armar autopilot falha | o release (0059+ com o código R2+) | `[PROD]` §Y | **OPEN_BLOCKER** (produção) |
| STAGING-RB | Release Ph. 3 | prova de rollback/rebuild no staging hospedado incompleta | — | `origin/platform-closure` ledger §Z.3 | OPEN_NONBLOCKING (vira bloqueador do release) |

### 5.4 Preprod, supply chain e laboratório

| ID | sev. | descrição | correção | evidência | estado |
|---|---|---|---|---|---|
| SUPPLY-NEXT | CRITICAL | GHSA-vcvr-r3jv-pc5j, RCE em `next/og` | `0d21874` (`next ^16.3.6`) | audit 0 critical | FIXED_CERTIFIED (CERTIFIED_EXACT_SHA `0d21874`) |
| SUPPLY-AXIOS | HIGH | vários HIGH < 1.20.0 | `0d21874` (override) | audit 0 high | FIXED_CERTIFIED (CERTIFIED_EXACT_SHA `0d21874`) |
| SUPPLY-REST | MODERATE/LOW | 36 moderate, 1 low | — | `RELEASE-RUNBOOK.md` §2 | OPEN_NONBLOCKING |
| SEC-LOG-001 | HIGH (lab) | Postgres logava `ALTER USER … PASSWORD` | `log_statement=none`; senhas rotacionadas; containers recriados | post-reboot: 0 linhas de senha | FIXED_LAB_ENV_VERIFIED (era "FIXED_CERTIFIED (lab)") |
| INC-REBOOT-001 | HIGH (ops) | secrets só em tmpfs: o reboot derrubou as stacks | units duráveis + systemd-creds | `BOOT_RESILIENCE=PASS` (14:40, 01/10) | FIXED_LAB_ENV_VERIFIED (era "FIXED_CERTIFIED (lab)") |
| EGRESS-001 | MEDIUM | app alcançava qualquer host | gateway com allowlist | 4 stacks `EGRESS_BLOCKED` | FIXED_LAB_ENV_VERIFIED (era "FIXED_CERTIFIED (lab)") |
| BOOT-CYCLE | — (ops) | ciclo de ordenação no systemd derrubava o tailscaled | bootfix `4361a176…` | 0 ciclos; `REMOTE_SSH_BOOT=PASS` | FIXED_LAB_ENV_VERIFIED (host; era "FIXED_CERTIFIED (host)") |
| WIFI-DEADLOCK | — (ops) | deadlock brcmfmac no warm boot | recovery v2 | `WIFI_SELF_RECOVERY=PASS` (L3, 54 s) | FIXED_LAB_ENV_VERIFIED (host; era "FIXED_CERTIFIED (host)") |
| HARNESS-001 | LOW | `chaos-c4-recovery.sh` usa `docker top -eo args` | — | ainda presente em `scripts/preprod/chaos-c4-recovery.sh:100` (01/10) | OPEN_NONBLOCKING |
| HARNESS-002 | LOW | C4 atrás do Caddy dá 429 na 9ª rodada | rodar contra a porta direta | `RELEASE-RUNBOOK.md` §5 | OPEN_NONBLOCKING |
| HOST-CRED-001 | MEDIUM | systemd-creds sem LUKS/TPM2 | — | `fourstack-*` report | DEFERRED_ACCEPTED (só segredos sintéticos; HARDENING_REQUIRED antes de credencial real) |
| AUTOLOGIN | MEDIUM | autologin + bloqueio de tela desligado | — | `reports/unattended-boot-20261001T1557Z/ACER-UNATTENDED-BOOT-READINESS.md` | DEFERRED_ACCEPTED (pedido do dono); lock-after-idle é recomendado |
| AP-LOCK | — | versão do PostgREST hospedado | — | PASS local 14.17 | EXTERNAL_DEPENDENCY (OWNER_AUTH_REQUIRED) |
| VERCEL | — | deploy e check do PR | — | check FAILURE no PR #447 | EXTERNAL_DEPENDENCY (DEFERRED_EXTERNAL_PAYMENT) |

### 5.5 Early Access Fase 1 (auditoria adversarial de 01/10)

Fonte: `reports/early-access-phase1-adversarial-audit-20261001.txt` (auditoria
**antes** do hardening) + `docs/PLANO-EARLY-ACCESS.md` §15 (status depois do
hardening). Correção = commit `9f2ddcb`.

| ID | sev. | descrição curta | estado |
|---|---|---|---|
| **F-01** | MEDIUM | sem prova de posse do email: terceiro grava dados e consentimento em nome do titular | **OPEN_BLOCKER** (abrir o gate) → Fase 2 *(status de 01/10, histórico; atual: §5.5.4 — FIXED_CERTIFIED, `CERTIFIED_EXACT_SHA` `53cd85a`; não deployado)* |
| F-02 | LOW | filtro de robô consumia cotas compartilhadas | FIXED_NOT_RECERTIFIED |
| F-03 | LOW | variantes do sentinela `UNAPPROVED` | FIXED_NOT_RECERTIFIED |
| F-04 | LOW | `service_role` com INSERT em events/consents | FIXED_NOT_RECERTIFIED |
| F-05 | LOW | canal lateral de tempo (~0,3 ms novo × duplicado) | DEFERRED_ACCEPTED (fase fechada) |
| F-06 | LOW | unique de carteira verificada e caixa EVM | FIXED_NOT_RECERTIFIED |
| F-07 | LOW | leitura de eventos fora de ordem no painel | FIXED_NOT_RECERTIFIED |
| F-08 | LOW | export grande podia sair parcial | FIXED_NOT_RECERTIFIED |
| F-09 | LOW | `portao.test.ts` aceita import como chamada (repo-wide) | OPEN_NONBLOCKING |
| F-10 | LOW | força do segredo HMAC só por tamanho | FIXED_NOT_RECERTIFIED |
| F-11 | INFO | código de indicação entregue só ao titular verificado | OPEN_NONBLOCKING → escopo da Fase 2 |
| F-12 | INFO | PII no export | FIXED_NOT_RECERTIFIED (parcial, como pedido) |
| F-13 | INFO | exclusão/anonimização × append-only | OWNER_DECISION (fase legal/privacidade) |
| F-14 | INFO | ACL de `admin_kv`, `rate_limits`, `admin_audit_log` | OPEN_NONBLOCKING (trabalho separado) |
| F-15 | INFO | confiança em `x-forwarded-for` fora da Vercel | DEFERRED_ACCEPTED (pré-existente, documentado) |
| F-16 | INFO | dono das RPCs DEFINER | DEFERRED_ACCEPTED (sem SQL dinâmico) |
| EA-LEGAL | — | textos de Termos e Privacidade (`UNAPPROVED`) | OWNER_DECISION |
| EA-HMAC | — | gerar e configurar `EARLY_ACCESS_HMAC_SECRET` | OWNER_DECISION |
| EA-0068 | — | aplicar a 0068 no banco hospedado | OWNER_DECISION |
| EA-RECERT | — | falta artefato de recert pós-hardening no SHA `9f2ddcb` | OPEN_NONBLOCKING (bloqueia promoção a RC) |
| EA-RECERT (01/10, revisão 2) | — | recert executada em `9f2ddcb`: alvo EA FAIL 1/123; build, suíte e T15 NOT_RUN | **OPEN_BLOCKER** (para recertificar a Fase 1). `reports/EARLY-ACCESS-PHASE1-RECERT-9f2ddcb-20261001.txt` |
| **EA-TEST-F10-FLAKY** (novo, 01/10) | LOW (teste) | `gate-hmac-referral.test.ts:121`: o controle negativo `randomBytes(48).toString("base64url")` falha ~13,1% das vezes, porque a string aleatória pode ser base64 padrão canônico, que o código aceita corretamente. Nenhum impacto de produto identificado | **OPEN_BLOCKER** para a recert. A correção (determinizar o controle negativo) exige autorização + SHA novo + recert completa |
| EA-TEST-F10-FLAKY (01/10, revisão 3) | LOW (teste) | correção autorizada aplicada **só** no arquivo de teste: 48 bytes fixos e distintos com base64url contendo `-`/`_`; gêmeo base64 padrão provado aceito; `hmac.ts`, `gate.ts`, rota e migration intactos. Pré-commit: F10 100/100 | **FIXED_NOT_RECERTIFIED** (sem commit). Segue bloqueando a Fase 1 até a recert completa no SHA do commit candidato |
| EA-HMAC (01/10, revisão 3) | — | estado do segredo: `EARLY_ACCESS_HMAC_SECRET=NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN`, `PRODUCTION_SECRET_STATE=NOT_VERIFIED`. O gate segue CLOSED de qualquer forma (seed `disable_early_access=true`, versões legais `UNAPPROVED`, fail-closed) | OWNER_DECISION |
| EA-RECERT (02/10, C1) | — | recert completa no SHA exato do C1 `f4af9764e4c773f1bba2821f6cbef9685cfeb59d`: **FAIL** no gate 7 (alvo EA 122/123) na campanha `recert-c1-f4af976-20261002T012205Z`. Campanhas anteriores do mesmo C1: ABORTED (travamento do host), CLOSED_NONCOMPLIANT, ENVIRONMENT_BLOCKED_MEMORY (ledger L-018) | **OPEN_BLOCKER** (para recertificar a Fase 1). `reports/EARLY-ACCESS-PHASE1-C1-RECERT-f4af976-20261001.txt` |
| EA-TEST-F10-FLAKY (02/10) | LOW (teste) | correção commitada no C1 `f4af976`; F10 ×100 = 100/100 nas campanhas do C1 | **FIXED_NOT_RECERTIFIED** (o C1 não passou na recert por outro teste, EA-TEST-HMAC-189-FLAKY) |
| **EA-TEST-HMAC-189-FLAKY** (novo, 02/10) | LOW (teste) | `gate-hmac-referral.test.ts:157`: com `SEGREDO_FALSO = randomBytes(48)` (novo a cada processo), o controle negativo `expect(ipHmac("189.40.1.2")).not.toContain("189")` falha quando o hex aleatório de 32 caracteres contém "189": ≈ 1−(1−1/4096)^30 ≈ 0,73% por execução. Observado: `7690eca58e689a18910205a410e57773`. Nenhum impacto de produto identificado (um HMAC com "189" não revela o IP; `hmac.ts` intacto) | **OPEN_BLOCKER** para a recert. Correção no working tree (02/10, autorizada pelo dono): `SEGREDO_FALSO` fixo (48 bytes distintos, `(i*61+0x2d)&0xff`), cujo HMAC do IP de teste foi conferido sem "189"; mais a checagem do IP literal. Só o arquivo de teste muda. Vai no commit candidato **C1b** |
| EA-RECERT (02/10, C1b) | — | recert completa no SHA exato do C1b `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6`), campanha `recert-c1b-f1b4ec1-20261002T095819Z`: ×100 100/100 (25/25 cada), alvo EA 123/123, guardas 264/264, T15 22/22 (68 migrations), type-check, lint 0/0 e 0/145, build exit 0, suíte 271/4096 sem fail/skip/todo. Outras campanhas do C1b: `…092724Z` ENVIRONMENT_BLOCKED (memória do host); `…093950Z` **HARNESS_FAILURE** (`PRODUCT_VERDICT=NONE`, `SHA_VERDICT=NONE`: cache npm somente leitura → `ENOTCACHED`) | **CLOSED** · `RECERT(C1b)=PASS` · `CERTIFIED_EXACT_SHA` `f1b4ec1`. `reports/EARLY-ACCESS-PHASE1-C1B-RECERT-f1b4ec1-20261002.campaign-20261002T095819Z.txt`; ledger L-019 |
| EA-TEST-F10-FLAKY (02/10, C1b) | LOW (teste) | correção do C1 mantida no C1b; o arquivo inteiro passou ×100 na recert do C1b | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `f1b4ec1`)** |
| EA-TEST-HMAC-189-FLAKY (02/10, C1b) | LOW (teste) | correção commitada no C1b `f1b4ec1` (segredo de teste fixo); arquivo inteiro ×100 = 100/100, alvo EA 123/123 | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `f1b4ec1`)** |
| HARNESS-NPM-RO-CACHE (02/10) | — (harness, fora do repo) | o npm 11.19 escreve no índice do cache a cada consulta; com o cache montado somente leitura, `npm ci --offline` dá `ENOTCACHED`. Afetou só a campanha `…093950Z` | **FIXED** no harness v2 (cópia gravável e descartável do cache; original provado intacto). Sem impacto de produto |
| HARNESS_LABEL_BUG_G11 (02/10) | — (harness, fora do repo) | o laço do T15 sobrescreveu o índice do driver; o `RESULTS.env` gravou `IDENTITY` no lugar de `SQL_T15`. O resultado real veio do log bruto do T15 (22/22, 68 migrations, exit 0) | **OPEN_NONBLOCKING** — correção no harness v3 (variável local distinta) |
| EA-BUILD-NEXT-WARN (02/10) | INFO | build do C1b: 3 avisos do Next.js 16.3.6 — convenção `middleware` obsoleta (usar `proxy`); Edge Runtime obsoleto; edge runtime desliga a geração estática da página. Baseline / convenção existente, não falhas. Build com `BUILD_NETWORK=BRIDGE`; o prerender acessou a API pública `api.llama.fi`, sem segredo (não é produção tocada) | **DEFERRED** (não corrigir agora) |

### 5.5.1 Early Access Fase 2 — double opt-in (02/10, working tree, sem commit)

Base `PHASE_BASE_SHA=74f37f50d12dae698f14b620914bc0ce5b0c639a` (ledger L-020/L-021/L-022). Auditoria adversarial
**feita pela própria sessão de implementação (NÃO independente)**:
`/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/early-access-phase2-adversarial-audit-20261002.txt`
(sha256 `10d1706adfbb0db50d5c082049239acabbe63c53014fa9e01d111a38f88dd2bf`). Veredito: PASS WITH FINDINGS
(0 critical, 0 high, 2 medium, 4 low, 3 info). Nada aqui é certificação: falta C1 + recert exata.

| ID | Severidade | O quê | Status |
|---|---|---|---|
| **F-01** | MEDIUM | sem prova de posse do email | **FIXED_NOT_RECERTIFIED** (código: 0069 + rotas + T16/16b; gate continua CLOSED) |
| F-11 | INFO | código de indicação só para o titular verificado | **FIXED_NOT_RECERTIFIED** (só a resposta de `confirm` devolve o código) |
| EA2-A01 | MEDIUM | reenvio no 6º–7º dia emitia token que sobrevivia à purga de 7 dias (contradiz D-3) | **FIXED_NOT_RECERTIFIED** (`ea_interno_emitir` suprime com `retencao` depois de 6 dias; T16.7b) |
| EA2-A02 | MEDIUM | o consentimento de marketing confirmado é o DECLARADO por quem enviou; o titular só confirma tudo ou recusa (D-6 só corrige nome/país). Nenhum email de marketing existe nesta fase | ~~OWNER_DECISION~~ → decisão do dono 03/10 (L-023): declaração do formulário é PROVISÓRIA; consentimento efetivo só por escolha explícita do titular verificado; sem escolha = OPT-OUT. **FIXED_NOT_RECERTIFIED** (0069: `marketing_efetivo` + `marketing_escolhido_em` com CHECKs; `confirmar_email(…, p_marketing_opt_in default null)`; preview sem a declaração; export só com o efetivo; caixa desmarcada na página; T16.9/T16.9c) |
| EA2-A03 | LOW | canal lateral de tempo (linhagem F-05): novo × duplicado pendente × verificado fazem trabalho de banco diferente (ms). A latência do provider fica escondida pelo `waitUntil` | ACCEPTED_RESIDUAL |
| EA2-A04 | LOW | `display_name` escolhido por quem enviou aparece ao titular na página de confirmação (escapado; nunca no email) | ACCEPTED_RESIDUAL |
| EA2-A05 | LOW | volume de reenvio por email: limites de banco fail-closed (10 min, 5/24 h, 600/h) + `ea:em` 3/24 h (fail-open); "não fui eu" zera os contadores do pedido (exige ação do titular) | ACCEPTED_RESIDUAL |
| EA2-A06 | LOW | scanner de link que executa JS **e** clica botão poderia confirmar; GET é inerte | ACCEPTED_RESIDUAL |
| EA2-A07 | INFO | `registrar_envio` pode marcar `sent` num token já superseded (corrida); sem efeito de segurança | ACCEPTED |
| EA2-A08 | INFO | `ConfirmView` guarda o token por carregamento de página; navegação SPA para um 2º link reaproveitaria | ACCEPTED |
| EA2-A09 | INFO | rate limit de `/verify` é `rateLimitDurable` (fail-open); força bruta inviável (256 bits) | ACCEPTED |
| EA2-T15-ADAPT | — (teste) | T15 adaptado à 0069 (helper com a assinatura nova, contagem de funções 4→12, `email_verified_at` pelo dono antes das aprovações); nenhuma asserção removida; 22/22 | DOCUMENTED |

### 5.5.2 Early Access Fase 2 — auditoria INDEPENDENTE (03/10) e rodada de correção (working tree, sem commit)

Auditoria externa independente (ChatGPT) sobre o pacote
`phase2-independent-audit-20261003T141825Z.tar.gz` (sha256
`991199db95b40ef373a00c4b0c1cf5ec6227d86454f691066c5d3c123331086a`; cadeia do pacote verificada pelo
auditor: hash, SHA256SUMS, bundle, reconstrução, 1 138 arquivos conferidos, 0068 intocada).
**Veredito: FAIL · NOT_READY_FOR_C1** — 0 blocker, 0 high, 5 medium, 1 low. EA2-A02: nenhum bypass.
Correções no working tree, ledger L-024. Nada aqui é certificação.

| ID | Severidade | O quê | Status |
|---|---|---|---|
| EA2-IA01 | MEDIUM | falha permanente do Resend (400/401/403/422/resposta sem id) voltava à fila de retry: só o código era persistido | **FIXED_NOT_RECERTIFIED** — estado terminal explícito `dead`; `registrar_envio(…, p_transitorio)` obrigatório na falha; fila e `reemitir` só aceitam `failed`/`pending>5min`. Testes: `email.test.ts` (9 casos HTTP/rede), T16.19 |
| EA2-IA02 | MEDIUM | `reemitir` revogava o token antes de `ea_interno_emitir`, que podia ser suprimida (teto global) → inscrição sem token | **FIXED_NOT_RECERTIFIED** — revogação só DENTRO da emissão bem-sucedida (motivo por parâmetro); suprimido = nada muda e o token segue na fila. Testes: T16.20 (teto esgotado → não encalha → com capacidade, reemissão determinística), 16b.2 (dois retries concorrentes) |
| EA2-IA03 | MEDIUM | purga deixava `provider_message_id` em `early_access_webhook_eventos` (correlacionável no provider) | **FIXED_NOT_RECERTIFIED** — o webhook guarda só `evento_hash` (sha256 de mão única do `svix-id`) e não guarda `provider_message_id`; a única ligação mensagem→sujeito é `early_access_verificacoes`, apagada na purga. Teste: T16.21 |
| EA2-IA04 | MEDIUM | export trazia `marketing_efetivo=true` sem o estado de supressão | **FIXED_NOT_RECERTIFIED** — coluna gerada `marketing_elegivel = marketing_efetivo AND email_suppressed_at IS NULL`; export leva elegível + `email_suppressed_at` + `email_suppression_reason`; consentimento histórico preservado. Testes: T16.22 (5 casos + coluna não gravável), export no `early-access-admin.test.ts` |
| EA2-IA05 | MEDIUM | a confirmação gravava termos/privacidade como "consentimento" sem a UI dizer isso | **FIXED_NOT_RECERTIFIED** — botão "Confirmar e aceitar os Termos" + texto explícito (aceite dos Termos vX; ciência da Política vY); o POST devolve as versões apresentadas e a RPC recusa (`early_access_versao_divergente`, nada gravado) se não forem as da inscrição; `early_access_consents.declaracao` com CHECK (`aceite`/`ciencia`/`opt_in`/`opt_out`/`sem_escolha`/`provisoria`). Testes: T16.23, rota e validação |
| EA2-IA06 | LOW | caixa de marketing nascia `false` e sempre enviava opt-out explícito | **FIXED_NOT_RECERTIFIED** — escolha tri-estado (rádio sim/não, sem seleção inicial; omitido = `sem_escolha`). Testes: rota (null/false/true), T16.24 |
| EA2-A02 (reprova) | — | efetivo só com verificação + opt-in explícito | **REPROVEN** — T16.25 (invariante global, service_role sem escrita, provisória nunca efetiva), T16.9/9c, trava de fonte: `marketing_efetivo` tem UMA escrita no SQL inteiro |
| ZION-PLAYBOOK-TIMEOUT-LOCAL | — | timeout de 5 s em `src/lib/zion/playbook-backtest.test.ts` sob carga (código sem diff) | KNOWN_EXISTING / LOAD_SENSITIVE — não tocado, não reclassificado |

### 5.5.3 Early Access Fase 2 — SEGUNDA auditoria independente (03/10) e fechamento (working tree, sem commit)

Pacote auditado: `phase2-second-independent-audit-20261003T164829Z.tar.gz` (sha256
`d6695b78892e1f767fabedfb50ea0cb5043c4a706332b73c2f4a1a881f282b40`). Resultado: **EA2-IA01…IA06
confirmados FIXED** pelo auditor; novos: 0 blocker, 0 high, **1 medium, 2 low**. Correções e
auto-auditoria final completa no working tree (ledger L-025). Nada aqui é certificação.

| ID | Severidade | O quê | Status |
|---|---|---|---|
| EA2-IA07 | MEDIUM | motivo de transição em texto livre ia ao `admin_audit_log` (persistente), que sobrevive à purga — PII digitada por engano ficaria | **FIXED_NOT_RECERTIFIED** — corpo `{id, to, reason_code, note?}`; `reason_code` ∈ lista fechada (`estados.ts` `MOTIVOS`); o log persistente recebe **só** `{de, para, motivo_codigo}`; a nota opcional vai só para `early_access_events.reason`/`status_reason` (apagados na purga); campo antigo `reason` e extras recusados; nenhuma RPC escreve `admin_audit_log`. Testes: `early-access-admin.test.ts` (PII na nota não chega ao log; código persiste; todos os códigos; campos legados recusados), T16.27, trava de fonte em `token.test.ts` |
| EA2-IA08 | LOW | documentação contradizia o código corrigido (`send_status`, webhook, retry, elegibilidade, declarações, tri-estado) | **FIXED_NOT_RECERTIFIED** — `PLANO-EARLY-ACCESS-FASE2.md` reescrito como especificação final (versões anteriores preservadas nos pacotes de auditoria); cabeçalho da 0069 e índice do T16 atualizados; referências a seções inexistentes corrigidas; `RUNBOOK.md`, `CURRENT-STATE.md`, `START-HERE.md`, `DOCUMENT-AUTHORITY.md` alinhados. Entradas históricas do ledger intocadas |
| EA2-IA09 | LOW | `sem_escolha` recebia `marketing_escolhido_em` | **FIXED_NOT_RECERTIFIED** — `marketing_escolhido_em = case when p_marketing_opt_in is null then null else now() end`; CHECKs preservados. Testes: T16.9 (sem escolha → NULL), T16.26 (três estados + invariante banco-inteiro), T16.9c/T16.25 inalterados |

**Reprova de EA2-IA01…IA06:** T16.19–T16.24, 16b.2, `email.test.ts` ×9, rota/validação/export — todos PASS na árvore final.
**EA2-A02:** REPROVEN (T16.25 banco-inteiro, T16.9/9c/26, trava "uma única escrita de `marketing_efetivo`").

**Auto-auditoria final A–Q (implementador, 03/10):** canonicalização de email; inscrição/duplicado;
ciclo do token (geração, hash, sem cru, TTL, uso único, reenvio, replay, limites, concorrência);
confirmação (posse, versões, declarações, tri-estado); "não fui eu"/purga; retenção; máquina de
envio (pending/sent/failed/dead); cron/retry; webhook (autenticação, idempotência, bounce,
complaint, supressão, privacidade pós-purga); transições admin; export (autorização, email,
consentimento, elegibilidade, supressão); gate de aprovação; anti-enumeração; RLS/grants;
efeitos hosted (nenhum); docs × código; testes que provam invariantes. Achados novos corrigidos
nesta rodada: cabeçalho da 0069 e índice do T16 desatualizados; referências a `§19` inexistente
(rota `verify`, T16); duas frases imprecisas da especificação (`/verify` e saída do email do
banco). **Nenhum defeito conhecido de Fase 2 remanescente; nenhuma decisão de dono pendente.**

### 5.5.4 Early Access Fase 2 — C1, recertificação exata e atestação (03/10)

Verificação independente final (ChatGPT) do pacote `phase2-control-plane-final-audit-20261003T174725Z.tar.gz`
(sha256 `46779bf2fd7cdc3525a7c2daf5973b1fd10f4174656991592ec9127a52ba0d0a`): **PASS**. C1 `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` criado com
autorização do dono; recert exata `recert-c1-53cd85a-v31-20261003T182216Z` **PASS** (L-027). Com isso:

| ID | Status |
|---|---|
| F-01, F-11 | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `53cd85a`)** |
| EA2-A01, EA2-IA01…EA2-IA10 | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `53cd85a`)** |
| EA2-A02 (decisão do dono) | implementada e REPROVEN; **CERTIFIED_EXACT_SHA** `53cd85a` |
| EA2-A03…A06, EA2-A07…A09 | ACCEPTED_RESIDUAL / ACCEPTED (inalterados) |
| HARNESS-V3-G13-QUOTING (03/10) | — (harness, fora do repo): a campanha `recert-c1-53cd85a-20261003T180548Z` parou no G13 por caminho com `(` não citado no `/bin/sh`; **FAIL · HARNESS_FAILURE_G13_SHELL_QUOTING** (classificação pela evidência, **não** atribuída ao dono; sem veredito negativo do lint sobre produto); o ajuste 25→26 do x100 foi anterior e não foi a causa; corrigido no harness v3.1 (xargs -0) |
| ZION-PLAYBOOK-TIMEOUT-LOCAL | KNOWN_EXISTING / LOAD_SENSITIVE — **passou** na recert do C1 (container; arquivo 29/29); `src/lib/zion` sem diff |

### 5.6 Documentação e governança

| ID | descrição | estado |
|---|---|---|
| DOC-PC-DIVERGE | ledger §Z/§ZB, `PLANO-MESTRE-AUDITORIA.md` e `PLANO-PROD-CLONE-LAB.md` só em `origin/platform-closure` | OPEN_NONBLOCKING |
| DOC-STALE-EA | `ESTADO-ATUAL.md` (topo), `PLANO-EARLY-ACCESS.md` (cabeçalho) e `WHITELIST-FUNDRAISING-DISCOVERY.md` (status) dizem que a Fase 1 está "sem commit" ou "não iniciada" | OPEN_NONBLOCKING |
| DOC-STALE-LEDGER | `LEDGER-MESTRE-RELEASE.md` desta linha ainda chama `3123fb4` de certificado e lista migrations só até a 0066 | OPEN_NONBLOCKING (superado por `RELEASE-RUNBOOK.md` + `RELEASE-CHAIN.md`) |
| GOV-ENTRY | `CLAUDE.md` e `docs/README.md` apontam `ESTADO-ATUAL.md` como entrada, não `START-HERE.md` | OWNER_DECISION (o `CLAUDE.md` fica fora de `docs/`) |
| GOV-DEPLOY-RULE | regra de 31/08 "tudo vai para produção sempre" × no-deploy desta linha | OWNER_DECISION (até lá vale a mais restritiva; ver `AI-OPERATING-RULES.md` §6) |
| GOV-DEPLOY-RULE (01/10, revisão 2) | o dono suspendeu formalmente a regra de 31/08; deploy só com SHA + `RELEASE_CANDIDATE` + certificação PASS + autorização | **SUPERSEDED** pela política formal (`AI-OPERATING-RULES.md` §6.1, ledger L-012) |
| GOV-ENTRY (01/10, revisão 2) | `CLAUDE.md` (bloco de entrada), `AGENTS.md` (novo) e `docs/README.md` (bloco START HERE) apontam para `START-HERE.md` | FIXED_NOT_RECERTIFIED (sem commit; aguarda o review independente) |
| DOC-STALE-EA / DCA / MURAL (01/10, revisão 2) | banners CURRENT AUTHORITY + CLASSIFICATION no topo; status operacional do `PLANO-EARLY-ACCESS.md` corrigido; histórico preservado | FIXED_NOT_RECERTIFIED (sem commit). `WHITELIST-FUNDRAISING-DISCOVERY.md` e `LEDGER-MESTRE-RELEASE.md` seguem sem banner (OPEN_NONBLOCKING) |
| POOLS-SOON | `/pools` só para Einherjar (`0701327`) | SUPERSEDED por #376 |
| CP-01 (review round 1, 01/10) | ciclo de vida exigia "recert no SHA exato → commit", impossível: o SHA só existe depois do commit | FIXED_NOT_RECERTIFIED (revisão 3: commit candidato → recert no SHA commitado; `AI-OPERATING-RULES.md` §5, `AGENTS.md`, `CLAUDE.md`, `START-HERE.md` §9) |
| CP-02 (review round 1) | identidade "HEAD = `9f2ddcb`" / "diff fora de `docs/` vazio" se invalidava com o próprio commit do control plane | FIXED_NOT_RECERTIFIED (revisão 3: PRODUCT_BASE_SHA/TREE + snapshot do HEAD + diff de produto com exclusão explícita; `START-HERE.md` §2/§10, `AI-OPERATING-RULES.md` §1, `AGENTS.md`) |
| CP-03 (review round 1) | `9f2ddcb` chamado de CERTIFIED sem recert no SHA commitado | FIXED_NOT_RECERTIFIED (revisão 3: COMMITTED_FEATURE_CHECKPOINT; `CERTIFIED_FEATURE_SHA=NONE`; designação antiga preservada no histórico) |
| CP-04 (review round 1) | `MISSING_CORRECTIONS=0` e frases absolutas ignoravam os 4 findings sem fonte | FIXED_NOT_RECERTIFIED (revisão 3: `KNOWN_MISSING_CORRECTIONS=0` · `UNKNOWN_FINDINGS=4`) |
| CP-05 (review round 1) | `CLAUDE.md`: "Next.js 14" e "best-effort em volta de dinheiro" ensinavam errado | FIXED_NOT_RECERTIFIED (revisão 3: Next.js 16.3.6; regra fail-closed precisa, conferida no código) |
| CP-06 (review round 1) | Fase 2 "CURRENT" e "não iniciar" ao mesmo tempo; mural usava Supabase hospedado sem autorização | FIXED_NOT_RECERTIFIED (revisão 3: `CURRENT_WORK=CONTROL_PLANE_REVIEW_AND_PHASE1_RECERT`, Fase 2 `BLOCKED_NOT_STARTED`; mural só com autorização do dono) |
| CP-07 (review round 1) | `docs/README.md` ainda dizia "🟢 Vivos — fonte de verdade" / "ESTADO-ATUAL — Leia PRIMEIRO" | FIXED_NOT_RECERTIFIED (revisão 3: banner LEGACY + heading renomeado; linhas históricas preservadas) |
| CP-08 (review round 1) | "`EARLY_ACCESS_HMAC_SECRET` inexistente" afirmado sem medir o ambiente real | FIXED_NOT_RECERTIFIED (revisão 3: NOT_PROVIDED_OR_AUTHORIZED_FOR_THIS_LOCAL_CAMPAIGN / PRODUCTION_SECRET_STATE=NOT_VERIFIED) |
| CP-09 (review round 2, 01/10) | registrar o resultado da recert gera um delta que precisa de commit; o ciclo não dizia qual | FIXED_NOT_RECERTIFIED (revisão 4: C1 candidato → recert exata → C2 atestação só docs; `AI-OPERATING-RULES.md` §5.1/§5.2) |
| CP-10 (review round 2) | "CERTIFIED" sem qualificação para SHAs sem recert exata (`43c484b`, R9, PC-B1/B2) | FIXED_NOT_RECERTIFIED (revisão 4: CERTIFIED_EXACT_SHA / CERTIFIED_RUNTIME_ANCESTOR / HISTORICAL_CERTIFICATION_LEGACY) |
| GOV-ENTRY, CP-01…CP-10 (02/10, C1b) | correções acima já commitadas antes da recert e presentes na árvore exata do C1b (`f1b4ec1`, tree `ab814e3`); não foram reauditadas, só ficaram cobertas pela recert exata que passou. `CERTIFIED_FEATURE_SHA=f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · `RECERT_CAMPAIGN=recert-c1b-f1b4ec1-20261002T095819Z` · `RECERT_VERDICT=PASS` (ledger L-019) | **FIXED_CERTIFIED (`CERTIFIED_EXACT_SHA` `f1b4ec1`)** · RECERTIFIED_BY_C1B_PASS. As linhas anteriores ficam como histórico |
