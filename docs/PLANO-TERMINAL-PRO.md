# PLANO — o que falta para o terminal ser PRO de verdade

**Status: 🔵 lista para decisão** · 31/08 · nasce da comparação lado a lado com
o DEXTools que o dono fez.

> **A tese:** um terminal pro não é o que mostra MAIS números — é o que mostra os
> números que **decidem**. O DEXTools ganha de nós hoje em densidade de fato
> bruto; nós temos máquina para responder perguntas que ele não responde. A
> lista abaixo fecha a primeira lacuna e explora a segunda, nessa ordem.

---

## Tier 0 — o que está QUEBRADO (isto não é feature)

Duas coisas na tela não são "falta de painel", são defeito. Vêm antes de tudo.

### 0.1 ⚠️ A `DEPTH` mostra `—` em todas as cinco faixas

O painel pede **quote firme** com `taker` zerado:

```ts
taker: "0x0000000000000000000000000000000000000000"
mode:  "quote"
```

E o docstring da própria rota diz: *"taker: user wallet (**required** for
`mode=quote`)"*. Some-se a isso que o painel faz **10 cotações firmes por
atualização** (5 tamanhos × 2 direções) contra um limite de `RL_FIRM = 25/min`:
duas atualizações e o teto chega.

⚠️ **CORREÇÃO (31/08, mesmo dia).** Eu escrevi acima *"trocar para
`mode: price`"*. **Não existe `mode=price`** — a rota tem `list` e `quote`, e eu
inventei um terceiro pelo nome do conceito. O caminho certo já existia e é o
`list`, que internamente chama `fetchZeroXPrice`: indicativo, sem `taker`, fora
do kill-switch e no limite folgado (`RL_LIST = 40/min`).

E havia uma **terceira** coisa errada que eu não tinha visto: `mode=quote` passa
pelo kill-switch do swap. Desligar o swap apagaria um painel de INFORMAÇÃO, que
não move dinheiro.

**✅ ENTREGUE.** Impacto de preço é exatamente uma pergunta indicativa — ninguém
vai assinar essa cotação.

### 0.2 ⚠️ O par do BNB aponta para a pool com menos volume

Nosso `bnb-usdt` é a **PancakeSwap V3 0,05%** (TVL $11,79M). A tela do DEXTools
que o dono comparou é a **V2** ($87,87M de liquidez). São pools diferentes, e
parte da sensação de "lá acontece mais coisa" é isso.

Não é obviamente errado — V3 concentra liquidez e o TVL não é comparável direto
— mas **é uma escolha que ninguém tomou conscientemente**, e ela decide o que o
usuário vê. Merece uma medição: qual das duas dá melhor execução no tamanho que
operamos.

---

## Tier 1 — dado que JÁ CHEGA e a gente joga fora

Custo: quase zero. **Nenhuma requisição nova** — estes campos vêm nas respostas
que já fazemos, são parseados e descartados.

| campo | onde já chega | o que vira na tela |
|---|---|---|
| `market_cap_usd` | `GTPoolAttrs` | Market cap |
| `fdv_usd` | `GTPoolAttrs` | FDV — e a razão FDV/mcap, que denuncia desbloqueio futuro |
| `pool_created_at` | `GTPoolAttrs` | **Idade do pool** — o DEXTools mostra, e é sinal de risco de primeira ordem |
| `price_change_percentage.h1` | `GTPoolAttrs` | Variação 1h (hoje só usamos 24h) |
| `volume_usd.h1` | `GTPoolAttrs` | Volume 1h — o pulso recente, não o do dia inteiro |
| `quote_token_price_usd` | `GTPoolAttrs` | Preço da outra ponta |
| `holders` | `TokenInfo` | Detentores |
| `totalSupply` | `TokenInfo` | Supply |

⚠️⚠️ **E o campo mais valioso da lista, que ninguém usa:**

```ts
transactions.h24: { buys, sells, buyers, sellers }
```

**Compradores ÚNICOS contra vendedores ÚNICOS em 24h.** Isso é outra coisa que
"volume de compra vs venda": distingue *mil carteiras comprando* de *uma
carteira comprando mil vezes*. É a diferença entre distribuição e manipulação, e
já está no payload que a gente pede a cada minuto.

⚠️ `getTokenInfo` **já existe e funciona** — é usada em `/api/risk` e no ZION.
O `/pro` simplesmente nunca a chama.

---

## Tier 2 — uma requisição a mais, fonte já integrada

| item | fonte | já usada em |
|---|---|---|
| Reservas dos dois lados (pooled USDT / pooled WBNB) | GeckoTerminal | — |
| Honeypot, taxa de compra/venda, LP travado | GoPlus | `pool-fonte.ts` (Celeiro) |
| Concentração do top 10 | GoPlus | `pool-fonte.ts` (Celeiro) |

⚠️ **O Celeiro já sabe fazer isso.** `liquidezTravada` e a leitura de
concentração existem, testadas, servindo o `pool_novo`. Trazer para o terminal é
reuso, não integração nova.

---

## Tier 3 — ⭐ o que nos torna PRO, e o DEXTools NÃO tem

Aqui está a resposta para *"não quero copiar a UI da dextool"*. O DEXTools
mostra o mercado; nós podemos mostrar **a decisão**. Cada item abaixo já existe
como código medido nesta casa — falta só apontar para a tela.

### 3.1 O pedágio como fração do alvo

`fracaoDoPedagio(taxaPernaPct, alvoPct)` — já escrita, já testada.

> *"Seu alvo de 0,6% entrega **37% do movimento bruto** para a corretora antes
> de o preço se mexer."*

⚠️ Foi essa conta que matou o `maker_de_faixa`, que acertava 70% e perdia
dinheiro. Nenhum terminal do mercado põe isso na cara de quem vai clicar.

### 3.2 O stop contra o RUÍDO do ativo

`stopPorVolatilidade(volatilidadePct, stopDeclarado)` — já escrita, nascida de
três posições mortas no mesmo minuto.

> *"Seu stop de 1,2% no SOL está **dentro** do ruído: 39,6% das janelas de 1,5h
> o tocam sem tendência nenhuma. No BTC, o mesmo 1,2% é outra coisa."*

### 3.3 O tamanho que a pool aguenta

`portaoDeProfundidade` — já escrita. Não "qual o impacto de $50k", mas a
pergunta invertida, que é a que o trader tem:

> *"Acima de **$18k** você paga mais de 30bps de derrapagem nesta pool."*

### 3.4 Contra comprar-e-segurar

`comprar-e-segurar.ts` — já escrita, é a régua do laboratório.

> *"Nos últimos 7 dias, segurar este par rendeu +19,4%. Sua ideia precisa bater
> isso para valer o risco de timing."*

⚠️ É a cor de três estados (`cor-resultado.ts`) aplicada ao terminal: ganhar
dinheiro e perder de segurar é **âmbar**, não verde.

### 3.5 O ZION lendo a tela

O dock já está lá. O que falta é ele receber o contexto que o terminal já tem —
regime, MTF, fluxo, profundidade — em vez de responder no vácuo.

---

## Tier 4 — infraestrutura

**4.1 Streaming de verdade.** Hoje é polling, e o conserto de 31/08 fez o
polling existir (antes não existia). A GeckoTerminal é REST — streaming real
exige outra fonte (websocket de DEX, ou nó próprio). É o item mais caro da lista
e o de menor retorno imediato: a 10s por atualização, um gráfico de 1m já anda.

**4.2 Layout e preferências que sobrevivem ao refresh.** Indicadores ligados,
timeframe, par. Barato, e é o tipo de coisa que separa "demo" de "ferramenta".

---

## A ordem que eu recomendo

```
1.  ✅ Tier 0.1  a DEPTH voltar a responder          ENTREGUE
2.  ✅ Tier 1    o que já chega e é descartado       ENTREGUE
3.  ✅ Tier 3.1  pedágio sobre o alvo                ENTREGUE
4.  ✅ Tier 3.2  stop contra o ruído                 ENTREGUE
5.  Tier 0.2   medir V2 contra V3 no nosso tamanho ⚠️ EXIGE REDE — o contêiner
                                                    do agente não alcança a
                                                    GeckoTerminal nem a 0x
6.  Tier 2     segurança e reservas                ⚠️ baixo valor NOS PARES DE
                                                    HOJE: são todos blue chips,
                                                    e honeypot/LP travado sempre
                                                    diria "ok". Vira valioso no
                                                    dia em que o registro
                                                    aceitar cauda longa
7.  ✅ Tier 3.3 tamanho executável                  ENTREGUE
8.  ✅ Tier 3.4 contra comprar-e-segurar             ENTREGUE
9.  ✅ Tier 4.2 preferências persistentes            ENTREGUE
10. Tier 4.1   streaming                           caro, e o polling já resolve
```

⚠️ **Os itens 3 e 4 são os que mudam o caráter do produto.** O resto fecha
distância; eles abrem. Um terminal que diz *"esse alvo não paga o pedágio"*
antes do clique é uma categoria diferente de um que desenha velas bonitas — e é
a única em que a gente tem vantagem, porque a máquina de medir já está pronta e
custou cicatriz.
