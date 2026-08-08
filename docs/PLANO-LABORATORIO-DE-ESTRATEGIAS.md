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

### FASE 1 — As mesas que já existem · 🟢 CONCLUÍDA (06/08)
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

### As mesas paradas — diagnóstico, e ele inverte a conclusão óbvia

A leitura fácil seria "12 mesas ociosas, aposenta". O dado diz outra coisa, e
as três categorias exigem ações opostas:

**1. URÐR está CORRETA em não operar.** 142 ticks, 15 com oferta, e nas 15
`vetoedByRecord: 1`. A mesa cujo mandato é escolher pelo histórico MEDIDO
recebeu candidatos e recusou todos — porque o histórico da biblioteca é
negativo. **Ela é a única mesa fazendo o que deveria.** Aposentá-la seria
desligar o único agente que se recusa a operar uma biblioteca que mede
negativo.

> ⚠️ Eu quase errei isto. Olhei UM tick, vi `offered: 0`, e ia reportar "a
> mesa está desconectada". Com os 142 a resposta é o contrário. Um tick não
> é uma amostra.

**2. Três aposentadas estão sem caixa** (grok $0,00, deepseek $0,40,
oracle_mistral $9,80 — piso de $25). Não operam mesmo; é a cicatriz.

**3. FREYJA, ULLR e oracle_grok não emitem NADA.** Zero posições na
existência inteira **e zero eventos de tick**. Não dá para saber se rodam e
não acham nada, ou se não rodam. **Não se aposenta o que não se consegue
diagnosticar** — elas precisam de evento de tick antes de qualquer veredito.

### Fase 1 — placar final

| item | estado |
|---|---|
| Invariante contador × posições (`realizedDrifts`) | ✅ pega o `radar` e a classe |
| Arquivo separado das vivas | ✅ botão, com a cicatriz explicada |
| Recapitalização — módulo, rota e **UI** | ✅ motivo em 4 camadas (UI, rota, módulo, banco) |
| SHORT nos playbooks | ✅ **medido e REPROVADO** — 9 de 9 negativos nos dois lados |
| Tick da FREYJA e do ULLR | ✅ rodavam e descartavam o diagnóstico |
| Leitura do silêncio (`silence.ts`) | ✅ 5 estados, 10 testes |
| `oracle_grok` | ✅ **não era caso** — é valhalla, silêncio esperado |

**Único item que fica para o operador:** apertar o botão da recapitalização.
Não é automático de propósito — ver a nota em `paper/recapitalize.ts`.

**Pendente pequeno:** ligar o `silence.ts` no painel. Precisa que os ticks
novos (`strat_dex_tick`, `ullr_tick`) acumulem antes de haver o que mostrar.

### ✅ O SHORT FOI MEDIDO E REPROVADO (06/08)

O dono rodou o backtest, o espelho passou a existir gravado, e a resposta é
inequívoca — **os nove playbooks são negativos nos DOIS sentidos**:

| playbook | n | long | espelho (short) |
|---|---|---|---|
| absorption | 16 | −0,963% | **−0,427%** |
| range_reversion | 25 | −1,173% | −0,532% |
| support_accumulation | 41 | −0,877% | −0,549% |
| pivot_reversion | 87 | −0,151% | −0,792% |
| trend_continuation | 53 | −0,905% | −0,821% |
| breakout_retest | 43 | −0,305% | −0,844% |
| range_breakout | 33 | −0,087% | −0,870% |
| capitulation_reversal | 11 | −1,805% | −0,879% |
| trend_pullback | 46 | −0,849% | **−1,058%** |

**⚠️ A RESSALVA, e ela é grande o bastante para mudar o tom da conclusão.**

A soma média `long + espelho` é **−1,543%**. Custo puro seria **−0,400%**
(duas idas e voltas a 0,2%). Os **−1,143%** de excesso vêm da convenção de
straddle: vela que toca alvo E stop registra o STOP nos dois lados, então um
straddle é perda em dobro **por construção, não por decisão do mercado**.

Ou seja: **três quartos do "os dois lados perdem" é a nossa convenção
pessimista.** A frase honesta não é "vender perde" — é "vender não produz
positivo convincente, e o teste não distingue bordas pequenas".

**Mesmo assim a decisão se sustenta:** o melhor espelho é −0,427% com n=16
(abaixo de qualquer limiar), e creditando de volta metade do excesso ainda
não se chega a positivo com amostra. E a correlação long×espelho é **−0,18**
— quase nula: a biblioteca **não tem viés de lado errado, ela tem custo maior
que a borda**.

> ⚠️ **O que isto NÃO mata:** os +45,9 pontos que a venda valeu no crash foram
> medidos na **média móvel de 50**, não nesta biblioteca. São sinais
> diferentes. O short segue vivo em `trend_ma50_long_short`, que é uma
> estratégia do laboratório, não um playbook.

Registrado como `playbook_short` com status **morta** e o motivo escrito.

---

### O histórico: como o short ficou bloqueado antes disso

O motor de paper JÁ suporta venda ponta a ponta: `canEnter` valida os dois
lados, `computeExit` usa `dir = side === "buy" ? 1 : -1`, e o P&L respeita o
sinal. O bloqueio é só o `buildBracket`, que fixa `side: "buy"` e rejeita
geometria invertida — de propósito e documentado.

Antes de destravar, fui ler o resultado do **teste espelho** (`inverseNetPct`:
para cada trade, a posição refletida resolvida contra as mesmas velas). É
exatamente o número que responde "vale dar short a estas mesas?".

**E não havia o que ler.** O espelho é calculado desde 03/08, aparece na tela
do backtest, e nunca chegou à foto do `playbook_record`.

Quarta vez que este defeito aparece — e desta vez ele quase me fez construir
capacidade de venda por palpite, na semana em que a regra virou "mede antes de
construir". Corrigido em 05/08; o short espera **uma rodada do backtest** para
o espelho existir gravado.

---

### FASE 2 — Filtro de regime · 🔴 HIPÓTESE REFUTADA (06/08)
*A prioridade nº 1 do dono, e a única coisa positiva que medimos.*

Direção paga, lateralidade mata. Nas três janelas: mercado a −63% deu +27,7%,
mercado a +0,1% deu +18,5%, mercado a −15% **sem direção** matou todos.

⚠️ **Ressalva registrada:** já levantei uma hipótese de regime antes (o filtro
de clima) e a minha própria medição derrubou. Isto é candidato, não promessa —
e o teste tem que ser **dentro da janela**, não entre janelas, que foi o erro
da primeira vez.

### O resultado: a hipótese caiu INVERTIDA

Nada foi construído. A quebra `byRegime` já era medida — **DENTRO da janela**,
que era a exigência — e ela respondeu antes de existir código:

| regime | n | líquido por trade |
|---|---|---|
| TRANSITIONING | 33 | −0,408% |
| **RANGING** (lateral) | **176** | **−0,446%** |
| **TRENDING_UP** (tendência) | **135** | **−0,777%** |
| TRENDING_DOWN | 11 | −1,805% |

**A lateralidade é o MELHOR terreno desta biblioteca, não o pior** — por 0,33
ponto, com amostra boa nos dois lados.

Faz sentido depois de dito: **cinco dos nove playbooks são reversão à média**
(range_reversion, pivot_reversion, support_accumulation, capitulation_reversal,
absorption), e reversão precisa de FAIXA, não de tendência. Um filtro "só opere
com direção" bloquearia justamente o terreno onde ela perde menos.

**E não salvaria nada:** filtrar para RANGING+TRANSITIONING melhora de −0,610%
para −0,440% por trade e custa **41% dos trades**. Continua negativo.

### ⚠️ O que isto NÃO refuta

Os **+27,7%** do crash foram da **média móvel de 50**, que é seguidora de
tendência e obviamente precisa de tendência. São estratégias **opostas** — o
regime certo para uma é o errado para a outra. `trend_ma50_long_short` segue
viva e ainda vai ser medida com capital próprio.

### Segunda vez que uma hipótese de regime minha cai

A primeira foi o filtro de clima, refutado em 04/08. A ressalva que eu tinha
registrado — *"isto é candidato, não promessa"* — se provou necessária pela
segunda vez.

**A hipótese fica gravada ao lado do motivo da reprovação**, com teste
exigindo as duas. Apagar a previsão deixaria só a conclusão, e conclusão sem a
previsão que ela derrubou é exatamente o que permite reescrever a previsão
depois do resultado.

### E o defeito que apareceu no caminho (o quinto)

`byRegime` está no tipo `PlaybookRecordEntry` desde sempre, o registro ATUAL o
grava, e a **foto histórica o descartava** — junto com o espelho, consertado no
dia anterior pelo mesmo motivo. Sem histórico não dá para saber se a diferença
entre regimes é estável ou se é a foto de hoje. Corrigido.

---

### FASE 3 — Funding com janela longa · 🟢 MEDIDA (06/08)
*A maior incerteza do mapa — e ela ficou de pé.*

## ⚖️ O VEREDITO

**Os 5–20% publicados não reproduzem. O nosso +1,4% praticamente sim.**

| | 04/08 (rodada ruim) | 06/08 (com a janela certa) |
|---|---|---|
| Símbolos com amostra | 11 de 53 | **50 de 53** |
| Janela entregue | 30–60 dias | **94 dias (mediana)** |
| Fonte | gate.io ×53 | **okx ×50**, gate.io ×3 |
| Líquido mediano/ano | +1,42% (bruto) | **+1,16% (líquido)** |
| Positivos no ano | 1 | **23 com negativo raro** |

Vinte e três dos cinquenta rendem positivo no ano com funding negativo em menos
de 35% dos períodos, e **a mediana dessa cesta é +3,0%/ano** — TAO +6,7%,
NEAR +5,8%, CRV +5,7%. A cauda ruim é funda: BONK −17,8%, TRX −12,6%.
ρ=0,067, então os 50 valem **11,7 apostas independentes** — correlação baixa,
que é a boa notícia menos esperada da rodada.

### O sinal mais forte não está na mediana, está na janela

| janela entregue | n | mediana líquida/ano |
|---|---|---|
| 187 dias | 10 | **+0,70%** |
| 94 dias | 40 | +1,35% |
| 30 dias | 3 | **+7,90%** |

Monotônico: **janela mais longa, número menor.** É exatamente o que a hipótese
"os 5–20% publicados são recorte de regime" prevê, e é o oposto de "só falta
mais dado para o número grande aparecer". Com n=10 no grupo longo não fecha
nada sozinho — mas a direção é a que aponta contra nós, que é a única direção
em que um sinal fraco ainda vale ser dito.

### Conclusão de produto

Funding é **renda real e selecionável, com teto de ~3%/ano na cesta.** Ela não
compete com a promessa de 20%; compete com o **Tesouro tokenizado** (`tokenized_treasury`,
prioridade nº 3 do dono, ainda não medido), que paga faixa parecida sem quatro
pernas, sem perna vendida e sem risco de liquidação. A Fase 4 tem que medir os
dois no mesmo pé antes de qualquer um virar produto.

`funding_basis` passa a **VERDE** no registro.

---

## O que a rodada expôs de defeito nosso

**1. A régua do veredito não estava na tela.** `netAnnualizedPct` era calculado,
gravado em `lab_results` e **não renderizado**. O destaque ia para o líquido da
JANELA (+0,04%) e para o anualizado BRUTO (+1,6%) — o número que julgava era um
terceiro que ninguém via. Agora ele é o primeiro e o maior.

**2. "Positivos" e "robustos" eram contados com duas réguas.** Na mesma resposta:

```
veredito:  "23 de 50 rendem positivo no ano"      ← netAnnualizedPct
resumo:    "positivos no líquido: 26/50 · robustos 22"  ← netPct da janela
```

Três números, duas réguas, nenhum rótulo. O veredito já usava o anual — foi a
correção de 04/08 — e o resumo logo abaixo continuou contando pela régua que
aquela correção aposentou. Mesma família da mediana de onze pontos, agora
dentro do mesmo JSON. Existe **uma** `fundingCounts` agora; a outra pergunta
ganhou nome próprio (`pagaramNaJanela`).

**3. VERDE aprovava com um símbolo.** Era `robustos > 0`. Um nome em cinquenta
marcaria a rodada como verde — a mesma forma do portão de lançamento que
aprovava com n=0. Piso de 10 declarado como palpite, **e escrito depois de ver o
dado (23), então como teste desta rodada não vale nada** — vale para as próximas.

**4. "Eu cortei" e "a fonte acabou" eram a mesma mensagem.** Pedimos 360 dias e
recebemos 94 com `paginacaoCortada = false`: o relógio não estourou, a paginação
rodou até o fim, o histórico público da okx simplesmente termina ali. Quarenta
símbolos parando no **mesmo** 94º dia é assinatura de corte da fonte — o nosso
cortaria em múltiplos de 100 períodos e variaria por símbolo. As ações são
opostas: paginação cortada se resolve rodando de novo, teto de fonte não se
resolve. `fonteEsgotada` agora é campo próprio, em âmbar, dizendo **"rodar de
novo não muda"**.

### O que isso implica para a Fase 4 em diante

Um ano de funding **não existe para ser lido** — nem na okx, nem na gate.io, e
binance (451) e bybit (403) seguem recusando nosso IP. Se quisermos janela
longa, ela tem que ser **acumulada por nós**, dia a dia, numa tabela própria. É
decisão de infraestrutura, não de medição, e está registrada aqui para não ser
redescoberta clicando o botão pela quarta vez.

---

## O plano original desta fase, para conferência

Nossa medição: **+1,4% ao ano** de mediana. A literatura vende **5–20%**.
Uma das duas está errada e o desfecho muda o produto.

O que muda em relação à medição de 04/08:
- janela de **360 dias**, não 30–60 (a gate.io limitou a fonte)
- **capital de $2.000**, com as 4 pernas cobradas de verdade
- **basis de entrada e saída** medido, não declarado como "fora da conta"
- comparação contra **sUSDe**, que empacota a mesma coisa

### O defeito que travava tudo em 60 dias

Antes de aumentar a janela, achei por que a de 174 nunca foi entregue. A
cascata de fontes parava assim que juntava a amostra **mínima**:

```
if (melhor.length >= PERIODOS_MINIMOS) break;   // 60 dias
```

Eu tinha consertado a regra "primeira fonte que responde" em 04/08 e deixei a
condição de parada apontando para o mínimo. **Mesmo defeito com outra roupa:**
uma fonte curta calando as demais, agora com a justificativa de que "já deu o
suficiente".

Mínimo é o piso para o número VALER. Alvo é o que se pediu. A parada tem que
olhar para o alvo.

Junto disso, a okx paginava **3 páginas fixas** = 100 dias, escrito quando o
alvo era 174 — número de página constante com janela variável pede 360 e
recebe 100, em silêncio. Agora é derivado do alvo.

### O que mudou

| item | antes | agora |
|---|---|---|
| Janela | 174 dias | **360 dias** |
| Parada da cascata | mínimo (60d) | **alvo (360d)** |
| Páginas okx | 3 fixas | derivado do alvo, teto 15 |
| Corte por tempo | invisível | **`paginacaoCortada` na tela, em vermelho** |
| Janela entregue | não mostrada | **ao lado da pedida**, verde/âmbar |
| Registro | `platform_events` solto | **`lab_runs` + `lab_results`** |

O capital vai gravado no momento ($2.000, do registro), e a rodada abre com
status `rodando` ANTES de buscar — se a função morrer, a linha fica dizendo que
começou e não voltou, em vez de a rodada não existir.

### Ainda NÃO medido, e declarado

- **basis de entrada/saída** — exige histórico de mark contra spot alinhado;
  típico <0,05% nos dois sentidos, então deixá-lo fora é neutro, não otimista
- risco de liquidação da perna vendida
- custo de margem além do funding, e custódia

### Critério de conclusão — e como ele foi cumprido pela metade

Era: *"número com 360 dias entregues (não pedidos) e a janela real visível. Se
der 8%, vira produto para as três faixas; se der 1,4%, vira ruído documentado."*

**Os 360 dias não foram entregues e não podem ser** — a fonte tem teto de ~94
dias. A janela real está visível, que era a outra metade e a que importava. O
número deu +1,16%, ou seja o ramo "1,4%" do critério: **não é ruído** (23 nomes
robustos, cesta a +3,0%/ano), mas também **não é o produto de 8%** que
justificaria construir em cima dele antes de medir o Tesouro tokenizado.

⚠️ O critério foi escrito assumindo que janela é coisa que se pede. Não é —
é coisa que a fonte concede. Os próximos critérios de conclusão têm que
declarar o que fazer quando a fonte não entrega, em vez de só quando o número
sai diferente do esperado.

---

### FASE 4 — Rendimento integrado (C1, C2, C3, C4) · 🟡 CONSTRUÍDA, PRONTA PARA RODAR
*A coisa mais fácil com retorno real e positivo — resolve o peixe pequeno hoje.*

Não exige achar borda nenhuma. Aave rende 3,5–9%; tesouro tokenizado 3,3–8%.
O que precisa ser medido é o que **ninguém publica**: o gás e o custo de entrada
comem quanto disso, por faixa de capital.

**Critério de conclusão:** tabela de rendimento LÍQUIDO por faixa de capital
($500 / $5k / $50k), com o gás dentro. É essa tabela que vira produto.

## Verificação de estado — o que já existia (06/08)

| setor | achado |
|---|---|
| Fonte de rendimento | **nada.** `defillama.ts` só busca volume agregado de DEX (`api.llama.fi/overview/dexs`). Nenhuma leitura de APY em lugar nenhum do repo. |
| Custo de gás | **existe e é medido**: `li.quest/v1/quote` já roda em produção e devolve `gasCosts[].amountUSD` — gás real em dólar, por cadeia. |
| Endereços de USDC | `src/lib/tokens.ts`, as 7 cadeias EVM + Solana |
| Gravação | `lab_runs`/`lab_results` da Fase 0 servem sem mudança de schema |
| Painel | `LabPanel` já lê `lastNetAnnualizedPct` — medição nova aparece sozinha |

⚠️ **`api.llama.fi` funcionar NÃO prova que `yields.llama.fi` funciona.** Mesmo
sobrenome, host diferente — é exatamente a distinção que me fez escolher a Bybit
por evidência falsa (`fapi.binance.com` × `data-api.binance.vision`). A rota
grava o status de CADA host e mostra na tela; se der 403, a primeira rodada diz
qual, em vez de "nenhum dado".

## As decisões desta fase, e por que cada uma

**1. Piscinas DECLARADAS, nunca "as de maior APY".** Ordenar por rendimento
seleciona token de fazenda e sobrevivente — as que quebraram não estão na lista
para baixar a média. A lista fica em código, passa por PR, e o que ela não achou
**aparece na tela** como não encontrado.

**2. `apyBase` manda; `apyReward` aparece ao lado e NUNCA soma no titular.**
Rendimento de recompensa é pago num token que pode cair 80% antes de você
vender. É a mesma regra do "quando houver dúvida, o menor" que fez `grossPct`
ser soma e não composição.

**3. `apyMean30d` preferido, e a ausência dele não vira APY à vista em
silêncio.** APY de piscina de empréstimo dispara com uma alavancada e volta em
horas. Sem os 30 dias, a linha diz "à vista" na tela.

**4. O custo de entrada é MEDIDO, não constante.** Cotação real da LI.FI de
USDC → ativo alvo, em cada faixa de capital: o impacto e a taxa saem da resposta
e o gás vem em dólar dentro da mesma cotação. Constante de gás seria eu
inventando o número que a fase existe para descobrir.

**5. Âncora em USDC, e para o C1 não há troca.** Quem entra em empréstimo de
stablecoin já tem stablecoin — o custo dele é só gás de `approve` + `supply` +
`withdraw`. O número de transações é constante DECLARADA e rotulada como
estimativa; o preço de cada uma é medido.

**6. As faixas incluem o capital declarado da estratégia.** $500 / capital
declarado / $5.000 / $50.000. Sem isso o titular seria interpolação entre duas
faixas medidas, e interpolação apresentada como medição é o defeito que esta
empreitada inteira ataca.

**7. `funding_basis` entra na MESMA tabela.** A Fase 3 entregou +3,0%/ano na
cesta selecionada. Se o Tesouro tokenizado pagar isso sem quatro pernas, sem
perna vendida e sem risco de liquidação, o carrego de funding perde a razão de
existir no produto — e essa comparação só vale com o mesmo capital e a mesma
conta de custo.

### O que esta fase NÃO mede, declarado

- risco de contrato (auditoria, tempo em pé, concentração de custódia)
- risco de despegue do ativo (USDM, USDY e stETH já negociaram abaixo da paridade)
- corte no staking e no restaking — o C4 empilha uma camada a mais
- imposto, e ele é o maior custo isolado para o peixe pequeno em quase toda jurisdição
- fila de saque: stETH e o Tesouro tokenizado têm resgate com prazo, e prazo é custo
- ⚠️ **o custo de troca é cotado contra o token nativo**, o par mais líquido da
  cadeia. Entrar em USDY, USDM ou weETH custa MAIS que isso — então o líquido
  das três estratégias que exigem troca é **TETO, não medição**

### O que foi construído

| peça | onde |
|---|---|
| Fonte de APY, cascata com status por host | `src/lib/api/defillama-yields.ts` |
| A conta (escolha do APY, custo por faixa, veredito) | `src/lib/lab/rendimento.ts` + 26 testes |
| Rota que junta APY medido com custo medido | `src/app/admin/api/rendimento/route.ts` |
| Painel 🏦 | `RendimentoPanel.tsx` + registro em `modules.ts` |

Quatro estratégias, **quatro rodadas separadas** em `lab_runs`/`lab_results`,
cada uma com o seu capital declarado. Uma rodada só com as quatro somadas seria
a mistura que o dono proibiu, e impediria o painel de dizer qual delas vive.

### Três defeitos meus que a revisão da própria entrega pegou

**1. Escrevi `s[Math.floor(n/2)]` de novo.** A mesma linha que causou a
discordância de onze pontos e que fez `stats.ts` existir. Com `n` par devolve o
superior do meio, e o erro tem SINAL: sempre para cima. Trocado por `median`, e
há teste com amostra PAR justamente para isso.

**2. A cadeia escolhida era a da maior piscina — ou seja, a Ethereum.** Para o
empréstimo de stablecoin isso faria o C1 fechar NEGATIVO em $500 e a fase
concluir "não serve para o peixe pequeno", quando a resposta é **"serve, na
Base"**. Seria matar um produto bom com uma escolha de roteamento que nem é a
que faríamos. Agora é a mais barata **por faixa**, e a cadeia aparece na linha.

**3. As cotações eram sequenciais: 28 chamadas em fila, ~42s numa função de
60.** O `deadline` cortaria no meio e devolveria uma tabela parcial — a janela
curta silenciosa do funding reencarnada em outra rota, três dias depois de eu a
consertar. Cadeias em paralelo agora.

## A primeira rodada (06/08) — e o que ela quebrou

`yields.llama.fi` respondeu de primeira; a dúvida do host caiu. Os dados de
rendimento são reais e conferíveis (Lido 2,20%, BUIDL 3,51%, USDY 3,55%,
OUSG 3,47%). **A resposta que a Fase 3 pediu apareceu:**

| | líquido 1º ano | pernas | risco extra |
|---|---|---|---|
| **Empréstimo de stablecoin** | **+3,23%** | 3 tx de gás | — |
| **Tesouro tokenizado** | **+3,10%** | 1 ida e volta | emissor |
| **Funding / cash-and-carry** | **+1,16%** | **4 pernas** | liquidação da perna vendida |
| Staking líquido | +1,88% | 1 ida e volta | fila de saque |

O funding perde para a alternativa mais simples — exatamente o risco levantado
ao fechar a Fase 3.

### Quatro defeitos, e todos meus

**1. Custo NEGATIVO no restaking.** −0,40% em todas as cinco faixas, líquido
(2,89%) **maior que o bruto** (2,49%), equilíbrio de **−58 dias**, e veredito
VERDE em cima disso. Entrar e sair não pode pagar você. A causa é o `priceUSD`
dos dois lados da troca discordarem ~0,4% na fonte.
→ custo achatado em zero **com bandeira**; zero também é mentira e empurra o
líquido para cima, então a leitura vira INCONCLUSIVO. `equilibrioDias` devolve
null com custo negativo. E `liquidoPrimeiroAnoPct` afirma a invariante
"líquido ≤ bruto" na própria função, não em quem a chama.

**2. Gás não lido é idêntico a gás barato.** O custo mal se mexeu entre $500 e
$50.000 — o que se lê como *"o gás deixou de ser barreira"*, que seria a
refutação da hipótese central desta fase. Só que `gasDaCotacao` devolve null
quando `gasCosts` vem vazio, e o `gasUsd` virava **zero em silêncio**. As duas
leituras davam a mesma tela e eu não tinha como separá-las.
→ `cotacoesComGas`/`cotacoes` por cadeia, na tela; sem gás lido, INCONCLUSIVO.

**3. Amostra inflada.** "12 piscinas" no Tesouro tokenizado eram **BUIDL contado
seis vezes** (Ethereum ×2, Polygon, Solana, Avalanche, Arbitrum) com o mesmo
3,5%. No restaking: 3 piscinas, das quais **duas eram o mesmo `ether.fi-stake`**
em duas cadeias — duas taxas passando por um piso de três.
→ `produtosDistintos` (emissor+ativo, ficando a de maior depósito). O piso, o
`sample_n` e a **mediana** passam a correr sobre produtos. É a lição do ρ do
funding com outra roupa: o mesmo emissor em seis cadeias tem UMA taxa.

**4. A medição de funding foi um replay.** `1.1611632422330422` às 01h34 e
`1.1611632422330422` às 10h21 — dezesseis dígitos idênticos, nove horas depois,
numa fonte que paga a cada 8h. O `revalidate: 3600` serviu cache e a linha em
`lab_runs` ficou igual à de uma medição de verdade. **O dono apertou o botão,
não mediu nada, e não tinha como saber.**
→ `no-store` nas buscas de funding, e `ultimoPontoEm` na tela: duas rodadas com
o mesmo carimbo leram o mesmo dado.

Três dos quatro são a mesma forma — **dois estados diferentes com a mesma
aparência** — que é o padrão que esta semana já achou seis vezes. Desta vez
dentro de código que escrevi no mesmo dia.

## A segunda rodada (06/08) — as travas funcionaram

| | antes | depois |
|---|---|---|
| restaking | VERDE, custo −0,40%, líquido 2,89% > bruto 2,49% | **CINZA — 2 produtos (3 implantações), INCONCLUSIVO** |
| Tesouro tokenizado | 12 piscinas, `sample_n` 12 | **5 produtos**, mediana 3,51% → **3,47%** |
| funding | `1.1611632422330422` (replay) | **`1.1769…`** — dado fresco |
| gás | não se sabia se foi lido | **`gasLido: true` nas quatro** |

⚠️ **A hipótese central da Fase 4 está REFUTADA por medição, não por falha de
leitura.** O gás foi lido e é desprezível: com L2, entrar com $500 custa
praticamente o mesmo que com $50.000. O custo fixo deixou de ser a barreira que
eu supus — e o empréstimo de stablecoin fecha em **+3,40%/ano líquido** contra
**+1,18%** do funding.

### O que a correlação de 7% quer dizer, e ela é a linha mais importante da tela

ρ=0,07 parece boa notícia e é uma armadilha: `50 / (1 + 49×0,07) = 11,3`.
**Cinquenta nomes viraram doze apostas.** Dobrar para cem daria ~14, não 100 —
correlação minúscula destrói diversificação quando N é grande. Os "23 robustos"
são ~5,5 rendas independentes, e o tombo de 4,74% se comporta como carteira de
doze.

**Consequência de produto: adicionar moeda não é a alavanca.** A alavanca é
janela maior, ou renda com motor diferente. O empréstimo de stablecoin paga por
demanda de CRÉDITO, não por posicionamento — combinar os dois diversifica de
verdade; o 51º perpétuo não faz nada.

---

## A varredura que o dono pediu: "está cometendo o mesmo erro em todas as mesas?"

Sim. **Três painéis, a mesma forma** — a tabela afirma mérito e esconde o que
sustentaria a afirmação.

| painel | o que estava errado |
|---|---|
| **FUNDING** | ordenava por `netPct`, a régua **aposentada em 04/08**, enquanto a coluna que decide era a primeira e em negrito. E os 3 símbolos que o veredito EXCLUIU estavam na tabela: **VET +9,9%/ano em 30 dias** era o maior número da tela |
| **O QUE FUNCIONOU** | `avgTrades` calculado na rota, tipado no painel, **nunca desenhado**. 2 trades e 200 trades indistinguíveis |
| **CARTEIRAS PAPER** | dá **medalha 🥇🥈🥉** por retorno, e `closedTrades` só aparecia ao expandir a linha |

Todos os três violavam a **regra nº 5 do próprio laboratório** — "AMOSTRA SEMPRE
VISÍVEL" — escrita no cabeçalho do `LabPanel`. Ela existia em comentário, e
comentário não reprova pull request.

**A trava:** `src/app/admin/tabela-com-amostra.test.ts` lista as tabelas que
ranqueiam e exige a coluna de amostra em cada uma, mais as duas metades
específicas do funding (ordem pela régua certa, piso separando o ranking). A
trava foi verificada por mutação: removi a coluna e ela reprovou.

**Pendente: rodar o 🏦 e o 🪙 de novo, agora com as travas.** As linhas de 06/08
que estão no banco não devem ser lidas como medição: o restaking está inflado
pelo custo negativo, e as amostras de Tesouro e restaking estão infladas por
implantação.

⚠️ **A Fase 3 mudou o que esta fase decide.** O funding entregou +1,16%/ano de
mediana e +3,0%/ano na cesta selecionada — faixa que **o Tesouro tokenizado
cobre sem quatro pernas, sem perna vendida e sem risco de liquidação**. Então
esta fase não mede só "quanto o gás come": ela mede se o carrego de funding tem
alguma razão de existir no produto ao lado de uma alternativa mais simples com
retorno parecido. As duas na mesma tabela, mesmo capital, mesma janela — senão
a comparação mede duas coisas, que é a regra do duelo VÖLUNDR × MÍMIR.

⚠️ **E a janela tem que ser acumulada, não pedida.** A Fase 3 provou que
histórico longo de funding não existe para ler (okx ~94d, gate.io ~30d,
binance 451, bybit 403). Se o produto precisa de um ano, o ano se constrói aqui,
dia a dia, em tabela própria.

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
| 1 · Mesas existentes | 🟢 **concluída 06/08** |
| 2 · Filtro de regime | 🔴 **hipótese refutada 06/08** |
| 3 · Funding janela longa | 🟢 **medida 06/08** — +1,16%/ano, cesta a +3,0%; os 5–20% não reproduzem |
| 4 · Rendimento integrado | 🟡 **construída 06/08** — falta o dono rodar o 🏦 |
| 5 · Opção coberta | 🔴 |
| 6 · DEX ↔ CEX | 🔴 |
| 7 · Automação por API | 🔴 |
| 8 · Cinzas restantes | 🔴 |
| 9 · Receita | 🔴 |

Atualizar este quadro a cada entrega — regra da casa.
