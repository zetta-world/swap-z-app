# Plano — Agente SNIPER (o experimento de lucratividade)

> **CEO (14/07):** os agentes dispararam trades como se fossem obrigados (eram —
> o prompt de coleta exigia cobertura). O agente real deve operar como os planos
> funcionam: limite mensal de trades, só entradas de alta probabilidade.
> Aprovado: documentar + Fase 1. Status vivo (🔴/🟡/🟢/⏸️).

## A evidência (1.870 decididos do flywheel — por que ESTE desenho)

| Descoberta | Dado | Consequência de design |
|---|---|---|
| Event-driven vence timer | Radar **+1.22%** (único positivo); todos os scanners de 30min negativos | Sniper SÓ analisa quando um gatilho de preço dispara |
| Confiança declarada é INVERTIDA | prob <50 → +0.33% ✅ · prob 70+ → **−1.91%** ❌ | Probabilidade do modelo NUNCA é filtro (só logada) |
| Consenso não é edge | 2-3 agentes concordando = pior (−0.5/−0.7%) — erram juntos por regime | Sem comitê; 1 cérebro + gates objetivos |
| Cobertura forçada fabrica perdedores | prompt antigo: "card vazio = rodada falhada" | "Não operar" é resposta VÁLIDA e esperada |
| A favor da tendência vence nos 2 regimes | with-trend 70-92% win em alta E em baixa | Gate duro: buy só em TRENDING_UP, sell só em TRENDING_DOWN |

## O desenho (funil invertido)

```
radar detecta evento de preço (grátis, 1min)      ← já existe
        │ só nos símbolos disparados
        ▼
SNIPER: 1 cérebro barato analisa COM LICENÇA PARA RECUSAR
        │ prompt: "card vazio é boa resposta; máx 2 cards"
        ▼
GATES OBJETIVOS (código, não opinião do modelo):
  ① a favor da tendência (regime ADX)  ② R:R ≥ 1.5 com bracket completo
  ③ orçamento mensal restante          ④ gates de sanidade do ledger (escala/clamp)
        ▼
zion_suggestions source='sniper'  →  resolução automática (grátis)
        →  carteira paper 'Sniper' na Gate.io (auto)  →  torneio/painéis (auto)
```

**Orçamento:** `SNIPER_MONTHLY_BUDGET` (default **30/mês** ≈ 1/dia, espelhando um
plano Trader; os planos ainda não fixam número — quando fixarem, apontar aqui).
Escassez força seletividade: acabou o orçamento, o sniper só observa.

**Custo:** só gasta quando (a) um gatilho dispara E (b) há orçamento — ~90% menos
chamadas que o scanner de 30min. Cérebro = `hybridBrain()` (DeepSeek, barato).

## Fases

| Fase | Item | Status |
|---|---|---|
| F1.1 | `src/lib/zion/sniper.ts`: prompt seletivo + gates puros (`trendGate`, `rrGate`, orçamento) + `runSniperScan` (breaker, custo logado, insert `source='sniper'`) | 🟢 |
| F1.2 | Wire no cron do radar atrás de `pause_sniper` (radar antigo continua como grupo de CONTROLE — mesmo gatilho, política antiga) | 🟢 |
| F1.3 | Gate `pause_sniper` (gates/killswitch/painel) — **nasce PAUSADO** até o CEO religar | 🟢 |
| F1.4 | Medição automática: carteira paper 'Sniper' + label no torneio/digest | 🟢 |
| F1.5 | Testes dos gates puros | 🟢 |
| F2 | Religar (CEO) → acumular ~30-50 decididos do sniper → comparar vs radar (controle) e vs scanners históricos | ⏸️ aguarda CEO |
| F3 | Se validar: orçamento por plano real (Thrall/Hird/Panteão), sniper vira o motor do autopilot | 🔴 |

## Regras que herdamos (não recriar)
Resolução path-aware, custo líquido 0.2%, stop-first, clamp de alvo (30%),
gate de escala do entry, MIN_SAMPLE=100 pra conclusões — tudo do flywheel vale.

## Critério de sucesso (F2)
Exp. líquida do sniper > 0 E > radar (controle) com ≥30 decididos. Se o sniper
não bater o radar puro, a lição é "os gates ajudam menos que o gatilho" — e o
produto vira o radar com orçamento.
