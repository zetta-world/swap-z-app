# AUDITORIA DAS MESAS E DO TORNEIO — 19/08/2026

> **O que é:** auditoria de resultado das 24 mesas e do torneio, feita direto
> no banco de produção, para responder uma pergunta do dono: *"tem como otimizar
> os ganhos?"*
>
> **A resposta curta:** não há ganho para otimizar. O livro é negativo **antes**
> do custo, e a única mesa positiva é **dois dias**. Isso não é pessimismo — são
> 3.876 decisões medidas. O que dá para fazer é **parar de pagar** pelo que já
> está provado negativo, e consertar três instrumentos que hoje deixam
> coincidência parecer vantagem.

---

## 1. O número que decide tudo

| | |
|---|---|
| Decisões resolvidas (`hit_target` + `hit_stop`) | **3.876** |
| Bruto médio por trade, **antes** de qualquer taxa | **−0,570%** |
| Soma bruta | **−2.211 pp** |
| Custo somado (0,4% ida-e-volta) | −1.550 pp |
| Soma líquida | **−3.762 pp** |

⚠️ **Custo NÃO é a alavanca.** Com taxa zero o livro ainda perde 2.211 pp. Toda
conversa sobre otimizar fee, rota ou derrapagem mexe em 1.550 pp de um prejuízo
de 3.762 — e deixa os outros 2.211 intactos. O problema é o sinal, não o pedágio.

---

## 2. A única mesa positiva são dois dias

O `radar` é a única mesa com líquido positivo no torneio: +0,353%/trade em 210
decididos. Cortando **08 e 09 de julho**:

| recorte | n | acerto | líquido/trade | total |
|---|---|---|---|---|
| tudo | 210 | 42,9% | **+0,353%** | +74,2 pp |
| **sem 08–09/jul** | 171 | 33,9% | **−1,244%** | **−212,7 pp** |
| só 08–09/jul | 39 | 82,1% | +7,355% | +286,9 pp |

Em 171 dos seus 210 trades o `radar` é a **pior** mesa do sistema. O erro padrão
do líquido é 0,386 contra média de 0,353 — não passa nem no teste ingênuo, antes
de considerar que os 39 trades bons são um repique só.

---

## 3. A confiança declarada é um sinal INVERTIDO

Monótono em 3.749 decisões. Quanto mais o modelo diz que vai acertar, pior ele
acerta:

| diz que acerta | n | acerta de fato | erro | líquido |
|---|---|---|---|---|
| 47% | 1.506 | **33,3%** | −13,7 pp | −0,560% |
| 58% | 1.641 | 28,0% | −30,1 pp | −1,058% |
| 67% | 576 | 21,4% | −45,6 pp | −1,503% |
| 76% | 26 | 7,7% | −68,6 pp | −2,574% |

**Isto é explorável como FILTRO, não como sinal.** Recusar tudo com confiança
≥65 teria poupado **933 pp** — 27% do prejuízo — em 602 trades. Não vira lucro:
mesmo a melhor faixa (<55) é −0,16% BRUTA. Inverter também não salva, porque a
inversão paga o mesmo custo dos dois lados.

⚠️ A escala de `probability` é 0–100 em **todas** as mesas. A coluna de
calibração do torneio está correta. (Verificado — a suspeita de bug de unidade
não se confirmou.)

---

## 4. Seletividade já foi tentada em 33× e não mudou nada

| fase | por dia | acerto | bruto | líquido |
|---|---|---|---|---|
| jul 01–17 | 293 | 28,7% | −0,560% | −0,960% |
| jul 18–31 | 16 | 26,8% | −0,711% | −1,111% |
| **ago 01–19** | **9** | 24,4% | −0,628% | **−1,028%** |

O sistema cortou **97% do volume** e a aresta por trade **não melhorou** — piorou
um pouco. O filtro removeu quantidade, não maldade.

⚠️ Isto fecha um caminho inteiro. "Ser mais seletivo" não é uma proposta nova:
já foi executada, em escala grande, e o resultado está medido.

⚠️ E reinterpreta os "5 dias catastróficos": 11, 12 e 13/jul concentram 67% de
todo o livro (2.589 de 3.876 decisões). O estrago veio de **vazão**, não de um
evento de mercado. Freio por perda diária não teria ajudado — freio por
quantidade teria.

---

## 5. A GERI: a tese do dono está de pé, e ainda não é prova

| GERI (`mistral_scan`) | por dia | acerto | líquido |
|---|---|---|---|
| jul 01–17 | 79,5 | 28,3% | −0,924% |
| jul 18–31 | 13,8 | 29,1% | −0,836% |
| **ago 01–19** | 6,0 | **61,1%** | **+1,123%** |

É a **única** mesa cuja aresta melhora ao longo do tempo — exatamente o que o
dono afirmou e eu não tinha visto. Mas agosto são 3 dias: 14/08 (+6,6, n=1),
18/08 (**−6,4**, n=7), 19/08 (+20,0, 8 acertos em 10).

**O `+1,123%` é essencialmente hoje.** O `retireWhen` da GERI já manda a coisa
certa: não aposentar por estar negativa, e vigiar se a seletividade PARA de
melhorar. Mantida. A medição que decide é se 19/08 se repete.

---

## 6. O que NÃO é bug (verificado, não presumido)

**As mesas de arbitragem somam +$313,51 em 2.078 posições e o contador mostra
$0,00.** Isso está **certo**. O `assessRealism` rodou 4.085 vezes: o topo do
livro prometia +0,451%, andar a profundidade dava **−0,629%**, e só 17 de 4.085
(0,4%) sobreviviam. O portão de 03/08 fechou a mesa e as posições foram
arquivadas — o `$0,00` é a ilusão corretamente posta de quarentena.

É a coisa mais próxima de uma vantagem estrutural que o sistema já mediu, e o
que a matou foi **profundidade**, não cérebro. Se algum dia houver ganho real,
é mais provável que venha daí do que de um modelo melhor.

---

## 7. O buraco de caixa de $7.723 é CICATRIZ, não achado

⚠️ **Conferido antes de reportar.** O `PLANO-LABORATORIO-DE-ESTRATEGIAS.md` já
registra, com todas as letras: *"O buraco nas aposentadas é **deliberado** — é a
cicatriz preservada do vazamento de julho, e recreditá-las apagaria o registro."*

Fica aqui só como **reconferência**, porque a auditoria mediu de novo e o número
continua batendo com o que está documentado. `caixa + preso em abertas − inicial
− realizado`:

| carteira | buraco |
|---|---|
| deepseek_scan | −$997,38 |
| grok_scan | −$993,73 |
| oracle_self | −$947,96 |
| oracle_mistral | −$941,26 |
| oracle_kimi | −$914,00 |
| self_scan | −$895,37 |
| kimi_scan | −$883,81 |
| sniper | −$700,00 |
| oracle_deepseek | −$450,00 |

**Todas as mesas VIVAS fecham em 0,00** — essa é a parte que importa, e ela
confirma que a medição de hoje não está corrompida. A comparação histórica de
patrimônio entre mesas continua sem valor, por decisão, não por defeito.

---

## 8. Dois instrumentos que deixam coincidência virar medalha

### 8.1 `nEfetivo` é cego a movimento de mercado inteiro

Ele agrupa por `símbolo|playbook` numa janela de 24h. Um repique que pega 13
símbolos no mesmo dia conta como **13 ideias**, não uma.

No caso do `radar`: 39 linhas → **8 ideias** pelo `nEfetivo`; **2 dias** na
realidade. Subestima a correlação em 4×.

A correlação que importa aqui é **entre símbolos**, e é justamente a que a chave
não vê.

### 8.2 O torneio ordena por `expectancyNet`, que um dia único domina

`agents.sort` usa `expectancyNet` com `decided` como desempate. Nenhuma das duas
enxerga que 100% do resultado do líder veio de 2 dias em 210.

---

## 8.5 "Matar as mesas que provaram" — o que isso valia de verdade

O dono autorizou desligar tudo que já provou não dar lucro. Medi antes de
executar, e a economia **não é onde parecia**.

### O gasto pago inteiro é ≈ $0,12 por semana

| mesa (últimos 7 dias) | modelo | entrada | custo |
|---|---|---|---|
| `backtest_mistral` | mistral-large | 1.263.789 | **$0** — tier grátis |
| `radar` | mistral-large | 437.643 | **$0** |
| `strat_ai` (MÍMIR) | mistral-large | 26.917 | **$0** |
| `oracle_grok` | grok-4.3 | 43.043 | $0,062 |
| `oracle_kimi` | kimi-k2.6 | 37.154 | $0,029 |
| `oracle_deepseek` | deepseek-v4-pro | 26.017 | $0,026 |

O Mistral roda no **plano gratuito** (`ai-cost.ts`: *"cash cost is $0 and the
real constraint is the monthly quota"*). Logo o maior consumidor de tokens do
sistema — `backtest_mistral`, com 49% de todo o tráfego — não custa dinheiro,
custa **cota**. E gasta essa cota numa mesa provada negativa.

### As mesas mecânicas não custam nada, e três formam um experimento

VÖLUNDR, URÐR, FREYJA e SKAÐI têm `brain: "none"` — `selectPlaybook` puro, zero
chamada de modelo. **Matá-las economiza $0.** E o `aprendizado.ts` registra que
`strat_mech` (VÖLUNDR) é o **CONTROLE**: *"a mesa que ignora tudo por decisão
experimental"*. VÖLUNDR × MÍMIR × URÐR é um duelo de três braços — controle,
cérebro LLM, e registro medido. Matar o controle não corta gasto: apaga a
régua contra a qual os outros dois são medidos.

### O vazamento real: o oráculo gastou três semanas depois de morto

**As cinco mesas oráculo estão `valhalla` desde 27/07 e nunca pararam.**
`oracle.ts` monta a lista de provedores sem consultar `isArquivada`:

```
oracle_grok      7 chamadas, última 19/08
oracle_kimi      6 chamadas, última 19/08
oracle_deepseek  4 chamadas, última 18/08
```

⚠️ **E o guarda já existia.** `isArquivada` é a MESMA função que o cron do
backtest usa desde 13/08 — e lá funciona: `backtest_grok`, `backtest_kimi` e
`backtest_deepseek` pararam em **14/08** e não gastaram mais nada. O portão
estava construído, testado e ligado **em um caminho só**.

**Corrigido (19/08):** guarda no `oracle.ts` e no `sniper.ts` (que estava
`valhalla` e desguarnecido, inativo hoje só porque o cron não o chama), mais o
teste `mesa-arquivada-nao-gasta.test.ts` — que inventaria **todo** módulo capaz
de chamar modelo e exige que cada um declare onde está o seu guarda. Caminho
novo que gaste sem entrar no inventário derruba o CI.

> $0,50/mês não é o ponto. O ponto é que "aposentar uma mesa" significava
> coisas diferentes em arquivos diferentes: o torneio marcava `retired`, o
> painel escrevia Valhalla, e a fatura continuava chegando.

---

## 9. O que dá para fazer — em ordem de retorno

### Economia (vale dinheiro hoje)
1. **Desligar o que já está provado negativo.** As mesas de modelo consomem
   crédito de IA para produzir ≈ −1%/trade em amostra grande. Não é hipótese
   pendente; é resultado medido em milhares de decisões.

### Instrumento (impede o próximo erro)
2. **Fazer o `nEfetivo` enxergar o dia de mercado** — uma segunda chave por
   janela temporal, sem símbolo. Sem isto, o próximo "vencedor" será outro
   `radar`.
3. **Coluna "sem o melhor dia" no torneio.** Mesa cuja vantagem morre sem um dia
   não é mesa. É a pergunta que teria matado o `radar` no primeiro olhar.
4. **Portão de confiança ≥65.** Recusa 602 trades, poupa 933 pp. Não vira lucro,
   corta 27% do sangramento.

### Verdade (não é código)
5. **Não existe ajuste que transforme −0,57% bruto em positivo.** Alvo, stop,
   regime, lado, horizonte, seletividade — todos foram cortados e todos são
   negativos. A largura de stop, que parecia ser a explicação, foi **testada e
   refutada** (folga por faixa: −1,8 / −9,1 / −10,1 / −13,5 / −11,5 / +4,4, sem
   monotonia).

---

## 10. O que eu quase afirmei errado

Três vezes, nesta mesma auditoria:

**"A mesa que ganha é a que dá mais espaço ao stop."** O `radar` tinha o stop
mais largo (3,08%) e era a única positiva. Juntei todas as mesas, cortei só por
largura de stop, e não havia monotonia nenhuma. Identidade de mesa não é causa.

**"As mesas de arbitragem ganharam $313 e o contador não recebeu."** Ia reportar
como bug. Era o oposto: o arquivamento correto de uma ilusão que o portão de
profundidade já tinha bloqueado.

**"Buraco de caixa de $7.723 em 9 carteiras."** Ia entrar como achado. Já estava
documentado como **cicatriz deliberada** — preservada de propósito para não
apagar o registro do vazamento de julho. Só não virou ruído porque eu fui ler o
`docs/` antes de escrever.

> Correlação que sobrevive a um corte por identidade não é causa. Corte por
> mecanismo, e junte as mesas antes de acreditar.
>
> E antes de chamar qualquer coisa de achado: procure no `docs/` se alguém já
> decidiu aquilo de propósito. Cicatriz reportada como bug custa a mesma
> atenção que bug de verdade — e gasta a credibilidade que o achado real precisa.

É a invariante nº 33 cobrando duas vezes, no mesmo dia em que a auditoria a usou.
