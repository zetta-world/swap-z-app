# INVARIANTES DE MEDIÇÃO — ler ANTES de cada fase

> **Por que este documento existe (09/08).**
>
> Na Fase 4 eu construí a trava *"custo não pode ser negativo"*. Na Fase 6 o
> mesmo defeito voltou com outro nome — *"ida e volta na mesma poça não pode
> ganhar dinheiro"* — e passou, porque eu não tinha construído a trava lá.
>
> As notas que escrevo ficam **viradas para o passado**: explicam o defeito onde
> ele aconteceu e não me impedem de repeti-lo com outro nome três fases depois.
> Esta lista é a mesma coisa virada para a frente.
>
> Cada linha tem a cicatriz que a gerou. Sem a cicatriz vira regra decorada, e
> regra decorada não sobrevive ao primeiro caso que parece exceção.

---

## 1. Custo nunca é negativo

Entrar e sair **não pode te pagar**. Se a conta der custo negativo, a medição
está quebrada — não é oportunidade.

> **Cicatriz (06/08, Fase 4):** o restaking fechou com custo −0,40% em todas as
> faixas, líquido 2,89% acima do bruto 2,49%, equilíbrio de −58 dias, e veredito
> VERDE. Os dois lados da troca tinham `priceUSD` discordando na fonte.

**Como travar:** achate em zero **com bandeira**, e a bandeira reprova a leitura.
Zero também é mentira, e ele empurra o resultado para cima — seria o número
bonito nascendo de uma falha de medição.

## 2. Ida e volta sempre perde

Comprar e vender o mesmo ativo, no mesmo lugar, no mesmo instante, **sempre**
perde: taxa duas vezes, impacto duas vezes.

> **Cicatriz (09/08, Fase 6):** ETH em duas cadeias com venda 1920,27 contra
> compra 1917,44 na mesma poça. E eram exatamente as **duas únicas linhas
> positivas** da tabela.

**Como travar:** afirme `venda < compra` e tire a linha de todas as contas. É a
invariante nº 1 com outro nome — se ela existe numa fase, procure a irmã dela na
próxima.

## 3. Os dois lados na mesma moeda e no mesmo tamanho

Comparar preço de $5.000 (com impacto) contra topo de livro (sem impacto)
enviesa. Comparar preço em USDT contra preço em USDC mede o basis do stablecoin
e chama de borda.

> **Cicatriz (09/08, Fase 6):** ETH a 1926,59 na CEX (USDT) contra 1917–1920 no
> DEX (USDC) — 0,35% de gap sistemático **no ativo mais líquido do mercado**.
> Implausível como ineficiência, plausível como stablecoin.
>
> **Cicatriz (28/07, arbiter):** +0,451% teóricos de topo de livro viraram
> −0,629% reais em 4.085 medições ao andar o livro pelo notional.

**Como travar:** ande o livro pelo mesmo notional dos dois lados, e converta a
moeda de cotação pela taxa da **mesma venue**. Se a taxa não vier, **falhe** —
assumir paridade é o erro que a conversão existe para corrigir, com cara de
conserto.

## 4. Amostra é o que sobrevive aos filtros, não o que entrou

O `n` que vai para a tela é o que passou por todas as travas. Contar o que entrou
infla, e infla sempre a favor.

> **Cicatriz (06/08, Fase 4):** "12 piscinas" no Tesouro tokenizado eram BUIDL
> contado **seis vezes** em seis cadeias, com o mesmo APY. Cinco produtos
> apresentados como doze observações.

## 5. O mesmo produto em N lugares é UM

Emissor em seis cadeias tem **uma** taxa. Uma janela de 30 dias deslizando dia a
dia mostra **um** mês ruim trinta vezes.

> **Cicatriz — três vezes, com roupa diferente:**
> - Fase 4: o mesmo emissor em seis cadeias, na **amostra**
> - Fase 5.1: o mesmo mês contado trinta vezes, na **amostra**
> - Fase 5.1 de novo: o mesmo mês contado trinta vezes, na **frequência** —
>   "28% das janelas negativas" eram 24 episódios

**Como travar:** colapse por produto/episódio antes de contar, e reporte as duas
contagens quando as duas responderem perguntas diferentes.

## 6. "Não medimos" ≠ "medimos zero"

Fonte que recusa não é resultado nulo. As duas leituras pedem ações opostas.

> **Cicatriz (04/08, funding):** `bybit:403` e `binance:451` voltaram como
> "nenhum símbolo retornou funding", e custou uma rodada inteira descobrir por
> quê.
>
> **Cicatriz (09/08, Fase 5.1):** se a Deribit recusasse, a fase fecharia como
> "não há prêmio de variância" em vez de "não medimos".

**Como travar:** grave o **status por host**, e faça a rota FALHAR quando a fonte
não responde — nunca devolver um resultado vazio que se lê como medição.

## 7. Best-effort pode falhar; não pode ser silencioso

Gravação é best-effort de propósito — o registro não pode derrubar a medição.
Mas "não gravou" precisa **aparecer**.

> **Cicatriz (09/08, Fase 6):** `windowDays: 0` contra um `check > 0`. O
> `startRun` estourou, o `catch` engoliu, e a rodada inteira **apareceu na tela
> e não existiu no banco**.

## 8. A régua que julga é a que ordena a tabela

Se o veredito decide por X, a tabela ordena por X. Ordem é afirmação: uma tabela
ordenada diz *"o de cima é o melhor"*.

> **Cicatriz (06/08, funding):** o veredito julgava por `netAnnualizedPct` e a
> tabela ordenava por `netPct` — a régua aposentada dois dias antes. A coluna
> que decide descia embaralhada ao lado de uma coluna cinza que descia perfeita.

## 9. O que o veredito excluiu não encabeça o ranking

Amostra abaixo do piso não vira número no meio dos que passaram.

> **Cicatriz (06/08, funding):** VET (+9,8%/ano em **30 dias**) e RUNE (+7,9%)
> eram os dois maiores números da tela, e o resumo cinco linhas acima dizia
> "+3 descartados por janela curta".

**Como travar:** separe em bloco próprio, visível e dito. Esconder é o defeito
oposto.

## 10. Recorte por recência não é recorte por severidade

Guardar "os últimos N" e exibir como "os N piores" é rótulo falso.

> **Cicatriz (09/08, Fase 5.1):** a rota guardava `slice(-120)` e o painel dizia
> *"as 30 PIORES janelas"*. A pior armazenada era −10,6; a pior real, **−46,1**.
> Numa fase cujo argumento inteiro é *"a cauda é o que decide"*, a tela escondia
> a cauda.

## 11. A mediana quase sempre manda — saiba quando NÃO manda

Padrão: mediana, porque um dado corrompido puxa a média e descreve um mercado
que ninguém opera.

**Exceção:** quando a **cauda É o negócio**. Vender volatilidade tem mediana
positiva quase sempre e média arrastada pelas explosões — ali a média julga.

> **Cicatriz (04/08):** `s[Math.floor(n/2)]` não é mediana com `n` par. O erro
> tem **sinal**: sempre para cima. Todo número que a rota tinha reportado estava
> inflado. Nasceu daí o `stats.ts`.
>
> **Cicatriz oposta (09/08, Fase 5.1):** reportar a mediana ali teria vendido a
> estratégia — +9,40 de mediana contra +5,70 de média.

## 12. Parâmetro escolhido olhando o resultado é ajuste, não medição

Strike, teto, símbolo, janela: **declare antes**.

> **Cicatriz (28/07, sonda de orderbook):** ela media só a "melhor oportunidade
> aparente" do tick, e livro fino sempre ganha esse concurso. Resultado: 4.085
> medições de oito altcoins rasas e **zero de BTC**.

## 13. Hipótese própria exige teste que possa desmenti-la

Três hipóteses minhas caíram pela minha própria medição: o clima, o filtro de
regime (**invertido**) e a carteira combinada (com ρ=0, o melhor cenário
possível).

**Como travar:** escreva a hipótese ANTES, deixe-a ao lado do resultado mesmo
quando ela cai, e construa os testes contra a conclusão que te favorece.

## 14. Controle que ninguém lê não é controle

Um campo que declara uma garantia — "esta chave não saca", "este dado foi
validado", "este limite foi checado" — só é controle se **alguém o lê e alguma
coisa muda por causa dele**. Se nada muda, é comentário com sintaxe de código, e
envelhece como comentário: fica na tela e no tipo depois de deixar de ser
verdade.

**Como travar:** quem declara a garantia tem que ser quem consegue **prová-la**.
O cliente não prova nada sobre a própria chave — quem prova é a corretora,
perguntada pelo servidor. E a prova tem que **gravar**, senão não é auditável.

> **Cicatriz (09/08, Fase 7):** `readOnly: true` **fixo** em toda chave salva; o
> tipo dizia *"marked by the user"* e o usuário não marcava nada; o nome dizia
> `readOnly` e o significado era *trade-only* — coisas diferentes; e o campo
> **nunca era lido por ninguém**. Quatro problemas numa linha, protegendo o
> caminho em que a credencial do cliente vai cifrada para o nosso servidor.
> Quem colasse uma chave com permissão total não recebia aviso nenhum.

## 15. O `return` cedo leva junto tudo que vinha depois

Adicionar uma saída antecipada no meio de uma função **desliga em silêncio todo
o resto dela** — inclusive o que não tem relação nenhuma com o motivo da saída.
O risco cresce com a idade do arquivo: quanto mais tempo a função existe, mais
coisas foram penduradas no fim dela por conveniência.

**Como travar:** antes de escrever um `return` novo, leia o que vem DEPOIS dele
até o fim da função e pergunte de cada linha: *"isto pode deixar de acontecer
por causa deste motivo?"*. Se a resposta for não, a linha vai junto no caminho
curto — e ganha teste, porque a próxima saída antecipada vai esquecer de novo.

> **Cicatriz (09/08, Fase 7.2):** o `return` da automação fechada, escrito sem
> esse cuidado, desligaria `runAlertWatchdog()` — pico de erro, cron parado,
> orçamento de IA, saúde de dependência, digest diário. Ele é chamado de **um
> lugar só em todo o código**, e por acaso é o fim deste cron. Fechar uma
> feature de CEX teria calado o alerta da plataforma inteira, e o sintoma seria
> a ausência de alarmes — que é indistinguível de "está tudo bem".

## 16. Trava de liberação falha FECHADA; gate de mesa falha ABERTO

O default na ausência de registro tem que seguir **o que está em jogo**, não o
costume do arquivo ao lado. Mesa interna sem registro deve rodar (o pior caso é
gastar token nosso). Liberação de recurso sem registro deve ficar fechada:
ausência de decisão não é autorização — é a nº 6 aplicada a uma decisão em vez
de a uma medição.

E a causa de estar fechado viaja junto: *"fechado por decisão"* e *"fechado
porque não consegui ler o banco"* pedem ações diferentes.

**A direção pode mudar de ROTA para ROTA, e isso não contraria a regra — é a
regra.** O que decide é a consequência, não o costume do arquivo ao lado:

- **Ordem de corretora** — dinheiro SAI da conta. Falha de leitura **bloqueia**.
  Um trade perdido contra fundos expostos não é escolha difícil, e a rota já
  opera sem as próprias guardas quando o banco cai.
- **Cotação de swap** — o usuário ainda assina na carteira, revisando. Falha de
  leitura **deixa passar**. Derrubar o produto para todo mundo por um Postgres
  intermitente é o dano certo; o cenário oposto exige uma conjunção rara.

Quando a leitura falha, isso vira **evento**, nunca silêncio (nº 7).

> **Cicatriz (09/08, Fase 7.2):** `disable_cex`, `disable_swap` e
> `maintenance_mode` existem no painel, gravam em `admin_kv`, entram no log de
> auditoria — e **não são lidos por ninguém**. Um documento de auditoria chegou
> a reportar *"✅ plataforma aberta"* lendo um interruptor que não controla
> nada. Pior que a nº 14: aqui o operador vê a chave virar e acredita que
> desligou.

## 17. Diferença não se compara com nível

Um número que já É uma comparação — vantagem, excesso, alfa, perda relativa —
não pode ser confrontado com o nível contra o qual ele foi medido. A conta tem
duas leituras possíveis e uma delas passa despercebida porque *parece* certa.

**Como travar:** o nome do campo carrega o enquadramento (`vantagemPct`, não
`liquidoPct`), e a tela mostra os dois lados **absolutos** lado a lado, para o
confronto errado não ter como ser escrito.

> **Cicatriz (09/08, Fase 8.1):** a perda impermanente é medida *em relação a
> ter segurado*, então `taxa + perda` já era a resposta de "bateu segurar?".
> Comparei esse número contra o retorno de segurar, e a tela pintou de VERDE
> duas piscinas que **perderam** para segurar, escrevendo *"bateu segurar em
> 2/2"* quando o certo era **0/2**. Pior: em mercado de ALTA o mesmo defeito
> reprovaria ao contrário — uma piscina vencedora marcada MORTA porque segurar
> rendeu mais que a vantagem dela.
>
> O grupo de controle não pegou, e não tinha como: com os preços parados a
> diferença e o nível coincidem. **Controle prova a conta, não o enquadramento.**

## 18. O competidor não é só o índice — é também NÃO FAZER NADA

Bater comprar-e-segurar é condição **necessária**, não suficiente. Ficar em
**caixa** está sempre disponível, não custa nada e não aparece em nenhuma
tabela — então uma mesa que perde dinheiro pode ganhar do índice e ser lida
como aprovada.

**Como travar:** retorno absoluto negativo **não pode ser verde**, por mais que
ganhe do benchmark. Vira cinza, e a tela diz as três posições em ordem: a mesa,
o índice e o caixa.

> **Cicatriz (10/08, Fase 8.2):** a rotação saiu **VERDE perdendo 3,01% por
> período** (segurar perdeu 5,47%), e a grade saiu **VERDE tendo perdido 54,11%
> do capital** (segurar perdeu 64,55%). Pela régua declarada as duas estavam
> certas. Para quem olha a tela, "✓ VERDE" sobre meio capital destruído é o
> oposto do que a medição descobriu.
>
> Num ano em que os dez majors caíram, *"menos ruim que o índice"* não é uma
> mesa que se opera — é uma constatação sobre o mercado.

---

## Como usar

Leia antes de escrever a primeira linha de uma fase. Para cada item, pergunte:
**"esta invariante tem uma versão nesta fase?"** — a nº 2 é a nº 1 com outro
nome, e foi assim que ela passou.

Quando uma nova aparecer, escreva-a aqui **com a cicatriz**. Sem a cicatriz, é
regra decorada.
