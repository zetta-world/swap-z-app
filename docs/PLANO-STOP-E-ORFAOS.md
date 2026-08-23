# PLANO — o stop fora do ruído, e o agente que morreu com capital vivo

**Status: 🟢 entregue** · 23/08.

> **Em uma frase:** as três primeiras entradas decididas do Celeiro morreram no
> stop porque o stop estava DENTRO do ruído do SOL — e o agente que a autópsia
> matou ficou com $100 abertos que ninguém fecha.

---

## 1. A revisão que mandou

O Celeiro perdeu ~10 USDT. Decompondo pelo ledger (`celeiro_fluxos`), **não é uma
perda — são duas mortes opostas**:

| agente | preço | taxa | líquido | morreu de |
|---|---|---|---|---|
| Maker de Faixa | **+3,1557** | −3,3750 | −0,2339 | **pedágio** — acertava e não pagava a conta |
| Alavancado de Tendência | **−4,8000** | −1,5750 | **−6,3750** | **direção** |
| Caçador de Tendência | **−3,0000** | −0,5625 | **−3,5625** | **direção** |
| Aluguel de Ocioso *(controle)* | — | — | **+0,1756** | não aposta direção |

O único positivo é o controle, que não tem opinião sobre preço.

⚠️ E os dois agentes novos **não morreram da morte do Maker**. O Maker acertava
o preço e perdia no pedágio; estes estão errando o preço. A taxa é 25% da perda
do alavancado. Consertar o pedágio neles não resolveria nada.

## 2. As três entradas decididas

```
23:30  alavancado  VENDE  SOL @ 93,63  → stop 94,75   −1,200%   1,5h
01:00  caçador     COMPRA SOL @ 96,24  → stop 95,09   −1,200%   1,5h
01:00  alavancado  COMPRA SOL @ 96,24  → stop 95,09   −1,200%   1,5h
```

**Vendeu o fundo e comprou o topo** — vendeu a 93,63 e comprou a 96,24 uma hora
e meia depois, 2,8% acima. As três morreram no stop, exatamente na distância
dele. Nenhuma chegou perto do alvo.

## 3. A causa: o stop está dentro do ruído

Medido em 3 dias de velas de 5m, janelas de 1,5h (o tempo que as três viveram):

| ativo | janelas que tocam ±1,2% | mediana do maior movimento | amplitude/vela |
|---|---|---|---|
| **SOL** | **39,6%** | **1,02%** | 0,98% |
| ETH | 24,2% | 0,80% | ~0,55% |
| BTC | 17,1% | 0,58% | 0,32% |

O stop era **1,2% para todos**. No SOL isso fica a um passo da mediana do ruído:
4 em cada 10 janelas o tocam sem tendência nenhuma.

⚠️ **E o projeto já media essa volatilidade.** `lerRegime` devolve
`volatilidadePct`, e ela alimentava `alavancagemCoerente` para dimensionar a
ALAVANCA (10× BTC, 8× ETH, 3× SOL). O risco estava medido — e não era aplicado
onde decide o resultado.

## 4. ⚠️ Uma correção ao que eu mesmo disse

Eu afirmei que a geometria 2,0/1,2 "não tem borda" e sugeri como se fosse um
defeito daquele par. **Está impreciso, e a imprecisão importa.**

Num passeio sem tendência, `P(alvo antes do stop) = stop/(alvo+stop)`, e o valor
esperado dá **exatamente zero para QUALQUER par**. Alargar o stop troca "erra
menos vezes" por "perde mais quando erra", e as duas se cancelam. Nenhuma
geometria cria borda — só a direção cria.

**O que não se cancela é o pedágio.** Ele é cobrado por ida-e-volta, então saída
decidida por ruído é pedágio pago numa moeda honesta. Menos viagens inúteis é a
única economia real — e é essa a justificativa de alargar o stop, não "vamos
perder menos".

## 5. O que entrou

### I2 — `stopPorVolatilidade` (`lib/celeiro/regime.ts`)

```
stop = max(declarado, volatilidade × MULTIPLO_DO_RUIDO)   com teto
```

- **`MULTIPLO_DO_RUIDO = 3`** não é palpite: é o que o BTC já tinha na prática
  (1,2% sobre 0,32%/vela = 3,75 amplitudes) — e foi o menos chicoteado dos três.
  O número iguala os ativos **na unidade que importa**, que é o ruído deles.
- **`STOP_TETO_PCT = 6`** — stop largo demais transforma uma perda em várias.
- ⚠️ **É PISO, NUNCA TETO.** Só alarga o declarado, jamais aperta. Apertar o do
  BTC seria mudança sem medição atrás; a medição que existe fala de quem está
  apertado demais.
- ⚠️ Sem volatilidade legível devolve o declarado com **`medido: false`** — a
  diferença entre "medi e deu isso" e "não medi" não pode sumir na tela.

O motivo viaja no extrato de cada exame (`· stop ${st.porque}`).

### Os órfãos — `agentesComAbertas` (`lib/celeiro/store.ts`)

O `maker_de_faixa` saiu do registro quando a autópsia o condenou, e deixou
**duas posições abertas**: $100, uma delas parada **exatamente em cima do stop**
e **3,4h além do limite de 8h**. O varredor é chamado por agente NOMEADO, numa
lista escrita à mão no cron — e ele não estava nela.

⚠️ **O pior não era o dinheiro.** A autópsia que MATOU o agente se calcula sobre
posições FECHADAS. Essas duas nunca entrariam, e o número que justificou a
decisão ficaria permanentemente incompleto.

O conserto: **a lista de quem OPERA é uma decisão; a de quem FECHA não pode
ser.** Quem tem posição aberta é pergunta para a tabela. `deveFechar` só usa
campos da própria linha (lado, alvo, stop, horas limite) — fechar nunca precisou
do registro; era a lista que precisava.

Órfão encontrado **sempre** grava `celeiro_orfaos`: agente fora do registro com
capital vivo é estado que ninguém escolheu, e some da tela se depender de alguém
abrir o relatório do tick.

## 6. ⚠️ O que eu RETIREI, e por quê

Eu tinha sugerido **impedir que dois agentes tomem a mesma operação**. As
entradas 2 e 3 são idênticas — mesmo símbolo, lado, preço e minuto — e eu li
isso como duplicação de risco.

**Está errado, e o código me corrigiu.** O `aposentaQuando` do Alavancado diz:

> *"render menos que o **Caçador de Tendência sem alavanca** — aí a alavanca só
> comprou risco"*

Os dois são um **A/B declarado**: mesmo sinal, um spot 1×, outro alavancado.
Deduplicar destruiria exatamente a comparação que decide se a alavanca compra
alguma coisa. A duplicação é o experimento.

## 7. O que isto NÃO prova

1. **A amostra é de TRÊS fechamentos.** Nada aqui é conclusão sobre a
   estratégia — é conserto de uma geometria que estava medindo ruído.
2. **Alargar o stop não cria borda** (§4). Se o sinal não tiver direção, o
   resultado continua negativo; só perde menos em pedágio no caminho.
3. **O múltiplo 3 é um ponto de partida ancorado no BTC, não um ótimo medido.**
   O que o valida ou derruba é a taxa de saída por stop contra saída por alvo,
   com amostra — e ela ainda não existe.
4. **O chicote continua.** Vender o fundo e comprar o topo é o sinal entrando
   tarde; o stop mais largo dá espaço, não pontaria.

## 8. Como saber se funcionou

- **`celeiro_orfaos` some da tela** depois do primeiro tick — as duas posições
  do Maker fecham por stop ou por tempo, e o extrato dele passa a estar completo.
- **A razão stop/alvo nas saídas muda**: hoje é 3 stops / 0 alvos. Com o stop
  fora do ruído, a proporção deveria cair. Se continuar 100% stop com amostra
  maior, o problema é a DIREÇÃO e não a geometria — e aí o alvo é o Caçador
  contra o Aluguel de Ocioso, que é o critério de aposentadoria já declarado.
