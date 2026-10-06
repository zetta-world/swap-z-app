# FOUNDERS — FINAL SALE RULES + SERVICE LIABILITY CLOSURE

> **Data-base:** 06/10/2026  
> **Escopo:** delta final pós-auditoria independente.  
> **Estado:** implementação local; a seção de recertificação será atestada somente após os gates do SHA exato.  
> **Não autoriza:** preço final, publicação, deploy, treasury real, venda ou operação financeira.

## 1. EXECUTIVE VERDICT

O delta fecha a regra da venda e corrige dois problemas metodológicos. A
allowlist dura 48 horas e dá prioridade, sem supply adicional. Seus limites
são 1 Pro, 1 Trader e 1 Pilot por carteira; as compras contam nos limites
cumulativos do evento inteiro, 2 Pro, 2 Trader e 1 Pilot. Todo Pilot não
vendido segue para a public sale. O evento termina no primeiro entre sold-out
real e 14 dias desde a abertura da allowlist. Tudo que não vender permanece
unminted.

Founder status passa a ser descrito como propriedade duradoura do passe. Os
direitos vinculados ao status pertencem ao holder atual conforme a política de
ownership aplicável. Premium continua temporário, por 36 meses exatos. Não há
promessa de Premium vitalício, produtos futuros ou benefícios ilimitados no
ecossistema.

O modelo confirmou a dupla contagem de treinamento: a folha já remunerava as
horas e o ramp já reduzia a produtividade, mas as mesmas horas eram somadas
novamente pelo custo horário carregado. A correção mantém folha e ramp e cobra
como treinamento extra apenas recruiting, curso/material e supervisão
adicional.

A reserva deixa de ser um percentual fixo apresentado como policy. O modelo
calcula a obrigação de serviço ainda não incorrida por componentes, em cada
data de medição, e apresenta sensibilidades de 10%, 25% e 50%. Os números são
**MODEL OUTPUT**, não decisão final de tesouraria.

## 2. SALE RULES

| regra | decisão fechada |
|---|---|
| duração da allowlist | 48 horas |
| teto por wallet na allowlist | 1 Pro + 1 Trader + 1 Pilot |
| teto cumulativo do evento | 2 Pro + 2 Trader + 1 Pilot |
| compras da allowlist contam no teto total | sim |
| Pilot disponível na public sale | sim, todo remanescente |
| encerramento | sold-out real ou 14 dias desde a abertura da allowlist |
| unidades não vendidas | unminted |
| extensão/nova wave | somente com nova decisão formal |

Não existe `pilotSomenteAllowlist` ativo. Sold-out só existe quando o supply
real disponível foi mintado; não se antecipa mint para fabricar demanda.

## 3. ALLOWLIST

A allowlist é uma janela prioritária de 48 horas. Cada wallet pode adquirir no
máximo uma unidade de cada tier nessa fase. A prioridade não aumenta o teto
total e não cria alocação oculta. Prova de elegibilidade, disponibilidade e
limites continuam fail-closed no domínio da venda.

## 4. PUBLIC SALE

Todo paid supply remanescente de Pro, Trader e Pilot entra na public sale. Uma
wallet sem compra anterior pode chegar a 2 Pro, 2 Trader e 1 Pilot. Uma wallet
que comprou 1/1/1 na allowlist só pode acrescentar 1 Pro, 1 Trader e nenhum
Pilot.

## 5. CUMULATIVE WALLET LIMITS

O livro de reservas mantém a contagem por wallet e tier entre as duas fases. O
teto da public sale é o teto final do evento, não uma nova franquia. Testes
cobrem compra unitária, tentativa em lote, carry-over e excesso após cada
combinação.

## 6. PILOT PUBLIC SALE

Pilot não é exclusivo da allowlist. Exemplo normativo: se 37 dos 100 Pilot
forem vendidos na allowlist, 63 seguem disponíveis na public sale. Não existe
reserva Pilot e nenhuma unidade é removida artificialmente para produzir
sold-out.

## 7. SUPPLY / UNSOLD

| tier | paid supply | reserve | preço provisório |
|---|---:|---:|---:|
| Pro | 2.000 | 30 | US$149 |
| Trader | 750 | 10 | US$399 |
| Pilot | 100 | 0 | US$1.990 |

A reserva não é supply oculto de venda, alocação de equipe ou demanda
fabricada. Unidades pagas e reservas não utilizadas permanecem unminted. Os
preços seguem `PROVISIONAL_FOR_DEMAND_VALIDATION`.

## 8. FOUNDER STATUS COPY

Verdade pública aprovada:

> Founder status é uma propriedade duradoura do passe. Os direitos vinculados
> ao status pertencem ao holder atual, conforme a política de ownership
> aplicável.

Premium dura exatamente 36 meses desde o encerramento oficial. A transferência
não reinicia a janela. As superfícies `en`, `pt`, `es` e `zh` retiraram
formulações de Premium vitalício, benefício futuro em todo o ecossistema,
acesso perpétuo a betas e gratuidade futura garantida. Roadmap continua
roadmap, sem data e sem entitlement automático.

## 9. TRAINING COST CORRECTION

### Antes

O modelo somava três camadas ao contratar:

1. folha mensal carregada, que já remunera o período;
2. ramp de 45% / 65% / 80%, que já reduz capacidade nos três primeiros meses;
3. `horas de treinamento × custo horário da folha`, cobrando novamente a mesma
   hora, além de recruiting, curso e supervisão.

### Depois

- folha e encargos continuam integrais;
- ramp continua reduzindo horas produtivas;
- 120h por L1 e 80h por lead ficam registradas como horas cobertas pela folha;
- treinamento extra contém somente recruiting, curso/material e 24h de
  supervisão adicional por contratação.

| staffing | training anterior | training corrigido | redução | custo 36m corrigido |
|---|---:|---:|---:|---:|
| S1 Lean | R$25.742 | R$18.600 | R$7.142 | R$453.881 |
| S2 CEO Plan | R$38.613 | R$27.900 | R$10.713 | R$680.822 |
| S3 Mature | R$38.088 | R$27.300 | R$10.788 | R$803.470 |

## 10. SUPPORT MODEL

A recomendação permanece: começar com 2 L1, salário-base inicial de R$3.000,
e contratar a terceira pessoa pelo gatilho operacional. O planejamento de full
sale comporta até 3 pessoas. Atendimento humano é de segunda a sábado, sem
24/7; ZION tem meta de 70% de deflexão elegível, ainda não medida.

| modelo | composição | custo 36m corrigido | média/mês | horas produtivas steady/mês |
|---|---|---:|---:|---:|
| S1 Lean | 2 L1; terceira por gatilho | R$453.881 | R$12.608 | 241,6 |
| S2 CEO Plan | 3 L1 desde o início | R$680.822 | R$18.912 | 362,4 |
| S3 Mature | 2 L1 + 1 L2/lead | R$803.470 | R$22.319 | 362,4 |

Gatilho: utilização produtiva de 70%, backlog de 100 tickets, backlog superior
a dois dias úteis ou deterioração persistente de reabertura/transferência L2,
confirmado por duas medições semanais ou previsão de 60 dias.

## 11. SERVICE LIABILITY MODEL

`DYNAMIC_REMAINING_SERVICE_LIABILITY` soma apenas obrigações ainda futuras:

- **front-loaded:** recruiting, curso/material e supervisão ainda não
  incorridos;
- **recurring:** folha/benefícios/ferramentas dos meses futuros, fixed cloud e
  software/other ops;
- **variable:** AI, compute, DB/cloud, volume de suporte e escalação esperados.

Folha segue a grade mensal com progressão; DB/cloud segue a curva crescente de
storage. Portanto, o modelo não libera 1/36 fixo e não usa apenas
`(36-m)/36`. Custos reais incorridos e run-rate observado devem substituir as
premissas no recálculo periódico.

| meses de serviço prestados | obrigação EXPECTED remanescente | ×1,10 | ×1,25 | ×1,50 |
|---:|---:|---:|---:|---:|
| 0 | US$262.948,76 | US$289.243,64 | US$328.685,95 | US$394.423,15 |
| 1 | US$252.505,84 | US$277.756,42 | US$315.632,30 | US$378.758,76 |
| 3 | US$238.381,23 | US$262.219,35 | US$297.976,53 | US$357.571,84 |
| 12 | US$174.780,97 | US$192.259,07 | US$218.476,21 | US$262.171,45 |
| 24 | US$88.300,77 | US$97.130,84 | US$110.375,96 | US$132.451,15 |
| 36 | US$0 | US$0 | US$0 | US$0 |

## 12. FRONT-LOADED / RECURRING / VARIABLE

O output JSON preserva cada componente por tier e checkpoint. A reserva é
capital segregado para financiar esses custos. Não é um custo econômico novo
somado ao mesmo compute, AI, cloud ou payroll.

A opção híbrida P90/uso observado está definida como método, mas não recebe
número enquanto não houver telemetria: maior entre expected ajustado pelo
run-rate observado e P90 empírico, mais buffer de execução. HEAVY não é chamado
de P90 e não vira reserva automática.

## 13. CAPITAL POLICY RECONCILIATION

A política anterior distribui R$4.149.100 em 100% dos baldes. D/E/F/K — infra,
IA, equipe e operações — já contêm R$1.520.000 de capacidade para serviço. A
Service Reserve deve ser segregada/reclassificada dentro desse caixa, não
adicionada por cima.

| buffer | gross | tax/regulatory* | service reserve | emergência + CEO runway | capital corporativo deployable | realocação sobre D/E/F/K | soma |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | R$4.149.100 | R$747.000 | R$1.590.840 | R$862.100 | R$949.160 | R$70.840 | R$4.149.100 |
| 25% | R$4.149.100 | R$747.000 | R$1.807.773 | R$862.100 | R$732.227 | R$287.773 | R$4.149.100 |
| 50% | R$4.149.100 | R$747.000 | R$2.169.327 | R$862.100 | R$370.673 | R$649.327 | R$4.149.100 |

\* Reserva de planejamento; não é decisão ou cálculo tributário.

Cada linha soma exatamente 100% do gross de referência. A realocação mostra o
quanto a obrigação excederia D/E/F/K e teria de reduzir outros baldes por nova
versão formal da policy. Nenhuma linha cria 141,5% de capital.

## 14. BUFFER SENSITIVITY

No início, os outputs por passe são:

| tier | obrigação EXPECTED | ×1,10 | ×1,25 | ×1,50 |
|---|---:|---:|---:|---:|
| Pro | US$63,03 | US$69,34 | US$78,79 | US$94,55 |
| Trader | US$144,85 | US$159,34 | US$181,06 | US$217,28 |
| Pilot | US$249,04 | US$273,94 | US$311,30 | US$373,56 |

Esses valores são sensibilidade, não policy. O antigo ~US$330.309 a 25% cai
para US$328.685,95 por causa da correção de treinamento, mas continua apenas
um output. A escolha do buffer final exige dados observados, risco e decisão
formal.

## 15. REFERRAL

| cenário | margem 0% | margem 10% | margem 15% | margem 20% |
|---|---:|---:|---:|---:|
| EXPECTED | US$533.301 | US$453.676 | US$413.864 | US$374.051 |
| HEAVY | US$13.743 | −US$65.882 | −US$105.695 | −US$145.507 |
| STRESS | −US$789.195 | −US$868.820 | −US$908.632 | −US$948.445 |

Baseline: 0%. Dez por cento permanece condicional, atribuído e com teto após
telemetria. Quinze e vinte por cento continuam `NO` no desenho atual.

## 16. PRICE STATUS

| cenário | custo econômico 36m do portfólio | leitura |
|---|---:|---|
| EXPECTED | US$262.948,76 | preços cobrem o cenário |
| HEAVY | US$782.507,20 | margem de apenas US$13.742,80 antes de referral |
| STRESS | US$1.585.444,87 | perda de US$789.194,87 |

Pro/Trader continuam negativos no HEAVY; Pilot fica negativo no STRESS com
10% de referral. Os preços 149/399/1.990 permanecem provisórios. Este round não
decide preço final.

## 17. TESTS

Estado antes da recertificação do SHA exato:

- regressões de regras, copy, ZION e economia: **PENDING EXECUTION**;
- type-check: **PENDING EXECUTION**;
- lint: **PENDING EXECUTION**;
- full suite: **PENDING EXECUTION**;
- production build: **PENDING EXECUTION**;
- regeneração determinística: verificada localmente; repetição não alterou os
  hashes dos outputs.

Esta seção só será promovida em commit documental posterior se a campanha do
SHA exato passar. Uma primeira falha permanecerá na evidência.

## 18. OPEN RISKS

1. preços continuam provisórios e a demanda real ainda não foi coletada;
2. tax treatment, legal opinion, referral launch, buffer final, treasury real,
   data e publicação continuam abertos;
3. telemetria de deflexão, suporte, AI, compute e DB ainda precisa substituir
   hipóteses;
4. a opção híbrida P90 permanece indisponível sem série observada;
5. supply chain permanece `OPEN — SEPARATE DISPOSITION CAMPAIGN` (26 high/40
   moderate total; 21 high/37 moderate omit-dev; 0 critical na medição
   anterior);
6. nenhuma decisão deste documento autoriza produção, venda ou deploy.

## 19. AUDITOR HANDOFF

O auditor deve conferir o SHA candidato exato, executar o modelo, validar os
outputs e tentar quebrar:

1. carry-over 1/1/1 → +1/+1/+0;
2. Pilot remanescente na public sale;
3. 14 dias contados de `allowlistAbre`;
4. copy em en/pt/es/zh sem promessa futura ampla;
5. ausência da dupla contagem de horas de treinamento;
6. queda não linear do passivo (folha e DB/cloud);
7. reconciliação que nunca ultrapassa o gross;
8. determinismo dos artefatos e integridade de package/migrations;
9. gates completos registrados na evidência externa.

Até a auditoria independente: **IMPLEMENTED — NOT PUBLISHED — NOT RELEASED**.
