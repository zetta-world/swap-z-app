# Plano de Ação — ZION & Autopiloto

> **Gerado em:** 2026-06-26
> **Fonte:** auditoria direta do código-fonte em `src/` (não do relatório).
> **Propósito:** registrar, de forma rastreável, (1) as correções de **risco de
> dinheiro real** e (2) a evolução do ZION para **olhar o passado profundo** e
> ter **aprendizado dinâmico**. Documento vivo — atualizar a coluna *Status* a
> cada entrega.

**Legenda de status:** `🔴 não iniciado` · `🟡 em andamento` · `🟢 concluído`

**Legenda de severidade:** `🩸 bloqueante` · `⚠️ alto` · `▫️ médio`

---

## PARTE 1 — PLANO DE AÇÃO POR RISCO DE DINHEIRO

Auditoria do caminho crítico de execução: `card-mapping.ts` →
`autopilot-bridge.ts` → `/api/cex/order` → `cex/server.ts` → settlers de P&L.
Cada item abaixo foi **confirmado lendo o código**, com referência de arquivo.

### Tabela-resumo

| ID | Achado | Severidade | Status |
|----|--------|-----------|--------|
| C1 | Compra a mercado sem teto de dólar real (cap circular no número do LLM; servidor não limita market order) | 🩸 | 🟢 |
| C2 | Daily loss-stop não-funcional (background nunca dispara; browser só conta arbitragem) | 🩸 | 🔴 |
| C3 | `parsePrice` quebra com formato numérico PT/EU (3.420,50 → 3,42) | 🩸 | 🟢 |
| C4 | Tamanho/preço da ordem vêm de texto livre do LLM sem reconciliação com preço real | ⚠️ | 🟢 |
| C5 | Compra a mercado não é gravada na position memory → posição órfã, sem saída | ⚠️ | 🔴 |
| C6 | Cap de rebalance (saque) burlável para moeda não-stable | ⚠️ | 🔴 |
| A1 | Contadores split-brain (localStorage do browser vs Supabase do cron) | ⚠️ | 🔴 |
| A2 | Cron pode sobrepor execuções (`cancel-in-progress: false`, sem lock de sessão) | ⚠️ | 🔴 |
| A3 | Rate limit em memória morre em cold start serverless | ▫️ | 🔴 |
| A4 | Sem cap de exposição total (só por-trade e por-contagem) | ⚠️ | 🔴 |
| A5 | Sem exit-engine server-side (cron compra mas nunca vende nem lê posições) | ⚠️ | 🔴 |

---

### C1 — Compra a mercado sem teto de dólar real `🩸` · 🟢 CONCLUÍDO (2026-06-26)

> **Entregue:** novo guard `src/lib/autopilot/price-guard.ts` — recomputa o
> notional real (`baseAmount × preço_real` via spot público) e rejeita compras
> acima do cap×1.5, acima do teto absoluto de $100k, ou que não podem ser
> precificadas (fail-safe). Ligado nos DOIS canais: `/api/cex/order` (browser,
> server-side, não burlável) e o cron. Testado em 8 cenários, incl. o overspend
> de 1000× (rejeitado). **Follow-up não-bloqueante:** converter market buy em
> marketable-limit para limitar também o slippage intra-fill.


**Onde:**
- `src/lib/zion/card-mapping.ts` (`mapCardToCexIntent`): `notionalUsd = card.from.amount`; `baseAmount = from.amount / parsePrice(entryPrice)`.
- `src/components/zion/AutopilotPilot.tsx:201`: cap checa `i.notionalUsd > maxTradeUsd` — número do próprio LLM (circular).
- `src/app/api/cex/order/route.ts:117-125`: teto de `$100.000` **só vale quando há `price`** ("Market orders carry no price so this can't bind them").
- `src/lib/cex/server.ts:273`: `placeCexOrder` é *"a thin pass-through to ccxt.createOrder"*, sem proteção de slippage.

**Por que é perigoso:** o dólar gasto = `baseAmount × preço_real`. Se o preço do
LLM estiver errado (defasado/alucinado/mutilado por C3), o gasto diverge sem
limite. Pior caso = **todo o saldo de quote da exchange**. No browser o banner
de countdown mostra `~$50` (número do LLM) enquanto a ordem real pode ser muito
maior — o countdown vira salvaguarda falsa. No cron não há humano.

**Correção:**
1. Em fire-time, buscar preço real (`fetchCexOrderbook`/ticker, já existe) e
   recalcular `notionalReal = baseAmount × bestAsk` (buy). Rejeitar se
   `notionalReal > maxTradeUsd × 1.5`.
2. Converter market buy em **marketable limit** (`price = bestAsk × (1 + slippageBps)`),
   ativando o teto de `$100k` do servidor. O campo `maxSlippageBps` já existe no
   schema do card e hoje é ignorado.

---

### C2 — Daily loss-stop não-funcional `🩸`

**Onde:**
- `src/components/zion/AutopilotPilot.tsx`: `recordPnl` só é chamado pelos
  settlers `settleCrossCexAndRecordPnl` e `settleTriangularAndRecordPnl`
  (linhas 363, 374) — **só arbitragem**. Trades direcionais (swap/buy_limit/sell_*)
  nunca alimentam o loss-stop. Uma venda só chama `markExitArmed` (linha 310),
  sem calcular P&L realizado.
- `src/app/api/autopilot/cron/route.ts:100`: `pnl_today` só é setado para `0`
  (rollover), nunca incrementado. **`frozen_until_day` nunca é setado para hoje
  por nenhum código de servidor** — só lido/carregado. Logo, o freeze do cron é
  código morto: nunca dispara.

**Por que é perigoso:** a feature de segurança mais divulgada ("congela se
perder $X/dia") **não funciona no uso principal**. Background: nunca congela.
Browser: só conta P&L de arbitragem.

**Correção:**
1. Reutilizar o engine **`src/lib/store/costBasis.ts` (já existe)** para calcular
   P&L realizado em cada venda e alimentar `recordPnl`.
2. Gravar TODA compra (inclusive market) na position memory (ver C5).
3. No servidor: computar/persistir `pnl_today` e **setar `frozen_until_day`** ao
   cruzar o limite.

---

### C3 — `parsePrice` quebra com formato numérico PT/EU `🩸` · 🟢 CONCLUÍDO (2026-06-26)

> **Entregue:** `parsePrice` reescrito (regra "último separador = decimal", com
> viés seguro no caso ambíguo) em `card-mapping.ts`; foundation prompt agora
> exige formato máquina nos campos de execução; exemplos atualizados. Testado em
> 12 casos de locale (incl. o catastrófico `3.420,50→3420.50`); `tsc` limpo.


**Onde:** `src/lib/zion/card-mapping.ts:59`
```js
const m = String(raw).replace(/[^\d.,-]/g, "").replace(/,/g, "");
parseFloat(m);
```
Entrada `"$3.420,50"` (BR = 3420,50) → `"3.420.50"` → `parseFloat` para no 2º ponto → **`3.42`** (erro de 1000×). O ZION é instruído a sair **em português**.

**Por que é perigoso:** alimenta diretamente o `baseAmount` do caminho sem teto
(C1). Hoje é mina latente (depende do formato que o modelo emite).

**Correção:** detectar/tratar decimal-vírgula corretamente, **ou** (preferível)
instruir o ZION a emitir números nos campos do card sempre em formato máquina
(`3420.50`) e validar no parse.

---

### C4 — Origem do tamanho/preço sem reconciliação `⚠️` · 🟢 CONCLUÍDO (2026-06-26)

> **Entregue junto do C1:** o guard reconcilia tamanho/preço contra um preço de
> referência fresco (spot público) em fire-time, nos dois canais, antes de
> colocar a ordem. Ver `price-guard.ts` + `checkRealNotional`.


**Onde:** todo o `mapCardToCexIntent` deriva tamanho e preço de
`card.from.amount` / `card.entryPrice` (texto do LLM). Nunca há comparação com
um preço real antes do fill.

**Correção:** passo de reconciliação em fire-time (mesmo do C1, item 1). O
sistema já sabe buscar `fetchCexOrderbook`/`fetchTickers` no servidor.

---

### C5 — Compra a mercado vira posição órfã `⚠️`

**Onde:** `src/components/zion/AutopilotPilot.tsx:299` — `recordEntry` só roda se
`intent.price && intent.price > 0`. Market buy tem `price: undefined` → posição
**não registrada**. O cron também não lê position memory.

**Correção:** registrar a entrada usando o preço de fill real (do retorno da
ordem) em vez do `intent.price`. Resolve junto com C2/A5.

---

### C6 — Cap de rebalance burlável `⚠️`

**Onde:** `src/lib/zion/autopilot-bridge.ts:143` —
`notionalUsd = parsePrice(card.estReturn ?? card.targetReturn) || amount`. Para
moeda não-stable sem `estReturn`, cai no `amount` (quantidade do token). Sacar
`5 ETH` é tratado como `notionalUsd = 5` vs cap de `200`.

**Nota:** o destino é seguro (carteira do próprio usuário, `resolveWithdrawDestination`
valida com regex), então é "mover demais do próprio dinheiro", não roubo.

**Correção:** computar `notionalUsd` com preço real da moeda buscado no momento,
nunca fallback para a quantidade de token.

---

### A1–A5 — Arquitetura de risco `⚠️/▫️`

- **A1 split-brain:** browser conta em `localStorage` (`zswap_autopilot_v1`),
  cron conta em Supabase (`autopilot_sessions`). Independentes → orçamento diário
  dobrado com aba aberta + cron rodando. **Correção:** ledger único server-side;
  browser lê dele.
- **A2 overlap do cron:** `.github/workflows/autopilot-cron.yml` tem
  `cancel-in-progress: false` e não há flag `is_running` no Supabase →
  execuções podem se sobrepor. **Correção:** `cancel-in-progress: true` + lock de
  sessão (`is_running` com timeout de auto-release).
- **A3 rate limit:** `src/lib/rate-limit.ts` usa `Map` em memória (o próprio
  comentário admite "per-Vercel-instance"). **Correção:** Upstash/Redis +
  tier-based.
- **A4 sem cap de exposição total:** só existe cap por-trade e por-contagem.
  **Correção:** `maxOpenExposureUsd` por sessão; checar `Σ posições + novo notional`.
- **A5 sem exit-engine server-side:** cron é buys-only e não lê posições →
  saco acumulado sem saída automática. **Correção:** mover position memory para
  Supabase, injetar contexto de posições abertas no scan do cron, disparar
  saídas server-side.

---

### Sequência recomendada (Parte 1)

**Nível 0 — blindar o caminho da ordem (antes de tudo):** C1, C3, C4
(reconciliação de preço real + marketable limit + parse de número robusto).

**Nível 1 — loss-stop real:** C2, C5, C6 (reusar `costBasis.ts`, gravar entradas,
persistir `pnl_today`/`frozen_until_day`, cap de rebalance por USD real).

**Nível 2 — arquitetura:** A1 (ledger único), A2 (lock + cancel-in-progress),
A3 (Redis), A4 (exposição total), A5 (exit-engine server-side).

> **Recomendação:** pausar execução autônoma **a mercado** até o Nível 0 fechar.

---

## PARTE 2 — ZION OLHANDO PARA TRÁS + APRENDIZADO DINÂMICO

### Estado atual (medido no código)

`src/lib/api/market-indicators.ts` → `getSymbolIndicators` (linha 542):
```js
fetchCandles(symbol, "1h", 100, ...)   // ~4 dias
fetchCandles(symbol, "4h", 100, ...)   // ~16 dias
fetchCandles(symbol, "1d", 100, ...)   // ~100 dias (≈3,3 meses)
```
- **Horizonte máximo: ~100 dias.** Sem candle semanal/mensal. Sem ciclos/anos.
- **Injeção é snapshot, não trajetória:** `formatIndicatorsForPrompt` manda só o
  valor atual de cada indicador. O LLM não vê o caminho nem onde está no range
  histórico. Exceções já derivadas: OBV trend, relVol, divergência RSI, S/R, pivôs.
- **Memória entre sessões: ZERO.** Nada persiste "ZION disse X → resultado Y".
- **Já existe (parcial):** `computeConfidenceScore` (linha 672) faz score 0–100
  composto, mas com pesos **não-backtestados** (o próprio código avisa) e sem
  macro/segurança/on-chain.

### Dois eixos distintos (não confundir)

| | Eixo A — Profundidade | Eixo B — Aprendizado |
|---|---|---|
| O que é | Ver mais história + a trajetória | Melhorar com os próprios resultados |
| Custo | Baixo (prompt + storage, sem ML) | Alto (precisa de ledger primeiro) |
| Sua frase | "analisar semanas, meses, anos" | "aprendizado dinâmico" |

### Eixo A — ZION enxergar o passado profundo

| ID | Ação | Onde | Status |
|----|------|------|--------|
| Z1 | Estender lookback diário (200–365 velas) + adicionar **candle semanal** (ciclos multi-mês/ano) | `market-indicators.ts` `fetchCandles` | 🔴 |
| Z2 | Injetar **trajetória** em vez de snapshot: "RSI 38→45→61", "regime virou há N barras", "preço no percentil X do range de 1 ano", "distância da máxima do ciclo" | `formatIndicatorsForPrompt` | 🔴 |
| Z3 | **Market Brain** persistente por ativo (Supabase): histórico de regime, posição no range, volatilidade vs média 90d — atualizado a cada scan | novo módulo + tabela | 🔴 |
| Z4 | Adicionar **contexto global/macro** (DXY, S&P/Nasdaq, dominância BTC, fluxo ETF, stablecoin supply) | nova fonte de dados | 🔴 |

### Eixo B — Aprendizado dinâmico

| ID | Ação | Onde | Status |
|----|------|------|--------|
| Z5 | **Ledger de sugestões → resultados**: gravar todo card emitido (símbolo, entry, target, stop, score, timestamp) | nova tabela Supabase | 🔴 |
| Z6 | **Replay/Backtester**: rodar o ZION sobre velas históricas (a matemática é pura → factível) e medir acerto/expectancy | novo worker | 🔴 |
| Z7 | **Calibração de probabilidade** (Platt/isotonic) sobre o ledger; renomear UI "probability" → "conviction score" com disclaimer | rota + i18n | 🔴 |
| Z8 | **Ampliar/recalibrar `confidenceScore`** com macro+segurança+on-chain e pesos tirados do ledger (hoje são chutados) | `computeConfidenceScore` | 🔴 |
| Z9 | (Longo prazo) Sizing por **Kelly** usando `p` real do ledger + R do card | `card-mapping`/pilot | 🔴 |

### Sequência recomendada (Parte 2)

1. **Z1 + Z2** (maior ROI, resposta direta a "olhar anos atrás" — só dados no prompt).
2. **Z3** (Market Brain — memória sem ML).
3. **Z5 + Z6** (ledger + replay — destrava aprendizado).
4. **Z7 + Z8** (calibração + score validado).
5. **Z4, Z9** (macro, Kelly).

---

## Notas de cruzamento com as 4 IAs externas (Kimi, ChatGPT, Gemini, DeepSeek)

- **Onde acertaram (confirmado):** rate limit frágil, probabilidade não-calibrada,
  TA só nos pares Binance, ausência de backtesting, arb via LLM lento demais,
  ProDepth em polling.
- **Onde erraram (refutado pelo código):** "triangular sem abort" (já existe,
  `AutopilotPilot.tsx:218-251`); "modelo 100% hardcoded" (há `ZION_MODEL` env).
- **O que NENHUMA viu (sem acesso ao código):** C1–C6 inteiros, o split-brain de
  contadores, o overlap do cron e o loss-stop morto. Esses só aparecem lendo o
  código linha a linha — e são os de maior risco de dinheiro.
- **"Sistema de Score" do ChatGPT já existe parcial** como `confidenceScore`
  (falta validar e ampliar — vira Z8).

---

## PARTE 3 — SUGESTÕES EXTERNAS AVALIADAS (curadoria p/ o plano)

Cada sugestão das 4 IAs foi cruzada com o código real e com as Partes 1 e 2.
**Descoberta-chave:** várias features pedidas como "faltando" já estão
50–80% construídas — o custo é menor do que as IAs estimaram.

### 3.1 — Já existe parcial → só CONECTAR (ROI altíssimo)

| ID | Item | Estado real no código | Status |
|----|------|----------------------|--------|
| E1 | TA para tokens DEX | `getOHLCV()` já existe (`src/lib/api/geckoterminal.ts:363`); os `calcRSI/calcADX/...` são funções puras. Falta só alimentar o pipeline com esses candles | 🔴 |
| E2 | Trailing stop / OCO no autopiloto | Já existem como tipos de ordem em `src/components/pro/ProOrderPanel.tsx` (manual). Falta wirar no `AutopilotPilot` | 🔴 |
| E3 | MEV protection em swaps grandes | CoW Protocol já existe (`src/lib/limit/cow.ts`). Falta estender a todo swap DEX > $X e tornar default | 🔴 |
| E4 | Smart Money / Whale no ZION | `src/components/pro/ProSmartMoney.tsx` já analisa baleias (veredito accumulating/distributing). Falta injetar no prompt do ZION + grafo persistente de carteiras | 🔴 |

### 3.2 — Adicionar agora (novo, alinhado a dinheiro/confiança)

| ID | Item | Origem | Status |
|----|------|--------|--------|
| N1 | **Model fallback router** (Sonnet→Haiku/outro em 529/timeout) — resolve o SPOF | Kimi/Gemini/DeepSeek | 🔴 |
| N2 | **Suprimir seção de TA quando não há candles** (paradoxo do sniper: não usar ADX de BTC para um token novo) | Gemini | 🔴 |
| N3 | **Execution Quality Report** (slippage real vs estimado, fill rate) — alimenta a calibração (Z7) | Kimi/DeepSeek | 🔴 |
| N4 | **Honeypot p/ Solana/Base/Arbitrum** (RugCheck.xyz, TokenSniffer) | Kimi/DeepSeek | 🔴 |
| N5 | **Explicabilidade** (porque comprou / não comprou / vendeu / recusou) — barato, alta confiança | ChatGPT | 🔴 |
| N6 | **Meta-IA / verificador adversarial** revisa o card antes de executar | ChatGPT | 🔴 |

### 3.3 — Novo pilar: Inteligência de Portfólio & Risco

| ID | Item | Origem | Status |
|----|------|--------|--------|
| R1 | Portfolio-level intelligence (correlação entre posições, concentração, beta vs BTC) | Kimi | 🔴 |
| R2 | Risk Radar por ativo (liquidez, hack, bridge, governança, contrato, centralização, regulação) | ChatGPT | 🔴 |
| R3 | Simulação de cenário ("se BTC cair 15%, o que acontece com a carteira") | ChatGPT/Kimi | 🔴 |
| R4 | **Paper trading** (modo simulação 1:1 antes de dinheiro real) | Kimi/ChatGPT | 🔴 |

### 3.4 — Camada de dados & infra (estende Eixo A/B)

| ID | Item | Origem | Status |
|----|------|--------|--------|
| D1 | News intelligence (classificar impacto bull/bear, curto/longo) | ChatGPT | 🔴 |
| D2 | Sentiment social → índice (X, Reddit, Telegram, Discord, GitHub) | ChatGPT | 🔴 |
| D3 | Heat map global (fluxo por setor/narrativa: AI, RWA, gaming…) | ChatGPT | 🔴 |
| D4 | Preço on-chain via oráculo (Pyth/Chainlink) p/ confiabilidade de preço DEX | Kimi | 🔴 |
| D5 | WebSocket real-time (ProDepth/ProTrades/CEX prices) + event bus | Kimi/DeepSeek/Gemini | 🔴 |
| D6 | LLM observability/evals (tracing por chamada, A/B de prompts) | Kimi | 🔴 |

### 3.5 — Produto & conformidade

| ID | Item | Origem | Status |
|----|------|--------|--------|
| P1 | Push notifications / alertas de preço (triggerPrice atingido, stop, freeze) | Kimi/DeepSeek | 🔴 |
| P2 | Compliance & geoblocking (KYC/AML, jurisdições sancionadas) | Kimi | 🔴 |
| P3 | Política de retenção/privacidade dos prompts (saldo, posições) | Kimi | 🔴 |

### 3.6 — Deferir / NÃO fazer agora (com motivo)

| ID | Item | Por que não agora |
|----|------|-------------------|
| X1 | Nós próprios (Erigon/Firedancer) + subgraphs próprios | Infra pesada e cara; não move a agulha do problema atual (segurança + confiança) |
| X2 | Account Abstraction / Intents (ERC-4337 / ERC-7683) | Reescrita grande; CoW já cobre boa parte do benefício de execução |
| X3 | Market making mode (Uniswap v3 ranges) | Produto diferente; foco agora é trade/advisory seguro |
| X4 | Copy trading / leaderboard | Só faz sentido depois do track record (Z5/Z6) existir |
| X5 | Multi-model ensemble | Complexidade alta, ganho incremental; o fallback router (N1) já dá resiliência |
| X6 | VaR/CVaR formal | Provável over-engineering p/ o público atual; R1+R2+A4 cobrem ~80% do valor |

### Sequência recomendada (Parte 3)

1. **E1–E4** (só conectar o que já existe — maior ROI de todo o documento).
2. **N1–N6** junto/depois dos Níveis 0–1 da Parte 1 (segurança e confiança).
3. **R1–R4** (pilar de portfólio — diferencial competitivo).
4. **D1–D6 / P1–P3** conforme tração e necessidade.
5. **X1–X6** só se/quando houver justificativa de negócio clara.
