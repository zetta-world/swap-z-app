# PLANO — uma constante, dois significados, meia taxa a menos

**Status: 🟢 entregue** · 16/08, item 1 da fila combinada com o dono.

---

## O defeito

`BACKTEST_COST_PCT ?? 0.2` era lido em **catorze lugares com dois significados
incompatíveis**, e nada no nome dizia qual:

```
paper/engine.ts       const netPct = grossPct - COST_PCT;       ← o ciclo INTEIRO
tournament/route.ts   gross - ROUND_TRIP_COST_PCT               ← o ciclo INTEIRO
cull.ts               a.sum / a.resolved - COST_PCT             ← o ciclo INTEIRO

lab/tendencia.ts      a.pesoPct * (custoPct/100) * 2            ← POR PERNA
zion/benchmarks.ts    equity *= 1 - (costPct/100) * pernas      ← POR PERNA
```

O mesmo `0,2` significava "o ciclo custa 0,2%" num arquivo e "cada perna custa
0,2%, logo o ciclo custa 0,4%" no outro. Duas medições do mesmo laboratório,
com o mesmo número, cobrando o dobro uma da outra.

## Quem estava certo: a corretora decidiu

A consulta pública à Gate.io (`lib/cex/taxa-gateio.ts`, 10 pares, mediana,
gravada como `lab_custo_cex` em 15/08) devolveu **0,2% POR ORDEM**. Uma ida e
volta são duas ordens: **0,4%**.

Logo a família "ida e volta = 0,2%" cobrava **metade da taxa real** — inclusive
em três lugares que não são só medição:

| onde | o que decide |
|---|---|
| `paper/engine.ts` | `pnl_usd`, ou seja o **caixa** das carteiras |
| `cull.ts` | **desliga** mesa por expectância negativa |
| `admin/launch-gate.ts` | libera estratégia para **dinheiro real** |

## Por que nenhum teste falhava

`pnl-math.test.ts` tinha `const COST = 0.2;` digitado à mão, com o comentário
*"BACKTEST_COST_PCT padrão"*. A cópia estava certa no dia em que foi escrita e
passou a mentir junto com o código: **oito asserções verdes em cima de metade da
taxa real.**

Um teste que copia a constante que deveria conferir não confere nada — ele só
garante que a cópia continua igual à cópia. É a mesma família de defeito da
invariante nº 25: a verificação existe e não verifica.

## O conserto

**Não é trocar o número.** Um `0.4` digitado em catorze arquivos volta a divergir
na primeira vez que alguém mexer num só. `lib/zion/custo.ts` tem UM primitivo e
derivados com nome que não deixa confundir:

```ts
CUSTO_POR_PERNA_PCT      // 0,2 — a taxa medida, por ordem
PERNAS_POR_CICLO         // 2   — o número que sumiu de metade do sistema
CUSTO_IDA_E_VOLTA_PCT    // 0,4 — entrar e sair
custoDePernas(n)         // grades e rebalanceamentos
```

Quem escreve `CUSTO_IDA_E_VOLTA_PCT` não consegue achar que está cobrando uma
perna. As doze chamadas migraram; as arbitragens (`ARB_COST_PCT` 0,4 = duas
pernas taker, `ARB2_COST_PCT` 0,45 = ciclo de quatro) ficaram fora **de
propósito** — já nasceram com o ciclo embutido e já estavam certas.

## O impacto, medido

Toda mesa piora exatamente 0,2 ponto por trade:

| mesa | decididos | bruto | líquido ANTES | líquido AGORA |
|---|---|---|---|---|
| GERI | 1 | +7,040 | +6,840 | **+6,640** |
| SLEIPNIR | 1 | +2,410 | +2,210 | **+2,010** |
| HEIMDALL | 5 | +1,100 | +0,900 | **+0,700** |
| MUNINN | 3 | +0,903 | +0,703 | **+0,503** |
| VÖLUNDR | 42 | −0,858 | −1,058 | **−1,258** |
| SKAÐI | 19 | −1,303 | −1,503 | **−1,703** |
| URÐR | 2 | −1,395 | −1,595 | **−1,795** |
| MÍMIR | 12 | −2,003 | −2,203 | **−2,403** |
| FREYJA | 19 | −4,950 | −5,150 | **−5,350** |

⚠️ **Nenhuma mesa é cortada hoje.** O `decideCull` exige 100+ decididos na rodada
viva e a maior tem 42. O corte não dispara em ninguém — mas passa a disparar
mais cedo daqui para a frente, que é o comportamento correto.

## ⚠️ A fronteira que isto cria no ledger

`paper_positions.pnl_pct` é gravado LÍQUIDO **no instante do fechamento**. As
posições fechadas antes de 16/08 carregam o custo antigo; as de depois carregam
o novo. **Nada no banco distingue as duas** — mesma coluna, mesmo tipo.

As medições que recalculam a partir do bruto (torneio, backtest, cull) não têm
esse problema: aplicam o custo na leitura, então a série inteira muda junto e
continua coerente. **O problema é só do que foi CONGELADO.**

`FRONTEIRA_CUSTO_ISO` está exportada para que uma média longa possa cortar ali,
e para que a data não viva só num comentário.

**Decisão em aberto, e é do dono:** arquivar a rodada de papel e recomeçar com a
régua nova (o padrão que `recapitalize.ts` documenta para "a régua mudou"), ou
conviver com a fronteira e cortar nas leituras. Não fiz nem um nem outro —
arquivar carteira é ato do operador, nunca automático.

## O que continua sem cobertura

O primitivo é a taxa MEDIDA, e só ela. **Derrapagem não está aqui** porque nunca
foi medida — nem no CEX nem no DEX. O `compararCusto` já dizia: taxa de 0,2% com
orçamento de 0,2% por perna deixa **sobra ZERO** para impacto de preço.

Os resultados continuam otimistas, agora por uma margem menor e conhecida em vez
de otimistas pelo dobro da taxa e por motivo nenhum. Somar um buffer chutado aqui
trocaria um erro medido por um palpite.
