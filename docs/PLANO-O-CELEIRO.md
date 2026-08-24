# O CELEIRO — a segunda arena

> **O que é:** um torneio NOVO, separado do que existe, cujo único placar é
> **quantos USDT entraram**. Não taxa de acerto, não expectancy, não medalha.
>
> **Por que separado:** o torneio antigo mede outra coisa e carrega decisões que
> já se provaram erradas. Misturar os dois faria o novo herdar o erro do velho.
>
> **Regra de ouro deste documento:** nada aqui é herdado por conveniência. Cada
> escolha abaixo aponta para a medição que a justifica. O que não tem medição
> atrás é hipótese e está marcado como tal.

---

## 1. Por que perdemos dinheiro — as quatro medições que mandam

Isto não é opinião sobre o passado. São quatro números do banco de produção, e
cada princípio de projeto da seção 2 sai de um deles.

### 1.1 A IA prevendo direção é PIOR que uma moeda

Num passeio aleatório sem tendência, a chance de bater o alvo antes do stop é
exatamente `stop / (alvo + stop)`. Isso é a linha de base sem nenhuma
inteligência. Comparando com o que cada mesa entregou:

| mesa | moeda honesta | a IA entregou | alpha |
|---|---|---|---|
| `grok_scan` | 37,4% | 24,8% | **−12,6 pp** |
| `self_scan` | 38,7% | 27,7% | **−11,0 pp** |
| `kimi_scan` | 33,3% | 23,8% | **−9,5 pp** |
| `deepseek_scan` | 37,5% | 29,9% | **−7,6 pp** |
| `mistral_scan` | 35,9% | 29,2% | **−6,7 pp** |
| `strat_ai` | 30,4% | **0,0%** | **−30,4 pp** |

**Seis modelos, 3.300 decisões, todos abaixo do acaso.** Não é sinal fraco: é
informação negativa. Pagamos quatro APIs para performar pior do que jogar uma
moeda com os mesmos alvos.

> ⚠️ Isto **elimina** a família inteira de agente que prevê direção com LLM. Não
> é um ajuste de prompt. Seis modelos independentes falharam na mesma direção.

### 1.2 Taxa de acerto é armadilha — acertar 7 de 10 e perder

Filtrando as entradas que exigiram recuo de preço antes de abrir:

| mesa | acerto | líquido |
|---|---|---|
| `hybrid_scan` | **70,2%** | **−0,401%** |
| `self_scan` | 67,6% | +0,037% |
| `deepseek_scan` | 65,0% | −0,196% |
| `mistral_scan` | **60,0%** | **−0,291%** |

Espalhado por 8 mesas, 4 a 11 dias cada, 8 a 13 símbolos — não é um dia nem uma
mesa. **Acerto alto e caixa negativo ao mesmo tempo**, porque ganha pouco e
perde muito.

> ⚠️ Isto **elimina** win-rate como placar. O placar é USDT.

### 1.3 A profundidade come o spread inteiro

`assessRealism` rodou 4.085 vezes: topo do livro prometia **+0,451%**, andando o
livro dava **−0,629%**. Sobreviviam **17 de 4.085** (0,4%).

> ⚠️ Isto **obriga** portão de profundidade ANTES de qualquer posição, e
> tamanho declarado por agente. Cotação não é liquidez.

### 1.4 Seletividade não é a saída — já foi tentada em 33×

De 293 decisões/dia para 9/dia, a aresta foi de −0,960% para **−1,028%**.
Cortar 97% do volume não melhorou nada.

> ⚠️ Isto **elimina** "ser mais exigente" como estratégia. O filtro tirou
> quantidade, não maldade.

### 1.5 E o que NÃO morreu

A arbitragem spot-spot morreu por **velocidade** (spread entre CEXes grandes
vive milissegundos; olhamos por REST a cada minuto) — não por burrice.

**Funding não tem esse problema.** É publicado, muda a cada 8 horas, é fluxo de
caixa contratual, e ler com um minuto de atraso não atrapalha. Ponto de
equilíbrio mediano medido: **42 dias** para pagar as 4 pernas.

> ✅ É a única fonte de retorno que sobreviveu a uma medição honesta. O Celeiro
> começa por ela.

---

## 2. Os seis princípios, cada um amarrado a uma medição

| # | Princípio | Vem de |
|---|---|---|
| **P1** | **Nenhum agente aposta em direção como fonte primária de retorno.** | 1.1 |
| **P2** | **O placar é USDT acumulado.** Win-rate não aparece em ranking. | 1.2 |
| **P3** | **Nada vira posição sem passar pelo portão de profundidade**, no tamanho real do agente. | 1.3 |
| **P4** | **A IA não prevê preço. A IA investiga prejuízo e propõe mutação.** | 1.1 + 1.4 |
| **P5** | **Cada agente tem um MECANISMO diferente**, não um prompt diferente. Biblioteca comum é permitida; comportamento igual não. | o erro das 24 mesas |
| **P6** | **Capital mínimo é declarado por agente**, e agente só compete na sua faixa. | 1.3 |

---

## 3. Por que o nome, e por que nada de mitologia

A arena antiga tem 24 nomes nórdicos e ninguém lembra o que cada um faz — foi
preciso um registro inteiro (`desks.ts`, 659 linhas) só para dizer quem é quem.

**No Celeiro, o agente se chama pelo que ele FAZ.** "Colheita de Funding", não
"FREYJA". É uma decisão de painel antes de ser de estilo: você bate o olho e
sabe. E torna impossível confundir as duas arenas numa lista.

---

## 4. Os agentes — cada um com mecanismo próprio

> Nenhum dos cinco prevê direção. Três não têm IA nenhuma. A IA aparece onde ela
> é boa: **ler evidência estruturada e propor hipótese** (§5).

### Categoria RENDA — recebe por existir, não por acertar

**① Colheita de Funding** · futuros Gate.io · swing/posição · **bot puro**
Comprado no spot + vendido no perpétuo, mesmo tamanho. Delta-neutro: se o preço
dobra ou cai pela metade, as pernas se cancelam. O que sobra é o funding.
- Receita: funding realizado a cada 8h, menos 4 pernas (0,45%, pagas uma vez).
- Portão: só entra em símbolo com `negativeShare` baixo e histórico suficiente.
- **Capital mínimo: alto** — duas pernas + folga de margem contra liquidação.
- Aposenta quando: funding mediano anualizado ficar abaixo do rendimento ocioso.

**② Aluguel de Ocioso** · margem Gate.io · contínuo · **bot puro**
O USDT que nenhum agente está usando é emprestado à taxa de margem. Risco de
mercado: **zero**. É o piso contra o qual todo o resto é medido.
- ⚠️ **Este agente é o CONTROLE do Celeiro.** Qualquer agente que renda menos
  que ele está destruindo valor, por mais bonita que seja a curva.
- Nunca aposenta: controle sem tratamento é a linha de base do experimento.

### Categoria ESTRUTURA — ganha de desalinhamento, não de previsão

**③ Convergência de Base** · futuros + spot Gate.io · day · **bot puro**
Entra só quando a base perpétuo-spot passa de um limiar medido; fecha na
convergência. Não pergunta para onde o preço vai — pergunta se as duas pontas
do mesmo ativo estão com preços diferentes demais.
- Portão de profundidade obrigatório nas duas pernas.
- **Capital mínimo: médio.**

**④ Maker de Faixa** · spot Gate.io · day · **bot + IA (na escolha do par, nunca na direção)**
Cota os dois lados em pares que passem num teste **estatístico** de lateralidade.
Ganha o spread, não a tendência. Tamanho amarrado à profundidade real do livro.
- A IA escolhe *onde* cotar (qual par tem estrutura), nunca *para onde vai*.
- **Capital mínimo: baixo** — é o único que funciona pequeno.

### Categoria EVENTO — assimetria, perda limitada por construção

**⑤ Pool Novo com Portão de Sobrevivência** · DEX · day · **bot puro**
Aposta fixa e pequena em pool recém-criado, atrás de portões **mecânicos**:
liquidez travada, distribuição de detentores, teste de honeypot, e o portão de
profundidade no tamanho da aposta.
- A perda máxima por tentativa é o tamanho da aposta. É a única categoria onde
  perder quase sempre é aceitável — desde que o ganho raro pague a série.
- **Capital mínimo: baixo**, e **teto rígido de munição diária**.

---

## 5. O Investigador — como a IA finalmente ganha um trabalho que ela sabe fazer

> *"a gente não usa o poder real das APIs de IA que temos"* — e a razão é que
> pedimos a coisa errada. Pedimos palpite de preço, que 1.1 provou ser pior que
> uma moeda. LLM é bom em **raciocinar sobre evidência estruturada**.

**O Investigador não opera.** Ele acorda, lê o extrato de cada agente e responde
três perguntas, nesta ordem:

1. **Onde o USDT vazou?** Decomposição obrigatória: taxa paga, derrapagem,
   funding recebido/pago, e movimento de preço. Sem essa separação a resposta
   vira narrativa.
2. **Qual hipótese explica o vazamento?** Uma frase falsificável, com o número
   que a sustenta.
3. **Que mutação eu proponho?** Uma mudança em UM parâmetro do agente, com o
   resultado esperado escrito ANTES.

Cada modelo disponível (**todos menos Anthropic**) responde de forma
independente e sem ver a resposta dos outros. As propostas entram numa fila.

### O placar do Investigador é o único honesto para uma IA

A mutação proposta é aplicada em **metade** do capital do agente; a outra metade
segue sem mudança. Depois de N ciclos, compara-se o USDT dos dois lados.

**O modelo é pontuado pelo USDT que a mutação dele gerou** — não pela qualidade
do texto, não por quantas hipóteses produziu. Um modelo que propõe mudanças que
pioram o caixa cai no ranking e recebe menos vez.

> É isto que torna o Celeiro diferente e não um painel gêmeo: no torneio antigo
> os modelos competiam em **adivinhar**. Aqui competem em **descobrir por que
> perdemos**, e a régua é o caixa.

### O aprendizado é uma mudança de parâmetro, não um texto na memória

A arena antiga guarda "lições" em prosa e injeta no prompt. Não é auditável, não
é reversível, e não dá para dizer se ajudou.

No Celeiro cada agente tem um **genoma**: seus parâmetros, versionados. Toda
mutação é um diff no genoma, com autor (qual modelo propôs), hipótese, e o
resultado medido depois. Mutação que não pagou é **revertida**, e o par
(hipótese, resultado) fica no registro — inclusive as que falharam, porque
hipótese refutada é informação e apagá-la é como recreditar carteira.

---

## 6. As faixas de capital — por que o ranking é separado por elas

Medição 1.3 diz que profundidade come spread. Logo **o mesmo agente tem retorno
diferente em tamanhos diferentes**, e comparar um agente de $50 com um de $5.000
na mesma tabela é comparar coisas distintas.

| faixa | quem compete | por quê |
|---|---|---|
| **Faixa 1 — semente** | Maker de Faixa, Pool Novo | funcionam pequeno; profundidade não é o limite |
| **Faixa 2 — trabalho** | Convergência de Base | precisa de duas pernas e de livro que aguente |
| **Faixa 3 — renda** | Colheita de Funding, Aluguel de Ocioso | precisa de folga de margem; retorno é lento e composto |

**Cada faixa tem seu próprio ranking e seu próprio campeão.** Não existe
"campeão do Celeiro" — existe campeão por faixa, e o Aluguel de Ocioso é o piso
que todos precisam bater.

---

## 7. O painel — separado de verdade

- Área **própria**, nunca dentro da área do torneio antigo.
- Nomenclatura descritiva (§3) — impossível confundir com nome nórdico.
- Uma tabela **por faixa de capital**, nunca uma lista só com tudo dentro.
- Colunas do ranking: **USDT acumulado**, USDT/dia, dias vivo, e o quanto está
  acima ou abaixo do Aluguel de Ocioso. **Win-rate não é coluna de ranking** —
  se aparecer, aparece como informação lateral, porque 1.2 mostrou que ela mente.
- O extrato de vazamento (§5, pergunta 1) visível por agente: taxa, derrapagem,
  funding, preço. É o que transforma "perdi" em "perdi ONDE".

---

## 8. O que este documento NÃO promete

- **Não promete lucro.** Promete um caminho onde o retorno vem de fonte
  identificável (funding, spread, taxa) em vez de palpite, e onde o fracasso
  aparece decomposto em vez de virar média.
- **Não promete que a IA vai acertar.** Promete que ela será medida pelo caixa
  que as ideias dela produziram, e desligada quando não produzir.
- **O Aluguel de Ocioso pode ganhar de todo mundo.** Se isso acontecer, é um
  resultado legítimo e a resposta certa é guardar USDT rendendo — não inventar
  um sexto agente para salvar a tese.

---

## 9. Ordem de construção

1. Tabelas próprias do Celeiro (prefixo separado, zero colisão com as antigas).
2. **Aluguel de Ocioso** primeiro — é o controle; sem piso não há régua.
3. **Colheita de Funding** — a única fonte com medição favorável.
4. Portão de profundidade compartilhado, no tamanho de cada agente.
5. Painel com as três faixas.
6. Investigador + genoma + A/B de mutação.
7. Maker de Faixa, Convergência de Base, Pool Novo.

> Cada etapa entra medindo. Agente que não consegue provar de onde veio o USDT
> não entra no ranking — fica no banco com o número que faltou, à vista.
