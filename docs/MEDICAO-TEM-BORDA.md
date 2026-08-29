# MEDIÇÃO — as mesas têm borda?

**Status: 🟡 respondida com o que há · a janela limpa ainda é pequena demais
para ser prova** · 29/08.

> **Em uma frase:** cinco de seis mesas perderam para **não fazer nada**, por 3 a
> 21 pontos percentuais — e o único período em que elas pareciam ter borda é o
> mesmo que o artefato de execução atrasada explica.

---

## 0. Por que esta pergunta existe

Era o item 13 da §4 do `ESTADO-ATUAL`, e ficou aberto porque o painel sabia dizer
*"está lucrando"* e não sabia dizer *"está lucrando MENOS que parado"* — que é a
frase que decide. `lib/zion/comprar-e-segurar.ts` foi escrito em 20/08
exatamente para isso, e nunca tinha sido usado para responder a pergunta inteira.

⚠️ **A pergunta só pôde ser respondida DEPOIS de 29/08**, porque até então o
placar estava contaminado: as posições abriam em média 5 horas depois do sinal,
e numa alta isso produz lucro que parece borda (`PLANO-ATRASO-DE-EXECUCAO.md`).

---

## 1. A régua: segurar os símbolos que a própria mesa escolheu

Peso igual, mesma janela, mesmos símbolos. É a alocação mais burra possível — e é
esse o ponto: a barra que qualquer um pula sem pensar.

| mesa | mesa | segurar | diferença |
|---|---|---|---|
| strat_dex | −0,99% | −5,12% | **+4,13 pp** |
| strat_ai | −1,05% | +1,98% | −3,03 pp |
| strat_mech | +4,21% | +19,42% | **−15,21 pp** |
| strat_day | +4,04% | +19,79% | **−15,75 pp** |
| mistral_scan | +2,82% | +19,81% | **−16,99 pp** |
| radar | +0,70% | +21,93% | **−21,22 pp** |

⚠️ **A única que "ganhou" o fez ficando de fora de uma cesta que caiu.** Não é
acerto de direção, é ausência — e ela mesma perdeu dinheiro (−0,99%). É
exatamente o caso que a invariante da cor (`cor-resultado.ts`) existe para não
pintar de verde.

Em dinheiro: a melhor mesa fez **+$42** de uma oportunidade de **+$194** nos
mesmos símbolos e na mesma janela. **Capturou 22% da maré assumindo risco de
timing.**

---

## 2. Fui justo com elas — e o resultado piora

As mesas não ficam 100% investidas: expõem **3 a 13% do capital**. Comparar
retorno sobre capital TOTAL contra segurar 100% da cesta pune quem fica de fora,
então refiz sobre o **capital efetivamente exposto** (USD × horas ÷ janela).

| mesa | % do capital exposto | retorno sobre o EXPOSTO |
|---|---|---|
| strat_day | 7,07% | +57,1% |
| mistral_scan | 5,58% | +50,4% |
| strat_mech | 12,72% | +33,1% |
| radar | 11,25% | +6,3% |
| strat_dex | 9,03% | −11,0% |
| strat_ai | 2,99% | −35,3% |

Sobre o exposto, três mesas batem segurar com folga. **Se a história parasse
aqui, a resposta seria "sim, têm borda, só não alocam o suficiente".**

Ela não para aqui.

---

## 3. O teste que decide: separar as eras

O artefato de execução atrasada acabou em ~23/08 (`PLANO-ATRASO-DE-EXECUCAO`
§1). Mesmo cálculo, duas janelas:

| era | mesa | retorno sobre o exposto | n |
|---|---|---|---|
| **antes** (com artefato) | mistral_scan | **+75,0%** | 35 |
| | strat_day | **+59,1%** | 122 |
| | strat_mech | **+44,1%** | 112 |
| | radar | +18,8% | 47 |
| | strat_dex | −6,4% | 18 |
| | strat_ai | −35,3% | 11 |
| **depois** (limpo) | mistral_scan | **−7,3%** | 9 |
| | strat_dex | **−14,1%** | 6 |
| | strat_mech | **−14,1%** | 12 |
| | radar | **−21,0%** | 11 |
| | strat_day | **−24,8%** | 13 |

⚠️ **Cinco de cinco negativas quando o preenchimento volta a cair em cima da
referência.** Não é uma mesa que quebrou: é todas, ao mesmo tempo, no momento em
que o artefato sumiu.

---

## 4. O critério do próprio repo derruba o que sobrou

A casa só confia em amostra com **≥100 decididas** (`MIN_SAMPLE`), e `expired`
não conta — não é veredito.

| mesa | decididas | expiradas | expectância LÍQUIDA | amostra suficiente? |
|---|---|---|---|---|
| mistral_scan | 42 | 2 | +0,895% | ❌ |
| **strat_mech** | **117** | 7 | **+0,329%** | ✅ |
| strat_day | 55 | 80 | +0,130% | ❌ |
| radar | 55 | 3 | −0,226% | ❌ |
| strat_dex | 18 | 6 | −1,684% | ❌ |
| strat_ai | 11 | 0 | −2,317% | ❌ |

Uma única mesa passa no critério: `strat_mech`, com expectância líquida
**+0,329%** por trade.

⚠️⚠️ **E 112 dos seus 124 trades são anteriores a 23/08.** A única amostra que
passa no critério é justamente a contaminada. Depois de 23/08 ela fez **10
decididas, todas stop**.

---

## 5. A resposta

### O que eu afirmo

Depois de ~400 posições fechadas, em seis mesas, ao longo de um mês:

1. **Nenhuma mesa tem amostra suficiente E não contaminada com expectância
   líquida positiva.**
2. **Contra a régua de segurar, cinco de seis perderam** — e a sexta perdeu
   dinheiro.
3. **A única janela limpa é negativa em todas as mesas.**

### O que eu NÃO afirmo

Que está provado que não existe borda. A janela limpa tem **51 trades em 5
dias** — abaixo do `MIN_SAMPLE = 100` do próprio repo. É sinal forte, **não
prova**, e tratar como prova seria cometer com o sinal negativo o mesmo erro que
o placar cometia com o positivo.

### O que fazer com isso

⚠️ **O certo NÃO é desligar as mesas hoje.** É parar de tratar o placar como
evidência de borda e deixar a amostra limpa crescer até 100 decididas. Aí a
resposta vira definitiva num sentido ou no outro — e o critério para julgá-la
está escrito aqui, ANTES dos dados chegarem:

> **Critério, escrito em 29/08:** com ≥100 decididas abertas depois de 23/08, uma
> mesa demonstra borda se tiver expectância líquida positiva **E** diferença
> positiva contra segurar na mesma janela. As duas coisas. Expectância positiva
> perdendo de segurar é a definição de escolher pior que não escolher.

---

## 6. O gráfico

`ContraSegurar`, no topo do painel do TORNEIO. Barra cheia = a mesa; marca
vazada = segurar os mesmos símbolos.

⚠️ **A cor tem três estados, e o terceiro é o caso desta tela inteira.** O
primeiro rascunho usava `corDoPnl` (dois estados) e teria pintado a `strat_mech`
de **verde** por ter feito +4,21% — escondendo que segurar deu +19,42%.

```
perdeu dinheiro ......................... VERMELHO, sempre
ganhou dinheiro E bateu segurar ......... VERDE
ganhou dinheiro e PERDEU de segurar ..... ÂMBAR   ← o caso de hoje
```

⚠️ Vermelho vale **mesmo batendo segurar** — foi assim que a `strat_dex` ficou
vermelha por perder −0,99% enquanto a régua caía −5,12%. Bater a régua não salva
quem encolheu o capital, e essa é a cicatriz de 12/08 (`cor-resultado.ts`).

Trava: `src/lib/admin/mesa-contra-segurar.test.ts`, quebrada nas duas direções
antes de entrar.
