# TESTE DA TAXA — provar que o dinheiro CHEGA · 🟡 SWAP FEITO, CONFERÊNCIA PENDENTE

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

## 📍 O SWAP DE 11/08 — o que os nossos registros dizem, e o que falta

O dono fez a troca às **03:51:43 UTC (00:51 BRT)**. Não foi na Base: foi na
**BSC**. O que o `platform_events` guardou:

| campo | valor |
|---|---|
| cadeia | **BSC** (chainId 56) |
| vendeu | **BNB nativo** |
| comprou | **USDT** (`0x55d398326f99059ff775485246999027b3197955`) |
| roteador | `0x0000000000001ff3684f28c67538d4d072c22734` (Settler do 0x) |
| quem assinou (`taker`) | `0xa904abe0e31f1c91c45e79c8cd7cb0f62a72ad5e` |
| quem estava logado (sessão) | `0x9f068BDF763388E5DF3aB3265a738A02F6eB48AA` |
| plano resolvido | **free** (`nao_checado`) → **1,00%** |

✅ **O código da taxa estava no ar.** A Fase 9.2 foi a produção às **01:17 UTC**
e o último deploy de produção antes da troca foi **03:26 UTC** — duas horas e
meia de folga. A troca passou por código que pede a taxa.

**Então o que conferir no BscScan** — `https://bscscan.com/tx/<hash>`, seção
**"ERC-20 Tokens Transferred"**: uma linha de **USDT** para
`0x904126D219dC6c1f7c019303EC743Ad45F473c1F`, valendo **1,00% do USDT que
você recebeu** (numa troca de ~US$ 20, cerca de **0,20 USDT**).

🛑 **O que EU não consegui conferir, e por quê.** A política de rede desta
sessão recusa conexão a todo RPC e explorador (`403` no CONNECT para
`mainnet.base.org`, `api.bscscan.com`, `rpc.ankr.com` e os demais testados).
Não dá para contornar isso, e não se deve. **A conferência on-chain é sua.**

⚠️ **E os nossos registros também não bastavam** — este é o achado que a troca
produziu. O evento `swap_intent` gravava rota, cadeia, tokens, roteador e
`spender`, e **não gravava a taxa**. Nem o que pedimos, nem o que o agregador
respondeu. Corrigido em 11/08: o evento passa a gravar `taxaPedidaBps` e
`taxaAceita` — esta última tirada do `integratorFee` que o próprio 0x devolve.
São coisas diferentes de propósito: gravar só o pedido responderia "nós
pedimos", que já estava provado por teste unitário. **Da próxima troca em
diante, "o 0x ignorou o parâmetro" para de ter a mesma aparência de "a taxa foi
cobrada"** sem ninguém precisar abrir explorador.

⚠️ **Achado nº 2, separado e mais sério: o plano vem de quem está LOGADO, não
de quem PAGA.** `tierDoCotante()` resolve o plano a partir da sessão
(`0x9f068BDF…`), enquanto quem assina é a carteira conectada (`0xa904abe0…`), e
não há comparação entre as duas. Nesta troca não muda nada — as duas dão
`free`, 1% — mas o mecanismo está errado nos dois sentidos: uma sessão `pilot`
paga 0,10% em troca assinada por qualquer endereço, e quem assinou e trocou de
carteira no MetaMask sem relogar paga a taxa da carteira antiga. **Não corrigi
junto**: mexer em quem paga quanto é decisão de produto, não limpeza de
observabilidade.

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
