# PLANO — A BANCADA DO CLIENTE

> **Status:** 🟢 as sete fases em produção (06/09), mais a **fase 8** (as mesas
> do torneio como vitrine). O que falta agora é USO — nenhuma rodada real
> aconteceu ainda. Este documento é o desenho, e ele
> existe antes de qualquer linha de código porque a regra da casa é essa.
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

⚠️ **CORREÇÃO (05/09, fase 2): a fórmula acima é o caso SIMÉTRICO.** Ela vale
enquanto `stop = alvo`, que é como as três medições foram feitas — mas o cliente
pode pôr alvo de 3% com stop de 1%, e ali ela erra por 21 pontos. A geral sai de
igualar ganho e perda:

```
p × (alvo − custo) = (1 − p) × (stop + custo)
p = (stop + custo) / (alvo + stop)
```

E ela reproduz as três linhas acima EXATAMENTE — o que é a prova de que a nova
não contradiz a cicatriz, e sim a contém. Vive em `bancada/custo.ts`, com os
três números fixados em teste.

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

> ⚠️⚠️ **A TABELA DESTA SEÇÃO É O RASCUNHO, E ESTÁ SUPERADA. Os números que
> valem são os da §6.2** — decididos depois, pelo critério de lucro que o dono
> mandou aplicar, e mais generosos no que é barato (o free passou de 3 para 10
> testes/dia, de 90 dias para 1 ano, de 1 para 3 símbolos).
>
> ⚠️ Ela fica registrada, e não apagada, porque a mudança tem motivo — mas **a
> tabela abaixo NÃO deve ser implementada**. Duas tabelas de cota no mesmo
> documento é literalmente a cicatriz do Free/ZION: o card prometia 5/dia, o
> `FEATURE_TIER` exigia `pro`, cada lado sozinho era coerente, e quem pagou foi
> o usuário que recebeu 402. **Quando a fase 3 escrever `BANCADA_COTAS`, a fonte
> é a §6.2.**

| _(rascunho — não implementar)_ | free | pro | trader | pilot |
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

⚠️⚠️ **CORREÇÃO, 05/09 — a promessa de "RLS de verdade" não sobreviveu à
arquitetura, e escrevê-la assim mesmo teria sido pior do que não escrever.**

O parágrafo original dizia: *"precisam de policy que amarre `wallet_address` à
sessão"*. Ao ir escrever a migration, dois fatos do código mataram a ideia:

1. **A sessão desta casa não é do Supabase Auth.** É um JWT nosso (HS256,
   `AUTH_JWT_SECRET`), verificado no Node e guardado em cookie httpOnly —
   `src/lib/auth/session.ts`. Ele **nunca chega ao Postgres**, e o `auth.jwt()`
   de uma policy devolveria NULL para toda linha.
2. **Quem consulta usa a service key** (`src/lib/supabase/server.ts`), que
   **ignora RLS por definição**. Mesmo uma policy correta não seria consultada
   em leitura nenhuma.

Uma policy assim seria *"uma trava que existe, parece certa, e está desligada do
caminho que decide"* — a classe de defeito que esta base perseguiu a sessão
inteira. Pior: a próxima pessoa a auditar leria a policy e **pararia de
procurar**.

⚠️ **O isolamento é real, só que em outra camada — e a camada está declarada no
cabeçalho da migration 0037 para ninguém precisar adivinhar:**

| camada | o que ela impede |
|---|---|
| RLS ligada, **zero policies** | o anon key (exposto no browser para o realtime) não lê nada |
| `dono` é o **1º parâmetro obrigatório** de toda função do store | esquecer o filtro vira **erro de tipo**, não vazamento |
| `Dono` é **tipo marcado**, construído só a partir da sessão verificada | o ataque real — `POST {"dono":"0xdavítima"}` — **não compila** |
| teste com **banco falso que guarda linhas de verdade** | prova o **dado que voltou**, não a transcrição do código |

⚠️ E há **uma única porta de leitura** (`doDono`): vinte `.eq("dono", …)`
espalhados seriam vinte chances de faltar um — e o que falta não aparece em
teste nenhum, porque a consulta sem filtro devolve **mais** dados, não menos.
Ela *funciona*.

No dia em que o cliente falar com o Supabase direto (anon key + Supabase Auth),
a policy passa a fazer sentido e entra numa migration própria. Hoje seria
enfeite.

**Provado quebrando nos dois sentidos** (05/09):

| o que eu quebrei | o que aconteceu |
|---|---|
| removi o `.eq("dono", …)` de `doDono` | 6 testes vermelhos |
| removi o `.eq("dono", …)` dos `update` | 3 testes vermelhos |
| troquei `Dono` por `string` | `type-check` quebrou: *Unused '@ts-expect-error' directive* |

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
| **0** | **tabela de velas + busca canônica** — é ela que faz o backtest ser barato (§6.1) | 🟢 |
| 1 | migration + isolamento por dono + testes entre carteiras | 🟢 |
| 2 | `lib/bancada/` puro: custo, pedágio, equilíbrio, veredito (sem rede, testado) | 🟢 |
| 3 | rota de backtest sob demanda + cotas por tier | 🟢 |
| 4 | UI `/laboratorio`: montar, ver o pedágio ANTES, rodar, ler o veredito | 🟢 |
| 5 | as estratégias da casa como ponto de partida (o cliente clona e mexe) | 🟢 |
| 6 | papel adiante (trader+) no cron | 🟢 |
| 7 | `/pricing` nos 4 locales + `FEATURE_TIER` + `BANCADA_COTAS` | 🟢 |

⚠️ **A fase 7 não é o fim, é gêmea da 3.** No dia em que a cota entra no
código, a vitrine tem de dizer a mesma coisa — senão é o Free/ZION de novo.

---

## 6. As decisões — tomadas em 05/09, pelo critério de LUCRO

> O dono mandou escolher pelo que for mais lucrativo para a plataforma,
> lembrando que **cada chamada e cada teste custam dinheiro**. As quatro
> respostas abaixo saem dessa régua, e a medição que as sustenta vem primeiro.

### 6.0 ⚠️⚠️ O que um teste CUSTA de verdade — medido, não estimado

Antes de qualquer cota, dois fatos do código:

**1. O motor de estratégia é PURO. Zero chamadas de IA.**
`zion/benchmarks.ts` e `celeiro/regime.ts` não chamam modelo nenhum — um
backtest é aritmética sobre velas. Ele custa **CPU e vela. Não custa token.**

⚠️ E é por isso que **o ZION explicando o resultado é um produto SEPARADO**. No
minuto em que "me explica por que perdi" vira botão, o custo por teste sai de
frações de centavo para o preço de uma chamada de modelo. Essa alavanca fica
guardada para o tier alto, nunca no free.

**2. As velas já têm cache de 1h — mas keyed pela URL, que inclui o `limit`.**
`fetchTimedCandles(symbol, interval, limit, 3600)`. Se cada cliente pede uma
janela diferente, **o cache erra e cada teste refaz a busca**. Com N clientes
isso é N buscas para o mesmo BTC.

⚠️ E não é hipótese: foi exatamente assim que a medição de piscinas levou **56
de 62 leituras em 429** em 31/08 — rajada de requisições contra um limite por
IP compartilhado.

### 6.1 A decisão que decide o lucro (e que o dono não perguntou)

**Tabela de velas no banco, buscada UMA vez, servida para sempre.**

Vela diária de um dia fechado **nunca muda**. Hoje elas vivem só no cache
efêmero do Next — por deployment, por região. Com tabela:

| | sem tabela | com tabela |
|---|---|---|
| 1º backtest de BTC/2 anos | 1 busca | 1 busca |
| 1.000º backtest de BTC | até 1.000 buscas | **0 buscas** |
| custo marginal do teste | busca + CPU + risco de 429 | **só CPU** |
| tamanho | — | 10 símbolos × 730 dias = **7.300 linhas** |

⚠️ **A regra que faz o cache funcionar: buscar SEMPRE a janela canônica máxima
e fatiar em memória.** Se a busca acompanhar o `limit` do cliente, cada janela
diferente vira uma chave de cache diferente e o ganho evapora.

Com isso o backtest fica **quase de graça na margem** — e é essa a base das
respostas 6.2 a 6.5.

### 6.2 As cotas — generoso no que é barato, apertado no que recorre

O ranking de custo real, do mais caro para o mais barato:

1. **papel adiante** — recorrente, por estratégia, para sempre. **É O custo.**
2. **primeira busca do histórico de um símbolo** — uma vez, depois zero.
3. **CPU do backtest** — desprezível.
4. **IA** — zero, enquanto o backtest for mecânico.

Logo: **backtest generoso, papel adiante caro.**

| | free | pro | trader | pilot |
|---|---|---|---|---|
| ler as estratégias da casa | ✅ | ✅ | ✅ | ✅ |
| backtests por dia | **10** | 100 | 500 | sem teto prático |
| capital simulado máximo | $1.000 | $25.000 | $250.000 | sem teto |
| estratégias próprias salvas | 1 | 10 | 50 | 200 |
| janela de histórico | 1 ano | 2 anos | 2 anos | 2 anos |
| símbolos por teste | 3 | 10 | 10 | 10 |
| **papel adiante** | — | — | **3 mesas** | **10 mesas** |
| **ZION explica o resultado** | — | — | — | ✅ |

⚠️ **O free ficou MAIS generoso que meu rascunho anterior (era 3/dia, 90 dias,
1 símbolo), e isso é decisão econômica, não simpatia.** Depois da tabela de
velas, dez backtests custam CPU de milissegundos. O que eles compram é
conversão: o cliente que rodou dez testes e viu o pedágio comer o alvo dele
entendeu o produto. O que ele NÃO ganha é o que recorre.

⚠️ **O teto real é trabalho, não contagem.** A cota visível é "testes por dia",
mas o freio interno é `símbolos × dias` por rodada — senão um free pede 3
símbolos × 1 ano dez vezes e consome mais que um trader disciplinado.

> ⚠️⚠️ **CORREÇÃO (05/09, fase 3): `símbolos × dias` NÃO limita trabalho.**
>
> Ele ignora a granularidade. Um ano em velas de 1 minuto são **525.600 velas
> por símbolo** contra 365 em velas diárias: o mesmo *"3 símbolos, 1 ano"* do
> plano free custa **1.400 vezes mais** numa e cabe na outra, e a régua escrita
> aqui não enxergava a diferença. É exatamente o pedido que vira rajada contra o
> limite por IP da fonte — em 31/08 uma dessas voltou com 56 de 62 leituras em
> 429, e a rodada inteira não foi evidência sobre nada.
>
> O freio que ficou no código é **`símbolos × dias × 24`** — a janela inteira em
> velas de uma hora. Deixa passar todo uso normal (1d, 4h, 1h) e barra a
> patologia, e a recusa ensina a saída em vez de só negar: *"use um intervalo
> maior — a leitura fica igual de boa e sai na hora"*. Vive em
> `bancada/cotas.ts` (`tetoDeVelasPorRodada`), com teste.
>
> ⚠️ E o que custa não é a CPU, é a BUSCA: o motor varre 26 mil velas em
> milissegundos. Por isso o teto é generoso — depois da tabela de velas, a
> segunda vez que alguém pedir o mesmo BTC não custa requisição nenhuma.

### 6.3 Papel adiante: **`trader`**, não `pro`

É o único custo que **recorre**. Pô-lo no `pro` faz o plano pago mais barato
gerar o maior custo permanente — margem invertida.

E ele é a razão de subir de `pro` para `trader`, que é o degrau de receita mais
alto da escada. Backtest é o passado obedecendo; papel adiante é o presente
discordando, e é isso que se paga para ver.

### 6.4 Custo da NOSSA praça (Gate), como padrão

Duas razões, e as duas são de lucro:

1. **Não custa nada a mais** — `taxas.ts` já tem a tabela por praça E por papel.
2. ⚠️ **Amarra a medição à nossa mesa.** Um backtester genérico é commodity —
   o cliente valida a estratégia dele e vai operar em qualquer lugar. Validada
   com o NOSSO custo, ela só é verdadeira aqui: quem confirmou a $0,20/perna
   tem motivo para operar a $0,20/perna.

⚠️ Praça alternativa fica como campo, não como padrão — e o resultado carrega
qual praça mediu, para ninguém comparar duas coisas diferentes.

### 6.5 Mostrar as estratégias MORTAS: **sim**

O argumento honesto já estava escrito. O argumento econômico é mais forte:

- **custo marginal zero** — já foram medidas e pagas;
- **nenhum concorrente tem** — backtester é commodity, *"esta perdeu 46% e aqui
  está o porquê"* não é;
- ⚠️ **elas REDUZEM custo.** O cliente que lê "o pedágio comeu 67% do alvo"
  antes de rodar cinquenta backtests gasta menos CPU e abre menos suporte. A
  mesa morta é o professor mais barato que temos.

### 6.6 O que continua sendo do dono

As cotas da 6.2 são **desenho meu por critério de custo**, não medição de
disposição a pagar. Elas definem preço, e preço é seu. Se você mexer nelas,
`/pricing` muda nos quatro locales no MESMO commit — a cicatriz do Free/ZION
existe exatamente por isso.


---

## 8. As mesas do torneio na bancada (06/09)

> Pedido do dono: *"vc não adicionou os agentes do torneio na bancada do
> cliente, e estes agentes estão indo bem"*. Ele está certo nas duas metades.

### ⚠️⚠️ Por que elas entram como VITRINE e não como clone

Ao ler o código, elas **não cabem no vocabulário do cliente** — e não por
detalhe:

| a mesa faz | o formulário aceita |
|---|---|
| stop = `max(ATR% × 1,5, piso)`, alvo limitado a `ATR% × √horas × 2,0`, RR ≥ 1,8 (`zion/bracket.ts`) | alvo e stop em **percentual fixo** |
| escolhe entre **10 playbooks por regime** (`zion/playbooks.ts`): reversão de faixa, pullback até a EMA, rompimento com reteste, divergência, absorção… | `média \| canal \| RSI` |

⚠️ Aproximar uma mesa nisso e pôr o nome dela em cima seria o cliente rodando
uma coisa achando que é outra, **com a nossa marca** — e com números que vieram
da regra REAL, não da aproximação.

### O que elas de fato mediram (vida inteira, líquido do custo da praça)

| mesa | decididas | acerto | expiradas | janela | líquido/op |
|---|---|---|---|---|---|
| **FREYJA** (`strat_dex`) | 335 | 79,4% | 57 | 11 símbolos · 21 dias | **+4,34%** |
| **VÖLUNDR** (`strat_mech`) | 331 | 60,7% | 21 | 13 símbolos · 37 dias | **+2,25%** |
| **HEIMDALL** (`radar`) | 285 | 44,9% | 78 | 13 símbolos · 37 dias | **+0,55%** |
| **SKAÐI** (`strat_day`) | 132 | 47,7% | **188** | 13 símbolos · 36 dias | **+0,90%** |
| URÐR · ULLR | 5 · 1 | — | — | — | ruído, sem cor |

⚠️ **A FREYJA paga 0,60% (DEX), não 0,40%.** Eu tinha dito +4,54% ao dono usando
o custo de CEX; o certo é **+4,34%**.

### As quatro decisões que impedem isto de virar propaganda

1. **Só mesa mecânica e viva.** `brain !== "none"` fica fora: 3.300 decisões
   mediram LLM prevendo direção de −6,7 a −30,4 pontos ABAIXO do passeio
   aleatório, e os números confirmam (`grok_scan` −0,99%/op, `kimi_scan` −1,22).
   Oferecer uma dessas seria vender o que a própria casa aposentou.
2. **Custo da PRAÇA da mesa**, não um número único — foi taxa única que
   aposentou o Maker de Faixa por engano.
3. ⚠️ **A ressalva viaja com o número, sempre** (decisão do dono, perguntado):
   expectância por operação ≠ retorno de conta; símbolos correlacionados; uma
   janela é um regime só; a mesa que expira mais do que decide diz isso.
4. **Abaixo de 100 decididas o número sai SEM cor.** A linha mais perigosa do
   banco é a ULLR: **+17,40% de UMA operação**. Pintada de verde, viraria
   promessa.

⚠️ **Mesa medida em OUTRO livro não vira card.** Os quatro arbitradores passam
no filtro de "mecânica e viva" mas não produzem sugestão — são julgados na
carteira de USDT. Um card "ainda sem operação decidida" afirmaria que não foram
medidas, quando o certo é que são medidas em outro lugar; e a arbitragem está
morta desde 03/08.

### O que falta para elas serem CLONÁVEIS

Estender o vocabulário: bracket por volatilidade (ATR) e os playbooks como
gatilhos, no motor, na UI e nos testes. Fase própria — não remendo de carona.


---

## 9. Rodar a mesa DE VERDADE (06/09)

> Dono, olhando os cards com `+4,34%` e nenhum botão: *"não tem como escolher"*.
> Estava certo — uma tela que mostra e não deixa fazer.

### ⚠️⚠️ A saída não foi estender o formulário. Foi expor o motor.

Eu tinha proposto "estender o vocabulário com bracket por ATR e os playbooks".
Era a pior das duas opções. Os dois pedaços que decidem **já são puros**:

```
velas → computeIndicators(símbolo, 1h, 4h, 1d, 1w)     [market-indicators]
      → candidateAttempts(indicadores)                  [zion/playbooks]
      → StrategyPlan { entry, target, stop, horizonHours, playbook }
```

Então o cliente não recebe uma FREYJA aproximada: ele **roda o seletor real**,
sobre os símbolos e a janela dele, com o pedágio da praça dele. `mesa-real.ts`
não reimplementa regra nenhuma — ele costura.

⚠️ E isso responde a pergunta que a própria FREYJA existe para fazer —
*"a mesma regra paga na DEX como na CEX?"* — **na mão de quem paga**.

### As quatro coisas que não podiam dar errado

1. ⚠️ **Sem lookahead, por construção.** Em cada barra os indicadores são
   recalculados sobre a fatia **até ela**. O teste espiona `computeIndicators` e
   exige que a fatia da barra `i` tenha exatamente `i+1` velas — e afirma que o
   espião interceptou (`chamadas.length > 100`), senão o teste seria vazio.
2. ⚠️ **A semanal é AGREGADA das diárias, não substituída por elas.** A primeira
   versão passava as diárias no lugar — `DURACAO_MS` não tem `1w`. O `htf1w` do
   seletor leria outra coisa do que lê ao vivo, **em silêncio**. Agregar é a
   definição, não aproximação: máxima = maior, mínima = menor, fechamento = o
   último. O bloco incompleto do fim fica de fora, como a vela corrente.
3. ⚠️ **O teto de barras é declarado.** 4.000 barras de 1h ≈ 5,5 meses; acima
   disso a função serverless estoura. Quem pedir mais recebe a janela cortada
   **e o aviso em `nao_medido`** — "sem teto silencioso" é regra da casa.
4. ⚠️ **Não existe UM acerto-para-empatar.** O alvo e o stop mudam a cada
   operação, então a ressalva `bracketVariavel` diz isso em vez de a tela
   publicar um número único que a estratégia não tem.

### O portão do pedágio não se aplica ao modo mesa

Ele julga um **alvo fixo**, e aqui não há um: o bracket sai do playbook e já
respeita o próprio piso de RR (1,8) e o teto de escala do `zion/bracket.ts`.
Aplicá-lo recusaria a mesa por um alvo que ela nunca declarou.

### O que continua de fora

O motivo da recusa é **contado** (`porQueNaoAbriu`): sem isso, uma mesa parada e
uma mesa quebrada produzem exatamente a mesma saída.

---

## O HISTÓRICO, E O BOTÃO QUE PROMETIA DEMAIS (07/09)

> *"tá uma merda cada teste que rodo sobrepõe o outro, e não mostra qual agente
> está rodando, não dá pra saber o que está rodando.... cadê a experiência
> Premium que tanto queremos oferecer ao cliente?"* — o dono, com dois
> resultados na tela e nenhum deles com nome.

Três defeitos, e um quarto que só apareceu no banco.

### 1. `const [r, setR]` — a rodada era um estado, não uma lista

Cada corrida escrevia por cima da anterior, e recarregar a página apagava a
tarde inteira. As linhas estavam todas gravadas desde a fase 1 (`bancada_rodada`,
`bancada_resultado`, `bancada_operacao`) e **nenhuma tela as lia de volta** — a
mesma família de `bancada_posicao`: a peça existe, é testada, e está desligada do
caminho que o cliente enxerga.

Agora são uma lista, da mais nova para a mais velha, alimentada por
`GET /api/bancada/rodadas` (a lista) e `?id=` (o extrato daquela rodada, sob
demanda — uma rodada de mesa sobre quatro pares passa de 300 linhas).

### 2. O resultado não dizia quem era

`+2,14%` sozinho não diz se saiu da FREYJA sobre BTC em 365 dias ou de um
RSI(14) sobre SOL em 90. `identidade.ts` reconstrói isso dos `params`
congelados — e **a mesma função serve os dois caminhos**, o POST que acabou de
responder e a releitura do banco. Duas montagens de rótulo divergiriam sem
ninguém perceber, e divergiriam exatamente onde mais confunde.

⚠️ E o cartão **nasce antes da resposta**, com `estado: "rodando"`. É isso que
responde ao *"não mostra qual agente está rodando"*: a identidade é conhecida no
instante do clique.

### 3. "1 operações"

Singular ganhou chave própria nos quatro idiomas (`sampleUm`, `opsUma`,
`mesasExpiradaUma`, `quotaLeftUm`), e `quatro-idiomas.test.ts` trava três coisas
de uma vez: paridade de chaves entre en/pt/es/zh, os mesmos `{placeholders}` em
todas, e que a chave singular **não interpole** `{n}` (senão ela é a plural com
outro nome).

### 4. ⚠️⚠️ O QUE O BANCO MOSTROU: dez botões, um seletor só

Lendo as rodadas do dono para conferir o conserto:

| hora | mesa clicada | líquido | n |
|------|--------------|---------|---|
| 08:35 | **FREYJA** (`strat_dex`) | `+2,140788280112371%` | 1 |
| 08:37 | **ULLR** (`ullr_launch`) | `+2,140788280112371%` | 1 |

Idêntico até a última casa decimal. Não é coincidência: **`rodarMesa` não recebe
a mesa**. Ela roda um caminho único — o cardápio de `candidateAttempts` com a
política "primeiro playbook com plano" — e o nome era o rótulo colado por cima.

E as dez mesas que o botão oferecia não fazem isso:

- as **quatro de arbitragem** (Setor B) não tomam trade direcional nenhum;
- a **URÐR** ordena os candidatos pelo histórico medido e **veta** os negativos
  naquele regime;
- a **SKAÐI** aplica o filtro de clima e revalida a geometria no prazo curto;
- a **HEIMDALL** é scanner de evento;
- a **ULLR** caça pool recém-nascida (2–48h de vida, TVL ≥ US$ 80 mil) com
  bracket fixo 18%/9% — ela nem olha BTC.

É literalmente o que o cabeçalho de `mesas-da-casa.ts` diz que não se faz —
*"o cliente rodando uma coisa achando que é outra, com a nossa marca"* — e
entrou pela porta do botão, três dias depois da frase ser escrita.

**Correção:** `MESAS_QUE_A_RODADA_REPRODUZ` = `strat_mech` (VÖLUNDR, o controle)
e `strat_dex` (FREYJA, a mesma seleção na DEX). As outras oito **continuam na
vitrine** — o card, a medição e as ressalvas são honestos e são o produto; o que
saiu foi a promessa de reproduzir o que não reproduzimos. O filtro está na
**rota**, não só no botão: checagem que mora na tela é checagem que um `curl`
contorna.

⚠️ E como as duas rodáveis partilham o seletor, a ressalva `mesmoSeletor` explica
por que elas devolvem o mesmo número quando o cliente escolhe a mesma praça —
senão isso parece defeito de conta em vez do que é.

### O que mais mudou por tabela

- **Migration 0042**: `competidor_pct` (nulo = não medido, nunca 0) e
  `nao_medido_chaves` (a chave, para a tela traduzir; a prosa continua em
  `nao_medido` para quem abrir o Postgres). Aplicada no banco.
- **O retorno de `gravarResultado` passou a ser lido.** Ele não era, e
  `supabase-js` resolve com `{ data: null, error }` em vez de lançar: uma coluna
  faltando apagaria a rodada do histórico sem log, sem erro na tela e com a
  resposta parecendo perfeita. Agora a rodada fecha como `falhou` com o motivo.

---

## FASE 8 — O AGENTE DO INVESTIDOR, ISOLADO DE VERDADE (07/09)

> *"ainda assim está super errado, apenas estamos pegando os resultados das
> mesas do painel e Admin e repetindo para o investidor... eu falei que tinha
> que ser isolado... o investidor roda estratégia/agente e o mesmo começa a
> trabalhar e gerar resultado dali... vc tem que parar de ficar amontoando uma
> coisa em cima de outra por preguiça de separar"* — o dono.

Ele estava certo, e o defeito era de arquitetura, não de tela. As fases 1–7
entregaram três peças que pareciam a coisa e não eram:

| o que existia | o que ele lia |
|---|---|
| card da mesa com `+4,34%/op` | agregação de `zion_suggestions` — **o livro do admin** |
| botão "rodar esta mesa" | um **backtest**: passado obedecendo, não um agente trabalhando |
| papel adiante (`bancada_posicao`) | vivo e isolado de verdade, mas só sabia rodar `media\|canal\|rsi` |

Faltava a peça do meio: **o agente da casa rodando NA CONTA DO INVESTIDOR**, a
partir do instante em que ele o contrata.

### O que passou a existir

```
contratar → bancada_estrategia { mesa: "strat_dex", papel_adiante: true, papel_desde: agora }
   ↓ (cron de 30 min, tique.ts bifurca por `mesa`)
agente.ts → computeIndicators(1h,4h,1d,1w) → candidateAttempts → plano
   ↓
bancada_posicao { dono, alvo_pct, stop_pct, horas_limite, playbook }   ← DELE
   ↓
desempenho.ts → decididas · expiradas · acerto · líquido/op            ← DELE, do zero
```

- **`agente.ts`** — a decisão de abertura de uma instância. Não reimplementa a
  mesa: chama as MESMAS funções que `mesa-real.ts` e o cron da casa chamam.
- **`desempenho.ts`** — o extrato da instância. **Nenhuma linha de
  `zion_suggestions` entra aqui.**
- **`/api/bancada/agentes`** — contratar, pausar, dispensar, e ler o número dele.
- **migration `0043`** — `bancada_estrategia.mesa`, `bancada_posicao.playbook`,
  `bancada_posicao.horas_limite`.

### As decisões que doeriam depois se fossem tomadas por preguiça

1. **`params` de uma instância é `{}`, e o tipo `Mesa.params` virou
   `EstrategiaDoCliente | null`.** A tentação era guardar uma estratégia de
   fachada (`alvoPct: 2.5`) para o resto do código não precisar de um `null`.
   Isso faria o tick abrir posições com um alvo que a mesa **nunca declarou** —
   o bracket dela sai da volatilidade a cada operação. O `null` obriga cada
   consumidor a perguntar "qual dos dois é este?" antes de decidir, e
   `decidirAbertura` passou a aceitar só `MesaPropria`: passar uma instância de
   agente ali **não compila**.

2. **Uma coluna, não uma tabela nova.** Uma `bancada_agente` paralela teria de
   duplicar dono, símbolos, intervalo, praça, papel, interruptor, cota e índice
   do cron — e as posições apontariam para uma de duas tabelas. Duas fontes para
   "o que este cliente tem ligado" é a receita para as duas discordarem.

3. **O fechamento passou a ler o bracket DA POSIÇÃO** (`decidirFechamentoDaPosicao`).
   Isto era exigência do agente, e de quebra consertou um **defeito latente**: o
   caminho antigo relia o alvo da ESTRATÉGIA para fechar posição já aberta —
   editar a estratégia movia o alvo retroativamente, e o resultado mudava depois
   do fato.

4. **O vazio é uma resposta.** Quem contrata hoje vê *"contratado, ainda sem
   nada decidido — ele só abre quando a regra dele acha setup"*, e **nenhum
   número**. Nem 0%. Preencher esse vazio com a nossa amostra de 335 operações
   seria vender a nossa credibilidade como se fosse o desempenho dele.

5. **O placar da casa continua na tela — rotulado.** O card da mesa agora diz,
   embaixo do número, *"o que a NOSSA mesa fez — não o seu"*. Esconder o número
   seria perder informação honesta; deixá-lo sem etiqueta era a queixa.

6. **A ordem da tela é parte da correção.** Os agentes DELE vêm antes da vitrine
   NOSSA. Invertido, a primeira coisa que ele lê é o nosso resultado.

### O que continua verdade e precisa continuar dito

- É **papel**, não dinheiro real, e o tick é de **30 minutos** — não é cotação
  ao vivo. As duas coisas estão escritas na tela.
- Só `strat_mech` e `strat_dex` são contratáveis, pela mesma
  `MESAS_QUE_A_RODADA_REPRODUZ` do botão de backtest. Contratar uma mesa cuja
  política não reproduzimos seria o defeito de 07/09 entrando pela outra porta.
- `expirada` não é ganho nem perda, e a cor sai das **decididas**: 40 expiradas
  não compram cor para 2 decididas.

### ⚠️ O teto do tick, achado ao dimensionar o agente

`MESAS_POR_TICK = 40` afirmava, em comentário, que *"a ordem determinística
garante que ninguém fique para trás para sempre"*. Com uma ordem estável e um
`.slice(0, 40)`, a mesa de número 41 **nunca roda**.

Só apareceu ao somar o custo da nova espécie: a instância de agente pede **3
leituras por símbolo + `computeIndicators`**, contra 1 da estratégia própria —
40 agentes × 5 símbolos = 600 leituras numa função com `maxDuration = 60` que já
rodou o flywheel, o oráculo, o radar e o papel da casa antes.

- `AGENTES_POR_TICK = 8` — orçamento próprio para a espécie cara.
- `aVezDeQuem(fila, teto, tick)` — a janela **rola**: ordem determinística, ponto
  de partida móvel, e em `n/teto` ticks todo mundo passou. O teste traz a
  contraprova: com o corte fixo, o último da fila não aparece em 50 ticks.
- `adiadas` no resumo e no evento do cron — sem esse número, a única forma de
  descobrir que o teto aperta seria um cliente reclamando.
