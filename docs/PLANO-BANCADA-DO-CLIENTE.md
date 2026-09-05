# PLANO — A BANCADA DO CLIENTE

> **Status:** 🔴 nada construído. Este documento é o desenho, e ele existe antes
> de qualquer linha de código porque a regra da casa é essa.
>
> **Escrito em:** 05/09/2026, a partir de uma correção do dono.

---

## 0. O que isto NÃO é

⚠️⚠️ **Não é o nosso laboratório aberto para o cliente.** Essa foi a primeira
leitura, e ela estava errada.

O `/admin` tem 29 mesas medidas, painéis de veredito, `lab_runs`, detector de
discordância com o livro. Aquilo é um **instrumento de pesquisa nosso** — e o
dono é preciso ao dizer que ele *"sequer está 100% para nós que estamos
construindo a plataforma"*. Entregar aquela densidade a quem chega na
plataforma seria entregar um osciloscópio a quem pediu um multímetro.

**A bancada do cliente é outro produto.** O trader chega e quer:

1. escolher **quanto capital simulado** quer usar;
2. testar **as estratégias que disponibilizamos**;
3. **criar as dele** e testar;
4. ver **taxa, derrapagem e o custo real** de cada uma.

Nosso laboratório responde *"esta família de estratégia tem borda?"*. A bancada
responde *"a MINHA ideia, com o MEU capital, sobrevive ao custo?"*. São
perguntas diferentes, telas diferentes e público diferente.

---

## 1. O que torna esta bancada NOSSA e não um backtester genérico

Todo backtester do mercado mostra **retorno bruto**. É por isso que todo
backtester do mercado mente.

A lição mais cara deste laboratório, medida três vezes, é que **o custo
decide**:

| medição | o que aconteceu |
|---|---|
| Maker de Faixa, 23/08 | acertou **70,4%** e perdeu — entregou 121% do ganho de preço em taxa |
| Grade, 31/08 | −46,77%; os degraus renderam 1,25% e o estoque preso comeu o resto |
| Rotação, 31/08 | −1,61% por período · **ficar em caixa bateu** |

E a aritmética que sai disso já está escrita e testada aqui:

```
equilíbrio = 0,5 + custo_ida_e_volta / (2 × alvo)

±0,6%  → precisa acertar 83,3%
±1,5%  → precisa acertar 63,3%
±2,5%  → precisa acertar 58,0%
```

⚠️ **É ISTO que a bancada põe no centro da tela.** O cliente digita "alvo de
0,6%" e a bancada responde, antes de qualquer backtest: *"a ida e volta custa
0,40% na Gate spot — 67% do seu movimento bruto. Você precisaria acertar 83%
das vezes. Nenhuma mesa desta casa jamais teve isso."*

Isso não é enfeite: é a única coisa que separa uma bancada honesta de uma
máquina de vender esperança. E o código já existe — `alvoLimpaOPedagio`,
`fracaoDoPedagio`, `taxaPorPerna` por praça E por papel.

---

## 2. As quatro perguntas do dono

### 2.1 Quais tiers liberam acesso

⚠️ **A pergunta certa não é "quem entra", é "quanto cada um pode rodar".**

O repositório já tem essa cicatriz escrita em `tier/types.ts`: o card do plano
Free anunciava *"5 análises/dia"* em quatro idiomas enquanto `FEATURE_TIER`
exigia `pro` — o usuário Free recebia **402, zero análises**. Duas fontes
diziam cinco, uma dizia nenhuma, e a que dizia nenhuma era a que valia.

A conclusão que ficou: *"Quem separa os planos no ZION é a **COTA**, não o
portão."* A bancada segue a mesma regra.

**Proposta: todos entram, o tier decide o tamanho da bancada.**

| | free | pro | trader | pilot |
|---|---|---|---|---|
| ler as estratégias da casa | ✅ | ✅ | ✅ | ✅ |
| **rodar** backtest histórico | 3/dia | 20/dia | 100/dia | 300/dia |
| capital simulado máximo | $1.000 | $10.000 | $100.000 | sem teto |
| estratégias próprias salvas | 1 | 5 | 25 | 100 |
| janela de histórico | 90 dias | 1 ano | 2 anos | 2 anos |
| símbolos por teste | 1 | 3 | 10 | 10 |
| **papel adiante** (teste vivo, tickando) | — | — | ✅ 3 mesas | ✅ 10 mesas |

⚠️ **O `free` PRECISA conseguir rodar alguma coisa de verdade.** Uma bancada
onde o gratuito só olha é uma vitrine com botão falso, e este repo já pagou
por prometer na vitrine e negar na porta. Três rodadas por dia com $1.000 e um
símbolo é pouco — mas é **real**, e o cliente vê o veredito completo, inclusive
o custo.

⚠️ **`FEATURE_TIER` continua sendo a fonte única.** As cotas entram numa tabela
irmã (`BANCADA_COTAS`), no mesmo arquivo, e a página `/pricing` é atualizada
nos **quatro locales** no MESMO commit. Sem isso a cicatriz do Free volta.

### 2.2 Qual função cada tier tem

O eixo não é "features diferentes", é **profundidade da mesma coisa**:

- **free — entender.** Roda as estratégias da casa com capital pequeno, vê o
  veredito e o custo. Sai sabendo ler "o pedágio come 67% do seu alvo".
- **pro — construir.** Cria estratégias próprias, escolhe capital de verdade,
  compara duas configurações lado a lado.
- **trader — acompanhar.** Ganha o **papel adiante**: a estratégia dele passa a
  tickar com o mercado vivo, e ele vê a diferença entre backtest e realidade.
  ⚠️ Essa diferença é o produto: backtest é o passado obedecendo; papel adiante
  é o presente discordando.
- **pilot — operar em escala.** Sem teto de capital, mais mesas simultâneas,
  e o histórico completo.

### 2.3 UI de cliente, não de admin

Concretamente, e sem margem para deriva:

| ✅ usa | ❌ nunca |
|---|---|
| rota em `src/app/(plataforma)/laboratorio/` | qualquer coisa sob `/admin` |
| Tailwind e os componentes de `src/components/` | `adm-*`, `TerminalPanel`, `--adm-ink-*` |
| entrada em `nav-items.ts` (fonte única: sidebar, mobile e ⌘K) | link solto |
| i18n nos **4 locales** (en/pt/es/zh) | string em português no JSX |
| cabe na tela sem arrastar para os lados | tabela de 9 colunas |

⚠️ **O que ATRAVESSA do admin é a REGRA, não o CSS.** Três invariantes vêm
junto porque foram compradas com dinheiro:

1. **veredito antes do número** — placar antes de veredito faz retorno parecer
   aprovação;
2. **"não medido" nunca vira 0, e nunca vira vermelho** — `corDoResultado(null)`
   é cinza, e há cinco linhas no admin que já apareceram com cor de prejuízo
   para medição que não existia;
3. **a amostra fica visível** — `shouldTint`/`sampleLabel`: número com n=8 não
   ganha cor de veredito.

### 2.4 Fácil de configurar e fácil de ler

⚠️ **O admin falha nisso, e é por isso que ele não pode ser o molde.** Lá cada
painel tem seis a nove colunas e três avisos em âmbar — funciona para quem
construiu, não para quem chega.

**O desenho: uma pergunta por vez, e o custo sempre à vista.**

```
┌─ MONTE SEU TESTE ────────────────────────────────┐
│  capital simulado    [ $5.000        ]           │
│  o que comprar       [ BTC ▾ ]                   │
│  quando comprar      [ média 50 ▾ ]              │
│  alvo   [ 2,5% ]     stop   [ 2,5% ]             │
│  onde                [ Gate · spot ▾ ]           │
├──────────────────────────────────────────────────┤
│  ⚠️ ANTES DE RODAR — o pedágio                    │
│  ida e volta 0,40% · 16% do seu alvo             │
│  você precisa acertar 58% das vezes              │
│                                    [ RODAR ]     │
└──────────────────────────────────────────────────┘
```

⚠️ **O bloco do pedágio aparece ANTES do botão, e reage a cada tecla.** Se o
cliente digitar alvo de 0,6%, ele lê *"você precisaria acertar 83%"* sem gastar
uma rodada. Metade das ideias ruins morre aí, de graça, e o cliente aprende o
que a casa levou três medições para aprender.

E o resultado segue a mesma ordem:

```
┌─ VEREDITO ───────────────────────────────────────┐
│  ⚖ EMPATE — dentro do ruído                      │
│  +0,3% em 24 operações. Ficar em caixa daria 0%. │
│  A diferença não se distingue de zero.           │
├──────────────────────────────────────────────────┤
│  bruto  +4,1%    taxa  −3,8%    LÍQUIDO  +0,3%   │
│  acertou 62% · precisava de 58% · n=24 (ruído)   │
└──────────────────────────────────────────────────┘
```

---

## 3. O que JÁ EXISTE e não deve ser reconstruído

⚠️ Metade desta bancada já está escrita e testada. Reescrever seria criar uma
segunda definição de custo que diverge da primeira em silêncio — que é
exatamente o defeito que este laboratório persegue.

| peça | onde | o que faz |
|---|---|---|
| motor de estratégia | `zion/benchmarks.ts` | `runPositions`, `sma`, canal de Donchian, custo na troca |
| **taxa por praça E por papel** | `celeiro/taxas.ts` | spot 0,20% · futuros maker 0,015% / taker 0,05% |
| **portão do pedágio** | `celeiro/regime.ts` | `alvoLimpaOPedagio`, `fracaoDoPedagio` |
| derrapagem real do livro | `cex/derrapagem-gateio.ts` | impacto por tamanho, com spread |
| caminhar o livro | `zion/arb-realism.ts` | `vwapBuy` / `vwapSell` |
| saída de posição | `paper/engine.ts` | alvo, stop, expiração, dimensionamento |
| indicadores | `api/market-indicators.ts` | RSI, MACD, ATR, ADX, regime |
| cor de três estados | `admin/cor-resultado.ts` | perdeu / ganhou / ganhou mas perdeu do índice |
| régua de amostra | `admin/sample.ts` | `shouldTint`, `sampleLabel` |
| rodada com janela declarada | `lab/store.ts` | `startRun` grava parâmetros ANTES |

---

## 4. O que é genuinamente novo

### 4.1 ⚠️ Não existe conta de papel POR USUÁRIO

Medido: `paper_accounts` **não tem `wallet_address`**. As carteiras de papel de
hoje são por FONTE (as mesas da casa, o torneio) — não por cliente.

Isso é o maior fato arquitetural deste plano: a bancada não é "expor o papel
que já temos", é **schema novo com dono, com RLS, e com teto de custo**.

Tabelas novas (migration a escrever):

- `bancada_estrategia` — a estratégia do cliente: dono, nome, parâmetros
  (jsonb), praça, papel. RLS por carteira.
- `bancada_rodada` — cada execução: capital, janela **declarada antes**,
  parâmetros congelados, status.
- `bancada_resultado` — bruto, taxa, derrapagem, líquido, n, acertos,
  equilíbrio exigido, veredito, `nao_medido[]`.
- `bancada_posicao` — só para o **papel adiante** (trader+), que tem estado.

⚠️ **RLS de verdade aqui, não default-deny com zero policies.** As tabelas de
hoje são internas e a service key basta. Estas são do CLIENTE: precisam de
policy que amarre `wallet_address` à sessão, e de teste que prove que a
carteira A não lê a linha da carteira B.

### 4.2 O construtor de estratégia

⚠️ **Parâmetros, não código.** Cliente escrevendo código no nosso servidor é
uma superfície de ataque que não vamos abrir. O construtor é um formulário
sobre um vocabulário fechado: entrada (média N, canal N, RSI), alvo, stop,
horizonte, praça, papel, capital, símbolos.

⚠️ E ele passa pelo **mesmo portão do Celeiro**: `genomaAbre()` recusa uma
configuração que nunca poderia abrir. O cliente recebe o motivo na hora, não
uma rodada vazia. Foi assim que o Maker ficou dois dias sem operar.

### 4.3 O teto de custo

Backtest é CPU, papel adiante é cron. Ambos escalam com número de clientes.

- backtest roda **sob demanda**, na requisição, com teto de janela por tier;
- papel adiante entra no cron existente, com teto de mesas por tier;
- as cotas da §2.1 são o freio, e elas são medidas em `admin_kv` como as outras.

---

## 5. Fases

| # | entrega | status |
|---|---|---|
| 1 | migration + RLS + testes de isolamento entre carteiras | 🔴 |
| 2 | `lib/bancada/` puro: custo, pedágio, equilíbrio, veredito (sem rede, testado) | 🔴 |
| 3 | rota de backtest sob demanda + cotas por tier | 🔴 |
| 4 | UI `/laboratorio`: montar, ver o pedágio ANTES, rodar, ler o veredito | 🔴 |
| 5 | as estratégias da casa como ponto de partida (o cliente clona e mexe) | 🔴 |
| 6 | papel adiante (trader+) no cron | 🔴 |
| 7 | `/pricing` nos 4 locales + `FEATURE_TIER` + `BANCADA_COTAS` | 🔴 |

⚠️ **A fase 7 não é o fim, é gêmea da 3.** No dia em que a cota entra no
código, a vitrine tem de dizer a mesma coisa — senão é o Free/ZION de novo.

---

## 6. O que é decisão do dono, não minha

1. **As cotas da tabela §2.1 são um chute meu fundamentado, não uma medição.**
   Elas definem preço e margem. Preciso do seu número, não do meu.
2. **Papel adiante a partir de `trader` ou de `pro`?** É a diferença entre uma
   feature de retenção e um custo de cron que cresce com o plano barato.
3. **A bancada usa nossas praças reais (Gate) ou um custo genérico?** Usar a
   nossa é mais honesto e amarra o cliente ao nosso custo real; genérico é mais
   universal e menos nosso.
4. **Mostramos as estratégias MORTAS da casa como ponto de partida?** Eu acho
   que sim — "esta perdeu 46% e aqui está o porquê" ensina mais que qualquer
   verde. Mas é decisão de produto.
