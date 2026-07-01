# Plano de Ação — Orquestração Híbrida Multi-Modelo (ZION)

> **Branch:** `feature/hybrid-ai-orchestrator` (NUNCA em `main` até validado)
> **Gerado em:** 2026-06-30
> **Status:** 🟡 PLANO — aguardando revisão do founder antes de codar
> **Princípio-mãe:** custo baixo no trabalho braçal, qualidade de fronteira só
> onde move dinheiro, com soberania de dado por jurisdição.

**Legenda:** `🔴 não iniciado` · `🟡 em andamento` · `🟢 concluído` · `⏸️ deferido`

---

## 0. Objetivo

Transformar o ZION de **um modelo único (Claude Sonnet)** em uma **orquestração
híbrida multi-modelo** que:
1. **Reduz custo** movendo o trabalho de alta frequência pra modelos baratos.
2. **Mantém qualidade** reservando modelos de fronteira pras decisões que movem
   dinheiro real.
3. **Respeita soberania de dado** roteando por jurisdição do usuário.
4. **Mede tudo** — nenhuma migração de modelo sem o A/B provar que mantém o edge.

**Meta de custo:** sair de ~$70-100/mês (tudo Sonnet) pra ~$15-40/mês na fase de
teste, com teto controlado conforme escala.

---

## 1. Arquitetura — 3 tiers por valor em jogo

| Tier | Papel | Frequência | Modelo (proposto) | Por quê |
|------|-------|-----------|-------------------|---------|
| **T3 — Radar de preço** | Vigia preço/gatilho | contínuo | **SEM IA** (WebSocket da corretora) | Não pagar token pra olhar preço; código determinístico acorda o LLM |
| **T2 — Braçal / macro** | Scan de mercado, digestão de docs, sentimento | alta (5-15 min) | **DeepSeek V4** (quant) · **Kimi K2.6** (docs, 256K ctx) · **Grok 4.3** (sentimento X) | Baratos; trabalho de volume |
| **T1 — Decisão final** | Tese final + monta ordem + risco | rara (só em trade real) | **Claude Opus 4.8** (orquestrador/tool-use) · **GPT-5.5** (risco/math) | Fronteira só onde o dinheiro entra |

> **Regra de ouro #1 — LLM PROPÕE, CÓDIGO DISPÕE.** Nenhum LLM (nem o GPT-5.5)
> é a autoridade final do risco. O LLM gera tese e níveis propostos; a
> **matemática dura** (notional cap, sizing, R:R, distância de liquidação) fica
> em código determinístico — o `price-guard` que já existe. Lembrar do bug do
> LINK a 1000x: LLM erra escala/aritmética.

> **Regra de ouro #2 — VALIDAR EDGE ANTES DE MIGRAR DINHEIRO.** Custo é
> downstream do lucro. Só troca o modelo de um caminho de dinheiro real depois
> que o A/B provar (expectancy, não $/token) que o modelo mais barato mantém o
> edge.

---

## 2. Provedores — DIRETO DA FONTE (sem OpenRouter) ✅ IMPLEMENTADO

**Decisão revista:** cada modelo direto do vendor (sem OpenRouter). Sem taxa de
5.5%, sem intermediário, controle total. Todos são OpenAI-compatible → compartilham
`openaiCompatChat` com base URL diferente. Implementado em `src/lib/ai/registry.ts`.

| Provider | Origem | Env key | Base URL (default) | Cadastro da API |
|----------|--------|---------|--------------------|-----------------|
| **DeepSeek** | 🇨🇳 china | `DEEPSEEK_API_KEY` | `api.deepseek.com` | platform.deepseek.com |
| **Kimi** (Moonshot) | 🇨🇳 china | `KIMI_API_KEY` | `api.moonshot.ai/v1` | platform.moonshot.ai |
| **Mistral** | 🇫🇷 western | `MISTRAL_API_KEY` | `api.mistral.ai/v1` | console.mistral.ai |
| **Llama** (Meta) | 🇺🇸 western | `LLAMA_API_KEY` | `api.llama.com/compat/v1` | llama.developer.meta.com |

Model id / base URL são **env-overridáveis** (`*_MODEL`, `*_BASE_URL`) — os vendors
trocam versão direto. Claude fica **direto na Anthropic** (preserva o cache). Cada
provider é **dormente até a env key existir**.

---

## 3. Geo-routing por jurisdição ✅ IMPLEMENTADO

O sistema detecta o **país do acesso** (header `x-vercel-ip-country`, nativo do
Vercel) e escolhe o stack sozinho — `regionForCountry()` em `registry.ts`:

| Região | Países | Stack |
|--------|--------|-------|
| **`china_ok`** | Brasil, LatAm, resto sem sanção | 🇨🇳 **DeepSeek → Kimi** (mais baratos) |
| **`western`** | EUA + aliados (Five Eyes, UE/EEA, JP/KR/TW) | 🇺🇸🇫🇷 **Mistral → Llama** (origem ocidental) |

- **Fail-safe:** país desconhecido/ausente → **western** (nunca manda dado pra
  modelo de origem china sem confiança na jurisdição).
- Lista `WESTERN_ALIGNED` em `registry.ts` — fácil estender conforme a política.
- `providerForCountry()` retorna o 1º provider **configurado** (com key) da região;
  `callGeoModel()` chama o modelo certo automaticamente.

**Plus competitivo:** "roteamento por jurisdição do cliente" = argumento enterprise.

> **Regra de ouro #2 aplicada:** o geo-routing está CONSTRUÍDO e o flywheel A/B
> mede todos os modelos. O **flip do caminho do usuário** pros modelos baratos só
> liga DEPOIS do A/B provar que mantêm o edge (expectancy). Até lá, usuário fica
> no Claude; a máquina só está pronta.

> **Opção fricção-zero:** se quiser eliminar até a pegada de *origem*, usar
> **Llama (Meta/EUA)** e **Mistral (França/UE)** — abertos, baratos, ocidentais.
> O A/B mede se empatam com o DeepSeek pro nosso caso.

---

## 4. Modelo de custo (estimativas validadas)

Preços jun/2026 (por 1M tokens):

| Modelo | Input | Output | Papel |
|--------|-------|--------|-------|
| Opus 4.8 | $5 | $25 | T1 orquestrador |
| GPT-5.5 | $5 | $30 | T1 risco |
| Grok 4.3 | $1.25 | $2.50 | T2 sentimento ($175/mês grátis) |
| Kimi K2.6 | $0.80 | $3.40 | T2 docs |
| DeepSeek V4 | $0.435 | $0.87 | T2 quant |
| *(hoje)* Sonnet 4.6 | $3 | $15 | — |

**Cenários de fatura mensal:**
- **Hoje (tudo Sonnet):** ~$70-100/mês
- **Híbrido fase de teste:** ~$15-40/mês (braçal barato + premium quase não liga)
- **Híbrido em escala:** ~$150-250/mês (premium proporcional ao volume de trade)
- *(Ferrari pura, p/ referência):* $400-700/mês

---

## 5. Framework de A/B (a base JÁ existe)

O flywheel já roda **Claude + Kimi no mesmo tick** (commit `bee2e40`), logando
`source` separado (`self_scan` vs `kimi_scan`). Estender pra comparar N modelos.

**Como mede:** `GROUP BY source` → expectancy, win-rate, R:R, custo/análise por
modelo, sobre o MESMO dado de mercado. O dado decide, não o marketing.

**Regras de leitura honesta:**
- Amostras pareadas (mesmo mercado) ✅ já garantido.
- ≥30 resolvidos por modelo antes de cravar (senão é ruído).
- Métrica = **expectancy**, não win-rate.

---

## 6. Fases de execução (com gates)

> Cada fase tem um **gate**: só passa pra próxima se o critério bater.

| Fase | Entrega | Gate p/ avançar | Status |
|------|---------|-----------------|--------|
| **F0** | Este plano revisado + decisões §10 fechadas | Founder aprova | 🟡 |
| **F1** | Camada de provider OpenRouter (cliente OpenAI-compat genérico + roteamento de modelo por papel) | tsc + 1 chamada real funciona | 🔴 |
| **F2** | A/B no flywheel: DeepSeek + Kimi + (Llama/Mistral) vs Claude, todos via OpenRouter | 4+ modelos logando `source` próprio | 🔴 |
| **F3** | Coletar 2-4 semanas de dados; comparar expectancy/custo por modelo | ≥30 resolvidos/modelo | 🔴 |
| **F4** | Roteamento por jurisdição (geo-routing) + ZDR/provider pinning | dado de US/UE nunca vai pra provedor não-conforme | 🔴 |
| **F5** | Tier de decisão (T1: Opus+GPT) gated por gatilho de trade real, com o `price-guard` como juiz | só liga em trade real; código valida risco | ⏸️ pós-11/07 |
| **F6** | Migrar caminhos de dinheiro real pro vencedor do A/B | A/B prova edge mantido | ⏸️ data-gated |

---

## 7. Mudanças técnicas previstas (alto nível)

- **`src/lib/ai/provider.ts`** (novo): cliente genérico OpenAI-compatible +
  abstração `callModel({ role, messages, ... })` que resolve provedor/modelo por
  papel e jurisdição. Reusa o padrão do `runBacktestScanKimi`.
- **`src/lib/ai/registry.ts`** (novo): registro de modelos por papel (T1/T2) +
  metadados (origem, custo, provedor permitido por jurisdição).
- **`src/lib/zion/model.ts`** (estender): o `modelChain` (N1) vira parte do
  registry; fallback por papel.
- **`ai-cost.ts`** (estender): já tem Kimi/DeepSeek; adicionar Llama/Mistral/Grok/GPT.
- **Flywheel** (`backtest.ts` + rota): generalizar o A/B de 2 → N modelos.
- **Geo-routing:** resolver jurisdição do usuário (wallet/IP/config) → stack permitido.
- **NADA** no caminho de dinheiro real até F5/F6 (autopilot fica no Claude).

---

## 8. Variáveis de ambiente (a definir)

```
OPENROUTER_API_KEY        # gateway único
OPENROUTER_BASE_URL       # default https://openrouter.ai/api/v1
AI_T2_QUANT_MODEL         # ex: deepseek/deepseek-v4
AI_T2_DOCS_MODEL          # ex: moonshotai/kimi-k2.6
AI_T2_SENTIMENT_MODEL     # ex: x-ai/grok-4.3
AI_T1_ORCH_MODEL          # ex: anthropic/claude-opus-4.8
AI_T1_RISK_MODEL          # ex: openai/gpt-5.5
AI_PROVIDER_PINS          # JSON: jurisdição → provedores permitidos
AI_ZDR_REQUIRED           # bool por jurisdição
XAI_API_KEY               # BYOK p/ manter os $175 grátis do Grok
```

---

## 9. Riscos & mitigações

| Risco | Mitigação |
|-------|-----------|
| LLM barato erra escala/risco | Regra de ouro #1 — `price-guard` determinístico é o juiz |
| Modelo barato perde edge | Regra de ouro #2 — A/B antes de migrar dinheiro |
| Dado vaza p/ China | Provider pinning ocidental + ZDR; ou Llama/Mistral |
| OpenRouter cobra 5.5% / perde Grok grátis | Comprar crédito em lote; BYOK p/ Grok |
| Provedor barato cai/lento | Fallback por papel (N1 estendido) |
| Cache da Anthropic some via OpenRouter | Manter Claude direto se o desconto não passar |

---

## 10. Decisões em aberto (precisa do founder — fecha a F0)

1. **Confirmar OpenRouter como gateway** (vs direto em cada fonte)? → proposto: SIM.
2. **Claude fica direto na Anthropic** (por causa do cache) ou tudo no OpenRouter?
3. **Quais modelos entram no A/B inicial** além de Claude+Kimi? (DeepSeek? Llama? Mistral? GPT-5.5?)
4. **Como resolver a jurisdição do usuário** (IP, país declarado, KYC futuro)?
5. **Stack default por mercado** — confirmar a tabela do §3.
6. **Quando começar** — agora (F1/F2 só infra+A/B, sem risco) ou esperar pós-11/07?

---

## 11. O que NÃO fazer agora (deferir)

- ⏸️ Mexer no autopilot de dinheiro real (fica no Claude até A/B + 11/07).
- ⏸️ Modelo local / data center Paraguai (decisão de escala, não de agora).
- ⏸️ Fine-tuning de modelo aberto (precisa do dataset que o flywheel está criando).
- ⏸️ T1 (Opus+GPT) em produção — só depois da F2/F3 validarem o T2.
