# Plano — Controle liga/desliga dos agentes + Painel do Torneio

> **Origem:** pedido do CEO após ver (1) loss subindo, (2) alertas Grok/Kimi
> repetidos no Telegram, (3) FINANCE mostrando "gasto" da Mistral sem crédito
> adicionado. Quer: painel de torneio completo, botões liga/desliga por agente,
> e parar o backtest quando quiser. **Gerado:** 2026-07-01.

**Legenda:** `🔴 pendente` · `🟡 em andamento` · `🟢 feito`

---

## 0. Diagnóstico (o que as imagens revelaram)

| Achado | Verdade técnica |
|--------|-----------------|
| "Mistral consumindo crédito" | O FINANCE é **estimativa** (tokens × tarifa pública), NÃO cobrança real. Mistral respondeu (chave boa) → tokens contados → estima $0.26. Trial da Mistral provavelmente cobriu. Grok/Kimi/DeepSeek não aparecem porque **falharam** (sem tokens). |
| Alertas "Grok auth rejected" / "Kimi not responding" | `XAI_API_KEY` setada mas **inválida**; `KIMI_API_KEY` falhando. Watchdog re-pinga e alerta a cada 30min → spam. Só a Mistral tem chave boa. |
| Loss subiu (12W/17L → 12W/27L) | **NÃO é falta de crédito** (isso faz o agente não gerar, não gera loss). É (a) edge genuinamente negativo agora; (b) P1.4 resolução 5min pega stops intra-barra que a vela de 1h escondia — mais honesto; (c) amostra 39 = ainda ruído (painel já avisa). |
| "Cron stalled — backtest since 6/28" / "radar never seen" | Precisa confirmar se os crons externos (cron-job.org) estão de fato disparando. Fora do escopo de código — checar no painel do cron-job.org. |

---

## 1. O que vou implementar NESTA rodada

| ID | Item | Status |
|----|------|--------|
| C1 | **Gates liga/desliga** em `admin_kv`: `pause_backtest` (master), `pause_agent_a`, `pause_agent_b`, `pause_tournament`. Helper `getFlywheelGates()` | 🟢 |
| C2 | **Backtest cron honra os gates** — heartbeat sempre marca (não dispara "stalled"), mas pula os scans pausados. Resolução (grátis) continua salvo master OFF | 🟢 |
| C3 | **Watchdog respeita os gates** — não alerta "AI model down" quando o scanning está pausado; dedup do model-down 30min → 6h (corta spam) | 🟢 |
| C4 | **Rota `/admin/api/tournament`** — ranking por `source` (agente) com expectancy LÍQUIDA, win-rate, amostra, regime | 🟢 |
| C5 | **TournamentPanel** — ranking completo dos agentes A/B/torneio, medalhas, amostra, net expectancy | 🟢 |
| C6 | **AiControlsPanel** — botões ON/OFF (backtest + cada agente), via killswitch route estendida | 🟢 |
| C7 | Registrar 2 módulos novos (`tournament`, `ai-controls`) em `modules.ts` + `DashboardClient` | 🟢 |
| C8 | FINANCE deixar EXPLÍCITO que o gasto é **estimativa** (label "≈ EST.") | 🟢 |

## 2. Pendente / do lado do CEO (não é código)

- **Corrigir ou remover `XAI_API_KEY` e `KIMI_API_KEY`** — estão sendo rejeitadas.
  Enquanto isso, `pause_tournament` OFF muta os alertas e para qualquer gasto.
- **Confirmar cron-job.org** disparando `/api/zion/backtest` e `/api/radar`.
- Pós-11/07: ligar `HYBRID_B_ENABLED` (Agent B / Opus) com crédito Anthropic.
