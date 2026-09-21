# ENTREGA — ROUND 9 CIRÚRGICO (A131 … A145 + INVARIANTES Q e F)

**Papel:** implementador. A certificação é do auditor independente.
**Status máximo declarado:** `FIXED — PENDING INDEPENDENT RETEST`.
Nenhum finding está CLOSED. Nada foi aplicado, deployado ou mergeado.

---

## 1. Onde está

| | |
|---|---|
| Repositório | `zetta-world/swap-z-app` |
| Branch | **`round9-surgical`** (publicada) |
| Baseline | `83c50fe3acb8f019cd56ed2018f712cd0f2acf49` (Round 8 final) |
| HEAD final | `3b39e08` (+ este documento) |

História **linear e preservada**: nenhum commit do Round 8 foi amendado,
rebaseado ou reescrito. A branch carrega o Round 8 inteiro abaixo do Round 9.

## 2. Commits

| hash | o quê |
|---|---|
| `38569d3` | **A133** — leitura do livro de posições falha FECHADO |
| `105daed` | **A132** — uma reserva diária só, nos dois canais |
| `1c97be2` | **A131 + A131-C** — livro único + projeção idempotente (migration 0064) |
| `9ef7f12` | SPEC do Round 9 |
| `c2f3d82` | correções da revisão adversarial |
| `c3b9ac8` | **A134 + A135 + A136** — reservas atômicas, liquidação numa transação |
| `319a973` | **A137 + A138 + A139** — reserva com dono, P&L exactly-once, saída com identidade |
| `58529e8` | **A140** — taxa acumulada e P&L do recovery, exatamente uma vez |
| `1f8547e` | **A141 + A139-H** — rollback da reserva composta, null é divergência |
| `9293056` | **A142** — o recebido também tem delta |
| `3b39e08` | **A143 + A144 + A145** — assentar antes de liquidar, terminal com fill compromete, custo tardio da compra |
| `b20e025` `08a3b4d` `34f57f2` `577c587` `e22e50d` | documentação de cada adendo |

## 3. Diff

```
git diff 83c50fe..HEAD --stat
 36 arquivos · +8581 −438
```

Migrations:

```
git diff 83c50fe..HEAD  -- supabase/   → só 0064_autopilot_projecao_de_posicao.sql
git diff 15b89c8..HEAD  -- supabase/   → 0063 + 0064
```

0059–0062 com diff vazio. **Nenhuma migration aplicada, em ambiente nenhum.**

---

## 4. A133 — "sem posição" e "não consegui ler" pararam de ser a mesma coisa

`getOpenServerPositions` devolvia `[]` para leitura vazia legítima **e** para
erro de banco. Quem chama opera sobre `[]`: `exposureUsd` vira 0, `ownedBases`
vira vazio, e o teto de exposição libera o valor inteiro de novo. Um Postgres
intermitente era licença para comprar.

O conserto já estava escrito **uma camada acima** — `reconciliar-conta.ts`
documenta em maiúsculas que falha de leitura é `leitura_falhou` e bloqueia
entradas — mas quem engolia o erro era a função abaixo dela.

- leituras devolvem resultado discriminado; sem banco é **falha**;
- `recordServerEntry`, que concluía "não existe posição" de um `select` cujo
  `error` era descartado, **deixou de existir** (ver §6);
- o cron **para a passada** quando o livro não pode ser lido: zero scan, zero
  ordem nova, evento `autopilot_livro_ilegivel` em severidade alta. O recovery
  de ordens já enviadas roda fora dessa função e continua.

## 5. A132 — uma única forma de gastar a vaga do dia

O Round 8 consertou metade: o navegador RESERVAVA antes do envio; o cron
somava depois, com `bump_session_trades` — que é `trades_today + n`, **sem
conferir teto**.

```
trades_today = 4, max = 5
navegador lê 4 → CAS → 5
cron já tinha lido 4 → envia → soma → 6
```

O Round 8 declarou essa corrida como limitação conhecida e disse que fechá-la
exigiria RPC nova. Não exigiu: o cron passou a usar a MESMA reserva, na mesma
costura `ReservaDeRisco` do executor, **antes** do envio.

- `reservaDaVagaDiaria` é a primitiva única, chamada pelos dois canais;
- as quatro chamadas de `bumpSessionTrades` no cron saíram, e a função foi
  **apagada** (lápide no lugar): manter um caminho que soma sem teto é manter
  a arma carregada a uma linha de quem "só precisa contar um trade";
- `UNKNOWN` continua **não** devolvendo a vaga (INVARIANTE 4);
- uma vaga por ORDEM — cada perna de um cartão multi-perna reserva a sua.

Teste central: duas reservas concorrentes na última vaga, contra o CAS real —
exatamente uma vence, o contador fecha em 5, nunca 6.

## 6. A131 — uma resposta só para "o que o bot possui?"

Havia dois livros. O servidor (`autopilot_positions`, lido só pelo cron) e o
`localStorage` (lido só pela tela). O canal que dispara dinheiro real não
consultava nenhum dos dois:

```
posição do bot no servidor:  0,01 BTC
saldo do cliente na conta:   1,00 BTC
cartão do piloto pede:       VENDER 0,50 BTC
```

O cron limitava a 0,01 (`quantoPodeVender` — que tinha **um único caller**). A
`/api/cex/order` mandava 0,50, e 0,49 BTC do patrimônio do dono sairiam por um
mandato que o bot não tem.

**Venda autônoma** passa por `avaliarVendaAutonoma`: livro ilegível recusa,
sem posição recusa, saída já armada recusa, e pedir demais é **limitado à
posição** com evento nomeado. A quantidade autorizada — não `body.amount` —
desce para o guarda de nocional, a política, o executor e a resposta.

**Compra autônoma** passa pela exposição do servidor, com o MESMO
`RISK_EXPOSURE_USD` do cron. `localStorage` vazio não zera mais nada.

**`localStorage` virou cache**, e está escrito no cabeçalho do store e no
piloto: ele não decide quanto vender, se pode vender, nem quanta exposição
existe. Divergiu, o servidor ganha.

## 7. A131-C — o fill tardio chega ao livro, exatamente uma vez

O cron dizia por escrito *"posicao abre na reconciliacao"*. Não abria:
`reconciliarPendentes` nunca tocou em `autopilot_positions`. Uma limitada que
preenchesse dez minutos depois ficava fora do livro **para sempre**.

`autopilot_positions` tem `unique (session_id, base)`: uma linha por par, e
nada sobre QUAIS execuções já estão dentro dela. Daí a **migration 0064**
(criada, **não aplicada**): `autopilot_position_effects`, marcador durável por
intent, e uma RPC transacional que lê `filled_qty`/`filled_quote` do livro e
aplica `ledger − applied`.

Os quatro caminhos que mexem em posição passam pela mesma porta: cron imediato
(compra e venda), navegador imediato, e reconciliação tardia. `recordServerEntry`
foi removida — um segundo escritor é um segundo modelo do que o bot possui.

**Duas marcas d'água, e a razão:** a liquidação da saída armada aplica a
redução direto (o P&L é calculado contra a posição ainda inteira) e ABSORVE o
valor no marcador. Absorver adianta `applied`, e comparar a regressão contra
ele acusaria regressão sempre que a liquidação chegasse antes da ingestão dos
fills. Então `applied` (o que entrou na posição) e `ledger` (o que o livro
dizia) são colunas diferentes. **Esse defeito foi meu, encontrado ao escrever
o próprio teste.**

## 8. A revisão adversarial encontrou seis P0 — e três eram meus

Rodou em sessão separada, 22 vetores. O que ela achou e o que foi feito:

| # | achado | conserto |
|---|---|---|
| P0-1 | `sessaoDoPilotoId` era atribuído **depois** dos dois portões que o leem, com `?? ""` por cima. Toda venda e toda compra do navegador respondiam `livro_ilegivel`: **o canal estava morto**, e a posse nunca foi medida contra a sessão real | atribuição movida para antes dos portões, `?? ""` removido, falha fechada sem id |
| P0-2 | nenhum teste podia ver: todos os mocks ignoravam os argumentos | os testes passaram a afirmar **a pergunta** — com que `session_id` o livro foi consultado |
| P0-3 | a projeção reduzia/apagava a posição que `settleArmedExits` precisa inteira para realizar P&L. **O prejuízo do dia deixava de ser contado** | saída armada pertence à liquidação: a projeção devolve `saida_em_liquidacao` e não toca |
| P0-4 | num PARCIAL, a RPC limpava `status`/`exit_order_id` de uma ordem ainda viva → a passada seguinte armava uma **segunda venda da mesma bolsa** | o parcial não desarma nada |
| P0-5 | projeção que falha depois do fill era **permanente** (`FILLED` é terminal), e o comentário prometia o contrário | varredura `autopilot_projecoes_pendentes` (na mesma 0064), retentada pelo cron a cada passada |
| P0-6 | o caminho INCERTO que a reconciliação imediata prova ter executado **não projetava nada** | uma porta só (`projetarOuAvisar`), usada pelos dois caminhos |
| P1-1 | o navegador marcava `exit_armed` só no `localStorage` | passa a marcar no servidor |
| P1-8 | o P&L da venda do navegador existia só no `localStorage`: a sessão que congela nunca via a perda | realizado no servidor (recebido − custo removido − taxa) |
| P1-4 | `settle` absorvia no marcador **antes** de escrever; escrita falha deixava "já aplicado" para sempre | absorve depois, e só se a escrita entrou |
| P2 | base de `BTC-USDT`; contenção do CAS se passando por `limite_diario`; `reserva_negada` como 500; `reduzirServerPosition` fora da trava de escritas; comentário do "contador incremental" que o A132 tornou falso | todos corrigidos |

**Um achado não se sustentou:** P1-2 (posse não escopada por corretora).
`autopilot_sessions` é `unique (wallet_address, exchange_id)` e
`getSessionStatus` filtra por corretora — o `session_id` já é o escopo da
venue. Reportado como não reproduzido.

## 8-BIS. O adendo do auditor — três P0 de concorrência

Lendo a branch, o auditor apontou que o Round 9 tinha trazido posse e exposição
para o servidor e parado em **ler, conferir, agir**.

| # | achado | conserto |
|---|---|---|
| **A134** | uma posição autorizava DUAS vendas concorrentes: as duas leem `base_amount = 0,01` e as duas mandam 0,01 — e 0,01 é do dono | `autopilot_reservar_venda`: a quantidade é tomada dentro da transação que confere (`for update` na posição) |
| **A135** | o teto de exposição tinha a mesma forma: 190 + 10 e 190 + 10 passavam as duas num teto de 200 | `autopilot_reservar_exposicao`: soma a exposição real **e** o que já está prometido, com a linha da sessão travada |
| **A136** | o marcador e a posição eram duas escritas na liquidação da saída armada. Marcador na frente: a reconciliação vê delta zero para sempre. Posição na frente: reduz de novo. **Eu havia "consertado" invertendo a ordem** — o que só escolhe qual dos dois acontece | `autopilot_liquidar_saida_armada`: uma transação |

**Devolução das reservas:** só na recusa **provada** — inclusive nas que
acontecem antes de o executor tomar a reserva dele (kill-switch, credencial), e
que nunca passariam pelo `liberar` dele. `UNKNOWN` não devolve nada: a ordem
pode estar viva, e soltar a bolsa autorizaria a segunda venda. E elas
**expiram**, porque reserva que sobrevive a uma ordem que nunca existiu tranca
a posição para sempre.

**Efeito colateral do A136:** `closeServerPosition` e `reduzirServerPosition`
ficaram sem caller — eram os últimos escritores paralelos de posição. Apagados,
com a lápide que explica por quê (e com a cicatriz do A14 que uma delas
carregava, que agora mora dentro da RPC).

## 8-TER. Segundo adendo — A137, A138, A139

O auditor leu a branch de novo e mostrou que as reservas que eu tinha acabado
de criar estavam, elas mesmas, erradas — e que duas coisas que elas tocam não
tinham exactly-once nenhum.

| # | achado | conserto |
|---|---|---|
| **A137** | a reserva era um **contador agregado com prazo de 10 minutos**. O prazo esquecia ordem VIVA: uma limitada aceita sem preencher liberava o compromisso, a segunda entrada passava, e as duas preenchiam. E sem dono, projetar uma ordem antiga podia **comer o compromisso de outra mais nova** | a reserva pertence ao **intent**; compromisso vivo é `greatest(reservado − aplicado, 0)` enquanto ele puder preencher, e ZERO quando está provadamente morto. **Não há prazo** |
| **A138** | o P&L era uma **segunda escrita**. Gravando o P&L e falhando a posição, a passada seguinte somava o mesmo resultado; gravando a posição e falhando o P&L, o débito sumia | o resultado entra na MESMA transação que reduz a posição, e `pnl_aplicado_usd` guarda quanto deste intent já entrou |
| **A139** | a liquidação redescobria o intent por `external_order_id` — que **não é identificador global** — e perguntava à venue com a credencial **atual** da sessão, violando o A127 | `autopilot_positions.exit_intent_id`; a liquidação carrega a credencial por `intent.conexao_id` e a RPC confere a identidade inteira. Legado sem elo vira mão humana |

**Consequência de desenho:** a costura do executor passou a receber o
`intent_id` (ele já existe entre AUTHORIZED e SUBMITTING). A rota e o cron se
dividiram em **pré-voo que DIMENSIONA** — a quantidade precisa existir antes do
intent — e **reserva que AUTORIZA**. Reserva parcialmente concedida é recusa
ali: a linha já foi gravada com a quantidade, e conceder menos a faria mentir.

**E mais duas funções morreram:** `applySessionPnl` e `realizedFromSell`. Com o
P&L dentro da transação, elas eram o último escritor financeiro solto.

### Dois testes MEUS estavam fracos, e eu os reescrevi

1. A trava da credencial histórica casava com a palavra
   `credenciaisDoIntentParaRecovery` em qualquer lugar do cron — e o import do
   **reconciliador** já a satisfazia. Ela passou **antes** do conserto existir.
2. O teste de P&L comparava o `pnl_today` com o `realizado` que a própria
   chamada devolvera. Um cálculo que ignorasse o marcador inflava os dois lados
   e passava incólume. Agora os números são absolutos (20 + 20 = 40, nunca 360).

## 8-QUATER. Patch cirúrgico final — A140, A141, A139-H

| # | achado | conserto |
|---|---|---|
| **A140** | `fee_total` é CUMULATIVA (0059) e era descontada **inteira a cada parcial**: 320/taxa 1 + 640/taxa 2 fechava 37 em vez de 38. E o valor vinha de QUEM CHAMAVA — a varredura de recovery projetava com taxa **zero**, então o mesmo preenchimento rendia P&L diferente conforme quem o descobrisse. O dia do freeze também vinha de fora, e `null` fazia o stop de perda **não congelar** | watermark `fee_aplicada_usd`; a taxa é derivada do livro dentro do banco; o dia é o relógio do banco; ramo `ajuste_de_taxa` para taxa que cresce sem quantidade; `regressao_de_taxa` fail-closed; a varredura enxerga taxa pendente |
| **A141** | a reserva composta gastava a vaga diária e, recusando na segunda etapa, devolvia só o inventário — **zero ordem enviada e `trades_today` um a mais** | rollback dentro do `reservar` composto, nos dois canais; `liberar` relata se o CAS devolveu, e falhar é evento de severidade alta |
| **A139-H** | `external_order_id` só comparava quando os dois lados eram não-nulos — posição armada em `EXT-1` com intent sem ordem passava | `is distinct from` |

**O contrato dos quatro watermarks** ficou escrito onde eles são declarados:
`applied_qty` e `applied_quote` são as entradas da conta, `fee_aplicada_usd` é o
que já foi descontado, e `pnl_aplicado_usd` é o que a conta produziu. Cada delta
avança os quatro na mesma transação.

## 8-QUINQUIES. A revisão adversarial achou um P0 dentro do próprio A140 — A142

O A140 deu delta próprio à **taxa** e ninguém deu ao **recebido**.
`filled_quote` cresce com `filled_qty` parado: a corretora nem sempre devolve
`cost` no ACK, o executor manda `cumulativeQuote = 0`, e o valor real só chega
com os trades. Com o P&L atrás de `v_delta_quote > 0`:

```
1ª projeção: qty 0,01 · quote 0  → posição FECHADA, US$ 600 de custo saem
                                   do livro, e ZERO entra no pnl_today
2ª projeção: quote 640 chega     → `sem_delta`
```

O resultado do dia sumia. Com o preço para o outro lado é o **prejuízo** que
some, e o stop de perda nunca dispara. E a **mesma venda** descoberta pela
liquidação dava `−600` (o `order.cost` virava 0 sem guarda) e **congelava a
sessão o dia inteiro**: dois descobridores, duas respostas erradas.

**O conserto foi parar de somar deltas independentes:**

```
realizado_total = applied_quote − custo_removido_usd − fee_aplicada_usd
delta           = realizado_total − pnl_aplicado_usd
```

com o watermark novo `custo_removido_usd` e uma regra: **enquanto não houver
recebido, não se conta resultado** — a redução fica guardada e espera. A ordem
de chegada dos fatos deixou de importar.

| # | achado | conserto |
|---|---|---|
| P0-1 | recebido sem delta: resultado some (ou infla) | conta acumulada + `custo_removido_usd` |
| P0-2 | liquidação sem `cost` lançava `−custo` e congelava o dia | sem recebido, sem resultado |
| P1-3 | freeze do fill tardio chegava uma passada atrasado | a varredura roda **antes** do laço de sessões |
| P1-4 | fill posterior ao fechamento relistava `sem_posicao` por 3 dias | `posicao_ja_encerrada`: receita sem custo novo entra |
| P2-5 | o aviso de CAS falho só existia num dos quatro pontos — **e a entrega afirmava o contrário** | o `liberar` composto avisa nos três do executor também |
| P2-6 | teste do A141 fazia grep no fonte com `recordEvent` mockado como lambda vazia | `vi.fn()` e asserção no evento emitido |
| P2-7 | a varredura descartava `realizado` e a bandeira de taxa opaca | registra os dois |
| P2-9 | `markServerExitArmed` dizia OK sem casar linha | `.select("id")` |
| P2-10 | `catch` mudo entre a escrita e o espelho em memória | `autopilot_settle_interrompido` |
| — | `taxaEmUsd` importado sem chamada nos dois arquivos, com três comentários dizendo que a conversão "continua aqui" | imports e comentários removidos |
| — | o falso não conferia `session_id` na liquidação, o SQL conferia | falso alinhado |

⚠️ **Dois testes meus estavam fracos**: a trava do A141.6 fazia grep no fonte
(com `recordEvent` como lambda vazia, trocar a chamada por um comentário
mantinha o verde), e o mapeamento de motivos no wrapper caía em `"aplicado"`
por padrão — foi isso que escondeu o ramo novo no primeiro teste do A142.

## 8-SEXIES. Terceiro adendo — A143, A144, A145

### A143 — a conta era feita sobre um livro que ninguém tinha escrito

`settleArmedExits` perguntava à corretora e liquidava na sequência.
`fetchCexOrderStatus` **não escreve** em `cex_execution_intents`, e desde o
A140 a RPC deriva a taxa do LIVRO — e com razão, porque a varredura de
pendências não tem a resposta HTTP na mão cinco minutos depois. Com o livro
parado, essa taxa é ZERO:

```
venue:  filled=0,01 · cost=580 · fee=2
livro:  filled_qty=0 · filled_quote=0 · fee_total=null
conta:  580 − custo − 0      ← a taxa sumiu
```

O prejuízo chegava menor ao `pnl_today`, o stop de perda diária não disparava,
e o cron seguia para a seção de entrada **na mesma passada**. O freio foi
furado por um dado que existia e não tinha sido gravado.

A ordem agora é: perguntar → **ingerir** (`cex_ingest_order_snapshot`) →
**confirmar relendo a linha durável** → liquidar com `filled_qty`/
`filled_quote` do livro. A taxa NÃO volta a ser autoridade do TypeScript. A
sequência mora num módulo só (`src/lib/autopilot/assentamento-da-saida.ts`),
para existir um caminho a testar em vez de uma ordem de chamadas reproduzida à
mão dentro do cron.

Falhando o assentamento: saída fica ARMADA, ZERO P&L pela metade, evento em
severidade alta, e a sessão **não abre entrada nova nesta passada**
(`fatosNaoAssentados` entra no mesmo portão de `livroLegivelNoSettle`).
Falhar na LIQUIDAÇÃO não fecha a sessão — o fato já está no livro e a varredura
de pendências volta nele.

### A144 — `CANCELED` não desfaz preenchimento parcial

`autopilot_compromisso_vivo` mandava `CANCELED` e `FAILED_PRE_SUBMIT` para
zero, juntos:

```
posição 0,01 · A reservou 0,01, preencheu 0,004, applied 0, CANCELED
→ compromisso 0 → B via 0,01 disponível → B vendia 0,01
→ 0,004 + 0,01 = 0,014 vendidos de uma bolsa de 0,01
```

Na compra o mesmo buraco furava o teto: reserva de 40 com 30 preenchido e
cancelada liberava os 40 inteiros. Três faixas agora — `FAILED_PRE_SUBMIT` é o
único zero incondicional; terminal com fill mede o EXECUTADO; estado ainda
preenchível mede o RESERVADO. Unidade certa em cada lado: `filled_qty` na
venda, `filled_quote` na compra.

### A145 — a base de custo da compra tardia era perdida para sempre

O ramo `ajuste_sem_quantidade` tratava só a venda. Numa COMPRA ele avançava
`applied_quote` e ia embora: marcador dizendo "600 aplicados" e `cost_usd`
em ZERO. É o caso comum — ACK sem `cost`, quantidade cheia, dinheiro só nos
trades depois. Exposição subavaliada (o bot compra mais do que pode) e a venda
futura calculando `recebido − 0 − taxa`: lucro inventado do tamanho da compra.

O delta de quote passou a entrar em `cost_usd` (e em `entry_price`) **sem
tocar em `base_amount`**, na mesma transação que marca o quote como aplicado.
Sem posição onde entrar: `sem_posicao_para_custo`, fail-closed **visível**, e o
marcador NÃO avança.

### Auditoria obrigatória — sintético → real

`cex_ingest_trades` substitui os sintéticos pelos reais. Sintético ALTO (ACK
600, trades 580) faz `filled_quote` CAIR com `filled_qty` parado, e dois
`greatest()` escondiam a queda — na VENDA isso mantém o resultado calculado
sobre um recebido que não existiu, **US$ 20 otimista**, que é exatamente o
número do stop de perda.

Não é corrigido para baixo automaticamente: a conta acumulada do A142 saberia
aplicar delta negativo de P&L, mas a POSIÇÃO não sabe desfazer. Duas guardas
novas, simétricas às de quantidade e taxa — `regressao_de_quote` na projeção
(`filled_quote < ledger_quote`) e na liquidação
(`p_quote_recebido < applied_quote`). O livro de EXECUÇÕES continua certo; o
que para é a PROJEÇÃO daquele intent.

### Da minha própria revisão

Nada liquidado deixou de virar linha `settled`. O extrato que o dono lê
afirmava o contrário do evento de severidade alta emitido um instante antes —
nos dois ramos (fechada e cancelada com parcial).

## 8-SEPTIES. Fechamento da matriz — invariantes Q e F

### Q — o recebido tardio tem de entrar no ledger

O A143 assenta via `cex_ingest_order_snapshot`, e a definição herdada da 0059
não registrava crescimento de `cumulative_quote` com `cumulative_qty` parada.
Ela tratava ajuste de **fee**, não de **quote** — e escreveu a suposição por
extenso: *"fill sem qty só existe para carregar correção de fee, nunca
quote"*, com a constraint `qty > 0 or (qty = 0 and quote_amount = 0)` a
sustentar.

A ordem limitada real faz o contrário: ACK com `filled` e sem `cost`, custo
depois. O segundo snapshot caía no ramo errado e o recebido era descartado —
`filled_quote` ficava 0 para sempre, que é o número que o A143 e o A145 leem.

**A 0059 não foi tocada** (ela pode já ter sido aplicada). A 0064 refaz a
constraint (`qty >= 0`) e redefine `cex_ingest_order_snapshot` e
`cex_ingest_trades` com a mesma assinatura. Preservados: dedupe, fee
cumulativa, guarda de moeda, regressão de qty, atomicidade, synthetic→real.
Acrescentados: `p_cumulative_quote` nullable (**ausente ≠ zero**), delta de
quote no ramo sem crescimento, chave própria do ajuste (`ordadj:`), `regrediu`
cobrindo o recebido, e `cobertura_quote_incompleta` — porque `v_sint` soma
**qty** e um ajuste de recebido tem qty zero: sem ela, um lote todo dedupado
apagava o ajuste e `filled_quote` desabava de 600 para 0 sem nenhum trade novo.

### F — P&L incompleto não autoriza entrada

Taxa em moeda não precificável virava zero na conta, o resultado era afirmado
como exato, e o cron comprava. Fail-OPEN sobre o stop de perda.

Rodando a matriz final, o item 11 revelou um **segundo** motivo idêntico em
forma: venda cujo custo saiu do livro e cujo recebido a venue ainda não
informou. Medido antes do conserto — sessão −49, stop 50, base de custo 100,
venue com `filled` e sem `cost`: `pnl_today` seguia −49, `frozen_until_day`
null, portão de entrada **aberto**.

Duas colunas novas na 0064: `autopilot_position_effects.taxa_opaca` (por
intent) e `autopilot_sessions.contabilidade_incompleta_em` (**derivada** das
linhas de efeito, nunca escrita por quem chama).
`autopilot_marcar_contabilidade` roda dentro das duas RPCs, em sete pontos de
retorno, na mesma transação que moveu o dinheiro.

O bloqueio é **durável** porque precisa alcançar o navegador; é **só de
entrada** (saídas e recovery seguem); e a liberação é **determinável** — a taxa
vira precificável, o recebido chega, e a coluna é zerada sozinha. A bandeira
mora no efeito para que destravar um intent não destrave a sessão com outro
ainda aberto.

## 8-OCTIES. Patch final do item 11 — `NULL` não é taxa zero

A última linha que ainda juntava dois fatos diferentes:

```sql
when p_fee is null or p_fee <= 0 then 0
```

`p_fee = 0` é taxa **conhecida** e nula; `p_fee IS NULL` é taxa **ainda não
conhecida**. Devolver zero para a segunda é *"não medimos"* virando *"medimos
zero"* dentro do número que alimenta o stop de perda diária. A 0059 preserva a
semântica certa do outro lado — quem a perdia era esta conversão, a última
coisa que o P&L realizado lê.

O resto da cadeia já estava pronta desde o invariante F: `v_taxa_opaca` sobe, o
resultado não é afirmado como exato, `autopilot_marcar_contabilidade` prende a
COMPRA nos dois canais, e a bandeira some sozinha quando a taxa chega.

| momento | `fee_total` | P&L | `pnl_today` | portão |
|---|---|---|---|---|
| liquidação | `NULL` | não afirmado | −49 | **fechado** (`contabilidade_incompleta`) |
| taxa chega | `2 USDT` | delta −2 | −51, freeze | fechado (**loss-stop**) |
| replay ×3 | `2 USDT` | 0 | −51 | idem |

A diferença entre os dois freios é o achado inteiro: um é *"não sei o
número"*, o outro é *"sei o número e ele diz pare"*.

## 8-NONIES. A verificação do patch achou um fail-open no próprio patch

Uma rodada adversarial **sobre a mudança** (não uma auditoria nova) devolveu
dez observações. Duas viraram conserto; as outras, limitação declarada.

### Consertado — a bandeira desta passada não valia nesta passada

O cron carrega a linha da sessão UMA vez (`listRunnableSessions`) e a passada
**escreve** nela: `settleArmedExits` → `autopilot_marcar_contabilidade` →
`contabilidade_incompleta_em`. O portão de entrada lia a cópia em **memória** —
o valor de antes. A bandeira levantada nesta passada só valia na seguinte,
cinco minutos depois: o cron comprava no meio, com o P&L do dia sabidamente
incompleto.

O stop de perda já tinha contrapartida em memória por este motivo
(`pnlToday += settle.realizedDelta`); a contabilidade não tinha. E antes do
patch da conversão a leitura velha era inofensiva para este caso — `p_fee is
null` virava 0 e a bandeira nunca subia. **Foi o patch que a tornou
alcançável.**

Conserto: `relerBandeirasDaSessao(s.id)` depois do settle, tri-state, servindo
os **dois** portões. Falha de leitura ⇒ `contabilidadeIncompleta: true`. Um
espelho em memória não bastaria: a mesma coluna é escrita pela varredura de
pendências e pelo canal do navegador, fora daquela função.

### Consertado — o registro repetia a confusão que o patch desfez

`avisarTaxaNaoPrecificada` gravava `valor: Number(order.fee?.cost ?? 0)` e
`moeda: String(order.fee?.currency ?? "?")`. Uma taxa **não medida** chegava ao
painel como *"0 na moeda ?"* — quem investigasse leria "foi medida e é zero",
o oposto do fato, e é esse fato que mantém a sessão travada. Agora `null` sai
como `null`, com `taxa_ausente` e um `why` por caso. Três call sites.

### Não consertado, declarado

A trava sem soltura automática (venue que não reporta `fee` no `fetchOrder` —
o caso comum, não o exótico), `taxa_opaca` como bandeira e não supressão do
número, a perda do sinal `regressao_de_taxa` na direção `NULL`, e
`saida_em_liquidacao` sem marcador. Todos na seção 11.

⚠️ **A verificação não terminou.** Sete dos nove agentes morreram no limite de
sessão, incluindo TODOS os refutadores. Os dez achados vieram de dois finders e
foram conferidos à mão, um a um, contra o código — não por refutação
independente. O auditor deve tratá-los como não-refutados.

## 8-DECIES. Fechamento estrutural — e o banco real

### DATABASE INTEGRATION TEST: **PASS**

PostgreSQL 16.13 descartável (`initdb` local, porta 55432, socket em
`/var/tmp/zswap-pg`). **Nunca produção.** Arnês versionado em
`supabase/tests/`.

**Achado que só o banco mostra:** a 0063 usava `E'\0'` como separador do
advisory lock. PostgreSQL **não aceita NUL em `text`** — a criação da função
morria e a cadeia **parava na 0063**. Havia uma trava de teste *pinando o
construto quebrado*. Separador agora é `E'\x1F'`.

| teste | prova |
|---|---|
| cadeia | **64/64** migrations aplicam limpo |
| T1 | invariante Q: `qty=0` com `quote=100` aceito, `filled_quote` 0→100 |
| T2 | `NULL`/`0`/`2 USDT`/moeda opaca distinguidos |
| T3 | taxa ausente marca a contabilidade e **não** afirma P&L |
| T4 | a pendência terminal **é encontrada**, `precisa_venue=true` |
| T5 | trades trazem a taxa → delta −2, dia −51, freeze, bandeira limpa |
| T6 | exactly-once sob replay ×3 |
| T7 | 15 `security definer`, **todas** com `search_path` fixo |
| T8 | 13 RPCs financeiras fechadas para `anon`/`authenticated` |
| T9 | zero overload; a varredura antiga foi derrubada |
| T10 | 5 tabelas com RLS default-deny e sem leitura anônima |
| T11 / T11-BIS | `synthetic→real` preserva o recebido; o portão de quote segura sozinho |
| T12 | regressão de qty e de quote acusadas, livro intacto |

### CONCURRENCY INTEGRATION: **PASS**

Transações **de verdade**, em processos separados, disputando a mesma linha:

| cenário | resultado |
|---|---|
| duas SELL de 0,01 numa posição de 0,01 | A=0,01 · B recusa `quantidade_ja_reservada` · **total 0,01** |
| duas BUY de 10 com exposição 190, teto 200 | D concede · E recusa `teto_estourado` · **nunca 210** |
| liquidação × projeção do mesmo intent | LIQ aplica −2 · PROJ serializa e devolve `sem_delta` · **`pnl_today=−2`** |

E a quebra que só o banco real prova: removendo o `for update` da reserva, as
duas concorrentes concedem 0,01 → **total 0,02** numa bolsa de 0,01.

## 8-UNDECIES. Retest independente FAIL — os cinco CR

O Codex reproduziu tudo o que a entrega anterior declarava (3836 testes, 64/64
migrations, T1–T12, ACL, RLS, concorrência) **e** cinco falhas financeiras.
Todas reproduzidas aqui antes de qualquer conserto.

### A raiz comum de CR-3, CR-4 e CR-5

O cron decidia dinheiro sobre **cópias do estado financeiro com idades
diferentes**: `s` carregado antes do recovery, `pnlToday`/`frozenUntil` em
memória, bandeiras relidas pela metade, `entradasLiberadas` calculado uma vez
antes do laço de cartões — e o banco sendo escrito por projeção, liquidação e
recovery no meio de tudo. O banco dizia uma coisa e a autorização usava outra.

**Conserto estrutural:** `src/lib/autopilot/estado-financeiro.ts` passa a ser
a única fonte de autorização de risco. `lerEstadoFinanceiroDaSessao` traz
TODOS os campos que autorizam (ativa, validade, pnl, stop, freeze, dia,
contador, teto, conexão, quarentena, contabilidade); `avaliarRisco` avalia
todos numa ordem só, incluindo o stop de perda sobre o **número** durável e
não só sobre a marca. `autorizarAumentoDeExposicao` lê **no instante** de cada
COMPRA, e é chamada pelos DOIS canais. Os espelhos parciais foram removidos —
o cron não lê mais nenhum campo financeiro do snapshot, e uma trava de teste
garante isso (a única exceção é a linha de base do alerta "congelou agora",
nomeada para não virar porta).

E a virada do dia saiu do TypeScript: `autopilot_aplicar_pnl` (0064) é o
**único** escritor de `pnl_today`/`frozen_until_day` e carimba
`last_reset_day` na mesma transação. Uma virada posterior encontra o dia já
carimbado e não tem o que zerar.

### CR-1 · CR-2

`autopilot_efeito_incompleto` ganhou duas faixas: **compra com quantidade
aplicada e custo desconhecido** (era invisível: o compromisso desabava e o
intent sumia do recovery) e **divergência registrada**. O compromisso vivo só
mede o executado quando o executado é conhecido — na compra ele é dinheiro, e
chega depois.

E a regressão de quote deixou de ser esquecida. Na **venda** ela é **corrigida
aritmeticamente** (o custo removido não muda; só a receita muda — a conta
acumulada do A142 produz o delta negativo sozinha: −30 + 80 − 100 − 2 = −52, e
o stop dispara). Na **compra** não há aritmética possível, então fail-closed —
com a divergência **gravada** em `autopilot_position_effects.divergencia`, que
alimenta o bloqueio e a lista de pendências.

## 8-DUODECIES. A paridade que o relatório afirmou e o código não tinha

O commit anterior dizia que `autorizarAumentoDeExposicao` lia o estado
financeiro **no instante de cada COMPRA, nos dois canais**. Era verdade no
cron e **falso** no navegador: a rota chamava
`avaliarRisco(estadoDaLinha(sessaoDoPiloto))` sobre a linha capturada no
começo da requisição.

Entre aquela leitura (`getSessionStatus`, linha ~305) e o envio (~835) passam
preço, exposição, certificado, política, cofre, decrypt, gravação do intent e
as reservas — todos com `await`. Nesse intervalo o cron ou o recovery podem
aplicar P&L, congelar o dia ou levantar a contabilidade incompleta, e o
navegador seguiria com o estado de antes.

**Onde o portão passou a morar.** Não numa linha a mais logo depois da
leitura, mas na costura de reserva — `reservar(intentId)`, que roda entre
`AUTHORIZED` e `SUBMITTING`. É o ponto mais tarde que ainda permite recusar
sem ter enviado nada: o intent durável já existe, e o passo seguinte é
`createOrder`. É uma **leitura**, não um lock: nenhuma transação PostgreSQL
fica aberta durante HTTP externo.

A leitura inicial continua, e continua útil — ela recusa cedo, antes de
decifrar credencial, e dá erro melhor ao usuário. O que ela deixou de ser é a
autoridade final de risco.

| | cron | navegador |
|---|---|---|
| portão | `autorizarAumentoDeExposicao(s.id)` antes de cada cartão de COMPRA | `autorizarAumentoDeExposicao(sessionId)` dentro de `reservar`, antes de SUBMITTING |
| fonte | leitura fresca do banco | leitura fresca do banco |
| saídas | não são presas | não são presas |

## 8-TERDECIES. A fronteira final — o blocker do retest

O auditor independente fechou os cinco CR e o snapshot do navegador, e deixou
**um** blocker: a autorização financeira final **não era atômica** com a
transição para `SUBMITTING`.

`cex_autorizar_e_submeter` é a autoridade final antes do efeito externo — ela
trava o intent, confere o certificado inteiro e vira `SUBMITTING` numa
transação só. **Só que não conhecia o estado financeiro da sessão.**

```
T0  precheck financeiro: pnl −49, sem freeze  → PASSA
T1  recovery COMITA:     pnl −51, freeze = hoje
T2  cex_autorizar_e_submeter  ← não olhava nada disso
T3  SUBMITTING
T4  createOrder
```

A janela ficou pequena depois das correções anteriores. **Pequena não é
fechada**: a propriedade que um autopilot com dinheiro real precisa é
categórica — se o loss-stop já foi atingido e **comitado** antes da
autorização final, nenhuma COMPRA nova sai.

**Conserto.** A RPC é redefinida na 0064 (a 0060 não é tocada — pode já ter
sido aplicada) e passa a travar **o intent e a sessão** na mesma transação,
conferindo, antes do `SUBMITTING`: sessão ativa, validade, congelamento, stop
de perda **pelo número** (não só pela marca), contabilidade incompleta e
quarentena.

- **Ordem dos locks:** intent → sessão, a mesma de
  `autopilot_reservar_exposicao_do_intent` e da cadeia projeção/liquidação →
  `autopilot_aplicar_pnl`. Inverter criaria deadlock com elas.
- **Nenhum lock atravessa HTTP:** a transação commita antes de o executor
  chamar `createOrder`.
- **Escopo:** só `autopilot_browser`/`autopilot_cron`. DCA também é
  `autonomous` e não tem linha em `autopilot_sessions` — prendê-lo aqui
  quebraria um produto para consertar o outro.
- **Só a COMPRA.** Venda, redução e recovery atravessam.

⚠️ E uma consequência que vale registrar: uma compra do autopilot **sem
sessão** passou a ser recusada. Os testes do executor construíam exatamente
esse estado como atalho; foram corrigidos para carregar a sessão, como
produção carrega. Afrouxar o portão para acomodar o atalho seria abrir o
buraco de volta.

## 9. Quebras deliberadas

Oito, cada uma com type-check **limpo**, cada uma detectada por teste
específico, todas restauradas:

| quebra | detecções |
|---|---|
| A133: `error` volta a virar `[]` | 1 |
| A132: cron volta a contar depois da ordem | 3 |
| A131: venda volta a usar `body.amount` | 2 |
| A131: rota deixa de ler o livro na venda | 6 |
| A131: navegador não projeta o que executou | 4 |
| A131: exposição volta a ser "local" | 3 |
| A131-C: projeção perde a idempotência | 9 |
| revisão: a projeção volta a pisar na saída armada | 2 |
| revisão: o navegador volta a não armar no servidor | 1 |
| revisão: o disfarce `?? ""` volta | 1 |
| A134: a reserva volta a ser só conferência | 4 |
| A135: a exposição ignora o que está prometido | 3 |
| A136: o marcador avança sem a posição (meio efeito) | 1 |
| A137: ordem viva "expira" e o compromisso é esquecido | 3 |
| A138: o P&L é calculado sobre o total, ignorando o marcador | 1 |
| A139: a liquidação volta a usar a credencial da sessão | 1 |
| A140: cada parcial desconta a taxa acumulada inteira | 1 |
| A140: o ajuste só de taxa é ignorado | 1 |
| A140: o freeze volta a depender do dia que o caller manda | 1 |
| A141: o rollback intermediário da vaga some | 1 |
| A139-H: volta a exigir os dois lados não-nulos | 2 |
| A142: o recebido sai da decisão de delta | 2 |
| A142: a liquidação sem recebido lança −custo | 1 |
| A143: liquidar com a resposta HTTP, sem assentar | 5 |
| A144: `CANCELED → 0` no banco falso | 2 |
| A144: `CANCELED → 0` no SQL | 4 |
| A145: o ramo de compra do ajuste sem quantidade some (falso) | 6 |
| A145: o mesmo ramo some do SQL | 1 |
| auditoria: as duas guardas de `regressao_de_quote` somem | 2 |
| Q: o ajuste volta a não carregar recebido | 10 |
| Q: a cobertura de quote na substituição some | 1 |
| F: a taxa opaca deixa de marcar a sessão | 5 |
| F: o portão volta a ignorar a contabilidade incompleta | 5 |
| item 11: só a taxa opaca conta (custo sem recebido volta a liberar) | 2 |
| item 11 (final): `NULL` volta a valer 0 — o portão abre | 4 |
| item 11 (fail-open do patch): o portão volta a ler a cópia em memória | 1 |
| Q1: terminal incompleto sai do recovery | 8 |
| Q2: `fee` NULL volta a zero | 4 |
| Q3: o recebido tardio some | 10 |
| Q4: `CANCELED` volta a zerar o compromisso | 2 |
| Q5: a projeção perde o watermark `applied` | 1 |
| Q6: o recovery usa a conexão ATUAL, não a histórica | 1 |
| Q7: o portão volta a ler a sessão stale | 1 |
| **Q8 (banco real): a reserva perde o `for update`** | total 0,02 numa bolsa de 0,01 |
| CR-1: BUY terminal sem quote volta a liberar a reserva | 2 |
| CR-2: a regressão de quote deixa de marcar pendência | 1 |
| CR-3: o cron volta a usar o snapshot pré-recovery | 1 |
| CR-4: o gate volta a ser calculado só antes do laço | 1 |
| CR-5: quem aplica o P&L deixa de carimbar o dia | 2 |
| navegador: a leitura autoritativa vira snapshot memoizado | 2 |
| fronteira final: o estado financeiro sai da autorização final | 5 |

⚠️ A primeira tentativa desta última quebra (trocar a chamada por
`avaliarRisco(estadoDaLinha(sessaoDoPiloto))`) saiu com **type-check sujo** —
e por um motivo que vale registrar: naquele ponto do arquivo a variável do
snapshot **nem está no escopo**. Refeita atacando a primitiva: a leitura vira
memoizada, o que reproduz o defeito nos dois canais de uma vez.

⚠️ **Três das cinco quebras do retest foram descartadas na primeira
tentativa**: uma com type-check sujo e duas que *não reproduziam o defeito* (o
teste passava porque eu havia quebrado a coisa errada). A do CR-3 foi mais
instrutiva: ela reconstruía `fresco` com os campos velhos, e a minha trava
media a **atribuição** em vez da **origem** do valor — uma quebra mais
esperta que o teste. A trava passou a proibir qualquer leitura financeira do
snapshot.

⚠️ **A Q5 não foi detectada na primeira tentativa, e o motivo importa.** A
conta acumulada do A142 protege o P&L mesmo com o watermark errado, e TODOS os
casos de convergência FECHAVAM a posição na primeira projeção — uma posição
apagada não pode ser reduzida de novo. O estrago mora num PARCIAL que continua
aberto, projetado mais de uma vez. O teste que faltava foi escrito antes de a
quebra contar.

⚠️ **E a primeira rodada inteira foi descartada**: o `tsc` base estava sujo por
um erro de tipo no meu próprio arquivo de teste (o `vitest` não type-checa e
passou verde). Sete veredictos anulados e refeitos com base limpa.

⚠️ A quebra do A136 **não foi detectada na primeira tentativa** — os testes
cobriam a falha da transação inteira, não o meio efeito. O teste que faltava
foi escrito antes de a quebra ser considerada detectada.

⚠️ A primeira tentativa da quebra do A143 saiu com **type-check sujo**
(`TS2774`, condição sempre verdadeira). Uma quebra que não compila não é
detecção: foi descartada e refeita válida antes de contar.

## 10. Validação no HEAD final

```
npx vitest run      3866/3866 (253 arquivos)     — baseline do R8 era 3586
npx tsc --noEmit    0 erros
npm run lint        0 erros (145 avisos pré-existentes)
npm run build       completo
git diff --check    limpo
git status --short  limpo
```

Nenhum teste foi removido, pulado, comentado ou enfraquecido. Nove travas
anteriores mudaram de invariante junto com o código — **cada uma com o texto
anterior escrito no lugar**, para a troca ser auditável em vez de silenciosa.

## 11. Limitações declaradas

1. **A liquidação da saída armada é transacional (A136)**, mas depende de achar
   o intent pela ordem externa. Falhando essa leitura, sai
   `autopilot_liquidacao_nao_aplicada` em severidade alta, a posição fica como
   está, e a passada seguinte tenta de novo — sem meio efeito.
2. **O freeze de um fill descoberto pela reconciliação DESTA passada ainda
   chega no tick seguinte.** A varredura passou a rodar antes das sessões, então
   o que já está no livro entra antes de qualquer ordem nova; o que a
   reconciliação do fim do tick descobrir espera ~5 minutos. Fechar isso exigiria
   reordenar a passada inteira. **Declarado, não corrigido.**
3. **As reservas NÃO expiram (A137).** Um intent que fica `UNKNOWN` para sempre
   segura o compromisso dele para sempre — e isso é deliberado: soltá-lo seria
   autorizar uma segunda ordem sobre um dinheiro que talvez já tenha saído. O
   que encerra o compromisso é o intent chegar a `CANCELED`/`FAILED_PRE_SUBMIT`,
   e quem o leva até lá é a reconciliação. **Um intent que a reconciliação nunca
   resolve deixa a posição parcialmente travada** — o sintoma aparece como
   recusa `quantidade_ja_reservada`, e o caminho é a quarentena de intents que
   já existe (`TENTATIVAS_ATE_QUARENTENA`).
3. **A taxa em moeda não precificável continua entrando como ZERO**, agora com
   bandeira explícita (`taxa_nao_precificada`) que sobe até a telemetria. O P&L
   sai OTIMISTA e o stop de perda afrouxa — política pré-existente, preservada
   e sinalizada. A conversão saiu do TypeScript e mora na 0064
   (`autopilot_taxa_do_intent_em_usd`), com a mesma semântica de `taxaEmUsd`.
3. **Compra do navegador passou a respeitar o teto de exposição do modo de
   risco** (75/200/400). Antes passava porque nada no servidor olhava — pode
   recusar ordens que a tela mostrava como válidas.
4. **Intents não-terminais que atravessarem o deploy** podem ser projetados
   sobre posições que `recordServerEntry` já havia gravado (a 0064 não faz
   backfill, por não haver prova de quais fills entraram). Risco de contagem
   dobrada na janela da migração.
5. **Ordem de operação:** o código novo depende da 0064. Entre o deploy e a
   aplicação da migration, a projeção falha em todos os caminhos e o livro não
   recebe nada — com telemetria alta, mas sem escritor alternativo.
6. **O comportamento da RPC está provado contra o banco falso** (que a
   reproduz) e por travas estruturais sobre o SQL. Não há Postgres nesta
   bancada: nenhuma linha da 0064 foi executada.
7. **O P&L entrou na projeção (A138)** e os writers paralelos foram REMOVIDOS,
   com lápides que quebram o `tsc` se alguém tentar ressuscitá-los.
8. **A regressão de `filled_quote` não é corrigida automaticamente.** Ela PARA
   a projeção daquele intent até mão humana. É o preço declarado de não
   produzir lucro artificial com aparência de conserto.
9. **O congelamento descoberto pela reconciliação DESTA passada ainda chega no
   tick seguinte.** A varredura de pendências roda antes do laço de sessões e
   cobre o que já está no livro; o que a reconciliação descobrir depois dela
   espera cinco minutos.
11. **A 0064 redefine duas RPCs da 0059** (`cex_ingest_order_snapshot` e
    `cex_ingest_trades`) e refaz `cex_fills_qty_check`. Se a 0059 já estiver
    aplicada em algum ambiente, a 0064 é quem corrige — a 0059 fica como está,
    com a suposição antiga escrita nela (e um teste que exige que ela continue
    lá, para a troca ser auditável).
13. **Taxa que nunca chega trava a COMPRA autônoma sem soltura automática.**
    Duas portas, e a segunda é a comum: (a) `cex_recalcular_intent` grava
    `fee_total = nullif(sum(coalesce(fee,0)), 0)`, então taxa genuinamente
    zero vira `NULL`; (b) `normalizeOrder` devolve `fee: undefined` sempre que
    o payload da venue não traz `fee.cost` numérico — a forma normal do
    `fetchOrder` de várias corretoras. Em ambos o intent vira `FILLED`, que não
    está em `PRECISAM_RECONCILIAR`, `ingerirTrades` nunca é alcançado, e
    `autopilot_projecoes_pendentes` não o relista (`coalesce(fn(), aplicada) >
    aplicada` é falso com `NULL`). A sessão não compra mais sozinha até um
    `UPDATE` manual. Fail-closed de propósito — mas **sem soltura
    automática**, e é isso que falta para o invariante F ser completo.
14. **`taxa_opaca` é bandeira, não supressão do número.** `pnl_today` continua
    recebendo o P&L com a taxa desconhecida valendo zero: custo 149 / recebido
    100 / `fee` `NULL` dá −49 sem freeze, quando a taxa real de 2 cruzaria o
    limiar de −50. A compra é barrada; a venda autônoma não, porque o freeze
    não dispara. É o comportamento pedido ("permitir recovery e saídas"),
    declarado porque o número gravado não é o verdadeiro.
15. **`fee_total` regredindo para `NULL` deixou de ser `regressao_de_taxa`** —
    o sinal de divergência sumiu, embora o portão tenha melhorado.
16. **`saida_em_liquidacao` é o único `ok:true` sem marcador** — verificado
    como estreito: nada foi aplicado ali, e não marcar também não limpa
    bandeira anterior.
12. **O bloqueio do invariante F não tem tela de admin.** Ele destrava sozinho
    quando a contabilidade volta a ser determinável; a "intervenção explícita"
    prevista é zerar
    `autopilot_sessions.contabilidade_incompleta_em` à mão. Não foi construída
    interface para isso nesta rodada.
10. **O A143 é provado no módulo, não na rota inteira.** O cron nunca foi
    harnessado nesta bancada: a sequência inteira foi extraída para
    `assentamento-da-saida.ts` e é exercitada contra o banco falso; o portão
    de entrada (`fatosNaoAssentados`) é provado por trava estrutural sobre o
    fonte do cron, e o "ZERO compra" pelo MESMO
    `avaliarAutorizacaoDaSessaoParaExecucao` que cron e navegador chamam,
    alimentado com a linha da sessão DEPOIS da liquidação.

## 12. Status

| finding | status |
|---|---|
| A131 | FIXED — PENDING INDEPENDENT RETEST |
| A131-C | FIXED — PENDING INDEPENDENT RETEST |
| A132 | FIXED — PENDING INDEPENDENT RETEST |
| A133 | FIXED — PENDING INDEPENDENT RETEST |
| A134 | FIXED — PENDING INDEPENDENT RETEST |
| A135 | FIXED — PENDING INDEPENDENT RETEST |
| A136 | FIXED — PENDING INDEPENDENT RETEST |
| A137 | FIXED — PENDING INDEPENDENT RETEST |
| A138 | FIXED — PENDING INDEPENDENT RETEST |
| A139 | FIXED — PENDING INDEPENDENT RETEST |
| A139-H | FIXED — PENDING INDEPENDENT RETEST |
| A140 | FIXED — PENDING INDEPENDENT RETEST |
| A141 | FIXED — PENDING INDEPENDENT RETEST |
| A142 | FIXED — PENDING INDEPENDENT RETEST |
| A143 | FIXED — PENDING INDEPENDENT RETEST |
| A144 | FIXED — PENDING INDEPENDENT RETEST |
| A145 | FIXED — PENDING INDEPENDENT RETEST |
| Invariante Q | FIXED — PENDING INDEPENDENT RETEST |
| Invariante F | FIXED — PENDING INDEPENDENT RETEST |
| matriz item 11 (custo sem recebido) | FIXED — PENDING INDEPENDENT RETEST |
| matriz item 11 (taxa NULL ≠ zero) | FIXED — PENDING INDEPENDENT RETEST |
| matriz item 11 (linha da sessão relida) | FIXED — PENDING INDEPENDENT RETEST |
| auditoria sintético→real | FIXED — PENDING INDEPENDENT RETEST |
| 0064 | CREATED LOCALLY — NOT APPLIED |

Round 8 (A127/A128/A129/A125-ABSENCE/A130/A130-B): preservados, sem elevação
de status.

## 13. Produção

Supabase produção alterado: **NÃO** · migration aplicada: **NÃO** · Vercel
deploy: **NÃO** · push em main: **NÃO** · merge: **NÃO** · PR: **NÃO** ·
`admin_kv`: **NÃO** · API key real: **NÃO** · trade real: **NÃO** · Pilot,
Autopilot ou DCA real: **NÃO**.

O único efeito externo desta rodada foi o `git push` da branch
`round9-surgical`, autorizado no briefing.
