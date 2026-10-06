# FOUNDERS SUPPORT & ECONOMICS CLOSURE

> **Data-base:** 06/10/2026
> **Escopo:** verdade comercial do Founders Pass e economia de serviço por 36 meses.
> **Estado:** candidato local recertificado pelo implementador no SHA exato
> `c2bfc4ab93801fc8084e952564afde0cde5ceae6`; auditoria independente,
> publicação, preço final e lançamento continuam pendentes/bloqueados.
> **Modelo reproduzível:** `node scripts/cost/modelo-founders-suporte-36m.mjs`.

## 1. EXECUTIVE VERDICT

A fonte comercial foi fechada com cinco estados explícitos. Somente
`AVAILABLE_AT_LAUNCH` pode ser apresentado como disponível. Autopilot CEX é
`IMPLEMENTED_DISABLED`; scanner de arbitragem é `A_CONFIRMAR`; automação
avançada do Pilot é `COMING_SOON_ROADMAP`. Pricing, página/preview da venda,
FAQ e fatos do ZION passam a derivar dessa classificação e têm regressões
contra promoção indevida.

Os preços **provisórios** de US$149 / US$399 / US$1.990 cobrem o cenário
EXPECTED. Eles não são robustos sem condicionantes: Pro e Trader ficam
negativos no HEAVY mesmo sem referral; no STRESS, Pilot conserva apenas uma
margem estreita sem referral e fica negativo já com 10%. Logo, os preços são
**sustentáveis no cenário esperado, condicionais para finalização comercial**.
Nenhum preço foi publicado ou alterado em produção.

Decisões diretas:

| pergunta | resposta |
|---|---|
| 3 pessoas a R$3.000 base bastam no full sale? | **Sim para EXPECTED/HEAVY.** Em STRESS precisam de deflexão ZION acima de ~51%; a meta prudente é 70%. |
| começar com 2 ou 3? | **2 L1**, com terceira contratação por gatilho. |
| custo mensal prudente | S1: **R$12.806/mês** médio all-in; S2: **R$19.209**; S3: **R$22.618**. |
| custo de suporte 36 meses | S1 **R$461.023**; S2 **R$691.535**; S3 **R$814.258** (inclui treinamento/ramp). |
| quanto o ZION precisa resolver? | meta **70%**; no STRESS, menos de ~51% sobrecarrega três pessoas. |
| referral 10% | **CONDICIONAL**, nunca automático; portfólio HEAVY já fica −US$67.830 se aplicado a toda venda. |
| referral 15% / 20% | **NÃO aprovar** antes de telemetria real e revisão de preço/limites. |
| service reserve | EXPECTED remanescente × **1,25**: Pro US$79,15; Trader US$181,92; Pilot US$313,79 por passe no início. |
| suporte humano é o maior risco? | **É um dos dois maiores**, junto com IA/compute em HEAVY/STRESS; o risco operacional dominante é deflexão não medida + staffing/ramp. |

## 2. COMMERCIAL TRUTH

### Estrutura econômica e temporal

| tier | supply pago | reserva não paga | preço provisório |
|---|---:|---:|---:|
| Pro | 2.000 | 30 | US$149 |
| Trader | 750 | 10 | US$399 |
| Pilot | 100 | 0 | US$1.990 |

- Premium: 36 meses exatos desde o encerramento oficial da venda.
- Transferência: muda o holder; **não** reinicia nem estende os 36 meses.
- Founder status: acompanha o passe e é duradouro.
- Premium: temporário.
- Preços: `PROVISIONAL_FOR_DEMAND_VALIDATION`; não são preço final.

### Estados fechados de benefício

| benefício | estado | tiers | verdade publicável |
|---|---|---|---|
| ZION advisory | AVAILABLE AT LAUNCH | Pro / Trader / Pilot | disponível, dentro das cotas do tier |
| CEX Autopilot | IMPLEMENTED / DISABLED | Pro / Trader / Pilot | implementado, desabilitado; nunca disponível no lançamento |
| Arb Scanner | A CONFIRMAR | Trader / Pilot | não é promessa de lançamento |
| Priority Support | AVAILABLE AT LAUNCH | Trader / Pilot | fila assíncrona prioritária; sem SLA rígido, 24/7, concierge ou CEO pessoal |
| Reduced Swap Fee | AVAILABLE AT LAUNCH | Pro / Trader / Pilot | apenas rotas EVM suportadas onde o mecanismo está ativo |
| Pilot Advanced Automation | COMING SOON / ROADMAP | Pilot | planejada, sujeita a safety gates e certificação |
| Founder badge on-chain | AVAILABLE AT LAUNCH | todos | status do passe |
| theme, Hall of Fame, early access, polls, beta, API limits | COMING SOON / ROADMAP | todos | planejados, sem data |
| royalty distribution, token allocation, allowlist garantida, treasury governance | NOT PART OF THE OFFER | nenhum | não oferecer |

Redes atualmente suportadas: Ethereum, Polygon, Arbitrum, Optimism, BNB
Chain, Base, Avalanche e Solana. ZETTA Chain é `COMING SOON`.

Taxa de plataforma nas rotas EVM suportadas onde o mecanismo está ativo:
Free 1,00%; Pro 0,50%; Trader 0,25%; Pilot 0,10%. Solana atualmente não cobra
Z-SWAP platform fee. Custos de rede continuam separados.

## 3. ALL COMMERCIAL SURFACES

| superfície | fonte/controle | resultado pretendido |
|---|---|---|
| fonte canônica | `src/lib/founders-commercial-truth.ts` | estado explícito por benefício, sem acoplar pricing ao motor isolado da venda |
| pricing | `PricingView.tsx` + `FounderBenefits.tsx` | textos de disabled/unconfirmed/roadmap; badge ativo não promove roadmap |
| Founders sale | `FoundersSalePage.tsx` | seções e ícones distintos por estado |
| preview/onboarding | `previa.ts` | listas separadas por estado |
| FAQ/copy | `messages.ts` em en/pt/es/zh | sem autopilot/arb como disponível |
| ZION | `fatos-da-plataforma.ts` | contexto derivado da fonte canônica |
| regressão | `commercial-truth.test.ts`, `founders-page.test.ts`, `fatos-da-plataforma.test.ts` | drift falha o teste |

Documentos antigos que preservam copy histórica devem ser lidos como evidência
histórica, não como oferta atual. A tabela desta seção e o código canônico
prevalecem para este fechamento.

## 4. ZION FACT SOURCE

O bloco de fatos agora distingue disponível, implementado/desabilitado, a
confirmar, roadmap e excluído. Também informa:

- a política exata de suporte prioritário;
- a definição padrão do Pilot;
- o escopo EVM da fee e a ausência de platform fee em Solana;
- que DEX/on-chain exige assinatura da wallet, enquanto CEX usa credencial e
  autorização própria com safety gates;
- que Autopilot CEX está desabilitado.

O ZION não pode converter nenhum estado inferior em “available”.

## 5. PRICING CONSISTENCY

Os cards de tier derivam os itens comerciais da mesma lista canônica. As
quatro línguas rotulam Autopilot como desabilitado, arbitragem como a confirmar
e suporte como assíncrono. A grade de benefícios Founder com ícone ativo mostra
somente itens `AVAILABLE_AT_LAUNCH`; roadmap permanece na seção própria.

O valor USD provisório continua oculto na página pública enquanto o status não
for `FINAL`; a preview local pode exibi-lo com rótulo explícito de simulação.

## 6. PILOT DEFINITION

Definição candidata, limitada e testável:

> **5.000 backtests padrão de estratégia própria por janela móvel de 24
> horas, com até 3 ativos × 365 dias × candles de 4h.**

Backtests maiores consomem proporcionalmente mais orçamento de dados. Modo Mesa
não suporta 5.000 sob a mesma definição e precisa de tratamento comercial
separado. O budget Pilot permanece **1/16**; não foi ampliado.

## 7. SUPPORT MODEL

Atendimento humano: segunda a sábado; sem promessa 24/7.

| camada | função |
|---|---|
| L0 | docs, FAQ e self-service |
| L1 | ZION para triagem e resolução elegível |
| L2 | equipe humana, com fila prioritária a partir do Trader |
| L3 | especialista técnico para casos que exigem engenharia/domínio |
| L4 | CEO/engenharia somente para incidente crítico |

A meta operacional interna é primeira resposta humana em até um dia útil. Não
é SLA contratual. O CEO não atende suporte comum.

## 8. STAFFING

| modelo | composição | custo 36m all-in | média/mês | horas produtivas steady/mês |
|---|---|---:|---:|---:|
| S1 LEAN | 2 L1; terceira por gatilho | R$461.023 | R$12.806 | 241,6 |
| S2 CEO PLAN | 3 L1 desde o início | R$691.535 | R$19.209 | 362,4 |
| S3 MATURE | 2 L1 + 1 L2/lead | R$814.258 | R$22.618 | 362,4 |

S1 é a recomendação inicial. S2 compra capacidade antecipada que a demanda
EXPECTED não usa. S3 é superior quando volume/complexidade justifica um lead,
mas não acrescenta horas sobre três pessoas; acrescenta competência e custo.

## 9. SALARY / EMPLOYER COST

Salário-base L1: R$3.000/mês; lead: R$5.000. O modelo não trata salário como
custo total. Inclui provisões de 13º, férias, FGTS, contribuição patronal, RAT,
terceiros, contingência/desligamento, R$900 de benefícios, R$250 de ferramentas
e progressão anual de 8%/10%.

Como referências oficiais, o FGTS é em regra 8% da remuneração conforme o
[Ministério do Trabalho e Emprego](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/fgts-fundo-de-garantia-do-tempo-de-servico), e o cenário geral usa 20% de
contribuição patronal conforme a [Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/contribuicoes-previdenciarias-pf).
RAT, terceiros, regime e gross-up reais precisam ser confirmados por contador;
o modelo é planejamento prudencial, não parecer trabalhista/tributário.

## 10. TRAINING

Cada L1 recebe 120 horas de treinamento inicial; lead, 80. Ramp de
produtividade: 45% / 65% / 80% nos três primeiros meses, depois 100%. Cada
contratação inclui recrutamento, curso e 24 horas de supervisão de
CEO/especialista. Férias/ausências e trabalho indireto reduzem as 190,67 horas
brutas para 120,8 horas produtivas steady por pessoa/mês.

## 11. ZION DEFLECTION

| cenário | deflexão | tickets humanos/mês | horas/mês | capacidade selecionada | utilização |
|---|---:|---:|---:|---:|---:|
| EXPECTED | 70% | 68 | 22,8 | 241,6 | 9,4% |
| HEAVY | 50% | 335 | 139,7 | 362,4 | 38,5% |
| STRESS | 30% | 1.036 | 518,2 | 362,4 | 143,0% |
| STRESS | 50% | 740 | 370,1 | 362,4 | 102,1% |
| STRESS | 70% | 444 | 222,1 | 362,4 | 61,3% |
| STRESS | 85% | 222 | 111,0 | 362,4 | 30,6% |

O ponto de equilíbrio de três pessoas no STRESS é pouco acima de 51% de
deflexão. A meta prudente é **70%**, com telemetria por motivo e reabertura para
não contar resposta ruim como resolução. Não se assume 100%.

## 12. CEO ESCALATION

O custo do CEO/especialista é separado do suporte comum e usa R$250/h, 1,5h
por escalação.

| cenário | 0,5% | 1% | 2% | 5% |
|---|---:|---:|---:|---:|
| EXPECTED | R$4.611 | R$9.222 | R$18.444 | R$46.109 |
| HEAVY | R$22.629 | R$45.259 | R$90.518 | R$226.294 |
| STRESS | R$69.954 | R$139.907 | R$279.815 | R$699.536 |

O cenário-base usa 0,5% / 2% / 5% em EXPECTED / HEAVY / STRESS.

## 13. 36M COST

Valores por holder em USD; staffing permanece autoritativo em BRL. Conversão
de planejamento: R$5,50/US$, não PTAX nem previsão.

| cenário | tier | compute | AI | DB/cloud | suporte | CEO | treino | fixo | other ops | total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| EXPECTED | Pro | 0,09 | 37,10 | 0,08 | 17,38 | 0,18 | 1,03 | 1,79 | 5,66 | **63,32** |
| EXPECTED | Trader | 0,37 | 92,75 | 0,34 | 41,71 | 0,44 | 2,47 | 1,79 | 5,66 | **145,53** |
| EXPECTED | Pilot | 1,13 | 111,30 | 1,02 | 121,65 | 1,29 | 7,19 | 1,79 | 5,66 | **251,03** |
| HEAVY | Pro | 5,13 | 121,80 | 4,61 | 26,56 | 3,68 | 1,57 | 1,79 | 5,66 | **170,81** |
| HEAVY | Trader | 25,67 | 304,50 | 23,04 | 61,97 | 8,59 | 3,66 | 1,79 | 5,66 | **434,90** |
| HEAVY | Pilot | 256,61 | 365,40 | 230,43 | 177,05 | 24,55 | 10,47 | 1,79 | 5,66 | **1.071,97** |
| STRESS | Pro | 37,38 | 186,37 | 33,43 | 33,36 | 30,07 | 1,64 | 1,79 | 5,66 | **329,71** |
| STRESS | Trader | 186,91 | 465,93 | 167,16 | 71,49 | 64,43 | 3,51 | 1,79 | 5,66 | **966,89** |
| STRESS | Pilot | 469,75 | 559,12 | 424,54 | 190,64 | 171,82 | 9,36 | 1,79 | 5,66 | **1.832,68** |

Portfólio completo (2.890 passes, incluindo reserva): EXPECTED US$264.247;
HEAVY US$784.455; STRESS US$1.587.406. Receita bruta dos 2.850 passes pagos:
US$796.250.

## 14. REFERRAL

O modelo aplica a porcentagem a **toda** a receita, hipótese conservadora de
100% das vendas atribuídas.

| cenário | 0% | 10% | 15% | 20% |
|---|---:|---:|---:|---:|
| EXPECTED | US$532.003 | US$452.378 | US$412.565 | US$372.753 |
| HEAVY | US$11.795 | **−US$67.830** | **−US$107.643** | **−US$147.455** |
| STRESS | **−US$791.156** | **−US$870.781** | **−US$910.594** | **−US$950.406** |

- 10%: somente programa limitado, atribuído e com teto, após telemetria.
- 15%: não aprovar no desenho atual.
- 20%: não aprovar no desenho atual.

Referral não corrige demanda e não pode consumir a reserva de serviço.

## 15. SERVICE RESERVE

Regra: passivo econômico EXPECTED remanescente × 1,25. Após `m` meses,
multiplicar por `(36-m)/36` e recalcular com dados reais.

| tier | passivo EXPECTED | buffer | reserva/pass | % do preço | cobertura máxima paga + reserva |
|---|---:|---:|---:|---:|---:|
| Pro | US$63,32 | 25% | **US$79,15** | 53,1% | US$160.672 |
| Trader | US$145,53 | 25% | **US$181,92** | 45,6% | US$138.258 |
| Pilot | US$251,03 | 25% | **US$313,79** | 15,8% | US$31.379 |
| **total** |  |  |  |  | **US$330.309** |

Essa reserva cobre serviço. Não inclui nem substitui reserva tributária,
emergência, runway do CEO, growth ou capital operacional geral.

## 16. PRICE VERDICT

| tier | EXPECTED | HEAVY | STRESS | veredito do preço provisório |
|---|---:|---:|---:|---|
| Pro US$149 | +US$85,68 | −US$21,81 | −US$180,71 | condicional; não suporta uso pesado |
| Trader US$399 | +US$253,47 | −US$35,90 | −US$567,89 | condicional; não suporta uso pesado |
| Pilot US$1.990 | +US$1.738,97 | +US$918,03 | +US$157,32 | cobre sem referral; stress fica frágil |

As margens acima são antes de referral e não são lucro contábil. O preço final
deve aguardar validação real de demanda, custo de IA, uso e suporte. Recomenda-se
manter 149/399/1.990 como **provisórios**, não publicar como final e preparar
uma combinação de ajuste de preço, limites de uso e referral seletivo se a
telemetria se aproximar do HEAVY.

## 17. STAFFING TRIGGERS

Contratar a terceira pessoa quando qualquer condição persistir por duas
medições semanais ou a previsão de 60 dias ultrapassar 70% da capacidade:

1. utilização produtiva ≥70%;
2. backlog ≥100 tickets;
3. backlog acima de dois dias úteis;
4. aumento de reabertura/transferência L2 que invalide a deflexão aparente.

Antes disso, duas pessoas oferecem redundância de segunda a sábado e ampla
folga no EXPECTED. Uma só pessoa não é recomendada por férias, ausência e
continuidade.

## 18. OPEN RISKS

1. Deflexão ZION, tickets por holder e minutos por ticket ainda são premissas;
   precisam de medição real antes do full sale.
2. HEAVY/STRESS mostram perda econômica em Pro/Trader; preço provisório não é
   blindagem.
3. O enquadramento trabalhista/tributário real pode alterar o custo carregado.
4. Câmbio de R$5,50/US$ é premissa de comparação.
5. Custo de IA usa preço publicado/premissas; fatura real prevalece.
6. Arb Scanner continua `A_CONFIRMAR`; Pilot automation continua roadmap;
   Autopilot continua desabilitado.
7. Modo Mesa não cabe na promessa comercial de 5.000 padrão.
8. Revisão jurídica, demanda real, preço final, coleção/mint e publicação
   continuam fora deste round.

## 19. RECOMMENDATION

1. Iniciar com **2 L1**, R$3.000 base, contratação carregada e treinamento
   antes da venda; operar segunda a sábado.
2. Usar ZION como L1 digital, com meta de **70% de resolução elegível** e
   auditoria de reabertura.
3. Contratar a terceira pessoa somente pelo gatilho da seção 17; preferir um
   perfil L2/lead quando complexidade, e não apenas volume, for o gargalo.
4. Separar CEO/especialista e limitar sua escalação; não prometer concierge.
5. Segregar US$330.309 de reserva de serviço na venda completa e reduzi-la
   somente conforme o passivo remanescente cair.
6. Manter referral em 0% no baseline. Testar até 10% apenas com teto e
   atribuição real; não aprovar 15%/20% agora.
7. Manter os preços como provisórios. Antes de finalizá-los, simular os dados
   reais de Early Access/uso e garantir que Pro/Trader não dependam do cenário
   EXPECTED para sobreviver.
8. Submeter código, modelo, premissas e este relatório a auditoria independente
   antes de qualquer publicação.

### Evidência de recertificação local

- Node `v24.21.0`; npm `11.19.0`; `npm ci` e production build PASS;
- lint PASS com 0 erros/145 avisos; type-check PASS;
- testes do escopo: 21 arquivos, 288/288 testes PASS;
- suíte completa autoritativa no runner Node 24 com Git e Git common dir
  somente leitura: 313/313 arquivos, 4.654/4.654 testes PASS;
- primeira tentativa: `FAIL_ENVIRONMENT` porque a imagem slim não continha
  Git; segunda: `FAIL_ENVIRONMENT` porque a worktree não via o Git common dir.
  Ambas permanecem na evidência e não são tratadas como PASS;
- modelo regenerado sem diff; migrations e package files sem alteração;
- secret scan do delta PASS;
- evidence manifest: 33 entradas, SHA-256
  `feafb658068684dc7baefde0bc9dd8f9d1c0cb63f542627e4453893b5b6dc301`.

O `npm audit` medido nesta recertificação encontrou 66 vulnerabilidades no
escopo completo (26 high, 40 moderate) e 58 sem dependências de desenvolvimento
(21 high, 37 moderate). Esse finding requer campanha própria de disposição e
não foi reduzido, aceito nem corrigido aqui.
