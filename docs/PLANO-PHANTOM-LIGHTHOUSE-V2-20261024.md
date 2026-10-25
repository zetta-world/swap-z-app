# PLANO — Phantom/Lighthouse v2: aceitar o formato REAL da Phantom (24/10/2026)

Status: 🟢 EM PRODUÇÃO desde 25/10 17:00 UTC (`main` `10ebd12`, código `cb8b9ac`, `dpl_7KTQpQSh3BWYzrVJsb22TH5n7zdR`) — falta o swap real do dono — plano escrito antes do código. Produção NÃO autorizada nesta etapa.
PHASE_BASE_SHA: `cc79fc7886c2918a3cba2a44960cc67727365bfe` (`main`, PR #449). Branch: `claude/swap-z-recovery-deploy-b7y2cw`.

## Incidente que continua

Swap Solana (USDC→SOL, rota Jupiter "Kipseli") assinado pelo dono na Phantom Android é recusado pelo nosso servidor
ANTES do RPC (nada sai da carteira). Logs de produção (Vercel, `/api/solana/transmitir`):

| deploy | código | recusa |
|---|---|---|
| `dpl_DymqaCpFKv4DbcYnHHsY6H2d8yNe` | `bc6f67a` | `programa_nao_permitido:L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` (16:40:57 e 16:41:19 UTC, 21/10) |
| `dpl_3YkUirQdfetu5cSCoUqZX2kYaAkR` | `cc79fc7` (#449) | `lighthouse_instrucao_nao_permitida` (23:48:06 UTC, 21/10) |

## Causa raiz (evidência)

O #449 aceitou o programa Lighthouse, mas só um subconjunto escolhido SEM captura real (o próprio
`PLANO-PHANTOM-LIGHTHOUSE-20261021.md` registra isso): opcodes 5/6/9/10, **log level 0–2**, exatamente 1 conta,
variantes sem `KnownOwner`/`VerifyDatahash`, só como sufixo, instruções originais byte-idênticas (inclusive ComputeBudget).

Evidência pública do formato real (fontes e linhas no ledger desta fase):
- Instrução Phantom de mainnet decodificada byte a byte (McRitchie-Studio/turf-monster PR #758, tx de 16/09/2026):
  `06 04 02 03 00 00 01 0000000000000000 00` = `AssertAccountInfoMulti`, **log level 4** (FailedPlaintextMessage),
  2 asserções: **KnownOwner** == System, DataLength == 0, sobre o pagador. O parser do #449 recusa por DOIS motivos
  (log level > 2 e variante 3) → exatamente `lighthouse_instrucao_nao_permitida`.
- Prefixos `06 04` e `06 05` relatados em Phantom/Seeker (MWA); `AssertTokenAccountMulti` (10) nas contas de token.
- Posição: sufixo quando a dapp já tem ComputeBudget (nosso caso: SetComputeUnitLimit + SetComputeUnitPrice sempre);
  relatos de inserção ANTES das instruções da dapp em outros formatos. Doc oficial da Phantom: priority fee só é
  acrescentada se NÃO houver ComputeBudget; aumento do limite existente é relatado só como "pode" (não verificado).
- Especificação do programa: Jac0xb/lighthouse @ `4c579479c98635e419b1b167f08be02a71604a71` (idêntico à tag v2.0.0),
  borsh 0.10.3 (tag de enum = índice da declaração; LogLevel no fio = 0..6), LEB128 nos vetores `*Multi`.

## O que muda (escopo fechado)

1. `src/lib/solana/lighthouse.ts` — decodificador COMPLETO das asserções somente-leitura do upstream:
   opcodes 2–15 e 17; LogLevel 0..6 (3/6 só emitem CPI para o SPL Noop, programa inerte); LEB128 com limites;
   Option/bool estritos; operadores nos intervalos do upstream; contas mínimas por opcode (Delta 2, Clock 0, demais 1),
   contas extras permitidas. **Continuam recusados:** MemoryWrite (0) e MemoryClose (1) (escrevem estado / CPI no
   System), AssertMerkleTreeAccount (16, CPI sempre), opcode desconhecido, bytes sobrando ou truncados.
2. `extensaoLighthouse` (vínculo cotação↔transação) — mantém tudo que importa e afrouxa só o que é inofensivo:
   - **mantém:** HMAC + hash da mensagem ORIGINAL; pagador; blockhash; assinantes (só o pagador); privilégios de toda
     conta original; tabelas ALT originais com os mesmos índices graváveis; TODAS as instruções originais idênticas
     (programa, contas resolvidas, bytes) e na MESMA ordem; preço do compute inalterado; limite de 64 contas.
   - **aceita:** asserções Lighthouse válidas em QUALQUER posição (subsequência ordenada das originais);
     até 8 asserções; contas novas só se somente-leitura, não assinantes e usadas APENAS por asserções (estáticas ou
     índices só-leitura novos em ALT existente); `SetComputeUnitLimit` original com valor MAIOR, até 1.400.000.
3. Diagnóstico estruturado em toda recusa (instrução, opcode, log level, contas, regra que falhou), sem bytes assinados
   nem token nos logs; o motivo devolvido ao cliente continua curto (`erro` estável) e ganha `detalhe` (só nome de regra e
   inteiros). O cliente (`transmissao-cliente.ts`) anexa o `detalhe` ao motivo mostrado — o print da tela já diagnostica.
   Log da recusa estrutural: `formaDaMensagem` (prefixo de 4 letras do programa, nº de contas, tamanho dos dados,
   opcode/log do Lighthouse, cabeçalho e contagens da ALT) — nenhuma chave de conta, blockhash, byte assinado ou token.
4. Testes: vetor REAL da Phantom (turf-monster), vetores por opcode a partir do upstream, matriz adversarial
   (taxa/rota/valor/destino/privilégios/assinante/ALT/blockhash/preço do compute/MemoryWrite/Merkle/programa novo).

Fora de escopo: W3-D, migrations, UI além dos dois pontos abaixo.

### Correções da auditoria (24/10) — escopo ampliado, só o que a auditoria provou necessário

Auditoria adversarial independente (`wf_b5b701a5-7cb`: lentes segurança, especificação, compatibilidade, integração;
2 céticos por achado). Especificação: 0 divergências (101.418 casos válidos, 6.349.731 mutações de byte, ida e volta
pelo `lighthouse-sdk@2.1.0`). Segurança: 120.000 mensagens mutadas e assinadas, 0 violações. Compatibilidade: nenhuma
forma documentada da Phantom recusada na resposta REAL do `/build` com ALT. 5 achados, todos baixos, sobreviveram:

5. **Uma cotação, um swap** (`em-voo.ts`, rota): com a Phantom, reassinar a MESMA cotação gera outra transação (outras
   asserções, mesmo blockhash); a trava W3-C é por assinatura e deixava a 2ª pousar depois que a 1ª confirmava. Caminho
   real: duplo toque em "Assinar e enviar" (dois pedidos de assinatura). Agora: outra assinatura da mesma cotação
   (`hash_mensagem`) em aberto ou `confirmada` → 409 `cotacao_ja_enviada`, antes do RPC; consulta falhou → 503 (falha
   fechada). Só ACRESCENTA recusa. Não atômico com a 0077 (registrado no código); a versão atômica é migration — fase
   própria, com autorização.
6. **Duplo toque na tela** (`ExecuteSwap.tsx`): uma execução por vez (`executandoRef`, porta `executarUmaVez`).
7. **Cotação Jupiter velha** (`ExecuteSwap.tsx`, i18n 4 locales): mais de 30 s → busca cotação firme nova e o usuário
   confirma de novo (nunca envia sem ver). Evita blockhash vencido — e a troca de blockhash que a Phantom faria nele.
8. **Folga para a carteira no montador** (`jupiter.ts`): cabe na rede mas sem espaço para o que a Phantom acrescenta
   (+1 conta, ~220 B) → UMA rota menor (`maxAccounts=40`); se nem ela tiver folga, fica a que cabe (nunca erro novo).
9. **Testes que faltavam**: `original_faltando`, `chave_duplicada`, `alt_leitura_sumiu`, `contas_demais` (mutantes
   mortos), segredos ausentes nos três logs da rota, `forma`/`detalhe` nulos antes da assinatura conferida; detalhe
   (inteiro) nas recusas de tamanho (`b64:n`, `bytes:n`).

### Segunda rodada (25/10) — auditoria das correções (`wf_75fe6f03-adb`)

4 lentes (trava por cotação, tela, montador, crítico de completude) com reprodução; parte dos céticos caiu por limite
de sessão — os achados restantes foram avaliados pela evidência anexada. 11 achados baixos/informativos, nenhum que
deixe passar transação maliciosa. Corrigidos:

10. Recusa `cotacao_ja_enviada` tem texto próprio nos 4 idiomas (`solQuoteAlreadySent`) — nunca "nada saiu da carteira".
11. Erro visto só em `processed` (ou sem status) volta a ser `pendente`; só `confirmed`/`finalized` encerra como
    `falhou_na_rede` (`consultarStatus`) — "falhou" libera nova tentativa da mesma cotação, então tem de ser final.
12. Consulta da cotação com o critério no SQL (`or(estado.neq.resolvida,desfecho.eq.confirmada)`, `limit(1)`), sem
    janela arbitrária de linhas.
13. Tela: Esc / clique fora / X não fecham o modal durante a execução; a nota "cotação atualizada" só aparece quando a
    nova chega, e os valores velhos saem da tela enquanto isso.
14. Montador: a rota menor só substitui a primeira com a MESMA taxa da plataforma; entre duas sem folga completa vale a
    que comporta o mínimo da carteira (+1 conta, ~56 B); a 2ª chamada tem prazo de 2,5 s e não simula antes de servir;
    log `tx-sem-folga-resultado` (só inteiros) diz qual foi escolhida e por quê.
15. Testes: segredos ausentes também no log do 409; asserções estáticas da tela reforçadas (chave e dependências da
    renovação, `return` antes de assinar, os dois botões pela porta única); mutantes de taxa, mínimo e prazo mortos.

Não corrigido (registrado): teste de tela em DOM exige dependência nova (happy-dom/jsdom) — decisão do dono; o
comportamento da Phantom com dois pedidos de assinatura simultâneos não foi verificado (a tela agora não os gera).

### RECERT(C1 `17f7eb3`) = FAIL → C1b com dependências (decisão do dono, 25/10)

A recert de C1 passou em tudo que é funcional e reprovou no portão `npm audit` por alertas NOVOS contra dependências
que esta fase não tocou (ledger, entrada de 25/10). O dono escolheu "corrigir dependências antes" do deploy. Escopo do
C1b (sobre `6258d7a`):

16. `next` 16.3.8 → **16.4.3** (exato, como hoje), `eslint-config-next` e `@next/bundle-analyzer` → `^16.4.3`
    (mesma linha). Corrige GHSA-2464-fhr4-w9xw e GHSA-673q-mjm6-r5xr (críticos) e GHSA-p3m5-59mp-jv5r (alto). Nada de
    `npm audit fix` em massa: só esses três, e o lock medido depois.
17. O que restar no `npm audit` (esperado: `zod` <4.6.6, transitivo, sem correção fora de major; e a cadeia da R-03
    mudada) NÃO é decidido aqui: a exceção do portão é decisão do dono (`audit-exceptions.json`, R-03). Proponho o
    texto exato da revisão e só aplico com o "sim" dele.
18. Recert COMPLETA no SHA do C1b (inclui build, a suíte ×2 e o portão), C2 só de docs, e então o pedido de deploy.

### Primeiro swap real em produção (25/10, 11:29 UTC) → `BlockhashNotFound` → C1c

O dono assinou na Phantom; o servidor ACEITOU a transação (sem asserções desta vez: a Phantom marcou o domínio como
suspeito e o dono seguiu "não seguro") e a simulação do nó recusou com `BlockhashNotFound`, ~40 s depois da cotação.
Medido em produção (só leitura): cotação firme 11:32:50 → `lastValidBlockHeight` 439 270 561; altura confirmada às
11:33:18 → 439 270 548 (13 blocos ≈ 5 s de vida). **O blockhash do `/build` da Jupiter vem de cache (`fetchedAt`) e já
chega com ~metade da validade gasta (~35 s restantes).** Somado às telas da Phantom, vence.

19. `montarTransacaoJupiter`: blockhash NOVO do RPC do próprio servidor (`getLatestBlockhash`, `confirmed` — o mesmo nó
    e o mesmo compromisso do preflight do envio) e o `lastValidBlockHeight` dele (vai para o vínculo HMAC e a trava
    W3-C). RPC falhou ou resposta inválida → usa o da Jupiter, com log (não move dinheiro: no pior caso a tx expira,
    como hoje). Prazo curto (2,5 s).
20. Tela: `JUP_QUOTE_TTL_MS` 30 s → 20 s (sobram ~35–40 s para as telas da carteira, descontada a latência do
    servidor); texto da nota nos 4 idiomas. O blockhash é buscado DEPOIS da simulação (começa a envelhecer o mais
    tarde possível). Auditoria `wf_9c40c45c-d44`: lente dinheiro sem defeito; integração — 3 achados leves
    corrigidos (RUNBOOK, teste de rota no caminho padrão, comentários).

Fora do código: a Phantom bloqueia `swap-z-app.vercel.app` ("Esta dApp pode ser maliciosa" — não está na lista pública
`phantom/blocklist`, é o scanner interno). Caminho indicado pela própria Phantom: o time do dApp escreve para
review@phantom.com; domínio próprio é decisão do dono.

## Riscos e limites declarados

- Captura pré/pós-assinatura da tentativa real do dono NÃO existe (as recusas não guardam bytes). A compatibilidade é
  com o formato documentado/observado publicamente; o diagnóstico novo existe para que qualquer resto apareça no
  primeiro log.
- Se a Phantom trocar o blockhash, continua recusado: aceitar mudaria a validade usada pela trava W3-C (a reserva usa o
  `lastValidBlockHeight` do HMAC; uma tx com blockhash mais novo poderia pousar depois de a trava a dar por expirada →
  risco de swap duplicado). Evidência pública CONFLITANTE: koynlabs/labs-mcp@2e041dc (`wallet-message.ts:28-29`) relata
  refresh em tx não assinada; New1Direction/repo.ing@8cf9e04 (Phantom mobile, produção) e PoolParty exigem o MESMO
  blockhash e funcionam. Se acontecer, a recusa diz `vinculo_mensagem_diferente:blockhash` (tela e log) e a próxima fase
  é estender a W3-C (validade calculada no servidor), não afrouxar aqui.
- Elevar o `SetComputeUnitLimit` aumenta o teto da priority fee (preço × limite). O preço não muda (comparado byte a
  byte) e o montador o limita a 1.000.000 µlamports/CU → teto absoluto 1,4 M CU × 1 lamport = 0,0014 SOL, visível na
  carteira antes de assinar.
- Folga de bytes: o montador agora prefere uma rota com folga (item 8), mas aceita a que só cabe na rede quando
  não há outra; se a Phantom acrescentar mais do que a folga, a recusa diz `formato:bytes:n` / `tamanho:b64:n`.
- "Uma cotação, um swap" não é atômico com a função 0077 (janela de duas idas ao banco, conferida de novo no ramo
  `bloqueada`); a garantia atômica é uma migration nova — fase própria, com autorização do dono.
- O "somente leitura" vale para o código v2.0.0 do Lighthouse; que o bytecode de mainnet seja esse (e quem tem a
  autoridade de upgrade) não foi verificado — é a mesma confiança que a própria Phantom exige.

## Ciclo (AI-OPERATING-RULES §5)

plano → implementação → auditoria adversarial → correções → validação pré-commit → C1 → recert completa no SHA de C1
(evidência fora do repo + MANIFEST) → C2 só de docs → `RELEASE_CANDIDATE` + autorização explícita do dono para deploy.
