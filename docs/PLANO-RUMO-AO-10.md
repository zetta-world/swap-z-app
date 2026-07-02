# Plano — Rumo ao 10 (pós-auditoria)

> **Origem:** pergunta do CEO "o que fazer para deixar as notas o mais próximo
> possível de um 10?" + aprovação para executar. 3 rodadas de código puro
> (sem custo de token, sem dependência de dados). O caminho além disso é
> data-gated (11/07+) ou de terceiros (pentest, legal).
> **Gerado:** 2026-07-02. Documento vivo — atualizar Status a cada entrega.

**Legenda:** `🔴 pendente` · `🟡 em andamento` · `🟢 feito` · `⏸️ gated`

## RODADA 1 — maior retorno

| ID | Item | Detalhe | Status |
|----|------|---------|--------|
| R1.1 | **Structured outputs nos cards do flywheel** | Agent A + CEO (Anthropic): JSON schema FORÇADO via `output_config` — elimina card malformado por construção. Torneio/brain (OpenAI-compat): prompt pede objeto JSON + parser tolerante com fallback triplo (JSON puro → JSON embutido em prosa → legado `[[ACTION]]`). Sem mudança de wire-format nos provedores diretos (evita 400 em provedor sem suporte). Bump `ZION_FOUNDATION_v2` (formato de saída muda a linhagem do prompt) | 🟢 `SCAN_CARDS_SCHEMA` + `extractCards` em `backtest.ts`, `jsonSchema` no seam (`provider.ts`), 4 testes |
| R1.2 | **Testes: price-guard + matemática dos indicadores** | `checkRealNotional` (o guardião do dinheiro real) + propriedades de sanidade de RSI/EMA/MACD/ATR/ADX (série subindo → RSI→100, ATR de range constante = range, etc.). Exporta os `calc*` p/ teste | 🟢 16 testes novos (suite total: 46) |
| R1.3 | **Lock de idempotência no tick do backtest** | Retry do pinger hoje pode rodar o scan 2x (= gasto 2x). Lock em `admin_kv` com TTL 3min (retries do cron-job.org são sequenciais ~30s) | 🟢 `acquireTickLock` na rota; responde `skipped: duplicate_tick` |
| R1.4 | **Telemetria de erro de cliente** | `window.onerror` + `unhandledrejection` → rota rate-limited → `platform_events` (pipeline existente: painel LOGS & SECURITY + alerta de error-spike do watchdog). Decisão: SEM SDK Sentry por ora (dependência pesada, dormente sem DSN); Sentry documentado como upgrade opcional no RUNBOOK | 🟢 `/api/telemetry/error` (5/min/IP, campos whitelisted) + `ClientErrorReporter` no layout raiz |

## RODADA 2 — segurança/postura

| ID | Item | Status |
|----|------|--------|
| R2.1 | Security headers no `next.config` (CSP, HSTS, X-Frame-Options, Referrer-Policy) | 🟢 **JÁ EXISTIA** — CSP completa + HSTS preload + COOP/COEP + Permissions-Policy (a auditoria subestimou; nota de segurança revisada pra cima) |
| R2.2 | Dependabot + `npm audit` no CI | 🟢 `.github/dependabot.yml` (semanal, agrupado) + step `npm audit --audit-level=high` (warn, não bloqueia) |
| R2.3 | RLS: fechar gap + documentar default-deny | 🟢 aplicado no banco vivo em 02/07 e VERIFICADO: 13/13 tabelas com `rowsecurity=true` (migration `0014` no repo) |
| R2.4 | Filtro por agente (source) no painel BACKTEST | 🟢 `?source=` na rota (whitelist regex) + chips ALL/A·ZION/B·FERRARI/RADAR/modelos no painel |

## RODADA 3 — docs/qualidade

| ID | Item | Status |
|----|------|--------|
| R3.1 | `CLAUDE.md` na raiz (mapa do repo p/ qualquer dev/IA futuro) | 🟢 |
| R3.2 | Poda/arquivamento de docs obsoletos + diagrama Mermaid no ARQUITETURA-IA | 🟢 `docs/README.md` (índice vivos × históricos) + Anexo B (diagrama) |
| R3.3 | Golden set de avaliação de prompts (~20 cenários; rodar a cada mudança de prompt) | 🟢 `docs/GOLDEN-SET.md` (20 cenários + propriedades checáveis) · execução ⏸️ pós-crédito (~$0.15) |
| R3.4 | Polimento mobile dos painéis admin | ⏸️ preciso de prints do CEO dos painéis que quebram no celular — mudar CSS às cegas sem verificação visual é risco, não melhoria |

## Fora de código (o resto do caminho até 10)
- ⏸️ Dados 11/07+: Z7 calibração, P2.8 portfólio, P2.10 replay, decisão A/B/torneio.
- ⏸️ Terceiros: pentest pré-launch, revisão legal (NFT-BRIEFING §7), branch protection no GitHub (config manual do CEO: Settings → Branches → exigir CI verde).
- ⏸️ M7 tier gate (decisão de negócio pré-marketing) · M8 Sonnet 5 A/B (pós-crédito).
