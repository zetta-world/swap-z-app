# ENTREGA — ROUND 9 CIRÚRGICO (A131 + A131-C + A132 + A133)

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
| HEAD final | `c2f3d82` (+ este documento) |

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

## 3. Diff

```
git diff 83c50fe..HEAD --stat
 28 arquivos · +3480 −260
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

⚠️ A quebra do A136 **não foi detectada na primeira tentativa** — os testes
cobriam a falha da transação inteira, não o meio efeito. O teste que faltava
foi escrito antes de a quebra ser considerada detectada.

## 10. Validação no HEAD final

```
npx vitest run      3747/3747 (246 arquivos)     — baseline do R8 era 3586
npx tsc --noEmit    0 erros
npm run lint        0 erros (145 avisos pré-existentes)
npm run build       completo
git diff --check    limpo
git status --short  limpo
```

Nenhum teste foi removido, pulado, comentado ou enfraquecido. Sete travas do
Round 8 mudaram de invariante junto com o código — **cada uma com o texto
anterior escrito no lugar**, para a troca ser auditável em vez de silenciosa.

## 11. Limitações declaradas

1. **A liquidação da saída armada é transacional (A136)**, mas depende de achar
   o intent pela ordem externa. Falhando essa leitura, sai
   `autopilot_liquidacao_nao_aplicada` em severidade alta, a posição fica como
   está, e a passada seguinte tenta de novo — sem meio efeito.
2. **As reservas NÃO expiram (A137).** Um intent que fica `UNKNOWN` para sempre
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
7. **P&L continua fora da projeção.** O Round 9 uniu o livro de POSIÇÃO; o de
   resultado segue como estava.

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
