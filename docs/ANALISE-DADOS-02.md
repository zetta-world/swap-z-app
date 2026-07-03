# Análise de Dados #02 — Maturação da 1ª safra (03/07, ~21:00 UTC)

> Compara contra o baseline `ANALISE-DADOS-01.md` (02/07). Mesma safra de
> sugestões (28/06→01/07) — nenhum scan novo rodou (crédito/gates), mas a
> RESOLUÇÃO continuou e os 33 abertos maturaram. 72 resolvidos, 5 abertos.
> Ainda < MIN_SAMPLE=100 → direcional, não veredito.

## Placar: antes → depois

| Agente | Em 02/07 (net) | Em 03/07 (net) | Δ |
|--------|----------------|----------------|---|
| Agent A (Sonnet) | 12W/20L, 0exp · **−0.59%** | **16W/20L, 4exp · +0.39%** | primeiro NET POSITIVO ✅ |
| Mistral | 1W/11L (25 abertos) · −2.15% | 12W/20L (5 abertos) · **−0.26%** | de catástrofe a ~empate |

## A lição que vale ouro (e que os dados acabaram de PROVAR)

Em 02/07 os dados "mostravam": buys 1W/12L (−2.52%), probability
anti-calibrada, TRENDING_DOWN tóxico. **Hoje, os MESMOS trades maturados:**

| Dimensão | 02/07 | 03/07 |
|----------|-------|-------|
| Buys | 1W/12L · −2.52% | **16W/12L +4exp · +1.89%** (melhor segmento!) |
| Sells | 12W/19L · −0.09% | 12W/28L · −0.97% (apanharam no repique) |
| Prob 60+ | 0W/4L · −1.36% | 4W/4L · **+1.98%** |

**Inversão total em 24h.** Se tivéssemos implementado H1 (filtrar buys) ou H2
(inverter probability) com o snapshot de ontem, teríamos otimizado o sistema
CONTRA o segmento que virou o melhor. A régua "nada de cirurgia de prompt antes
de ≥100 decididos" deixou de ser prudência teórica e virou lição empírica:
snapshot precoce reflete a JANELA DE MERCADO + viés de maturação (stop resolve
rápido, target demora), não o edge do agente. H1/H2/H3 continuam REGISTRADAS e
NÃO implementadas.

## Números estruturais (72 resolvidos)

- **Payoff realizado subiu**: target médio +4.10% vs stop médio −2.61% →
  R:R realizado **1.57** (era 1.14). Break-even WR ≈ 39%.
- **WR combinado decidido**: 28W/40L = 41.2% > 39% → **edge combinado
  levemente positivo** (gross ≈ +0.30%, net ≈ +0.10%).
- **Primeiros `expired`**: 4, média **+2.83%** (buys que subiram sem tocar o
  alvo) — a separação win-rate × drift funcionando como desenhada.
- signalRate: 68/72 = 94% (níveis quase sempre são tocados em 72h).
- Head-to-head maduro: **A > Mistral por ~0.65pp/trade** (n pequeno).

## Infra validada nesta leva
Resolução rodou sozinha por 2 dias com scans desligados (cron vivo, gates
honrados) · expired entrou em produção sem bug · sem linha corrompida.

## Próximos passos (inalterados)
- 11/07+: religar scans (crédito Anthropic), torneio com chaves sãs, GOLDEN-SET
  antes, acumular até ≥100 decididos por agente antes de QUALQUER mudança.
- 5 abertos do Mistral expiram/resolvem até 04/07 — fecha a safra 01.
