# FOUNDERS SUPPORT AND ECONOMICS — MODEL OUTPUT

> Gerado por `node scripts/cost/modelo-founders-suporte-36m.mjs`. Não editar à mão.
> Cenário de planejamento, não parecer contábil/jurídico. Custos de staffing são autoritativos em BRL; USD usa câmbio assumido.

## Staffing models

| modelo | desenho | suporte 36m | treinamento/ramp | total 36m | horas produtivas 36m |
|---|---|---:|---:|---:|---:|
| S1_LEAN | 2 L1 desde o início; terceira pessoa somente quando o gatilho operacional for atingido | R$ 435.281 | R$ 25.742 | R$ 461.023 | 8.432 |
| S2_CEO_PLAN | 3 L1 desde o início, salário-base inicial de R$3.000 por pessoa | R$ 652.922 | R$ 38.613 | R$ 691.535 | 12.649 |
| S3_MATURE | 2 L1 + 1 L2/lead qualificado desde o início | R$ 776.170 | R$ 38.088 | R$ 814.258 | 12.649 |

## Capacity and ZION deflection

| cenário | deflexão | tickets humanos/mês | horas humanas/mês | capacidade do staffing/mês (steady) | utilização | leitura |
|---|---:|---:|---:|---:|---:|---|
| EXPECTED | 30.0% | 159 | 53.1 | 241.6 | 22.0% | capacidade operacional |
| EXPECTED | 50.0% | 114 | 38.0 | 241.6 | 15.7% | capacidade operacional |
| EXPECTED | 70.0% | 68 | 22.8 | 241.6 | 9.4% | capacidade operacional |
| EXPECTED | 85.0% | 34 | 11.4 | 241.6 | 4.7% | capacidade operacional |
| HEAVY | 30.0% | 469 | 195.6 | 362.4 | 54.0% | capacidade operacional |
| HEAVY | 50.0% | 335 | 139.7 | 362.4 | 38.5% | capacidade operacional |
| HEAVY | 70.0% | 201 | 83.8 | 362.4 | 23.1% | capacidade operacional |
| HEAVY | 85.0% | 101 | 41.9 | 362.4 | 11.6% | capacidade operacional |
| STRESS | 30.0% | 1036 | 518.2 | 362.4 | 143.0% | BACKLOG PROVÁVEL |
| STRESS | 50.0% | 740 | 370.1 | 362.4 | 102.1% | BACKLOG PROVÁVEL |
| STRESS | 70.0% | 444 | 222.1 | 362.4 | 61.3% | capacidade operacional |
| STRESS | 85.0% | 222 | 111.0 | 362.4 | 30.6% | capacidade operacional |

## 36-month economic cost per holder (USD)

| cenário | tier | compute | AI | database/cloud | support L1/L2 | CEO/expert | training | fixed | other ops | **total** | total/preço |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| EXPECTED | pro | $0.09 | $37.10 | $0.08 | $17.38 | $0.18 | $1.03 | $1.79 | $5.66 | **$63.32** | 42.5% |
| EXPECTED | trader | $0.37 | $92.75 | $0.34 | $41.71 | $0.44 | $2.47 | $1.79 | $5.66 | **$145.53** | 36.5% |
| EXPECTED | pilot | $1.13 | $111.30 | $1.02 | $121.65 | $1.29 | $7.19 | $1.79 | $5.66 | **$251.03** | 12.6% |
| HEAVY | pro | $5.13 | $121.80 | $4.61 | $26.56 | $3.68 | $1.57 | $1.79 | $5.66 | **$170.81** | 114.6% |
| HEAVY | trader | $25.67 | $304.50 | $23.04 | $61.97 | $8.59 | $3.66 | $1.79 | $5.66 | **$434.90** | 109.0% |
| HEAVY | pilot | $256.61 | $365.40 | $230.43 | $177.05 | $24.55 | $10.47 | $1.79 | $5.66 | **$1,071.97** | 53.9% |
| STRESS | pro | $37.38 | $186.37 | $33.43 | $33.36 | $30.07 | $1.64 | $1.79 | $5.66 | **$329.71** | 221.3% |
| STRESS | trader | $186.91 | $465.93 | $167.16 | $71.49 | $64.43 | $3.51 | $1.79 | $5.66 | **$966.89** | 242.3% |
| STRESS | pilot | $469.75 | $559.12 | $424.54 | $190.64 | $171.82 | $9.36 | $1.79 | $5.66 | **$1,832.68** | 92.1% |

## Referral sensitivity per paid pass

| cenário | tier | 0% | 10% | 15% | 20% |
|---|---|---:|---:|---:|---:|
| EXPECTED | pro | $85.68 | $70.78 | $63.33 | $55.88 |
| EXPECTED | trader | $253.47 | $213.57 | $193.62 | $173.67 |
| EXPECTED | pilot | $1,738.97 | $1,539.97 | $1,440.47 | $1,340.97 |
| HEAVY | pro | $-21.81 | $-36.71 | $-44.16 | $-51.61 |
| HEAVY | trader | $-35.90 | $-75.80 | $-95.75 | $-115.70 |
| HEAVY | pilot | $918.03 | $719.03 | $619.53 | $520.03 |
| STRESS | pro | $-180.71 | $-195.61 | $-203.06 | $-210.51 |
| STRESS | trader | $-567.89 | $-607.79 | $-627.74 | $-647.69 |
| STRESS | pilot | $157.32 | $-41.68 | $-141.18 | $-240.68 |

## CEO/expert escalation sensitivity (36 months, full portfolio)

| cenário | 0.5% | 1% | 2% | 5% |
|---|---:|---:|---:|---:|
| EXPECTED | R$ 4.611 | R$ 9.222 | R$ 18.444 | R$ 46.109 |
| HEAVY | R$ 22.629 | R$ 45.259 | R$ 90.518 | R$ 226.294 |
| STRESS | R$ 69.954 | R$ 139.907 | R$ 279.815 | R$ 699.536 |

## Service reserve from remaining liability

Regra: passivo econômico EXPECTED remanescente × 1.25. No fechamento da venda restam 36/36 meses; após `m` meses, multiplicar por `(36-m)/36`. Não inclui reserva fiscal, emergência, runway do CEO ou growth.

| tier | passivo EXPECTED 36m | buffer | reserva sugerida/pass | % do preço | carteira paga + reserva |
|---|---:|---:|---:|---:|---:|
| pro | $63.32 | 25.0% | $79.15 | 53.1% | $160,672.00 |
| trader | $145.53 | 25.0% | $181.92 | 45.6% | $138,257.95 |
| pilot | $251.03 | 25.0% | $313.79 | 15.8% | $31,379.18 |

## Portfolio result

| cenário | receita bruta paga | custo 2.890 holders | 0% referral | 10% | 15% | 20% |
|---|---:|---:|---:|---:|---:|---:|
| EXPECTED | $796,250.00 | $264,247.30 | $532,002.70 | $452,377.70 | $412,565.20 | $372,752.70 |
| HEAVY | $796,250.00 | $784,455.01 | $11,794.99 | $-67,830.01 | $-107,642.51 | $-147,455.01 |
| STRESS | $796,250.00 | $1,587,406.33 | $-791,156.33 | $-870,781.33 | $-910,593.83 | $-950,406.33 |
