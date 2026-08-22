# O CELEIRO AMBICIOSO — a correção de rumo de 22/08

> **O mandato, nas palavras do dono:** *"o Celeiro é um curral onde deve nascer
> os agentes mais ambiciosos e lucrativos, sem medo de perder capital mas também
> sem suicídio. Comprar a baixo e vender alto acumulando sempre USDT. Sempre
> acompanhando mercado, operando só em moeda em momento de alta; mercado
> sangrando não opera. Em futuros: se a tendência é de baixa entra vendendo, se
> é de alta entra comprando, sempre buscando alavancar o máximo possível o
> capital, com alavancagem coerente. O foco é criar o melhor trader do mercado."*
>
> **E a crítica:** *"você está pecando muito nesta construção."* Ele está certo.
> Este documento é onde eu escrevo o que errei, com o número que prova.

---

## 1. O erro que a medição expõe

O **Maker de Faixa** rodou 29 posições fechadas em ~24h. O extrato:

| causa | total | por lançamento |
|---|---|---|
| preço | **+3,1557** | +0,1088 |
| taxa | **−3,3750** | −0,0563 × 2 pernas |
| derrapagem | −0,0146 | |
| **líquido** | **−0,2339** | |

**O trade médio ganha $0,1088 de preço e paga $0,1125 de corretagem.**

⚠️⚠️ **ELE PERDE POR CONSTRUÇÃO.** Não por azar, não por mercado ruim — ele
acertou **19 de 29** (65,5%). O genoma tinha alvo de **0,6%** contra uma taxa de
ida-e-volta de **0,225%**: **37% do alvo ia embora em pedágio antes de o preço
se mexer.**

### E aumentar o tamanho NÃO conserta

A taxa é proporcional ao nocional. Dobrar a posição dobra o ganho e dobra o
pedágio — a razão não muda. **O que muda a razão é o TAMANHO DO MOVIMENTO por
operação.**

É por isso que o mandato do dono está certo e o meu desenho estava errado:
"comprar a baixo e vender alto" é **swing**, movimento grande, poucas operações.
Eu construí um **escalpe de 2,3 horas** com alvo menor que três vezes o pedágio.

---

## 2. As três invariantes que faltavam

### I1 — O alvo TEM de limpar o pedágio por um múltiplo declarado

```
alvoPct  ≥  MULTIPLO_DO_PEDAGIO × custoDeIdaEVolta
```

Com o custo em 0,225% e múltiplo 6, o alvo mínimo é **1,35%**. Abaixo disso o
agente não abre — e o motivo vai para o extrato como recusa, não como prejuízo.

⚠️ **Esta é a invariante que teria impedido o erro inteiro.** Ela não é uma
opinião sobre estratégia: é aritmética. Um alvo que não cobre o pedágio com
folga é uma aposta em que a casa leva antes de a moeda cair.

### I2 — O REGIME decide SE opera e DE QUE LADO

Não é previsão, é leitura de estado — e a diferença é tudo:

| estado medido | spot | futuros |
|---|---|---|
| **alta** | compra | compra alavancado |
| **baixa** | **não opera** | **vende** alavancado |
| **sangrando / sem sinal** | **não opera** | **não opera** |

⚠️ **SPOT NÃO VENDE.** Sem futuros não há como lucrar na queda com USDT — em
spot, "vender na baixa" é só sair. Escrever a regra sem essa distinção deixaria
uma armadilha pronta.

⚠️ **E "sangrando" é diferente de "baixa".** Baixa é tendência: dá para operar
vendido. Sangrando é queda desordenada com volatilidade explodindo — nela o
stop não segura e a liquidação chega antes do alvo. **Nenhum agente opera aí.**

### I3 — Alavancagem tem de sobreviver ao PIOR CASO MEDIDO, não ao esperado

```
distânciaDaLiquidação  ≥  FOLGA × piorMovimentoContraMedido
```

⚠️ **"Sem suicídio" precisa de número, senão é só uma palavra.** Alavancagem
coerente não é um teto fixo (5×, 10×) — é a alavancagem cuja liquidação fica
mais longe que o pior movimento contrário já observado naquele símbolo, com
folga.

Se o pior repique contra em 24h foi 8%, alavancagem que liquida em 10% é
suicídio com outro nome. A conta manda, não o apetite.

---

## 3. O que muda em cada agente

| agente | antes | agora |
|---|---|---|
| **Maker de Faixa** | escalpe 0,6% em faixa | **aposentado** — ver §4 |
| **Caçador de Tendência** (novo) | — | spot · swing · compra só em alta confirmada |
| **Alavancado de Tendência** (novo) | — | futuros · compra na alta, **vende na baixa**, alavancagem pela liquidação |
| **Colheita de Funding** | igual | igual — é renda, não direção |
| **Aluguel de Ocioso** | igual | igual — é o piso |
| **Convergência de Base** | igual | igual — é estrutura |
| **Pool Novo** | igual | igual — é evento |

---

## 4. Por que o Maker de Faixa é APOSENTADO e não ajustado

Subir o alvo dele para 1,35% resolveria a aritmética — e destruiria a tese. Uma
faixa lateral em que o preço percorre 1,35% para cada lado **não é uma faixa
estreita**; é volatilidade, e aí o teste de lateralidade que aprova o par passa
a aprovar outra coisa.

⚠️ **Consertar o número e manter o nome seria carimbar uma medição com o nome de
outra** — o erro que a auditoria de 19/08 chamou de "o custo do HEIMDALL com o
nome da GERI". O mecanismo morreu; o agente vai para o arquivo com o extrato
que o matou, e o novo nasce com a régua certa.

O que ele deixa: **a prova em produção de que a taxa é o adversário principal
neste tamanho de operação.** Nenhum backtest tinha dito isso.

---

## 5. Banca declarada — o outro buraco

Hoje existem DUAS noções de capital que não conversam:

- `CELEIRO_CAPITAL_PAPEL_USD = 1000` — a banca do Aluguel e da Colheita
- `Math.max(capitalMinimoUsd, 50)` — o tamanho da posição dos outros, com o
  **50 escrito na mão dentro do cron**

Isso produz três incoerências:

1. **`capitalMinimoUsd` virou tamanho de aposta.** "Preciso de $150 para o livro
   aguentar" não é "aposto $150 por vez".
2. **Não há teto de exposição.** Nada impede o agente de acumular posições.
3. **O `vs. piso` compara USDT produzido**, não retorno sobre capital — e o piso
   rende sobre $1.000 enquanto o Maker arrisca $50. A comparação favorece quem
   arrisca mais.

**Correção:** banca declarada no registro, tamanho da posição como fração dela,
teto de exposição por agente, e o `vs. piso` passando a comparar **retorno sobre
capital**.

---

## 6. O que este plano NÃO promete

- **Não promete lucro.** Promete que nenhum agente perca por aritmética antes de
  o mercado opinar — que foi exatamente o que aconteceu.
- **Não promete que tendência funcione.** Promete que ela seja MEDIDA e que a
  entrada reaja ao estado, em vez de um modelo adivinhar.
- **A alavancagem pode reprovar sempre.** Se o pior movimento medido nunca deixa
  folga, o agente não opera alavancado — e isso é resultado, não falha.
