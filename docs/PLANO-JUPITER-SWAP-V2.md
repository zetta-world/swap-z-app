# PLANO — Jupiter Swap V2, caminho Router `/build` (L-062B, 16/10/2026)

Status: 🔴 produção revertida (16/10, transação acima de 64 contas); correção 7 em recertificação na branch `feat/jupiter-swap-v2` · rodada: L-062B

## Decisão do dono (16/10)

Entre os dois caminhos da Swap API V2 (`https://api.jup.ag/swap/v2`), o dono escolheu o **Router `/build`**:

| | Router `/build` (escolhido) | Meta-Aggregator `/order` + `/execute` |
|---|---|---|
| Taxa Z-SWAP | `platformFeeBps` + `feeAccount` (igual à v1): escada 100/50/25/10 intacta | referral: mínimo 50 bps (trader/pilot não cabem) |
| Parte da Jupiter | nenhuma ("Jupiter does not charge swap fees on `/build`") | 20% da taxa do integrador + taxa própria 0–10 bps (50 em token novo) |
| Contas de taxa | as mesmas USDC/wSOL ("any SPL token account you control") | referral + uma conta por mint |
| Preço | igual ao de hoje (Metis) | melhor em pares grandes (RFQ) |
| Transação | **montada por nós** (instruções + ALTs + blockhash) | pronta, landing via `/execute` |

Motivo: preserva a receita e a escada; o custo é código (montar a transação), não dinheiro.

## Fatos medidos (16/10, `api.jup.ag/swap/v2/build`, sem chave, só cotação)

- `taker` é **obrigatório** (sem ele: 400 ZodError).
- Resposta: `inAmount`, `outAmount` (já **líquido** da taxa), `otherAmountThreshold`, `priceImpactPct`, `routePlan`
  (`percent` e `bps`), `computeBudgetInstructions` (só o preço de CU), `setupInstructions`, `swapInstruction`,
  `cleanupInstruction`, `otherInstructions`, `tipInstruction`, `addressesByLookupTableAddress`,
  `blockhashWithMetadata {blockhash: 32 bytes, lastValidBlockHeight}`, `transactionVersion: 0`.
- **Não existe `platformFee` na resposta.** Com taxa, o `feeAccount` aparece nas contas da `swapInstruction`
  (sem taxa, não aparece) — é essa a prova de que a taxa entrou.
- Programas: Jupiter v6 `JUP6…`, Token, ATA, System, ComputeBudget — todos já na allowlist do guard Solana.
- A docs da Jupiter: a `lite-api` está sendo desligada; sem chave = `api.jup.ag` a 0,5 req/s.

## O que muda

1. 🟢 `lib/api/jupiter.ts`: base `https://api.jup.ag/swap/v2`; sem chave = mesmo host sem header (a `lite-api`
   sai). Uma chamada `/build` por cotação (antes: `/quote` + `/swap` no firme → metade das chamadas à Jupiter).
2. 🟢 Montagem no servidor (`@solana/web3.js`, já dependência): v0 com as ALTs da resposta, blockhash da resposta,
   pagador = `taker`, limite de CU por simulação (`simulateTransaction` sem assinatura) × 1,2 (teto 1,4 M; simulação
   falhou → teto, com log); preço de CU da Jupiter com teto. Programas invocados nunca vão para ALT (web3.js) → o
   guard do navegador continua lendo tudo.
3. 🟢 Contrato com o navegador **inalterado**: `result.quote` (formato v1) + `result.swap {swapTransaction,
   lastValidBlockHeight}` → `ExecuteSwap` e o guard não mudam.
4. 🟢 Taxa: confirmada pela presença do `feeAccount` na `swapInstruction`; ausente → "TAXA NÃO RETIDA" + taxa
   divulgada 0. Escada, contas, conferência na rede e fail-open: intocados.
5. 🟢 Lista sem carteira: `taker` = carteira de taxa da plataforma, **só para cotar** (nada é assinado nem devolvido;
   a lista continua sem payload executável — A33).
6. 🟢 Sonda de saúde e sonda do guard (admin) no `/build`.

## Prova real (16/10, sem chave, nada assinado)

`/build` real → transação montada por este código → `simulateTransaction` na mainnet, taker = carteira de taxa `H7zw…`:
SOL→USDC com 10 bps na conta USDC e SOL→JUP com 25 bps na conta wSOL — simulação **sem erro** (76.075 e 117.498 CU;
limites 91.536 e 139.901), guard aprova, conta de taxa na instrução. A escada abaixo de 50 bps funciona no `/build`.

## ⚠️ Incidente de produção (16/10) e correção

Smoke de produção de `a675ddb`: JUP→WIF numa rota de 5 trechos virou transação de **65 contas** (limite da rede 64)
→ simulação `TooManyAccountLocks`. Na v1 a Jupiter montava a transação e respeitava o limite; no `/build` é nosso.
Impacto: só rotas longas, recusadas no preflight da carteira (sem perda de fundos). **Rollback** autorizado pelo dono
para `dpl_AcHcoSLXYEeWB1qvMQE9NXqpimrn` (`2a06326`, v1 autenticada) minutos depois.

7. 🟢 Correção: antes de devolver, a transação é medida (contas estáticas + via ALT ≤ 64; ≤ 1232 bytes). Não coube →
   refaz UMA vez com `maxAccounts=40` (taxa preservada); ainda não coube → erro (502), nunca transação inválida. Prova
   real: 5 rotas (até 5 trechos) entre 40 e 55 contas, 918–1210 bytes, simulação sem erro.

## Fora do escopo

Meta-Aggregator, gasless, `/submit`, transação v1 (carteiras), tiers, contas de taxa, LI.FI, EVM, CEX, DCA,
Autopilot, Founder. Produção só com autorização explícita do dono.
