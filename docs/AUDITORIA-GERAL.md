# Auditoria Geral — IA, Automação, Painel, Segurança e Docs

> **Escopo:** auditoria direta do código (29 verificações) sobre tudo referente a
> automação, ZION, análises, agentes e painel de controle + todos os .md do repo.
> **Gerado:** 2026-07-02. Notas honestas, sem inflar.

---

## 1. NOTAS POR ÁREA

| Área | Nota | Resumo honesto |
|------|------|----------------|
| **Núcleo IA / flywheel** (ZION, backtest, Ferrari, radar) | **8.5** | Matemática Wilder CORRETA (RSI/ATR/ADX com seed SMA + suavização recursiva verificados). Path-replay honesto, expectancy líquida, guards de escala/geometria, circuit breaker, version stamping. Falta: calibração (Z7, data-gated) e ZERO testes unitários na matemática. |
| **Automação / crons** | **8.0** | Auth consistente (`timingSafeEqual` nos 3 crons), heartbeats, gates, locks, workflows GitHub corretamente desativados (sem double-fire). Fraqueza: cron-job.org é ponto único de agendamento. |
| **Painel admin** | **8.5** | **Zero rotas sem `requireAdmin`** (verificado uma a uma). 404 em vez de 403 (não revela existência), audit log, intrusion logging, realtime só via broadcast (anon key sem acesso a tabela). Falta: visibilidade do circuit breaker no painel. |
| **Segurança** | **8.0** | Zero segredos hardcoded (varredura por padrões de chave). Service key só server-side. RLS habilitada em TODAS as tabelas sensíveis **sem nenhuma policy = default-deny** (anon não lê nada; tudo via rotas). Rate limit durável (Postgres) nas rotas caras. Prompt sanitization na rota ZION. |
| **Docs / planos** | **7.5** | Ricos, datados, com legenda de status e índice de ideias estacionadas. Contradição conhecida: Opus $5/$25 (2 docs) vs $15/$75 (`ai-cost.ts`) — já flagada pra resolver pré-11/07. Falta: runbook de incidente + referência central de env vars. |
| **Higiene de engenharia** | **5.5** | ⚠️ A pior nota, com razão: **ZERO testes automatizados** no repo inteiro e **zero CI** (nenhum workflow roda lint/type-check/test em push). Pra código que mexe com dinheiro (parsePrice, extractSuggestion, resolveOne, price-guard) isso é o maior risco real do projeto. `tsc --noEmit` limpo e lint configurado — mas nada roda automaticamente. |
| **GERAL** | **8.0** | Plataforma sólida e honesta pro estágio. O que separa de um 9: testes+CI, visibilidade do breaker, e as pendências data-gated. |

---

## 2. ACHADOS PRINCIPAIS (com evidência)

### ✅ Confirmado sólido
- `requireAdmin` em 100% das rotas admin; wallet por sessão assinada + allowlist env + tier_cache source=admin; probe de intruso logado como high-severity.
- RLS default-deny: `enable row level security` em users/auth_nonces/tier_cache/autopilot_*/market_brain/zion_suggestions/admin_audit_log/operations, **0 policies** → anon bloqueado por padrão (service role bypassa, só no server).
- Sem `.env` commitado (só `.env.example`); sem chave em código.
- Rate limit ZION: 8 req/min/IP durável; CEX order/withdraw também.
- Wilder math correta; `horizon_hours` tem default 72 no schema (resolveOne nunca vê null).
- Workflows GitHub com `schedule:` comentado — sem duplicidade com cron-job.org.

### ⚠️ Ambiguidade "auth rejected" (o caso Grok/Kimi)
`pingOpenAICompat` rotula **qualquer 401/403 como "auth rejected — check key"**
(`health.ts`). A xAI retorna **403 também quando o time está SEM CRÉDITO** — ou
seja, a teoria do CEO (chave certa, crédito faltando) é plausível e o health
check não distingue os dois casos. → Melhoria M2.

### ⚠️ Custo silencioso: foundation inteira pra cada especialista
`ZION_FOUNDATION` (~15,7KB ≈ ~4k tokens) vai como system em TODA chamada
OpenAI-compat (torneio + especialistas da Ferrari), sem cache. Macro/sentiment
não precisam do schema de action-card. → Melhoria M3.

### ⚠️ Rota ZION aberta enquanto tier gates dormentes
Comentário no código confirma: gates dormentes = ZION user-facing 100% aberto.
Mitigado pelos 8 req/min/IP, mas qualquer anônimo queima token Anthropic.
Aceitável AGORA (sem marketing rodando); apertar antes de divulgar. → M7.

### ℹ️ Menores
- Suprimento NFT docs↔código batem (1.500/500/50; SOL_USD_REF 145 com ⚠️ de re-confirmar no mint).
- Env vars citadas nos docs existem todas no código (HYBRID_B_ENABLED, BACKTEST_COST_PCT, ALERT_AI_KILL_USD, AI_CB_THRESHOLD…).
- `modelChain` default: sonnet-4-6 → haiku-4-5. Sonnet 5 já existe; vale A/B via `ZION_MODEL` quando o crédito voltar.

---

## 3. MELHORIAS RECOMENDADAS (priorizadas, nenhuma depende de dados)

| # | Melhoria | Por quê | Esforço |
|---|----------|---------|---------|
| M1 | **Testes + CI** — unit tests pra `parsePrice`, `extractSuggestion`, `resolveOne`, `getBacktestStats`, price-guard; workflow rodando lint+type-check+test em cada push | Único pilar nota <6; código de dinheiro sem rede de proteção contra regressão | médio |
| M2 | **Health ping distinguir "sem crédito" vs "chave inválida"** — capturar trecho do body do 401/403 no note | Resolve exatamente a confusão Grok/Kimi do CEO | baixo |
| M3 | **System prompt enxuto por papel** pros especialistas (macro/sentiment) em vez do foundation inteiro | Corta ~4k tokens/chamada e melhora foco | baixo |
| M4 | **Estado do circuit breaker no painel** (AI Controls ou System Health): tripado/cooldown/reset manual | Hoje o breaker age invisível; operador só sabe pelo Telegram | baixo |
| M5 | **Runbook + referência de env vars** em docs/ | 30+ env vars espalhadas; onboarding e incidente dependem de memória | baixo |
| M6 | **Alinhar preço Opus no `ai-cost.ts`** quando confirmar o real (pré-11/07) | Estimativa do FINANCE 3x errada pra cima ou pra baixo | trivial |
| M7 | **Ligar tier gate do ZION** (ou exigir carteira conectada) antes de qualquer marketing | Token Anthropic aberto a anônimo | trivial (flag) |
| M8 | **A/B claude-sonnet-5 vs 4-6** via `ZION_MODEL` pós-crédito | Modelo primário está uma geração atrás | trivial (env) |

---

## 4. Honestidade sobre o escopo
Auditei por amostragem dirigida (29 verificações nos pontos de maior risco), não
linha-a-linha literal dos ~200 arquivos — auditoria exaustiva de UI component a
component não caberia numa sessão e teria retorno marginal. O que NÃO foi
auditado a fundo: componentes visuais das ~20 views de usuário, o fluxo
completo de wallet-signing, e os textos i18n em massa. Nada nesses grupos toca
dinheiro ou segredo diretamente.
