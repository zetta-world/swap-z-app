# Plano — Escola de traders: reconstruir as mesas uma a uma

Status: 🔴 proposto · 01/08

Este plano nasce de uma crítica do dono ao laboratório, e a crítica está certa.
Antes do plano, o diagnóstico — porque metade do problema é que os números na
tela não querem dizer o que parecem querer dizer.

---

## 1. O que os dados realmente mostram

### 1.1 Valhalla: não é contaminação póstuma, é amostra minúscula

A desconfiança do dono foi: *"mostra agente com lucro pequeno que não sei se foi
resultado dos trades que ficaram abertos quando eles morreram"*.

Fui medir. De **4.399** sugestões arquivadas, apenas **48** resolveram depois do
arquivamento — cerca de **1%**. Então **não**, os lucrinhos não vêm de rabo de
trade póstumo.

O problema é outro, e é pior, porque o palpite estava certo sobre o sintoma e
errado sobre a causa — que é o tipo de erro que faz a gente consertar a coisa
errada:

| Mesa em Valhalla | Mostra | Amostra REAL |
|---|---|---|
| SAGA | **+1,19%** | **3** sugestões (1 ganho, 1 perda, 1 expirada) |
| VÖLVA · Mistral | **+0,72%** | **5** (1 ganho, 2 perdas, 1 expirada, 1 aberta) |
| VÖLVA · Kimi | **+0,64%** | **2** (0 ganhos, 1 perda, 1 expirada) |
| VEÐRFÖLNIR | **+0,03%** | **14** (7 ganhos, 7 perdas — cara-ou-coroa) |
| HEIMDALL | **+0,44%** | **268** (84 / 110 / 74) |

SAGA "lucrou" porque **um** trade deu certo. VÖLVA·Kimi mostra lucro com **zero
ganhos** — uma expirada fechou no positivo e carregou a média de duas
observações.

E a tela pinta os cinco com o mesmo peso visual. Um acaso de 2 trades tem a
mesma aparência de um resultado de 268. **É a regra da casa sendo violada dentro
de casa: inconclusivo renderizando como resultado.**

### 1.2 O painel STATS mede os mortos

Os filtros do BACKTEST são `A·ZION†`, `B·FERRARI`, `RADAR`, `MISTRAL`,
`DEEPSEEK`, `KIMI`, `GROK` — **todos aposentados em 28/07**. Nenhuma das mesas
vivas (VÖLUNDR, SKAÐI, MÍMIR, FREYJA, ULLR) aparece como filtro.

O `-1,75% em 19 trades` que aparece no topo é das mesas NOVAS. Ou seja: cabeçalho
com número novo, filtros com nome velho. Confusão garantida.

### 1.3 A tese do dono não está sendo testada por ninguém

Esta é a mais grave.

A tese é: *"não é IA adivinhar direção, é IA analisar o mercado e seguir a
estratégia que melhor se adequa àquele momento"*.

Quem deveria testar isso é o MÍMIR. E o próprio painel avisa em vermelho:

> EXPERIMENTO CONTAMINADO — a IA não decidiu em NENHUM tick nas últimas 24h.

MÍMIR tem 4 trades, **0 ganhos, 4 perdas**, e nenhum deles foi decidido por IA.
São 4 trades do VÖLUNDR com outro nome. **A tese está com zero observações.**

### 1.4 Três painéis para as mesmas cinco mesas

TOURNAMENT mostra `MÍMIR −1,70%` (líquido por trade). RAGNARÖK mostra
`MÍMIR $999 (−0,1%)` (patrimônio). PAPER mostra `MÍMIR $999 (−0,1%)` (idem).

Os três estão certos e medem coisas diferentes, e ninguém consegue saber isso
olhando. Culpa minha: empilhei painel novo sem aposentar o velho.

### 1.5 A biblioteca de estratégias é pobre — e a crítica é justa

Existem **três** playbooks ativos:

- `range_reversion` — compra o suporte
- `trend_pullback` — compra o recuo
- `capitulation_reversal` — compra a exaustão

O dono citou *"stop range, pull back, suporte resistência e etc"* como
**exemplos**, e eu implementei a lista literal e parei no "etc". Um trader
experiente não opera com três respostas.

---

## 2. O que "treinar os agentes" significa aqui

Não dá para treinar um modelo próprio — não temos dado rotulado, nem orçamento,
nem necessidade. O que dá para fazer, e é o que um trader experiente de fato
tem, são quatro coisas:

1. **Vocabulário.** Uma biblioteca de estratégias com regra explícita de entrada,
   stop, alvo, horizonte e — o mais importante — **em que regime cada uma paga**.
2. **Repertório medido.** Cada estratégia backtestada ISOLADA no histórico, para
   saber qual paga em quê. Hoje medimos a MESA; o que decide é a ESTRATÉGIA.
3. **Escolha informada.** A mesa de IA escolhendo dentro de uma biblioteca rica,
   com o histórico de cada playbook na mão — em vez de escolher entre 3 opções
   às cegas.
4. **Disciplina de não operar.** `stand_aside` tem que ser resposta legítima e
   frequente. Trader experiente passa a maior parte do tempo fora.

Isso é o que separa "bot com 3 regras" de "trader que conhece a estrutura".

---

## 3. A biblioteca proposta

Organizada por regime, porque é assim que se escolhe na mesa de verdade.

### Em faixa (RANGING)
| Playbook | Entra quando | Stop | Alvo |
|---|---|---|---|
| `range_reversion` ✅ | preço no suporte testado ≥2× | 1 ATR abaixo do suporte | resistência |
| `range_breakout` | rompe a máxima da faixa com volume > 1,5× média | volta pra dentro da faixa | altura da faixa projetada |
| `failed_breakout` | rompe, não sustenta, volta pra dentro | além da falsa máxima | lado oposto da faixa |
| `squeeze` | ATR/Bollinger comprimidos no menor valor em N períodos | contra a direção da expansão | 2× a compressão |

### Em tendência (TRENDING_UP)
| Playbook | Entra quando | Stop | Alvo |
|---|---|---|---|
| `trend_pullback` ✅ | recuo até EMA/fibo em tendência viva | abaixo do recuo | topo anterior + extensão |
| `trend_continuation` | consolidação (bandeira) no meio da perna | abaixo da bandeira | medida da perna anterior |
| `breakout_retest` | rompe nível, volta testar por cima, segura | abaixo do nível rompido | próxima estrutura |
| `vwap_reversion` | desvio ≥2σ da VWAP contra a tendência | além do desvio | VWAP |

### Reversão (TRENDING_DOWN)
| Playbook | Entra quando | Stop | Alvo |
|---|---|---|---|
| `capitulation_reversal` ✅ | exaustão + divergência perto do fundo | abaixo do fundo | primeira resistência |
| `divergence_reversal` | divergência RSI/MACD sem capitulação | abaixo do fundo local | média móvel |
| `absorption` | volume alto sem o preço andar (alguém absorve) | abaixo da zona de absorção | topo da zona |

### Estrutura e fluxo
| Playbook | Entra quando | Stop | Alvo |
|---|---|---|---|
| `support_accumulation` | suporte + fluxo comprador líquido crescente | abaixo do suporte | topo da faixa |
| `opening_range` | rompe a faixa das primeiras horas (day) | lado oposto da faixa | 1× a faixa |

### Sempre disponível
| `stand_aside` ✅ | nenhuma condição clara | — | — |

**Total: 14 playbooks + o não-operar.** Hoje são 3.

---

## 4. Reorganização por setor

O laboratório vira quatro setores com pergunta própria e régua própria. Nada de
misturar quem faz coisa diferente na mesma tabela.

### Setor A — Direcional spot (a tese do dono)
**Pergunta:** *IA escolhendo a estratégia do momento bate regra fixa?*

| Mesa | Papel |
|---|---|
| VÖLUNDR | swing 48h, mecânico — **grupo de controle** |
| SKAÐI | day 8h, mecânico — controle com outro relógio |
| MÍMIR | mesma praça, **IA escolhe o playbook** — a variável testada |
| FREYJA | mesmo seletor, praça DEX — controle de terreno |

**Régua:** USDT acumulado. Win-rate é secundário.

### Setor B — Neutro / arbitragem (o que já paga)
**Pergunta:** *quanto isso rende de forma estável?*

| Mesa | Papel |
|---|---|
| RATATOSKR | spread spot cross-CEX, zero IA |
| JÖRMUNGANDR | spot+perp hedgeado (funding), zero IA |

**Não mexer.** O dono já disse: está dando lucro e não usa IA. Só medir.

### Setor C — Lançamento on-chain
**Pergunta:** *dá para ganhar em pool recém-nascida sem se queimar?*

| Mesa | Papel |
|---|---|
| ULLR | idade, liquidez e fluxo — sem LLM, munição contada |

### Setor D — Valhalla (arquivo)
Histórico dos direcionais aposentados. **Não compete, não entra em ranking, e
toda linha passa a mostrar o TAMANHO DA AMOSTRA ao lado do número.** Abaixo de
30 decididos, o número aparece cinza com a etiqueta "ruído".

---

## 5. Ordem de execução

Uma mesa por vez, do começo ao fim, antes de tocar na próxima. Foi a falta disso
que produziu o caos atual.

Para cada mesa, o mesmo ritual:

1. **Ficha de construção** — o que ela vê, o que ela decide, com que regra, em
   que horizonte, contra quem compete. Visível no painel, não só no código.
2. **Playbooks habilitados** — quais da biblioteca ela pode usar, e por quê.
3. **Backtest por playbook** — no histórico, cada estratégia isolada.
4. **Régua e critério de aposentadoria** — quando desligar.
5. **Painel próprio** — nada de aparecer em três lugares com três números.

### Fila proposta

| # | Mesa | Por quê nesta ordem |
|---|---|---|
| 1 | **MÍMIR** | é a tese. Hoje tem 0 observações e está contaminado — sem ela, todo o resto é acessório |
| 2 | **VÖLUNDR** | o controle. Sem controle honesto a comparação não vale |
| 3 | **SKAÐI** | mesmo motor, relógio de day trade |
| 4 | **FREYJA** | mesma estratégia, praça DEX |
| 5 | **ULLR** | terreno próprio, risco próprio |
| — | RATATOSKR / JÖRMUNGANDR | não mexer, só limpar a apresentação |

---

## 6. Limpeza da tela (junto, não depois)

- **BACKTEST/STATS**: filtros passam a listar as mesas VIVAS. Os aposentados vão
  para uma aba "arquivo".
- **TOURNAMENT vs RAGNARÖK vs PAPER**: uma mesa aparece em UM lugar. O torneio
  compara dentro do setor; o Ragnarök vira a ficha do Setor A; o Paper mostra só
  a carteira, sem ranking.
- **Toda métrica com amostra < 30 sai cinza, com o `n` ao lado.** É a regra
  `inconclusivo ≠ aprovado` aplicada ao laboratório.
- **Ficha de cada mesa** clicável no painel: como foi montada, o que decide.

---

## 7. O que este plano NÃO promete

Não promete que a IA vá ganhar do mecânico. A tese pode estar errada, e o
experimento existe para descobrir isso — não para confirmar.

O que ele promete é que, quando o número aparecer, dê para acreditar nele: com
amostra à vista, controle honesto e cada mesa medida na régua que faz sentido
para ela.
