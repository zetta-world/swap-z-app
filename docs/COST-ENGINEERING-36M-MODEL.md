# Modelo de custo de 36 meses — COST ENGINEERING ROUND (CE-15)

> Gerado por `node scripts/cost/modelo-36-meses.mjs` a partir de `scripts/cost/premissas-36-meses.json`. Não editar à mão.
> **Matemática, não política:** preços (provisórios), supply, referral e reserva são ENTRADAS. Nenhum número aqui é decisão aprovada.
> Valores por HOLDER, em USD, somados nos 36 meses. Fonte de cada premissa no JSON (MEASURED / ESTIMATED / DECISAO).

## 1. Custo unitário

| item | valor | fonte |
|---|---|---|
| uma análise ZION (Kimi), EXPECTED | $0.0113 | tokens: prefixo MEASURED, payload/saída ESTIMATED |
| uma análise ZION (Kimi), HEAVY | $0.0139 | tokens: prefixo MEASURED, payload/saída ESTIMATED |
| uma análise ZION (Kimi), STRESS | $0.0170 | tokens: prefixo MEASURED, payload/saída ESTIMATED |
| uma análise ZION (Sonnet, sensibilidade), EXPECTED | $0.0379 | ESTIMATED |
| uma análise ZION (Sonnet, sensibilidade), HEAVY | $0.0473 | ESTIMATED |
| uma análise ZION (Sonnet, sensibilidade), STRESS | $0.0585 | ESTIMATED |
| uma vela lida e processada no Workbench, depois | $7.78e-9 | egress domina |
| CPU de uma vela (estratégia própria), antes → depois | $1.84e-8 → $7.50e-11 | MEASURED (CE-03) |
| CPU de uma barra (modo mesa), antes → depois | $2.21e-8 → $1.45e-9 | MEASURED (CE-03) |
| uma mesa de papel por mês (EXPECTED) | $0.0004 | tique MEASURED (CE-10) |
| fixos da plataforma por holder (36 meses, 2890 holders) | $1.79 | ESTIMATED ($144/mês) |

## 2. Custo de 36 meses por holder

| cenário | plano | preço | ZION | Workbench | papel | armazenamento | **CASH** | CASH/preço | HUMANO | FIXO | **ECONÔMICO** | econômico/preço |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EXPECTED | pro | $149 | $37.10 | $0.0885 | $0.0000 | $0.0848 | **$37.27** | 25.0% | $63.00 | $1.79 | **$102** | 68.5% |
| EXPECTED | trader | $399 | $92.75 | $0.3539 | $0.0202 | $0.3391 | **$93.46** | 23.4% | $189 | $1.79 | **$284** | 71.2% |
| EXPECTED | pilot | $1,990 | $111 | $1.06 | $0.0674 | $1.02 | **$113** | 5.7% | $630 | $1.79 | **$745** | 37.4% |
| HEAVY | pro | $149 | $122 | $5.13 | $0.0000 | $4.61 | **$132** | 88.3% | $189 | $1.79 | **$322** | 216.3% |
| HEAVY | trader | $399 | $305 | $25.65 | $0.0202 | $23.04 | **$353** | 88.5% | $504 | $1.79 | **$859** | 215.3% |
| HEAVY | pilot | $1,990 | $365 | $257 | $0.0674 | $230 | **$852** | 42.8% | $1,890 | $1.79 | **$2,744** | 137.9% |
| STRESS | pro | $149 | $186 | $37.38 | $0.0000 | $33.43 | **$257** | 172.6% | $378 | $1.79 | **$637** | 427.5% |
| STRESS | trader | $399 | $466 | $187 | $0.0202 | $167 | **$820** | 205.5% | $1,008 | $1.79 | **$1,830** | 458.6% |
| STRESS | pilot | $1,990 | $559 | $470 | $0.0674 | $425 | **$1,453** | 73.0% | $3,780 | $1.79 | **$5,235** | 263.1% |

ZION com Sonnet (sensibilidade de provedor), 36 meses: pro E $124 / H $414 / S $640 · trader E $311 / H $1,036 / S $1,601 · pilot E $373 / H $1,243 / S $1,921

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
| EXPECTED | pro | $46.93 (31.5%) | $32.03 (21.5%) | $24.58 (16.5%) | $17.13 (11.5%) |
| EXPECTED | trader | $115 (28.8%) | $74.84 (18.8%) | $54.89 (13.8%) | $34.94 (8.8%) |
| EXPECTED | pilot | $1,245 (62.6%) | $1,046 (52.6%) | $946 (47.6%) | $847 (42.6%) |
| HEAVY | pro | −$173 (-116.3%) | −$188 (-126.3%) | −$196 (-131.3%) | −$203 (-136.3%) |
| HEAVY | trader | −$460 (-115.3%) | −$500 (-125.3%) | −$520 (-130.3%) | −$540 (-135.3%) |
| HEAVY | pilot | −$754 (-37.9%) | −$953 (-47.9%) | −$1,053 (-52.9%) | −$1,152 (-57.9%) |
| STRESS | pro | −$488 (-327.5%) | −$503 (-337.5%) | −$510 (-342.5%) | −$518 (-347.5%) |
| STRESS | trader | −$1,431 (-358.6%) | −$1,471 (-368.6%) | −$1,491 (-373.6%) | −$1,511 (-378.6%) |
| STRESS | pilot | −$3,245 (-163.1%) | −$3,444 (-173.1%) | −$3,544 (-178.1%) | −$3,643 (-183.1%) |

## 5. Carteira inteira (2.850 pagos + 40 de reserva, que consomem serviço sem receita)

| cenário | receita bruta | custo econômico total | resultado com referral 0% | 10% | 15% | 20% |
|---|---|---|---|---|---|---|
| EXPECTED | $796,250 | $497,753 | $298,497 | $218,872 | $179,060 | $139,247 |
| HEAVY | $796,250 | $1,581,610 | −$785,360 | −$864,985 | −$904,798 | −$944,610 |
| STRESS | $796,250 | $3,207,227 | −$2,410,977 | −$2,490,602 | −$2,530,415 | −$2,570,227 |

## 6. Reserva de serviço — cobertura do passivo de 36 meses

Passivo = CASH + HUMANO de 36 meses por holder (o FIXO é da plataforma, não do holder). Cobertura = reserva ÷ passivo.
A proposta **orientada a passivo** reserva o passivo HEAVY + 20%, expresso em % do preço.

| plano | passivo EXPECTED | passivo HEAVY | passivo STRESS | 40/35/15 → cobertura E/H/S | 25/20/10 → cobertura E/H/S | orientada a passivo (% do preço) |
|---|---|---|---|---|---|---|
| pro | $100 | $321 | $635 | $59.60: 0.59× / 0.19× / 0.09× | $37.25: 0.37× / 0.12× / 0.06× | 258.2% ($385) |
| trader | $282 | $857 | $1,828 | $140: 0.49× / 0.16× / 0.08× | $79.80: 0.28× / 0.09× / 0.04× | 257.8% ($1,029) |
| pilot | $743 | $2,742 | $5,233 | $299: 0.40× / 0.11× / 0.06× | $199: 0.27× / 0.07× / 0.04× | 165.4% ($3,291) |

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
| EXPECTED | pro | $2.84 | $7.90 | 35.9% |
| EXPECTED | trader | $7.90 | $20.90 | 37.8% |
| EXPECTED | pilot | $20.70 | $159 | 13.0% |
| HEAVY | pro | $8.95 | $7.90 | 113.3% |
| HEAVY | trader | $23.86 | $20.90 | 114.2% |
| HEAVY | pilot | $76.23 | $159 | 47.9% |
| STRESS | pro | $17.69 | $7.90 | 224.0% |
| STRESS | trader | $50.83 | $20.90 | 243.2% |
| STRESS | pilot | $145 | $159 | 91.5% |

## 9. Leitura (gerada dos números acima)

- **EXPECTED** — pro: CASH 25.0% do preço, econômico 68.5%, maior linha = humano; trader: CASH 23.4% do preço, econômico 71.2%, maior linha = humano; pilot: CASH 5.7% do preço, econômico 37.4%, maior linha = humano.
- **HEAVY** — pro: CASH 88.3% do preço, econômico 216.3%, maior linha = humano; trader: CASH 88.5% do preço, econômico 215.3%, maior linha = humano; pilot: CASH 42.8% do preço, econômico 137.9%, maior linha = humano.
- **STRESS** — pro: CASH 172.6% do preço, econômico 427.5%, maior linha = humano; trader: CASH 205.5% do preço, econômico 458.6%, maior linha = humano; pilot: CASH 73.0% do preço, econômico 263.1%, maior linha = humano.
- O Workbench do Pilot em STRESS (orçamento de unidades do CE-05/CE-15 usado todo dia, fração 1/16) custa $470 em 36 meses, 23.6% do preço; com a fração uniforme de ¼ seriam ~4× isso (ver o relatório, CE-05-R1).
- Trocar Kimi por Sonnet multiplica a linha do ZION por ~3.4× (EXPECTED).
- O HUMANO depende inteiramente de `horaHumanaUsd` e das horas por plano, que são hipóteses: o dono precisa fixá-las antes de qualquer conclusão sobre margem.

## 10. Quebra por categoria (AUDIT REMEDIATION §20) — 36 meses por holder

MÁQUINA = Workbench (CPU + egress + espera no banco) + papel (tique) · IA = ZION · BANCO/INFRA = armazenamento · HUMANO = suporte · FIXO = rateio dos fixos mensais.

| cenário | plano | máquina | IA | banco/infra | humano | fixo | **econômico** | humano/econômico |
|---|---|---|---|---|---|---|---|---|
| EXPECTED | pro | $0.0885 | $37.10 | $0.0848 | $63.00 | $1.79 | **$102** | 61.7% |
| EXPECTED | trader | $0.3741 | $92.75 | $0.3391 | $189 | $1.79 | **$284** | 66.5% |
| EXPECTED | pilot | $1.13 | $111 | $1.02 | $630 | $1.79 | **$745** | 84.5% |
| HEAVY | pro | $5.13 | $122 | $4.61 | $189 | $1.79 | **$322** | 58.6% |
| HEAVY | trader | $25.67 | $305 | $23.04 | $504 | $1.79 | **$859** | 58.7% |
| HEAVY | pilot | $257 | $365 | $230 | $1,890 | $1.79 | **$2,744** | 68.9% |
| STRESS | pro | $37.38 | $186 | $33.43 | $378 | $1.79 | **$637** | 59.3% |
| STRESS | trader | $187 | $466 | $167 | $1,008 | $1.79 | **$1,830** | 55.1% |
| STRESS | pilot | $470 | $559 | $425 | $3,780 | $1.79 | **$5,235** | 72.2% |

## 11. Suporte humano — definição e sensibilidade (hipótese econômica, NÃO contrato)

Direção comercial provisória (DIRECAO_COMERCIAL_PROVISORIA (mandato da AUDIT REMEDIATION, 05/10/2026) — NÃO é contrato; só define o que a hipótese de horas cobre):

- **pro**: suporte padrão assíncrono.
- **trader**: fila prioritária assíncrona.
- **pilot**: prioridade máxima assíncrona + incidentes de produto.
- Em todos: sem 24/7; sem SLA financeiro; sem concierge; sem consultoria de trading; sem execução de estratégia pelo CEO; sem chamada privada garantida; sem suporte humano ilimitado; ZION como primeira linha.

As horas por plano e cenário (cenarios.*.suporteHorasMes) e o custo da hora (precos.horaHumanaUsd) NÃO foram alterados: a definição diz o que elas cobrem, não as torna menores. Sensibilidade das horas na tabela da seção 11 do modelo.

Margem com referral 0% conforme as horas de suporte (× as horas da premissa; hora a $35.00):

| cenário | plano | horas × 0 | horas × 0.25 | horas × 0.5 | horas × 1 | horas × 2 |
|---|---|---|---|---|---|---|
| EXPECTED | pro | $110 (73.8%) | $94.18 (63.2%) | $78.43 (52.6%) | $46.93 (31.5%) | −$16.07 (-10.8%) |
| EXPECTED | trader | $304 (76.1%) | $256 (64.3%) | $209 (52.4%) | $115 (28.8%) | −$74.26 (-18.6%) |
| EXPECTED | pilot | $1,875 (94.2%) | $1,717 (86.3%) | $1,560 (78.4%) | $1,245 (62.6%) | $615 (30.9%) |
| HEAVY | pro | $15.67 (10.5%) | −$31.58 (-21.2%) | −$78.83 (-52.9%) | −$173 (-116.3%) | −$362 (-243.2%) |
| HEAVY | trader | $43.99 (11.0%) | −$82.01 (-20.6%) | −$208 (-52.1%) | −$460 (-115.3%) | −$964 (-241.6%) |
| HEAVY | pilot | $1,136 (57.1%) | $663 (33.3%) | $191 (9.6%) | −$754 (-37.9%) | −$2,644 (-132.9%) |
| STRESS | pro | −$110 (-73.8%) | −$204 (-137.2%) | −$299 (-200.7%) | −$488 (-327.5%) | −$866 (-581.2%) |
| STRESS | trader | −$423 (-106.0%) | −$675 (-169.1%) | −$927 (-232.3%) | −$1,431 (-358.6%) | −$2,439 (-611.2%) |
| STRESS | pilot | $535 (26.9%) | −$410 (-20.6%) | −$1,355 (-68.1%) | −$3,245 (-163.1%) | −$7,025 (-353.0%) |

