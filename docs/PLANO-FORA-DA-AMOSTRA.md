# FORA DA AMOSTRA — walk-forward, retorno/tombo e o motor de tendência · 🟢 CONSTRUÍDO, NÃO MEDIDO

> **Aberto em:** 14/08/2026 · **Origem:** auditoria externa (ChatGPT) sobre o zip
> do projeto, trazida pelo dono. Três entregas: (1) walk-forward, (2)
> retorno/tombo como leitura de primeira classe, (3) motor de tendência de
> baixa frequência.

---

## POR QUE ISTO EXISTE

A auditoria externa acertou um buraco real e errou vários fatos sobre o
projeto. Este plano guarda **os dois**, porque a parte errada também ensina.

### O que ela acertou

**Walk-forward não existe aqui.** Está anotado como `P2.10` no
`PLANO-ACAO-REVIEWS.md` com status ⏸️ — *"gasta token + é coleta de dados"*.
Nós mesmos identificamos e adiamos. Um auditor de fora achou o mesmo buraco
lendo só o código, o que confirma que ele é visível e que o adiamento já durou
demais.

**Retorno/tombo não é lido.** Gravamos `max_drawdown_pct` e nunca ranqueamos
por ele. A coberta mediu vantagem anualizada de 9,26% com tombo de **46,10%** —
razão 0,20. O funding mediu 0,68% com tombo de 5,88% — razão 0,12. Sem essa
coluna, "9,26" e "0,68" são lidos como se a única diferença fosse o tamanho.

### O que ela errou — e por que o erro importa

| afirmação da auditoria | o que o banco diz |
|---|---|
| "funding selecionado perto de ~3%" | **0,676%/ano** líquido, mediana de 57. Os 3,31% são o Funding BTC **sozinho**, a melhor perna, usada como comparativo |
| "vamos construir um trend-following simples e testar" | já foi: `trend_ma50_long_only`, três janelas de 174 dias (04/08). Mercado −63% → **+27,7%**; mercado +0,1% → **+18,5%**; queda sem direção → matou |
| "depois adicionamos regime" | medido em 06/08, e a hipótese **caiu invertida**: RANGING −0,446% (n=176) contra TRENDING_UP −0,777% (n=135) |
| "talvez o problema seja o lado" | teste espelho, 06/08: os nove playbooks negativos **nos dois sentidos**, correlação long×espelho −0,18 |
| "não aprovado para produção com dinheiro real" | pentest de 28/07: 2 achados reais, ambos corrigidos e testados. Rate limit existe. Os 3 🔴 abertos são contabilidade do autopilot de CEX, todos com desdobramento fail-safe anotado |

⚠️ **E a conclusão dela é invertida.** Ela diz *"estamos procurando uma
estratégia sofisticada demais antes de provar que uma simples funciona"*. Nós
começamos pela simples; ela é a **única verde** na família direcional; a
sofisticação veio depois.

### ⚠️ O DIAGNÓSTICO QUE OS NOSSOS NÚMEROS DÃO, E A AUDITORIA NÃO DEU

Ela trata o **edge** como a incógnita. O laboratório diz que a incógnita é o
**custo**:

| medição | bruto | custo | líquido |
|---|---|---|---|
| Grade | 3,39% | **54,27%** | −50,87% |
| LP em AMM | 2,53% | 0,73% | +0,82% (ruído) |
| DEX ↔ CEX | 0,119% | 0,100% | +0,019% |
| Biblioteca de playbooks | — | — | −0,610%/trade |

Filtrar a biblioteca para o melhor terreno leva de −0,610% a −0,440% por trade
e custa 41% dos trades: **continua negativo**. Não falta borda. A borda é menor
que o pedágio.

Isso torna a recomendação dela **mais forte por um motivo que ela não deu**:
posição de baixa frequência interessa não por ser simples, mas porque segurar
por semanas **amortiza o custo por trade** — a variável que nos mata. A
sequência que ela propõe (`trend → +ATR → +regime → +volatility`) empilha
camadas sem tocar nela.

---

## FASE 1 — WALK-FORWARD · 🟢

### O que é, e o que NÃO é

Não é "outro backtest". É a disciplina que separa **escolher** de **medir**:

```
[═══ treino ═══][═ teste ═]
                [═══ treino ═══][═ teste ═]
                                [═══ treino ═══][═ teste ═]
```

Os parâmetros saem do treino. O número que vale sai **só** do teste. As fatias
de teste são **encadeadas e nunca se sobrepõem**, e a soma delas é o resultado
fora da amostra.

### As travas que este módulo tem que ter

1. **Fatias de teste disjuntas.** Se elas se sobrepuserem, o mesmo dia entra
   duas vezes e a amostra infla — é a invariante nº 26 (dois trades com a
   informação de um) na forma de calendário.
2. **A escolha de parâmetro NÃO pode ver o teste.** É a única regra que
   justifica o módulo existir. Tem que ser estrutural (a função de escolha
   recebe só a fatia de treino), não um comentário pedindo cuidado.
3. **Piso de dobras.** Uma dobra não é walk-forward, é um backtest com nome
   novo. Abaixo do piso o veredito é `inconclusiva`, nunca `verde`.
4. **Dentro E fora, lado a lado, sempre.** O número que interessa não é o de
   fora: é a **degradação** entre os dois. Publicar só o de fora esconde o
   overfit; publicar só o de dentro é o overfit.
5. **Degradação é esperada, não é reprovação.** Cair de 18% para 12% é sinal
   de estratégia viva. Cair de 18% para −2% é o ajuste morrendo ao ar livre.

### Entregável

`src/lib/lab/walk-forward.ts` — puro, testável, sem rede e sem banco.

---

## FASE 2 — RETORNO / TOMBO · 🟢

### A conta

```
razão = retorno anualizado ÷ |tombo máximo|
```

`30 / 45 = 0,67` contra `15 / 10 = 1,50` — a segunda é melhor, e a tela de hoje
não deixa ver isso.

### As armadilhas, e são três

1. **Tombo zero não é razão infinita.** É medição sem tombo observado, que
   quase sempre quer dizer amostra curta. Devolve `null`, não `Infinity`.
2. **Retorno negativo não vira "razão ruim", vira nada.** Dividir −5 por 10 dá
   −0,5, que numa coluna ordenada senta acima de −0,8 e sugere que perder menos
   é uma qualidade da razão. Quem perde é julgado pelo retorno, não pela razão.
3. **Não comparar razão de VANTAGEM com razão de NÍVEL.** É a invariante nº 17.
   A coberta anualiza **vantagem sobre segurar**; o carrego anualiza
   **rendimento**. A razão herda a unidade do numerador, e as duas não se
   ordenam na mesma coluna.

### Entregável

Função pura + leitura na tela do laboratório. **Sem migração:** a razão é
derivada de duas colunas que já existem, e guardar derivação cria a segunda
fonte de verdade que este repo passa a vida separando.

---

## FASE 3 — MOTOR DE TENDÊNCIA DE BAIXA FREQUÊNCIA · 🟢

### A regra, deliberadamente burra

```
ENTRADA   EMA50 > EMA200  E  preço > EMA50
SAÍDA     EMA50 < EMA200   (ou stop)
STOP      2 × ATR(14)
RISCO     fração fixa do patrimônio por trade
```

Multiativo, vela diária, long-only na primeira versão.

### ⚠️ O CUSTO ENTRA PRIMEIRO, NÃO POR ÚLTIMO

Toda medição direcional deste laboratório morreu no custo. Então aqui o custo é
**parâmetro de construção**, cobrado nas duas pernas de toda mudança de
posição, e o resultado bruto só existe ao lado do líquido — nunca sozinho.

A hipótese que este motor testa não é *"tendência funciona?"*. É:

> **a baixa frequência amortiza o pedágio que matou a biblioteca de playbooks?**

Se a resposta for não, o achado vale mais que o motor: significa que o problema
não é a estratégia nem a frequência, e sim o nível de custo com que operamos.

### O que este motor NÃO vai provar

- Não prova 30%/ano. Não é o objetivo, e prometer isso é o que a própria
  auditoria diz para não fazer.
- Não substitui a MA50 da Fase 1 — **é a mesma família**, com stop e risco por
  trade, medida com disciplina que a Fase 1 não teve.
- Vela diária não vê o caminho dentro do dia: se a vela tocou stop e alvo, a
  convenção é registrar o **stop** (pessimismo primeiro, como no resto do
  laboratório).

---

## RISCO ACEITO, ESCRITO ANTES DE MEDIR

> A MA50 está **verde** hoje com base em três janelas de 174 dias, sem
> walk-forward. Existe chance real de ela **não sobreviver** fora da amostra.
>
> Se não sobreviver, o veredito muda para `morta` ou `inconclusiva` e a Fase 1
> perde a única estratégia direcional aprovada. **Isso é sucesso do laboratório,
> não fracasso** — e está escrito aqui ANTES do resultado para que não seja
> reinterpretado depois.

---

## Estado

| fase | entrega | status |
|---|---|---|
| 1 | `walk-forward.ts` + 20 testes, 1 mutação verificada | 🟢 |
| 2 | `retorno-tombo.ts` + coluna no painel 🧪 + `lastMaxDrawdownPct` no `readLab` | 🟢 |
| 3 | `tendencia.ts` + `POST /admin/api/tendencia` + slug no registro | 🟢 |

## ⚠️ CONSTRUÍDO NÃO É MEDIDO

O código está pronto, testado e ligado. **O número ainda não existe**: a rota
precisa rodar contra a Binance, e o ambiente onde ela foi escrita não alcança
`data-api.binance.vision` (o proxy bloqueia). O que foi verificado aqui:

- as peças se encaixam de ponta a ponta sobre série **sintética** (1.400 dias,
  3 símbolos, passeio determinístico) — dobras suficientes, zero ilegíveis,
  veredito legível;
- o motor de fato opera nessa série: poucos trades, ~46% de exposição, custo
  positivo. É a assinatura de baixa frequência;
- 5 mutações derrubam teste (passo das dobras, pedágio de uma perna, teto de
  peso, sinal do próprio dia, alinhamento do indicador).

O que **não** foi verificado: qualquer coisa sobre o mercado. O primeiro
`POST /admin/api/tendencia` em produção é que diz.

## O defeito que a construção achou (invariante nº 30)

`calcEMA` devolve `n − período + 1` valores começando na vela `período − 1`.
Indexei por `i` direto. A EMA de 200 virava `null` a partir da vela 201, o motor
**nunca entrava**, e a medição teria gravado "0 trades" com veredito plausível
sobre o mercado. Nenhuma exceção, nenhum teste de fumaça pegaria. Quem pegou foi
um teste de RELAÇÃO: *"em série que só sobe, a curta fica acima da longa"*.
