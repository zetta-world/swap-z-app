# PLANO — reserva de modelo dentro do provedor

**Status: 🟢 entregue** · 29/08 · nasce do incidente da Mistral do mesmo dia.

> **Em uma frase:** um nome de modelo recusado por direito de plano apagou
> quatro mesas, e a razão é que existiam três camadas de reserva no sistema —
> nenhuma delas cobrindo o caso.

---

## 1. O que aconteceu

```
último sucesso .............. 29/08 00:00:28 (9.456 tokens, normal)
primeiro tier_not_allowed ... 29/08 03:30:16
desde então ................. 9 erros, 100% a mesma causa

403 · "This model is not available in your subscription tier"
type: tier_not_allowed · code 1910 · modelo: mistral-large-latest
```

Entre meia-noite e 03:30 o `mistral-large-latest` saiu do plano do dono. **A
chave continua válida** — ela é aceita; o que é recusado é o MODELO.

Três falhas seguidas abriram o disjuntor e a **Mistral inteira** saiu do ar. Ela
ocupa dois assentos do `ROLE_PREFERENCE` (`brain` e `sentiment`), então caíram
junto o flywheel, o radar, o oráculo e o sniper.

⚠️ **Um nome de modelo derrubou quatro mesas** — e a Mistral estava viva o tempo
todo, respondendo com precisão qual era o problema.

---

## 2. As três reservas que já existiam, e o buraco entre elas

| camada | onde | nasceu | cobre |
|---|---|---|---|
| provedor → provedor | `roleProviderChain` | 03/08 | "Mistral fora" → tenta DeepSeek |
| modelo → modelo (plataforma) | `zion/model.ts` | N1 | ZION sobrecarregado → modelo reserva |
| **modelo → modelo (provedor do registro)** | **não existia** | — | **o caso de hoje** |

O buraco tem forma de história: cada camada ganhou a sua reserva no dia em que
caiu. Esta caiu agora.

⚠️ **E a primeira camada não salvou**, apesar de existir. Só o `strat_ai`
consome a fila inteira de provedores; `backtest`, `oracle`, `sniper` e `radar`
chamam `roleProvider()`/`hybridBrain()`, que devolvem **um**. Uma reserva que só
um chamador usa cobre um chamador.

---

## 3. O que foi feito

`src/lib/ai/modelo-reserva.ts` — `chamarComReserva(provedor, req)` no lugar de
`openaiCompatChat(...)` em **todos** os 10 pontos que chamam com um
`ProviderConfig` do registro. Cada provedor passa a ter `models: string[]`, e
`<PROVEDOR>_MODEL` aceita lista separada por vírgula.

### As quatro decisões que valem discussão

**① Só duas classes de erro trocam o modelo.** `plano` e `modelo` são recusas do
NOME — outro nome pode passar. `auth`, `cota` e `upstream` não são: trocar de
modelo com a chave revogada repete o mesmo 401 com outro nome, gasta três
chamadas por tick e ainda **esconde a causa**, porque o operador passa a ver
"caiu para a reserva" onde o certo era "recarregue o crédito". Ali esperar é a
ação, e o disjuntor continua sendo quem cuida.

**② O modelo que respondeu vai para o registro.** `ChatResult.model` carrega o
nome real, e todo chamador já grava `model: r.model` no `recordEvent`. Sem isso
o flywheel mediria um modelo e creditaria outro — e **um número errado tem
exatamente a mesma cara de um número certo**.

**③ O veto é lembrado, e VENCE.** Sem memória, toda chamada paga a recusa do
preferido antes de chegar na reserva (seis mesas × 12 ticks/hora). Mas um veto
eterno exigiria alguém lembrar de rearmar depois de subir o plano — e provedor
que só ressuscita por intervenção manual é a morte silenciosa que este repo se
recusa a causar. Seis horas, igual ao cooldown de causa permanente.

⚠️ **Com a fila inteira vetada, tenta o preferido assim mesmo.** "Todos vetados"
e "nada a tentar" não são a mesma coisa: o veto é uma aposta sobre o passado, e
desistir por causa dele viraria uma heurística de economia em um desligamento
que ninguém decidiu.

**④ O env manda sozinho.** Se o dono escreve `MISTRAL_MODEL=mistral-small-latest`,
ele está dizendo "este e mais nenhum". Costurar a nossa reserva por baixo faria
o sistema chamar — e cobrar por — um modelo que ele não escolheu. Quem quer
reserva escreve a vírgula.

---

## 4. O que isto NÃO resolve

⚠️ **A mesa fica viva com um modelo PIOR, e isso muda o que o experimento
mede.** `mistral-medium` respondendo no assento do `brain` não é o mesmo
`brain` de ontem: a comparação entre mesas atravessa uma troca de cérebro no
meio da amostra. O registro do modelo real (decisão ②) é o que torna isso
auditável depois — não é o que torna a amostra homogênea.

⚠️ **Não substitui a ação do dono.** Se o plano não inclui nenhum modelo da
fila, as três recusas acontecem e a mesa cai igual — só que agora com um alerta
que diz o nome de cada modelo recusado, em vez de "gere outra chave".

**O que continua na mão do dono:** conferir se a assinatura da Mistral caiu, e
se sim, apontar `MISTRAL_MODEL` para o que o tier inclui.

---

## 5. Travas

`src/lib/ai/modelo-reserva.test.ts` — 19 casos, quebrados em quatro direções
antes de entrar:

| o que eu quebrei | quem pegou |
|---|---|
| descer a fila em QUALQUER erro | 2 testes (401 e cota/upstream) |
| resultado devolver o modelo preferido em vez do real | 3 testes |
| Mistral voltar a ter um modelo só | 1 teste |
| tirar a memória do veto | 2 testes (repagar o 403, alerta por tick) |

E `mesa-arquivada-nao-gasta.test.ts` aprendeu o novo caminho de gasto: a
varredura do inventário agora procura `chamarComReserva` junto com
`openaiCompatChat`, senão dez módulos que gastam modelo sumiriam do inventário
justamente por terem sido migrados.
