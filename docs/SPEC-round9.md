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

### A134 / A135 — as reservas de inventário (adendo do auditor)

Conferir não é reservar. A posse e a exposição eram lidas, conferidas, e só
depois a ordem saía — e duas requisições simultâneas leem o MESMO estado:

```
posição do bot = 0,01 · duas vendas de 0,01 → saem 0,02, e 0,01 é do dono
exposição 190, teto 200 · duas compras de 10 → 210 > 200
```

O teto DIÁRIO é atômico desde o A132 e não substitui nada: ele responde
"quantas ordens cabem hoje", e havendo duas vagas as duas passam por ele.

```sql
autopilot_reservar_venda(session, base, qty)      -- for update na posição
autopilot_liberar_venda(session, base, qty)
autopilot_reservar_exposicao(session, usd, teto)  -- for update na sessão
autopilot_liberar_exposicao(session, usd)
```

- a reserva de venda LIMITA à posição do bot (mantém a conduta do A131);
- a de exposição soma o que está no livro **e** o que já está prometido;
- devolução só na recusa **provada** — inclusive nas recusas anteriores à
  reserva do executor (kill-switch, credencial), que nunca passariam pelo
  `liberar` dele. `UNKNOWN` não devolve nada;
- as duas **expiram** (`autopilot_janela_de_reserva`, 10 min): uma reserva que
  sobrevive a uma ordem que nunca existiu trancaria a posição para sempre;
- a projeção **converte** a reserva em efeito, na mesma transação que aplica.

### A136 — a liquidação da saída armada, numa transação

`settleArmedExits` escrevia o marcador e a posição em operações separadas:

```
marcador OK + posição falha → a reconciliação vê delta zero para sempre
posição OK + marcador falha → a reconciliação reduz DE NOVO
```

Inverter a ordem só troca qual acontece. `autopilot_liquidar_saida_armada`
(0064) faz as duas numa transação, e com isso `closeServerPosition` e
`reduzirServerPosition` — os últimos escritores paralelos de posição — deixaram
de ter caller e foram **apagados**, com lápide.

### A137 / A138 / A139 — segundo adendo do auditor

**A137 — a reserva tem dono.** Era contador agregado com TTL de 10 min. O TTL
esquecia ordem viva; o agregado misturava compromissos. Agora:

```sql
autopilot_reservar_venda_do_intent(intent, qty)
autopilot_reservar_exposicao_do_intent(intent, usd, teto)
autopilot_liberar_reserva_do_intent(intent)
autopilot_compromisso_vivo(reservado, aplicado, estado)
  → 0 quando CANCELED/FAILED_PRE_SUBMIT, senão greatest(reservado − aplicado, 0)
```

A costura `ReservaDeRisco` passou a receber `intentId`. Pré-voo dimensiona;
reserva autoriza. Concessão parcial na costura é **recusa**.

**A138 — P&L na mesma transação.** `pnl_aplicado_usd` no marcador; a projeção e
a liquidação aplicam `recebido(delta) − custo removido − taxa` e atualizam
`pnl_today`/`frozen_until_day` junto da posição. `applySessionPnl` e
`realizedFromSell` foram removidas.

**A139 — identidade histórica da saída.** `autopilot_positions.exit_intent_id`;
a liquidação resolve a credencial por `intent.conexao_id` (A127) e a RPC confere
armado + mesmo intent + mesma corretora + mesmo `external_order_id`. Legado sem
elo: `saida_sem_identidade`, fail-closed.

### A140 / A141 / A139-H — patch cirúrgico final

**A140 — a taxa é cumulativa, e o recovery não tem memória.**

`fee_total` do intent é a taxa ACUMULADA (0059: o valor final independe do
número de snapshots). A projeção descontava `p_taxa_usd` inteiro a cada
parcial — 320/taxa 1 e depois 640/taxa 2 fechavam **37** em vez de 38 — e
recebia esse número de quem chamava. A varredura de pendências não tinha como
saber dele e projetava com taxa **zero**.

| campo | o que é |
|---|---|
| `applied_qty` | quanto da QUANTIDADE já está na posição |
| `applied_quote` | quanto do RECEBIDO/GASTO já está na posição |
| `fee_aplicada_usd` | quanta TAXA (USD) já foi descontada do P&L |
| `pnl_aplicado_usd` | quanto RESULTADO já entrou no `pnl_today` |

```sql
autopilot_taxa_do_intent_em_usd(fee, moeda, symbol, filled_qty, filled_quote)
  → estável: o próprio valor
  → moeda BASE: converte pelo preço do próprio fill
  → qualquer outra: NULL (não se inventa preço; quem chama registra)
```

- `v_taxa_delta = v_taxa_total − fee_aplicada_usd`; negativo ⇒
  `regressao_de_taxa`, fail-closed (aplicar seria lucro artificial);
- taxa que cresce **sem quantidade nova** tem ramo próprio (`ajuste_de_taxa`),
  porque a 0059 permite exatamente isso quando os trades reais substituem o
  sintético — e `delta_qty = 0` jogava a taxa fora;
- o dia do freeze é `(current_timestamp at time zone 'UTC')::date::text`,
  **dentro** da transação. `p_hoje` deixou de existir: ele chegava `null` da
  varredura e o `case` caía no `frozen_until_day` antigo — o stop não congelava;
- `autopilot_projecoes_pendentes` seleciona por quantidade **ou** taxa pendente.

`projetarEfeitoDoIntent(intentId)` e `liquidarSaidaArmada(intentId, qtd, quote)`
não recebem mais nada financeiro.

**A141 — rollback da reserva composta.** A composição gastava a vaga diária e,
recusando na segunda etapa, devolvia `ok:false` com ela consumida — zero ordem
enviada e `trades_today` um a mais. O rollback passou para dentro do `reservar`
composto (os dois canais), e `liberar` **relata** se o CAS devolveu:
`autopilot_rollback_da_vaga_falhou` em severidade alta quando não devolveu.

**A139-H — null também é divergência.** `is distinct from` no lugar de "ambos
não-nulos e diferentes": posição armada em `EXT-1` com intent sem
`external_order_id` era exatamente o estado de quem não sabe qual ordem está
lá fora, e passava.

### A142 — o recebido também tem delta (achado da revisão sobre o A140)

`filled_quote` cresce com `filled_qty` parado (ACK sem `cost` → o executor
manda `cumulativeQuote = 0`; os trades reais trazem o valor depois). O P&L
estava atrás de `v_delta_quote > 0`, então a posição fechava, o custo saía do
livro e **nada** entrava no `pnl_today`; a chegada do recebido caía em
`sem_delta`. A liquidação, no mesmo caso, lançava `0 − custo` e congelava o dia.

```
realizado_total = applied_quote − custo_removido_usd − fee_aplicada_usd
delta           = realizado_total − pnl_aplicado_usd
```

Cinco watermarks, um contrato: `applied_qty`, `applied_quote`,
`fee_aplicada_usd` e `custo_removido_usd` são as entradas; `pnl_aplicado_usd` é
o que a conta produziu. **Sem recebido não se conta resultado** — a redução
fica guardada em `custo_removido_usd` e espera o livro.

Ramos novos: `ajuste_sem_quantidade` (recebido ou taxa chegando depois) e
`posicao_ja_encerrada` (fill posterior ao fechamento pelo mesmo intent — receita
sem custo novo, em vez de `sem_posicao` em laço).

### A143 — assentar antes de liquidar

`settleArmedExits` perguntava à corretora e liquidava na sequência.
`fetchCexOrderStatus` **não escreve no livro de execuções**, e desde o A140 a
RPC deriva a taxa do livro. Resultado: a venue dizia `filled=0,01 · cost=580 ·
fee=2` e a linha do intent seguia `filled_qty=0 · fee_total=null` — a taxa
entrava como ZERO, o prejuízo chegava menor ao `pnl_today`, e o stop de perda
diária não disparava **na mesma passada em que o cron compra**.

A ordem agora é quatro passos, num módulo só
(`src/lib/autopilot/assentamento-da-saida.ts`):

```
1. perguntar à corretora        (o cron, como sempre)
2. ingerir o snapshot no livro  (cex_ingest_order_snapshot)
3. confirmar RELENDO a linha    (intentPorId — o cliente resolve com {error})
4. liquidar com os números DO LIVRO
```

A taxa **não** volta a ser autoridade do TypeScript: o passo 4 passa
`filled_qty`/`filled_quote` duráveis, e a RPC deriva a taxa da mesma linha —
caminho imediato e recovery chegam ao mesmo número.

**Fail-closed com preço declarado.** Falhando o assentamento: saída fica
ARMADA (a ingestão é idempotente por `dedupe_key`, a passada seguinte tenta de
novo), ZERO P&L pela metade, evento em severidade alta, e a sessão **não abre
entrada nova nesta passada** — `fatosNaoAssentados` entra no mesmo portão de
`livroLegivelNoSettle`. Falhar na LIQUIDAÇÃO não fecha a sessão: o fato já
está no livro e a varredura de pendências volta nele.

### A144 — `CANCELED` não desfaz preenchimento parcial

`autopilot_compromisso_vivo` mandava `CANCELED` e `FAILED_PRE_SUBMIT` para
zero, juntos. Uma limitada que vendeu 0,004 de 0,01 e depois foi cancelada
liberava a bolsa inteira antes de a projeção aplicar aquele fill — a ordem
seguinte vendia 0,01 de uma posição que já tinha 0,006. Na compra o mesmo
buraco furava o teto de exposição.

```sql
when p_estado = 'FAILED_PRE_SUBMIT' then 0                      -- nada saiu
when p_estado in ('FILLED','CANCELED')                          -- nada mais SAI
  then greatest(p_executado - p_aplicado, 0)
else greatest(p_reservado - p_aplicado, 0)                      -- ainda preenche
```

`p_executado` é `filled_qty` na venda e `filled_quote` na compra — a mesma
unidade de `p_aplicado`. A assinatura de três argumentos é derrubada com
`drop function if exists` para não sobreviver como overload.

### A145 — o custo da compra que chegou atrasado

O ramo `ajuste_sem_quantidade` tratava só a venda. Numa COMPRA ele avançava
`applied_quote` e ia embora: o marcador dizia "600 aplicados" e
`autopilot_positions.cost_usd` continuava ZERO. É o caso comum — ACK sem
`cost`, quantidade cheia, dinheiro só nos trades depois.

Estrago permanente: exposição subavaliada (o bot compra mais do que pode) e a
venda futura calculando `recebido − 0 − taxa`, lucro inventado do tamanho da
compra. Agora o delta de quote entra em `cost_usd` (e em `entry_price`), **sem
tocar em `base_amount`**, na mesma transação que marca o quote como aplicado.
Sem posição onde entrar: `sem_posicao_para_custo`, fail-closed **visível**, e o
marcador NÃO avança — absorver antes da escrita é o defeito do A136.

### Auditoria obrigatória — sintético → real

`cex_ingest_trades` substitui os fills sintéticos pelos reais. Quando o
sintético estimou ALTO (ACK 600, trades 580), `filled_quote` CAI com
`filled_qty` parado. Dois `greatest()` escondiam a queda, e na VENDA isso
mantinha o resultado calculado sobre um recebido que não existiu — **US$ 20
otimista**, exatamente o número que alimenta o stop de perda.

Não é corrigido para baixo automaticamente: a conta acumulada do A142 saberia
aplicar delta negativo de P&L, mas a POSIÇÃO não sabe desfazer (na compra o
`cost_usd` já somou, e a linha pode já ter sido apagada). Corrigir metade da
conta é pior que parar. Duas guardas novas, simétricas às de quantidade e
taxa:

| onde | condição | motivo |
|------|----------|--------|
| `autopilot_projetar_efeito_do_intent` | `filled_quote < ledger_quote` | `regressao_de_quote` |
| `autopilot_liquidar_saida_armada` | `p_quote_recebido < applied_quote` | `regressao_de_quote` |

O livro de EXECUÇÕES continua certo (é ele que regrediu, para a verdade). O
que para é a PROJEÇÃO daquele intent, com evento de severidade alta.

## PARTE 3 — LIMITAÇÕES DECLARADAS

1. **A liquidação da saída armada é transacional (A136), mas ainda depende de
   encontrar o intent pela ordem externa.** Se essa leitura falhar, sai
   `autopilot_liquidacao_nao_aplicada` em severidade alta e a posição fica como
   está — retentável na passada seguinte, e sem meio efeito.
2. **Compra do navegador passou a respeitar o teto de exposição do modo de
   risco** (75/200/400). Antes passava, porque nada no servidor olhava. Isso
   pode recusar ordens que o usuário via como válidas na tela.
3. **A 0064 nunca foi aplicada.** O comportamento da RPC está provado contra o
   banco falso (que a reproduz) e por travas estruturais sobre o SQL. Não há
   execução real de Postgres nesta bancada.
4. **O P&L entrou na projeção (A138) e os writers paralelos foram REMOVIDOS**
   — `applySessionPnl`, `realizedFromSell`, `recordServerEntry`,
   `closeServerPosition`, `reduzirServerPosition` e `bumpSessionTrades` viraram
   lápides que quebram o `tsc` se alguém tentar ressuscitá-los.
5. **A regressão de `filled_quote` não é corrigida automaticamente** (auditoria
   sintético→real). Ela para a projeção daquele intent até mão humana. É o
   preço declarado de não produzir lucro artificial com aparência de conserto.
6. **O congelamento descoberto pela reconciliação DESTA passada ainda chega no
   tick seguinte.** A varredura de pendências roda ANTES do laço de sessões e
   cobre o que já está no livro; o que a reconciliação descobrir depois dela
   espera cinco minutos.
7. **`autopilot_compromisso_vivo` mudou de assinatura (A144).** A 0064 nunca
   foi aplicada, então o `drop function` no topo dela é hipotético — mas está
   lá para o caso de um rascunho ter sido aplicado em algum ambiente.
