# PLANO — W1: carteiras, saldos e mobile (20/10/2026)

Status: 🟡 PARCIAL — código pronto (`70ba76a`), preview conferido; **bloqueio de release: audit-gate R-03** (alertas novos de `follow-redirects` e `vite`, fora da W1); QA em Android/Phantom real pendente do dono; produção NÃO autorizada

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

## Evidência (20/10)

- Antes: os 3 arquivos de teste novos falham no código de produção (2 nem carregam; 7/10 no de carteiras).
- 7 quebras deliberadas detectadas (erro→zero, dono não conferido, retry em tudo, "+" escondido, servidor devolvendo 0,
  chave sem dono, lamports via número do JSON).
- Preview `swap-z-o4xy0g5z2` (`70ba76a`): 7/7 saldos iguais à rede (H7zw SOL/USDC; 9WzD SOL > 2^53, JUP, USDC em 14
  contas; carteira vazia SOL/USDC = 0 real); validação 400; Jupiter firme 100 bps OK; 0 credencial no bundle.
- QA headless (Chrome, 360 px Android e 1440 px, Phantom SIMULADA só-conexão, nada assinado): saldos no Swap, "+" visível,
  MAX só com saldo lido, falha → "indisponível · Tentar de novo" sem zero, troca de conta sem saldo anterior, recuperação,
  Portfólio com 2 ativos, navegador só chama `/api/solana/saldo`.
- Achado no preview e corrigido: lamports acima de 2^53 perdiam precisão no `JSON.parse` (falhava fechado com 502).

## Roteiro manual do dono (Android + Phantom) — o que não pude reproduzir

1. Abrir o link do preview **dentro do navegador da Phantom** (Android) e conectar a Phantom (Solana).
2. Swap: SOL→USDC deve mostrar `Balance:` igual ao da Phantom (SOL e USDC), e 25%/50%/MAX aparecem.
3. O botão **+** ao lado do chip deve aparecer; tocar → conectar a Phantom como **EVM** → dois chips: "Phantom · Solana"
   (endereço base58) e "Phantom · EVM" (0x…), cada menu com a nota dos dois endereços.
4. Desconectar só a EVM → o chip Solana e os saldos Solana continuam.
5. Trocar de conta na Phantom → os saldos mudam para a nova conta (nunca mostram os da anterior).
6. Portfólio: SOL e USDC com os mesmos valores, sem "leituras indisponíveis".
7. Sair do app e voltar após 20 s → os saldos se atualizam sozinhos (sem recarregar a página).
8. **Não executar swap** nesta conferência (envio Solana ainda passa pelo RPC público — W3).
