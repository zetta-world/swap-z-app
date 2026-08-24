# Analista Profundo + Auto-Retro — 🟡 (retro no ar, dossiê 🔴) — 25/07

> Gatilho: CEO identificou os dois buracos — (1) nenhum agente analisa como
> um trader humano (velas, estrutura, notícia, probabilidade, matemática,
> histórico — tudo junto, com tempo pra pensar); (2) os agentes não têm
> autoavaliação — não aprendem com os próprios erros.

## Parte A — AUTO-RETRO (🟢 25/07)

**A verdade técnica:** LLM não atualiza pesos; "aprender sozinho" real =
fechar o ciclo **medir → refletir → contextualizar → medir**. O flywheel já
mede; a memória de mesa (25/07) já lembra; a Auto-Retro é o refletir.

Mecânica (`src/lib/zion/retro.ts`):
- A cada `RETRO_EVERY_N` (10) trades decididos de um agente, o cron pergunta
  AO PRÓPRIO modelo que decidiu: "estas foram suas últimas decisões
  (geometria, regime, resultado, tempo até resolução) — extraia até 3
  lições operacionais ESPECÍFICAS". Fonte-a-modelo: `oracle_self`→Anthropic,
  `oracle_<id>`→provider, `sniper`/`radar`→cheap brain (quem decidiu,
  reflete).
- Lições salvas em `agent_lessons` (migration 0018 — histórico completo,
  auditável; a ativa é a mais recente por source).
- Injeção: bloco `<your_lessons>` no prompt do Oráculo (junto da memória de
  mesa) e do Sniper.

**Guardrails (lição é contexto, NUNCA permissão):**
- Nenhuma lição relaxa gate mecânico — clamps, pisos de stop, cooldowns e
  caps são código e não se negociam com LLM.
- Máx 3 lições ativas por agente, ≤220 chars cada (sem acumular ruído);
  cada rodada de retro SUBSTITUI a anterior (a antiga fica no histórico).
- O juiz segue sendo o flywheel: expectancy pré vs pós-lições, rodadas
  separadas pelo arquivo. Se lições piorarem o agente → `AGENT_RETRO=off`
  (toggle, não deploy).

## Parte B — DOSSIÊ PROFUNDO (🔴 — evolução do Oráculo, não 11º agente)

1×/dia, screeners objetivos escolhem 2-3 símbolos (extremo de funding,
anomalia de volume, gatilho do radar, tese aberta sob revisão) e montam o
dossiê que um trader humano montaria:

| Peça | Fonte | Status |
|---|---|---|
| **Velas cruas** 4h/1d/1w (OHLC compacto — price action lido pelo modelo, não pré-mastigado) | Binance data mirror (já usada na resolução) | 🔴 |
| Indicadores completos + funding/OI | já existem | 🟢 |
| **Notícias** do ativo + macro (a F2-notícias do PLANO-ORACULO) | CryptoPanic free/RSS — definir | 🔴 |
| **Histórico-analógico PRÉ-COMPUTADO** ("nas últimas N quedas >5%/semana deste ativo, retorno médio 10d seguinte = X%") — matemática em código, LLM lê estatística mas não calcula | klines históricas | 🔴 |
| Calendário macro (FOMC/CPI/unlocks) | manual no prompt → fonte later | 🔴 |

Output: tese no MESMO funil (invalidação declarada, stop ≥4%, RR≥1.5,
travas de símbolo) com raciocínio estendido (thinking) — 1-3 chamadas
caras/dia, orçamento que existe desde que matamos as 288/dia do formato bot.

## Sequência

1. 🟢 Auto-Retro (todos os agentes LLM ganham reflexão de uma vez).
2. 🔴 F2-notícias (destrava reversões do Oráculo E alimenta o dossiê).
3. 🔴 Dossiê completo (velas cruas + analógico + calendário).
4. ⏸️ Julgar: Oráculo-com-dossiê vs Oráculo-atual no torneio (amostra ≥30).
