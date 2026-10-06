# FOUNDERS SUPPORT AND ECONOMICS — MODEL OUTPUT

> Gerado por `node scripts/cost/modelo-founders-suporte-36m.mjs`. Não editar à mão.
> Cenário de planejamento, não parecer contábil/jurídico. Custos de staffing são autoritativos em BRL; USD usa câmbio assumido.

## Staffing models

| modelo | desenho | folha/benefícios/ferramentas 36m | treinamento EXTRA | horas de treinamento já cobertas pela folha | total 36m | horas produtivas 36m |
|---|---|---:|---:|---:|---:|---:|
| S1_LEAN | 2 L1 desde o início; terceira pessoa somente quando o gatilho operacional for atingido | R$ 435.281 | R$ 18.600 | 240 h | R$ 453.881 | 8.432 |
| S2_CEO_PLAN | 3 L1 desde o início, salário-base inicial de R$3.000 por pessoa | R$ 652.922 | R$ 27.900 | 360 h | R$ 680.822 | 12.649 |
| S3_MATURE | 2 L1 + 1 L2/lead qualificado desde o início | R$ 776.170 | R$ 27.300 | 320 h | R$ 803.470 | 12.649 |

As horas de treinamento já são remuneradas na folha e reduzem a capacidade pelo ramp; não são cobradas novamente. `treinamento EXTRA` contém somente recrutamento, curso/material e supervisão adicional.

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
| EXPECTED | pro | $0.09 | $37.10 | $0.08 | $17.38 | $0.18 | $0.74 | $1.79 | $5.66 | **$63.03** | 42.3% |
| EXPECTED | trader | $0.37 | $92.75 | $0.34 | $41.71 | $0.44 | $1.78 | $1.79 | $5.66 | **$144.85** | 36.3% |
| EXPECTED | pilot | $1.13 | $111.30 | $1.02 | $121.65 | $1.29 | $5.20 | $1.79 | $5.66 | **$249.04** | 12.5% |
| HEAVY | pro | $5.13 | $121.80 | $4.61 | $26.56 | $3.68 | $1.13 | $1.79 | $5.66 | **$170.37** | 114.3% |
| HEAVY | trader | $25.67 | $304.50 | $23.04 | $61.97 | $8.59 | $2.65 | $1.79 | $5.66 | **$433.88** | 108.7% |
| HEAVY | pilot | $256.61 | $365.40 | $230.43 | $177.05 | $24.55 | $7.57 | $1.79 | $5.66 | **$1,069.06** | 53.7% |
| STRESS | pro | $37.38 | $186.37 | $33.43 | $33.36 | $30.07 | $1.17 | $1.79 | $5.66 | **$329.24** | 221.0% |
| STRESS | trader | $186.91 | $465.93 | $167.16 | $71.49 | $64.43 | $2.51 | $1.79 | $5.66 | **$965.89** | 242.1% |
| STRESS | pilot | $469.75 | $559.12 | $424.54 | $190.64 | $171.82 | $6.71 | $1.79 | $5.66 | **$1,830.03** | 92.0% |

## Referral sensitivity per paid pass

| cenário | tier | 0% | 10% | 15% | 20% |
|---|---|---:|---:|---:|---:|
| EXPECTED | pro | $85.97 | $71.07 | $63.62 | $56.17 |
| EXPECTED | trader | $254.15 | $214.25 | $194.30 | $174.35 |
| EXPECTED | pilot | $1,740.96 | $1,541.96 | $1,442.46 | $1,342.96 |
| HEAVY | pro | $-21.37 | $-36.27 | $-43.72 | $-51.17 |
| HEAVY | trader | $-34.88 | $-74.78 | $-94.73 | $-114.68 |
| HEAVY | pilot | $920.94 | $721.94 | $622.44 | $522.94 |
| STRESS | pro | $-180.24 | $-195.14 | $-202.59 | $-210.04 |
| STRESS | trader | $-566.89 | $-606.79 | $-626.74 | $-646.69 |
| STRESS | pilot | $159.97 | $-39.03 | $-138.53 | $-238.03 |

## CEO/expert escalation sensitivity (36 months, full portfolio)

| cenário | 0.5% | 1% | 2% | 5% |
|---|---:|---:|---:|---:|
| EXPECTED | R$ 4.611 | R$ 9.222 | R$ 18.444 | R$ 46.109 |
| HEAVY | R$ 22.629 | R$ 45.259 | R$ 90.518 | R$ 226.294 |
| STRESS | R$ 69.954 | R$ 139.907 | R$ 279.815 | R$ 699.536 |

## Service reserve from remaining liability

A reserva é capital segregado para pagar custos futuros, não um custo novo. A obrigação remanescente soma front-loaded ainda não incorrido, folha/serviço mensal futuro, AI, compute, DB/cloud, fixed ops e volume/escalation esperados. Folha usa a grade mensal real; DB/cloud usa a curva de storage. O modelo deve ser recalculado periodicamente com custos incorridos e uso observado.

| meses prestados | passivo EXPECTED remanescente | ×1,10 | ×1,25 | ×1,50 |
|---:|---:|---:|---:|---:|
| 0 | $262,948.76 | $289,243.64 | $328,685.95 | $394,423.15 |
| 1 | $252,505.84 | $277,756.42 | $315,632.30 | $378,758.76 |
| 3 | $238,381.23 | $262,219.35 | $297,976.53 | $357,571.84 |
| 12 | $174,780.97 | $192,259.07 | $218,476.21 | $262,171.45 |
| 24 | $88,300.77 | $97,130.84 | $110,375.96 | $132,451.15 |
| 36 | $0.00 | $0.00 | $0.00 | $0.00 |

Opção híbrida P90/uso observado: definida, mas **não calculável sem telemetria real**. Ela usa o maior entre expected ajustado pelo run-rate observado e P90 empírico, mais buffer de execução. HEAVY permanece cenário de risco e não vira reserva automática.

### Initial per-pass sensitivity (model output, not policy)

| tier | obrigação expected/pass | ×1,10 | ×1,25 | ×1,50 |
|---|---:|---:|---:|---:|
| pro | $63.03 | $69.34 | $78.79 | $94.55 |
| trader | $144.85 | $159.34 | $181.06 | $217.28 |
| pilot | $249.04 | $273.94 | $311.30 | $373.56 |

## Capital policy reconciliation

A Service Reserve é reconciliada dentro da política de capital já existente. Não se soma uma segunda reserva aos 100% do caixa. D/E/F/K (infra, IA, equipe e operações) oferecem R$ 1.520.000 de cobertura já alocada; eventual excesso exige reclassificação formal de outros baldes, nunca capital fictício.

| buffer | gross proceeds | tax/regulatory | service liability reserve | emergency + CEO runway | deployable corporate capital | reallocation required | soma | > gross? |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10.0% | R$ 4.149.100 | R$ 747.000 | R$ 1.590.840 | R$ 862.100 | R$ 949.160 | R$ 70.840 | R$ 4.149.100 | NO |
| 25.0% | R$ 4.149.100 | R$ 747.000 | R$ 1.807.773 | R$ 862.100 | R$ 732.227 | R$ 287.773 | R$ 4.149.100 | NO |
| 50.0% | R$ 4.149.100 | R$ 747.000 | R$ 2.169.327 | R$ 862.100 | R$ 370.673 | R$ 649.327 | R$ 4.149.100 | NO |

A linha tributária é somente reserva de planejamento; não decide tratamento fiscal. Nenhum buffer foi aprovado como percentual final.
## Portfolio result

| cenário | receita bruta paga | custo 2.890 holders | 0% referral | 10% | 15% | 20% |
|---|---:|---:|---:|---:|---:|---:|
| EXPECTED | $796,250.00 | $262,948.76 | $533,301.24 | $453,676.24 | $413,863.74 | $374,051.24 |
| HEAVY | $796,250.00 | $782,507.20 | $13,742.80 | $-65,882.20 | $-105,694.70 | $-145,507.20 |
| STRESS | $796,250.00 | $1,585,444.87 | $-789,194.87 | $-868,819.87 | $-908,632.37 | $-948,444.87 |
