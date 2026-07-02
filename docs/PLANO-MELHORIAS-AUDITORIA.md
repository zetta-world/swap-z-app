# Plano de Ação — Melhorias da Auditoria Geral

> **Origem:** `AUDITORIA-GERAL.md` (2026-07-02). O CEO aprovou executar as
> melhorias na ordem. Documento vivo: atualizar o Status a cada entrega.

**Legenda:** `🔴 pendente` · `🟡 em andamento` · `🟢 feito` · `⏸️ aguardando decisão/data`

| ID | Melhoria | Detalhe | Status |
|----|----------|---------|--------|
| M1 | **Testes + CI** | Vitest para o código de dinheiro (`parsePrice`, `extractSuggestion`, `resolveOne`, `estimateCost`) + workflow GitHub Actions rodando lint + type-check + testes em todo push | 🟢 26 testes · `.github/workflows/ci.yml` · **pegou 1 bug real no 1º run (ver abaixo)** |
| M2 | **Health ping honesto** | Capturar trecho do body no 401/403 para distinguir "sem crédito" (caso Grok) de "chave inválida" | 🟢 `health.ts` classifica por regex no body |
| M3 | **Prompt enxuto por papel** | Especialistas macro/sentiment recebem system prompt curto do seu papel em vez do ZION_FOUNDATION inteiro (~4k tokens/chamada economizados; brain e CEO mantêm o foundation pois produzem cards) | 🟢 `SPECIALIST_SYSTEM` em `backtest.ts` |
| M4 | **Circuit breaker visível** | Rota `/admin/api/ai-circuit` (estado + reset manual) + seção no painel AI CONTROLS | 🟢 estado ●ok/⚠falhas/⛔TRIPADO + botão RESET |
| M5 | **Runbook + env vars** | `docs/RUNBOOK.md` com referência de todas as env vars e playbook de incidente | 🟢 ~60 vars documentadas + 5 playbooks |
| M6 | **Preço real do Opus** | Confirmado na doc oficial da API: **Opus 4.8 = $5/$25 por MTok** (não $15/$75). Corrigir `ai-cost.ts` | 🟢 `tier(5, 25)` + teste pinando o preço |

## 🐛 Bug real encontrado pelos testes (1º run do M1)

`parsePrice("0.816")` e `parsePrice("0,816")` retornavam **816** — a heurística
de milhares tratava o grupo `0` como milhar, então **qualquer preço abaixo de
$1 com exatamente 3 decimais era lido 1000x maior**. Muito provavelmente o
verdadeiro culpado da linha "DOT 816 vs 0.816" que tínhamos atribuído a
alucinação do modelo. Corrigido (`/^[1-9]\d{0,2}$/` no grupo líder) e pinado
por teste. É exatamente o motivo de o M1 ser a melhoria nº 1.
| M7 | **Tier gate do ZION** | Ligar `gatesEnabled` (ou exigir carteira) ANTES de qualquer marketing. É um flag — decisão de negócio do CEO sobre QUANDO (hoje atrapalharia os próprios testes) | ⏸️ decisão do CEO pré-marketing |
| M8 | **A/B Sonnet 5 vs 4.6** | `ZION_MODEL=claude-sonnet-5` via env na Vercel quando o crédito Anthropic voltar (11/07). Sonnet 5 tem preço intro $2/$10 até 31/08 — mais barato que o 4.6 | ⏸️ pós-11/07 |

## Notas de implementação

- **M1:** framework = Vitest (leve, TS nativo). `resolveOne` precisa ser exportado
  do `backtest.ts` para ser testável. Testes cobrem: locale de preço (vírgula
  decimal PT/EU), guarda de escala 1000x, geometria R:R, stop-first pessimista,
  expired no horizonte, vela pré-entrada ignorada.
- **M3:** apenas macro e sentiment ganham prompt enxuto. O brain (draft técnico)
  e o CEO continuam com o foundation — eles precisam do schema de ACTION CARD.
- **M6:** cache multipliers do código (1.25×/2×/0.1×) estão CORRETOS, só o
  input/output do Opus muda. Impacto: estimativas do FINANCE ficam 3x menores
  para Opus — margens dos planos ficam MELHORES que o calculado.
