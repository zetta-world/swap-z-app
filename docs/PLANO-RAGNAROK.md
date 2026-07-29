# PLANO-RAGNAROK — o retorno dos guerreiros de Valhalla

> Status geral: 🟡 em construção
> Origem: veredito anterior ("IA não prevê direção em cripto") era **verdadeiro
> mas estreito**. Testamos só o formato scanner (bracket long/short) + oráculo,
> só em CEX, com métrica de acerto-de-previsão. Nunca testamos **seleção de
> estratégia por regime**, **acumulação de USDT (long-only)**, nem **DEX**.
> Este plano ressuscita os agentes com o mandato certo.

## A tese (do dono)

> "A questão não é IA adivinhar a direção do mercado, é IA analisar o mercado e
> seguir a estratégia que melhor se adequa àquele momento — stop, range,
> pullback, suporte/resistência. Modelos de fronteira são ótimos em prever
> padrão, e o mercado é isso até quando está lateralizado."

E: os trades buscam **aumentar a quantidade de USDT** — comprar um token barato
e vender com lucro. **Long-only, spot, acumulação.**

## Decisões travadas (28/07)

| Fork | Escolha |
|------|---------|
| Mandato | **Acumulação long-only** — só compra barato/vende caro; métrica = crescimento de USDT (carteira paper), não acerto de bracket |
| Mercado | **DEX + CEX** — usa `getSymbolIndicators` (CEX) e `getDexSymbolIndicators` (GeckoTerminal) |
| Motor | **Novo agente seletor** dedicado, separado do formato scanner |

## Por que o experimento antigo não testou isto

- `extractSuggestion` (backtest.ts) tem **regime filter** que faz
  `if regime === "RANGING" return null` — ou seja, **rejeitava exatamente os
  mercados laterais** onde mean-reversion vive. Os agentes nunca puderam
  operar range.
- O formato scanner emitia **long E short** (`bullish → buy_limit`,
  `bearish → sell_safe`). Short = apostar na queda. Não é acumular USDT.
- A métrica do torneio é **% por trade** (acerto de alvo vs stop). A carteira
  paper (`paper_accounts.cash_usd`, `pnl_usd`) **já mede USDT acumulado** — só
  nunca recebeu um agente long-only seletor.

## Arquitetura

Dois cérebros na mesma pista, medidos pela **mesma carteira paper** (USDT):

1. **`strat_mech`** — seletor MECÂNICO (determinístico, zero-LLM). O "bot burro"
   de controle. Dado o regime + S/R + ATR, escolhe o playbook e monta o bracket
   long. Se um bot mecânico honesto não lucra, a estratégia está errada — não a IA.
2. **`strat_ai`** — seletor de FRONTEIRA. Recebe a análise completa do ZION +
   a sugestão mecânica, e pode **aceitar / vetar / ajustar** (entrada, alvo,
   stop, tamanho). A pergunta do experimento: **a IA bate o bot mecânico?**

Playbooks (todos LONG):
- `range_reversion` — regime RANGING: compra perto do **suporte**, alvo perto da
  **resistência**, stop abaixo do suporte (ATR-floored). O unlock principal.
- `trend_pullback` — TRENDING_UP: compra o **pullback** (perto de EMA20/suporte),
  alvo na continuação, stop abaixo da estrutura.
- `capitulation_reversal` — TRENDING_DOWN **só** com `bullish_rsi` divergence
  perto da mínima de 1 ano (rangePct baixo). Senão, downtrend long-only = fora.
- TRANSITIONING → fora (v1).

Escoamento: escreve em `zion_suggestions` com `source` novo → a `paper/engine.ts`
já abre/fecha posição e credita USDT na carteira automaticamente. O torneio e o
painel Paper já leem por source.

## Fatias (slices)

- [x] **S0 — Valhalla**: memorial viking (feito, `cf232be`).
- [x] **S1 — motor mecânico**: `src/lib/zion/strategist.ts` puro + testes
  (`selectPlaybook`, brackets long a partir de S/R+ATR, RR e stop-floor). 🟢
- [x] **S2 — wiring cron**: `src/lib/zion/ragnarok.ts` (`runStrategistScan`)
  grava DIRETO em `zion_suggestions` — **não** passa por `logSuggestions`, cujo
  `extractSuggestion` tem o `if RANGING return null` que mataria o experimento.
  Roda no tick logo após os indicadores, com try próprio (é grátis, não pode
  ficar refém de falha de LLM). `strat_mech` entrou em `PAPER_SOURCES` e no
  torneio. 🟢
- [ ] **S3 — DEX**: rodar o seletor sobre pares DEX via `getDexSymbolIndicators`. 🔴
- [ ] **S4 — camada IA**: `strat_ai` aceita/veta/ajusta a sugestão mecânica. 🔴
- [ ] **S5 — painel**: card "Ragnarök" — carteira USDT por playbook, mech vs IA. 🔴

## Honestidade (cicatrizes a preservar)

- Métrica primária = **USDT na carteira** (paper), não win-rate. Win-rate é
  secundário.
- `strat_mech` é o CONTROLE — não "melhorar" ele pra IA ganhar. A comparação só
  vale se o mecânico for honesto.
- Long-only de verdade: `side` sempre `"buy"`. Nada de short disfarçado.
- Stop fora da banda de ruído (ATR floor), senão morre de clima, não de estar errado.
- Amostra mínima antes de qualquer veredito (mesma disciplina do flywheel).
