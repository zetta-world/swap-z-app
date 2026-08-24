# PLANO — a derrapagem, o último buraco do modelo de custo

**Status: 🟢 medição entregue** · 17/08.

---

## O buraco

Todo resultado direcional deste laboratório é líquido de `CUSTO_POR_PERNA_PCT`
= 0,2%. Em 15/08 a consulta à Gate.io mostrou que a **taxa publicada é 0,2% por
ordem** — a taxa consome o orçamento INTEIRO e **sobra zero** para impacto de
preço.

O painel de custo já dizia isso e terminava com *"os resultados provavelmente
são otimistas"*. Uma frase, sem quantidade. Faltava o outro lado da conta.

## A decisão que vale metade da medição: Gate.io, não Binance

O repositório já tinha um caminho de livro de ofertas — `fetchOrderBook` em
`market-indicators.ts`, que lê a **Binance**. Seria o caminho fácil e estaria
errado:

- as carteiras de papel preenchem na **Gate.io** (`gateioSpot`, `gateioKlines`)
- a taxa de 0,2% que estamos complementando é da **Gate.io**

Medir profundidade numa corretora para calibrar preenchimento em outra é o mesmo
descasamento que fez o custo do HEIMDALL ser carimbado com o nome da GERI: dois
números que parecem a mesma grandeza e descrevem coisas diferentes. Um livro
mais fundo na Binance faria a derrapagem parecer menor do que a que as mesas de
fato pagam.

## O que foi reusado

`vwapBuy` / `vwapSell` de `zion/arb-realism.ts` — puros, já testados, escritos
para o arbitrador andar os dois livros. A conta de impacto é exatamente a mesma;
o que muda é a pergunta.

## O produto é a TABELA, não um número

Derrapagem não é propriedade do par — é propriedade do par **naquele tamanho**.
Um número só esconderia a pergunta que o dono de fato tem: *"até quanto posso
crescer antes de o custo comer a borda?"*

```
$50 · $100 · $500 · $1.000 · $5.000 · $25.000
```

$50 é o que as mesas operam hoje (`cost_usd` = 49,99 nas posições abertas). O
valor da tabela está em ver ONDE ela vira vermelha.

### A sobra é o veredito

```
sobra = orçamento(ida e volta) − taxa(ida e volta) − impacto(ida e volta)
```

Negativo = o modelo de custo é insuficiente, e todo resultado gravado está
otimista nessa margem. Com a taxa medida de 0,2%/perna contra orçamento de
0,2%/perna, a taxa sozinha já zera a conta — **qualquer** impacto positivo
estoura.

⚠️ A taxa vem da MESMA consulta que alimenta o painel de custo, no mesmo
instante. Não de uma constante copiada: duas cópias da mesma grandeza divergem,
e este projeto já pagou por isso.

## ⚠️ Livro curto é marcado, nunca silencioso

Quando o livro acaba antes do tamanho pedido, o impacto medido é um **piso**: o
resto da ordem preencheria em preços que nem estão no retrato. Errar para o lado
otimista aqui seria dizer "cabe" sobre um tamanho que a corretora não atende.

A tela mostra `⚠N` na linha e o detalhe por par.

## O que isto NÃO mede

1. **Derrapagem de tempo.** Anda o livro de agora. Entre decidir e preencher o
   preço anda, e esse pedaço só aparece comparando `quoted_price` com
   `executed_price` em ordem real — instrumentação que ainda não existe.
2. **Maker versus taker.** Andar o livro é execução a mercado. Ordem limitada
   que descansa no livro tem derrapagem diferente, às vezes negativa.
3. **O livro no instante do preenchimento.** Um retrato não é um filme.
4. **O lado DEX.** Lá o custo é outro mundo — impacto de pool, gás, MEV.

Ainda assim é o **piso honesto**: se o impacto já não cabe no orçamento com o
livro calmo de agora, nunca vai caber.

## Nota de método

A mutação "mediana → média" **passou** na primeira rodada. Meus três casos de
teste (`[1,3,2]`, `[1,2,3,4]`, `[null,5,null,1]`) tinham mediana IGUAL à média —
três asserções que não distinguiam as duas funções. Teste que não separa o certo
do errado é asserção vazia com aparência de cobertura.

O caso assimétrico que entrou (`[0.02, 0.03, 0.04, 0.05, 20]`) é justamente a
razão de ser da mediana aqui: um par fino não pode arrastar o número que
descreve o par que as mesas operam.
