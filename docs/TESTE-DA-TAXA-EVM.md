# TESTE DA TAXA — provar que o dinheiro CHEGA · 🔴 PENDENTE

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

## A troca

**Rede: Base.** Escolhida por três motivos: gás de centavos, suportada pelo 0x
(que é quem cobra a taxa na mesma cadeia), e explorador que mostra
transferências de ERC-20 sem precisar decodificar nada.

**Par: ETH → USDC.**

- **Vender ETH nativo** dispensa a transação de aprovação — é uma assinatura
  só, e menos gás.
- **Comprar USDC** faz a taxa chegar **em USDC**, porque ela é cobrada no token
  de SAÍDA. US$ 0,20 em USDC lê-se como `0.2` no explorador. Se a saída fosse
  WETH você teria que converter `0.00005` a preço de mercado para saber se
  bate.

Passo a passo:

- [ ] Conecte a carteira e selecione a rede **Base**.
- [ ] Venda **~US$ 20 em ETH** por **USDC**.
- [ ] Antes de assinar, anote da tela: **quanto de USDC você vai receber** e
      **qual a taxa em %**.
- [ ] Assine. Anote o **hash da transação**.

---

## A conferência — a parte que é o teste

### C1 — a transferência da taxa existe

Abra `https://basescan.org/tx/<hash>` e role até **"ERC-20 Tokens
Transferred"**. Você deve ver **duas** linhas de USDC:

```
From <pool/settler>  To 0x9041...3c1F   For 0.2      USDC   ← a taxa
From <pool/settler>  To <sua carteira>  For 19.8...  USDC   ← o que sobrou
```

- [ ] **Existe uma linha para `0x904126D219dC6c1f7c019303EC743Ad45F473c1F`.**

🛑 **Se essa linha NÃO existir**, o teste REPROVOU e o achado é grande: a tela
está declarando uma taxa que não é cobrada. Nesse caso não mexa em mais nada e
me mande o hash — o problema está entre o nosso pedido e o 0x, e eu preciso ver
a resposta crua da cotação para saber de que lado.

### C2 — o valor bate com o plano

- [ ] O valor da linha da taxa ÷ (valor da linha da taxa + o que você recebeu)
      ≈ a porcentagem que a tela prometeu no P3.

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

- [ ] Abra `https://basescan.org/address/0x904126D219dC6c1f7c019303EC743Ad45F473c1F`
      → aba **Token Transfers (ERC-20)**. A entrada tem que estar lá.
- [ ] Abra a carteira e confirme que você **enxerga** o USDC na Base. Receber
      num endereço que você não consegue movimentar é o mesmo que não receber.

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
