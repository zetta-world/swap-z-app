# Z-SWAP — MASTER RELEASE LEDGER

## Reconciliação pré-produção — cadeia de custódia técnica

> **O que é:** o mapa de onde viemos e do que falta para a produção: cada etapa
> de correção com SHA de base e de fim, cada migration com o estado conhecido em
> produção, cada achado com a prova que o fecha, e o plano do release futuro.
>
> **O que NÃO é:** autorização de produção. Nada aqui ativa dinheiro real.
>
> **Status:** `CONTEXT RECONCILED — MASTER RELEASE LEDGER BUILT —
> BATCH 2 RETEST VERIFIED — PRODUCTION SCHEMA READ (26/09) —
> PRODUCTION TRANSITION NOT STARTED`
>
> **Data:** 26/09/2026 · **Construtor:** sessão Claude (implementador) ·
> **Certificação:** auditor independente (relatórios próprios)
>
> **Quando atualizar:** a cada etapa que mude um SHA certificado, o estado de
> uma migration em qualquer ambiente, ou o status de um achado.

### Legenda de fonte — toda afirmação carrega uma

| marca | significa |
|---|---|
| `[GIT]` | histórico/árvore do repositório, medido |
| `[DOC]` | documento versionado neste repositório |
| `[LOCAL]` | artefato de sessão (bundle, entrega) — **não versionado**, citado |
| `[CI]` | GitHub Actions, lido via API |
| `[VERCEL]` | Vercel, lido via API (somente leitura) |
| `[RETEST]` | `docs/retest-independente-batch2-3123fb4.md` (auditor, verbatim) |
| `[PROD]` | leitura **somente** do catálogo/history de produção, autorizada pelo dono em 26/09 (§Y) |
| `[DONO]` | afirmado pelo dono no handoff, **não provado** por fonte primária |
| `[NÃO PROVADO]` | sem fonte; tratar como desconhecido |

---

## 0. OS CINCO FATOS QUE MANDAM NO RELEASE

1. **A produção roda `25fc4b0` (`main`, anterior ao Round 1)** `[VERCEL]`
   (deploy `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`, 15/09). Nenhum deploy — produção
   ou Preview — existe para nada depois do `140c860` (Preview de 15/09). Entre o
   código em produção e o código certificado: **90 commits, 153 arquivos,
   +36.859/−943** `[GIT]`.

2. **⚠️ INCIDENTE VIVO CONFIRMADO — BANCO À FRENTE DO CÓDIGO** `[PROD][GIT]`.
   A **0056 foi aplicada em 16/09 10:14:30 UTC** e `autopilot_sessions.creds_cipher`
   **não existe** em produção. O código em produção (`25fc4b0`) ainda
   **escreve** essa coluna em `armSession` (`src/lib/autopilot/sessions.ts:97`)
   e **lê** dela (`:208`): **armar autopilot em produção falha com "column does
   not exist" desde 16/09.** Impacto medido: `autopilot_sessions` = **0 linhas**,
   `cex_execution_intents` = **0 linhas** — nenhuma sessão quebrada, nenhuma
   ordem órfã, nenhum dinheiro em risco. É indisponibilidade da função, com o
   autopilot real já em NO-GO. Detalhe em §Y.

3. **O banco de produção está no nível 0058 (por conteúdo)** `[PROD]`:
   0050–0054 aplicadas em 15/09, 0055–0058 em 16/09; **0059–0066 NÃO
   aplicadas**. O history remoto **não segue a numeração do repositório**
   (versões por data, nomes divergentes, quatro entradas que só existem em
   produção, uma delas colidindo com o nome da `0050`) — §Y.

4. **Código certificado:** `3123fb4972cd0ea46a152e00c0bd1c625efb12e5`
   (`platform-closure`) — Round 9 + Batch 1 + Batch 2, com o Batch 2 fechado por
   retest independente **lido e conferido** `[RETEST][GIT]`. Commits posteriores
   a `3123fb4` nesta branch são **somente documentação** (este ledger); o código
   e as migrations são idênticos ao SHA certificado — conferir com
   `git diff 3123fb4 HEAD -- . ':!docs'` (deve sair vazio).

5. **Automação real: NO-GO.** DCA real, Pilot real, Autopilot real. O estado
   atual das capacidades em produção (`admin_kv`) **não foi lido** — tratar como
   desconhecido e NO-GO até prova.

---

## A. IDENTIDADE

| ref | SHA `[GIT]` (26/09) | proteção `[GIT API]` |
|---|---|---|
| `origin/platform-closure` | `3123fb4972cd0ea46a152e00c0bd1c625efb12e5` (+ commits só de docs) | **desprotegida** |
| `origin/round9-surgical` | `798fe2762370d3e2c7b57115c4caee350e82d104` — congelada | **desprotegida** |
| `origin/main` | `25fc4b0fa55db72472c7ae00af42596209d7c362` | protegida |

Cadeia **linear**, cada base ancestral do seu HEAD `[GIT]`:

```
25fc4b0 ─ 140c860 ─ d7741bb ─ 6b08172 ─ 1325bd3 ─ 1cb82ce ─ bd30dea ─ e536c40
  pré-R1     R1(mid)   R1        R2        R3        R4        R5        R6

─ 15b89c8 ─ 51b57a1 ─ 2c580df ─ 83c50fe ─ 798fe27 ─ a5bdd61 ─ 3123fb4
    R7      R8(parcial) R8(mod C)  R8        R9        PC-B1     PC-B2
```

---

## B. PRÉ-ROUND 1 — AUDITORIA EXTERNA DE 30 ACHADOS

| | |
|---|---|
| Nome | **"auditoria externa pré-Round 1 (30 achados)"**. **Não existe nenhuma referência a "Round 0"** na árvore, nos commits ou nas branches `[GIT]` — não renomear sem prova |
| Achados | A01–A30: 8 altos, 21 médios, 1 baixo `[DOC ESTADO-ATUAL §5.27]`. Espaço de IDs **distinto** do A80+ dos Rounds |
| Intervalo real | **PRs #417 → #446**, 14–15/09 `[GIT]`. ⚠️ `ESTADO-ATUAL` diz #419–#445; #417 (A04) e #418 (A11, A25) já citam "auditoria externa" |
| Fim do código / fechamento | `5863b04` (#445) / `25fc4b0` (#446, docs) |
| Migrations | 0047, 0048; a 0049 (A05, #444) — o #444 declara que a restrição **já existia em produção** e faltava no repo |
| CI | `25fc4b0`: SUCCESS, run `34986267827`; 3.068 testes / 207 arquivos (mensagem do commit) `[CI][GIT]` |
| Retest independente | `HISTORICAL RECORD INCOMPLETE` |
| Em produção | **sim — é o código que a produção roda** `[VERCEL]` |
| Decisões do dono pendentes | 3 carteiras admin legadas; TOCTOU de cota; `liquidoCompostoPct`; venue do `maker_de_faixa`; braço de IA parado `[DOC §5.27]` |

**Achado → PR** `[GIT]`: A01 #428 · A02 #445 · A03/A05 #444 · A04 #417 ·
A06 #442 · A07 #443 · A11/A25 #418 · A12 #436 · A13/A14 #420 · A13/A21 #429 ·
A15/A29 #433 · A16 #439 · A18/A20 #425 · A19 #431 · A20 #426 · A21 #432 ·
A22 #434 · A23 #440 · A24 #430 · A25 #423 · A26/A27 #427 · A27 #419 ·
A28 #438 · A30 #437. Sem ID na mensagem: #421, #422, #424, #435, #441.
**Sem PR identificável: A08, A09, A10, A17** — `HISTORICAL RECORD INCOMPLETE`.

---

## C–I. ROUNDS 1 A 7

Comum a todos: **não há SPEC nem entrega versionados** — a evidência é o corpo
dos commits `[GIT]`. Suíte completa por HEAD e retests independentes:
`HISTORICAL RECORD INCOMPLETE`. Branch de trabalho: a linha que virou
`round8-surgical` / `round9-surgical` (os HEADs intermediários não têm branch
própria no remoto, exceto `claude/swap-z-recovery-deploy-b7y2cw` = `d7741bb`).

### C. ROUND 1 — `25fc4b0` → `d7741bb` (intermediário `140c860`)

| | |
|---|---|
| Commits | `140c860` "Cadeia autoritativa de execucao em corretora — fases 1 a 4" · `d7741bb` "Certificado, politica unica, capacidades, cofre T3 e a guarda estrutural" |
| Achados | A80, A81, A100–A109 (fases 1–4); A103, A110–A115 (fases 5–8) |
| Introduziu | intent durável → autorização → kill-switch → reserva → SUBMITTING → efeito externo → SUBMITTED/UNKNOWN → ingestão → reconciliação; `cex_execution_intents`, `cex_fills`, máquina de estados, executor central, certificados de estratégia (id/versão/hash), revalidação de tier, capacidades real × simulado, política única cron/navegador, cofre, deriva de conta, semântica multi-perna |
| Migrations | **0050–0054 criadas** |
| Regra crítica | depois de SUBMITTING, falha/timeout/crash **nunca** vira FAILED_PRE_SUBMIT — vira UNKNOWN |
| Vercel | Preview do `140c860` existe (15/09); do `d7741bb` **não** `[VERCEL]` |

### D. ROUND 2 — `d7741bb` → `6b08172` (12 commits, 3 merges)

| | |
|---|---|
| Achados | A116 (ACL das RPCs `SECURITY DEFINER`), A117 (DCA relê o MESMO intent), A112 (capacidade na criação), A110 r2 (certificado dentro do executor), A115 (cofre T3: `creds_cipher` removida), A103 (reconciliação de conta + quarentena), "Ponto 9" (UNKNOWN manual honesto) |
| Migrations | **0055** ACL · **0056** cofre T3 (**DROP `creds_cipher`**) · **0057** executor autoriza submissão · **0058** quarentena de sessão |
| Produção | **aplicadas em 16/09** `[PROD]` — history: 0055 10:14:17, 0056 10:14:30, **0058 10:15:03, 0057 10:15:28** (0058 antes da 0057). ⚠️ ver §0.2 |
| Pré-condição | a 0055 revoga funções criadas na 0050/0051 — se ela está aplicada, **0050–0054 também estão** |

### E. ROUND 3 — `6b08172` → `1325bd3` (14 commits)

Achados A118 (fee cumulativa + cobertura sintético→real), A119 (ciclo do DCA
liquida com o intent RELIDO), A110 r3 (autorização deriva do intent), A103,
A80/A102 (recovery por intentId). **0059 e 0060 criadas.**
Produção: **0059 e 0060 NÃO aplicadas** `[PROD]` — os corpos vivos de
`cex_ingest_trades`/`cex_ingest_order_snapshot` não têm a lógica de cobertura
da 0059, e não há `strategy_hash` em `cex_execution_intents` nem a auth de
assinatura `(uuid)` da 0060. A contradição documental (`e117cce` "nunca" ×
`SPEC-round9.md:381` "pode") fica resolvida: **nunca**.

### F. ROUND 4 — `1325bd3` → `1cb82ce` (7 commits)

A120 (fingerprint da credencial no intent manual), A121 (cobertura N≥S).
**0061 criada; 0059 EDITADA.**

### G. ROUND 5 — `1cb82ce` → `bd30dea` (8 commits)

A120-H (CHECKs NOT VALID; executor fail-closed sem fingerprint), A122 (dedupe
intra-lote), A123 (dedupe do livro por intent). **0062 criada; 0059 e 0061
EDITADAS.**

### H. ROUND 6 — `bd30dea` → `e536c40` (3 commits)

A124 — escopo de conta CEX / atribuição. **Sem migration.**

### I. ROUND 7 — `e536c40` → `15b89c8` (3 commits)

A125 (trades da ordem → settlement; histórico da conta → deriva), A126 (escopo
da conexão materializa as sessões dela). **Sem migration.** Quebras §41–42
declaradas no commit `15b89c8`.

---

## J. ROUND 8 — `15b89c8` → **`83c50fe`**

| | |
|---|---|
| Final real | **`83c50fe3acb8f019cd56ed2018f712cd0f2acf49`** — pela entrega `[LOCAL]`, confirmado pelo `[GIT]` (último commit `R8/` antes do primeiro `R9/`). **`51b57a1` foi só o checkpoint parcial** (interrompido por cota); `2c580df`, o do Module C. Bundles dos dois checkpoints existem `[LOCAL]` |
| Branch | `round8-surgical` (hoje sem ref remoto próprio; o histórico está em `round9-surgical`) |
| Commits | `a6185a8` A127 núcleo + 0063 · `51b57a1` A128/A129/A125-ABSENCE · `ea5a658`, `2c580df` Module C · `46f0e18` A130 · `1323ea2` A130-B · `83c50fe` correções da revisão |
| Achados | **A127** conexões versionadas CURRENT/RETIRED/REVOKED, `credential_identity` HMAC, recovery pela conexão HISTÓRICA do intent · **A128** deriva tri-state · **A129** normalização honesta · **A125-ABSENCE** integridade antes de CANCELED · **A130** sessão Pilot autorizada no servidor · **A130-B** limites duráveis + política compartilhada |
| Migration | **0063 criada**. Depois **EDITADA no R9** (`e4f6027`): `E'\0'` → `E'\x1F'` — a versão original **não aplicava em PostgreSQL real** (NUL é proibido em `text`) |
| Suíte | 3586/3586 (239 arquivos), tsc/lint/build limpos `[LOCAL]` |
| Status declarado | FIXED — PENDING INDEPENDENT RETEST; fechamento independente `HISTORICAL RECORD INCOMPLETE` |
| Limitações declaradas `[LOCAL]` | corrida cron↔navegador pode fechar o dia **um trade acima** do teto; o navegador herda o freio da quarentena, não a perícia; `record-fire` responde 409; 12-BIS (venda autônoma do navegador sem limite de posição) → tratado depois no R9 (A134–A136) |

---

## K. ROUND 9 — `83c50fe` → **`798fe27`** — CÓDIGO-BASE CERTIFICADO

| | |
|---|---|
| Branch | `round9-surgical` — **congelada, não mover** |
| Commits | 25 (`38569d3` → `798fe27`) |
| Achados | A131, A131-C, A132–A145, A139-H; Invariantes Q e F; item 11 da matriz; auditoria sintético→real; **CR-1…CR-5** (retest FAIL, corrigidos na raiz: estado financeiro autoritativo único); navegador sem snapshot; **TOCTOU da autorização final** (estado financeiro dentro da transação que vira SUBMITTING); **CRX-1** (varredura pergunta "diverge?", não "cresceu?") |
| Migrations | **0064 criada** (editada no lugar em 13 commits, nunca aplicada); 0063 editada; **0059–0062 com diff vazio** `[DOC entrega-round9 §52]` |
| Arnês SQL | `supabase/tests/01`–`10` + `README.md` (criados aqui) |
| Suíte | entrega: 3872/3872 (254) `[DOC]` · **CI #968 no `798fe27`: FAILURE 3871/3872** — única falha ambiental: guarda "0059–0062 intactas" faz `git show 15b89c8` e o checkout raso do CI não tem o commit. Corrigido no `a5bdd61` (`fetch-depth: 0`). **O HEAD do R9 nunca teve CI oficial verde** `[CI]` |
| Retest | CLOSED — I1–I12 PASS `[DONO]`. Regressão R9 reconfirmada no `3123fb4` pelo auditor `[RETEST]` |
| Divergência | `entrega-round9.md` diz "HEAD final `3b39e08`" — ficou para trás do HEAD real |
| Propriedades | intent durável; posse da reserva; SUBMITTING antes do efeito; UNKNOWN honesto; parciais; exposição; fee; P&L exactly-once; stop de perda diário; freeze; recovery; concorrência (`FOR UPDATE` real); autorização final transacional; certificado (id/versão/hash/venue/símbolo/`maxTradeUsd`); conexão histórica; fail-closed |
| Ordem de locks | **intent → sessão** (reservas, autorização final, projeção/liquidação → `autopilot_aplicar_pnl`); nenhum lock atravessa HTTP |

---

## L. PLATFORM CLOSURE BATCH 1 — `798fe27` → **`a5bdd61`**

| | |
|---|---|
| Commits | `519097a` **PC-1** A61/A62 aritmética decimal exata (Swap, CoW `buyAmount`, card-mapping, portal) · `d55327e` **PC-2** A51 rearm preserva `trades_today`/`pnl_today`/`last_reset_day`/`frozen_until_day` (RPC atômica) · `41a0a24` **PC-3** DCA cron em `gru1` · `a5bdd61` (dono) `fetch-depth: 0` no CI |
| Migration | **0065 criada** (não editada depois) |
| Evidência do implementador | pacote 17/17 SHA256; PostgreSQL 16.13 descartável **0001→0065 65/65**; teste SQL real `11` (R1–R6) com o defeito A51 reintroduzido → vermelho |
| CI | `41a0a24`: FAILURE (mesma causa ambiental) · **`a5bdd61`: SUCCESS**, run `35985516785` `[CI]` · "257/257 · 3899/3899" é a medida local no `41a0a24` |
| Retest | CLOSED `[DONO]`; regressão reconfirmada no `3123fb4` `[RETEST]` |

---

## M. PLATFORM CLOSURE BATCH 2 — `a5bdd61` → **`3123fb4`** — CLOSED, RETEST CONFERIDO

| | |
|---|---|
| Status | **`CLOSED — INDEPENDENT RETEST PASS` em `3123fb4972cd0ea46a152e00c0bd1c625efb12e5`** `[RETEST]` |
| Conferência do relatório | 6 commits; 20 arquivos (+2.263/−189); só a 0066 adicionada; 0064 inalterada no delta; `package.json`/lock idênticos à base — **tudo batido contra o Git** `[GIT]` |
| Commits | `21ac739` safety/accounting do DCA · `ff23612` regressões e controles negativos · `0ff4f61` teto diário não encerra plano + NULL de gasto falha fechado · `356d68c` `pause_dca` pausa entrada, não recovery · `124e834` cicatrizes da 0064 na 0066 + SQL 12 exige o motivo · `3123fb4` ESTADO-ATUAL |
| Achados | **A58** pausa/encerramento controlam entrada NOVA; recovery independe do status (fila ativa ≠ fila de recovery; auth final relê o plano sob `FOR UPDATE`) · **A59** livro é autoridade; `requested_notional_usd` é PISO (60 pedido / 80 preenchido → 80) · **A96** allowlist USD/USDT/USDC; histórico não-USD continua recuperável · **A97** BUY real usa FREE, nunca TOTAL; falha de saldo = fail-closed · **A86** fila indisponível ≠ fila vazia → 503, `processed=0` |
| Correções da integração | tipos TS do pacote; script 13 (`psql -c` não interpola); guardas A116 e da lista de migrations; `Number(null)`→0; teto diário abaixo do mínimo não encerra plano; `pause_dca`; SQL 12 específico; cicatrizes da 0064 |
| Migration | **0066 criada**; editada uma vez (`124e834`, só comentários — equivalência sem comentários provada) |
| Evidência do implementador | PostgreSQL 16.13 descartável 66/66; SQL 01/02/04–06/08–13 verdes; break A59 vermelho ("obtido 370") |
| Evidência do auditor `[RETEST]` | PostgreSQL **16.15**, cluster novo, 66/66; SQL 01/02/04/05/06/08–12 PASS; 13 (A58) PASS com bloqueio de ~1.036 ms; `pg_blocking_pids()` viu bloqueador real em 04/05/06; A59 via `cex_ingest_order_snapshot` (sem update manual): `PARTIALLY_FILLED`, total 80, replay 80, SUBMITTING 100 + UNKNOWN 80 = 180, `custo_usd=999` num ciclo não muda o livro; cada fail-closed pelo motivo certo; **break A59 num banco NOVO com a 0066 mutante → vermelho**; regressão R9/B1 na função efetiva da 0066; ACL real 19 definers, 3 funções do B2 só `service_role` |
| CI | run `36231021269`, job `108374070760`, Node 22, `fetch-depth: 0`, **263/263 · 3956/3956**, SUCCESS `[CI][RETEST]` |
| Limitações do retest (declaradas pelo auditor) | `npm ci` local falhou por rede/cache (usou cópia física do mesmo lockfile; o `npm ci` válido é o do CI); `npm test` local 3955/3956 por timeout de 5 s em `mesa-real.test.ts` (isolado 11/11 sem aumentar timeout; CI integral verde); avisos de depreciação do Next.js (`middleware`, Edge Runtime) |

---

## N. MASTER MIGRATION LEDGER 0001 → 0066

> ✅ **Medido em 26/09 `[PROD]`: o delta do release é exatamente 0059 → 0066.**
> Nenhuma das migrations editadas depois de criadas (0059, 0061, 0063–0066)
> chegou à produção em versão nenhuma — o risco de "versão intermediária
> aplicada" não se materializou.
>
> ⚠️ **NOME NO HISTORY NÃO PROVA CONTEÚDO.** Cinco migrations foram editadas
> depois de criadas: **0059** (8 commits, R3→R5, todos em 16/09), **0061** (R4→R5),
> **0063** (R8→R9), **0064** (13 commits no R9), **0066** (B2, só comentários)
> `[GIT]`. Se qualquer versão intermediária chegou a um banco, o nome no
> `supabase_migrations` estará lá e o corpo será outro.

Todas as 66 estão presentes no `3123fb4` e foram aplicadas em PostgreSQL
descartável do zero, 66/66, por implementador (16.13) e auditor (16.15).

| migration | etapa | finalidade | produção aplicada | history remoto coerente | ação futura |
|---|---|---|---|---|---|
| 0001–0046 | pré-auditoria (jun–ago) | auth, admin, autopilot, ledgers, paper, celeiro, `cex_conexoes` (0031), DCA (0032–0034), bancada | **UNKNOWN** — o código em produção depende delas; presumível, não provado | UNKNOWN (DB-BASELINE HIGH) | inventário do schema vivo × repo |
| 0047 | pré-R1 | concessão de plano ≠ admin (A04) | UNKNOWN | UNKNOWN | verificar |
| 0048 | pré-R1 | reverter genoma atômico (A06) | UNKNOWN | UNKNOWN | verificar |
| 0049 | pré-R1 | saída por liquidação (A05) — **existia em produção antes do repo** | provável; UNKNOWN | **drift conhecido** | reconciliar history |
| 0050 | R1 | intents + fills | **SIM, 15/09** `[PROD]` (`execucao_cex_intents_e_fills`) | versão por data; ⚠️ existe outra entrada `0050_celeiro_alavancado_geometria_medida` | diff de conteúdo |
| 0051 | R1 | RPCs de execução (transição, ingestão, recálculo) | **SIM, 15/09** `[PROD]` (+ `execucao_cex_rls`, só em produção) | versão por data | diff de conteúdo |
| 0052 | R1 | certificado de estratégia | **SIM, 15/09** `[PROD]` | versão por data | diff de conteúdo |
| 0053 | R1 | sessão carrega estratégia | **SIM, 15/09** `[PROD]` | versão por data | diff de conteúdo |
| 0054 | R1 | tier da sessão revalidado | **SIM, 15/09** `[PROD]` | versão por data | diff de conteúdo |
| 0055 | R2 | ACL das RPCs financeiras (A116) | **SIM, 16/09** `[PROD]` | nome com prefixo `0055_` | diff de ACL |
| 0056 | R2 | cofre T3 — **DROP `autopilot_sessions.creds_cipher`** | **SIM, 16/09** `[PROD]` — coluna ausente; **⚠️ quebra `armSession` do código em produção** | nome com prefixo | resolvido pelo release (§Y) |
| 0057 | R2 | executor autoriza submissão | **SIM, 16/09** `[PROD]` — auth de 5 argumentos viva | aplicada **depois** da 0058 | diff de conteúdo |
| 0058 | R2 | quarentena de conta | **SIM, 16/09** `[PROD]` — `quarentena_em` presente | nome com prefixo | diff de conteúdo |
| 0059 | R3 (ed. R4, R5) | fee cumulativa + cobertura sintético→real | **NÃO** `[PROD]` — corpos vivos sem a cobertura | não consta | aplicar no release |
| 0060 | R3 | autorização deriva do intent (`strategy_hash`, RPC(uuid), drop da assinatura antiga) | **NÃO** `[PROD]` | não consta | aplicar no release |
| 0061 | R4 (ed. R5) | fingerprint da credencial | **NÃO** `[PROD]` — sem `credential_fingerprint` | não consta | aplicar no release |
| 0062 | R5 | dedupe de fills por intent | **NÃO** `[PROD]` — `cex_fills_dedupe` ainda viva, `cex_fills_intent_dedupe` ausente | não consta | aplicar no release |
| 0063 | R8 (ed. R9) | conexões versionadas CURRENT/RETIRED/REVOKED | **NÃO** `[PROD]` — `cex_conexoes` sem `credential_identity`/`is_current`/`superseded_at` | não consta | só via staging (§U) |
| 0064 | R9 | projeção de posição, P&L, autorização final, pendências financeiras | **NÃO** `[PROD]` | não consta | idem |
| 0065 | B1 | rearm preserva rails (A51) | **NÃO** `[PROD]` | não consta | idem |
| 0066 | B2 | DCA: auth relê o plano, fila de recovery, teto real | **NÃO** `[PROD]` | não consta | idem |

**Se a 0063 falhar:** ela já falhou uma vez (o `E'\0'` original). Os arquivos
não abrem transação própria; o replay é arquivo a arquivo — uma falha no meio
deixa estado parcial. Regra: aplicar em staging em transação única
(`--single-transaction` ou equivalente), com backup + PITR antes de produção.
Ela é declarada forward-safe com dados `[LOCAL SPEC-round8]`.

---

## O. FINDINGS LEDGER

**CLOSED + RETESTED (relatório conferido)** — `3123fb4` `[RETEST][GIT]`:
A58, A59, A86, A96, A97 e as correções de integração do Batch 2 (§M).

**CLOSED + RETESTED `[DONO]`** (relatório original fora do repositório;
propriedades reconfirmadas no `3123fb4` por `[RETEST]`):
- Round 9 (`798fe27`): A131–A145, A139-H, CR-1–5, CRX-1, Invariantes Q/F,
  TOCTOU da autorização final — prova: `supabase/tests/01`–`10`.
- Batch 1 (`a5bdd61`): A51, A61, A62, PC-3 — prova: `supabase/tests/11`,
  `src/lib/platform-closure-batch1.test.ts`, CI #970.

**CLOSED POR ETAPA POSTERIOR:** A127 (R8, completado no R9 com a 0063
corrigida); 12-BIS do R8 (A134–A136); A110 (R1→R2→R3); A120 (→A120-H).

**HISTORICAL GAP** (retest sem registro no repo): A01–A30 (PRs em §B);
A80–A126 (R1–R7); A127–A130-B (R8).

**OPEN:**
- **P0-SKEW** — 0056 × código em produção (§0.2). `OPEN — REPRODUCED`
  `[PROD]`: coluna ausente; `armSession` de `25fc4b0` quebra; 0 sessões e
  0 intents — indisponibilidade, sem dinheiro em risco. Resolvido pelo release
  (código R2+ exige 0059+; hotfix isolado não é possível — §Y).
- **R8-CORRIDA** — cron↔navegador pode fechar o dia um trade acima do teto
  (limitação declarada, não corrigida).
- **CI-R9** — HEAD do R9 sem CI verde (ambiental; resolvido para frente pelo
  `a5bdd61`).
- **FLAKY-MESA** — `mesa-real.test.ts` estoura 5 s sob carga, passa isolado
  `[RETEST]`. Sem impacto financeiro conhecido.

**DEPLOY/STAGING DEPENDENT:** tudo que exige HTTP real, cron agendado,
credenciais e providers — §U fases 3–6.

---

## P. CÓDIGO CERTIFICADO × PRODUÇÃO

| camada | produção hoje | certificado |
|---|---|---|
| código | `25fc4b0` (15/09) `[VERCEL]` | `3123fb4` |
| banco | desconhecido de 0049 em diante; relato de até 0058 | 0001→0066 reproduzível do zero |
| capacidades reais | **não lidas** | NO-GO |

---

## Q. SUPABASE / MIGRATION HISTORY

- Produção: projeto `vuvvftdsfmagmtbovzgq` — **não tocado**.
- **DB-BASELINE / MIGRATION HISTORY DRIFT: HIGH, OPEN — CONFIRMADO** `[PROD]`
  (entradas só em produção, nome colidindo com a `0050`, versões por data —
  §Y). Replay do repositório
  reproduzível **≠** history de produção reproduzível. Agravantes: drift da 0049;
  migrations editadas depois de criadas; Supabase branch de desenvolvimento em
  `MIGRATIONS_FAILED` `[DONO]`.
- **Proibido** `supabase migration repair` em produção sem plano próprio,
  backup, prova, rollback e autorização explícita.

---

## R. VERCEL / RUNTIME

- Operacional: **`swap-z-app`** (`prj_0SAn6Tl0OmwQ7K1REKI2wM6e7vM0`, team
  `team_gwfW8RTfltBcKvffKl17mPlr`). **`z-swap`** (`prj_TQGl9ctn7VP3tUy9V5r9HljAtrq1`)
  é OUTRO projeto — não confundir `[VERCEL]`.
- Último deploy de qualquer tipo: Preview do `140c860` (15/09). Nenhum Preview
  de R2+ / `round9-surgical` / `platform-closure` — compatível com o bloqueio de
  billing relatado `[DONO]`, **não verificado**.
- Retenção de logs curta: não alcança 16/09; limita a forense do §0.2.
- `vercel.json` (`3123fb4`) fixa em `gru1`: `cex/order`, `autopilot/cron`,
  `dca/cron`. Crons agendados no cron-job.org, fora do repo `[DOC CLAUDE.md]`.

---

## S. CI / SUPPLY CHAIN

**APPLICATION CORRECTNESS** e **SUPPLY-CHAIN / GOVERNANCE** são contas
separadas. A primeira está fechada para os batches acima; a segunda, não.

- `ci.yml`: `npm ci`, lint, type-check, test, `npm audit` (advisory,
  `continue-on-error`). **Não roda build nem PostgreSQL.** `fetch-depth: 0`
  desde `a5bdd61`.
- **NPM-AUDIT: OPEN — REPRODUCED.** 46 vulnerabilidades (1 low, 39 moderate,
  6 high) `[CI][RETEST]`.
- **GITHUB-GATE: OPEN — parcialmente verificado.** `main` protegida; todas as
  outras branches, **inclusive `round9-surgical` e `platform-closure`**,
  desprotegidas. Regras e rulesets não inspecionados.
- **RUNTIME-DRIFT: OPEN — REPRODUCED.** 90 commits entre produção e o certificado.

---

## T. BACKLOG FORA DOS BATCHES FECHADOS

> ⚠️ **A maioria destes IDs não tem definição no repositório** — zero
> ocorrências na árvore e nos commits `[GIT]`. Vêm dos relatórios do auditor.
> Para classificar de verdade é preciso a lista dele com descrição e local.

| frente | IDs | classificação |
|---|---|---|
| CEX manual | A43, A99, CEX-COST-PENDING, A95 | HISTORICAL GAP |
| Auth/Admin | AUTH-JWT, AUTH-CSRF, A84, A85, A88 | HISTORICAL GAP |
| Auth/Admin | ADMIN-LEGACY | OPEN — decisão do dono ("3 carteiras admin legadas" `[DOC §5.27]`) |
| Rate limit | A87 | HISTORICAL GAP |
| DEX/Bridge | A77, A78, DEX-PUBLICCLIENT, DEX-APPROVAL, DEX-GASUSD, LIFI-FEE, SOLANA-GUARD, JITO-TIP | HISTORICAL GAP — provável DEPENDS ON EXTERNAL PROVIDER |
| CoW/Cards | A63–A67, A69, A72 | HISTORICAL GAP (A61/A62 fechados no B1) |
| Ops/Forense | OPS-FORGE, OPS-EXTERNAL-REF, OPS-HIST-FEE, LOG-EVENT, LOG-OP, LOG-TELEGRAM | HISTORICAL GAP |
| Supply chain | NPM-AUDIT · GITHUB-GATE · RUNTIME-DRIFT | OPEN (§S) |
| Release | DB-BASELINE | OPEN — HIGH |
| Release | STAGING-HTTP | DEPENDS ON STAGING |
| Confiabilidade | FLAKY-MESA | OPEN — REPRODUCED |

---

## U. PLANO DE RELEASE FUTURO — NÃO EXECUTAR

Cada fase só começa quando a anterior provou o que tinha de provar. STOP devolve
ao estado anterior. Nenhum comando destrutivo é dado aqui: dependem do estado
de produção que ainda não foi lido.

| fase | entrada | ação futura | prova esperada | rollback | STOP |
|---|---|---|---|---|---|
| **0 Freeze** | `3123fb4`, CI verde | congelar a linha; proteger `platform-closure` e `round9-surgical`; bundle + SHA256 | ref imutável; bundle verificado | nada muda | qualquer ref se move com código |
| **1 Reconciliar history** — ⏳ **em parte feito (26/09, §Y)**: history lido; presença/ausência de 0050–0066 por marcador; P0 respondido. **Falta:** diff de CONTEÚDO (`prosrc`, ACL, constraints) de 0050–0058 vivas × repo | leitura de produção **autorizada** | ler `supabase_migrations` + catálogo (tabelas, colunas, funções, ACL, `prosrc`) e diffar contra 0001→0066 **por conteúdo**. **P0: `autopilot_sessions.creds_cipher` existe?** | tabela migration × {history, schema vivo, versão} | nada (somente leitura) | coluna ausente com `25fc4b0` no ar → incidente próprio, tratado antes de tudo |
| **2 Replay descartável** | dump **só de schema** da produção | replay do zero **e** replay do delta pendente a partir do estado vivo | ambos verdes; arnês 01–13 verde | descartar cluster | qualquer migration falha |
| **3 Supabase staging** | delta aprovado | staging a partir do schema reconciliado; aplicar o delta em transação | history = schema = repo | recriar staging | `MIGRATIONS_FAILED` |
| **4 Vercel Preview** | billing resolvido; envs de staging | Preview do SHA certificado apontando para staging | READY no SHA certo | apagar Preview | SHA errado; env de produção vazando |
| **5 HTTP/runtime** | Preview de pé | crons via HTTP com `CRON_SECRET`; rotas do navegador; recovery; timeout e restart forçados | 503 em fila ilegível; UNKNOWN sobrevive a restart; zero ordem sem SUBMITTING | — | ordem sem intent/SUBMITTING |
| **6 Providers/canário** | credenciais de **teste** | venues em simulado → conta de teste com valor mínimo | fills reais ingeridos; P&L = extrato da venue | cancelar ordens | divergência livro × venue |
| **7 Backup/rollback** | janela aprovada | backup + PITR; restore ensaiado em staging; redeploy de `25fc4b0` ensaiado | restore medido | — | restore não reproduz |
| **8 Banco de produção** | 1–7 verdes + **autorização explícita** | aplicar só o delta provado, em transação, com `pause_dca` e kill-switches ligados | history e schema = staging | PITR | primeiro erro |
| **9 Deploy da aplicação** | fase 8 ok | promover o SHA certificado | READY no SHA | promover o deploy anterior | 5xx acima da linha de base |
| **10 Verificação pós-deploy** | — | smoke HTTP; heartbeats; ACL viva; `admin_kv` lido | tudo verde | fase 9 | qualquer divergência |
| **11 Canário limitado** | GO do dono | 1 carteira piloto, valores mínimos, simulado antes de real | reconciliação diária limpa | desligar capacidades | UNKNOWN não resolvido |
| **12 Observação** | canário ok | janela fixa (sugestão: 7 dias) | zero incidente financeiro | kill-switch | incidente |
| **13 GO/NO-GO** | 0–12 | decisão explícita do dono para automação real | ata registrada | — | — |

---

## V. INVARIANTES DE PRODUÇÃO — NUNCA PERDER

1. IA interpreta; regras objetivas decidem.
2. Intent durável antes do efeito externo.
3. SUBMITTING imediatamente antes do side effect.
4. Depois do ponto sem volta, dúvida = UNKNOWN — nunca "falhou antes de enviar".
5. Recovery nunca reenvia uma ordem duvidosa.
6. `intent.conexao_id` é identidade histórica.
7. CURRENT / RETIRED / REVOKED têm semântica histórica.
8. Revogar conexão impede nova execução, mas não apaga a capacidade de
   reconciliar o passado.
9. Certificado controla entrada de risco.
10. Saída não fica presa por certificado expirado/revogado.
11. Rails financeiros são fail-closed.
12. Contabilidade incompleta não vira zero.
13. NULL financeiro não vira zero por coerção JS.
14. FREE balance não é TOTAL balance.
15. Requested é piso quando há fill durável maior.
16. Fila indisponível não é fila vazia.
17. Pausa bloqueia entrada nova, não o recovery de side effect já possível.
18. Quote não USD-like não é contabilizada como USD por suposição.
19. DCA real e simulado têm capacidades distintas.
20. Nenhuma ativação real só porque testes passaram.
21. **Nome de migration no history não prova conteúdo** — migrations já foram
    editadas depois de criadas.
22. **Banco nunca à frente do código que o usa** (o caso 0056 × `25fc4b0`).
23. **CI verde exige histórico completo** (`fetch-depth: 0`) — verde em checkout
    raso é outra medida.

---

## W. DIVERGÊNCIAS / INFORMAÇÃO NÃO PROVADA

1. ~~Relatório do retest do Batch 2 ausente~~ — **resolvido**: arquivado verbatim
   em `docs/retest-independente-batch2-3123fb4.md` (sha256
   `8e93eab80ab491634580d4c7e96e51cc591ce53fe6731eca644f328f7264927e`).
2. ~~0055–0058 aplicadas: sem prova~~ — **resolvido `[PROD]`**: aplicadas em 16/09.
3. ~~0059 contraditória~~ — **resolvido `[PROD]`**: nunca aplicada.
4. ~~Assimetria 0056 × código: não provada~~ — **confirmada `[PROD]`** (§0.2, §Y).
4-BIS. **Novo:** o history de produção tem entradas sem migration no repo
   (`execucao_cex_rls`, `indice_vitrine_das_mesas`,
   `desfaz_indice_vitrine_sem_ganho_medido`,
   `0050_celeiro_alavancado_geometria_medida`) — conteúdo **não inventariado**.
5. Intervalo da auditoria pré-R1: #417–#446 `[GIT]` × #419–#445 `[DOC]`.
6. `entrega-round9.md` cita HEAD `3b39e08` — desatualizado.
7. HEAD do R9 sem CI verde (ambiental).
8. Retests independentes da auditoria pré-R1 e dos Rounds 1–8: sem registro.
9. Backlog de mais de 40 IDs sem definição no repositório.
10. Billing do Vercel: não verificado.
11. Estado atual das capacidades reais em produção (`admin_kv`): não lido.

---

## X. STATUS FINAL

**`CONTEXT RECONCILED — MASTER RELEASE LEDGER BUILT — BATCH 2 RETEST VERIFIED —
PRODUCTION SCHEMA READ — PRODUCTION TRANSITION NOT STARTED`**

Código: Round 9 + Batch 1 + Batch 2 fechados em `3123fb4`. Produção: roda
`25fc4b0` sobre um banco no nível **0058**; `armSession` quebrado desde 16/09
(0 sessões afetadas); delta do release = **0059 → 0066**, **não aplicar** fora
do plano da §U.
**DCA REAL = NO-GO · PILOT REAL = NO-GO · AUTOPILOT REAL = NO-GO.**

O que destrava o início do release:
1. ~~autorização para ler o schema de produção~~ — **feito em 26/09 (§Y)**;
2. o diff de conteúdo de 0050–0058 vivas × repo e o inventário das quatro
   entradas só-de-produção (restante da Fase 1);
3. a lista de definições do backlog do auditor;
4. decisão do dono sobre o P0: aceitar a indisponibilidade de `armSession` até
   o release (recomendado) ou outra via.

---

## Y. LEITURA DE PRODUÇÃO — 26/09/2026 `[PROD]`

**Autorização:** do dono, em 26/09, para **ler** o schema de produção e
conferir `creds_cipher`. **Somente leitura:** `SELECT` em
`information_schema`/`pg_catalog`, `count(*)`, `md5(prosrc)` e a listagem do
migration history, via Supabase MCP no projeto `vuvvftdsfmagmtbovzgq`. Nenhuma
escrita, nenhuma DDL, nenhum dado de usuário lido além de contagens.

### Y.1 O P0

| pergunta | resposta medida |
|---|---|
| `autopilot_sessions.creds_cipher` existe? | **NÃO** |
| a 0056 foi aplicada? | **SIM** — history `20260916101430 0056_cofre_t3_final` |
| o código em produção depende da coluna? | **SIM** — `25fc4b0:src/lib/autopilot/sessions.ts:97` (escrita) e `:208` (leitura) |
| sessões de autopilot existentes | **0** (0 ativas, 0 sem `conexao_id`; `max(updated_at)` nulo) |
| intents de execução | **0** |
| consequência | `armSession` em produção falha com "column does not exist" desde 16/09; nada existente quebrou; nenhuma ordem, nenhum dinheiro |

**Por que não há hotfix isolado:** o `creds_cipher` sai do código no R2
(`df2a62f`, A115). Todo código do R2 em diante depende também de migrations
0059+ (R3 em diante), então "trocar o código sem trocar o banco" não existe —
o conserto É o release. Com 0 sessões e autopilot real em NO-GO, o impacto é
só a função indisponível até lá.

### Y.2 Presença das migrations por marcador de schema

| migration | marcador conferido | resultado |
|---|---|---|
| 0050–0054 | tabelas `cex_execution_intents`, `cex_fills`, `strategy_certificates`; colunas de estratégia/tier em `autopilot_sessions` | presentes |
| 0055 | ACL das RPCs (history) | aplicada |
| 0056 | `creds_cipher` ausente | aplicada |
| 0057 | `cex_autorizar_e_submeter(p_intent_id, p_strategy_hash, p_venue, p_symbol, p_notional)` — 5 argumentos | aplicada |
| 0058 | `autopilot_sessions.quarentena_em` | aplicada |
| 0059 | corpo de `cex_ingest_trades` / `cex_ingest_order_snapshot` sem a lógica de cobertura (md5 `2962117121b95f5cdca83f5cbb5931a3` / `1e7e2ee97e9149b37549e144a6479f85`) | **não** |
| 0060 | `cex_execution_intents.strategy_hash`; auth `(uuid)` | **não** |
| 0061 | `cex_execution_intents.credential_fingerprint` | **não** |
| 0062 | constraint `cex_fills_intent_dedupe` (vive a antiga `cex_fills_dedupe`) | **não** |
| 0063 | `cex_conexoes.credential_identity` / `is_current` / `superseded_at` | **não** |
| 0064 | `autopilot_sessions.contabilidade_incompleta_em`; `autopilot_position_effects` | **não** |
| 0065 | `autopilot_rearm_preserva_rails` | **não** |
| 0066 | `dca_gasto_real_comprometido_hoje` | **não** |

### Y.3 O migration history remoto — divergência confirmada

| fato | detalhe |
|---|---|
| versões | por **data** (`20260915173714`…), não pelo número do repositório, exceto `0001`, `0002` |
| 0050–0054 | aplicadas 15/09 17:37–22:35 com os nomes do repo (`execucao_cex_intents_e_fills`, `execucao_cex_rpcs`, `certificado_de_estrategia`, `sessao_carrega_estrategia`, `tier_da_sessao_revalidado`) |
| 0055–0058 | aplicadas 16/09 10:14–10:15 com prefixo numérico; **ordem real 0055, 0056, 0058, 0057** |
| **só em produção** | `execucao_cex_rls` (15/09 18:04); `indice_vitrine_das_mesas` e `desfaz_indice_vitrine_sem_ganho_medido` (14/09); **`0050_celeiro_alavancado_geometria_medida`** (16/09 02:15) — nome **colide** com a `0050` do repositório, que é outra migration |
| nomes divergentes | ex.: `admin_wallet_solana2` × `0003_admin_wallet_phantom`; `celeiro_motivo_saida_liquidacao` × `0049_celeiro_saida_por_liquidacao` |
| consequência | aplicar "por número" não é seguro. O release aplica o **conteúdo** de 0059→0066 sobre o schema vivo, provado antes em banco descartável criado a partir desse schema (Fases 1–2) |

### Y.4 O que falta da Fase 1

1. Diff de **conteúdo** das funções, ACL e constraints vivas de 0050–0058
   contra o repositório (presença já provada; versão não).
2. Inventário das quatro entradas só-de-produção — o que criaram e se o
   repositório precisa delas para reproduzir o schema vivo.
