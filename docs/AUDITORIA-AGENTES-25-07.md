# Auditoria completa dos agentes — 25/07 (dados até 14:57 UTC)

> Pedido do CEO: medir a coorte, auditar TODOS os agentes, achar a causa-raiz
> de cada falha e a receita pra torná-los os mais lucrativos do mercado.
> Fonte: ledger vivo (rodada 2, pós-arquivo), livro de paper das mesas,
> arquivo da rodada 1 como referência.

## Placar geral (rodada viva)

| Agente | W/L/E | Exp. líq. | Estado |
|---|---|---:|---|
| **Arbiter ⚖️ (spot)** | 340 ciclos, 0 perdas | **+0,30%/ciclo** | 🟢 melhor da casa (+$47,02) |
| **Arbiter 2.0 ⚡ (futuros)** | 100 ciclos, 0 perdas, 0 timeouts | **+0,15%/ciclo** | 🟢 **+5,3% sobre $300 em 4d** — eficiência de capital ~3× o 1.0 |
| Sniper 🎯 | 5W/6L | −0,22% | 🟡 quase breakeven; falha diagnosticada (abaixo) |
| Radar | 10W/13L/6E | −0,45% | 🟡 controle; leve vermelho no chop |
| Oráculo (4 modelos) | 0W/5L, 9 abertas | −5,9%/tese decidida | 🔴 falha diagnosticada (abaixo) |
| Scanners (bot, pausados) | 12W/93L/26E final | −0,45 a −1,75 | ⚫ baseline morto, zero token |

Integridade: soma das posições == carteira nas duas mesas ($47,02 e $16,04),
sem drift. Custo de IA: ~5-6 calls/dia (era ~288).

## Causa-raiz por agente

### 🔴 ORÁCULO — três falhas de desenho, todas corrigíveis

As 5 teses decididas perderam ~−5,9% cada. A anatomia mostra que são
**quase o mesmo trade**: ARB comprado em regime RANGING (5 das 5), por
DeepSeek E Mistral, dias 17 e 18/07 — **o Mistral foi stopado em ARB no dia
17 e recomprou ARB no dia 18** (stopado de novo).

1. **Amnésia entre chamadas.** Cada wake diário é stateless: o modelo não
   sabe que emitiu (e perdeu) a mesma tese ontem. Sem memória, "convicção"
   vira teimosia gratuita — recompra a mesma faca que caiu.
2. **Tese de reversão sem evidência informacional.** Liberamos contra-
   tendência exigindo "Invalida se:", mas a F2 (feed de notícias/eventos)
   não existe ainda — então o "contexto" é quase só indicador, e uma tese
   de reversão sem informação nova é só bottom-fishing com stop de 5%.
3. **Concentração sem trava.** 6 das 14 teses da mesa inteira em ARB.
   Nenhum limite por símbolo, nem por modelo nem global.

**Receita (ordem de impacto):**
- **Memória de mesa**: o prompt diário passa a incluir as teses abertas E
  as stopadas dos últimos 7 dias daquele modelo, com o resultado ("sua
  tese X foi invalidada há N dias; o que mudou pra reabrir?").
- **Cooldown por símbolo pós-stop (7d) + máx 1 tese aberta por símbolo por
  modelo**; teto de exposição por símbolo na mesa inteira (ex.: 2 modelos).
- **F2-notícias** antes de confiar em tese de reversão (era a fase 2 do
  plano original — virou pré-requisito de reversão: sem evento novo, só
  tese A FAVOR da estrutura semanal).
- Amostra segue pequena (5 decididas) — corrigir o desenho AGORA, julgar o
  formato com ≥30 decididas pós-correção.

### 🟡 SNIPER — o stop mora dentro do ruído

5W/6L quase breakeven, e o padrão é nítido: as derrotas tiveram stop de
**0,56-1,45%** (dentro do ruído intradiário — noise-out, não tese errada);
as vitórias, stops de 2-3% ou momentum imediato. O rrGate ≥2 induz o
modelo a APERTAR o stop pra fechar a razão — o mesmo defeito que matou os
scanners na rodada 2, em escala menor. Agravante: 2× ARB no mesmo dia
(21/07), sem cooldown por símbolo.

**Receita:**
- **Piso de stop por volatilidade**: stop mínimo = max(1,5×ATR-1h, 1,2%);
  se o modelo não constrói RR≥2 com esse piso, o setup não qualifica
  (mata o "aperta o stop pra passar no gate").
- **Cooldown por símbolo** (ex.: 12h) — sem re-atirar na mesma bala.
- Manter o resto: event-driven + orçamento provaram ser o único formato
  LLM direcional que chega perto de pagar (últimos 3 tiros: 2W, mercado
  direcional — o formato responde quando há tendência de verdade).

### 🟡 RADAR — controle, leve vermelho no chop

10W/13L −0,45. Sem mudança: ele é a régua dos experimentos. Mexer no
controle = perder a régua.

### ⚫ SCANNERS (formato bot) — causa-raiz PROVADA e enterrada

Formato era o teto (modelos indistinguíveis, prompt de cobertura, stop
no ruído, ADX atrasado). Decisão já executada: pausados, viraram baseline.
Receita: continuar mortos; modelos concorrem como Oráculos.

### 🟢 MESAS — nada a corrigir, só escalar com método

1.0: +0,30%/ciclo, 340 ciclos, invicto. 2.0: +0,15%/ciclo (custo 4 pernas),
100 ciclos, 100% convergência, ~15min/ciclo, +5,3% sobre capital em 4d.
Receita: **F2-orderbook** (profundidade real → quanto do spread sobrevive
e quanto tamanho aguenta) é o ÚNICO degrau até o teste com dinheiro real.
Depois: funding farming (feature guardada) com capital ocioso.

## Falha transversal encontrada (bônus da auditoria)

**`convictionFactor` no paper engine dimensiona posição pela probability
declarada do modelo** — que é comprovadamente ANTI-calibrada (win 32,7%
abaixo de 60 conf → 0% acima de 80). Hoje o paper aposta MAIS nos trades
em que o modelo está mais errado. Receita: neutralizar (fator 1,0) até
existir calibração medida por agente — e no futuro, dimensionar pela
calibração REALIZADA (flywheel), nunca pela declarada.

## Ordem de execução recomendada

1. 🟢 (25/07) Oráculo: memória de mesa no prompt (`<your_desk_memory>` com
   abertas + resolvidas de 7d por modelo), cooldown de 7d por símbolo
   pós-stop, máx 1 tese/símbolo/modelo, teto de 2 teses/símbolo na mesa.
2. 🟢 (25/07) Sniper: `stopFloorGate` — stop ≥ max(1,5×ATR-1h, 1,2%) — no
   gate E no prompt; cooldown de 12h por símbolo.
3. 🟢 (25/07) Paper: `convictionFactor` neutralizado (1× flat).
4. 🔴 F2-orderbook (mesas → real) e F2-notícias (Oráculo → reversões).

## Adendo — coorte do fim de semana (medida 27/07 09:01)

Os scanners rodaram 25-27/07 com Auto-Retro + lições + contexto. **O placar
bruto melhorou em todos** (DeepSeek −1,75→+0,60 · Kimi −1,39→+0,01 ·
Mistral −0,71→+0,12 · Grok −1,10→−0,29) — e é ARMADILHA DE REGIME:

| Coorte | buy win | sell win |
|---|---:|---:|
| pré (rodada 2) | 26% | 7% |
| fim de semana | **77%** (23W/7L) | **4%** (1W/27L) |

Compra ganhando 77% e venda perdendo 96% = rali, não disciplina (o espelho
exato do bear de 17/07). Agravante: 73 compras abertas vs 10 vendas — o
placar é uma aposta comprada em aberto. **Veredito: sem mérito provado;
scanners desligados de novo em 27/07 09:10.**

O que a coorte PROVOU de verdade:
1. **A Auto-Retro gera diagnóstico real.** Três modelos redescobriram,
   sozinhos, as conclusões desta auditoria — Claude: "stops abaixo de 1% em
   TRENDING_DOWN são clipados quase instantaneamente (DOGE 0,4%, SOL 0,8%,
   BNB 0,3%, XRP 0,7%, todos em <7h)"; Claude: "entradas duplicadas no mesmo
   ativo multiplicaram perdas — máx 1 por ativo"; Kimi: "cooldown de 48h por
   ativo após stop". Sem acesso a este documento.
2. **O vício do stop apertado seguia vivo nos scanners** (stop médio
   2,02% → **1,72%**, RR 2,58): a correção de 25/07 só cobriu o Sniper.
   Corrigido em 27/07 — piso `max(1,5×ATR, 1,2%)` no funil dos scanners,
   exatamente a lição que eles mesmos escreveram.
3. **Lição pode estar ERRADA** (Mistral, 25/07: "apertar stops para ≤0,5%" —
   o oposto da verdade; substituída na reflexão seguinte). Prova por que
   "lição é contexto, nunca permissão" e por que gate é código.
4. **Defeito corrigido**: o teto de 220 chars cortava a lição no meio da
   receita ("...require a s"). Agora 400.
