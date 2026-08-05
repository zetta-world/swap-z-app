# LABORATÓRIO DE ESTRATÉGIAS — medir todas, com o capital que cada uma pede — 🟡

> **Gatilho (05/08):** depois do mapa das 34 fontes de lucro, o dono decidiu:
> *"vamos medir todas as formas que estão em cinza e para cada uma vamos usar o
> capital necessário... vamos adicionar as verdes também e vamos medir da forma
> correta... e sobre as mesas que temos vamos olhar fundo nelas e dar tudo que
> elas precisam para melhorar — quem precisa de tempo damos tempo, janela maior
> damos janela maior, capital necessário damos o capital necessário, se precisa
> long damos long, se precisa short damos short."*
>
> Este é o plano vivo dessa empreitada. Referência do inventário:
> o **Mapa do Lucro** (artefato de 05/08, 34 fontes classificadas).

---

## ✅ PREMISSAS CONFIRMADAS PELO DONO (05/08)

1. **Dinheiro real: NÃO agora.** *"agente apenas vai simular como se estivesse
   usando as rotas que o dinheiro real vai recorrer."* Ou seja: as rotas, os
   custos e as travas são as do dinheiro real; o capital é simulado.
2. **Sem timidez com custódia ou licença.** *"nosso plano futuramente é obter
   estas licenças... já podemos ter agora na plataforma e já testar tudo e ir
   lançando cada parte conforme o projeto ganha estrutura."* Então nada é
   descartado por regime regulatório — constrói-se, mede-se, e o lançamento
   de cada parte espera a licença correspondente.
3. **"Todas" = eu decido a ordem.** *"tem muita coisa que não entendo e como
   você fez um estudo completo, você com certeza vai decidir certo... você
   agora está proibido de ser preguiçoso."* A contrapartida: buscar no código,
   nos docs, na internet, e consultar quando a dúvida for de negócio.

---

## ⚠️ AUDITORIA VISUAL DO LABORATÓRIO — 11 prints, 05/08

O dono mandou o painel inteiro: *"o desastre confuso visual que é, e que se eu
mostrar a um leigo ele não vai saber o que é o que, qual mesa é, e o que mede o
que... tenho uma forte suspeita que muitos números e informações não estão
atualizados."*

**A suspeita estava certa, e o problema é pior que desatualização.**

### Três defeitos VERIFICADOS no código

**1. O patrimônio exibido não é o caixa — e a diferença é de $9.350.**

`paper/route.ts` calculava `equity = capital + realizado + não-realizado`,
ignorando a coluna `cash_usd`. O painel mostrava:

| carteira | exibido | `cash_usd` real |
|---|---|---|
| `oracle_mistral` | **$1.001** | **$9,80** |
| `deepseek_scan` | **$998** | **$0,40** |
| `grok_scan` | **$994** | **$0,00** |

Total exibido: **PATRIMÔNIO $20.842**. Soma real de `cash_usd`: **≈$11.491**.

O buraco nas aposentadas é **deliberado** — é a cicatriz preservada do
vazamento de julho, e recreditá-las apagaria o registro. O defeito nunca foi
o buraco: era a tela mostrar o valor contábil no lugar do caixa.

**2. O ✓ verde de "caixa bate com os trades" não dizia de quais carteiras falava.**

`planRepair` só olha as carteiras VIVAS — decisão correta de 04/08. Mas o aviso
aparecia sem qualificador, acima de uma lista com as 23. Verdadeiro no escopo,
falso na leitura.

**3. O portão de lançamento aprovava expectancy com ZERO trades decididos.**

No cartão da FREYJA, dois critérios lado a lado:

```
✗ Amostra ≥ 100 decididos ......... 0/100 decididos
✓ Expectancy líquida positiva ..... +0.290% por trade, líquido
```

O critério de drawdown, no mesmo arquivo, sempre teve `pending: decided === 0`.
O de expectancy só checava se o número era nulo — e um número vindo de posições
não resolvidas passava. **Média de amostra vazia virando aprovação, num portão
que decide lançamento.**

O teste que existia usava `decided: 0` **junto com** `netExpectancy: null`, e
por isso nunca exercitou o caso real.

> Os três foram consertados em 05/08, com teste travando o terceiro.

### Os defeitos de LEITURA — a parte que o leigo não entende

| Problema | Por quê |
|---|---|
| **11 painéis empilhados numa aba só** | "LAB · SIMULADO (11)" é uma coluna infinita. Nenhuma hierarquia entre medir estratégia, medir mesa e medir mercado |
| **Mesma carteira, números diferentes em painéis diferentes** | VÖLUNDR aparece como **$995** no PAPER e **$997** na BARRA DE LANÇAMENTO. Três fontes de verdade |
| **Nomes vikings sem legenda** | MÍMIR, VÖLUNDR, SKAÐI, FREYJA, ULLR — não há como saber o que cada uma mede sem abrir o código |
| **23 chips de filtro numa linha** | O BACKTEST tem uma fileira de 23 agentes; ninguém acha o que procura |
| **Capital invisível** | Nenhum painel mostra com quanto a mesa opera — e é a variável que mais explica o resultado |
| **Amostra escondida** | `n=0 · ruído` em cinza claro do lado de um número grande e colorido |
| **Cicatrizes lidas como desempenho** | As mesas Valhalla aparecem em vermelho como se tivessem perdido operando |

### O que isso muda no plano

**A Fase 0 cresce.** Não dá para construir 26 mesas em cima de um painel que
mostra $20.842 onde há $11.491 e aprova critério com amostra zero. Antes de
qualquer estratégia nova:

- **uma fonte de verdade por número** — se dois painéis mostram a mesma
  carteira, leem da mesma rota;
- **capital e amostra sempre visíveis** — são as duas colunas que decidem se o
  número significa alguma coisa;
- **hierarquia de navegação** — família → mesa → medição, não 26 painéis
  empilhados;
- **legenda de mesa** — quem é, o que mede, com quanto, desde quando.

---

## 1. AUDITORIA DE ESTADO — o que existe hoje, medido em 05/08

Antes de qualquer código, conforme instrução explícita. Nada abaixo é
estimativa: veio de `paper_accounts`, `paper_positions`, `platform_events` e do
código.

### 1.1 As 23 mesas, e o defeito estrutural

| | |
|---|---|
| Mesas registradas em `desks.ts` | **27 entradas** |
| Contas em `paper_accounts` | **23** |
| Com posição ativa | **5** (kimi_scan, mistral_scan, strat_ai, strat_day, strat_mech) |
| Com posição ABERTA agora | **3** (strat_ai 3, strat_day 4, strat_mech 6) |
| **Capital inicial** | **$1.000 em 19 delas · $300 em 4 (arbiter2 e alavancadas)** |

**Este é o defeito que o dono apontou, e ele é estrutural.** Toda mesa recebeu
$1.000 independentemente do que a estratégia dela exige:

- funding/basis precisa de **$2.000** para o custo das 4 pernas não dominar;
- basis de futuro trimestral, **$5.000**;
- arbitragem estatística, **$10.000**;
- market making de verdade, **$50.000** e tier de taxa;
- rendimento em DeFi na Ethereum, **capital que faça o gás valer a pena**.

Dar $1.000 a todas não é neutro — é **medir errado por construção**. Uma mesa
sub-capitalizada não "rende menos": ela rende negativo por causa do custo fixo,
e o resultado é lido como "a estratégia não presta".

### 1.2 Inconsistências encontradas no ledger

| Mesa | O que está estranho | Diagnóstico |
|---|---|---|
| `radar` | caixa $1.000,00 exato com P&L de **−$13,37** e 33 trades fechados | O P&L nunca fluiu para o caixa, ou o caixa foi resetado sem contabilizar. **Precisa conserto.** |
| `deepseek_scan` | $1.000 → **$0,40** com P&L de apenas −$2,22 | Cicatriz PRESERVADA do vazamento de julho (decisão de 04/08: não recreditar Valhalla). Correto, mas **o painel não diz isso** — lê-se como mesa que perdeu tudo operando. |
| `grok_scan` | $1.000 → **$0,00** | Mesma cicatriz. |
| `kimi_scan`, `mistral_scan`, `self_scan`, `oracle_*` | caixa entre $9,80 e $108 com P&L perto de zero | Mesma cicatriz. |
| `strat_ai`, `strat_day`, `strat_mech` | caixa = $1.000 − P&L − posições abertas | ✅ **Consistente.** O reparo de 04/08 funcionou nas mesas vivas. |

**12 de 23 mesas nunca abriram uma posição.** Várias marcadas `live`.

### 1.3 Onde os dados moram — e por que não serve

Todas as medições novas (censo de profundidade, perp, maker, funding,
what-worked, venue-truth) gravam em **`platform_events.metadata`**, jsonb solto.

Isso funcionou para uma medição pontual e **não serve** para o que vem agora:

- não dá para consultar "todas as rodadas da estratégia X ao longo de 3 meses"
  sem varrer jsonb;
- não há vínculo entre *estratégia* → *capital usado* → *janela* → *resultado*;
- não há como comparar duas estratégias na mesma régua sem reprocessar à mão;
- o dono pediu explicitamente: **"todo dado gerado tem que ficar quadrado em
  nosso banco de dados"**.

**Conclusão: a Fase 0 precisa criar tabelas dedicadas antes de medir qualquer
estratégia nova.** Medir primeiro e estruturar depois seria repetir o erro do
`byWeather` — número certo, sem rastro consultável.

### 1.4 Documentação — 49 arquivos, 22 indexados

`docs/README.md` (o índice que deveria dizer o que está vivo) **não lista**:
`PLANO-ARBITER-REAL.md`, `PLANO-LUCRATIVIDADE.md`, `PLANO-RAGNAROK.md`,
`PLANO-MESA-AGENTES.md`, `LEITURA-SEGURA-DO-BANCO.md`, `PLANO-ESCOLA-DE-TRADERS.md`,
`PLANO-ARQUIVO-RODADAS.md`, `PLANO-BARRA-DE-LANCAMENTO.md`,
`PLANO-DESKTOP.md`, `PLANO-HIRD-REDESIGN.md`, `PLANO-ORACULO-ANALISTA.md`,
`PLANO-POLISH-FLYWHEEL.md`, `PLANO-ANALISTA-PROFUNDO.md`, `CONTEXTO-ZETTAWORD.md`,
`AUDITORIA-PERDA-DINHEIRO.md`, `RELATORIO-*`, `PENTEST-28-07.md`,
`ANALISE-AUDITORIA-OPERACIONAL-08-07.md`, `AUDITORIA-AGENTES-25-07.md`,
`PLANO-MIDGARD-TRAFEGO.md`, `PLANO-PAPER-GATEIO.md`, `PLANO-ADMIN-INTEL.md`,
`PLANO-AGENTE-SNIPER.md`, `PLANO-HIBRIDO-MULTI-MODEL.md`, `PLANO-DESKTOP.md`.

**17 docs carregam 🔴** (pendências) e não dá para saber quais ainda valem.

---

## 2. O QUE VAI SER MEDIDO

Do Mapa do Lucro, separado como o dono pediu — **verde** (medido positivo) e
**cinza** (não medido). Cada linha vira uma mesa com **capital próprio**.

### 2.1 As VERDES — remedir com capital e janela corretos

| # | Estratégia | Capital | O que muda em relação ao que já medimos |
|---|---|---|---|
| V1 | Seguidor de tendência (MA50) | $5.000 | Hoje mede só long-only em 10 símbolos. **Precisa de short**, janela de 12 meses, e regime declarado por trade |
| V2 | Long/short com filtro de regime | $5.000 | O achado central: direção paga, lateralidade mata. Nunca foi mesa, só backtest |
| V3 | Comprar e segurar | $1.000 | Base de comparação. **Toda mesa é julgada contra ela**, e hoje isso não é automático |
| V4 | Taxa de agregação | — | Receita real, já existe. Falta **medir quanto o cliente economiza** vs rota ingênua |

### 2.2 As CINZAS — nunca medidas

Agrupadas por família, com o capital que a literatura e o custo real exigem.

**Carrego (alguém paga para você esperar)**

| # | Estratégia | Capital | Por que este capital |
|---|---|---|---|
| C1 | Empréstimo de stablecoin (Aave/Morpho) | $1.000 | Sem mínimo real; $1k dá para medir gás vs rendimento |
| C2 | Tesouro tokenizado / RWA | $1.000 | Mínimos de emissor giram nessa faixa |
| C3 | Staking líquido (stETH/rETH) | $1.000 | Sem mínimo; o gás é o custo |
| C4 | Restaking | $2.000 | Camada extra de risco pede amostra maior |
| C5 | Funding / cash-and-carry | **$2.000** | Abaixo disso as 4 pernas dominam |
| C6 | Basis de futuro trimestral | **$5.000** | Mesmo motivo, com prazo |
| C7 | sUSDe e similares | $1.000 | Basis empacotado; medir contra C5 feito à mão |
| C8 | Venda de opção coberta | **$5.000** | 1 BTC de nocional é inviável; precisa de tamanho para o prêmio pagar |

**Direcional**

| # | Estratégia | Capital | Por que |
|---|---|---|---|
| C9 | Rotação por momento | $2.000 | Precisa de 5+ posições simultâneas |
| C10 | Grade (grid) | $1.000 | Muitas ordens pequenas; capital baixo é o caso de uso real |

**Estrutura de mercado**

| # | Estratégia | Capital | Por que |
|---|---|---|---|
| C11 | Arbitragem DEX ↔ CEX | **$5.000 + gás** | Gás fixo por operação exige tamanho |
| C12 | Liquidações | **$10.000** | Precisa estar pronto quando o evento vem |
| C13 | Arbitragem de ponte | **$20.000** | Adianta liquidez; é capital que fica preso |

**Liquidez**

| # | Estratégia | Capital | Por que |
|---|---|---|---|
| C14 | LP em AMM clássico | $2.000 | Medir taxa contra perda impermanente honestamente |
| C15 | Liquidez concentrada (v3) | $2.000 | 54,7% dos LPs perdem — medir para poder **desaconselhar com dado** |
| C16 | LP em perp DEX (cofre) | $2.000 | Você é contraparte dos traders |
| C17 | Cofre de opções (DOV) | $1.000 | Venda de vol embalada |

**Primário e evento**

| # | Estratégia | Capital | Por que |
|---|---|---|---|
| C18 | Airdrop / pontos | $500 | Tempo vale mais que capital |
| C19 | Launchpad / IEO | $1.000 | Alocação por tier |
| C20 | Suborno de governança | $10.000 | Mercado de votos exige posição |

**Negócio (não é trade, é receita)**

| # | Item | O que medir |
|---|---|---|
| C21 | Rebate de corretora | Quanto de volume já geramos e quanto isso valeria |
| C22 | Rev-share de protocolo | Quanto de stablecoin parada os clientes têm |

**Total: 4 verdes + 22 cinzas = 26 mesas novas ou remedidas.**

> ⚠️ **Fora de escopo, com motivo:** market making (mede-se, mas só faz sentido
> com tier de rebate — já provado −0,04%/ciclo a 0,02% de taxa); MEV
> (infraestrutura fora do alcance); validador próprio ($100k+); copy trading
> (48,5% dos copiadores no verde — não vamos vender).

---

## 3. AS FASES

Regra do dono, aplicada em todas: **revisar os setores antes, testar e revisar
depois, só então seguir.**

### FASE 0 — Fundação · 🟢 CONCLUÍDA (05/08)
*Nenhuma estratégia é medida nesta fase. Ela existe para as outras não nascerem tortas.*

1. **Índice de docs reconstruído** — os 49 arquivos classificados em vivo /
   histórico / morto, com os 17 🔴 resolvidos ou aposentados.
2. **Tabelas do laboratório** (migração nova):
   - `lab_strategies` — registro: família, capital exigido, venue, direção,
     status (verde/cinza/morta), hipótese declarada
   - `lab_runs` — cada rodada: estratégia, janela, capital usado, parâmetros,
     início/fim, motivo de falha
   - `lab_results` — resultado: líquido, bruto, trades, tombo, amostra,
     veredito, por-símbolo
   - `lab_capital` — histórico de alocação, com motivo escrito
3. **Capital declarado no `desks.ts`** — cada mesa passa a declarar
   `capitalRequiredUsd` e o motivo. Teste de guarda impede mesa sem declaração.
4. **Casca do painel** — um lugar só, com abas por família. Nada empilhado.

**Entregue:**

| item | estado |
|---|---|
| Índice de docs reconstruído e conferido mecanicamente | ✅ 51 arquivos, todos indexados |
| Migração `0020_strategy_lab.sql` aplicada | ✅ `lab_strategies`, `lab_runs`, `lab_results`, `lab_capital_log` |
| RLS default-deny nas quatro | ✅ verificado: `rls_on = true`, `policies = 0` |
| Tipos no `Database` | ✅ nenhuma tabela nova acessada com `any` |
| Registro das 26 estratégias | ✅ `src/lib/lab/registry.ts`, com capital e porquê |
| Gravador com ciclo start → finish/fail | ✅ `src/lib/lab/store.ts` |
| Capital declarado nas 24 mesas antigas | ✅ `desks.ts` ganhou `capitalRequiredUsd` + `capitalWhy` + `subtitle` |
| Testes de guarda | ✅ 17 no registro, 6 nas mesas |
| Painel com abas por família | ✅ `LabPanel.tsx`, primeiro da aba LAB |

**Decisões do dono aplicadas:** mesa aposentada vira arquivo; nome viking
com subtítulo funcional embaixo.

**Três defeitos consertados junto** (achados na auditoria visual): o
patrimônio que ignorava o caixa, o ✓ sem escopo, e o portão aprovando com
amostra zero.

---

### FASE 1 — As mesas que já existem · 🟡 EM ANDAMENTO (05/08)
*"Olhar fundo nelas e dar tudo que elas precisam."*

1. **Recapitalizar** cada mesa viva com o capital que a estratégia exige (não $1.000 para todas).
2. **Consertar o `radar`** — caixa $1.000 com P&L −$13,37 não fecha.
3. **Marcar as cicatrizes** — as mesas Valhalla com caixa perto de zero precisam
   dizer na tela *"cicatriz preservada do vazamento de julho — não é desempenho"*.
   Hoje leem-se como mesa que perdeu tudo.
4. **Aposentar ou justificar** as 12 mesas com zero atividade. Mesa `live` que
   nunca abre é ruído no painel.
5. **Dar short a quem precisa** — as mesas direcionais são long-only, e a
   medição diz que poder vender valeu +45,9 pontos no crash.
6. **Dar janela a quem precisa** — horizonte de 8h para uma mesa de swing é
   medir a coisa errada.

**Entregue nesta rodada:**

| item | estado |
|---|---|
| Invariante novo: contador × posições | ✅ `realizedDrifts()` — pega o `radar` e a classe inteira |
| Diagnóstico do `radar` | ✅ **reset parcial**: 89 posições arquivadas, contador em −$13,37 |
| Arquivo separado das vivas no painel | ✅ botão "🗄 ver o arquivo (N aposentadas)" |
| Aviso de contador divergente | ✅ bloco próprio, separado do desvio de caixa |
| Recapitalização (plano + execução) | ✅ `recapitalize.ts` + rota, **exige motivo em 3 camadas** |

**⚠️ Decisão de desenho registrada:** recapitalizar é **RESET**, não ajuste de
coluna. Mudar `starting_usd` com trades antigos dentro reescreveria o retorno
histórico — uma perda de 2% em $1.000 viraria 0,4% em $5.000 sem nenhum trade
novo. Então arquiva a rodada (nunca apaga) e recomeça com o capital certo.

**Pendente da Fase 1:**
- rodar a recapitalização (é botão, não automático — o dono decide quando)
- dar SHORT às direcionais (hoje são todas `long_only`)
- aposentar ou justificar as 12 mesas com zero atividade

---

### FASE 2 — Filtro de regime (V2) · 🔴
*A prioridade nº 1 do dono, e a única coisa positiva que medimos.*

Direção paga, lateralidade mata. Nas três janelas: mercado a −63% deu +27,7%,
mercado a +0,1% deu +18,5%, mercado a −15% **sem direção** matou todos.

⚠️ **Ressalva registrada:** já levantei uma hipótese de regime antes (o filtro
de clima) e a minha própria medição derrubou. Isto é candidato, não promessa —
e o teste tem que ser **dentro da janela**, não entre janelas, que foi o erro
da primeira vez.

**Critério de conclusão:** o filtro é medido contra a mesma estratégia sem
filtro, na mesma janela, e a diferença é registrada com amostra. Se não
sustentar, é desligado e o motivo é documentado — como foi o clima.

---

### FASE 3 — Funding com janela longa (C5, C6, C7) · 🔴
*A maior incerteza do mapa.*

Nossa medição: **+1,4% ao ano** de mediana. A literatura vende **5–20%**.
Uma das duas está errada e o desfecho muda o produto.

O que muda em relação à medição de 04/08:
- janela de **360 dias**, não 30–60 (a gate.io limitou a fonte)
- **capital de $2.000**, com as 4 pernas cobradas de verdade
- **basis de entrada e saída** medido, não declarado como "fora da conta"
- comparação contra **sUSDe**, que empacota a mesma coisa

**Critério de conclusão:** número com 360 dias de amostra e o basis dentro da
conta. Se der 8%, vira produto; se der 1,4%, vira ruído documentado.

---

### FASE 4 — Rendimento integrado (C1, C2, C3, C4) · 🔴
*A coisa mais fácil com retorno real e positivo — resolve o peixe pequeno hoje.*

Não exige achar borda nenhuma. Aave rende 3,5–9%; tesouro tokenizado 3,3–8%.
O que precisa ser medido é o que **ninguém publica**: o gás e o custo de entrada
comem quanto disso, por faixa de capital.

**Critério de conclusão:** tabela de rendimento LÍQUIDO por faixa de capital
($500 / $5k / $50k), com o gás dentro. É essa tabela que vira produto.

---

### FASE 5 — Venda de opção coberta (C8) · 🔴
IV de 50–80% no BTC contra 15–20% do S&P é o prêmio mais gordo e
estruturalmente persistente deste mercado. Nunca medimos.

**Critério de conclusão:** prêmio capturado menos o custo da perna exercida,
com a cauda medida — não a média.

---

### FASE 6 — DEX ↔ CEX (C11) · 🔴
O único terreno com vantagem estrutural: o tempo de bloco cria janela lenta
por construção, e metade da infraestrutura já existe.

⚠️ **Aviso registrado:** MEV compete pesado e a resposta pode ser a mesma das
outras arbitragens. Medir com o mesmo rigor: pedágio, profundidade, gás.

---

### FASE 7 — Automação por API do cliente · 🔴
*Maior salto de receita, sem custódia.*

Chave com permissão de **negociar mas não sacar**. Depende de tudo que as
fases 2–6 produzirem — automatizar estratégia não medida é vender ruído.

---

### FASE 8 — As cinzas restantes · 🔴
C9, C10, C12–C20. Cada uma com capital próprio e mesa própria.

---

### FASE 9 — Receita (C21, C22) · 🔴
Rebate de corretora e rev-share de protocolo. Não é trade, é dinheiro na mesa.

---

## 4. REGRAS QUE VALEM PARA TODAS AS FASES

Cicatrizes desta semana, transformadas em regra:

1. **Capital declarado, nunca herdado.** Toda mesa declara quanto precisa e por quê.
2. **Amostra abaixo do limiar não vira número.** Inconclusivo ≠ aprovado.
3. **O que não foi medido vai para a TELA**, não só para o comentário.
4. **A falha grava.** Rodada que morre deixa rastro com o motivo e o status.
5. **`await` no `recordEvent`.** Em serverless, sem isso o insert perde a corrida.
6. **Agregado sem parcela não é auditável.** Grava-se o por-símbolo sempre.
7. **Uma definição por conceito.** Mediana, correlação, custo — uma função, um lugar.
8. **Mede antes de promover.** Vale para venue nova, para trava e para mesa.
9. **Toda mesa é julgada contra comprar-e-segurar** na mesma janela.
10. **Ranking exige piso de amostra**, senão elege o não-fazer-nada.

---

## 5. PAINEL — o que "premium" significa aqui

O dono: *"nada de amontoar uma informação em cima da outra, nada de UI
ilegível, quero algo Premium e digno do que estamos construindo."*

Traduzido em regra:

- **Uma família por aba.** Carrego, direcional, estrutura, liquidez, primário —
  não uma lista de 26 painéis.
- **Veredito antes do número.** Placar antes do veredito convida a ler retorno
  como aprovação — foi assim que os +34% duraram três semanas.
- **Três estados visuais**: medido-positivo, medido-negativo, **não medido**.
  Não medido é CINZA, não âmbar: ausência de informação não é aviso.
- **Capital sempre visível.** Um resultado sem o capital que o produziu não é
  comparável.
- **Amostra sempre visível.** Número sem `n` é opinião.

---

## 6. ESTADO

| Fase | Status |
|---|---|
| 0 · Fundação | 🟢 **concluída 05/08** |
| 1 · Mesas existentes | 🟡 **em andamento** |
| 2 · Filtro de regime | 🔴 |
| 3 · Funding janela longa | 🔴 |
| 4 · Rendimento integrado | 🔴 |
| 5 · Opção coberta | 🔴 |
| 6 · DEX ↔ CEX | 🔴 |
| 7 · Automação por API | 🔴 |
| 8 · Cinzas restantes | 🔴 |
| 9 · Receita | 🔴 |

Atualizar este quadro a cada entrega — regra da casa.
