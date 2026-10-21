# PLANO — W3: transmissão, confirmação e histórico de swaps Solana (21/10/2026)

Status: 🟡 PARCIAL — 2ª auditoria (NO-GO) tratada: W3-A e W3-B corrigidos; W3-C e W3-D só desenhados
(`docs/PROPOSTA-W3-TRAVA-E-RECONCILIACAO.md`); audit-gate bloqueado; produção e teste com fundos NÃO autorizados

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

## Revisão independente (21/10) — correções

1. **Status on-chain estrito**: estrutura conferida (`value` com exatamente 1 posição, `slot` inteiro, `confirmationStatus`
   conhecido); `confirmada` só com `err === null` EXPLÍCITO — `err` ausente/undefined → `desconhecido`.
2. **Transporte**: "não transmitida" só com recusa ESTRUTURADA da aplicação marcada `fase: "antes_do_rpc"`; 503/429/504/502
   de gateway ou infraestrutura → `incerta` (a assinatura pública reconcilia antes de qualquer nova operação).
3. **Identidade**: cada registro guarda a carteira de ORIGEM (Solana = pagador; EVM = endereço que assinou). O navegador só
   sincroniza um registro quando essa carteira está conectada; o servidor recusa (409) origem ≠ sessão e grava SEM atribuição
   o que não tem origem (legado, CEX, Autopilot) — nunca na carteira da sessão. **Consequência**: operações CEX/Autopilot
   passam a ficar sem atribuição de carteira (totais intactos) até uma rodada própria gravar a identidade delas.
4. **Vínculo cotação ↔ transação** (`lib/solana/vinculo.ts`): na cotação firme o servidor emite HMAC de {sha256 da mensagem
   que ELE montou, pagador, bps decididos (confirmados na instrução), conta de taxa ou null no fail-open, validade 3 min}; a
   transmissão exige hash idêntico, pagador igual, token válido. Adulterar/remover a taxa — mesmo re-assinando — é recusado
   antes do RPC. Segredo: `TX_VINCULO_SECRET` ou derivado de `AUTH_JWT_SECRET` (separação de domínio); sem segredo, falha
   fechada. Escada: o vínculo carrega os bps do plano (100/50/25/10) ou 0 nos fail-open legítimos — testado.
   **Limite**: se a carteira alterar a mensagem ao assinar, o envio é recusado sem transmitir (já era o efeito da allowlist).
5. **Anti-duplicação é LOCAL ao navegador** (histórico em localStorage): não protege dois aparelhos nem armazenamento
   perdido (testes fixam esse limite). Seguram de verdade: a mesma transação só pousa uma vez; vínculo de 3 min; blockhash
   por cotação. **Proposta (não implementada — exige escrita durável e decisão sobre o banco)**: trava no servidor por
   carteira com validade = `lastValidBlockHeight` da transação em voo, liberada por desfecho on-chain; nunca permanente.
6. **Dependências**: `follow-redirects` (via wagmi→@wagmi/connectors→@base-org/account→@coinbase/cdp-sdk→axios) e `vite`
   — rodada isolada, fora desta.

## Reavaliação de segurança de `/api/solana/transmitir`

Entradas: JSON ≤ 4 KiB (413), transação ≤ 1232 B, v0, todas as assinaturas ed25519 válidas, pagador = carteira, Jupiter v6,
só programas permitidos, **vínculo HMAC válido e não expirado com hash idêntico**. Limites: 20/min por IP, teto global
(`TRANSMISSAO_SOLANA_GLOBAL_MAX`). Saída: estado + assinatura pública; nunca a transação, a URL ou a credencial do RPC.
Não é proxy (método e RPC fixos). Não custodial (sem chave; bytes intactos). Abuso residual: alguém com uma cotação
legítima pode transmitir a PRÓPRIA transação assinada — que é exatamente o uso previsto; não há como transmitir transação de
terceiros (exige assinatura do pagador) nem transação não cotada pela Z-SWAP (exige vínculo).

## 2ª auditoria independente (21/10) — NO-GO tratado

- **W3-A (bloqueador) — tarifa da carteira errada**: reproduzido (sessão de A Pilot + taker B → B pagava 10 bps).
  Corrigido: o plano da sessão só vale quando a sessão É o pagador (`mesmaCarteira`: EVM sem caixa, Solana exato); pagador
  diferente → Free. Vale para Jupiter, 0x e LI.FI (a taxa é calculada uma vez, para o `taker`). Lista sem taker mostra o
  plano da sessão (nada a assinar). Efeito: quem assina o plano numa carteira e opera com outra paga Free nela até
  autenticá-la — não há vínculo entre carteiras (Founder Pass continua por carteira, sem outra mudança). Os demais usos de
  plano (ZION, pools, bancada) são acesso a recurso e seguem pela sessão.
- **W3-B (bloqueador) — Jito contornava o vínculo**: configuração REAL medida nos bundles servidos (sem decriptar nada):
  `NEXT_PUBLIC_SOLANA_JITO` está **"on" em Preview e Production** — o ramo "desligado" foi eliminado na compilação; em
  produção (`986ae75`) swaps com exposição ≥ $25 tentam o block engine direto do navegador. Corrigido no código: o fluxo tem
  UM caminho de envio (servidor, com vínculo); o caminho Jito saiu do `ExecuteSwap`/`executarSwapSolana` e testes travam a
  volta de envio alternativo. Ação do dono recomendada: `NEXT_PUBLIC_SOLANA_JITO=off` na Vercel (não alterado aqui).
- **W3-C**: reproduzido entre dois navegadores; trava durável desenhada (migration proposta, não aplicada).
- **W3-D**: livro aceita conteúdo financeiro declarado; reconciliação por assinatura e classes de verificação propostas.
