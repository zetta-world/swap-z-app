# Caminho pra lucratividade dos agentes — 🟡 (alavancas 1+2+4 no ar, 17/07)

> Pergunta do CEO: "o que precisamos fazer para tornar os agentes
> lucrativos?" Respondido com os dados da rodada 1 (4.026 sugestões
> arquivadas — ver PLANO-ARQUIVO-RODADAS.md).

## O que a rodada 1 provou

1. **Média bruta por trade ≈ −0.4%, custo 0.2%** — o problema não é só
   custo; o edge direcional médio é negativo. Disciplina (cirurgia 11/07)
   tirou o tiro no pé, não criou edge.
2. **Confiança declarada é ANTI-calibrada** (win% por faixa de
   probability: <60 → 32.7% · 60-69 → 23.4% · 70-79 → 14.5% · 80+ → 0%).
   Card "confiante" do LLM é o card ruim. NÃO usar probability como gate
   de entrada; ela serve, no máximo, como red flag invertida.
3. **O único livro positivo foi o market-neutral** (arbiter: +0.92% em
   2.5d, 67/67, sem risco direcional). Edge direcional em regime adverso
   não apareceu em NENHUM dos 7 agentes.
4. **Regime manda no resultado** (radar controle: +2.13 → −1.54 quando o
   mercado virou). Agente que opera em chop paga pra jogar.

## Alavancas (ordem de esforço/retorno)

| # | Alavanca | Mecanismo | Status |
|---|----------|-----------|--------|
| 1 | **Filtro de regime objetivo** | Gate mecânico no `extractSuggestion` (funil de TODOS os agentes): símbolo `RANGING` (ADX<20) não emite nada; card contra tendência CONFIRMADA (`TRENDING_UP`+sell / `TRENDING_DOWN`+buy, ADX≥25) é rejeitado; `TRANSITIONING` e regime ausente passam (best-effort). Prompt avisa o modelo pra não gastar cobertura nesses símbolos. `BACKTEST_REGIME_FILTER=off` desliga. | 🟢 17/07 |
| 2 | **Seletividade por evidência, não volume** | Prompt: "emitir só com evidência real; cards vazios = resposta válida" (a pressão de cobertura — "cover as many as you can", "empty = failed run" — morreu). Gate objetivo: RR planejado ≥2 (`BACKTEST_MIN_RR`) — sub-2 não paga o custo de 0.2% round-trip. Probability segue só logada pra calibração, nunca gate (é anti-calibrada). | 🟢 17/07 |
| 3 | **Torneio como fábrica de corte** | Rodada 2 mede; quem fechar amostra mínima com expectancy líquida negativa é pausado na rodada 3. Capital (de papel) concentra no campeão. | ⏸️ aguarda amostra |
| 4 | **Escalar o market-neutral** | Universo do arbiter 30 → ~55 símbolos (majors USDT multi-venue; POL/RENDER = tickers vivos dos cadáveres MATIC/RNDR), cap diário 20 → 40 (`ARB_DAILY_CAP`), coinbase pulada no FETCH (não só descartada — ~55 req/min a menos). Sniper já estava em cena (event-driven, despausado 17/07 08:32; espera gatilho ≥1.5%) — RR mínimo alinhado ao ledger (1.5 → 2). | 🟢 17/07 |

## O que NÃO fazer

- Não afrouxar o teto de alvo/entry pra "deixar o agente respirar" — o
  lixo de dado da rodada 1 veio daí.
- Não medir nada misturando rodadas (por isso o arquivo).
- Não promover prompt nenhum pro ZION ao vivo antes de expectancy líquida
  positiva com amostra mínima em regime adverso.
