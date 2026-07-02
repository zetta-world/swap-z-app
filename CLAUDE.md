# Z-SWAP — mapa do repo

DEX aggregator multi-chain (Solana + ~10 EVM) com assistente de trading IA
(ZION), arquitetura multi-modelo ("Ferrari"), flywheel de backtest sombra e
painel admin tipo terminal. Next.js 14 App Router · Supabase (Postgres) ·
Vercel serverless · TypeScript estrito.

## Onde está cada coisa

| Área | Caminho |
|------|---------|
| ZION núcleo (prompt, backtest/flywheel, radar, modelos) | `src/lib/zion/` (`foundation.ts`, `backtest.ts`, `radar.ts`, `model.ts`, `parse.ts`, `card-mapping.ts`) |
| Seam de provedores IA (Anthropic + OpenAI-compat) | `src/lib/ai/provider.ts` · registry/geo-routing `src/lib/ai/registry.ts` · circuit breaker `src/lib/ai/circuit.ts` |
| Indicadores de mercado (RSI/MACD/ATR/ADX, regime, score) | `src/lib/api/market-indicators.ts` |
| Guarda de dinheiro do autopilot | `src/lib/autopilot/price-guard.ts` |
| Admin: watchdog/alertas, custo IA, gates, health | `src/lib/admin/` |
| Crons (auth `CRON_SECRET`, timing-safe) | `src/app/api/autopilot/cron` (5min) · `src/app/api/zion/backtest` (30min) · `src/app/api/radar` (1min) — agendados no cron-job.org, NÃO no GitHub Actions |
| Rotas admin (todas com `requireAdmin`, 404 nunca 403) | `src/app/admin/api/*` |
| Painéis do terminal admin | `src/components/admin/panels/*` + registro em `src/lib/admin/modules.ts` + `DashboardClient.tsx` |
| Migrations (RLS default-deny: habilitada, ZERO policies de propósito) | `supabase/migrations/` |
| i18n — SEMPRE 4 locales (en/pt/es/zh) | `src/lib/i18n/messages.ts` |
| Nav (única fonte: sidebar/mobile/⌘K) | `src/components/layout/nav-items.ts` |

## Regras que este repo segue

- **Documentar ANTES de implementar**: todo trabalho começa num plano em
  `docs/PLANO-*.md` com status (🔴/🟡/🟢/⏸️) atualizado a cada entrega.
- **Best-effort em volta de dinheiro**: falha de DB/API nunca derruba o caller;
  mas o caminho de dinheiro (ordens) FALHA FECHADO (sem preço de referência =
  rejeita). Ver `price-guard.ts` e os gates em `extractSuggestion`.
- **Flywheel honesto**: expectancy LÍQUIDA de custo, `expired` ≠ win/loss,
  amostra mínima, guarda de escala, stop-first pessimista. Não "melhorar"
  números sem entender esses filtros — eles existem por cicatriz.
- **Saída de cards**: JSON `{"cards":[...]}` (schema forçado nos caminhos
  Anthropic; `extractCards` tem fallback triplo). O streaming user-facing ainda
  usa blocos `[[ACTION]]`.
- **admin_kv** é o KV de operação: kill-switches, gates (`pause_*`), breaker
  (`cb:<id>`), locks (`lock:*`), refs do radar, dedup de alertas.
- **Segredos só em `process.env`** server-side; service key nunca em
  `NEXT_PUBLIC_*`. Zero segredo hardcoded (auditado).

## Comandos

```bash
npm run dev · npm run build · npm run lint · npm run type-check · npm test
```
CI (`.github/workflows/ci.yml`) roda lint + type-check + testes em todo push.

## Referências

- Env vars + playbooks de incidente: `docs/RUNBOOK.md`
- Arquitetura IA completa: `docs/ARQUITETURA-IA.md`
- Índice de docs (vivos vs históricos): `docs/README.md`
- Auditoria + notas: `docs/AUDITORIA-GERAL.md`
