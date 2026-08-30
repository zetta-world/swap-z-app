# AUDITORIA — o Celeiro perde dinheiro. Onde, por quê, e o que fazer

**Status: 🔴 três defeitos, um deles invalida o aprendizado inteiro** · 29/08 ·
janela 20–29/08 (9 dias).

> **Em uma frase:** o A/B do Celeiro tem **um braço só** — controle e mutação
> abrem com a MESMA geometria — então as duas mutações já declaradas "pagou"
> foram julgadas por ruído, e o agente que consumiu 92% do prejuízo teve os
> parâmetros mexidos três vezes com base nesse ruído.

---

## 1. O caixa, por agente e por causa

Todo número desta seção vem de `celeiro_fluxos`, somado por causa.

| agente | preço | taxa | derrapagem | aluguel | **total** |
|---|---|---|---|---|---|
| `alavancado_de_tendencia` | −208,54 | −52,77 | −1,92 | — | **−263,24** |
| `cacador_de_tendencia` | −18,66 | −5,51 | −0,12 | — | **−24,29** |
| `maker_de_faixa` | +2,88 | −3,49 | −0,01 | — | **−0,62** |
| `comprador_cego` | +7,79 | −5,19 | −0,08 | — | **+2,52** |
| `aluguel_ocioso` | — | — | — | +0,65 | **+0,65** |
| | | | | | **−284,98** |

⚠️ **Um agente é 92% do buraco.** E dentro dele, **preço é 79%** do vazamento —
não taxa. O Celeiro nasceu para separar essas duas coisas, e a separação está
dizendo com clareza que o problema deste agente não é pedágio: é direção.

⚠️ **Três agentes nunca produziram um único lançamento** em 9 dias:
`convergencia_base`, `pool_novo` e `colheita_funding`. Os três **rodam a cada
tick** — têm bloco próprio no cron e genoma ativo — e o portão de nenhum deles
abriu uma única vez. Não é código morto: é código vivo que nunca disse "sim", e
ninguém está medindo se o portão é rigoroso ou se está quebrado.

---

## 2. ⚠️⚠️ O DEFEITO QUE INVALIDA O APRENDIZADO: o A/B tem um braço só

O esquema declara a intenção em texto (`0027_o_celeiro.sql`):

> `controle` = metade do capital **sem** a mutação; `mutacao` = metade **com**.

O cron não faz isso. Em `src/app/api/celeiro/cron/route.ts`:

```
421  const alvoPct = Number(gen?.params.alvoPct ?? 1.0);     ← genoma ATIVO
442  stopPorVolatilidade(..., Number(gen?.params.stopPct))   ← genoma ATIVO
444  alvo = ... ; stop = ...
489  horasLimite: Number(gen?.params.horasLimite ?? 48)      ← genoma ATIVO
483  const braco = bracoDaPosicao(...)   ← calculado DEPOIS de tudo
498  ..., braco)                          ← só GRAVADO
```

`braco` nasce **depois** de toda a geometria já ter sido decidida, e nunca é
lido por nada. Os dois braços são a mesma estratégia com rótulos alternados
(par/ímpar).

**A prova está no banco.** Se os braços diferissem, o controle da v3 usaria o
stop de 1,2% anterior e a mutação 0,8%:

| genoma | símbolo | braço | alvo | stop |
|---|---|---|---|---|
| v3 | SOL | controle | 1,000% | **2,022%** |
| v3 | SOL | mutação | 1,000% | **1,991%** |
| v3 | BTC | controle | 1,000% | 0,930% |
| v3 | BTC | mutação | 1,000% | 0,836% |

Idênticos dentro do ruído do piso de volatilidade. **Nenhum braço usa o
parâmetro antigo.**

### O que isso produziu

| mutação | controle | mutação | veredito |
|---|---|---|---|
| 24/08 · `horasLimite 48→12` | −34,76 | −14,10 | **pagou** |
| 27/08 · `stopPct 1,2→0,8` | −68,19 | −40,43 | **pagou** |

Duas mutações "pagaram" comparando duas metades da mesma coisa. A diferença que
foi lida como aprendizado é a variância de dividir 12 posições em dois montes.

⚠️ **E o efeito é cumulativo, não isolado.** Cada "pagou" fixa o parâmetro e a
mutação seguinte parte dali. O `stopPct` do Alavancado andou **1,2 → 0,8 →
1,6** em cinco dias, com o passo 2 justificado por *"stop maior que alvo cria
assimetria negativa"* e o passo 3 por *"o stop de 0,8 é apertado demais"* — dois
diagnósticos opostos, do mesmo modelo, com o do meio carimbado como sucesso.

---

## 3. ⚠️ O segundo defeito: "pagou" quando os DOIS braços perdem

`src/lib/celeiro/fluxo.ts`:

```ts
if (diferenca > 0) return { veredito: "pagou", ... };
```

Dois estados. −40,43 contra −68,19 vira **"pagou"** porque sangra menos.

⚠️ **Esta casa já pagou por esse erro exato**, em 12/08, no painel do
laboratório — é a cicatriz que criou `cor-resultado.ts` e o **terceiro estado**
(âmbar: rendeu, mas perdeu do competidor). O Celeiro reimplementou a versão de
dois estados no juiz do aprendizado.

E o próprio arquivo escreve a régua certa trinta linhas abaixo, sobre agentes:

> *"Um agente que rende menos que o Aluguel de Ocioso está DESTRUINDO valor."*

O princípio está no arquivo. Só não foi aplicado à mutação.

### O terceiro, no mesmo juiz: o piso de amostra conta a coisa errada

`MINIMO_POR_BRACO = 20` conta **lançamentos do extrato**, e uma posição gera
3–4 (taxa de entrada, taxa de saída, derrapagem, preço). O que os vereditos
realmente tiveram:

| mutação | braço | lançamentos | **operações distintas** |
|---|---|---|---|
| 24/08 | controle | 23 | **13** |
| 24/08 | mutação | 20 | **11** |
| 27/08 | controle | 20 | **12** |
| 27/08 | mutação | 21 | **12** |

O piso promete 20 observações e entrega 11. O comentário logo acima dele avisa
contra exatamente isso — *"a arena antiga premiou +7,04% com 1 decidido"* — e a
armadilha voltou a um nível de indireção de distância.

---

## 4. Por que ele perde de verdade: o lado VENDIDO

Separando as posições fechadas dos dois agentes de tendência por lado:

| lado | n | alvo | stop | tempo | mercado andou | resultado |
|---|---|---|---|---|---|---|
| comprado | 33 | 14 | 15 | 4 | −0,24% | −94,95 |
| **vendido** | **20** | **2** | **13** | **5** | **+0,81%** | **−132,25** |

⚠️ **Duas vitórias em quinze decididas no lado vendido.** Com a geometria real
de cada posição, um passeio aleatório entregaria ~7,8. A probabilidade de sair 2
ou menos por acaso é **0,23%**.

No lado comprado: 14 de 29, contra 15,1 esperadas. **p = 0,41** — indistinguível
de uma moeda.

> **A leitura honesta:** o lado comprado é uma moeda pagando pedágio; o lado
> vendido é onde o dinheiro morreu, e não foi azar de uma ou duas posições.

⚠️ **O QUE EU NÃO AFIRMO, e o contra-argumento é forte.** O mercado SUBIU nesta
janela — a medição de 29/08 (`MEDICAO-TEM-BORDA`) mediu segurar em +19% a +22%.
Num mercado que sobe, vender perde para uma moeda **sem que o sinal precise
estar errado**. O que está provado é que **o detector de regime mandou vender 20
vezes numa alta**; se ele está quebrado ou apenas foi apanhado num regime só,
uma janela de queda decidiria — e ela ainda não existe nos dados.

E o `comprador_cego`, que **nunca vende**, é o único agente com preço positivo
(+7,79). Na janela comum aos dois (25–28/08), o mercado andou +0,17% nas compras
do Cego e −0,08% nas do Alavancado — a favor do Cego, mas com n=19 contra n=10
isso é sugestão, não resultado.

---

## 5. A geometria do SOL: o piso alarga o stop e ninguém alarga o alvo

`stopPorVolatilidade` (I2, nascida em 23/08) é um **piso** — só alarga o stop,
nunca aperta. Está funcionando. O efeito colateral não foi previsto:

| genoma | declarado | SOL na prática | razão alvo/stop |
|---|---|---|---|
| v2 | alvo 1,33 · stop 1,2 | alvo 1,333 · **stop 1,933** | 0,69 |
| v3 | alvo 1,00 · stop **0,8** | alvo 1,000 · **stop 2,004** | **0,50** |

⚠️ **A mutação da v3 foi anulada no ativo que é 58% das posições.** Ela pediu
"stop menor que o alvo para inverter a assimetria"; no SOL o piso entregou um
stop **2,5× o que ela pediu** e **2× o alvo**. O experimento não testou o que
disse testar — mais uma razão pela qual o "pagou" da v3 não significa nada.

Isto **não** é "perde por construção": alvo 1,0 / stop 2,0 tem valor esperado
zero num passeio, como o próprio `regime.ts` explica. Mas exige **67% de acerto**
para empatar, e a razão declarada no genoma deixou de descrever a operação.

---

## 6. Por que ele ganha, quando ganha

**① O `comprador_cego` (+2,52).** Compra às cegas, nunca vende, e é o único com
preço positivo. Ele existe como controle de direção — e no momento **está
ganhando dos dois agentes que leem sinal**. O mandato do Alavancado prevê este
caso por escrito: *"render menos que o Comprador Cego — aí nem o sinal nem a
alavanca estão comprando alguma coisa"*. Amostra ainda curta (19 fechadas), mas
o gatilho de aposentadoria já está escrito e apontando para ele.

**② O `maker_de_faixa` (+2,88 de preço, −3,49 de taxa).** 19 alvos contra 8
stops — **70% de acerto** num bracket simétrico de ±0,6%, p≈0,026. Ele acertava
e entregava tudo no pedágio: a taxa foi **121% do ganho de preço**. É a hipótese
pré-registrada em `OBSERVACAO-CELEIRO-23AGO.md`, e o teste que a decidiria
(mesmo sinal, bracket largo, 30 decisões) **nunca rodou** — o agente está fora
da lista de quem opera desde 23/08.

**③ O `aluguel_ocioso` (+0,65).** 0,074 USDT/dia sobre $1.000 = **~2,7% ao
ano**. É o piso, e é o número contra o qual tudo o mais deveria ser medido.

> Em 9 dias o piso rendeu +0,65 e os agentes com opinião sobre preço renderam
> **−285,63**. A diferença é 440× o que o piso produziu.

---

## 7. O que fazer, em ordem

**① Consertar o A/B antes de qualquer ajuste de parâmetro.** Enquanto os braços
forem iguais, toda otimização é ruído com carimbo. `braco` precisa ser decidido
ANTES da geometria, e o braço `controle` precisa ler o genoma **anterior**.
Trava: um teste que abre duas posições no mesmo tick e exige geometrias
diferentes — hoje ele falharia.

**② Três estados no veredito.** `pagou` só quando a mutação for positiva **E**
melhor que o controle. Mutação negativa que sangra menos é `inconclusiva` no
melhor caso — nunca `pagou`. Reusar `classificarResultado` de
`cor-resultado.ts`, que já existe e já é a régua da casa.

**③ Piso de amostra em OPERAÇÕES, não em lançamentos.** `count(distinct ref)`
por braço. Os dois vereditos existentes viram `inconclusiva` retroativamente —
e o genoma do Alavancado deveria voltar para a v1.

**④ Pausar o Alavancado.** Ele perdeu 26% da banca em 6,8 dias (−38,7/dia);
no ritmo atual encosta no mínimo de $300 — onde a regra de ruína o para — em
**~11 dias**. Não é ordem de matar: é que
ele é o único agente cujo prejuízo importa, e mexer nele com o juiz quebrado
gasta banca comprando ruído. Volta quando ① a ③ estiverem de pé.

**⑤ Alinhar o alvo ao stop efetivo.** Se o piso de volatilidade alarga o stop,
o alvo tem de acompanhar — senão a razão declarada no genoma é ficção. A regra
mínima: `alvo ≥ stop efetivo`, aplicada depois do piso.

**⑥ Rodar o teste do Maker que ficou pendente desde 23/08.** É a única hipótese
do Celeiro com evidência pré-registrada a favor (p≈0,026) e a única barata de
testar: mesmo sinal, bracket largo o bastante para o pedágio virar ruído.

⚠️ **O que NÃO fazer:** mais mutações de `stopPct`. Foram três em cinco dias, em
direções opostas, todas julgadas por um A/B de um braço só.

---

## 8. O critério, escrito antes dos dados

> Depois de ① a ③, uma mutação só é `pagou` com **≥20 operações distintas por
> braço**, resultado da mutação **positivo em USDT**, e acima do controle. E um
> agente com opinião sobre preço só se justifica se render **mais que o
> `aluguel_ocioso`** na mesma janela — 2,7% ao ano é a barra que qualquer um
> pula sem pensar, e hoje nenhum deles pula.
