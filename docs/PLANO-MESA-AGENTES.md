# Plano — A Mesa de Agentes (um agente polido por tipo de análise)

> **CEO (14/07):** "o sniper cobre só um tipo; temos outros tipos de análise e
> cada um precisa do seu agente polido." Este doc é o mapa da mesa. As lições
> dos 1.870 decididos valem pra TODOS: gatilho objetivo > relógio, licença pra
> recusar, orçamento, gates em código (nunca a auto-confiança do modelo),
> medição automática (ledger + paper) antes de qualquer dinheiro real.

## A mesa

| Desk | Tipo de análise | Gatilho | Cérebro | Status |
|------|-----------------|---------|---------|--------|
| **D1 Sniper 🎯** | Swing direcional (buy/sell com bracket) | Evento de preço (radar) | LLM barato + gates trend/R:R/orçamento | 🟢 F1 entregue (PR #128), ⏸️ pausado |
| **D2 Arbiter ⚖️** | Arbitragem cross-CEX (spread entre exchanges) | Spread > custos (aritmética, 1min) | **NENHUM LLM** — detecção é matemática pura; IA não agrega em aritmética | 🟢 F1 nesta entrega, ⏸️ pausado |
| **D3 Executor 🤖** | Autopilot CEX (dinheiro REAL do usuário) | Sessão armada + scan | Sonnet + disciplina sniper portada: regime ADX no payload, orçamento visível (`trades_remaining_today`), e **gate duro em código** — BUY só em `TRENDING_UP`, fail-closed sem regime; exits nunca gateados | 🟢 F1 entregue — dormente (0 sessões armadas), ativa no launch |
| **D4 Advisor 🧭** | ZION user-facing (chat/análise de portfólio) | Pergunta do usuário | Sonnet + modos existentes | ⏸️ polir quando houver usuários (métrica = satisfação, não P&L) |
| — Radar 📡 | Não é desk: é o SENSOR da mesa (detecção grátis de eventos) | — | — | 🟢 rodando (detecção); brain-wake pausado |

## D2 — Arbiter (esta entrega)

**Por que zero LLM:** spread entre exchanges é `(maior − menor) / menor`. Modelo
de linguagem não melhora conta de padaria — só adiciona custo e alucinação. O
"polimento" aqui é justamente REMOVER a IA do loop e deixar só as regras:

```
getMultiExchangeSpot (Binance/Coinbase/Gate/OKX/Bybit/Kraken/MEXC, público, grátis)
        ▼ a cada tick do radar (1min)
spread líquido = spread% − ARB_COST_PCT (0.4% = 2 pernas taker + slippage)
        ▼ só passa se líquido ≥ ARB_MIN_NET_PCT (0.15%)
cooldown 30min por símbolo + teto diário (ARB_DAILY_CAP=20)
        ▼
paper wallet 'Arbiter ⚖️': round-trip INSTANTÂNEO (compra no barato, vende no
caro) — P&L realizado na hora, curva de equity no painel PAPER automaticamente
```

Honestidade do modelo: paper de arb assume execução simultânea nas 2 pernas ao
preço observado — otimista (sem risco de perna, sem depth). Por isso o custo
carrega buffer e o F2 valida contra orderbook antes de qualquer conversa real.

## Regras da casa (herdam pra todos os desks)
- Nasce PAUSADO (gate próprio no AI Controls); CEO liga quando quiser.
- Mede no paper antes de tocar dinheiro; MIN_SAMPLE antes de conclusão.
- Fail-closed em tudo (sem preço/regime = não opera).
- Probabilidade declarada por LLM é logada, NUNCA é filtro (invertida, provado).

## Fases
- F1 D2 Arbiter: detector puro + wire no radar + gate `pause_arbiter` + carteira paper + testes — 🟢 PR #129 · **LIGADO 14/07** (zero token)
- F2 D2: validação com orderbook (depth real) se o paper der positivo — 🔴
- F1 D3 Executor: disciplina sniper no autopilot — regime no payload + prompt de escassez + gate duro BUY-só-em-uptrend no cron — 🟢 (dormente até sessões armarem; todas as mudanças só REDUZEM risco)
- F1 D4 Advisor: revisão dos mode-prompts com as lições (sem cobertura forçada) — 🔴 depois
