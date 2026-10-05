# Modelo de custo de 36 meses — COST ENGINEERING ROUND (CE-15)

> Gerado por `node scripts/cost/modelo-36-meses.mjs` a partir de `scripts/cost/premissas-36-meses.json`. Não editar à mão.
> **Matemática, não política:** preços (provisórios), supply, referral e reserva são ENTRADAS. Nenhum número aqui é decisão aprovada.
> Valores por HOLDER, em USD, somados nos 36 meses. Fonte de cada premissa no JSON (MEASURED / ESTIMATED / DECISAO).

## 1. Custo unitário

| item | valor | fonte |
|---|---|---|
| uma análise ZION (Kimi), EXPECTED | $0.0067 | tokens: prefixo MEASURED, payload/saída ESTIMATED |
| uma análise ZION (Kimi), HEAVY | $0.0083 | tokens: prefixo MEASURED, payload/saída ESTIMATED |
| uma análise ZION (Kimi), STRESS | $0.0102 | tokens: prefixo MEASURED, payload/saída ESTIMATED |
| uma análise ZION (Sonnet, sensibilidade), EXPECTED | $0.0364 | ESTIMATED |
| uma análise ZION (Sonnet, sensibilidade), HEAVY | $0.0453 | ESTIMATED |
| uma análise ZION (Sonnet, sensibilidade), STRESS | $0.0558 | ESTIMATED |
| uma vela lida e processada no Workbench, depois | $7.78e-9 | egress domina |
| CPU de uma vela (estratégia própria), antes → depois | $1.84e-8 → $7.50e-11 | MEASURED (CE-03) |
| CPU de uma barra (modo mesa), antes → depois | $2.21e-8 → $1.45e-9 | MEASURED (CE-03) |
| uma mesa de papel por mês (EXPECTED) | $0.0004 | tique MEASURED (CE-10) |
| fixos da plataforma por holder (36 meses, 2890 holders) | $1.79 | ESTIMATED ($144/mês) |

## 2. Custo de 36 meses por holder

| cenário | plano | preço | ZION | Workbench | papel | **CASH** | CASH/preço | HUMANO | FIXO | **ECONÔMICO** | econômico/preço |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EXPECTED | pro | $149 | $21.92 | $0.0885 | $0.0000 | **$22.00** | 14.8% | $63.00 | $1.79 | **$86.80** | 58.3% |
| EXPECTED | trader | $399 | $54.79 | $0.3539 | $0.0202 | **$55.16** | 13.8% | $189 | $1.79 | **$246** | 61.6% |
| EXPECTED | pilot | $1,990 | $65.75 | $1.06 | $0.0674 | **$66.88** | 3.4% | $630 | $1.79 | **$699** | 35.1% |
| HEAVY | pro | $149 | $72.40 | $5.13 | $0.0000 | **$77.53** | 52.0% | $189 | $1.79 | **$268** | 180.1% |
| HEAVY | trader | $399 | $181 | $25.65 | $0.0202 | **$207** | 51.8% | $504 | $1.79 | **$712** | 178.6% |
| HEAVY | pilot | $1,990 | $217 | $257 | $0.0674 | **$474** | 23.8% | $1,890 | $1.79 | **$2,366** | 118.9% |
| STRESS | pro | $149 | $111 | $37.38 | $0.0000 | **$149** | 99.7% | $378 | $1.79 | **$528** | 354.6% |
| STRESS | trader | $399 | $278 | $187 | $0.0202 | **$465** | 116.5% | $1,008 | $1.79 | **$1,475** | 369.6% |
| STRESS | pilot | $1,990 | $334 | $1,869 | $0.0674 | **$2,203** | 110.7% | $3,780 | $1.79 | **$5,984** | 300.7% |

ZION com Sonnet (sensibilidade de provedor), 36 meses: pro E $119 / H $397 / S $611 · trader E $299 / H $993 / S $1,527 · pilot E $358 / H $1,191 / S $1,832

## 3. O que a engenharia removeu (Workbench, linha de CPU, 36 meses por holder)

| cenário | plano | velas/dia | CPU antes | CPU depois |
|---|---|---|---|---|
| EXPECTED | pro | 10,000 | $0.2019 | $0.0008 |
| EXPECTED | trader | 40,000 | $0.8077 | $0.0033 |
| EXPECTED | pilot | 120,000 | $2.42 | $0.0098 |
| HEAVY | pro | 600,000 | $12.12 | $0.0492 |
| HEAVY | trader | 3,000,000 | $60.58 | $0.2462 |
| HEAVY | pilot | 30,000,000 | $606 | $2.46 |
| STRESS | pro | 4,380,000 | $88.44 | $0.3595 |
| STRESS | trader | 21,900,000 | $442 | $1.80 |
| STRESS | pilot | 219,000,000 | $4,422 | $17.98 |

## 4. Margem por plano (preço − referral − custo econômico de 36 meses)

| cenário | plano | referral 0% | 10% | 15% | 20% |
|---|---|---|---|---|---|
| EXPECTED | pro | $62.20 (41.7%) | $47.30 (31.7%) | $39.85 (26.7%) | $32.40 (21.7%) |
| EXPECTED | trader | $153 (38.4%) | $113 (28.4%) | $93.19 (23.4%) | $73.24 (18.4%) |
| EXPECTED | pilot | $1,291 (64.9%) | $1,092 (54.9%) | $993 (49.9%) | $893 (44.9%) |
| HEAVY | pro | −$119 (-80.1%) | −$134 (-90.1%) | −$142 (-95.1%) | −$149 (-100.1%) |
| HEAVY | trader | −$313 (-78.6%) | −$353 (-88.6%) | −$373 (-93.6%) | −$393 (-98.6%) |
| HEAVY | pilot | −$376 (-18.9%) | −$575 (-28.9%) | −$674 (-33.9%) | −$774 (-38.9%) |
| STRESS | pro | −$379 (-254.6%) | −$394 (-264.6%) | −$402 (-269.6%) | −$409 (-274.6%) |
| STRESS | trader | −$1,076 (-269.6%) | −$1,116 (-279.6%) | −$1,136 (-284.6%) | −$1,155 (-289.6%) |
| STRESS | pilot | −$3,994 (-200.7%) | −$4,193 (-210.7%) | −$4,293 (-215.7%) | −$4,392 (-220.7%) |

## 5. Carteira inteira (2.850 pagos + 40 de reserva, que consomem serviço sem receita)

| cenário | receita bruta | custo econômico total | resultado com referral 0% | 10% | 15% | 20% |
|---|---|---|---|---|---|---|
| EXPECTED | $796,250 | $432,993 | $363,257 | $283,632 | $243,820 | $204,007 |
| HEAVY | $796,250 | $1,322,722 | −$526,472 | −$606,097 | −$645,910 | −$685,722 |
| STRESS | $796,250 | $2,791,763 | −$1,995,513 | −$2,075,138 | −$2,114,950 | −$2,154,763 |

## 6. Reserva de serviço — cobertura do passivo de 36 meses

Passivo = CASH + HUMANO de 36 meses por holder (o FIXO é da plataforma, não do holder). Cobertura = reserva ÷ passivo.
A proposta **orientada a passivo** reserva o passivo HEAVY + 20%, expresso em % do preço.

| plano | passivo EXPECTED | passivo HEAVY | passivo STRESS | 40/35/15 → cobertura E/H/S | 25/20/10 → cobertura E/H/S | orientada a passivo (% do preço) |
|---|---|---|---|---|---|---|
| pro | $85.00 | $267 | $527 | $59.60: 0.70× / 0.22× / 0.11× | $37.25: 0.44× / 0.14× / 0.07× | 214.7% ($320) |
| trader | $244 | $711 | $1,473 | $140: 0.57× / 0.20× / 0.09× | $79.80: 0.33× / 0.11× / 0.05× | 213.7% ($853) |
| pilot | $697 | $2,364 | $5,983 | $299: 0.43× / 0.13× / 0.05× | $199: 0.29× / 0.08× / 0.03× | 142.5% ($2,837) |

## 7. Leitura (gerada dos números acima)

- **EXPECTED** — pro: CASH 14.8% do preço, econômico 58.3%, maior linha = humano; trader: CASH 13.8% do preço, econômico 61.6%, maior linha = humano; pilot: CASH 3.4% do preço, econômico 35.1%, maior linha = humano.
- **HEAVY** — pro: CASH 52.0% do preço, econômico 180.1%, maior linha = humano; trader: CASH 51.8% do preço, econômico 178.6%, maior linha = humano; pilot: CASH 23.8% do preço, econômico 118.9%, maior linha = humano.
- **STRESS** — pro: CASH 99.7% do preço, econômico 354.6%, maior linha = humano; trader: CASH 116.5% do preço, econômico 369.6%, maior linha = humano; pilot: CASH 110.7% do preço, econômico 300.7%, maior linha = humano.
- O Workbench do Pilot em STRESS (orçamento de unidades do CE-05 usado todo dia) custa $1,869 em 36 meses, 93.9% do preço — o orçamento atual limita o abuso, mas não o bastante para o Pilot (risco CE-05-R1).
- Trocar Kimi por Sonnet multiplica a linha do ZION por ~5.4× (EXPECTED).
- O HUMANO depende inteiramente de `horaHumanaUsd` e das horas por plano, que são hipóteses: o dono precisa fixá-las antes de qualquer conclusão sobre margem.

