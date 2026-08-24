# TESTE DA TAXA — provar que o dinheiro CHEGA · 🟡 AGREGADOR OK, FALTA A CADEIA

> **Aberto em:** 11/08/2026 · **Custo:** ~US$ 20 + gás (~US$ 0,02 na Base)
> **Decisão do dono (11/08):** *"o teste de 20 dólares faremos por último"* —
> a Fase 9 foi mergeada antes deste teste, de propósito. Isto aqui é o que
> falta para a cobrança sair de "implementada" e virar **"comprovada"**.

---

## ⚠️ POR QUE ESTE TESTE EXISTE, E POR QUE A TELA NÃO SUBSTITUI ELE

A Fase 9.2 ligou a taxa de integrador nos três agregadores EVM. Há teste
unitário exigindo que `swapFeeBps` + `swapFeeRecipient` + `swapFeeToken` saiam
no pedido, teste exigindo que a LI.FI receba **fração** e não pontos-base, e
teste de checksum no endereço. **Nada disso prova que o dinheiro chega.**

Tudo que está verificado hoje é: *"nós PEDIMOS a taxa corretamente"*. O que
não está verificado é: *"o agregador ATENDEU o pedido e a transferência
aconteceu on-chain"*. São coisas diferentes, e a diferença tem nome — é a
mesma família de defeito que este laboratório achou seis vezes: **duas
situações com a mesma aparência na tela**.

| o que a tela mostra | o que pode estar acontecendo |
|---|---|
| `Taxa da plataforma 1,00%` | ✅ a taxa está sendo retida e enviada |
| `Taxa da plataforma 1,00%` | ❌ o 0x ignorou o parâmetro e ninguém recebeu nada |
| `Taxa da plataforma 1,00%` | ❌ a taxa foi retida e foi para **outro** endereço |
| `Taxa da plataforma 1,00%` | ❌ o usuário pagou e o agregador reteve 100% |

**As quatro pintam a mesma linha na tela.** Só o explorador de blocos separa.

> Invariante nº 14 deste laboratório: *"um controle que ninguém lê não é um
> controle"*. A versão desta pendência: **uma cobrança que ninguém conferiu na
> cadeia não é uma receita — é uma intenção.**

---

## ✅ 11/08 10:42 — O AGREGADOR CONFIRMOU A RETENÇÃO

Swap na BSC, **BNB nativo → USDT**, US$ 9,19, `confirmed`. A resposta do 0x:

```json
"integratorFee": { "type": "volume",
                   "token": "0x55d3…7955",     ← USDT
                   "amount": "92016254981434444" }   ← 0,092016 USDT
"zeroExFee":     { "amount": "13802438247215167" }   ← 0,0138, a fatia do 0x
```

**0,092016 ÷ 9,2016 = 1,0000%** — exatamente a taxa do plano `free`, no
destinatário `0x904126D219dC6c1f7c019303EC743Ad45F473c1F`.

Falta **um** passo, e é o único que não dá para fazer daqui: conferir no
`https://bscscan.com/tx/<hash>` que a transferência de **~0,092 USDT** para
`0x9041…3c1F` está na aba **ERC-20 Tokens Transferred**. A cotação firme diz
que o calldata foi montado com ela; o explorador diz se ela liquidou.

---

## O caminho até aqui — quatro defeitos empilhados, e três hipóteses minhas erradas

| quando | o que impedia | onde estava |
|---|---|---|
| 03:51 | a taxa nunca era pedida na cotação FIRME | `fetchZeroXQuote` não chamava `aplicarTaxa` |
| 04:49 | a troca nem assinava | `assertTrusted` tratava alvo ausente como alvo malformado |
| 05:41 | volume $0 no painel | `ExecuteSwap` nunca passava `valueUsd` ao histórico |
| — | trocas reais contadas como sonda | painel de receita lia `NULL` como `0` |

⚠️ **E EU PERSEGUI TRÊS CAUSAS ERRADAS ANTES DA CERTA** — "o 0x não retém em
token nativo", "é a direção do par", "é a conta do 0x". As três partiam da
mesma premissa falsa: *os parâmetros foram enviados e o 0x recusou*. **Nenhum
parâmetro foi enviado.** Eu estava depurando a resposta de uma pergunta que
nunca foi feita, e cada hipótese custou um swap do dono, de madrugada.

O que quebrou o ciclo não foi pensar melhor — foi **gravar o que mandamos**
(`taxaTokenPedido`) ao lado do que voltou (`taxaRespostaCrua`). Com os dois no
mesmo evento, "não pedimos" parou de ter a mesma cara de "pediram e recusaram".

## Pré-voo — 3 minutos, sem gastar nada

**P1 — O ambiente não está redirecionando a taxa.**
No Vercel → Settings → Environment Variables, procure `SWAP_FEE_RECIPIENT`.

- [ ] **Se NÃO existir:** ✅ certo. O código usa
      `0x904126D219dC6c1f7c019303EC743Ad45F473c1F`, que é o endereço que você
      passou.
- [ ] **Se existir:** anote o valor. É ELE que vai receber, não o do código.
      Se não for o seu, **pare** e me chame.

**P2 — Qual plano a carteira que vai testar tem.** A taxa depende do plano, e
é isso que decide quanto você deve ver chegar:

| plano | taxa | numa troca de US$ 20 |
|---|---|---|
| free (sem assinatura) | 1,00% | **US$ 0,20** |
| pro | 0,50% | US$ 0,10 |
| trader | 0,25% | US$ 0,05 |
| pilot | 0,10% | **US$ 0,02** |

⚠️ **Recomendação: faça com uma carteira SEM plano.** Sua carteira principal
tem acesso a tudo e resolve para `pilot` — US$ 0,02 é uma leitura difícil no
explorador e um arredondamento a mais atrapalha. Com uma carteira limpa são
**US$ 0,20**, dez vezes mais visível, e é o caminho que a maioria dos usuários
vai percorrer.

**P3 — A tela mostra a linha da taxa.** Abra o swap, ponha US$ 20, e confirme
que aparece `Taxa da plataforma` entre o impacto no preço e a taxa de rede.
Anote a porcentagem exata que ela diz.

---

## A conferência — a parte que é o teste

**Para o swap que já aconteceu:** `https://bscscan.com/tx/<hash>`, e o token a
procurar é **USDT**, não USDC.

### C1 — a transferência da taxa existe

Role até **"ERC-20 Tokens Transferred"**. Você deve ver **duas** linhas de USDT:

```
From <pool/settler>  To 0x9041...3c1F   For 0.2      USDT   ← a taxa
From <pool/settler>  To <sua carteira>  For 19.8...  USDT   ← o que sobrou
```

- [ ] **Existe uma linha para `0x904126D219dC6c1f7c019303EC743Ad45F473c1F`.**

🛑 **Se essa linha NÃO existir**, o teste REPROVOU e o achado é grande: a tela
está declarando uma taxa que não é cobrada. Nesse caso não mexa em mais nada e
me mande o hash — o problema está entre o nosso pedido e o 0x, e eu preciso da
resposta crua da cotação para saber de que lado.

### C2 — o valor bate com o plano

- [ ] O valor da linha da taxa ÷ (valor da taxa + o que você recebeu) ≈ **1,00%**
      (foi o plano `free` que resolveu — ver a tabela do swap acima).

Tolerância: alguns centésimos, por arredondamento de decimais. **Ordem de
grandeza errada não é arredondamento** — 10× a mais ou a menos é defeito de
unidade, exatamente o erro que a LI.FI cobraria se recebesse `100` onde espera
`0,01`.

### C3 — o endereço é o certo, caractere por caractere

- [ ] Compare o destinatário com
      `0x904126D219dC6c1f7c019303EC743Ad45F473c1F` **inteiro**, não só o
      começo e o fim. Explorador abrevia o meio, e é no meio que um erro se
      esconde.

### C4 — o saldo aparece na carteira

- [ ] Abra `https://bscscan.com/address/0x904126D219dC6c1f7c019303EC743Ad45F473c1F`
      → aba **Token Transfers (BEP-20)**. A entrada tem que estar lá.
- [ ] Confirme que você **enxerga** o USDT na BSC na carteira. Receber num
      endereço que você não consegue movimentar é o mesmo que não receber.

---

## Se for repetir noutra cadeia

**Base, ETH → USDC** continua sendo o par mais fácil de ler: gás de centavos,
uma assinatura só (vender nativo dispensa aprovação), e a taxa chega em USDC,
que se lê como `0.2` sem converter nada. Numa saída em WETH você teria que
converter `0.00005` a preço de mercado para saber se bate.

E a **LI.FI** (troca ENTRE cadeias) continua sem prova própria: é outro caminho
de código, com a taxa em fração em vez de pontos-base. Base → Arbitrum cobre o
que este swap não cobriu.

---

## ✅ Passou se

- [ ] C1 — a transferência para `0x9041…3c1F` existe na transação
- [ ] C2 — o valor bate com a porcentagem que a tela prometeu
- [ ] C3 — o endereço confere caractere por caractere
- [ ] C4 — o valor aparece na carteira, e ela consegue movimentá-lo

## 🛑 Reprova (e o que cada caso significa)

| sintoma | diagnóstico |
|---|---|
| Nenhuma transferência para o endereço | o parâmetro não está chegando ao 0x, ou o 0x está recusando em silêncio |
| Foi para outro endereço | há `SWAP_FEE_RECIPIENT` no ambiente apontando para outro lugar (ver P1) |
| Valor 10× ou 100× diferente | erro de unidade — bps tratado como fração ou o contrário |
| Valor zero mas a linha existe | truncagem: US$ 0,02 em token de poucas decimais pode virar 0. Refaça com valor maior ou carteira `free` |
| A troca falhou por completo | pode ser cotação com taxa recusada — me mande o erro |

---

## Depois que passar

1. Marcar esta pendência 🟢 aqui, no `PLANO-LABORATORIO-DE-ESTRATEGIAS.md`
   (seção da Fase 9) e no `RUNBOOK.md`.
2. Aí sim o painel **💵 RECEITA DE TAXA** pode ser lido como receita, e não só
   como aritmética sobre volume. Hoje o bloco MEDIDO dele conta operações que
   **antecedem** a cobrança existir — todas de 13 a 18 de junho, quando nenhuma
   taxa era pedida. O primeiro dólar de verdade é este teste.
3. A LI.FI (troca entre cadeias) fica **sem prova própria**. Ela é outro
   caminho de código, com a taxa em fração em vez de bps. Um segundo teste de
   US$ 20 atravessando cadeias — Base → Arbitrum, por exemplo — cobre o que
   este não cobre. Não é o mesmo teste feito de novo.
4. A Solana continua sem taxa **por decisão** (`MOTIVOS_SOLANA_SEM_TAXA` em
   `src/lib/tier/fees.ts`), e portanto não tem o que conferir lá.
