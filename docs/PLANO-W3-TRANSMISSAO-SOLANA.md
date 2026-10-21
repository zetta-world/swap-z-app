# PLANO — W3: transmissão, confirmação e histórico de swaps Solana (21/10/2026)

Status: 🟡 PARCIAL — código `4f002ae` testado e conferido em preview (sem fundos); **falta o teste real com fundos (autorização do
dono)**; bloqueio de release herdado da W1 (audit-gate R-03); produção NÃO autorizada

## Incidente

Dono, no preview W1: Phantom assinou o swap SOL→USDC → Z-SWAP mostrou "403 Access forbidden"; nada no histórico da
Phantom nem da Z-SWAP.

## Causa raiz (comprovada em 21/10)

- `ExecuteSwap` assinava na carteira e enviava com `solConn.sendRawTransaction` — conexão do NAVEGADOR ao RPC público.
- O RPC público recusa com **403 na porta** toda requisição com `Origin`, **antes de ler o corpo**: `sendTransaction`
  com corpo inválido → 403 com `Origin`; sem `Origin` o RPC desserializa e recusa o conteúdo (-32602).
- **Etapa do 403: envio** (depois da assinatura). Jito desligado por padrão (`NEXT_PUBLIC_SOLANA_JITO`) → caminho RPC.
- **Não foi transmitida**: `H7zw…` sem nenhuma transação desde 16/10 (`getSignaturesForAddress`), saldo inalterado.
- O histórico só era gravado DEPOIS do envio → a exceção do 403 não deixou rastro.
- Latente: a confirmação (`confirmTransaction`) também ia ao RPC público → 403 → marcaria "falhou" um swap talvez executado.

## Arquitetura

- `POST /api/solana/transmitir` (servidor, RPC autenticado): recebe só a transação **já assinada pela carteira**;
  valida tamanho ≤ 1232, v0, todas as assinaturas exigidas presentes e válidas (ed25519), pagador = carteira declarada,
  Jupiter v6 presente, só programas permitidos (o desconhecido é recusado e nomeado). Envia UMA vez, preflight ligado.
  Desfecho: `enviada` / `nao_enviada` (porta 401/403/429, preflight, assinatura — certo que não foi à rede) /
  `incerta` (timeout, queda, 5xx, ilegível — pode ter ido). Sempre devolve a assinatura pública.
- `GET /api/solana/status`: `getSignatureStatuses` (com histórico) + `getBlockHeight`: confirmada (só `err` nulo),
  falhou_na_rede, pendente, expirada (altura > lastValidBlockHeight sem registro), desconhecido.
- `lib/solana/executar-swap.ts`: registra a tentativa ANTES da assinatura → carteira assina (única fonte) → assinatura
  pública → envio (Jito opcional, fallback com a MESMA transação) → acompanhamento até desfecho; sem desfecho no prazo
  fica em aberto (não é falha). Anti-duplicação: nova assinatura bloqueada enquanto houver tentativa da mesma carteira
  que ainda pode pousar.
- Histórico: etapas `solicitada · cancelada · assinada · envio_falhou · envio_incerto · pendente · confirmada ·
  falhou_na_rede · expirada`, com carteira e validade; `status` antigo preservado; "Falha no envio" ≠ "Falhou na
  blockchain"; sem link de explorer para o que nunca foi à rede; nunca a transação bruta. Reconciliação ao abrir o app.
  Volume/taxa só com `confirmada`, e só da carteira certa.

## Não-custódia

O servidor não tem chave nem assina: recebe bytes assinados, confere a assinatura e transmite os MESMOS bytes (teste:
byte a byte). Nenhum `Keypair`/`secretKey` nos arquivos do fluxo (teste).

## Fora do escopo / pendências

Escada, taxas, contas de arrecadação, Jupiter `/build`, EVM, LI.FI, CEX, Admin, DCA, Autopilot, banco. Programas que a
Phantom possa inserir ao assinar (asserções): nenhum liberado sem evidência real. Teste real de transmissão de swap
com fundos: exige autorização específica do dono.

## Evidência (21/10)

- 403 reproduzido: `sendTransaction` com `Origin` → 403 antes de ler o corpo; `getSignatureStatuses` com `Origin` → 403.
- Testes: 3 arquivos (transmissão 33, fluxo 25, A19 reescrito 9); no código da W1 os 3 falham; 7 quebras deliberadas
  detectadas (timeout como "não enviou", err ignorado, assinatura não conferida, sem anti-duplicação, falha de envio
  chamada de falha na rede, histórico só depois do envio, desconhecido virando falha).
- Gates no SHA `4f002ae`: lint 0/144 · type-check · suíte 337/4977 ×2 · build · 0 credencial no bundle · **audit-gate
  FALHOU** (follow-redirects, vite — herdado). CI 39523037030: lint/tipos/testes OK, audit falha.
- Preview `swap-z-dklwck7rb` (sem fundos): status real — confirmada (tx de 16/10, finalized), expirada, pendente, 400;
  E2E Chrome com carteira de TESTE sem saldo assinando de verdade: 1 assinatura, 1 transmissão pelo servidor que chegou
  ao RPC sem 403 e foi recusada no preflight (`AccountNotFound`), tela "Falha no envio", histórico com a assinatura
  pública (igual à do servidor) depois de recarregar, navegador sem chamar RPC — 10/10.
- Achado no preview e corrigido: assinatura base58 que não tem 64 bytes chegava ao RPC (agora 400).

## Pendente — exige autorização específica do dono

Swap real de valor mínimo assinado na Phantom (ex.: 0,01 SOL → USDC) para provar, na rede: envio aceito, confirmação com
`err` nulo, etapa `confirmada`, volume/taxa contados uma vez, taxa chegando na conta USDC. Nenhum teste até aqui moveu fundos.
