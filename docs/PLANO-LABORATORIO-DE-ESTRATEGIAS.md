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

## ⚠️ ANTES DE COMEÇAR QUALQUER FASE

Ler **[`INVARIANTES-DE-MEDICAO.md`](INVARIANTES-DE-MEDICAO.md)** — as 20 regras
que qualquer medição deste laboratório respeita, cada uma com a cicatriz que a
gerou.

Ele nasceu em 09/08 porque a trava de *"custo não pode ser negativo"* da Fase 4
não foi aplicada na Fase 6, onde o mesmo defeito voltou como *"ida e volta não
pode ganhar"* — e passou. As notas de cada fase ficam viradas para o passado;
aquela lista é a mesma coisa virada para a frente.

**A pergunta a fazer para cada item: "esta invariante tem uma versão nesta
fase?"** A nº 2 é a nº 1 com outro nome, e foi assim que ela escapou.

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

### FASE 4.5 — Combinar as verdes · 🟡 EM CONSTRUÇÃO (08/08)
*A única coisa que a correlação diz que funciona.*

A Fase 4 respondeu mais do que se propôs a medir. **O gás não é a barreira** —
foi lido (`gasLido: true`) e é desprezível com L2. **A correlação é.** ρ=0,07
transforma 50 nomes em 12 apostas, e a conta é implacável: dobrar para 100
moedas daria ~14. Adicionar o 51º perpétuo não faz nada.

O que a correlação diz que FUNCIONA é combinar rendas com **motores
diferentes**: funding paga por *posicionamento*, empréstimo de stablecoin paga
por *demanda de crédito*, Tesouro tokenizado paga por *juro soberano*, staking
paga por *emissão do protocolo*. Quatro causas, não quatro sabores da mesma.

## Verificação de estado (08/08)

| setor | achado |
|---|---|
| Série histórica de APY | **não existe no repo.** `/pools` dá só o instante. `yields.llama.fi/chart/{pool}` dá o histórico — MESMO host, que já respondeu em produção |
| Série de funding | existe, 8h, via a cascata da Fase 3 |
| Correlação | `pearson` e `meanPairwiseRateCorrelation` em `stats.ts` |
| Portfólio / vol / drawdown de carteira | **nada** |

⚠️ **`meanPairwiseRateCorrelation` alinha por POSIÇÃO, não por data**
(`s.slice(s.length - menor)`). Serve para o funding, onde todas as séries estão
na mesma grade de 8h e terminam juntas. Para combinar fontes com cadências e
fins diferentes seria correlacionar segunda-feira de uma com quinta-feira da
outra — número plausível, silenciosamente errado. Esta fase alinha **por data**.

## As três armadilhas que esta fase existe para não cair

**1. Diversificação NÃO aumenta retorno — ela reduz variância.** Uma carteira de
3,40% e 1,18% rende ~2,3%: **menos que a melhor parte**. Se o painel mostrar
"o Sharpe da carteira é melhor!", ele esconde que o dono ganharia menos. Os dois
números vão lado a lado, e a escolha entre eles é do dono, não de uma fórmula.

**2. O risco que decide NÃO está na série.** O retorno do empréstimo de
stablecoin quase nunca é negativo — o risco dele é exploit de contrato e
despegue, que a Fase 4 declarou como NÃO medido. Ranquear por volatilidade
ordenaria as estratégias por **qual risco nós deixamos de medir**, premiando
justamente a que esconde melhor. Vai dito em vermelho, não em rodapé.

**3. Diversificar CUSTA, e o custo é medível.** Cada fluxo cobra a própria
entrada. Dividir $1.000 em quatro fluxos paga quatro entradas de $250 — e o gás
é fixo. A carteira combinada é medida **líquida do custo de entrada no capital
dividido**, que é a lição da Fase 4 aplicada contra a tese desta fase.

## Critério de conclusão

Matriz de correlação entre os quatro fluxos, alinhada por data, e a carteira
comparada contra **a melhor parte sozinha** em retorno absoluto E em tombo —
com o custo da divisão dentro. Se a carteira não ganhar em nenhum dos dois, a
combinação é reprovada e concentrar é o certo.

⚠️ **O veredito tem TRÊS saídas, não duas.** Render menos com tombo menor não é
verde nem morta: é **troca de retorno por sono**, e quem decide é o dono. Um
selo ali seria uma fórmula tomando decisão de produto.

## O que foi construído

| peça | onde |
|---|---|
| Série histórica de APY (`/chart/{pool}`) | `defillama-yields.ts` |
| Alinhamento por data, matriz, carteira líquida | `src/lib/lab/combinacao.ts` + **20 testes** |
| Rota | `src/app/admin/api/combinacao/route.ts` |
| Painel 🧬 | `CombinacaoPanel.tsx` + guarda de amostra |
| Estratégia | `carteira_verde`, $5.000, capital DIVIDIDO |

## ⚠️ Um quinto defeito achado ao construir: as verdes nunca foram promovidas

A Fase 4 mediu `stablecoin_lending`, `tokenized_treasury` e `liquid_staking`
como **verde** e gravou isso em `lab_results` — e o `registry.ts` continuou
dizendo **cinza** nas três. No painel do laboratório, "medida e aprovada" estava
**idêntica** a "nunca medida".

É a mesma família das outras quatro: dois estados diferentes com a mesma
aparência. E teria matado esta fase em silêncio — `verdesElegiveis()` lê o
status do registro, então a carteira teria nascido com **um** fluxo e devolvido
INCONCLUSIVO, sem ninguém entender por quê.

As três foram promovidas com os números medidos dentro da hipótese, no mesmo
formato dos fechamentos anteriores.

## A rodada (08/08) — a hipótese caiu, e caiu no melhor cenário possível

```
correlação média −0,004 (0%) · 4 fluxos = 4,0 apostas independentes
carteira 2,66%/ano  ×  Tesouro tokenizado sozinho 3,13%/ano
```

**ρ=0 é diversificação perfeita** — quatro fluxos valendo quatro apostas, o
máximo teórico. E a carteira perde mesmo assim.

| fluxo | líq/ano | bruto (série) | entrada | tombo | % neg | dias |
|---|---|---|---|---|---|---|
| Tesouro tokenizado · USDY | **+3,13%** | 3,55% | −0,416% | 0,00 | 0% | 193 |
| Funding · BTC | +2,93% | 3,38% | −0,450% | **0,07** | **16%** | 95 |
| Empréstimo · aave-v3 USDT | +2,67% | 2,67% | −0,001% | 0,00 | 0% | 1273 |
| Staking · lido stETH | +1,90% | 2,35% | −0,446% | 0,00 | 0% | 1529 |

**A premissa estava certa; a conclusão, não.** A matriz confirma que os motores
são independentes (funding × crédito = −0,03; funding × juro soberano = −0,00).
Eu acertei que as causas são diferentes e errei ao concluir que isso ajudaria:
**diversificação só paga quando nenhuma parte domina** — e o Tesouro domina,
rendendo mais que todos com tombo zero. Misturar funding (16% de dias negativos)
só acrescenta oscilação.

Terceira hipótese minha derrubada pela própria medição, depois do clima e do
filtro de regime.

### O único sinal de estrutura na matriz inteira

**funding × staking líquido = −0,24**, a única correlação não desprezível, e
negativa. Os dois são ETH-adjacentes. Não salva a carteira, mas é a única
evidência de estrutura a explorar — e aponta para um **par**, não para uma cesta
de quatro.

### ⚠️ E um defeito meu no veredito, achado pelo dono

O texto dizia *"o tombo TAMBÉM não melhora. Combinar perde nas duas pontas"*.
**Não perdia — empatava em zero.** Carteira 0,00 contra Tesouro 0,00.

E o empate é **artefato**: retorno de piscina é `apy/365`, e APY positivo nunca
gera dia negativo. **Tombo é estruturalmente incapaz de ser diferente de zero
para renda de piscina** — três dos quatro fluxos tinham tombo zero por
construção.

É a armadilha nº 2 deste plano entrando por outra porta: eu a bloqueei na coluna
VOL e deixei passar pela coluna TOMBO. Um veredito que trata "0 contra 0" como
derrota da diversificação afirma exatamente o que não mediu.

**Corrigido:** o veredito agora tem quatro saídas — ganha, empata com tombo
real, piora com tombo real, e **comparação inválida** quando os dois tombos são
zero por construção. Nesse caso a resposta é CINZA com a perda de retorno dita
na frente (0,47 ponto) e o motivo escrito: *"o risco que justificaria
diversificar — emissor, despegue, fila de resgate — está inteiro FORA da série".*

### Conferência print × banco (08/08)

Todos os campos batem: carteira `2.6596`, benchmark `3.1339`, ρ `−0.004`,
`effective_n 4`, `sample_n 95`, e os quatro fluxos idênticos ao que a tela
mostrou. O 🪙 (`1.1277` · `11.59` · `0.068`) e o 🏦 (`3.4063 / 3.2897 / 2.0641`)
também.

⚠️ **Uma divergência legítima que parecia contradição:** o empréstimo aparece com
**2,67%** no 🧬 e **3,56%** no 🏦 — 89 pontos-base. São perguntas diferentes:
aqui é a média da série própria de UMA piscina ao longo de 1.273 dias; lá é a
mediana à vista entre 5 produtos, hoje. Nenhum está errado, e só o primeiro
serve para correlacionar. A nota está na tela agora, porque sem ela os dois
painéis pareciam se contradizer.

---

### FASE 5 — Venda de opção coberta (C8) · 🟡 EM CONSTRUÇÃO (09/08)

## ⚠️ A HIPÓTESE DO MAPA ESTÁ MAL FORMULADA, E ISSO MUDA A FASE

O registro diz: *"IV do BTC roda 50-80% ao ano contra 15-20% do S&P — é o
prêmio mais gordo e estruturalmente persistente deste mercado"*.

**Isso compara o PREÇO do seguro, não o lucro de vendê-lo.** Quem vende opção
não ganha a IV: ganha **IV menos a volatilidade que de fato aconteceu** — o
prêmio de risco de variância. Se o BTC tem IV de 60% e realiza 55%, o vendedor
embolsa 5 pontos. O S&P com IV 18% e realizada 13% embolsa os mesmos 5.

**A gordura é proporcional. A borda pode não ser maior — só está denominada num
número maior.** É a mesma família de "bruto × líquido" que já derrubou o funding
e o rendimento, agora na variável mais fácil de confundir do mapa.

Por isso a Fase 5 começa medindo o **prêmio de risco de variância**, não o
prêmio nominal. Sem VRP positivo e persistente, vender opção coberta é vender
bilhete de loteria pelo preço justo — e nenhuma escolha de strike conserta isso.

## Verificação de estado (09/08)

| setor | achado |
|---|---|
| Qualquer coisa de opções | **nada no repo.** Zero linhas sobre strike, IV, grego ou expiração |
| Volatilidade realizada | **não existe.** Há ATR em `market-indicators.ts`, que é outra coisa — amplitude média, não desvio de retornos |
| Candles | `data-api.binance.vision`, provado em produção |
| IV histórica | **DVOL da Deribit** (`public/get_volatility_index_data`), candles diários `[t, o, h, l, c]`. Host novo, reachability NÃO provada |

## As cinco armadilhas, escritas antes do código

**1. IV alta não é lucro.** Ver acima. O titular desta fase é o VRP, e a IV
nominal aparece ao lado como contexto, nunca como resultado.

**2. ⚠️ AQUI A MEDIANA MENTE — e é a inversão de tudo que fiz até hoje.**
Venda de opção tem mediana positiva quase sempre: na maioria dos períodos o
prêmio entra inteiro. A média é arrastada pelas poucas altas violentas. Em todo
o resto do laboratório eu briguei PELA mediana contra a média; aqui **a mediana
é a estatística que engana** e o que decide é a média com a cauda ao lado.
Reportar mediana aqui seria repetir, invertido, o erro que `stats.ts` existe
para impedir.

**3. O denominador é SEGURAR A MOEDA, não zero.** Coberta quer dizer que você
já tem o BTC. Se ele subiu 40% e a call travou em +10%, você não ganhou prêmio:
perdeu 30 pontos contra ter ficado quieto. Medir "prêmio arrecadado" sem o
teto de alta é medir meia operação.

**4. DVOL(D) prevê D..D+30, NÃO D−30..D.** Comparar a implícita de hoje com a
realizada dos últimos 30 dias é confrontar previsão com passado — dá um número
plausível e mede outra coisa. O alinhamento é PARA A FRENTE, e os últimos 30
dias da série não têm resposta ainda: saem da conta em vez de virar zero.

**5. Não temos preço de opção histórico.** DVOL é índice, não livro. Então o
custo de execução — spread da opção, taxa, rolagem — fica **NÃO medido**, e
qualquer payoff de call que eu simule é SIMULAÇÃO, dita como tal, não medição.

## Critério de conclusão

**5.1 (esta entrega):** série de VRP = DVOL(D) − realizada(D..D+30), com média,
cauda e fração de janelas negativas. Se o VRP mediano for ≈0, a hipótese do mapa
cai e a fase termina aí — não há prêmio a colher, e escolher strike é decorar
uma conta que já fecha em zero.

**5.2 (só se 5.1 passar):** payoff da call coberta contra SEGURAR a moeda, na
mesma janela, com o teto de alta cobrado.

## O que foi construído (5.1)

| peça | onde |
|---|---|
| Volatilidade realizada (desvio de retornos log, anualizado) | `src/lib/lab/variancia.ts` |
| Alinhamento PARA A FRENTE, resumo com cauda, veredito | idem · **16 testes** |
| DVOL histórico, com status por recusa | `src/lib/api/deribit-dvol.ts` |
| Rota | `src/app/admin/api/variancia/route.ts` |
| Painel 🌪 | `VarianciaPanel.tsx` + guarda de amostra |

### Decisões que precisaram de nota

**A volatilidade realizada não existia.** Havia ATR, que é **outra grandeza** —
amplitude média verdadeira, quanto o preço anda dentro do dia. Volatilidade é o
desvio dos RETORNOS, que é o que a opção precifica. Usar ATR daria um número com
a mesma unidade e significado diferente: o pior tipo de substituição.

**Sem média subtraída**, por convenção de precificação: o desvio é em torno de
zero. Subtrair a média da janela embutiria a tendência do período na medida de
risco e deixaria a comparação contra a implícita torta — para menos, sempre.

**A amostra é de janelas INDEPENDENTES, não diárias.** Janelas de 30 dias se
sobrepõem 29/30: 300 pontos são ~10 janelas. Contar 300 seria a inflação de
amostra da Fase 4 outra vez — lá o mesmo emissor em seis cadeias, aqui o mesmo
mês contado trinta vezes.

**Fonte recusada não é prêmio zero.** Se a Deribit não responder, a rota FALHA
com o status; ela não devolve "prêmio inexistente". As duas leituras são opostas
e a segunda encerraria a fase por engano.

**A tabela mostra as 30 PIORES janelas, não as últimas.** Numa lista cronológica
a cauda some, e é ela que decide se dá para segurar a posição.

⚠️ **Uma correção minha durante a construção:** o teste do alinhamento afirmava
`realizada > 100`, um limiar que inventei sem calcular. O valor real é **53,4**
para a frente contra **1,0** para trás. A premissa estava certa e o número
chutado — um teste que passa por limiar arbitrário não prova o alinhamento,
prova que o número é grande. Agora ele compara os dois lados e exige uma ordem
de grandeza.

## A rodada (09/08) — o prêmio existe, e é ~11% do que a hipótese sugeria

```
implícita média 50,4%  contra  realizada 44,7%
prêmio médio +5,70 pontos · 29 janelas independentes · 870 diárias
DVOL de 2024-02-21 a 2026-08-09 — a Deribit respondeu, sem recusa
```

**A hipótese do mapa cai na formulação, não no sinal.** A implícita É 50,4%,
como o mapa dizia. Mas o prêmio é **5,7** — e o S&P (IV 18% / realizada 13%)
entrega ~5. **A gordura era do denominador, não da borda.** O que se ganha é
~11% do número nominal, e é praticamente o mesmo que o mercado tradicional paga.

| | |
|---|---|
| mediana | **+9,40** |
| média | **+5,70** |
| pior janela | **−46,10** |
| média das 5% piores | **−34,49** |
| janelas negativas | 28,2% |

A mediana está 3,7 acima da média — a cauda puxando. Formato clássico de vender
seguro: ganha +9,4 quase sempre, perde −34,5 nas piores 5%. **Seis janelas boas
pagam uma ruim.**

### ⚠️ Dois defeitos meus, os dois escondendo o que a fase diz que decide

**1. A tabela mentia no rótulo.** Ela dizia *"as 30 PIORES janelas, não as
últimas"* — mas a rota guardava `slice(-120)`, recorte por RECÊNCIA, e o painel
ordenava esse recorte. A pior armazenada era **−10,6**; a pior real, **−46,1**,
nunca chegava à tela.

Numa fase cujo argumento inteiro é *"a cauda é o que decide"*, eu construí a
tela que esconde a cauda. Agora a rota devolve `piores` (as 40 piores da série
INTEIRA) e `recentes` separadas, ditas.

**2. Os 28% de janelas negativas enganam.** As doze piores armazenadas eram
21/05, 22/05 … 01/06 — **consecutivas**. Com janela de 30 dias deslizando dia a
dia, UM mês ruim aparece trinta vezes. Os 245 dias negativos são um punhado de
episódios, não 245 eventos.

Terceira aparição da inflação de amostra: primeiro o mesmo emissor em seis
cadeias (Fase 4), depois o mesmo mês na AMOSTRA (5.1), agora o mesmo mês na
FREQUÊNCIA. `contarEpisodios` sai ao lado da fração — uma responde *quanto
tempo* se esteve perdendo, a outra *quantas vezes começou*, que é a pergunta de
quem precisa aguentar o tranco.

### O que isto NÃO decide

Prêmio positivo **não é call coberta aprovada**. Faltam, e ficam declarados:

- o **custo de execução** da opção — DVOL é índice, não livro, e não há preço
  histórico em fonte gratuita;
- o **teto de alta** da coberta, que trava o ganho da moeda e é metade da
  operação.

Com prêmio de 5,7 pontos e cauda de −34,5, o espaço para custo de execução é
estreito: **a 5.2 pode reprovar mesmo com a 5.1 verde.**

## Fase 5.2 — construída (09/08) · ⚠️ SIMULAÇÃO, não medição

Payoff da call coberta contra **SEGURAR a moeda**, na mesma janela da 5.1, com
o teto de alta cobrado.

### ⚠️ A distinção que precede tudo

A 5.1 é **medição**: DVOL real contra volatilidade realizada. A 5.2 **não é** —
não existe histórico gratuito de preço de opção, então a call é precificada por
Black-Scholes com a implícita observada. Preço de modelo não é preço de mercado,
e a palavra SIMULAÇÃO aparece em vermelho na tela para o número modelado não
herdar a credibilidade do número medido.

**Para que lado cada erro do modelo aponta** — declarar "é modelo" sem dizer a
direção é declarar metade:

| erro | direção |
|---|---|
| **Sorriso** — usamos a implícita DO DINHEIRO para strikes FORA dele, e call fora costuma negociar mais caro | prêmio simulado MENOR que o de mercado → **conservador** para a coberta |
| **Cauda** — Black-Scholes assume lognormal, e a cauda de alta do BTC é mais gorda | risco SUBESTIMADO → **otimista** para a coberta |

Os dois apontam para lados opostos e não se cancelam de forma conhecida. Por
isso existe `MARGEM_MINIMA_PCT = 1`: aprovar por 0,2 ponto seria afirmar
precisão que a simulação não tem.

⚠️ **O que É medido:** o retorno do BTC nas janelas (velas reais) e **quantas
vezes ele passou do teto**. Esse é o lado da conta que mais decide, e não
depende de modelo nenhum.

### A conta, e por que ela é a definição

```
coberta = min(retorno da moeda, teto) + prêmio
```

Você TEM a moeda e VENDEU o direito de comprá-la ao teto. Abaixo do teto, fica
com as duas coisas; acima, entrega ao teto e o ganho para ali. **Medir só o
prêmio seria medir uma call DESCOBERTA e chamar de coberta** — exatamente o que
a formulação do Mapa do Lucro convidava.

### O número que engana, e ele é verdadeiro

A coberta bate segurar na **maioria** das janelas — toda vez que a moeda não
dispara. E pode perder na **média**, porque as poucas altas grandes pagam a
conta inteira. A coluna GANHOU sai em âmbar por isso: é o número verdadeiro que
vende a estratégia errada.

Tetos declarados **antes** de ver o resultado: +0%, +5%, +10%, +20%. Escolher
olhando qual saiu melhor é fitar — o mesmo defeito da sonda de orderbook que só
media a "melhor oportunidade aparente".

## A rodada (09/08) — CINZA, e a margem fez o trabalho dela

| teto | vantagem | ganhou | exercida | prêmio |
|---|---|---|---|---|
| **+5%** | **+0,62** | 77% | 33% | 3,75% |
| +10% | +0,52 | 86% | 20% | 2,35% |
| +0% | +0,50 | 70% | **52%** | 5,76% |
| **+20%** | **+0,10** | **94%** | 7% | 0,86% |

Vantagem de 0,62 contra margem de 1 → **INCONCLUSIVO**. Os quatro tetos deram
positivo e nenhum passou a margem: a trava recusou aprovar por margem estreita
com prêmio modelado, que é exatamente o que ela existe para fazer.

### ⚠️ Meu palpite estava errado, e o erro é instrutivo

Eu previ que **+20% seria o melhor teto**. É o **pior** (+0,10). Faz sentido
depois de visto: a +20% o prêmio é 0,86% e o teto quase nunca morde (7%) — a
estratégia vira quase igual a segurar, e a vantagem colapsa. O ponto ótimo é
onde o prêmio ainda é gordo e o teto não morde demais.

### O contraste que a fase existia para mostrar

**+20% ganha em 94% das janelas e entrega +0,10. +0% ganha em 70% e entrega
+0,50.** A taxa de acerto e o resultado andam em **direções opostas**. Quem
vendesse a estratégia mostraria os 94% — número verdadeiro apontando para o
teto errado.

### ⚠️ A ressalva que faltava na tela, e agora está lá

**SEGURAR rendeu +0,86% por janela de 30 dias — ~10,5% ao ano.** Em 2,5 anos o
BTC andou quase de lado, e **coberta ganha de segurar POR CONSTRUÇÃO em mercado
lateral**: o teto quase não morde e o prêmio entra inteiro.

Sem isso, `+0,62` é lido como constante da estratégia quando é condicional ao
mercado que a janela pegou. Mesma família da janela curta do funding: o número
está certo e a leitura, não.

`regimeDaJanela` classifica pelo retorno anualizado de segurar (queda / lateral
/ alta — limiares declarados, não medidos) e a ressalva entra em **toda** saída
do veredito, inclusive nas que reprovam: um resultado negativo em mercado de
alta também é condicional, e descartar a estratégia sem isso seria errar o
motivo.

### A cauda são DOIS episódios, não uma distribuição

**32 das 40 piores janelas estão em dois meses:** 26 em janeiro de 2026 e 6 em
fevereiro de 2024. Nelas a implícita estava em 38–42% e a realizada veio a
**80–84%** — a volatilidade dobrou. Com 29 janelas independentes, isso são ~2
eventos em ~29 oportunidades. O `−46,10` não é "a cauda da distribuição": é
**janeiro de 2026**.

⚠️ A primeira rodada é também teste de rede: `www.deribit.com` nunca foi chamado
por este repo, e não há segunda fonte gratuita de IV histórica. Se recusar, a
tela diz o status — e a fase fica "não medimos", não "não há prêmio".

---

### FASE 6 — DEX ↔ CEX (C11) · 🟡 EM CONSTRUÇÃO (09/08)
O único terreno com vantagem estrutural: o tempo de bloco cria janela lenta
por construção, e metade da infraestrutura já existe.

⚠️ **Aviso registrado:** MEV compete pesado e a resposta pode ser a mesma das
outras arbitragens. Medir com o mesmo rigor: pedágio, profundidade, gás.

## Verificação de estado (09/08)

| peça | estado |
|---|---|
| Preço executável de CEX por tamanho | **existe e é provado**: `vwapBuy`/`vwapSell` em `arb-realism.ts` — o andador de livro que produziu as 4.085 medições que MATARAM o CEX↔CEX |
| Livros de CEX | `fetchOrderbook`, 6 venues |
| Preço executável de DEX | `fetchLiFiQuote` — cotação real para um tamanho real, com taxa, impacto e gás dentro |
| Gás | dentro da cotação da LI.FI, em dólar |
| Preço de DEX "de tela" | `dexscreener`, `geckoterminal` — ⚠️ **NÃO servem**, ver armadilha 2 |

**A régua é a mesma dos dois lados, e é a que já reprovou a versão CEX↔CEX.**
Isso não é detalhe: se eu medisse o DEX com régua nova, qualquer resultado
positivo seria suspeito de vir da régua.

## As armadilhas, escritas antes do código

**1. ⚠️ MEV — somos os últimos da fila, por construção.** Quem vê a mesma
diferença no mempool monta um pacote e entra antes. **Tudo que esta fase medir é
TETO, não captura.** A borda existe; quem fica com ela é outra pergunta, e não é
esta medição que responde.

**2. ⚠️ PREÇO DE TELA DO DEX NÃO É PREÇO EXECUTÁVEL — e cair nisso seria repetir
o defeito que já custou uma mesa.** `dexscreener` e `geckoterminal` dão o preço
derivado da poça ou o último negócio. O preço que importa é a cotação para O
NOSSO TAMANHO, com impacto dentro. Foi exatamente comparando preço de tela que a
mesa achou 0,72% de borda que virou −0,629% real em 4.085 medições.

**3. ⚠️ OS DOIS LADOS TÊM QUE SER MEDIDOS PARA O MESMO TAMANHO.** Cotar $5.000 no
DEX (com impacto) contra o topo do livro da CEX (sem impacto) enviesaria contra
o DEX; o contrário enviesaria a favor. Por isso o lado CEX anda o livro com
`vwapBuy`/`vwapSell` no MESMO notional — a mesma função, o mesmo tamanho.

**4. Transação que reverte custa gás e não entrega nada.** Perna on-chain pode
falhar por slippage, por bloco cheio ou por MEV. Não dá para medir isso em
cotação: fica declarado.

**5. Dois bolsos, como já decidido.** Estoque dos dois lados, sem transferir —
a decisão de semanas atrás para o arbiter. Ponte não entra na conta porque não
entra na operação.

**6. A janela de bloco é a vantagem E o risco.** A perna de CEX é instantânea, a
de DEX espera um bloco. É nessa espera que a vantagem existe — e é nela que o
preço se move contra.

## Critério de conclusão

Borda executável mediana, nos dois sentidos (comprar no DEX/vender na CEX e o
inverso), depois de taxa de CEX, taxa de DEX, impacto e gás — com o mesmo
notional dos dois lados. Se a borda mediana for negativa, a Fase 6 fecha como as
outras arbitragens fecharam, e o "terreno com vantagem estrutural" cai.

## O que foi construído

| peça | onde |
|---|---|
| Preço executável dos DOIS lados, sentidos, veredito | `src/lib/lab/dex-cex.ts` + **17 testes** |
| Rota | `src/app/admin/api/dex-cex/route.ts` |
| Painel ⛓ | `DexCexPanel.tsx` + guarda de amostra |

### Duas exclusões que o próprio repo justifica

**WBTC fica fora.** É BTC *embrulhado*, não BTC — a diferença entre os dois é o
basis de custódia do embrulhador, negócio próprio com risco próprio. Chamar de
arbitragem mediria a taxa do custodiante e daria o nome errado.

**MATIC/POL fica fora.** O repo **já tem a cicatriz**: o padrão "MATIC→POL" está
documentado em `arbiter.ts` como a fonte de spreads falsos que o filtro de
mediana existe para matar. Ticker em migração cota o cadáver de um lado e o vivo
do outro.

### As decisões que precisaram de nota

**Ida e volta REAL, não espelhada.** A segunda cotação usa a QUANTIDADE que a
primeira devolveu. Poça com liquidez assimétrica cobra diferente nos dois
sentidos, e assumir simetria inventaria metade da medição — por isso as duas
cotações do mesmo par são em série, mesmo com os pares em paralelo.

**O gás entra no preço.** A cotação devolve tokens; o gás sai do bolso em moeda
nativa, por fora. Quem entrou gastou `$N + gás`; quem sai recebe o valor *menos*
o gás da segunda perna. Deixá-lo fora daria um preço executável que ninguém
executa — a família de erro que a Fase 4 pegou com o custo fixo.

**A taxa de CEX entra UMA vez por rota.** Há uma única perna de CEX em cada
sentido; cobrar duas seria a conta de quatro pernas do funding aplicada onde há
duas.

**A mediana manda** — como no censo de profundidade, e ao contrário da Fase 5.
Aqui um par com poça quebrada é ruído de dado, não a cauda do negócio.

**Par com livro raso não entra em nenhuma conta.** Preenchimento parcial dá
preço médio melhor que o real: mente a favor. Vira contagem declarada.

## A primeira rodada (09/08) — 3 pares, todos negativos, e um defeito meu

```
mediana da borda LÍQUIDA: −0,438%  ·  0 de 3 positivos
CINZA — só 3 pares com livro completo, abaixo do piso de 4 → INCONCLUSIVO
```

| par | líquida | bruta | outro sentido |
|---|---|---|---|
| LINK @ethereum | −0,417% | −0,317% | −0,711% |
| ARB @arbitrum | **−0,438%** | −0,338% | −0,574% |
| OP @optimism | −0,529% | −0,429% | −0,601% |

**Os dois sentidos são negativos em todos os três.** Nenhum par paga nas duas
direções — a checagem de sanidade passou.

### O número que explica tudo

No LINK, onde o preço tem dígitos suficientes para ser lido:

```
ida e volta no DEX:  8,3656 → 8,2903  =  0,90%
ida e volta na CEX:  8,3413 → 8,3391  =  0,03%
```

**A ida e volta no DEX custa ~30× a da CEX.** A taxa da poça mais o impacto de
$5.000 são ordens de grandeza maiores que o bid-ask do livro. A janela de bloco
existe e é irrelevante: o pedágio para atravessar a poça come qualquer dispersão
que a lentidão do bloco possa criar.

É a mesma forma do censo de profundidade — lá a dispersão de 0,05% morria contra
1,1% de custo para atravessar dois bid-asks; aqui morre contra 0,90% de poça.

### ⚠️ O defeito: quatro pares caíram por culpa minha

ETH em três cadeias e BNB voltaram **`LiFi 404: Could not find token`**.

`tokens.ts` guarda o ativo nativo como `address: "native"` — marca da interface,
não endereço. A LI.FI espera `0x0000…0000`. Passei a string direto.

**E eu já sabia:** a rota do 🏦 importa `LIFI_NATIVE` e usa. Aqui escrevi
`token.address` num arquivo do MESMO DIA. Não foi desconhecimento — foi não
reler o que eu mesmo tinha feito duas fases antes.

O piso de símbolos funcionou (recusou concluir com 3 de 4), mas ele barrou uma
amostra que só estava curta por bug. `enderecoLiFi` vira função com nome, no
domínio, com três travas.

## A segunda rodada (09/08) — MORTA, e três defeitos meus por baixo

```
7 de 7 pares · mediana da borda líquida −0,322% · 2 de 7 positivos → MORTA
```

O veredito está certo. E três coisas estavam erradas por baixo dele.

### 1. ⚠️ A medição inteira não foi gravada

Passei `windowDays: 0` contra um `check (window_days > 0)`. O `startRun`
estourou, o `catch` de best-effort engoliu, `runId` ficou nulo e o `finishRun`
nunca rodou. **A rodada apareceu na tela e não existe no banco.**

É o "best-effort que esconde falha" que esta sessão vem caçando — desta vez no
código que escrevi no mesmo dia. E zero era errado no conceito, não só inválido:
a medição é um instantâneo de HOJE, então a janela é 1.

O best-effort continua (o laboratório não é pré-requisito da medição), mas a
falha agora **aparece em vermelho na tela**: *"esta rodada NÃO foi gravada"*.

### 2. ⚠️ As duas únicas linhas positivas eram impossíveis

```
ETH@ethereum   DEX compra 1917,4411   DEX venda 1920,2710   ← venda MAIOR
ETH@arbitrum   DEX compra 1917,7721   DEX venda 1920,0760   ← venda MAIOR
```

**Ida e volta na mesma poça não pode ganhar dinheiro** — taxa duas vezes,
impacto duas vezes. E as duas linhas quebradas eram exatamente as duas únicas
positivas (+0,377% e +0,359%): a borda vinha da cotação inconsistente, não do
mercado.

Eu construí a trava de *"custo não pode ser negativo"* na Fase 4 e **não
construí a equivalente aqui**. Mesma invariante, outro nome, segunda vez que uma
versão positiva-impossível passa.

`idaEVoltaCoerente` marca a linha e a tira de todas as contas — não corrige,
porque achatar daria um número com cara de medição.

### 3. ⚠️ Os dois lados cotavam em moedas diferentes

A CEX devolve **BASE/USDT** (todas as venues, `cex-orderbook.ts`) e o DEX cota
contra **USDC**. Sem converter, o basis USDT/USDC entra na conta como se fosse
borda — e ele é negócio próprio com risco próprio, igual ao WBTC que ficou fora
da lista por esse mesmo motivo.

O sintoma estava visível: ETH a 1926,59 na CEX contra 1917–1920 no DEX, ~0,35%
de gap sistemático **no ativo mais líquido do mercado** — implausível como
ineficiência, plausível como basis de stablecoin.

`converterCexParaUsdc` usa o par USDC/USDT da MESMA venue. E se ele não vier, a
rodada **falha** em vez de assumir paridade: assumir 1,0 seria justamente o erro
que a conversão existe para corrigir, com cara de conserto.

### O que a conclusão sustenta

**Mediana −0,322%, e as cinco linhas confiáveis todas negativas.** Removendo as
duas quebradas fica ainda mais negativa. A Fase 6 reprova — mas reprovava com
duas linhas de lixo no topo da tabela.

**Pendente: rodar o ⛓ de novo, com os três consertos.**

---

### FASE 7 — Automação por API do cliente · 🟢 pronta, FECHADA ao público
*Maior salto de receita, sem custódia.*

Chave com permissão de **negociar mas não sacar**. Depende de tudo que as
fases 2–6 produzirem — automatizar estratégia não medida é vender ruído.

## Verificação de estado (09/08) — e o que ela achou

Regra da casa: antes de código, auditar o setor. A auditoria achou três coisas,
duas delas ruins.

**1. O controle central da fase existia só como palavra.**

`CexSettings.tsx:115` gravava `readOnly: true` **fixo**, em toda chave salva.
Quatro problemas na mesma linha:

- era **fixo em `true`** — nenhuma chave jamais saía diferente;
- o tipo dizia *"marked trade-only by the **user**"* — o usuário não marca nada;
- o nome era `readOnly` e o significado pretendido era *trade-only*, que são
  **coisas diferentes** (só-leitura não negocia; trade-only negocia e não saca);
- e o campo **nunca era lido por ninguém**. Gate nenhum.

Efeito prático: um cliente que colasse uma chave com permissão **total** recebia
zero aviso, e ela ia para o servidor do mesmo jeito.

**2. A divulgação estava certa — eu conferi antes de reclamar dela.**

Suspeitei que a frase de `CexSettings` (*"chaves cifradas neste navegador; os
servidores nunca as guardam"*) contradissesse o autopilot em segundo plano, que
guarda `creds_cipher` em `autopilot_sessions`. **Fui olhar e estava errado**: a
tela de armar tem bloco próprio — `securityBullet1`: *"suas chaves da corretora
serão guardadas cifradas (AES-256) no servidor"*. Escopo correto, cada frase
falando do seu caminho.

**3. A pré-condição da própria fase enfraqueceu a fase.**

*"Automatizar estratégia não medida é vender ruído"* — e das quatro verdes
validadas, **três são on-chain** (querem carteira, não chave de corretora). A
única automatizável por API de CEX é a funding, a **+1,13%/ano**: a mais fraca
do mapa. Isto é decisão de produto e vai para o dono, não para o código.

## O que foi construído (7.1) — a trava que faltava

O item 1 é defeito em código já no ar, no caminho do dinheiro. Conserto
independe da decisão de produto:

- **`src/lib/cex/permissoes.ts`** — o servidor **pergunta à corretora** se a
  chave pode sacar, antes de guardá-la. Leitura (`lerPermissao`) separada da
  rede (`verificarChave`) e da decisão (`decidirArmar`), para cada parte ser
  testável sozinha.
- **Três respostas, não duas.** `so_negocia` · `pode_sacar` · `nao_verificavel`.
  A terceira é a que costuma virar defeito: *não conseguimos verificar* **não é**
  *está seguro* (invariante nº 6). Campo ausente na resposta devolve
  `nao_verificavel` — nunca `so_negocia`.
- **Quem expõe permissão é declarado, não inferido.** Binance, Bybit, OKX e
  KuCoin têm endpoint; as outras seis saem marcadas. Assumir *"sem endpoint =
  sem saque"* seria **inventar segurança**.
- **`pode_sacar` RECUSA o armar** (400 `key_can_withdraw`), com a causa em termos
  de dinheiro e com o conserto. `nao_verificavel` passa — bloquear inviabilizaria
  seis das dez corretoras — **com aviso explícito**, nunca em silêncio.
- **A verificação vem ANTES do `armSession`**, e há trava de teste lendo a ordem
  na rota: aviso depois de a credencial já estar cifrada no banco não é controle,
  é notificação.
- **O veredito fica quadrado no banco** — `0021_permissao_de_chave.sql` grava
  `key_permission`, `key_permission_detail` e `key_checked_at`. Sem isso o
  veredito viveria só no toast do momento, e daqui a um mês ninguém saberia
  dizer se a chave que está rodando sozinha foi **provada** incapaz de sacar ou
  apenas **não pôde ser olhada**.
- **`readOnly` foi removido** do tipo e do cliente, com a nota do porquê no
  lugar — e uma trava que reprova se ele voltar. O cliente não tem como provar
  nada sobre a própria chave.
- **Quatro estados na tela**, nos 4 idiomas: verificada (verde, única) ·
  não verificável · nunca checada (sessão anterior à trava) · pode sacar.
  `NULL` no banco é *ausência de medição*, e a tela mostra assim.

## 7.2 — a decisão do dono, e a trava que ela exigia (09/08)

O dono: *"podemos deixar a fase pronta, porém só vamos liberar ao público
quando tiver algo que realmente seja justificável"*.

**A verificação de estado achou que a trava não existia.** Dois achados:

**1. O worker que gasta o dinheiro REAL DO CLIENTE era o único caminho de
dinheiro sem kill-switch.** Dezessete mesas internas — que gastam só o nosso
token — tinham gate cada uma. `/api/autopilot/cron`, que compra na corretora do
cliente com o navegador fechado, não tinha nenhum. Grep de `pause` no arquivo:
**zero**.

**2. Pior: três interruptores que não controlam nada.** `disable_cex`,
`disable_swap` e `maintenance_mode` existem no painel, são clicáveis, gravam em
`admin_kv`, entram no log de auditoria — e **não são lidos por ninguém**. Um
documento nosso de auditoria chegou a reportar *"✅ plataforma aberta"* lendo um
interruptor que não controla coisa nenhuma. É a invariante nº 14 outra vez, e
mais cara: aqui o operador vê a chave virar e **acredita que desligou**.

### O que foi construído

- **`src/lib/autopilot/liberacao.ts`** — a trava, com o default INVERTIDO em
  relação aos gates do flywheel. Lá, ausência = rodando (certo para mesa
  interna). Aqui, ausência = **fechado**: ausência de decisão não é autorização
  (invariante nº 16). Linha ausente, tabela ausente, banco fora do ar — tudo
  fecha, e a **causa** viaja junto, porque *"fechado por decisão"* e *"fechado
  porque não li o banco"* pedem ações diferentes.
- **As três portas, não duas.** A automação sai por *armar sessão de fundo*,
  *cron* e *rota de ordem usada pelo piloto do NAVEGADOR*. Fechar duas seria
  "fechado" pela metade — a forma exata do defeito que a Fase 6 apanhou como *o
  mesmo defeito com outro nome*. Há trava de teste nas três.
- **Fechado não é silencioso** (invariante nº 7): o cron grava uma linha
  `skipped` com o motivo em cada sessão armada, o GET informa o estado antes de
  o usuário apertar qualquer coisa, e a tela do cliente diz *"armada · fechada"*
  em âmbar — nunca "ATIVO" em verde sobre uma automação que não vai disparar.
- **Ordem MANUAL segue aberta de propósito.** A trava fecha a automação, não o
  negociar. E isso é controle de PRODUTO, não de segurança: a flag `autopilot`
  vem do cliente.
- **Abrir custa justificativa escrita** (mínimo 15 caracteres, o mesmo piso de
  `lab_capital_log.reason`); **fechar não custa nada**. A assimetria é
  deliberada: atrito na direção segura seria atrito no lugar errado,
  exatamente quando se quer desligar rápido.
- **Painel `🔒 LIBERAÇÃO DA AUTOMAÇÃO`**, logo abaixo do AUTOPILOT, com as
  **verdes do laboratório ao lado do interruptor** — um botão sozinho depende da
  memória de quem aperta. Com a ressalva na tela de que `lab_strategies.family`
  é carrego/direcional/estrutura e **não** distingue corretora de on-chain:
  inventar essa classificação por adivinhação de nome seria pior que mostrar
  tudo e dizer a ressalva.

### ⚠️ Um defeito que quase enviei, e virou invariante nº 15

`runAlertWatchdog()` é chamado de **um lugar só em todo o código**: o fim deste
cron. O `return` cedo da automação fechada, escrito sem cuidado, teria desligado
**todo o alerta da plataforma** — pico de erro, cron parado, orçamento de IA,
saúde de dependência, digest diário — como efeito colateral de fechar uma
feature de CEX. O sintoma seria a ausência de alarmes, que é indistinguível de
"está tudo bem". Tem teste, conferido por mutação.

### Estado atual, e o que falta

A automação está **fechada por ausência de registro** — que é exatamente o
pedido: pronta, não liberada. Abrir é um botão no painel, com justificativa.

**E a pergunta de produto segue de pé:** três das quatro verdes são on-chain.
Quando a automação for aberta, ela alcança hoje só a funding, a +1,13%/ano.

## 7.3 — os pilotos, e os três interruptores mortos (09/08)

O dono, sobre a trava: *"a trava continua sendo a resposta, porém a carteira
Admin ou uma carteira autorizada pelo painel de controle pode rodar a automação,
assim podemos fazer testes futuramente com dinheiro real"*. E sobre os
interruptores: *"vc escolhe o mais seguro"*.

### As carteiras piloto — um furo do tamanho declarado

- **O cron FILTRA, não retorna cedo.** Fechada ao público, a automação continua
  rodando para as carteiras piloto. A versão anterior matava o teste junto com o
  público — e era o mesmo `return` que quase levou o watchdog (nº 15).
- **Uma ida ao banco para N sessões.** `decidirAutomacao` é decisão pura, então
  o cron lê o estado uma vez e julga por carteira. Chamar a versão assíncrona
  dentro do laço faria a trava custar uma consulta por cliente a cada 5 min.
- **`piloto_autorizado` é causa PRÓPRIA, não "aberto".** Colapsar as duas faria
  a tela dizer ao piloto que a feature está liberada ao público. Ele precisa
  saber que está pilotando: a tela mostra um bloco roxo dizendo que aquelas
  ordens usam **fundos reais**.
- **Entrar na lista custa nota escrita**, igual a abrir a trava, e sai no log de
  auditoria com a nota.
- **`platform_admins` NÃO qualifica** — e há teste de que o módulo nem consulta
  a tabela. Quem recebeu admin para olhar métricas não pode virar, em silêncio,
  autorizado a rodar o robô de dinheiro: seria a nº 14 de novo, um controle cujo
  nome diz uma coisa e cujo efeito é outra. O `ADMIN_WALLETS` do ambiente é a
  exceção declarada — é a carteira do dono e mudar exige redeploy, então ninguém
  ganha esse poder com um clique.
- **A rota de ordem não tinha identidade nenhuma.** Ela recebe a credencial no
  corpo e nunca lia sessão; sem isso, não havia como distinguir piloto de
  público no canal do navegador. A sessão passou a ser lida **dentro do ramo de
  autopilot**, o que deixa a ordem MANUAL exatamente como estava: sem exigir
  login, aberta de propósito.

### Os três interruptores, e o que "mais seguro" significou

`disable_swap`, `disable_cex` e `maintenance_mode` agora são **lidos**:

| interruptor | onde passou a valer |
|---|---|
| `disable_cex` | ordem de corretora (**manual e autopilot**) e o armar |
| `disable_swap` | `/api/quote` **só em `mode=quote`** — a cotação firme, o payload assinável |
| `maintenance_mode` | os três caminhos acima |

**A direção de falha é POR ROTA**, e essa foi a escolha:

- **Ordem de corretora** — dinheiro SAI da conta do cliente. Leitura falhou →
  **BLOQUEIA**. Um trade perdido durante uma queda de banco contra fundos
  expostos durante um incidente não é escolha difícil; e a rota já opera sem as
  próprias guardas (preço de referência, notional) quando o banco cai.
- **Cotação de swap** — devolve uma transação que o usuário ainda **assina na
  carteira**, revisando. Leitura falhou → **DEIXA PASSAR**. Derrubar o swap de
  todo mundo por um Postgres intermitente é o dano certo.
- `mode=list` **não** é barrado: comparar preço é navegação, não movimento de
  dinheiro.
- E a falha de leitura vira **evento de segurança** — senão *"ninguém desligou"*
  e *"não consegui olhar"* ficariam idênticos.

Isso não contraria a nº 16, é ela: o default segue o que está em jogo, e o que
está em jogo muda de rota para rota. Há teste de que as duas decisões **divergem
exatamente** no caso da leitura falha e são idênticas no resto — conferido por
mutação.

---

---

### FASE 8 — As cinzas restantes · 🟡
C9, C10, C12–C20. Cada uma com capital próprio e mesa própria.

## Verificação de estado (09/08)

Consulta ao banco, não à memória: das 28 estratégias do registro, **11 são as
cinzas desta fase e todas têm ZERO rodadas** em `lab_runs`. Nada aqui foi
medido nem pela metade.

Dois achados de fora do escopo, registrados para não se perderem:

- **`trend_ma50_long_short`, `trend_ma50_long_only` e `buy_and_hold` estão
  VERDES com zero rodadas no `lab_runs`.** Elas foram medidas na Fase 1, mas
  por outra mesa (o painel 🧭), fora deste livro-razão. O verde é real; o que
  não existe é a parcela no ledger que o sustenta. Não é defeito de medição, é
  de rastro — e vale arrumar antes que alguém audite o laboratório e não ache o
  número.
- **`dex_cex_arb` segue `cinza` no registro** embora a Fase 6 tenha concluído
  MORTA. Isso está **certo**: a 2ª rodada corrigiu três defeitos e o veredito
  espera reconfirmação. Status que anda na frente da rodada seria pior.

## A triagem — e por que ela vem antes de medir

Onze mesas não cabem numa entrega, e forçar as onze produziria oito medições
fracas. Pior: algumas **não são mensuráveis com fonte que a gente alcance**, e
fingir que são é o oposto do que este laboratório existe para fazer.

| | mesa | dá para medir com o que temos? |
|---|---|---|
| C14 | LP em AMM clássico | **sim** — taxa da fonte de rendimento, perda impermanente calculada do preço |
| C9 | Rotação por momento | sim — histórico de preço, mesma régua do 🧭 |
| C10 | Grade (grid) | sim — histórico de preço + taxa de corretora |
| C15 | Liquidez concentrada | **parcialmente** — a perda depende da FAIXA e da gestão dela; com fórmula de faixa cheia sai número errado com cara de certo |
| C16 | Cofre de perp DEX | parcialmente — a fonte publica o rendimento do cofre, não o PnL dos traders que é a contraparte |
| C17 | Cofre de opções | parcialmente — mesma limitação da 5.2: não há histórico gratuito de preço de opção |
| C13 | Arbitragem de ponte | sim, mas caro — exige cotação pareada em duas cadeias por janela |
| C12 | Liquidações | **não** — é jogo de latência; sem feed de evento e sem fila, qualquer número seria teatro |
| C18 | Airdrop / pontos | **não** — retorno é retrospectivo e não repetível; medir o passado aqui não prevê nada |
| C19 | Launchpad / IEO | **não** — sem fonte histórica de alocação e preço de estreia que eu alcance |
| C20 | Mercado de votos | **não hoje** — depende de API de marketplace de suborno que não consegui alcançar daqui |

**"Não mensurável" é um estado, não um adiamento.** Deixá-las cinza para sempre
faria "ninguém mediu" parecer "mediu e não deu" — invariante nº 6.

## O que foi construído (8.1) — C14, a família liquidez

A pergunta desta mesa é a única que importa: **a taxa cobre o que a piscina te
tira?** Toda interface publica o APR das taxas; nenhuma publica a perda
impermanente, que é a outra metade da conta.

- **A perda impermanente é CALCULADA, não estimada.** Para piscina 50/50 de
  produto constante ela sai fechada da variação relativa dos dois preços. Isso
  importa porque a fonte tem um campo `il7d` que **não consigo verificar daqui**
  (a política de rede deste ambiente recusa `llama.fi`) e que não está
  documentado no README do `yield-server`. Construir em cima dele seria assumir
  contrato que ninguém assinou — o erro exato de 04/08.
- **O sinal é a trava.** Estar na piscina não pode render MAIS que segurar por
  efeito de preço: o ganho vem da taxa, que entra por fora. Perda impermanente
  positiva é a versão desta família do "custo negativo" (nº 1) e do "ida e volta
  que ganha" (nº 2) — e aqui teria a cara de *"ser contraparte paga sozinho"*.
- **Grupo de controle embutido.** `USDC/USDT` está na lista declarada porque
  dois dólares não divergem: a perda dele TEM que sair ≈0. Se sair grande, quem
  está errado é a minha conta, não o mercado. Sem esse par, um erro de fórmula
  ou de sinal sairia como descoberta. Ele fica **fora das medianas** — entraria
  puxando o número para cima como se fosse mérito da estratégia.
- **Dois testes no veredito, e o segundo é o que mata.** Líquido positivo só diz
  que a mesa não perdeu dinheiro. Se ela não bater **segurar os mesmos ativos**,
  a taxa foi paga com o patrimônio do próprio provedor (invariante nº 9). Há
  teste para o caso que vende a mesa errada: positiva **e** pior que segurar.
- **APY ausente não é taxa zero.** Piscina sem `apyBase` sai marcada e fica fora
  do veredito; tratá-la como 0% faria a fonte calada virar "a taxa não cobre",
  que é conclusão, não dado.
- **Painel 💧 SER A CONTRAPARTE**, com LÍQUIDO e SEGURAR lado a lado — separar
  as duas deixaria a primeira responder pela segunda.

## A rodada (09/08) — o controle passou, o enquadramento não

O dono rodou. **INCONCLUSIVA** por piso de amostra (2 piscinas com taxa, piso
3), e a tela trouxe três coisas.

**1. O grupo de controle funcionou.** `USDC/USDT` deu perda **0,00%** e vantagem
**+0,04%** — só a taxa. A matemática da perda impermanente está certa, e ela
bateu a curva no resto: o ETH caiu ~55% no ano e a perda saiu −7,39%,
exatamente o que a fórmula prevê para essa divergência.

**2. ⚠️ O DEFEITO — invariante nº 17, nova.** A tela pintou de VERDE duas
piscinas que **perderam** para segurar, e escreveu *"bateu segurar em 2/2"*
quando o certo era **0/2**.

`taxa + perda` **já era** a comparação contra segurar, porque a perda
impermanente é medida *em relação a ter segurado*. Eu comparei esse número
contra o `segurar` — uma **diferença contra um nível** (invariante nº 3, forma
nova). Alcance real: o veredito da tela não foi afetado (o primeiro portão,
`vantagem ≤ 0`, era o teste correto), mas o contador, a cor da coluna e — o pior
— o segundo portão **reprovavam ao contrário em mercado de ALTA**: uma piscina
vencedora seria marcada MORTA só porque segurar rendeu mais que a vantagem dela.

**O grupo de controle não pegou, e não tinha como:** com preços parados, a
diferença e o nível coincidem. Controle prova a **conta**, não o
**enquadramento**.

**Consertos:** `liquidoPct` virou `vantagemPct` (o nome carrega o
enquadramento), entrou `lpPct` **absoluto** ao lado de `segurarPct` para o
confronto errado não ter como ser escrito, o segundo portão foi removido, e a
conta virou multiplicativa — a taxa incide sobre a posição que a perda já
encolheu. Regressão coberta nos dois sentidos (alta e queda), conferida por
mutação.

**3. Duas coisas menores, consertadas junto.** A taxa do WETH/USDC saiu
**+0,25%/ano**, implausível para essa piscina — e não havia como saber *qual*
piscina a fonte casou. Agora a tela mostra símbolo, TVL e o APY bruto de cada
casamento. E `SOL/USDC` na Uniswap-v2 da Ethereum **não existe** (o SOL não é
nativo lá): a medição excluiu certo e avisou, mas o alvo estava errado desde o
PR — virou `LINK/ETH`. Além disso, as medianas do cabeçalho descreviam
conjuntos diferentes (a perda vinha de um grupo, a taxa de outro); agora todas
saem da mesma amostra.

## A segunda rodada (10/08) — o enquadramento fecha, e a mesa EMPATA

Os quatro consertos entraram e a aritmética fecha entre as colunas, conferida
linha a linha: ETH/USDC vantagem −4,54% e piscina −30,57% contra segurar
−27,26%; LINK/ETH vantagem +0,38% e piscina −57,46% contra −57,62%. O absoluto
é exatamente `segurar × vantagem` em todas as linhas. O controle segue em
**0,00%** de perda. **Bateu segurar em 1/3** — contagem correta.

**Mas o veredito saiu MORTA com vantagem mediana de −0,01% em UM ANO.** Isso é
ruído lido como reprovação: um centésimo de ponto não distingue "a mesa perde"
de "a mesa empata", e está inteiramente dentro do gás que a medição declara não
incluir. Faltava **faixa morta** — a mesma `MARGEM_MINIMA_PCT` que a Fase 5.2 já
tinha, e que eu não apliquei aqui.

O valor não é chutado: ±1 ponto é a ordem do gás de entrar e sair de uma piscina
com $2.000 na Ethereum. Margem menor que a omissão conhecida não é resultado.

**E a taxa oscilou 12× em 24 horas.** ETH/USDC saiu **+0,25%/ano** em 09/08 e
**+2,97%/ano** em 10/08 — não era piscina errada, era `apyBase` sendo uma FOTO
do volume de ontem aplicada a uma janela de um ano. A Fase 4 já tinha decidido
essa ordem (`escolherApy`: media30d > base) e eu escrevi o contrário aqui, sem
justificar. Duas definições do mesmo conceito em dois arquivos — a régua tem que
ser uma só. Agora a média de 30 dias manda.

**Leitura honesta do que está medido:** a mesa **empata** com segurar, antes do
gás. Com o gás, vira negativa. Não é aprovação nem reprovação — e a diferença
entre as três leituras é justamente o que a faixa morta existe para preservar.

## 8.1.1 — o gás entra, e a decisão de enquadramento é o que decide

**⚠️ A TROCA NÃO ENTRA, E ISSO É DECISÃO, NÃO OMISSÃO.**

Montar a cesta 50/50 exige trocar metade do capital — mas **quem vai SEGURAR
50/50 paga exatamente a mesma troca**, na entrada e na saída. Cobrá-la só do
lado da piscina compararia montagens diferentes (invariante nº 3: os dois lados
no mesmo tamanho). Ela cancela entre os dois lados, e está escrito no código
porque cancelamento silencioso vira, meses depois, *"por que a troca não está na
conta?"*.

**O que entra é o custo que a piscina tem A MAIS que segurar**: duas aprovações,
um depósito e um saque — `432.000` unidades no total.

- **Unidades DECLARADAS, preço MEDIDO.** As unidades vêm da faixa típica dos
  contratos e passam por PR; os dólares por unidade saem dos `gasCosts` de uma
  cotação real da LI.FI, que traz custo e unidades na mesma resposta. Chutar o
  preço do gás seria inventar exatamente o número que decide o veredito.
- **Gás não medido ≠ gás zero.** Preço ausente devolve `null`, a janela sai
  marcada `gasDe: "ausente"`, e o **veredito vira CINZA** — porque o gás é da
  ordem da margem que decide esta mesa, e concluir sem ele seria decidir com a
  variável decisiva ausente. Foi a cicatriz de 06/08 na Fase 4: *"gás barato"* e
  *"gás não lido"* davam a mesma tela.
- **O custo gravado no banco passou a ter as DUAS parcelas** — perda impermanente
  **e** gás. Só a perda esconderia metade do que a mesa paga.
- **O gás da saída é cobrado junto com o da entrada**, sobre o capital inicial:
  simplificação declarada, que superestima num mercado que caiu e subestima num
  que subiu.

## A rodada com gás (10/08, tarde) — e o gás desmontou a própria justificativa

Rodou. **INCONCLUSIVA · EMPATE**, vantagem **+0,56%**, e a tabela agora fecha
nas duas direções. Mas a tela trouxe quatro coisas.

**1. ⚠️ O TEXTO DO VEREDITO VIROU MENTIRA.** Ele dizia *"o GÁS de entrar e sair
não está na conta"* — enquanto uma coluna **GÁS** aparecia dois centímetros ao
lado, com o número. O texto descrevia a versão ANTERIOR da medição, e texto
assim é pior que texto nenhum: é lido como leitura do que está na tela.

**2. ⚠️ A JUSTIFICATIVA DA FAIXA MORTA CAIU JUNTO.** Eu declarei ±1 ponto
*porque o gás custava dessa ordem e não estava na conta*. O gás entrou e mediu
**0,01%** — US$ 0,20 pela ida e volta inteira. A justificativa evaporou.

O que **não** evaporou foi a incerteza: ela mudou de lugar. Hoje quem manda é a
TAXA — as duas estimativas da **própria fonte** para a MESMA piscina (`apyBase`
e `apyMean30d`) chegaram a discordar em mais de 3 pontos. Então a faixa passou a
ser `max(piso declarado, desacordo MEDIDO da fonte)`.

⚠️ E o desacordo entra pelo **MÁXIMO, não pela mediana**. A mediana seria a
estatística que favorece o veredito: ela alargaria menos a faixa e transformaria
o +0,56% em VERDE. Escolher a estatística depois de ver o resultado é o que a
invariante nº 12 proíbe — então a escolha é a conservadora, e ela mantém a mesa
em CINZA.

**3. O gás de 0,01% não era conferível.** US$ 0,20 pela ida e volta na Ethereum
é número que exige conferência, e a tela mostrava só o percentual. Agora mostra
a parcela: unidades × dólares por unidade, mais a cotação que produziu o preço.

**4. Erro de aritmética meu, na prosa.** Este documento dizia `473.000` unidades
de gás; o total real é **432.000** (2×46.000 + 180.000 + 160.000). O código
sempre calculou certo — quem estava errado era o texto.

## A conferência no BANCO (10/08) — e um defeito que só o banco mostrou

O dono rodou de novo sem print. Fui ler `lab_runs`/`lab_results` direto, e as
três rodadas pós-conserto saíram **estáveis**: vantagem 0,5567 · 0,5540 · 0,5547,
taxa 2,566 · 2,568 · 2,569. A troca para `apyMean30d` estabilizou a entrada que
oscilava 12× — o veredito reproduz.

O texto gravado também confirma o conserto: *"dentro da faixa de ±3,36% … porque
as DUAS estimativas de taxa da própria fonte discordam em até 3,36 pontos … O
gás JÁ está na conta (0,01%)"*.

**⚠️ MAS A ARITMÉTICA DO CABEÇALHO NÃO FECHA, E ISSO É DEFEITO MEU.**

Com `n` ímpar, **cada mediana vem de uma piscina diferente**:

| número | valor | vem de |
|---|---|---|
| TAXA | +2,57% | ETH/USDC |
| PERDA | −0,49% | BTC/ETH |
| **VANTAGEM** | **+0,56%** | LINK/ETH |

A tela convida a conferir `taxa − perda ≈ vantagem` → **2,08 contra 0,56**. Não
é conta errada: são **três observações distintas** apresentadas lado a lado como
se formassem uma linha. É a invariante nº 4 numa forma que eu ainda não tinha
visto — não é a amostra que está errada, é a *leitura* que o layout induz.

**Conserto:** a linha mediana pela régua vem marcada com **▸** na tabela, e o
cabeçalho passou a dizer, em âmbar, que as medianas são por coluna e **não se
somam**. Com amostra PAR nenhuma linha é marcada — ali a mediana não é uma
observação, e apontar uma seria inventar.

**Pendente: rodar o 💧 de novo (a marca ▸ e o aviso são novos).**

**Fica declarado como não medido:** o gás de entrar/sair (em $2.000 na Ethereum
é material e pode virar o sinal), a taxa como foto de hoje aplicada à janela, e
a perda ser de ponta a ponta — quem saiu no meio realizou outro número.

---

## 8.2 — C9 (rotação por momento) e C10 (grade), construídas (10/08)

**Verificação de estado:** o painel 🧭 mede cinco canônicas — comprar e segurar,
média 50 (com e sem venda), canal de Donchian e reversão por RSI. **Nem rotação
nem grade estão lá.** As duas são genuinamente não medidas, e usam a régua de
preço diário que já existe e já foi exercitada em três fases.

### O que cada uma tem de característico — e como cada uma mente

- **C9 mente por LOOKAHEAD.** Ordenar pelo retorno passado e aplicá-lo ao
  próprio período faz qualquer ranking parecer genial. O sinal do dia vale para
  o período SEGUINTE, e há teste com uma série que sobe forte e depois desaba:
  uma rotação honesta compra o topo e come a queda.
- **C10 mente por OMISSÃO DO ESTOQUE.** As propagandas mostram só os degraus que
  fecharam. Quando o preço fura a faixa por baixo, a grade fica comprada no
  fundo e para de ganhar — e é assim que ela perde dinheiro. O veredito julga o
  **TOTAL** (realizado + estoque marcado a mercado), nunca o realizado. Na tela
  os dois ficam lado a lado, com o realizado rotulado como *"o número das
  propagandas"*.

### Decisões que valem registrar

- **O custo da rotação é por TROCA, não por rebalanceamento.** Uma carteira que
  não muda não paga nada; cobrar taxa por evento inventaria custo onde não houve
  giro. Há teste.
- **O calendário é a INTERSEÇÃO dos símbolos.** Um ativo que só existe em metade
  da janela entraria com retorno indefinido, e a falta viraria zero — que é
  retorno, não ausência.
- **A amostra da rotação são as DECISÕES** (12 rebalanceamentos num ano), não os
  365 dias. Contar dias seria a invariante nº 5 outra vez.
- **⚠️ VIÉS DE SOBREVIVÊNCIA, declarado na tela:** a lista é dos majors de HOJE.
  As moedas que morreram não estão lá para baixar a média, e isso empurra os
  DOIS resultados para cima. Nenhuma escolha de lista resolve isso.

### O buscador de preço virou módulo

`fetchFechamentosDiarios` estava copiado em duas rotas e esta seria a terceira.
Com duas era defensável (*"o que se repete é o endereço, não uma verdade"*); com
três deixa de ser, e virou `src/lib/api/binance-diario.ts`.

### ⚠️ E uma trava da casa estava cega

O guarda que impede dois painéis de terem o mesmo rótulo de botão usava
`<button[^>]*adm-btn[^>]*>` — e `[^>]*` **para no primeiro `>`**, que numa arrow
function (`onClick={() => …}`) é a seta. Pior: ele limpava `{...}` do corpo, e
neste repo o rótulo quase sempre É `{ocupado ? "medindo…" : "🔁 MEDIR X"}`.

Resultado: dos 19 "rótulos" que ele contava, **nenhum era de botão com
ternário** — ou seja, a trava rodava verde sobre um conjunto que não incluía os
casos de risco. Falso positivo ao criar este painel, e falso negativo o tempo
todo.

Consertado: o fechamento da tag é achado com contador de chaves, e cada literal
do corpo é um rótulo candidato. O conserto **encontrou um duplicado real** —
`"medindo…"` em quatro painéis, que deixava o operador sem saber qual estava
rodando. Cada um ganhou o nome do que faz.

## A rodada (10/08) — as duas saíram VERDES, e as duas estavam erradas

| mesa | veredito | mesa | segurar |
|---|---|---|---|
| C9 rotação | ✓ VERDE | **−3,01%/período** | −5,47% |
| C10 grade | ✓ VERDE | **−54,11%** | −64,55% |

**⚠️ VERDE COM PREJUÍZO — invariante nº 18, nova.**

Pela régua declarada as duas estavam certas: bateram comprar-e-segurar. Para
quem olha a tela, *"✓ VERDE"* sobre metade do capital destruído é o oposto do
que a medição descobriu.

O que faltava é o **terceiro competidor**: ficar em **CAIXA**. Ele está sempre
disponível, não custa nada, e num ano em que os dez majors caíram ele bateu as
duas mesas com folga. *"Menos ruim que o índice"* não é uma mesa que se opera —
é uma constatação sobre o mercado.

Agora: retorno absoluto negativo **não pode ser verde**. Vira cinza, e o texto
diz as três posições em ordem, sem esconder que a mesa ganhou do índice — as
duas coisas são verdade.

**⚠️ E A COLUNA ESTOQUE ERA O TOTAL DISFARÇADO.**

Na tabela, `ESTOQUE` e `TOTAL` saíram **idênticos nas dez linhas**, e
`realizado + estoque` não fechava com o total em nenhuma: BTC dava −35,73 contra
um total de −37,03.

A causa é algébrica e passou pela leitura: eu calculava `estoque − (1 − caixa)`,
que se expande em `estoque − gasto + recebido` — ou seja, **exatamente o total**.
Faltava rastrear o **custo do estoque que ainda está na mão**. Com ele,
`realizado + estoque === total`, e há teste exigindo a identidade em quatro
formatos de mercado.

**O que a rodada de fato descobriu**, com os consertos: a rotação por momento
**bate o índice mas perde dinheiro**, e a grade **perdeu 54% do capital com
10/10 das faixas rompidas** — os degraus renderam 1,48% e o estoque preso comeu
o resto. As duas são resultado, e as duas dizem a mesma coisa: naquele ano, o
caixa ganhou.

**Pendente: rodar o 🔁 de novo, com os dois consertos.**

---

### FASE 9 — Receita (C21, C22) · 🟡
Rebate de corretora e rev-share de protocolo. Não é trade, é dinheiro na mesa.

## Verificação de estado (11/08) — três achados, e o primeiro decide a fase

**1. ⚠️ A TAXA DE INTEGRADOR NUNCA FOI PEDIDA.** Os três agregadores suportam
taxa de parceiro — 0x (`swapFeeBps`), LI.FI (`fee`) e Jupiter
(`platformFeeBps`). **Nenhum recebia o parâmetro.** O `integratorKey` que
existia na LI.FI é o header `x-lifi-api-key`: chave de API, não taxa — quase
li um pelo outro e fui conferir o que ele faz com o valor.

Ou seja: C21/C22 rendia **zero** não por falta de volume, mas por nunca ter
sido pedido. O canal existe e estava desligado.

**2. O volume real é ~$63.** Treze operações no `operations`, todas entre 13 e
18 de junho: $58,77 de autopilot, $3,95 de spot, $0,00 de DEX. Com 1%, isso é
$0,63. A pergunta útil não é "quanto rende" — é **"quanto rende por $1M
roteado, e quanto falta rotear"**.

**3. O livro mistura sonda com tráfego real.** As duas linhas de `dex_swap` vêm
do banco de ataque (`attack.ts` posta `volumeUsd: 0` de propósito) e são
indistinguíveis de swap de cliente no agregado. Medição de receita construída
em cima disso contaria sonda como volume.

## A escada de taxas (9.1) — decisão do dono, degraus meus

O dono: *"cada Tier vai ter uma taxa, vamos pôr a taxa mais alta 1% que é a do
Tier gratuito; o restante você escolhe por perfil de cada Tier"*.

| plano | taxa | por quê |
|---|---|---|
| **free** | **1,00%** | teto declarado pelo dono — quem não assina paga o preço de lista |
| **pro** | 0,50% | metade do teto: o primeiro passo tem que doer menos que assinar de novo |
| **trader** | 0,25% | metade de novo — é o plano de quem opera com frequência |
| **pilot** | 0,10% | o mais baixo do mapa: quem roda automação traz volume, e volume é o ativo |

**⚠️ A LÓGICA É "QUEM PAGA MAIS ASSINATURA PAGA MENOS POR TRADE".** O produto é
a assinatura; a taxa por operação existe para monetizar quem não assina e para
fazer o upgrade se pagar sozinho. Taxa alta no plano caro seria cobrar duas
vezes pela mesma coisa e empurrar o cliente de maior volume — o mais valioso —
para outro agregador. Há teste exigindo que a escada seja **estritamente
decrescente**.

**⚠️ E O NÚMERO QUE DECIDE NÃO É A TAXA, É O EQUILÍBRIO.**
`equilibrioMensalUsd` diz a partir de que volume mensal o upgrade se paga
sozinho — de Free para Pro a $20/mês, são **$4.000/mês**. Sem esse número na
tela a escada parece punição; com ele, é oferta. Upgrade que não baixa a taxa
devolve `null`, não um número grande: número grande seria lido como *"é só
operar mais"*, que é falso.

**⚠️ SEM DESTINATÁRIO CONFIGURADO, TAXA ZERO.** `SWAP_FEE_RECIPIENT` ausente
desliga a cobrança inteira. Cobrar sem ter para onde mandar é pior que não
cobrar — e o default do ambiente não configurado **não cobra do usuário**.

## A carteira que recebe (11/08)

O dono passou `0x904126D219dC6c1f7c019303EC743Ad45F473c1F`.

- **Checksum EIP-55 conferido antes de gravar.** Um endereço com um caractere
  trocado passa em quase toda validação e manda a taxa para um lugar que
  ninguém controla — sem desfazer. Há teste, e ele reprova se um caractere
  mudar.
- **Mora no CÓDIGO, não no ambiente.** Endereço de recebimento não é segredo —
  é público por construção, aparece em toda transação on-chain. O que ele
  precisa é ser **conferível numa revisão**, e uma variável de ambiente
  esconderia justamente isso de quem lê o PR. `SWAP_FEE_RECIPIENT` sobrescreve,
  para trocar sem deploy.

**⚠️ E A SOLANA FICA DESLIGADA — isto não é descuido.** A Jupiter não aceita
endereço de carteira: o `platformFeeBps` exige um `feeAccount`, que é uma
**conta de token** do lado Solana. Um endereço EVM ali não é "menos ideal", é
**inválido** — a cotação seria recusada, ou pior, aceita apontando para lugar
nenhum. Há teste exigindo que a carteira de EVM **não vaze** para o lado
Solana.

## 9.2 — a cobrança ligada nas EVM (11/08)

- **0x** recebe `swapFeeBps` + `swapFeeRecipient` + `swapFeeToken`. A taxa é
  cobrada no token de **SAÍDA**: no de entrada ela sairia antes da troca
  acontecer — inclusive quando a troca falha.
- **LI.FI** recebe `fee` + `integrator` + `referrer`. ⚠️ Ela quer **fração**,
  não pontos-base: mandar `100` ali seria pedir **10.000%**. A conversão mora no
  ponto de contato, não em quem chama — quem chama fala em bps, que é a unidade
  da escada.
- **Os dois lados andam juntos.** `swapFeeBps` sem destinatário é cotação
  recusada — ou, pior, aceita retendo para lugar nenhum. A trava do `fees.ts` é
  repetida no ponto de contato com a rede.
- **Jupiter continua sem taxa**, e a ausência é declarada no código: falta a
  conta de token da Solana.
- **O plano de quem cota é resolvido na rota.** Sem sessão, `free` — que é a
  taxa mais alta. Falha de resolução também vira `free`, nunca "sem taxa": o
  contrário faria qualquer erro de sessão virar swap de graça.
- **A taxa vai em TODA resposta de sucesso**, inclusive quando é zero. `0%` e
  campo ausente são afirmações diferentes, e a tela precisa poder dizer a
  primeira.

### ⚠️ Um teste meu passou pelo motivo errado

A asserção da conversão da LI.FI conferia `"/ 10_000).toString()"` — string que
também aparece na conversão de **slippage**, três linhas acima. A mutação que
trocava fração por pontos-base **passou verde**: o teste achava o divisor do
vizinho e dava por conferido.

Foi o próprio teste de mutação que pegou. A asserção agora cita a linha inteira
da taxa.

### Cada cadeia com o seu destino (11/08)

O dono: *"o endereço Solana para taxas Solana e o endereço EVM para as taxas
EVM"*.

| cadeia | destino | estado |
|---|---|---|
| EVM | `0x904126D2…3c1F` | ✅ cobrando |
| Solana | `EWPtaW726V…Gvd5L` | registrada — **cobrança desligada** |

**Não existe endereço que sirva para os dois**, e a pergunta do dono foi na
direção certa: um `0x` de 20 bytes não existe na Solana, e uma chave ed25519 de
32 bytes em base58 não existe em EVM. Duas carteiras, obrigatoriamente.

**A carteira Solana foi conferida:** base58 válido, 32 bytes, e **na curva
ed25519** — ou seja, carteira de verdade, com chave privada, e não um PDA de
programa, para o qual ninguém consegue assinar.

**⚠️ E ELA CONTINUA NÃO COBRANDO, de propósito.** A Jupiter pede um
`feeAccount`, que é uma **conta de token (ATA)** derivada da carteira **para
cada mint** recebido — diferente de EVM, onde um endereço recebe qualquer
ERC-20. Por isso são DOIS campos: `CARTEIRA_TAXA_SOLANA` (a dona, registrada) e
`CONTA_TAXA_SOLANA` (o que a Jupiter recebe, ainda `null`).

Separar os dois é o que impede o erro fácil: a validação por tamanho **não
distingue** carteira de conta de token — uma carteira base58 tem 32-44
caracteres e passaria. Quem decide é o **campo**, não o formato. Há teste
exigindo que a carteira não vire `feeAccount` por descuido.

### A divulgação, que sobe JUNTO com a cobrança

⚠️ **Reter 1% sem dizer é o que a primeira pessoa a conferir no explorador
transforma em acusação pública — e isso não se recupera.** Por isso a taxa
aparece no card do swap, **antes da assinatura**, com o plano do usuário na
explicação: *"planos maiores pagam taxa menor"*. A escada vira oferta na tela,
não castigo descoberto depois.

**⚠️ E ELA APARECE MESMO QUANDO É ZERO.** `0%` e campo ausente são afirmações
diferentes: a primeira diz "medimos e não cobramos", a segunda não diz nada. Há
teste com mutação — esconder a linha quando a taxa é zero reprova.

### Solana SEM TAXA — por decisão, não por falta de endereço (11/08)

A carteira existe e está registrada. O que não existe é a conta de token, e a
decisão de não criá-la agora tem **quatro motivos**, três deles conferidos na
documentação oficial que o dono trouxe:

**1. ⚠️ O piso de 50 bps quebra a escada.** O `referralFee` aceita **50-255
bps**. Nossos degraus de `trader` (25) e `pilot` (10) ficam **abaixo do
mínimo**. Cobrar 50 na Solana faria o Pilot pagar **5×** o que paga em EVM — a
escada promete *"plano melhor paga menos"*, e isso a contradiz na cara do
cliente.

**2. ⚠️ Ligar a taxa TIRA o gás patrocinado do usuário.** A documentação de
gasless é explícita: a subvenção automática *"does not fire when
`referralAccount` and `referralFee` are set"*. Hoje, quem tem menos de 0,01 SOL
num swap acima de ~$10 tem o gás pago pela Jupiter. Cobrar 0,5% custaria ao
usuário **mais que 0,5%** — e justamente ao usuário novo, que é quem menos tem
SOL.

**3. A Jupiter aparentemente retém 20% da taxa.** Visto no deck, **não** no
spec — marcado como A CONFERIR. Se for verdade, 1% cobrado vira 0,8% recebido.

**4. O app roda na API sem chave** (`lite-api`, 0,5 req/s), que a própria
Jupiter não recomenda para produção. Cobrar taxa de cliente dependendo do nível
gratuito é frágil na ordem errada.

**⚠️ O que isto NÃO é:** não é *"esquecemos de configurar"*. Ligar depois é uma
linha — preencher `CONTA_TAXA_SOLANA` com uma ATA criada. O que está registrado
é o **porquê** de não estar ligado, com teste exigindo que os motivos existam,
para que a leitura de amanhã seja *"decidimos"* e não *"falta"*.

**Nada disso afeta a EVM**, onde a escada inteira funciona e o valor chega
integral.

## 9.3 — o painel 💵 RECEITA DE TAXA (11/08)

**⚠️ O REAL E A PROJEÇÃO FICAM SEPARADOS**, com rótulos e cores diferentes.
Colar os dois produziria exatamente o número que este laboratório passou nove
fases evitando: uma projeção lida como resultado. O bloco de cima diz
*"MEDIDO — o que de fato passou pelo livro"*; o de baixo, *"PROJEÇÃO —
aritmética sobre volume HIPOTÉTICO, não previsão"*.

- **A receita real é um TETO, não uma estimativa.** O livro **não guarda o
  plano** de quem operou, então não há como saber quanto cada operação teria
  pago. Calcular a 1% dá o limite SUPERIOR do que teríamos arrecadado, e a tela
  diz isso no próprio rótulo. Um número menor exigiria um dado que não existe.
- **O tráfego de sonda sai da conta.** O banco de ataque grava operações com
  `volume_usd = 0` de propósito; contá-las inflaria a amostra com o nosso
  próprio teste. A tela mostra quantas foram excluídas.
- **Os motivos da Solana aparecem no painel**, não só no código.

## ⚠️ A PENDÊNCIA QUE FICA ABERTA — o teste de US$ 20

**A Fase 9 está 🟢 no que ela construiu e 🔴 no que ela ainda não provou.** Os
testes garantem que nós PEDIMOS a taxa corretamente; nenhum deles garante que
o agregador ATENDEU e que a transferência aconteceu na cadeia. São coisas
diferentes, e as quatro possibilidades — cobrada certo, ignorada, desviada,
retida pelo agregador — **pintam a mesma linha na tela**.

O dono decidiu em 11/08: *"o teste de 20 dólares faremos por último, pode fazer
merge"*. O merge foi feito; o teste continua devendo.

**Passo a passo em [`TESTE-DA-TAXA-EVM.md`](TESTE-DA-TAXA-EVM.md)** — troca de
US$ 20 na Base, ETH → USDC (a taxa é cobrada no token de saída, e USDC lê-se
direto no explorador), com conferência do destinatário caractere por caractere.

> ⚠️ Enquanto ele não passar, o bloco MEDIDO do painel 💵 conta operações de
> 13 a 18 de junho — **anteriores à cobrança existir**. Receita ali é teto
> aritmético sobre volume que nunca pagou taxa nenhuma. O primeiro dólar de
> verdade é esse teste.
>
> ⚠️ E ele cobre o 0x (mesma cadeia). A **LI.FI** é outro caminho de código,
> com a taxa em fração em vez de pontos-base, e fica sem prova própria — um
> segundo teste atravessando cadeias cobre o que este não cobre.

## O plano pago da Jupiter — o que ele muda

Perguntado pelo dono. A resposta está na própria documentação: *"All plans use
the same API and have the same data freshness and latency. **Upgrading a plan
only increases your rate limit and included credits**."*

| motivo de a Solana não cobrar | o plano Pro resolve? |
|---|---|
| piso de 50 bps quebra a escada | ❌ é o Referral Program, não a API |
| ligar a taxa tira o gás patrocinado | ❌ idem |
| retenção de 20% | ❌ idem |
| **API sem chave, 0,5 req/s** | ✅ vai a 150 req/s |

**Ou seja: o Pro resolve UM dos quatro, e é o menos importante.** Ele não
destrava a Solana. E $500/mês contra $63 de volume histórico não fecha — se o
gargalo for taxa de requisição, o **Free COM chave** (1 req/s, créditos
ilimitados) já dobra o que temos hoje e custa zero.

---

### FASE 10 — O livro e a tela dizem a mesma coisa · 🟢

*Nenhuma estratégia nova é medida nesta fase. Ela existe porque a auditoria de
estado achou onze linhas em que a tela conta uma história e o `lab_results`
conta outra — e em nove delas a tela conta a história mais favorável.*

## Verificação de estado (11/08) — e o que ela achou

Consulta ao banco, não à memória. Das **28 estratégias**, cruzando
`lab_strategies.status` (o que a tela pinta) com o veredito da última rodada
`ok` em `lab_results`:

| estratégia | a tela diz | o livro diz | a distância entre as duas |
|---|---|---|---|
| `grid_bot` | cinza — *"não medida"* | **−54,19%** do capital, 10 rebalanceamentos | a mesa perdeu metade do dinheiro e a tela diz que ninguém olhou |
| `momentum_rotation` | cinza — *"não medida"* | **−3,01%** por período, 9 rebalanceamentos | idem |
| `dex_cex_arb` | cinza — *"não medida"* | veredito **MORTA**, −0,337% | o livro reprovou e a tela não conta |
| `amm_lp` | cinza — *"não medida"* | **EMPATE** medido, +0,55% dentro de ±3,68% | a medição mais cara da Fase 8 aparece como se não existisse |
| `covered_call` | cinza | +0,62 pt **abaixo da margem** | inconclusiva vira "não medida" |
| `restaking` | cinza | 2 produtos, **abaixo do piso de 3** | idem |
| `carteira_verde` | **morta** | veredito gravado `cinza`, 2,66%/ano contra 3,13% | o registro anda na frente do que o livro registrou |
| `trend_ma50_long_short` | **verde** | **zero rodadas** | veredito sem parcela |
| `trend_ma50_long_only` | **verde** | **zero rodadas** | idem |
| `buy_and_hold` | **verde** | **zero rodadas** | idem |
| `regime_filter`, `playbook_short` | **morta** | **zero rodadas** | idem, do outro lado |

**Onze linhas de 28.** E o viés tem direção: das nove primeiras, oito
escondem um resultado RUIM atrás de "não medida", que é o estado que não pede
nada de ninguém.

## O diagnóstico — não é desleixo de atualização, é vocabulário curto

`cinza` está fazendo **quatro trabalhos diferentes** ao mesmo tempo:

1. **nunca medida** — `quarterly_basis`, `concentrated_lp`, `bridge_arb`…
2. **medida, e deu EMPATE** — `amm_lp`, cuja vantagem cabe dentro da faixa que
   a própria medição não distingue
3. **rodou e não deu para concluir** — `restaking` (2 produtos, piso é 3),
   `covered_call` (dentro da margem)
4. **não é mensurável com fonte que a gente alcança** — `liquidations`,
   `airdrop_points`, `launchpad`, `governance_bribes`, triadas assim em 09/08

**Os quatro pedem coisas diferentes de quem lê.** O primeiro pede *"vá medir"*.
O segundo pede *"não perca tempo, já foi medido e não há vantagem"*. O terceiro
pede *"remeça com mais amostra"*. O quarto pede *"pare de olhar"*. Colapsados
num cinza só, todos pedem a mesma coisa: nada.

> Isto é a invariante nº 6 na sua forma mais cara. Ela diz *"agregado sem
> parcela não é auditável"*; esta fase acrescenta a irmã dela: **estado sem
> decisão associada não é estado, é decoração.** O teste de um estado novo é
> conseguir escrever o que ele manda fazer — se dois estados mandam a mesma
> coisa, é um estado com dois nomes.

## ⚠️ O ACHADO QUE FECHA A FASE: a distinção JÁ EXISTE no código

Cinco dos sete módulos de medição — `variancia`, `dex-cex`, `combinacao`,
`rendimento`, `coberta` — já devolvem um campo `readable: boolean` ao lado do
status. Ele separa exatamente o que falta:

- `readable: false` + cinza → **não deu para ler** (amostra, dado ausente)
- `readable: true` + cinza → **leu, e não há vantagem**

**E esse campo é jogado fora na hora de gravar.** `RunResult.verdict` aceita só
`"verde" | "cinza" | "morta"`, então o `readable` morre no ponto de contato com
o livro. A informação foi produzida, custou rodada, e não chegou à tabela.

O `liquidez` é o caso pior: ele nem tem `readable`, e devolve `cinza` para três
situações distintas — piso de amostra, gás não lido, e o EMPATE que ele próprio
escreve com essa palavra em maiúsculas no texto do veredito. **O texto sabe; a
coluna não.**

## O que esta fase faz

**1. O vocabulário ganha os estados que faltam** — em `LabStatus` e na coluna
`verdict`, com a mesma lista nos dois:

| estado | o que significa | o que ele MANDA fazer |
|---|---|---|
| `verde` | medida, positiva | pode promover |
| `morta` | medida, negativa | não voltar sem hipótese nova |
| `empate` | medida bem, e a vantagem cabe dentro da incerteza da própria medição | não promove — e não adianta remedir com o mesmo método |
| `inconclusiva` | rodou, e amostra ou dado ausente impede concluir | **remedir**, e o texto diz o que falta |
| `cinza` | não medida | medir |
| `nao_mensuravel` | não dá com fonte que a gente alcança | parar de olhar — e exige o motivo escrito |

**2. `nao_mensuravel` exige motivo, no tipo e no banco.** Sem isso ele vira o
novo cinza: um lugar onde coisa difícil se esconde. As quatro da triagem de
09/08 recebem o motivo que já estava no plano e nunca esteve no dado.

**3. `medidaFora` para veredito medido em outro livro.** As três verdes de
tendência e o comprar-e-segurar foram medidos na Fase 1, pelo painel 🧭, fora
do `lab_runs`. **Fabricar uma linha de rodada com números copiados à mão seria
inventar parcela** — o oposto do que a tabela existe para fazer. Elas ganham um
campo que diz ONDE a medição vive, e o detector para de reclamar delas por esse
motivo, e só por ele.

**4. `conferirLivro()` — o detector, para não drenar de novo.** Função pura que
cruza registro × livro e classifica a discordância:

- `veredito_sem_parcela` — verde/morta/empate com zero rodadas e sem `medidaFora`
- `livro_discorda` — o veredito da última rodada difere do status do registro
- `medida_mas_cinza` — tem rodada `ok` e o registro insiste em cinza
- `sem_motivo` — `nao_mensuravel` sem porquê escrito
- `rodada_pendurada` — rodada em `rodando` que nunca fechou

**Ele vai para a TELA**, no topo do laboratório, com a contagem. Um detector que
só existe no teste checa o código de ontem; na tela ele checa o dado de hoje —
e é o dado que apodrece.

## O que a conferência achou depois de tudo — 6, e todas da mesma classe

Rodada contra o banco de verdade, com o registro já corrigido:

```
[livro_incoerente] LP em AMM clássico       · rodadasOk=6, verdict='cinza'
[livro_incoerente] Grade (grid)             · rodadasOk=2, verdict='cinza'
[livro_incoerente] Rotação por momento      · rodadasOk=2, verdict='cinza'
[livro_incoerente] Venda de opção coberta   · rodadasOk=2, verdict='cinza'
[livro_incoerente] Restaking                · rodadasOk=4, verdict='cinza'
[livro_incoerente] Carteira das verdes      · rodadasOk=2, verdict='cinza'
```

**Uma rodada que FECHOU não pode ter gravado "não medida".** As seis são linhas
escritas antes desta fase, quando `cinza` era o único destino para empate,
inconclusivo e "perdeu dinheiro mas bateu o índice". Os números e os textos
delas estão certos — só o rótulo não tinha para onde ir.

⚠️ **E a correção é REMEDIR, não reescrever a coluna.** A conta é a mesma
(mesma série, mesma janela) e o veredito sai com a palavra certa. Editar
`lab_results.verdict` à mão gravaria veredito que medição nenhuma produziu —
que é exatamente o defeito que o `measuredElsewhere` existe para não cometer do
outro lado. São seis botões no painel.

⚠️ **E o tipo `livro_incoerente` não é trava de mutirão.** Qualquer defeito
futuro que grave `cinza` numa rodada `ok` cai nele, mesmo que registro e livro
"concordem" — é uma trava permanente contra a classe, não a limpeza de uma vez.

## A ordem de aplicação, que não é livre

⚠️ **A migração vem ANTES do deploy do código.** A restrição
`check (status in ('verde','cinza','morta'))` está no banco. Código novo
mandando `empate` para um banco velho faz o `syncRegistry` estourar, e ele roda
no GET do laboratório — o painel inteiro cai com 500. Migração primeiro,
código depois.

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
| 4.5 · Combinar as verdes | 🔴 **hipótese refutada 08/08** — ρ=0 e ainda assim concentrar ganha |
| 5 · Opção coberta | ⚪ **INCONCLUSIVA 09/08** — prêmio +5,7 pts medido; coberta +0,62 abaixo da margem, e condicional a mercado lateral |
| 6 · DEX ↔ CEX | 🟡 **2ª rodada 09/08** — MORTA, mediana −0,32%; 3 defeitos corrigidos, falta reconfirmar |
| 7 · Automação por API | 🟢 **pronta e FECHADA 09/08** — chave verificada antes de ir para o servidor; trava nas 3 portas; carteiras piloto para teste com dinheiro real; os 3 kill-switches da plataforma finalmente lidos |
| 8 · Cinzas restantes | 🟡 **8.2 rodada 10/08** — C9 e C10 batem o índice PERDENDO dinheiro; o caixa ganhou das duas (invariante nº 18). Falta reconfirmar |
| 9 · Receita | 🟢 **construída 11/08** — cobrança nas EVM com divulgação; Solana sem taxa por decisão; painel 💵 separando MEDIDO de PROJEÇÃO. 🟢 **cobrança CONFIRMADA 11/08 10:42** — o 0x devolveu `integratorFee` de 0,092016 USDT em swap de $9,19 (1,0000%). Quatro defeitos empilhados no caminho; o principal era a cotação FIRME nunca mandar a taxa. Falta só a conferência no explorador ([`TESTE-DA-TAXA-EVM.md`](TESTE-DA-TAXA-EVM.md)) |
| 10 · O livro e a tela | 🟢 **concluída 11/08** — vocabulário de 6 estados (era 3), registro alinhado ao livro, detector de discordância na TELA. Restam 6 rodadas a remedir, listadas pelo próprio detector |

Atualizar este quadro a cada entrega — regra da casa.
