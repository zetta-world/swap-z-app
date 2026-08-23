# OBSERVAÇÃO — Celeiro, 23/08 às 10:46 UTC

**Status: 🔵 aberta** · fecha quando houver amostra, não quando o número agradar.

> **Por que este arquivo existe:** o que entrou no #335 muda o comportamento dos
> agentes. Se eu só olhar os números DEPOIS, escolho o recorte que me favorece
> sem nem perceber. Então o critério fica escrito ANTES.

⚠️ **Isto NÃO é o T0 do projeto.** O dono declarou que não marca T0 enquanto não
calibrar todas as mesas. Esta é uma observação local do Celeiro, e o nome é
diferente de propósito.

---

## 1. A linha de base, congelada às 10:46 UTC

| agente | fechadas | alvo | stop | tempo | soma no preço |
|---|---|---|---|---|---|
| `maker_de_faixa` | 29 | **19** | 8 | 2 | **+6,3113%** |
| `alavancado_de_tendencia` | 2 | 0 | **2** | 0 | −2,4000% |
| `cacador_de_tendencia` | 1 | 0 | **1** | 0 | −1,2000% |

Abertas: 2 órfãs do Maker (12,1h contra limite de 8h) e 3 vendas do Alavancado.

Confere com o ledger em USD — 6,3113% × $50 = $3,156; −2,4% × $200 = −$4,80;
−1,2% × $250 = −$3,00. Percentual e caixa são unidades diferentes do mesmo fato.

## 2. O que cada conserto TEM que mostrar

Escrito como falseável: se não acontecer, o conserto não pegou.

| conserto | o que aparece | o que o derruba |
|---|---|---|
| **órfãos** | `celeiro_orfaos` grava UMA vez no primeiro tick, e as 2 posições do Maker fecham | evento não aparece, ou aparece em todo tick (aí a varredura não fecha nada) |
| **stop por volatilidade** | extrato do exame traz `stop alargado` para SOL/ETH e **`já está fora dele` para BTC** | BTC também alargar — seria substituição, não piso |
| **efeito do stop** | razão stop/alvo dos agentes de tendência cai de 100% stop | continuar 100% stop com amostra maior |

⚠️ A terceira linha **não tem prazo de horas**. Um agente que fecha 1–3 posições
por dia não produz razão stop/alvo interpretável em uma tarde. Olhar cedo demais
e concluir é o erro que este arquivo existe para impedir.

## 3. A hipótese do Maker, pré-registrada

O Maker fez **19 alvos contra 8 stops** num bracket **simétrico** (±0,6%). Num
passeio sem tendência, alvo-primeiro sai em 50%. Ele fez 70,4%.

Binomial, n=27, p=0,5, unilateral: **p ≈ 0,026**.

**Hipótese:** o Maker não morreu de errar. Morreu de pedágio — num bracket de
±0,6%, os 0,4% de ida-e-volta comem dois terços do movimento bruto. Ele acertava
a direção e entregava o lucro no caixa.

⚠️ **O que enfraquece isso, e eu não vou fingir que não existe:**

1. **27 decisões é pouco.** p=0,026 não sobrevive a correção por múltiplas
   comparações — e eu olhei vários agentes antes de achar este número.
2. **Maker de faixa ganha em mercado lateral.** Pode ser o regime dos últimos
   dias falando, não habilidade do agente.
3. **Eu achei isto depois de o agente morrer.** Achar sinal em quem já morreu é
   exatamente onde o viés mora.

**O teste, declarado agora:** revive o Maker com bracket largo o bastante para o
pedágio virar ruído (±1,5% põe a taxa em 27% do bruto, contra 67% hoje), mesmo
sinal, e **compara contra o Aluguel de Ocioso** — o controle que não tem opinião
sobre preço. Critério: taxa de alvo-primeiro se mantém acima de 50% em **outras
30 decisões**, com o regime anotado.

Se a taxa cair para 50% no bracket largo, a hipótese está morta e o +6,31% era
o mercado, não o agente.

## 4. O que já sei que não vou concluir hoje

- **Se o múltiplo 3 é o certo.** É um ponto de partida ancorado no BTC.
- **Se os agentes de tendência prestam.** 3 fechamentos.
- **Se o Maker merece voltar.** Depende do teste da §3, que ainda não rodou.
