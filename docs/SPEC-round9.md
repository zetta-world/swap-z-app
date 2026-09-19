# SPEC — ROUND 9 CIRÚRGICO (A131 + A132 + A133)

**Papel:** implementador. A certificação é do auditor independente.
**Status máximo:** `FIXED — PENDING INDEPENDENT RETEST`.
**Baseline:** `83c50fe3acb8f019cd56ed2018f712cd0f2acf49` (Round 8 final).
**Branch:** `round9-surgical`.

---

## PARTE 1 — DIAGNÓSTICO (medido antes de qualquer edição)

Cada item abaixo foi conferido por leitura de código no bundle do Round 8, não
por memória.

### 1. `getOpenServerPositions` — A133

`positions-server.ts:58` fazia `if (!db) return []` e `if (error) return []`.
Três callers: `cron/route.ts:140` (saídas armadas), `cron/route.ts:767`
(inventário/exposição da passada), `reconciliar-conta.ts:100`.

O caller opera sobre `[]`: `exposureUsd` vira 0, `ownedBases` vira vazio. Um
Postgres intermitente virava licença para comprar. O conserto **já estava
escrito uma camada acima** — `reconciliar-conta.ts` documenta que falha de
leitura é `leitura_falhou` e bloqueia entradas —, mas quem engolia o erro era a
função abaixo dela. Família do A113.

### 2. `recordServerEntry` — A133 §6

`const { data: prev } = await db…` com `error` descartado. Falha de leitura
virava "não existe posição", e o ramo de baixo UPSERTAVA por
`(session_id, base)` — sobrescrevendo o acumulado do dia pelo tamanho da última
compra.

### 3. Duas primitivas para a mesma vaga diária — A132

`reservarTradeDaSessao` (CAS, antes do envio) só era chamada por
`/api/cex/order`. `bumpSessionTrades` (`trades_today + n`, **sem conferir
teto**) era chamada em quatro pontos do cron, todos DEPOIS da ordem.

### 4. Dois livros de posição — A131

| | livro | quem lê |
|---|---|---|
| servidor | `public.autopilot_positions` | só o cron |
| navegador | `zswap_autopilot_positions_v1` (localStorage) | só a tela |

`quantoPodeVender` tinha **um único caller**: `cron/route.ts:951`. A
`/api/cex/order` nunca o chamou. `RISK_EXPOSURE_USD` vivia só no cron; o
navegador tinha outro teto no Zustand.

### 5. Fill tardio nunca chegava ao livro — A131-C

`grep` de `recordServerEntry|positions-server|autopilot_positions` em
`reconciliador.ts`: **zero ocorrências**. O comentário do cron
(`"posicao abre na reconciliacao"`) descrevia um mecanismo que não existia.

### 6. O esquema não provava exactly-once

`autopilot_positions` tem `unique (session_id, base)` — uma linha por par, e
nada sobre QUAIS execuções já estão dentro dela. `cex_fills` é deduplicado por
`(exchange_id, dedupe_key)`: isso protege o livro de EXECUÇÕES, não a PROJEÇÃO
dele na posição. Daí a migration 0064.

---

## PARTE 2 — CONTRATOS

### A133 — leitura do livro

```ts
type LeituraDePosicoes  = { ok: true; posicoes: Row[] } | { ok: false; porque: string };
type LeituraDeUmaPosicao = { ok: true; posicao: Row | null } | { ok: false; porque: string };
```

- sem banco é **falha**, não "não há posições";
- `data` nulo sem erro é leitura vazia **legítima**;
- o cron PARA a passada quando o livro não pode ser lido (zero scan, zero ordem
  nova, telemetria `autopilot_livro_ilegivel`); a reconciliação de intents
  pendentes roda fora de `processSession` e continua acontecendo (recovery de
  ordem já enviada não é efeito novo);
- `reconciliarConta` devolve `leitura_falhou`/`posicoes`, nunca `sem_drift`.

### A132 — uma reserva

`reservaDaVagaDiaria(sessionId, hojeUtc)` devolve um `ReservaDeRisco`:

- `reservar` → CAS `trades_today = lido+1 where trades_today = lido and
  is_active and last_reset_day = hoje` + `.select("id")`;
- `liberar` → CAS de volta, **só** na recusa provada; nunca em `UNKNOWN`;
- `ultimoMotivo()` distingue `limite_diario` (parada legítima) de
  `erro`/`virou_o_dia`/`sessao_inativa` (contador não confiável → a passada
  para de disparar);
- **uma por ordem**: cada perna de um cartão multi-perna cria a sua.

`bumpSessionTrades` foi **apagada**, com lápide no lugar.

### A131 — posse e exposição

```ts
avaliarVendaAutonoma({ leitura, pedido })
  → livro ilegível | sem posição | saída já armada | quantidade inválida
  → ou { qtd limitada à posição, limitada, naPosicao }
avaliarExposicaoParaEntrada({ leitura, novaEntradaUsd, tetoUsd })
tetoDeExposicaoDoRisco(riskMode)   // conservador 75 · moderado 200 · agressivo 400
```

A rota usa `quantidadeAutorizada` (não `body.amount`) no guarda de nocional, na
política, no executor e na resposta. Manual não passa por posse.

### A131-C — projeção idempotente (migration 0064, **não aplicada**)

`autopilot_position_effects(intent_id pk, session_id, exchange_id, base, side,
applied_qty, applied_quote, ledger_qty, ledger_quote)`.

`autopilot_projetar_efeito_do_intent(p_intent_id, p_qty_ja_aplicada,
p_quote_ja_aplicada)`, `security definer`, `search_path` fixo, `revoke` de
public/anon/authenticated, `grant` a `service_role`:

1. `for update` no intent → origem autônoma, não simulado, com sessão;
2. `for update` no marcador (criado se não existir);
3. **absorção** opcional (só a liquidação da saída armada usa);
4. **regressão** medida contra `ledger_qty` → fail-closed;
5. delta = `greatest(filled − applied, 0)`;
6. `for update` na posição → compra soma (preço médio), venda reduz com custo
   proporcional (`oQueSobrou`) e fecha quando zera;
7. marcador atualizado na mesma transação.

**Duas marcas d'água, e a razão:** `applied` é o que entrou na posição (venha da
projeção ou da liquidação); `ledger` é o que o livro dizia. Comparar regressão
contra `applied` acusaria regressão sempre que a liquidação chegasse antes da
ingestão dos fills — defeito encontrado escrevendo o próprio teste.

**Sem backfill (§38):** não há registro de quais fills entraram nas posições que
já existem. Elas continuam valendo como estado de abertura.

---

## PARTE 3 — LIMITAÇÕES DECLARADAS

1. **A liquidação da saída armada ainda escreve direto.** `settleArmedExits`
   reduz a posição a partir da ordem lida na corretora, porque o P&L realizado
   é calculado contra a posição ANTES da redução. Ela ABSORVE o valor no
   marcador para a reconciliação não reduzir de novo. Se a absorção falhar
   (intent não encontrado por ordem externa, banco fora), o evento
   `autopilot_absorcao_nao_registrada` sai em severidade alta — e a redução
   pode ser aplicada em dobro numa reconciliação posterior. É o único ponto do
   Round 9 em que a convergência é por registro, e não por construção.
2. **Compra do navegador passou a respeitar o teto de exposição do modo de
   risco** (75/200/400). Antes passava, porque nada no servidor olhava. Isso
   pode recusar ordens que o usuário via como válidas na tela.
3. **A 0064 nunca foi aplicada.** O comportamento da RPC está provado contra o
   banco falso (que a reproduz) e por travas estruturais sobre o SQL. Não há
   execução real de Postgres nesta bancada.
4. **P&L continua fora da projeção.** `applySessionPnl` e `realizedFromSell`
   seguem como estão; o Round 9 uniu o livro de POSIÇÃO, não o de resultado.
