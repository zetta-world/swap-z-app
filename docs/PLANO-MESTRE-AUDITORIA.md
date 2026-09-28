# PLANO MESTRE — AUDITORIA COMPLETA Z-SWAP

> **Documento autoritativo de escopo da auditoria.**
>
> Este arquivo preserva o plano mestre original e adiciona, em bloco separado,
> o estado reconciliado do trabalho já executado. A numeração **FASE 0→33**
> abaixo pertence à auditoria mestre e **não deve ser confundida** com a trilha
> paralela de Release/DB (Release Phase 1/2/3/3B).
>
> **Branch deste documento:** `platform-closure`  
> **Data da reconciliação:** 27/09/2026  
> **Produção:** não atualizada com o código/migrations certificados.  
> **Modos reais:** DCA / Pilot / Autopilot = **NO-GO** até gates finais.

## 0A. Estado reconciliado do plano mestre

Legenda:

- **COBERTA / MUITO AVANÇADA**: evidência forte já existe, mas isso não implica deploy em produção.
- **PARCIAL / AVANÇADA**: parte importante foi testada/corrigida; matriz completa ainda não fechou.
- **ABERTA / BLOQUEADA**: faltam provas essenciais.
- Nenhuma fase recebe equivalência automática a **PROVED em produção** sem deploy/reteste externo correspondente.

| Fase | Estado reconciliado | Observação curta |
|---|---|---|
| 0 — Congelamento da fonte de verdade | COBERTA | SHAs, produção, migrations, CI, staging/P2 e fingerprints registrados; refazer freeze imediatamente antes do release real. |
| 1 — Mapa completo do dinheiro | PARCIAL | CEX/DCA/Autopilot bem mapeados; Bridge/CoW/Solana e mapa canônico completo ainda pendem. |
| 2 — Autenticação e identidade | AVANÇADA | Nonce/bindings/conexão histórica avançaram; matriz hostil completa ainda não fechada. |
| 3 — Admin e control plane | PARCIAL | Gates/pauses/tiers auditados em parte; falta fechamento formal de todas as fontes de autoridade. |
| 4 — Cofre de credenciais CEX | MUITO AVANÇADA | A127/0063: conexão versionada, identidade histórica e fail-closed; runtime final ainda precisa prova implantada. |
| 5 — Execution intent / exactly-once | MUITO AVANÇADA EM CÓDIGO/DB | Intent/state machine/reconcile/UNKNOWN/dedupe avançaram; produção ainda não roda o stack certificado. |
| 6 — Rails de risco | MUITO AVANÇADA | Exposure, caps, loss-stop, pause, locks e 0066 tiveram provas fortes; autoridade final deve ser confirmada no runtime do release. |
| 7 — Autopilot CEX | AVANÇADA / REAL NO-GO | Browser/background/recovery melhoraram; cross-channel e runtime implantado ainda faltam. |
| 8 — DCA | MUITO AVANÇADA EM CÓDIGO/DB / REAL NO-GO | Reserva/accounting/races e A58 tratados; falta deploy + canário. |
| 9 — CEX manual | PARCIAL | Infra existe; reconciliação persistente após reload/restart precisa certificação atual. |
| 10 — Partial/cancel/exchange disagreement | AVANÇADA | Ingest/recalc/dedupe cobrem parte importante; falta matriz completa contra verdade externa. |
| 11 — DEX 0x | PARCIAL | Há swaps reais históricos e fee EVM comprovada; matriz quote→receipt→actual output ainda não fechou. |
| 12 — Solana/Jupiter | PARCIAL | `value.err` e confirmação receberam correções; auditoria semântica profunda ainda aberta. |
| 13 — LI.FI/Bridge | ABERTA IMPORTANTE | Lifecycle destination/refund/unknown e integrator fee on-chain ainda não provados integralmente. |
| 14 — CoW | PARCIAL | Locale/caminhos melhorados; recovery, UID, solver fill e settlement integral ainda pendem. |
| 15 — Action Cards / ZION | PARCIAL | Cards live; schemas executáveis discriminados precisam fechamento completo. |
| 16 — Prompt injection / LLM boundary | PARCIAL | Princípio “IA interpreta; regras objetivas decidem” adotado; bateria hostil completa não fechada. |
| 17 — Ledger / operations | PARCIAL | Intents/fills/operations avançaram; separação definitiva telemetry × livro financeiro ainda precisa fechamento. |
| 18 — P&L e cost basis | AVANÇADA NO CEX | 0064/0066 e liquidação/projeção avançaram; cross-venue/bridge/depósitos/saques ainda pendem. |
| 19 — Taxas da plataforma | PARCIAL | Fee EVM provada; 0059 melhora CEX; Solana fee desativada; LI.FI ainda sem prova suficiente. |
| 20 — Supabase | FORTEMENTE COBERTA | RLS/ACL/RPC/migrations/locks/grants e 0067 foram amplamente testados; revisão de usos da app continua. |
| 21 — Concorrência e locks | MUITO AVANÇADA | T04/T05/T06 PASS; T13 original = FAIL/INCONCLUSIVE por timing; invariante A58 = PASS por prova sincronizada. |
| 22 — Rate limit | PARCIAL | Durable limiter existe; falta classificação formal completa fail-closed × degradável. |
| 23 — Vercel | BLOQUEADA / INCOMPLETA | Deploy oficial indisponível no momento; runtime/região/env/conectividade finais não certificados. |
| 24 — GitHub / CI / supply chain | PARCIAL | CI forte; governance e vulnerabilidades de dependências ainda abertas. |
| 25 — Observabilidade / forensics | PARCIAL | Logs/ledgers existem; failure injection e semântica audit/financial ainda não fechadas integralmente. |
| 26 — Chaos tests | PARCIAL | DB/concorrência/recovery/restore tiveram provas; matriz exchange/chain/RPC/browser ainda incompleta. |
| 27 — Remediação | FORTE / EM EXECUÇÃO | Rounds 8/9 + Platform Closure Batches seguem o fluxo finding→correção→teste→SHA. |
| 28 — Reteste independente | FORTE | Retestes de código/DB foram extensos; Vercel e produção ainda faltam. |
| 29 — Canários com dinheiro real | NÃO EXECUTADA NO RELEASE NOVO | Operações históricas não substituem canário pós-correção. |
| 30 — Reconciliação independente | PARCIAL | Algumas operações/fees foram verificadas externamente; novos canários ainda faltam. |
| 31 — Certificação por módulo | NÃO FINAL | GO/GO COM RESTRIÇÕES/NO-GO final ainda não emitido para todos os módulos. |
| 32 — Critérios mínimos para Pilot | NO-GO | Muitos pré-requisitos existem, mas faltam deploy, chaos completo, canários e reconciliação. |
| 33 — PDF final | NÃO INICIADO COMO CERTIFICAÇÃO FINAL | Só produzir depois dos gates restantes. |

## 0B. Trilha paralela de Release/DB — não confundir com as fases acima

Esta trilha foi criada para provar release, migrations, restore e rollback. Ela
não renumera o plano mestre.

Estado reconciliado em 27/09/2026:

- Release Phase 1: **PASS**.
- Release Phase 2: **PASS WITH DELTA 0059→0067**.
- Release Phase 3/3B: **CLOSED / PASS** para o escopo de banco da aplicação.
- Prova hospedada concluída:
  - backup real;
  - restore real;
  - wipe;
  - rebuild 0001→0058;
  - baseline/B0;
  - forward 0059→0067;
  - rollback B0/0058 com history;
  - segundo forward 0059→0067;
  - history/fingerprints/ACL-RLS/checks.
- Conclusão correta do escopo:
  **APPLICATION DATABASE RELEASE ROLLBACK/REBUILD PROVED**.
- Isso cobre `public + supabase_migrations`; **não** equivale a DR completo da
  plataforma Supabase.
- Produção continua sem o código/migrations certificados.
- DCA real, Pilot real e Autopilot real continuam **NO-GO**.

## 0C. Próximo experimento operacional: RELEASE REHEARSAL — PROD-CLONE LAB

O clone local **não é uma nova “FASE 4”**. A FASE 4 do plano mestre já é
“COFRE DE CREDENCIAIS CEX”.

O laboratório deve servir às Fases 23, 26, 28 e ao preparo das Fases 29–31:

1. congelar novamente o estado atual de produção;
2. clonar o SHA realmente implantado em uma branch isolada, sem tocar `main`;
3. obter cópia read-only do banco da aplicação e restaurar em ambiente local;
4. executar app + banco em Docker/ambiente isolado;
5. bloquear credenciais e side effects reais;
6. provar que o clone reproduz o estado/skew atual antes de qualquer correção;
7. ensaiar o upgrade certificado;
8. rodar smoke, chaos e rollback;
9. produzir um release runbook reproduzível para o cutover oficial.

**Regra:** o PROD-CLONE LAB nunca é tratado como produção e nunca recebe
segredos reais de exchange, chaves de saque, service-role de produção para
runtime da aplicação ou qualquer modo real habilitado.

---


## 1. Objetivo da auditoria

A pergunta central é:

> **A Z-SWAP consegue movimentar dinheiro real de forma segura, determinística, auditável e recuperável mesmo quando banco, rede, browser, exchange, blockchain ou infraestrutura falham no pior momento possível?**

A auditoria não termina quando o código “parece certo”. Ela termina quando conseguimos provar:

**intenção → autorização → reserva de risco → execução → settlement → taxas → posição → P&L → ledger → reconciliação externa**

E, principalmente:

> **1 intenção financeira deve resultar em no máximo 1 execução real, com estado final reconstruível depois de qualquer falha.**

---

# FASE 0 — CONGELAMENTO DA FONTE DE VERDADE

Antes de auditar qualquer versão:

- registrar SHA exato do `main`;
- registrar deployment de produção correspondente;
- registrar migrations aplicadas no Supabase;
- registrar versão Node/Vercel;
- registrar configuração de CI;
- registrar estado dos gates administrativos;
- registrar contagem de sessões, posições, DCA, conexões e operações reais.

Nenhum achado será considerado certificado se o alvo mudar silenciosamente durante o reteste.

### Evidência exigida
- Git SHA;
- deployment ID;
- estado Vercel;
- migrations;
- queries Supabase;
- timestamp da coleta.

---

# FASE 1 — MAPA COMPLETO DO DINHEIRO

Mapear todos os caminhos capazes de movimentar ou autorizar capital.

## DEX
- 0x;
- Jupiter;
- LI.FI;
- CoW;
- approvals ERC-20;
- allowance;
- Solana instructions;
- bridge source/destination.

## CEX
- ordem manual;
- market;
- limit;
- cancel;
- open orders;
- order status;
- balance;
- Autopilot browser;
- Autopilot background;
- DCA;
- arbitragem cross-CEX;
- triangular;
- rebalance/withdraw quando existir.

## Pré-autorização
- CoW signed orders;
- allowance permanente;
- credenciais CEX;
- sessões;
- pilots;
- tier entitlement.

Para cada caminho, identificar:

**quem inicia → quem autoriza → onde a decisão acontece → qual API recebe → onde o estado é persistido → quem confirma settlement → quem contabiliza.**

---

# FASE 2 — AUTENTICAÇÃO E IDENTIDADE

Auditar integralmente:

- wallet login;
- nonce;
- replay;
- atomicidade do nonce;
- JWT;
- cookie;
- TTL;
- logout;
- revogação;
- troca de wallet;
- session fixation;
- sessão antiga depois de alteração de permissão;
- binding wallet ↔ tier;
- binding wallet ↔ exchange;
- binding wallet ↔ DCA;
- binding wallet ↔ connection ID.

### Testes hostis
- reutilizar nonce;
- duas requests concorrentes;
- token antigo;
- wallet A autenticada tentando operar recursos de B;
- trocar wallet sem reload;
- cookies antigos;
- sessão de 30 dias depois de revoke.

---

# FASE 3 — ADMIN E CONTROL PLANE

Auditar quem pode mudar regras da plataforma.

Inclui:

- `platform_admins`;
- legacy admins;
- `tier_cache.source='admin'`;
- `ADMIN_WALLETS`;
- pilot lists;
- release gates;
- maintenance;
- disable CEX;
- disable swap;
- DCA release;
- Autopilot release;
- pausas;
- circuit breakers.

Perguntas obrigatórias:

- um admin removido continua com poder?
- uma escrita Supabase falhando aparece como sucesso?
- fechar um produto realmente fecha todos os executores?
- uma lista de piloto falha fechada?
- painel e runtime usam a mesma fonte de verdade?

### Requisito
Mudança de controle sensível deve ter:

**escrita confirmada + audit log confirmado + leitura de volta quando necessário.**

---

# FASE 4 — COFRE DE CREDENCIAIS CEX

Auditar:

- criptografia;
- armazenamento;
- duplicação;
- revogação;
- rotação;
- key permissions;
- withdrawal permission;
- passphrase;
- fallback legado;
- ownership.

### Invariantes

Uma conexão deve ser identificada por:

**wallet + exchange + connection ID + fingerprint/version da credencial.**

Trocar a chave deve invalidar o estado de segurança que foi provado sobre a chave anterior.

Com `connection_id` presente:

> falha ao ler o cofre = **não opera**.

Nunca:

> falha ao ler o cofre = usa uma credencial antiga escondida em outro lugar.

---

# FASE 5 — EXECUTION INTENT / EXACTLY-ONCE

Esta é uma das fases mais importantes.

Hoje não basta:

`createOrder() → resposta → grave depois`.

O desenho alvo deve ser:

**CREATED  
→ RESERVED  
→ SUBMITTING  
→ SUBMITTED  
→ OPEN  
→ PARTIAL  
→ FILLED**

ou:

**REJECTED / CANCELED / UNKNOWN / RECONCILIATION_REQUIRED**

Antes de qualquer ordem real deve existir um `intent_id` persistido.

Quando a exchange suportar:

- deterministic `clientOrderId`;
- lookup pelo client ID;
- idempotência real.

### Regra

**Timeout depois do envio jamais significa FAILED.**

Significa:

> **UNKNOWN — reconciliar antes de qualquer retry.**

---

# FASE 6 — RAILS DE RISCO

Auditar e provar:

- max trade;
- hard ceiling;
- exposição total;
- trades por dia;
- loss stop diário;
- whitelist de symbols;
- whitelist exchanges;
- market type;
- spot-only;
- balance;
- notional;
- slippage;
- liquidity;
- gas reserve;
- pause;
- kill switch.

### Requisito central

Os rails não podem existir separadamente em:

- localStorage;
- cron;
- React;
- Supabase.

Precisam convergir para **uma autoridade server-side**.

Idealmente uma operação do tipo:

`reserve_execution(...)`

que atomicamente valida:

- sessão;
- kill-switch;
- release;
- tier;
- pilot;
- credencial;
- daily trade slot;
- loss stop;
- exposição;
- notional;
- idempotência.

Somente depois disso a ordem pode sair.

---

# FASE 7 — AUTOPILOT CEX

Auditar separadamente:

## Browser Autopilot
- countdown;
- cancel;
- race durante countdown;
- multi-tab;
- multi-device;
- browser reload;
- localStorage;
- server counter;
- exposure;
- P&L;
- SELL ownership.

## Background Autopilot
- session lock;
- session revalidation;
- STOP race;
- TTL;
- expires_at;
- worker concurrency;
- position memory;
- exit engine;
- partial sells;
- limit exits;
- unknown orders.

## Cross-channel
A pergunta mais importante:

> Browser e cron compartilham exatamente os mesmos limites?

Se não, existe split-brain.

---

# FASE 8 — DCA

Auditar:

- criação;
- simulated vs real;
- release gate;
- wallet ownership;
- connection ownership;
- key permission;
- pair;
- quote currency;
- budget;
- per-cycle amount;
- reserve cycle;
- unique cycle;
- daily wallet cap;
- pause;
- resume;
- stop;
- scheduler;
- heartbeat;
- exchange failures;
- failed cycle semantics.

### Invariante

Um ciclo precisa reservar orçamento **antes** da ordem.

Depois:

- fill real → consome reserva;
- reject → libera/fecha corretamente;
- unknown → mantém reserva até reconciliação.

Nunca:

> ordem real aconteceu mas o budget não sabe.

---

# FASE 9 — CEX MANUAL

Auditar:

- order form;
- balance;
- market;
- limit;
- orderbook;
- warning vs enforcement;
- order submission;
- cancel;
- status;
- partial;
- final fill;
- fees;
- history.

### Requisito

Uma order manual `pending` deve continuar sendo reconciliada mesmo depois de:

- reload;
- fechar browser;
- restart;
- horas depois.

---

# FASE 10 — PARTIAL FILL / CANCEL / EXCHANGE DISAGREEMENT

Esta era justamente a próxima frente quando criamos o checkpoint.

Testar explicitamente:

- 20% filled + 80% open;
- 20% filled + cancel;
- canceled externamente;
- filled externamente;
- order not found;
- fetchOrder inconsistente;
- exchange history mostra fill mas Z-SWAP não;
- saldo mudou por ação externa;
- depósito externo;
- saque externo;
- trade manual feito diretamente na exchange.

A pergunta é:

> **Z-SWAP converge sozinho para a verdade da exchange?**

---

# FASE 11 — DEX 0x

Auditar:

- quote;
- firm quote;
- price impact;
- allowance target;
- spender;
- approval;
- receipt;
- gas;
- notional;
- balance;
- slippage;
- route;
- tx broadcast;
- receipt;
- actual output;
- platform fee.

### Requisitos

Nunca usar:

- output cotado como output real;
- gas nativo como USD sem preço;
- pending como settled.

---

# FASE 12 — SOLANA / JUPITER

Auditar:

- transaction decode;
- allowed programs;
- accounts;
- signers;
- writable accounts;
- mints;
- destination;
- authority changes;
- amount;
- simulation;
- signature;
- `confirmTransaction`;
- `value.err`;
- actual token delta.

### Objetivo

Passar de:

> “program ID permitido”

para:

> “a semântica desta transação corresponde exatamente ao swap que mostramos ao usuário.”

---

# FASE 13 — LI.FI / BRIDGE

Bridge precisa de lifecycle diferente de swap.

Estados mínimos:

**SUBMITTED  
→ SOURCE_CONFIRMED  
→ BRIDGE_PENDING  
→ DESTINATION_COMPLETED**

ou:

**PARTIAL / FAILED / REFUNDED / UNKNOWN**

A confirmação na chain de origem **não encerra a operação**.

Também auditar:

- source chain;
- destination chain;
- recipient;
- wallet family;
- bridge status API;
- destination amount;
- refund;
- route;
- fee;
- integrator payout.

---

# FASE 14 — CoW

Tratar CoW como **execução futura pré-autorizada**.

Auditar:

- amount;
- locale;
- limit price;
- decimals;
- EIP-712;
- allowance;
- Vault Relayer;
- submission;
- order UID;
- recovery;
- cancel;
- solver fill;
- partial fill;
- executed sell/buy amount;
- fee;
- tx hash.

Crash entre:

`submit order → save local state`

não pode fazer uma ordem executável desaparecer do sistema.

---

# FASE 15 — ACTION CARDS / ZION

A saída de IA não pode ser tratada como objeto confiável.

Implementar/auditar schema runtime discriminado para cada `kind`.

### Exemplos

`swap`:
- chain;
- token;
- amount.

`bridge`:
- fromChain;
- toChain;
- fromToken;
- toToken;
- amount;
- recipient.

`cross_cex`:
- duas legs explicitamente estruturadas.

`triangular`:
- três legs.

### Regra

Números executáveis devem aceitar somente formato canônico:

`1234.56`

Não aceitar automaticamente:

- `1.234,56`;
- `0,5`;
- `$100`;
- `1e6`;
- texto misturado.

Ambiguidade = **recusar execução**.

---

# FASE 16 — PROMPT INJECTION / LLM BOUNDARY

Testar entradas hostis vindas de:

- token names;
- pool names;
- DEX names;
- metadata;
- wallet context;
- market data;
- news;
- API external data.

Objetivo:

> IA pode interpretar; regras objetivas decidem.

Nenhuma instrução externa pode:

- aumentar cap;
- mudar wallet;
- mudar recipient;
- alterar chain;
- adicionar exchange;
- desabilitar safety rail.

---

# FASE 17 — LEDGER / OPERATIONS

Definir diferença entre:

## Telemetria
Pode ser best-effort.

## Livro financeiro
Não pode ser best-effort.

O ledger autoritativo precisa possuir IDs externos:

### Blockchain
- chain ID;
- tx hash;
- source tx;
- destination tx.

### CEX
- exchange;
- order ID;
- client order ID;
- fills/trades IDs.

Além disso:

- requested amount;
- filled amount;
- requested notional;
- actual cost;
- actual receive;
- actual fees;
- platform fee;
- status;
- verification timestamp.

---

# FASE 18 — P&L E COST BASIS

Auditar:

- acquisition;
- disposal;
- partial disposal;
- fees;
- stablecoin;
- venue;
- bridge;
- rebalance;
- deposit;
- withdrawal;
- pending;
- canceled;
- unknown.

### Regra

`pending` nunca altera patrimônio realizado.

`submitted` nunca altera cost basis.

Somente settlement comprovado.

---

# FASE 19 — TAXAS DA PLATAFORMA

Provar separadamente:

## Custo do usuário
- gas;
- taker/maker;
- bridge;
- priority;
- Jito;
- network.

## Receita da Z-SWAP
- integrator fee;
- protocol fee share;
- platform fee.

Nunca misturar os dois.

Para cada revenue claim:

> deve existir transação/settlement que prove que o dinheiro realmente chegou ao destino da plataforma.

---

# FASE 20 — SUPABASE

Auditoria completa de:

- RLS;
- grants;
- RPCs;
- SECURITY DEFINER;
- PUBLIC execute;
- anon/authenticated access;
- service-role assumptions;
- constraints;
- foreign keys;
- unique indexes;
- race conditions;
- pagination;
- silent truncation;
- `{error}`;
- transactions;
- locks.

### Regra crítica

O Supabase normalmente retorna:

`{ data, error }`

em vez de lançar exception.

Logo:

`try/catch` sozinho **não é suficiente**.

---

# FASE 21 — CONCORRÊNCIA E LOCKS

Testar:

- dois crons simultâneos;
- browser + cron;
- duas tabs;
- dois devices;
- duas functions Vercel;
- duplicate webhook;
- duplicate retry;
- stop durante run;
- pause durante run;
- revoke durante run.

Lock precisa proteger a decisão real, não somente a função.

---

# FASE 22 — RATE LIMIT

Separar endpoints em classes.

## Fail-closed
- auth;
- order;
- DCA;
- Autopilot;
- admin;
- credential operations.

## Pode degradar
- preço público;
- market data;
- leitura não sensível.

Não usar limiter local como fallback para money-path distribuído.

---

# FASE 23 — VERCEL

Auditar:

- regions;
- runtime;
- Node;
- max duration;
- timeouts;
- cold starts;
- deployment;
- environment variables;
- function geography;
- external connectivity.

Especialmente Binance:

- `gru1`;
- evitar região US;
- provar região em runtime.

---

# FASE 24 — GITHUB / CI / SUPPLY CHAIN

Auditar:

- branch protection;
- required PR;
- required review;
- required CI;
- CODEOWNERS;
- workflow permissions;
- action SHA pinning;
- Dependabot;
- npm audit;
- lockfile;
- Node parity;
- secret exposure.

### Gate recomendado

`main` só recebe código se:

- CI verde;
- money-path tests verdes;
- review obrigatório;
- sem HIGH/CRITICAL novo sem waiver documentado.

---

# FASE 25 — OBSERVABILIDADE / FORENSICS

Separar:

## Telemetry
Pode falhar sem impedir operação.

## Audit event
Não pode fingir sucesso.

## Financial event
Tem que estar ligado ao intent/settlement.

Testar:

- Supabase insert failure;
- Telegram failure;
- function ending;
- Vercel response before background task;
- duplicate events;
- missing events.

---

# FASE 26 — CHAOS TESTS

Depois das correções, quebrar propositalmente o sistema.

Cenários obrigatórios:

- exchange aceita ordem e conexão cai;
- DB falha antes da ordem;
- DB falha depois da ordem;
- worker morre;
- rede reseta;
- request duplica;
- cron roda duas vezes;
- browser fecha;
- chain troca;
- RPC cai;
- partial fill;
- cancel;
- balance changes;
- stale quote;
- API retorna campos ausentes.

### Critério

Após recuperação:

> exchange/chain e Z-SWAP precisam convergir para a mesma verdade.

---

# FASE 27 — REMEDIAÇÃO

Cada achado recebe:

- ID;
- severidade;
- módulo;
- evidência;
- cenário de falha;
- impacto;
- correção proposta;
- teste necessário;
- commit;
- status.

Não corrigir “por lote” sem capacidade de provar individualmente.

---

# FASE 28 — RETESTE INDEPENDENTE

Quando Codex terminar uma correção:

1. ler o diff;
2. entender o que realmente mudou;
3. conferir se resolveu a causa ou apenas o sintoma;
4. procurar regressões;
5. executar teste original;
6. executar teste adversarial;
7. testar Supabase;
8. testar Vercel;
9. verificar produção.

Somente depois:

**FIXED IN CODE → DEPLOYED → RETESTED → PROVED**

---

# FASE 29 — CANÁRIOS COM DINHEIRO REAL

Somente módulos que já passaram Gates A/B.

Valores mínimos.

### Para cada canário

Comparar:

**antes**
- saldo;
- allowance;
- posição;
- banco.

**intenção**
- amount;
- notional;
- expected output;
- expected fee.

**mundo externo**
- tx hash/order ID;
- fill;
- cost;
- fees.

**depois**
- saldo;
- posição;
- ledger;
- P&L;
- platform fee.

Tem que fechar matematicamente.

---

# FASE 30 — RECONCILIAÇÃO INDEPENDENTE

Para cada operação real:

### DEX
chain receipt + token balance deltas.

### Bridge
source + destination.

### CEX
order + fills/myTrades + fees + balances.

Não confiar no próprio Z-SWAP para provar que o Z-SWAP está certo.

---

# FASE 31 — CERTIFICAÇÃO POR MÓDULO

Cada módulo recebe uma decisão independente:

- **GO**
- **GO COM RESTRIÇÕES**
- **NO-GO**

Módulos:

- Swap DEX;
- Jupiter;
- LI.FI/Bridge;
- CoW;
- CEX manual;
- DCA;
- Autopilot browser;
- Autopilot background;
- arbitragem;
- ZION Observer;
- ZION Copilot;
- Pilot;
- Admin;
- Supabase;
- Vercel;
- GitHub/CI.

---

# FASE 32 — CRITÉRIOS MÍNIMOS PARA PILOT

Eu só considero Pilot tecnicamente liberável quando estiver provado:

- intenção persistida antes da execução;
- idempotência;
- client order ID quando disponível;
- timeout → UNKNOWN;
- reconciliador persistente;
- nenhum phantom fill;
- ledger externo identificável;
- kill-switch global real;
- session stop real;
- exposure global;
- daily cap atômico;
- loss stop autoritativo;
- key trade-only;
- revogação fail-closed;
- partial fills corretos;
- crash recovery;
- chaos tests.

---

# FASE 33 — PDF FINAL

Somente depois de tudo isso.

O relatório final terá:

**Resumo executivo  
Escopo  
SHA congelado  
Arquitetura  
Mapa de dinheiro  
Metodologia  
Threat model  
Achados P0/P1/HIGH/MEDIUM/LOW  
Evidências  
Correções  
Commits  
Retestes  
Chaos tests  
Canários reais  
Reconciliação  
Riscos residuais  
Veredito por módulo  
Decisão de release  
Roadmap pós-auditoria  
Apêndice técnico**

E cada achado terá explicitamente:

**OPEN  
FIXED IN CODE  
DEPLOYED  
RETESTED  
PROVED**

---

# A REGRA MAIS IMPORTANTE DA AUDITORIA

O princípio que amarra o plano inteiro é:

> **O Z-SWAP não pode tratar “eu mandei” como “executou”, nem “não consegui ler” como “não existe”, nem “o banco não reclamou por exception” como “gravou”.**

Para movimentação financeira:

**não sei = parar/reconciliar.**

Nunca:

**não sei = assumir sucesso.**

---

# ANEXO — REGRAS DE MANUTENÇÃO DESTE DOCUMENTO

1. O plano FASE 0→33 permanece estável; novos experimentos entram como
   campanhas, gates ou anexos, sem reutilizar números de fase existentes.
2. Toda mudança de status deve apontar para evidência concreta:
   SHA, migration, teste, CI, query, ambiente ou relatório de reteste.
3. Código certificado não significa produção atualizada.
4. Backup legível não significa restore provado.
5. Restore provado do banco da aplicação não significa DR completo da plataforma.
6. Teste de peça isolada não prova que a peça participa do caminho que decide.
7. O T13 original da concorrência DCA não deve ser descrito como PASS:
   **ORIGINAL = FAIL/INCONCLUSIVE por hipótese temporal de 200 ms**;
   **invariante A58 = PASS por prova sincronizada de ordem de lock**.
8. Modos reais continuam NO-GO até os gates específicos de deploy, canário,
   reconciliação e certificação por módulo.
9. Estados de finding devem usar, quando aplicável:
   **OPEN → FIXED IN CODE → DEPLOYED → RETESTED → PROVED**.
10. Regra central para money-path:
    **não sei = parar/reconciliar; nunca assumir sucesso.**
