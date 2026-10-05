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

| cenário | plano | preço | ZION | Workbench | papel | armazenamento | **CASH** | CASH/preço | HUMANO | FIXO | **ECONÔMICO** | econômico/preço |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EXPECTED | pro | $149 | $21.92 | $0.0885 | $0.0000 | $0.0848 | **$22.09** | 14.8% | $63.00 | $1.79 | **$86.88** | 58.3% |
| EXPECTED | trader | $399 | $54.79 | $0.3539 | $0.0202 | $0.3391 | **$55.50** | 13.9% | $189 | $1.79 | **$246** | 61.7% |
| EXPECTED | pilot | $1,990 | $65.75 | $1.06 | $0.0674 | $1.02 | **$67.89** | 3.4% | $630 | $1.79 | **$700** | 35.2% |
| HEAVY | pro | $149 | $72.40 | $5.13 | $0.0000 | $4.61 | **$82.14** | 55.1% | $189 | $1.79 | **$273** | 183.2% |
| HEAVY | trader | $399 | $181 | $25.65 | $0.0202 | $23.04 | **$230** | 57.6% | $504 | $1.79 | **$736** | 184.3% |
| HEAVY | pilot | $1,990 | $217 | $257 | $0.0674 | $230 | **$704** | 35.4% | $1,890 | $1.79 | **$2,596** | 130.5% |
| STRESS | pro | $149 | $111 | $37.38 | $0.0000 | $33.43 | **$182** | 122.1% | $378 | $1.79 | **$562** | 377.0% |
| STRESS | trader | $399 | $278 | $187 | $0.0202 | $167 | **$632** | 158.4% | $1,008 | $1.79 | **$1,642** | 411.5% |
| STRESS | pilot | $1,990 | $334 | $470 | $0.0674 | $425 | **$1,228** | 61.7% | $3,780 | $1.79 | **$5,010** | 251.7% |

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
| STRESS | pilot | 54,750,000 | $1,105 | $4.49 |

## 4. Margem por plano (preço − referral − custo econômico de 36 meses)

| cenário | plano | referral 0% | 10% | 15% | 20% |
|---|---|---|---|---|---|
| EXPECTED | pro | $62.12 (41.7%) | $47.22 (31.7%) | $39.77 (26.7%) | $32.32 (21.7%) |
| EXPECTED | trader | $153 (38.3%) | $113 (28.3%) | $92.85 (23.3%) | $72.90 (18.3%) |
| EXPECTED | pilot | $1,290 (64.8%) | $1,091 (54.8%) | $992 (49.8%) | $892 (44.8%) |
| HEAVY | pro | −$124 (-83.2%) | −$139 (-93.2%) | −$146 (-98.2%) | −$154 (-103.2%) |
| HEAVY | trader | −$337 (-84.3%) | −$376 (-94.3%) | −$396 (-99.3%) | −$416 (-104.3%) |
| HEAVY | pilot | −$606 (-30.5%) | −$805 (-40.5%) | −$905 (-45.5%) | −$1,004 (-50.5%) |
| STRESS | pro | −$413 (-277.0%) | −$428 (-287.0%) | −$435 (-292.0%) | −$443 (-297.0%) |
| STRESS | trader | −$1,243 (-311.5%) | −$1,283 (-321.5%) | −$1,303 (-326.5%) | −$1,323 (-331.5%) |
| STRESS | pilot | −$3,020 (-151.7%) | −$3,219 (-161.7%) | −$3,318 (-166.7%) | −$3,418 (-171.7%) |

## 5. Carteira inteira (2.850 pagos + 40 de reserva, que consomem serviço sem receita)

| cenário | receita bruta | custo econômico total | resultado com referral 0% | 10% | 15% | 20% |
|---|---|---|---|---|---|---|
| EXPECTED | $796,250 | $433,524 | $362,726 | $283,101 | $243,288 | $203,476 |
| HEAVY | $796,250 | $1,372,633 | −$576,383 | −$656,008 | −$695,821 | −$735,633 |
| STRESS | $796,250 | $2,889,205 | −$2,092,955 | −$2,172,580 | −$2,212,393 | −$2,252,205 |

## 6. Reserva de serviço — cobertura do passivo de 36 meses

Passivo = CASH + HUMANO de 36 meses por holder (o FIXO é da plataforma, não do holder). Cobertura = reserva ÷ passivo.
A proposta **orientada a passivo** reserva o passivo HEAVY + 20%, expresso em % do preço.

| plano | passivo EXPECTED | passivo HEAVY | passivo STRESS | 40/35/15 → cobertura E/H/S | 25/20/10 → cobertura E/H/S | orientada a passivo (% do preço) |
|---|---|---|---|---|---|---|
| pro | $85.09 | $271 | $560 | $59.60: 0.70× / 0.22× / 0.11× | $37.25: 0.44× / 0.14× / 0.07× | 218.4% ($325) |
| trader | $245 | $734 | $1,640 | $140: 0.57× / 0.19× / 0.09× | $79.80: 0.33× / 0.11× / 0.05× | 220.7% ($880) |
| pilot | $698 | $2,594 | $5,008 | $299: 0.43× / 0.12× / 0.06× | $199: 0.29× / 0.08× / 0.04× | 156.4% ($3,113) |

## 7. Armazenamento: sem retenção × retenção de operações (PROPOSTA, não implementada)

Cada backtest grava a rodada, o resultado e TODAS as operações (`bancada_operacao`); nada tem retenção hoje. A proposta mantém o detalhe das operações por 3 meses e o resumo para sempre — exige decisão do dono (dado do cliente).

| cenário | plano | GB/mês gravados | 36 meses sem retenção | com retenção |
|---|---|---|---|---|
| EXPECTED | pro | 0.001 | $0.0848 | $0.0208 |
| EXPECTED | trader | 0.004 | $0.3391 | $0.0833 |
| EXPECTED | pilot | 0.012 | $1.02 | $0.2499 |
| HEAVY | pro | 0.055 | $4.61 | $0.7713 |
| HEAVY | trader | 0.277 | $23.04 | $3.86 |
| HEAVY | pilot | 2.768 | $230 | $38.57 |
| STRESS | pro | 0.402 | $33.43 | $5.42 |
| STRESS | trader | 2.008 | $167 | $27.10 |
| STRESS | pilot | 5.100 | $425 | $74.39 |

## 8. Comparação com a assinatura mensal (Hird, preço do código)

| cenário | plano | custo econômico por mês | preço mensal | custo/preço |
|---|---|---|---|---|
| EXPECTED | pro | $2.41 | $7.90 | 30.5% |
| EXPECTED | trader | $6.84 | $20.90 | 32.7% |
| EXPECTED | pilot | $19.44 | $159 | 12.2% |
| HEAVY | pro | $7.58 | $7.90 | 96.0% |
| HEAVY | trader | $20.43 | $20.90 | 97.8% |
| HEAVY | pilot | $72.11 | $159 | 45.4% |
| STRESS | pro | $15.61 | $7.90 | 197.5% |
| STRESS | trader | $45.61 | $20.90 | 218.2% |
| STRESS | pilot | $139 | $159 | 87.5% |

## 9. Leitura (gerada dos números acima)

- **EXPECTED** — pro: CASH 14.8% do preço, econômico 58.3%, maior linha = humano; trader: CASH 13.9% do preço, econômico 61.7%, maior linha = humano; pilot: CASH 3.4% do preço, econômico 35.2%, maior linha = humano.
- **HEAVY** — pro: CASH 55.1% do preço, econômico 183.2%, maior linha = humano; trader: CASH 57.6% do preço, econômico 184.3%, maior linha = humano; pilot: CASH 35.4% do preço, econômico 130.5%, maior linha = humano.
- **STRESS** — pro: CASH 122.1% do preço, econômico 377.0%, maior linha = humano; trader: CASH 158.4% do preço, econômico 411.5%, maior linha = humano; pilot: CASH 61.7% do preço, econômico 251.7%, maior linha = humano.
- O Workbench do Pilot em STRESS (orçamento de unidades do CE-05/CE-15 usado todo dia, fração 1/16) custa $470 em 36 meses, 23.6% do preço; com a fração uniforme de ¼ seriam ~4× isso (ver o relatório, CE-05-R1).
- Trocar Kimi por Sonnet multiplica a linha do ZION por ~5.4× (EXPECTED).
- O HUMANO depende inteiramente de `horaHumanaUsd` e das horas por plano, que são hipóteses: o dono precisa fixá-las antes de qualquer conclusão sobre margem.

