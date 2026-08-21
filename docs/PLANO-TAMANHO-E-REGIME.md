# PLANO — o cinto e o motor: filtro de regime e tamanho de posição

**Status: 🟡 passos 1 e 2 entregues · passo 3 aguardando decisão** · 21/08.

> **Em uma frase:** o tamanho da posição vale ~26× mais que o filtro de regime
> hoje — e o filtro vale 5,5× mais **depois** que o tamanho sobe. Um é o motor,
> o outro é o cinto, e a ordem de instalação importa.

---

## 1. A medição que mandou

206 posições fechadas reais, 11 dias (10/08 → 21/08), nove mesas, todas de $50.

| cenário | PnL | ganho |
|---|---|---|
| como está hoje | +$126,98 | — |
| **só o tamanho** | **+$268,27** | **+$141,29** |
| só o filtro de regime | +$132,43 | +$5,45 |
| **as duas juntas** | **+$298,33** | **+$171,35** |

$141,29 + $5,45 = $146,74. Juntas dão **$171,35**. Os ~$25 de diferença são
exatamente as perdas contra-tendência que o tamanho maior teria **amplificado**:

```
perda nas entradas contra a tendência, hoje:     −$5,45
a mesma perda, com o tamanho corrigido:         −$30,06
```

**É por isso que a ordem é filtro primeiro.** Aumentar a aposta sem o filtro
dobra também o que se perde: no mesmo exercício a FREYJA sai de −$12,72 para
−$84,80.

## 2. O gargalo do tamanho é o PICO, não o caixa

`sizePosition` (`engine.ts:62`) já limita pelo caixa disponível. O caixa nunca
foi o problema — em 11 dias nenhuma mesa passou de 11 posições simultâneas:

| mesa | pico simultâneo | podia usar | usa hoje |
|---|---|---|---|
| Radar | 5 | $200 | $50 |
| Mistral | 6 | $167 | $50 |
| FREYJA / ULLR | 3 | $333 | $50 |
| VÖLUNDR / SKAÐI | 11 | $91 | $50 |

Com $1.000 de banca, dava para usar de $91 a $333 por posição **sem recusar uma
única entrada**. O dinheiro estava parado.

---

## PARTE 1 — O CINTO (filtro de regime)

### O sinal, e por que ele não olha o futuro

A tentação é filtrar pelo retorno DO DIA — e isso é viés de antecipação puro:
usa o resultado para decidir a entrada que o produziu. A medição acima usa a
tendência das **24 horas ANTERIORES** à abertura, que é informação que existia
no momento da decisão.

### ⚠️ CORREÇÃO NA IMPLEMENTAÇÃO: o sinal medido não é o ADX

A primeira versão deste plano mandava usar `MarketRegime` de `computeIndicators`
(ADX + DI). **O que a medição de $5,45 usou foi outra coisa**: o retorno das 24
horas anteriores, símbolo a símbolo.

São sinais diferentes. Enviar o ADX citando aquele número seria carimbar uma
medição no nome de outra grandeza — a mesma família do custo do HEIMDALL com o
nome da GERI. Então o que foi implementado é **o que foi medido**:
`tendencia24h` + `permiteEntrada` (`paper/engine.ts`), sobre velas de 5m da
Gate.io — a mesma corretora onde as mesas preenchem.

O ADX continua sendo o candidato mais rico e segue **não medido**. Vira variante
a comparar depois, com número próprio, não substituição por intuição.

### A regra

**Não abrir posição long quando a tendência de 24h do símbolo não for positiva.**

⚠️ **Por símbolo, não por mercado.** O dono formulou a política e ela está
certa: *"nunca 100% do mercado está em queda; sempre tem uma parte sangrando e
outra verde"*. Um filtro de mercado inteiro desligaria a mesa nos dias em que
existe a moeda certa. O filtro é por ativo.

⚠️ **Empate barra.** `> 0`, não `>= 0` — preço parado não é tendência de alta.
Foi assim que a medição contou (`px_agora <= px_ontem` entrava nas barradas), e
o código segue a mesma linha para o número continuar descrevendo o código.

⚠️ **Só o lado LONG.** Vender em tendência de queda é a operação certa. As mesas
de hoje são todas long-only, mas escrever a regra sem o lado deixaria uma
armadilha pronta para a primeira mesa que vender.

### Onde encaixa

`engine.ts:455-458`, no laço que decide abrir. Vira mais uma recusa nomeada, ao
lado de `sem_preco_de_pool` e `preco_fora_da_faixa`:

```
if (s.side === "buy" && !permiteEntrada(tend)) { nota(s.source, "contra_tendencia"); continue; }
```

⚠️ **A recusa tem que aparecer no `paper_open_skip`.** Um filtro que barra em
silêncio produz exatamente o mistério que custou dez dias da FREYJA: mesa parada
e ninguém sabe de quê.

⚠️ **Falha ABERTA, não fechada.** Sem indicador legível o filtro deixa passar.
É o oposto da regra do caminho do dinheiro — e de propósito: aqui o "não medido"
não protege capital, ele só impede a mesa de operar. Um provedor de velas fora
do ar não pode desligar a mesa inteira.

---

## PARTE 2 — O MOTOR (tamanho de posição)

### É configuração, não código

```
engine.ts:27  const POSITION_PCT = Number(process.env.PAPER_POSITION_PCT ?? 0.05)
```

**Já é variável de ambiente.** Não há PR de lógica para o passo 3 — há uma
decisão de número e o teste que a protege. Por isso ele fica para o dono.

### O número proposto: 0,05 → 0,08

Não 0,09 (que seria o ótimo para o pico de 11) porque 11 × 9,1% = 100% da banca,
sem folga nenhuma: o 12º sinal seria recusado por caixa. Com 8%:

```
11 posições × 8% = 88% da banca
folga para o 12º e o 13º sinal = 12%
```

⚠️ **Isso captura PARTE do ganho medido, não todo.** A simulação usou o ótimo
POR MESA (1,82× a 6,67×); um `POSITION_PCT` global de 8% dá 1,6× para todas —
cerca de metade dos $141. O resto exige tamanho por mesa, que é o passo 3 e
depende de o pico de cada uma se provar estável.

### A trava que precisa existir junto

`sizePosition` devolve 0 quando o caixa acaba, e o comentário da função já diz
que esse estado "é exatamente a percepção de portfólio que queremos". Hoje ele
virava `sem_caixa` dentro do `paper_open_skip` — e ali ele SUMIA justamente no
caso que importa: aquele evento só dispara para a mesa que não abriu NADA, então
a mesa que abre 3 e recusa 5 por falta de caixa não deixava rastro.

**Entregue no passo 2:** o evento `paper_sem_caixa`, que dispara por mesa sempre
que houve recusa por capital — tenha ela aberto posição ou não — e leva junto o
caixa e a banca, porque "5 recusadas" não diz se o tamanho está apertado ou se a
mesa está sem dinheiro. São causas opostas.

---

## 3. ⚠️ A CICATRIZ QUE ESTE PLANO NÃO PODE REPETIR

`convictionFactor` (`engine.ts:67-73`) está **neutralizado em 1×**, e o
comentário explica por quê:

> *"isto costumava aumentar a aposta com a probabilidade declarada pelo modelo —
> que o flywheel provou ANTI-calibrada (32,7% de acerto abaixo de 60 de
> confiança → 0% acima de 80), então apostava mais exatamente onde o modelo
> estava mais errado."*

**Nada neste plano reabre isso.** O tamanho proposto é FIXO por mesa, derivado
do pico simultâneo medido no ledger — nunca da confiança que o modelo diz ter.
Se alguém, lendo "vamos aumentar a aposta", reintroduzir dimensionamento por
convicção, estará repetindo uma auditoria de 25/07 que já custou dinheiro.

---

## 4. O que esta medição NÃO prova

1. **A janela foi quase toda de alta** — só ~4 dias fracos em 11. Isso favorece
   o tamanho e subestima o filtro. Os $5,45 do filtro são o valor dele **no
   mercado mais amigável possível para não tê-lo**. Numa sequência de queda a
   ordem dos dois se inverte.
2. **O modelo de pico assume estabilidade.** Se um dia trouxer 20 sinais
   simultâneos, ou o tamanho cai ou entradas são recusadas — nenhum dos dois
   está simulado.
3. **46 das 206 entradas não tinham histórico de 24h** para gerar sinal. Foram
   contadas como permitidas; excluí-las mexeria no número do filtro.
4. **Tamanho amplifica os dois lados.** O +$141 existe porque o período subiu.
   O mesmo tamanho num período de queda transforma −$127 em −$268.
5. **Nenhuma mesa foi testada em mercado vermelho ainda.** 338 decididos, zero
   em queda sustentada.

## 5. Como saber se deu certo — e quando voltar atrás

**Critério de sucesso (filtro):** a taxa de acerto das entradas não cai e o
número de entradas com tendência de 24h não positiva vai a zero (`paper_regime_tick`). Se a taxa de acerto cair, o
filtro está barrando reversão boa e a regra precisa de faixa, não de corte.

**Critério de sucesso (tamanho):** retorno sobre a banca sobe proporcionalmente
ao fator, e `sem_caixa` fica abaixo de ~5% das entradas. Acima disso, 8% foi
longe demais.

**Gatilho de reversão:** as duas mudanças são de configuração e de um `continue`
— voltar é editar uma env var e remover quatro linhas. **Reverter primeiro,
investigar depois**, se a carteira agregada cair mais que a maior perda diária
já registrada no período medido.

## 6. Ordem de entrega

1. **Filtro de regime** — barra `TRENDING_DOWN`, recusa nomeada no
   `paper_open_skip`, falha aberta, testes da função pura.
2. **Contador de recusa por caixa** — o instrumento que diz se o passo 3 foi
   longe demais. Antes de mexer no tamanho, não depois.
3. **`PAPER_POSITION_PCT` 0,05 → 0,08** — configuração, com o teste de
   `sizePosition` atualizado para travar o novo valor.
4. *(depois, se o pico se provar estável)* tamanho por mesa.

⚠️ O passo 3 **não sobe sem o passo 1 no ar**. É a conclusão inteira da
medição: o motor sem o cinto amplifica a perda em 5,5×.
