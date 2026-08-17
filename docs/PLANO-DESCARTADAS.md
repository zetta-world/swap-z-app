# PLANO — as descartadas: o teto de credibilidade está cego?

**Status: 🟢 medição entregue, ainda não rodada em produção** · 17/08.

---

## O achado que abriu isto

Em 17/08, olhando por que NENHUMA mesa opera na carteira de papel, as quatro
mesas do topo (Arbiter, Arbiter 2.0, NÍÐHÖGGR, FÁFNIR) apareceram com
`nenhum candidato em 24 ticks` — 24 ticks cada, 24 horas, todos vazios.

Não é mercado parado. É **aritmética**:

| mesa | piso de custo | teto de credibilidade | janela |
|------|---------------|------------------------|--------|
| `arbiter` | **0,55%** | 0,30% | vazia |
| `arbiter2` | **0,60%** | 0,30% | vazia |
| `arbiter2_3x` | **0,60%** | 0,30% | vazia |
| `arbiter2_5x` | **0,60%** | 0,30% | vazia |

Para abrir, um spread precisa ser **maior que o piso** (senão não paga o custo)
e **menor que o teto** (senão é dado podre). O piso está acima do teto: o
conjunto é vazio, e é vazio por construção, não por conjuntura.

Isto o código já sabe e já diz — `spreadWindow()` devolve
`empty: floorPct > maxGrossPct`, e o evento `arb_window_empty` carrega a frase
*"piso de custo acima do teto de credibilidade — estratégia sem trade neste
custo"*. A janela vazia é uma AFIRMAÇÃO, e ela está funcionando.

**O que ninguém verificou é se a afirmação está certa.**

## A pergunta

Nas últimas 24h houve **83** `arb_data_anomaly` — spreads acima do teto,
descartados por incredulidade. Exemplo de 17/08 18:59:

```json
{ "symbol": "POL", "buy": "gateio", "sell": "binance",
  "spreadPct": 0.56, "ceilPct": 0.3, "floorPct": 0.55,
  "venues": 5, "acimaDoPiso": true,
  "why": "acima do teto de credibilidade E do piso de custo — pagaria se fosse real" }
```

Cinco corretoras cotando, spread acima do piso. O sistema descarta ~83 dessas
por dia. **São cadáveres de listagem ou dinheiro passando na frente?**

⚠️ A medição de hoje já eliminou o piso da lista de suspeitos: a derrapagem a
$50 deu **0,000%** de impacto e a taxa medida da Gate.io é 0,2%/perna. O piso
de 0,55% descreve um custo REAL. Quem está sob suspeita é o **teto**.

## O que o próprio código já pediu, e ninguém fez

`arbiter.ts:483`, no comentário do campo `acimaDoPiso`:

> *"`true` = este spread pagaria o custo se fosse real, e foi descartado por
> incredulidade, não por inviabilidade. **Merece livro lido**, não venue
> removida."*

E o livro nunca é lido — porque na linha seguinte (`arbiter.ts:494`)
`const arbs = all.filter((x) => !x.suspect)` tira as anômalas **antes** do
portão de profundidade (F2). O comentário descreve uma ação que o fluxo não
executa.

Esta medição é essa ação.

## O método

1. Ler do `platform_events` as `arb_data_anomaly` da janela, **só as que têm
   `acimaDoPiso = true`** — as abaixo do piso não pagariam nem se fossem reais,
   e julgá-las diluiria a resposta.
2. Reduzir a ROTAS distintas (`símbolo:compra>venda`).
3. Para cada rota, **ler os dois livros agora** com `fetchOrderbook` — o mesmo
   caminho que o arbiter usa para decidir dinheiro.
4. Rodar `assessRealism` a **$50**, o tamanho que as mesas operam.
5. Passar pelo `realismGate` com o **mesmo** `MIN_NET_PCT` da mesa.

⚠️ **REUSO TOTAL, DE PROPÓSITO.** Nada de matemática nova: `fetchOrderbook`,
`assessRealism`, `realismGate` e `spreadWindow` já existem e já são o que
decide abrir posição. A pergunta é literalmente *"o que o portão do arbiter
diria se ele visse estas rotas"*, e só o caminho idêntico responde isso. Uma
segunda implementação da mesma conta responderia outra pergunta e pareceria a
mesma — a família de defeito que este repo mais paga.

## As três respostas possíveis

| classe | o que significa | o que fazer |
|--------|-----------------|-------------|
| **CADÁVER** | livro não respondeu ou veio vazio | o teto está certo — é exatamente o caso para o qual foi criado |
| **RASO** | livro lê, mas a profundidade come o spread | o teto acerta **pelo motivo errado**: não é cotação podre, é liquidez fina |
| **REAL** | o líquido sobrevive a andar o livro a $50 | o teto está cego, e há número para discuti-lo |

**Se REAL = 0, a questão fecha**: as quatro mesas estão corretamente paradas, e
a resposta honesta é "esta estratégia não paga neste custo". Isso é um
resultado, não um fracasso.

**Se REAL > 0**, aí existe base para conversar sobre `MAX_GROSS_PCT` — com
contagem, símbolos e livro lido, não com intuição.

⚠️ Esta medição **não muda gate nenhum**. Ela não escreve em `admin_kv`, não
abre posição, não toca em `MAX_GROSS_PCT`. Mexer num portão de dinheiro por
palpite é o hábito que este laboratório existe para não ter. Mede primeiro.

## ⚠️ O que isto NÃO mede

1. **Não é replay.** Lê o livro de AGORA, não o do instante da anomalia. Uma
   rota que era real às 18:59 e morreu às 20:00 aparece como cadáver, e
   vice-versa. O veredito é honesto sobre a **rota**, nunca sobre o evento
   histórico. Chamar isto de "as anomalias eram falsas" seria mentir com
   número certo.
2. **A contagem de eventos não é a frequência real.** O dedup de
   `arbiter.ts:473` anuncia uma vez por hora por rota. Uma rota com 24
   anúncios em 24h pode ter ocorrido em todos os ticks — ou em 24 deles.
3. **Não mede duração.** Se o spread viveu segundos ou horas não aparece aqui;
   isso pediria amostragem repetida da mesma rota, que é outra medição.
4. **Não mede a perna de execução.** Andar o livro é o piso do custo, não o
   custo total — falta a derrapagem de tempo entre decidir e preencher, que
   segue sem instrumentação (ver `PLANO-DERRAPAGEM.md`).

## Nota de método: a trava que me pegou

A leitura de `platform_events` passou na primeira escrita com `.limit(1000)` — e
o `read-safety.test.ts` reprovou. A regra do repo: `limit` é um PEDIDO, o
PostgREST tem teto próprio, e leitura que trunca em silêncio devolve resposta
menor sem erro nenhum.

O conserto não foi só declarar o recorte. Declarar explica a decisão a quem lê o
código; não ajuda quem lê a TELA. Por isso o estouro também viaja na resposta
como `historicoTruncado` — a mesma regra do `rotasIgnoradas`. Corte silencioso
lê-se como "vi tudo", e essa é a mentira mais barata que uma medição conta.

⚠️ E o marcador `leitura-limitada:` tem de estar nas **8 linhas acima** da
consulta. O meu estava a 13, atrás de um bloco de justificativa — a trava
reprovou de novo, com razão: comentário longe da linha é comentário que a
próxima edição não vê.

## Pendências que este plano NÃO resolve

- **O abridor direcional.** `paper_open_skip` × 88 em 24h: a ULLR com
  `sem_preco_de_pool: 7` (o defeito da FREYJA, `engine.ts:198`, que já teve uma
  correção e voltou) e a `strat_mech` parada desde 09:00. É outro problema, com
  outra causa, e merece plano próprio.
- **O spread sem dono.** O orçamento é a taxa publicada e só; a derrapagem
  exclui o spread de propósito (referência é o topo do livro). Num ciclo a
  mercado ele é pago e não está em nenhum dos dois.
- **Guardar os seis tamanhos da derrapagem**, não só o corte de $50.
