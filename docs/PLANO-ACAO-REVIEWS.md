# Plano de Ação — Refinamentos pós-review das 4 IAs

> **Origem:** revisão externa do `ARQUITETURA-IA.md` por GPT, Gemini, DeepSeek e
> Kimi, cruzada com o código real. Nenhuma achou falha fundamental — tudo é
> refinamento. Documento vivo: atualizar o **Status** a cada entrega.
> **Gerado:** 2026-07-01.

**Legenda:** `🔴 pendente` · `🟡 em andamento` · `🟢 feito` · `⏸️ deferido/data-gated` · `❌ não fazer (com motivo)`

---

## 0. Já implementado (os reviewers não sabiam — só viram o doc)

| Item | Onde |
|------|------|
| 🟢 Motor estatístico antes do LLM (RSI/MACD/ATR/ADX/regime/score) | `market-indicators.ts` |
| 🟢 Health check de todos os provedores de IA | `health.ts` (`pingAiProviders`) + watchdog |
| 🟢 Radar re-sincroniza referência velha | `radar.ts` (`REF_MAX_AGE_MS` 6h) |
| 🟢 On-chain / smart-money (parcial) | E4 `analyzeSmartMoney` (falta plugar na Ferrari — ver P2.8) |
| 🟢 Separação shadow (flywheel) vs produção (usuário = Sonnet) | arquitetura atual |
| 🟢 9 CEXs (inclui KuCoin/HTX) | `cex/types.ts` |

> **Nota GPT:** revisou o relatório ANTIGO. Quase tudo que pediu (ATR/ADX/backtesting/
> ML/paper-trading) já foi feito depois — logo, confirma o rumo.

---

## 1. AÇÕES PRIORIZADAS

### P0 — barato + muda a validade da medição
| ID | Item | Por quê | Fonte | Status |
|----|------|---------|-------|--------|
| P0.1 | **Expectancy LÍQUIDA** (subtrair fee taker + slippage estimado do `outcome_pct`) | Sem descontar custo, o edge do backtest é inflado vs realidade. A #1. | Gemini, DeepSeek | 🟢 `ROUND_TRIP_COST_PCT` (env `BACKTEST_COST_PCT`, def 0.2%) em `getBacktestStats` + rota admin + painel mostra NET (gross ao lado) |
| P0.2 | **Grok cego** — ligar live-search nativo do X OU tirar o Grok da Ferrari até o pipeline existir | Especialista sem dado real do X adiciona ruído que o CEO filtra | Kimi, DeepSeek | 🟢 `GROK_SEARCH_BODY` (`search_parameters` X+news) passado via `extraBody` quando o assento sentimento é Grok |
| P0.3 | **Fallback do CEO** — se Opus falhar, Sonnet (ou vencedor do torneio) assume a síntese | Opus é ponto único de falha; sem fallback, todo o Agente B vira lixo no timeout | Gemini, DeepSeek, Kimi | 🟢 loop primário Opus → fallback Sonnet (`HYBRID_ORCH_FALLBACK_MODEL`) em `runHybridScan`; só desiste se ambos falharem |

### P1 — barato, honestidade estatística
| ID | Item | Por quê | Fonte | Status |
|----|------|---------|-------|--------|
| P1.4 | **Resolução em 5min** (não 1h) no replay de velas | 1h esconde ordem intra-barra (target :05, stop :45 → marca stop injusto). 5min cabe em 1 request, custo zero | Gemini, Kimi, DeepSeek | 🟢 `RESOLVE_INTERVAL="5m"` (env `BACKTEST_RESOLVE_INTERVAL`), limit=1000 ≈83h cobre horizonte 72h |
| P1.5 | **Amostra mínima ≥100** (não 30) pra comparação; ≥300 pra decisão final | 30 é ruído estatístico (erro-padrão ~1.5% com σ 8%) | Gemini, DeepSeek, Kimi | 🟢 `MIN_SAMPLE=100` (env `BACKTEST_MIN_SAMPLE`) → `sufficientSample`; painel mostra ⚠ AMOSTRA PEQUENA |
| P1.6 | **Separar `Resolved` vs `Expired`** na resolução | "win direcional" por close infla win-rate *(nuance: expectancy já é justa; só o win-rate infla)* | Kimi | 🟢 `resolveOne` retorna status `expired` (não win/loss) no fim do horizonte; win-rate = só decididos, `signalRate` = decididos/resolvidos |
| P1.7 | **Version stamping** — gravar versão do prompt (`ZION_FOUNDATION_vX`) e modelo com data em `zion_suggestions` | Depurar variação de performance ao longo do tempo | DeepSeek | 🟢 `ZION_FOUNDATION_VERSION="ZION_FOUNDATION_v1"` em todos os metas de `recordEvent` (`promptVersion`) |

### P2 — maior, alto valor (depois dos P0/P1)
| ID | Item | Por quê | Fonte | Status |
|----|------|---------|-------|--------|
| P2.8 | **Risco de PORTFÓLIO** (correlação + beta agregado vs BTC + concentração) além do `price-guard` por-trade | 3 longs correlacionados passam no cap individual mas a carteira fica 1.5x beta BTC | Gemini, DeepSeek, Kimi | 🔴 |
| P2.9 | **Especialista on-chain na Ferrari** — plugar o E4 (smart-money/fluxo) como voz do CEO | Pra uma DEX, fluxo on-chain é sinal-chave; hoje ninguém olha a blockchain na Ferrari | Gemini, DeepSeek, Kimi | 🔴 |
| P2.10 | **Replay histórico (walk-forward)** — rodar os agentes sobre 3-6 meses de klines passados | Flywheel é forward-only (semanas); replay dá baseline rápido + detecta overfit | Kimi, DeepSeek, GPT | 🔴 |
| P2.11 | **Circuit breaker de provedor** — após N falhas, remove o modelo da orquestração + alerta | Resiliência: DeepSeek/Kimi têm outages; hoje só degrada silencioso | DeepSeek, Kimi | 🔴 |
| P2.12 | **Budget cap com auto-kill** — desabilitar agente de baixa prioridade se passar do teto $/dia | Hoje o alerta existe mas não corta | Gemini, DeepSeek, Kimi | 🔴 |

### Planejado / data-gated
| ID | Item | Status |
|----|------|--------|
| Z7 | Trocar `SCORE_WEIGHTS` à mão por pesos aprendidos do ledger (**regressão logística ou GBM simples** + **walk-forward validation** pra não overfitar) | ⏸️ pós-dados (11/07+) |
| — | Política de retenção/partição do `zion_suggestions` (crescimento) | ⏸️ quando o volume pedir |

### ❌ Não fazer agora (com motivo)
| Item | Motivo |
|------|--------|
| ❌ Adicionar 10+ indicadores (SuperTrend/VWAP/Ichimoku…) | Correlacionados, retorno decrescente. A alavanca é calibração/on-chain/risco, não mais indicador (Gemini/DeepSeek/Kimi concordam) |
| ❌ Geo-routing granular GDPR/EU-edge agora | Prompts têm só dado de mercado, ZERO PII → risco baixo (o próprio DeepSeek admite). Feature de venda, não requisito duro |
| ❌ Storm mode / dedup por correlação no radar | Inteligente mas P3, otimização prematura antes de validar o básico |

---

## 2. O que foi implementado NESTA rodada ✅

**P0.1, P0.2, P0.3 + P1.4, P1.5, P1.6, P1.7 — TODOS 🟢 entregues.** O flywheel
agora é **honesto de verdade** antes de acumular dados: expectancy líquida de
custo, Grok vendo o X real, CEO com fallback, resolução 5min, amostra ≥100,
expired separado de win/loss, e cada evento carimbado com a versão do prompt.
`npx tsc --noEmit` limpo.

**Arquivos tocados:**
- `src/lib/zion/foundation.ts` — `ZION_FOUNDATION_VERSION`
- `src/lib/zion/backtest.ts` — cost/sample consts, `expired`, `expectancyNet`,
  `signalRate`, `sufficientSample`, `GROK_SEARCH_BODY`, fallback do CEO, stamping
- `src/lib/ai/provider.ts` — `extraBody` no `ChatRequest` + spread no fetch
- `src/app/admin/api/backtest/route.ts` — `expectancyNet`/`expired`/`sufficientSample`
- `src/components/admin/panels/BacktestPanel.tsx` — headline NET + ⚠ amostra pequena

**Deixar pra próxima rodada:** P2 (portfólio, on-chain, replay, circuit breaker,
budget cap) e Z7 (data-gated pós-11/07).

> ⚠️ **Pré-11/07 (antes de ligar `HYBRID_B_ENABLED`):** confirmar preço real do
> Opus 4.8 e alinhar `ai-cost.ts` (doc diz $5/$25, código tem tier $15/$75).
