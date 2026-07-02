# Análise de Dados #01 — Flywheel 28/06 → 01/07

> **Baseline oficial da primeira leva de dados.** A próxima análise (pós-11/07)
> compara contra ESTES números. Amostra: 44 trades decididos (A: 32 · Mistral:
> 12) + 33 abertos. **Abaixo do MIN_SAMPLE=100 — tudo aqui é direcional, não
> veredito.** Gerada em 2026-07-02, direto do `zion_suggestions` via SQL.

## Placar

| Agente | Decididos | W/L | Win rate | Avg outcome | Net expectancy |
|--------|-----------|-----|----------|-------------|----------------|
| Agent A (Sonnet, self_scan) | 32 | 12W/20L | 37.5% | −0.39% | **−0.59%** |
| Mistral (mistral_scan) | 12 | 1W/11L | 8.3% | −1.95% | **−2.15%** |

⚠️ **Viés de maturação no Mistral:** 25/37 ainda abertos e são os mais novos.
Com R:R 1.5, o stop fica mais perto que o target → os primeiros a resolver são
desproporcionalmente losses. Snapshot precoce SEMPRE parece pior que a
realidade final. Não comparar com o placar maduro do A.

## Achados centrais

### 1. O prejuízo está concentrado nos BUYS
| Side | W/L | Avg outcome |
|------|-----|-------------|
| sell | 12W/19L | −0.09% (≈ empate pré-custo) |
| buy | **1W/12L** | **−2.52%** |

Buys perderam em TODO regime (RANGING 1/6 · TRANSITIONING 0/4 · até
TRENDING_UP 0/2). O período foi vendedor; o desk insistiu em comprar.

### 2. Probability está ANTI-calibrada
| Bucket | W/L | Avg outcome |
|--------|-----|-------------|
| <50 | 9W/16L | −0.42% |
| 50-59 | 4W/11L | −1.33% |
| 60+ | **0W/4L** | −1.36% |

Monotônico e invertido: mais confiança → pior resultado. Consequências:
- **NUNCA usar probability para sizing** até o Z7 calibrar (um Kelly hoje seria destrutivo).
- TRENDING_DOWN é onde a confiança é maior (52) e o resultado pior (1W/12L,
  stopado em 5.4h — 2x mais rápido que os demais regimes).

### 3. R:R realizado < planejado (contabilidade honesta, não bug)
- Planejado: **1.50 exato** (a regra de construção funciona).
- Realizado: target médio +2.53% vs stop médio −2.22% = **1.14**
  (stop-first pessimista + outcome medido vs ref_price).
- Break-even com payoff 1.14 ≈ **47% de win rate**. O A está em 37.5%.
- **Zero expired em 44**: níveis de ~2.2-2.5% são tocados em ~11h média, muito
  antes das 72h. O jogo é 100% acertar DIREÇÃO; o horizonte quase não participa.

### Por símbolo (n minúsculo — só pra registro)
Piores: ARB −4.03 · ADA −2.79 · XRP −2.36 (0W/5L) · BTC 2W/7L −1.03.
Positivos: OP +1.11 · ETH +0.90 (3W/3L) · UNI +0.42.

## O que os dados JÁ validam (infra)
Zero linha corrompida (guardas de escala/geometria) · zero expired falso ·
R:R construído exato · toggles do painel funcionam (torneio/B pausados a
pedido) · circuit breaker funciona (DeepSeek tripado após 4 falhas — chave com
problema, ação do CEO) · crons vivos · resolução 5min honesta.

## Hipóteses REGISTRADAS (não implementar antes de ≥100 decididos)
| # | Hipótese | Como testar quando houver amostra |
|---|----------|-----------------------------------|
| H1 | Filtro de direção: exigir confirmação extra p/ buy quando o tape (BTC 4h) está bearish | comparar expectancy dos buys com/sem a condição, retroativamente no ledger |
| H2 | Probability como anti-sinal (ou ignorar o campo) | correlação prob × outcome com n≥100 |
| H3 | Cortar/reduzir TRENDING_DOWN do scan | expectancy por regime com n≥30 por célula |
| H4 | Payoff: exigir R:R construído ≥1.8 pra compensar o realized gap (1.5→1.14) | recomputar break-even com a distribuição real de touches |

## Follow-ups operacionais
- [ ] CEO: consertar chave/crédito DeepSeek (breaker re-tripa a cada hora até lá).
- [ ] 04/07: os 33 abertos expiram se não tocarem nível — primeira leva real de `expired` (bom: valida a separação win-rate × drift).
- [ ] Pós-crédito: rodar GOLDEN-SET.md antes de religar tudo; religar torneio só com chaves saudáveis.
- [ ] Próxima análise: `ANALISE-DADOS-02.md` comparando contra este baseline.
