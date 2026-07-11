# Plano — Agente autônomo de paper trading na Gate.io

> **Pedido do CEO (11/07):** pôr um agente autônomo operando em teste simulado
> pela Gate.io. Requer "backend correto". **Regra dura:** não perder nada do que
> já foi feito nem apagar dados coletados. Status vivo (🔴 pendente / 🟡 em curso
> / 🟢 feito).

## Decisões (CEO, 11/07)
- **Preço de fill:** preço REAL vivo da Gate.io (API pública, sem chave).
- **Cérebro:** reaproveitar os sinais do flywheel (`zion_suggestions`) — zero
  token novo; o agente só EXECUTA em paper o que os agentes de IA já decidem.

## Princípio de isolamento (segurança)
O autopilot de dinheiro real (`autopilot_sessions/positions/runs`, `placeCexOrder`,
`/api/cex/order`) **NÃO é tocado**. O paper trading é um subsistema separado:
tabelas novas, módulo novo, sem chave de exchange, sem ordem real. `zion_suggestions`
é lido, nunca escrito. Assim, impossível quebrar o caminho de dinheiro ou perder dado.

## Arquitetura
```
zion_suggestions (READ-ONLY)  →  engine paper  →  fill vs preço vivo Gate.io
   sinal por agente                 (sem chave/ordem real)
        │                                   │
        ▼                                   ▼
  paper_accounts (carteira virtual/agente) + paper_positions (posições + P&L)
        │
        ▼
  placar de PORTFÓLIO por agente: quanto cada IA ganharia de fato
```
**Uma carteira paper por `source`** (self_scan/mistral/grok/deepseek/kimi/radar),
mesmo capital inicial → curva de patrimônio real por agente.

## Fases
| Fase | Item | Status |
|------|------|--------|
| F1.1 | Migration aditiva `0015_paper_trading.sql`: `paper_accounts` + `paper_positions`, RLS default-deny (0 policies), índices. Só `CREATE TABLE IF NOT EXISTS`. | 🟢 aplicada; `zion_suggestions` intacto (1069→1069) |
| F1.2 | Engine `src/lib/paper/engine.ts`: `openPaperPositions()` (lê sinais novos, size por caixa×risco, fill no preço vivo Gate.io, debita caixa) + `resolvePaperPositions()` (target/stop vs preço vivo, realiza P&L, credita caixa). Custo round-trip via `BACKTEST_COST_PCT`. | 🟢 |
| F1.3 | Testes vitest do engine (fill, target, stop, expiração, contabilidade da caixa). | 🟢 11 testes (63 total) |
| F1.4 | Wire no cron de backtest (`waitUntil`, após resolve) atrás de `pause_paper`. Seed das 6 contas por agente ($1000 cada). | 🟢 **começa PAUSADO** (`pause_paper=true`) até o CEO liberar |
| F2 | Painel admin: curva de patrimônio + posições abertas por agente; linha no digest Telegram. | 🔴 |
| F3 | Tuning: sizing, slippage/fees, múltiplas contas, ledger `operations`. | 🔴 |

## Reaproveitado (não recriar)
- Gate.io: ccxt `gateio` + `fetchGateIo` (`cex-spot.ts:223`) + metadata.
- Sinais: `zion_suggestions` (`0012`), entry/target/stop/probability/source.
- Preço vivo: `getCexSpotPrices` / `fetchCexOrderbook` (público).
- Resolução target/stop: padrão de `backtest.ts::resolveOne`.
- Custo: `BACKTEST_COST_PCT` (mesma régua do flywheel).

## NÃO tocar
`src/app/api/autopilot/**`, `src/lib/autopilot/**`, `src/lib/cex/server.ts`
(placeCexOrder/withdraw), tabelas `autopilot_*`, `zion_suggestions` (só SELECT).
