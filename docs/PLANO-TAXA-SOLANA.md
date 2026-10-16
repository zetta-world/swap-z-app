# PLANO — Taxa da plataforma na Solana (16/10/2026)

Status: 🟢 concluído (16/10): app `0f64e3a` em produção + site institucional `zettaceo/z-swap@5159089` · ⚠️ chave Jupiter prioritária (429 na `lite-api`) · dono: decisão de 16/10 · rodada: L-061

## Decisão do dono (16/10)

- Cobrar a taxa da plataforma também na Solana, **com a mesma escada das EVM**: free 1% · pro 0,50% ·
  trader 0,25% · pilot 0,10% (`TIER_FEE_BPS`).
- Receber **por rede**: carteira Solana do dono `H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T`
  (substitui `EWPta…` de 11/08). Taxa da Jupiter em **USDC** e em **SOL (wSOL)**; consolidação em USDC é
  operação de tesouraria do dono, fora do código.
- Ficar na API atual da Jupiter (Metis `/swap/v1`); migração para Swap V2 = rodada futura separada.
  O dono cria a chave da Jupiter (portal.jup.ag) em paralelo para sair da `lite-api`.

## Revisão dos motivos de 11/08 (`fees.ts`, `MOTIVOS_SOLANA_SEM_TAXA`)

| motivo de 11/08 | 16/10 | prova |
|---|---|---|
| piso de 50 bps | **não vale** para Metis | cotação real `lite-api` com `platformFeeBps` 10/25/50/100 aceita; `platformFee.feeBps` = pedido |
| perde gás patrocinado | **não se aplica** (gasless é da Ultra; o app usa Metis) | docs Jupiter |
| Jupiter retém 20% | **não documentado** para Metis ("zero protocol fees"); conferir no primeiro recebimento | docs Jupiter |
| API sem chave | **continua** — chave da Jupiter pendente do dono | `jupiter.ts` (`lite-api`) |
| (novo) Metis "não mais mantida", substituída por Swap V2 | risco aceito pelo dono; migração separada | docs Jupiter |

## O que muda

1. 🟢 **Contas de taxa** (`fees.ts`): dona `H7zw…`; conta USDC `En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo`
   (conferida na rede: mint USDC, dono `H7zw…`); conta wSOL `7PPDQWck54V79XwgThz9hcPJQTwWbRT8aP4TV9iT5qFW` (conferida na rede 16/10; `off` desliga).
   Escolha por par: USDC se um dos lados é USDC; senão wSOL se um dos lados é SOL; senão **sem taxa**.
2. 🟢 **Trava**: antes de cobrar, a conta é conferida NA REDE (existe, é conta de token do mint certo,
   cache curto). Conta ausente/fechada/RPC falhou → **sem taxa e o swap segue** + alerta. Uma conta de
   taxa nunca pode quebrar um swap.
3. 🟢 **Jupiter**: `platformFeeBps` na cotação (lista e firme — o valor exibido já sai líquido) e
   `feeAccount` no `/swap`, sempre os dois juntos.
4. 🟢 **LI.FI saindo da Solana**: taxa do plano com o integrator cadastrado (a taxa vai para a carteira SVM do
   portal).
5. 🟢 **Divulgação**: taxa divulgada por cotação = a que de fato é pedida; fatos do ZION, painel/rota de
   receita, `ZSWAP-PUBLIC-SOURCE-OF-TRUTH.md`; site institucional (repo separado) em seguida.
   Founders: texto fala em "rotas EVM onde o mecanismo está ativo" — continua verdadeiro, **não tocado**.
6. ⚪ **Fora do escopo**: Swap V2, chave Jupiter (dono), consolidação de tesouraria, A33 (intocado), EVM.

## Gates

Testes de regressão (antes/depois), quebras deliberadas, lint, type-check, suíte ×2, build, audit, CI no SHA,
preview com cotação real (só cotação), produção com cotação real, ledger L-061.
