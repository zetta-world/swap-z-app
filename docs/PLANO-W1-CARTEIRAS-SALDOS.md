# PLANO — W1: carteiras, saldos e mobile (20/10/2026)

Status: 🟡 implementado e testado na branch `fix/w1-carteiras-saldos` (base `986ae75`); preview para conferência; **produção NÃO autorizada**

## Incidente (dono, Android + Phantom)

Phantom: ≈0,263 SOL e ≈11,501 USDC. Z-SWAP: endereço certo, mas `Balance: —` no Swap, duas leituras indisponíveis no
Portfólio; reconectar não resolvia; cotações Jupiter OK. No celular, conectando só Solana, não havia como adicionar a EVM.
Sem perda de fundos.

## Causa raiz (comprovada em 20/10)

1. **RPC público recusa navegador.** O bundle de produção resolve `NEXT_PUBLIC_SOLANA_RPC` como indefinida (não existe na
   Vercel) → `clusterApiUrl("mainnet-beta")`. Esse RPC devolve **HTTP 403 "Access forbidden"** a toda requisição com
   cabeçalho `Origin` — que o navegador sempre envia (POST entre domínios). Medido: sem `Origin` → 200; `Origin`
   swap-z-app ou localhost → 403; User-Agent/Referer não importam; CORS preflight 200. Não é 429, timeout nem adaptador.
2. **Erro virava zero.** `errorBalance` tinha `isZero: true` — o defeito só não pintou "0" porque o display era "—".
3. **Botão "+"** (2ª carteira) era `hidden sm:inline-flex`: invisível abaixo de 640 px.

Conferência real (servidor, sem `Origin`): `H7zw…` = 0,25190507 SOL e 11,501 USDC (conta `En1J8…`) — os números da Phantom.

## Solução

- **Leitura no servidor**: `GET /api/solana/saldo?owner&mint` (`lib/solana/saldos.ts`) no RPC do servidor
  (`HELIUS_RPC_URL`, nunca público). Não é proxy: só `getBalance` / `getTokenAccountsByOwner` filtrado por mint (Token e
  Token-2022, soma de todas as contas em inteiro), dono/mint validados, rate limit por IP (120/min) + teto global
  (`SALDO_SOLANA_GLOBAL_MAX`, 6000/min), timeout 5 s, cache 10 s (erro 2 s) + deduplicação. Erro = 502 com o tipo
  (proibido/limite/timeout/conexao/rpc/resposta), nunca "0"; a URL do RPC não aparece em resposta nem log.
- **Estado único** (`useTokenBalance`): TanStack Query com chave (dono, mint) compartilhada por Swap, Portfólio, chip e
  ZION; estados DISCONNECTED/LOADING/READY_ZERO/READY_POSITIVE/STALE/ERROR; resposta de outro dono descartada; retry só
  transitório (≤2); relê ao reconectar, ao voltar ao app (≥15 s) e após swap confirmado; sem polling.
- **UI**: Swap mostra "indisponível · Tentar de novo" e "(desatualizado)"; 25/50/MAX só com saldo lido; cotações não
  dependem do saldo. Portfólio trata erro/desatualizado como indisponível (sem patrimônio artificial, sem snapshot).
- **Carteiras**: "+" visível no celular; menus "Phantom · Solana" / "<carteira> · EVM" + nota dos dois endereços.

## Fora do escopo (protegido)

Jupiter `/build`, taxas, LI.FI, 0x, construção/assinatura/envio/confirmação de transações, Jito, guards, CEX, DCA,
Autopilot, Founder, Admin, banco. Descoberta de todos os tokens = W2.

## ⚠️ W3 — risco encontrado, NÃO resolvido aqui

`ExecuteSwap` envia (`sendRawTransaction`) e confirma (`confirmTransaction`) pela MESMA conexão do navegador no RPC
público → mesmo 403. Swap Solana fora do Jito provavelmente falha no envio hoje (transação assinada não chega à rede;
sem perda de fundos). Prioridade da W3.
