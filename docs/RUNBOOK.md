# RUNBOOK — Operação Z-SWAP

> Referência operacional única: todas as env vars, os crons, e o playbook de
> incidente. Gerado na rodada de melhorias da auditoria (M5, 2026-07-02).
> Atualizar quando uma env var nascer ou morrer.

---

## 1. Env vars (Vercel → Settings → Environment Variables)

### Núcleo / infra
| Var | O que é | Default se ausente |
|-----|---------|--------------------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Banco (server-only; service key NUNCA vira NEXT_PUBLIC) | app roda sem DB (best-effort) |
| `SUPABASE_ANON_KEY` | Realtime broadcast do painel admin | realtime off |
| `AUTH_JWT_SECRET` | Sessão por carteira assinada | login quebra |
| `CRON_SECRET` | Bearer dos 3 crons (backtest/autopilot/radar) | crons retornam 401 |
| `ADMIN_WALLETS` | Allowlist de carteiras admin (CSV) | só tier_cache source=admin entra |
| `HELIUS_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC` | RPC Solana | RPC público (lento) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alertas Odin | alertas mudos |
| `AUTOPILOT_ENC_KEY` | Cripto das credenciais CEX server-side | autopilot background off |
| `LIFI_API_KEY`, `ZEROX_API_KEY`, `TRANSAK_*` | Agregadores/on-ramp | fallbacks/feature off |
| `ZSWAP_COLLECTION_ADDRESS` | Coleção NFT (launch) | mint gate off |
| `NEXT_PUBLIC_SITE_URL`, `BASE_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Site/SEO/wallets | — |

### IA — Anthropic (Agent A + CEO)
| Var | O que é | Default |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | Chave única (Sonnet + Opus) | toda análise ZION off |
| `ZION_MODEL` | Modelo primário do ZION | `claude-sonnet-4-6` |
| `ZION_FALLBACK_MODEL` | Fallback N1 | `claude-haiku-4-5-20251001` |
| `HYBRID_ORCH_MODEL` | CEO da Ferrari | `claude-opus-4-8` |
| `HYBRID_ORCH_FALLBACK_MODEL` | Fallback do CEO | `ZION_MODEL` |
| `HYBRID_B_ENABLED` | Master do Agent B (`true` liga) | **off** (ligar pós-11/07) |
| `NARRATIVES_MODEL` | Clustering de narrativas | — |

### IA — provedores diretos (torneio + especialistas)
Cada provedor: `<X>_API_KEY` (liga), `<X>_BASE_URL`, `<X>_MODEL` (opcionais).
`DEEPSEEK_*` · `KIMI_*` · `MISTRAL_*` · `LLAMA_*` · `XAI_*` (Grok).
Sem chave = provedor simplesmente ausente (dormente, sem erro).

### Flywheel / medição
| Var | O que é | Default |
|-----|---------|---------|
| `BACKTEST_COST_PCT` | Custo round-trip descontado da expectancy | `0.2` (%) |
| `BACKTEST_MIN_SAMPLE` | Amostra mínima confiável | `100` |
| `BACKTEST_RESOLVE_INTERVAL` | Velas da resolução | `5m` |
| `BACKTEST_REGIME_FILTER` | Gate de regime no ledger (RANGING = nada; contra-tendência confirmada = rejeita). `off` desliga | on |
| `BACKTEST_MIN_RR` | Reward:risk mínimo do bracket no ledger | `2` |
| `ARB_DAILY_CAP` | Round-trips/dia do arbiter (universo ~55 símbolos) | `40` |
| `TOURNAMENT_CULL` | Corte automático de agente no vermelho com amostra (`culled:<source>` no admin_kv; apagar a chave = anistia) | on |
| `PAPER_CHAMPION_MULT` | Multiplicador de posição do campeão no paper | `2` |
| `SNIPER_MIN_RR` | RR mínimo do sniper (alinhado ao ledger) | `2` |
| `RADAR_TRIGGER_PCT` | Gatilho do radar T3 | `1.5` (%) |
| `TIER_GATES_ENABLED` | Gate de tier no ZION user-facing (M7 — ligar pré-marketing) | off |

### Watchdog / proteção
| Var | O que é | Default |
|-----|---------|---------|
| `ALERT_AI_BUDGET_USD` | Alerta de custo IA 24h | `20` |
| `ALERT_AI_KILL_USD` | **Auto-pausa** o torneio acima disso (0 = off) | `30` |
| `AI_CB_THRESHOLD` | Falhas seguidas p/ tripar o breaker | `3` |
| `AI_CB_COOLDOWN_MIN` | Cooldown do breaker | `60` min |
| `ALERT_ERROR_SPIKE` / `ALERT_SEC_FLOOD` / `ALERT_LARGE_OP_USD` | Limiares de alerta | `10` / `5` / `5000` |

---

## 2. Crons (cron-job.org — fonte ÚNICA de agendamento)

| Endpoint | Cadência | Auth | Stall alert |
|----------|----------|------|-------------|
| `POST /api/autopilot/cron` | 5 min | header `Authorization: <CRON_SECRET>` (com ou sem `Bearer `) | >12 min |
| `POST /api/zion/backtest` | 30 min | idem | >75 min |
| `POST /api/radar` | 1 min | idem | >5 min |

GitHub Actions: `schedule` DESATIVADO nos dois workflows (só `workflow_dispatch`
manual). NÃO reativar sem desligar o cron-job.org — daria tick duplicado.

---

## 3. Playbook de incidente

**"AI model down — auth rejected/no credits" (Telegram)**
1. O note agora distingue: `no credits / billing` → recarregar no console do
   provedor; `auth rejected` → conferir a chave na Vercel.
2. O circuit breaker já parou de martelar o provedor (pula por 60min).
3. Consertou? Painel admin → AI CONTROLS → CIRCUIT BREAKERS → **RESET**.
4. Não quer usar o provedor agora? AI CONTROLS → TORNEIO **OFF**.

**"Cron stalled" (Telegram)**
1. cron-job.org → conferir se o job disparou e o status HTTP.
2. 401 = `CRON_SECRET` divergente. Timeout do pinger é normal (rota responde
   em <1s com waitUntil; se o pinger diz timeout mas o heartbeat anda, ignora).
3. Heartbeat visível em SYSTEM HEALTH no painel.

**"AI budget KILL — tournament AUTO-PAUSED"**
1. Ver FINANCE (estimativa) e o console dos provedores (real).
2. Foi legítimo (rodada cara)? subir `ALERT_AI_KILL_USD` e religar o torneio.
3. Foi loop/bug? investigar `platform_events` antes de religar.

**Backtest com 0 cards / expectancy estranha**
1. BACKTEST panel → aba FEED: tem sugestão nova? status?
2. Suspeita de preço podre → conferir `ref_price` das linhas novas vs mercado.
3. Guardas ativas: escala >25% off = rejeitado; R:R<1 = rejeitado; vela 5min;
   stop-first pessimista. Tudo coberto por testes (`npm test`).

**Deploy quebrado**
1. CI roda lint + type-check + testes em todo push no main — ver a aba Actions.
2. Rollback: Vercel → Deployments → promote no anterior.

---

## 3b. Erros de cliente (telemetria)

Crashes de browser (`window.onerror` / `unhandledrejection`) são enviados a
`/api/telemetry/error` (5/min/IP, máx 5 por page-load, campos whitelisted) e
caem em `platform_events` como `error` com `meta.source = "client"` — visíveis
no painel LOGS & SECURITY e cobertos pelo alerta de error-spike do watchdog.
**Upgrade opcional:** instalar `@sentry/nextjs` + DSN quando quiser stack
traces agrupados/sourcemaps; o reporter atual é deliberadamente leve (zero deps).

## 4. Comandos úteis

```bash
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm test             # vitest (money-math)
```
