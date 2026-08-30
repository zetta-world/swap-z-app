# PLANO — o Alavancado de Tendência

**Status: 🟡 dimensionado para sobreviver ao próprio experimento; a borda segue
não demonstrada** · 30/08.

> **Em uma frase:** ele não foi ajustado para lucrar — foi ajustado para que a
> pergunta "ele lucra?" chegue a ter resposta, porque no tamanho antigo ele
> morria no dia 11 de uma pergunta que só é respondida no dia 26.

---

## 1. O que os dados dizem, e o que eles não dizem

−263,24 USDT em 6,8 dias, **92% do buraco do Celeiro inteiro**. Decomposto:

```
preço       −208,54   (79%)
taxa         −52,77   (20%)
derrapagem    −1,92    (1%)
```

⚠️ **Não é pedágio.** A taxa por operação foi 0,093% de ida-e-volta contra alvos
de 1,0–2,0% — 5 a 9% do alvo. O agente está perdendo por **direção**, e é isso
que o extrato por causa existe para saber dizer.

### O que tem evidência

| lado | n | alvo | stop | tempo | mercado andou | resultado |
|---|---|---|---|---|---|---|
| comprado | 21 | 8 | 9 | 4 | −0,27% | −89,75 |
| **vendido** | **15** | **1** | **9** | **5** | **+0,72%** | **−118,79** |

Somando com o Caçador (mesmo sinal, sem alavanca): **2 alvos em 15 decididas
vendendo**, contra ~7,8 que a geometria daria numa moeda — p = 0,23%.

### ⚠️ O que NÃO tem, e quase me pegou

Separando por força do sinal, uma faixa parecia salvar tudo:

| faixa do sinal | n | alvo | stop | USD |
|---|---|---|---|---|
| 2,5–3% | 26 | 6 | 16 | −145,39 |
| 3–4% | 15 | 2 | 11 | −63,47 |
| 4–6% | 7 | 2 | 3 | −51,09 |
| **>6%** | **8** | **6** | **1** | **+21,92** |

Monótona, e a última linha com 86% de acerto. Bate com a varredura de 166 dias
que já está escrita em `regime.ts` (limiar 1,5% → 2,5% → 4,0%, expectativa
+0,011% → +0,164% → +0,353%). Parecia a resposta.

⚠️⚠️ **São oito posições do MESMO DIA, no MESMO ativo, do MESMO sinal** — uma
alta do SOL em 27/08 (sinal 10,00% em todas as oito) observada oito vezes. Não é
amostra de oito, é **um evento**. Subir o limiar por causa dela seria ajustar o
sistema a uma tarde.

**Por isso o limiar de tendência NÃO foi mexido.** A nota do próprio
`regime.ts` já diz por que parou em 2,5%: a 4,0% o n efetivo independente cai
para ~14, e o valor foi escolhido varrendo os mesmos dados — não é validação
fora da amostra. Repetir isso com 36 posições vivas seria pior, não melhor.

---

## 2. ⚠️⚠️ A conta dimensionava contra o evento errado

`alavancagemCoerente` calcula a distância até a **liquidação**, com folga 2×.
Nas 36 posições, o pior movimento contra medido ficou entre **1,11% e 4,95%** —
o que devolve de 10× a 45×. **O teto de 10 era a única coisa que mandava**, e a
conta que o comentário descrevia nunca chegou a morder.

E há um problema maior que o teto:

```
a 10×, a liquidação fica a ....... 10,0% de distância
o stop ficava a .................. 1,4% a 2,0%
```

⚠️ **O stop dispara sempre primeiro, em toda posição.** A liquidação nunca foi o
risco — e era contra ela que o tamanho era calculado. O evento que determina a
perda típica não aparecia em conta nenhuma.

### O risco que ninguém somava

```
fração 0,20  ×  alavanca 10  ×  stop 1,6%  =  3,2% da banca por stop
```

⚠️ É fácil ler `fracaoPorPosicao: 0,2` como "arrisco 20%" e `alavancagemMaxima:
10` como um limite distante. Os dois **se multiplicam**: 0,2 × 10 = **duas vezes
a banca inteira** em nocional por posição. E o teto de exposição conta MARGEM
(0,6), então três posições abertas somavam **6× a banca** em nocional.

Agora existe `riscoPorStopPct` e o número está em teste.

---

## 3. A aritmética que decidiu o tamanho — e ela não é sobre lucro

⚠️⚠️ **A PRIMEIRA VERSÃO DESTA SEÇÃO ESTAVA EM DIAS, E ISSO ERA ERRADO.** Ela
dizia *"queima 38,70/dia → 11 dias até a ruína; decide 3,86/dia → 100 decididas
em 26 dias"*. O dono contestou — o Celeiro **inteiro** tem 9,65 dias de vida — e
tinha razão sobre o fundo: eu vesti de calendário uma taxa que não é calendário.

O extrato diário mostra o tamanho do erro:

```
22/08   −0,68        27/08   +56,43
23/08  −14,03        28/08  −111,21
24/08   +0,54        29/08   −60,84
25/08  −85,12        30/08        —   ← nada
26/08  −48,34
```

Desvio diário maior que a própria média, dois dias positivos, e **o agente
parado desde 29/08 19:30** — não por ruína, mas porque o portão de regime
recusa: *"mercado andou 0,76% na janela — de lado, sem lado para tomar"*. Ele
opera em RAJADAS, quando aparece tendência. Hoje queima zero.

### A conta na unidade que não depende do calendário

```
263,24 de prejuízo  ÷  27 decididas  =  −9,75 USDT por operação decidida
436,76 até a ruína  ÷  9,75          =  ~45 operações de vida
o veredito exige                     =  100 decididas (MIN_SAMPLE)
```

⚠️⚠️ **45 < 100 — ele acaba antes de ser julgável.** Nenhum ajuste de sinal
conserta isso: a queima escala com o nocional, o número de decisões **não**. O
único parâmetro que muda a razão entre os dois é o tamanho.

Com `alavancagemMaxima: 3`:

```
risco por stop ......... 0,96% da banca      (era 3,2%)
perda por operação ..... ~2,93 USDT          (era 9,75)
vida ................... ~149 operações      (era ~45)
```

**149 > 100.** Agora o experimento termina.

⚠️ **Por que a unidade importa, e não é preciosismo:** em dias, a conta só vale se
o mercado oferecer tendência no ritmo da semana passada — e ele já parou de
oferecer. Por operação, a mesma frase continua verdadeira se as 100 decididas
levarem três semanas ou três meses. Queima e amostra dependem **da mesma coisa**
(tendência disponível), então a razão entre elas é estável mesmo quando as duas
taxas mudam juntas.

> ⚠️ **Isto não afirma que ele vai lucrar.** Afirma que agora dá para descobrir.
> Se a borda for negativa, ele perde mais devagar e a resposta chega — o que é
> estritamente melhor que perder rápido e nunca saber.

### Por que dimensionar e não pausar

Pausar (item ④ da auditoria) para a queima **e** para a amostra. O agente ficaria
vivo, quieto e permanentemente sem veredito — que é a morte silenciosa que este
repositório se recusa a causar em outros lugares. Dimensionar mantém as duas
coisas andando, com a queima abaixo da linha de sobrevivência.

---

## 4. I3 — o alvo acompanha o stop efetivo

A I2 é um **piso**: alarga o stop pelo ruído medido do ativo. Ninguém alargava o
alvo junto.

| genoma v3 pediu | SOL executou |
|---|---|
| alvo 1,00% · stop 0,80% (razão 1,25) | alvo 1,00% · **stop 2,00%** (razão **0,50**) |

⚠️ A mutação da v3 tinha como hipótese escrita *"reduzir o stop para abaixo do
alvo inverte a assimetria de payoff"*. No SOL — **58% das posições** — o piso
entregou stop 2,5× o pedido e o **dobro do alvo**. O experimento não testou o que
disse testar, e o veredito saiu mesmo assim.

⚠️ **Não é "perdia por construção".** Num passeio sem tendência, alvo 1 com stop
2 tem valor esperado zero como qualquer outro par. O defeito é de **honestidade**:
o genoma declarava uma razão e a operação rodava outra.

⚠️ **O alvo sobe; o stop não desce.** Apertar o stop desfaria a I2, que nasceu de
três posições mortas no ruído do SOL. E alvo maior melhora a razão do pedágio —
anda junto com a I1, não contra.

⚠️ **O que isto custa, dito antes de rodar:** alvo maior é alvo menos tocado.
Parte do que hoje morre em `stop` deve passar a morrer em `tempo`, e tempo rendeu
−0,248% em média. **Se a fatia de `tempo` subir sem o resultado melhorar, a I3 é
a primeira suspeita.**

---

## 5. O furo que este trabalho encontrou em si mesmo

Quebrei os dois consertos em três direções antes de entrar. Duas foram pegas. A
terceira — **o cron deixar de aplicar a I3** — passou verde: a invariante estava
testada isolada, e nada provava que a produção a chamava.

⚠️ É a mesma família do defeito do A/B: uma peça correta, escrita, testada, e
**desligada do caminho que decide**. Um teste de unidade sobre função pura não
distingue "aplicada" de "existe". A trava textual do cron nasceu daí.

---

## 6. O critério, escrito ANTES dos dados

> Com **≥100 decididas abertas depois do deploy de 30/08**, o Alavancado
> demonstra borda se tiver expectância líquida positiva **E** ficar acima do
> `comprador_cego` na mesma janela. As duas coisas.
>
> Se ficar abaixo do `cacador_de_tendencia` (mesmo sinal, sem alavanca) por
> USDT-por-nocional, **a alavanca só comprou risco** e o próprio mandato manda
> aposentá-lo. Hoje os dois estão empatados por essa régua (−0,50% contra
> −0,58% por dólar exposto): a alavanca não está comprando nada, só ampliando.

---

## 7. Aberto

- **A mutação em curso (29/08 15:30, `stopPct 1,6`) acumulou fluxos da era do
  A/B quebrado.** Os braços dela não significam nada, e o primeiro veredito
  depois do deploy os incluiria. O certo é fechá-la como `inconclusiva` no
  deploy, para a próxima começar limpa. **É escrita em produção — decisão do
  dono.**
- Os dois `pagou` de 24/08 e 27/08 seguem gravados e creditados ao modelo no
  `placarDosModelos`.
- Item ⑥ da auditoria (o teste do Maker, pendente desde 23/08) segue aberto.
