# PLANO — o sinal de cinco horas atrás

**Status: 🟡 F1 entregue em 1,0 (só barra o que nasce vencido) · F2 e F3
aguardando amostra** · 29/08.

> **Em uma frase:** as mesas executam sugestões em média **5 horas** depois de
> geradas, e uma posição que nasce com metade do horizonte já gasto **expira
> 3,5× mais** — o trade medido não é o trade analisado.

---

## 1. O que gerou esta investigação

O dono leu a coorte e disse: *"estávamos ganhando, daí adicionamos um filtro e
foi só ladeira abaixo"*. A data bate — o filtro de regime entrou em **23/08
02:31** e a virada é exatamente ali. Mas a causa não é o filtro.

### O que foi descartado, com dado

| hipótese | teste | veredito |
|---|---|---|
| o mercado virou | SOL **+12,8%** de 22 a 28/08 (duas fontes independentes) | ❌ as mesas perderam em mercado que subiu |
| o filtro escolhe errado | no período SEM filtro: comprar após 24h de alta deu **72,6%** (234 trades) vs **34,9%** após queda | ❌ a regra dele está certa |
| alvo e stop trocados | 233/233 antes e 54/54 depois copiam a sugestão exata | ❌ sem troca |
| o stop apertou | apertou, mas é **consequência** do preenchimento voltar ao normal | ❌ não é causa |

### O que a medição achou

| era | lado | n | **preenchimento vs preço de referência** | stop% | alvo% |
|---|---|---|---|---|---|
| antes de 23/08 | compra | 223 | **+2,090%** | 5,61 | 3,86 |
| depois | compra | 44 | **+0,038%** | 2,86 | 5,35 |

A sugestão nasce com referência R, alvo ≈ R+6%, stop ≈ R−2,9%. A posição abria
**5 horas depois**. Na alta de 19–22/08 (SOL a ~5,8%/dia), nessas 5 horas o
preço já tinha andado +2,09% — e medido do preenchimento real o par virava
**alvo a 3,86% / stop a 5,61%**: perto do alvo, longe do stop.

Num mercado subindo isso bate no alvo quase sempre, e bateu: `strat_mech` fez
**64 alvos em 70**. Quando a alta desacelerou, o preenchimento voltou a cair em
cima da referência, o par voltou à geometria de projeto, e apareceu a
expectativa verdadeira.

⚠️ **O lucro de 19–22/08 foi majoritariamente artefato de execução atrasada
dentro de uma alta.** Não era borda.

---

## 2. Por que o atraso existe

Não é lentidão de cron. É **fila**, e ela está escrita de propósito em
`paper/engine.ts`:

> *"A sugestão preterida NÃO é descartada: ela continua `open` e vira posição
> quando a mesa sair de ADA. Adiar é o comportamento certo; empilhar não."*

A regra de **uma posição por símbolo por mesa** está certa — empilhar $100 onde
o mandato manda $50 é pior. O defeito é o que acontece com a preterida: ela
espera **indefinidamente** e executa quando a vaga abrir, com o par alvo/stop
calculado sobre um preço que já não existe.

O atraso é **bimodal**: p25 = 0,6 min (executa no tick), mediana = 180 min,
p90 = 450–990 min, **máximo 94,5 horas**.

---

## 3. O dano, medido

⚠️ **O dano NÃO é "trade atrasado perde dinheiro".** Testei e não perde — todas
as faixas de atraso têm expectativa positiva neste período. Registrar isso
importa mais que a conclusão bonita: eu apostei em "a deriva mata a
expectativa" e a medição não confirmou.

O dano é outro, e é duplo:

### 3.1 Atraso infla o acerto e encolhe o ganho

Por fração do caminho até o alvo já consumida no preenchimento:

| consumido antes de entrar | n | acerto | expectativa | stops |
|---|---|---|---|---|
| a favor (entrou melhor) | 68 | 42,6% | +0,91 | 34 |
| 0–15% | 77 | 64,9% | **+1,52** | 21 |
| 15–30% | 27 | 81,5% | **+1,80** | 3 |
| 30–50% | 29 | 79,3% | +0,88 | 5 |
| **acima de 50%** | 84 | 77,4% | **+0,66** | **0** |

Acima de 50% consumido: **zero stops, 77% de acerto e a pior expectativa**. É a
forma clássica de catar centavos — o movimento já aconteceu, sobra pouco alvo, e
o risco continua inteiro. Um placar de acerto alto que não vira dinheiro.

### 3.2 Atraso transforma horizonte em ficção

Esta é a parte que não depende de expectativa e não admite discussão:

| situação na entrada | n | **expirou** | expectativa |
|---|---|---|---|
| dentro do prazo | 238 | 36 (**15%**) | +1,12 |
| metade do horizonte já foi | 42 | 22 (**52%**) | +0,85 |
| **nasceu expirada** (atraso ≥ horizonte) | 5 | 4 (80%) | — |

Uma posição que abre com metade do horizonte gasto **expira 3,5× mais**. E
`expired` não é win nem loss — é o flywheel dizendo "não deu tempo de saber". O
atraso não está perdendo dinheiro; está **fabricando amostra sem veredito**.

⚠️ E cinco posições **nasceram já vencidas**. Não é ruim por opinião: o alvo e o
stop foram dimensionados para uma janela que já tinha acabado quando a ordem
saiu.

---

## 4. F1 — o que foi entregue agora 🟢

`src/lib/paper/frescor.ts`, função pura, mais o portão no abridor.

**A regra é uma só:** a sugestão traz o próprio horizonte, e a fração dele já
gasta antes da entrada é a medida de frescor. Acima do teto, não abre.

```
fracaoGasta = (abriuEm − criadaEm) / horizonteHoras
abre  ⟺  fracaoGasta < MAX_FRACAO_DO_HORIZONTE     (padrão 1,0)
```

**O teto entra em 1,0, por decisão do dono.** Neste valor o portão barra
**exatamente uma coisa**: a posição que nasceria já vencida, com o prazo de vida
inteiro consumido antes de a ordem sair. Não é juízo sobre mercado — é
aritmética.

O rascunho vinha com 0,5, que cortaria também a faixa que expira 52% e teria
custado 47 dos 285 trades da janela. Começar no ponto inequívoco deixa o portão
**ligado e acumulando `paper_sinal_velho`** — com a fração média de cada barrada,
que é o insumo da F2 — sem tirar da amostra nada que ainda esteja em discussão.

⚠️ **O padrão está no CÓDIGO, não só na variável de ambiente.** Depender de
alguém lembrar de criar `PAPER_MAX_FRACAO_HORIZONTE` na Vercel faria o
comportamento pedido valer só se a env existisse — e a ausência dela cairia em
0,5, que é o que NÃO foi escolhido. A env continua funcionando e sobrepõe, para
a F2 mexer sem deploy.

⚠️ **FALHA ABERTA, como o filtro de regime.** Sem `created_at` ou sem horizonte
legível, passa. A regra da casa é falhar fechado no caminho do dinheiro, mas
aqui fechar não protege capital — só desliga o laboratório em silêncio, que é a
morte que este projeto já pagou (a FREYJA, dez dias).

⚠️ **Barrado não é mudo.** Cada recusa entra no `paper_open_skip` como
`sinal_velho`, e o tick do abridor conta quantas.

**Custo medido de ligar isto em 1,0:** dos 285 trades da janela, **5** seriam
barrados — os que nasceram vencidos, e dos quais 4 expiraram. Quase nenhum PnL
sai da conta.

O custo de apertar para 0,5, quando a F2 decidir, seria outro: **47 trades (16%)
e +$21,54**, em troca de 26 posições expiradas fora da amostra. Aí sim é troca
deliberada de lucro medido por medição honesta — a mesma escolha que o
`expired ≠ win/loss` já fez no flywheel. Não é o que entra hoje.

---

## 4.1 ⚠️ ACHADO LATERAL — o resolvedor não está expirando sugestões

Ao conferir se o portão sufocaria a fila, apareceu outra coisa: das
`zion_suggestions`, **9 estão `open` e a mais antiga é de 04/08** — vinte e
cinco dias, com horizonte de no máximo 72h. Ela deveria ter virado `expired`
por conta própria e não virou.

Não é causado por esta entrega e não bloqueia ela (o teto da fila é 500 e há
folga de ~55×), mas é da mesma família: **um estado que deveria ser terminal
ficou vivo, e ninguém percebeu porque nada olha para isso.** Vale uma passada
própria no resolvedor.

---

## 5. F2 — o teto sai da medição, não do meu dedo 🔴

O que falta para escolher o número de verdade:

1. Rodar F1 em **1,0** até haver **≥100 fechadas** com o portão ativo, lendo a
   `fracao_media_do_horizonte` que o `paper_sinal_velho` acumula.
2. Comparar expectativa e taxa de `expired` contra a janela anterior.
3. Só então apertar. **Se apertar não melhorar a expectativa, não apertar** — o
   número existe para a amostra ficar honesta, não para o placar ficar bonito.

**Critério de sucesso, escrito ANTES dos dados:** a taxa de `expired` das
posições abertas cai de 15% para ≤10%, sem que a expectativa por trade caia.
Se a expectativa cair junto, o portão está cortando trade bom e volta atrás.

---

## 6. F3 — consertar a fila, não só filtrar a saída dela 🔴

F1 é curativo: recusa a sugestão velha na hora de abrir. A causa continua lá —
a preterida espera indefinidamente.

Três desenhos possíveis, em ordem de preferência:

1. **A sugestão expira na origem.** `zion_suggestions` ganha prazo de validade e
   quem espera demais vai para `expired` sem nunca virar posição. Mais honesto:
   o sinal morre onde nasceu, e o extrato mostra "gerada e não executada", que
   hoje é invisível.
2. **Reprecificar ao entrar.** Recalcular alvo e stop a partir do preenchimento.
   ⚠️ **Tem armadilha grave:** vira outro trade que não o proposto, e o flywheel
   passaria a medir a reprecificação, não o modelo. Só com o motivo carimbado na
   linha.
3. **Fila com prioridade por frescor.** Entre duas preteridas do mesmo símbolo,
   a mais nova ganha. Ajuda pouco sozinha; combina com (1).

⚠️ **Nada de F3 antes de F2.** Mexer na fila e no teto ao mesmo tempo deixa duas
variáveis mudando e nenhuma medição — o erro que a Fase 8 já pagou.

---

## 7. O que isto NÃO conserta

- **Não devolve o lucro de 19–22/08.** Aquele lucro era artefato; medir direito
  vai fazer o placar parecer PIOR, não melhor.
- **Não diz se as mesas têm borda.** A pergunta continua aberta e a régua é o
  `comprar-e-segurar`: segurar SOL de 19 a 28/08 deu **+37%**; as mesas fizeram
  +$128 sobre ~$5.000 e devolveram. Suspeito que a resposta honesta seja "nunca
  houve borda".
- **Não mexe no filtro de regime.** A regra dele testa bem. O que ele faz de
  ruim é cortar o volume ~10× e deixar a amostra pequena demais — problema de
  amostra, não de sinal.
