# FOUNDERS — POLÍTICA DE TESOURARIA E CAPITAL · 🟢 APROVADA PELO DONO (04/10/2026) · planejamento, não contabilidade

> **Documento AUTORITATIVO** para o destino dos recursos da venda Founders (lane B, L-039). Substitui qualquer leitura
> de capital em `FOUNDERS-NFT-CAPITAL-MODEL.md` (que continua valendo só para o cenário bruto da venda).
> Código: `src/lib/founders-sale/capital.ts` (cascata e painel de planejamento), `tesouraria.ts` (verificação da
> multisig e simulação de conversão), `reserva-livro.ts` (reserva não paga), `config.ts` (decisões como dado).
> Nada aqui move dinheiro, cria carteira, gera chave ou converte ativo. Nenhuma conversão real nesta fase.

## 1. Princípios aprovados

1. **Runway operacional mínimo: 24 meses.** Os recursos dos Founders existem para a Z-SWAP operar, melhorar, adquirir
   usuários e chegar a receita recorrente sustentável.
2. **Não é capital especulativo.** O caixa operacional **não** fica materialmente exposto ao preço do SOL depois do
   recebimento (§ 6).
3. **Proporção, não câmbio fixo.** A política usa percentuais e uma cascata; o valor em BRL é referência de
   planejamento. O câmbio implícito na referência (R$ 4.149.100 ÷ US$ 796.250 ≈ 5,2108) **não** é fixo.
4. **Runway primeiro, expansão depois.** Captação parcial não vira gasto proporcional de tudo (§ 3).
5. **Reserva ≠ gasto.** Cada linha é teto/capacidade com liberação controlada; nenhuma é meta de gasto.

## 2. Orçamento de referência — venda total (US$ 796.250 ≈ R$ 4.149.100)

| | linha | R$ | % | nota |
|---|---|---:|---:|---|
| A | reserva tributária/regulatória | 747.000 | 18,0 | **reserva**, não cálculo de imposto; proporcional ao captado |
| B | reserva corporativa de emergência | 502.100 | 12,1 | |
| C | remuneração do CEO — 24 meses | 360.000 | 8,7 | R$ 15.000/mês × 24 · custo operacional, não sobra. Se R$ 15.000 for **líquido**, o gross-up (folha/tributos) é calculado à parte com o contador |
| D | infraestrutura/nuvem | 360.000 | 8,7 | ≈ R$ 15.000/mês de **capacidade**: Vercel, Supabase, bancos, storage, backups, monitoramento, logs, RPC, CDN, e-mail, domínios, observabilidade, provedores externos — teto, não queima obrigatória |
| E | ferramentas e APIs de IA | 300.000 | 7,2 | ≈ R$ 12.500/mês: planos pesados OpenAI/Anthropic/Kimi, uso de API, cargas de agentes, picos, ferramentas futuras — **sem** preço de varejo de provedor codificado |
| F | equipe/especialistas/contratados | 720.000 | 17,4 | ≈ R$ 30.000/mês de capacidade média; contratação **escalonada** (segurança, backend, Solana, contratos, frontend/design, DevOps, jurídico/compliance, auditorias) — sem folha cheia imediata |
| G | segurança/auditoria/compliance | 250.000 | 6,0 | auditorias, revisão de contratos, jurídico/compliance, resposta a incidente, revisão técnica externa, pentest quando exigido |
| H | escritório físico | 240.000 | 5,8 | **capacidade reservada**; portão em § 4 |
| I | estação local de IA/desenvolvimento | 80.000 | 1,9 | **teto máximo**, não alvo: Linux, muita RAM, NVMe grande, GPU para inferência local. Gastar menos se der. Nenhuma compra nesta rodada |
| J | crescimento/marketing/aquisição | 450.000 | 10,8 | estratégico; liberado contra desempenho de aquisição **medido**, nunca adiantado inteiro |
| K | software/contabilidade/operação geral | 140.000 | 3,4 | contabilidade, software administrativo, ferramentas, serviços, despesas gerais |
| | **total** | **4.149.100** | **100,0** | |

**Aritmética conferida** (código + teste `capital.test.ts`): 747.000 + 502.100 + 360.000 + 360.000 + 300.000 + 720.000 +
250.000 + 240.000 + 80.000 + 450.000 + 140.000 = **4.149.100**; cada percentual declarado confere com valor ÷ total
(1 casa) e os onze somam **100,0**. Mensais × 24 = metas de C, D, E e F.

## 3. Cascata de capital (para todo valor efetivamente captado)

1. **A — reserva tributária**, proporcional (747.000/4.149.100 ≈ 18,0 % do captado);
2. **B — emergência** até R$ 502.100;
3. **C — CEO 24 meses** até R$ 360.000;
4. **E — IA** até R$ 300.000;
5. **D — infraestrutura** até R$ 360.000;
6. **G — segurança/jurídico MÍNIMO** até R$ 125.000 (metade de G — parâmetro de engenharia documentado e ajustável:
   com ele, o núcleo fecha em ≈ R$ 2,106 mi, o patamar de sobrevivência "≈ R$ 2,1 mi" do dono);
7. **I — estação** até R$ 80.000;
8. **só então a expansão**: restante de G, K, F, J e H, **pro rata pelas metas**, sem passar da meta. Antes do patamar
   de equipe (R$ 3,2 mi) a cota de H fica **NÃO ALOCADA** (reserva) — destravar o escritório nunca reduz outra linha.
   Acima da referência, o excedente fica **não alocado** (reserva), nunca infla orçamento.

K (operações) fica na expansão porque a lista de prioridades do dono não a inclui no núcleo; se a contabilidade
precisar entrar antes, é uma nova versão da política (v2), não um ajuste silencioso.

**Falha fechada:** captado negativo/NaN/fracionário, câmbio ≤ 0/infinito, metas que não somam, percentual que não
confere, níveis fora de ordem, linha sem lugar na cascata, alocação acima do disponível → **recusa**, nada é alocado.
Impostos são **reserva**, não cálculo; nada de "líquido" é fabricado.

## 4. Patamares de captação (planejamento, não promessa)

| captado (≈) | modo | o que destrava |
|---|---|---|
| ≤ R$ 2,1 mi | **sobrevivência** | proteção de runway de 24 meses, CEO, IA, infra, estação, segurança/jurídico mínimo; sem escritório; equipe pequena; marketing controlado |
| ≈ R$ 2,5 mi | aquisição | orçamento maior de aquisição e contratação seletiva de especialistas |
| ≈ R$ 3,2 mi | equipe | equipe maior; **preparação** de escritório se o portão de runway seguir satisfeito |
| ≈ R$ 4,15 mi | referência completa | orçamento completo disponível, ainda com liberação controlada |

**Portão do escritório:** plataforma operacional **e** razão de negócio demonstrada **e** pelo menos **18 meses** de
runway ainda protegidos **depois** do compromisso. Contrato longo **não** é assinado só porque o capital entrou. No
código, capital sozinho nunca dá `GATE_SATISFIED` — exige os três fatos operacionais.

### Cenários calculados (`capital-relatorio.json` da evidência; R$)

| captado | A imp. | B emerg. | C CEO | E IA | D infra | G seg. | I estação | K ops | F equipe | J cresc. | H escrit. | não aloc. | runway | equipe | crescimento | escritório |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | NO_CAPITAL | LOCKED | LOCKED | LOCKED |
| 25 % · 1.037.275 | 186.750 | 502.100 | 348.425 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | AT_RISK (CEO 23 m) | LOCKED | LOCKED | LOCKED |
| 50 % · 2.074.550 | 373.500 | 502.100 | 360.000 | 300.000 | 360.000 | 125.000 | 53.950 | 0 | 0 | 0 | 0 | 0 | PROTECTED_24M | LOCKED | LOCKED | LOCKED |
| 75 % · 3.111.825 | 560.250 | 502.100 | 360.000 | 300.000 | 360.000 | 186.528 | 80.000 | 68.911 | 354.401 | 221.501 | 0 | 118.134 | PROTECTED_24M | SELECTED_SPECIALISTS | EXPANDED_ACQUISITION | LOCKED |
| 100 % · 4.149.100 | 747.000 | 502.100 | 360.000 | 300.000 | 360.000 | 250.000 | 80.000 | 140.000 | 720.000 | 450.000 | 240.000 | 0 | PROTECTED_24M | FULL_REFERENCE_CONTROLLED_RELEASE | idem | PREPARATION_ONLY_GATE_PENDING |

Leitura honesta dos 25 %: a ordem do dono (emergência antes do CEO) deixa IA e infra sem verba; é sinal de que uma
venda de 25 % **não** sustenta o plano de 24 meses — decisão de negócio, não de código.

## 5. Painel de capital (local)

`relatorioCapital()` gera, para 25/50/75/100 % e valores customizados: capital captado, cada linha, não alocado,
`RUNWAY_STATUS`, `OFFICE_UNLOCK_STATUS`, `TEAM_EXPANSION_STATUS`, `GROWTH_UNLOCK_STATUS`, meses de runway cobertos.
**Sem saldo bancário, sem número fictício.** Módulo determinístico + testes (sem rota hospedada; um painel de admin
exigiria rota hospedada — fica para a fase Vercel, se houver razão de produto). A alocação interna **não** é exposta
publicamente.

## 6. Risco da tesouraria e arquitetura de conversão

- A venda recebe **SOL**. As obrigações operacionais (folha, CEO, reserva tributária, IA, infraestrutura, segurança,
  compromissos de escritório, runway) devem **acabar** em ativos adequados para pagá-las (stablecoin e/ou conta em
  reais), sujeito a revisão contábil/jurídica.
- **Princípio aprovado e codificado:** o SOL retido nunca passa do que sobra depois de cobrir as obrigações
  (`planejarComParametros` recusa `sol_retido_acima_do_permitido`).
- **Parâmetros configuráveis** (`ParametrosConversao`): fração SOL retido / stable / fiat (bps), teto por tranche,
  tranches por dia, limite por contraparte, lista de contrapartes; trilha de auditoria encadeada por tranche
  (`conferirTrilhaConversao`).
- **Números NÃO definidos aqui:** nenhuma divisão stable × fiat, tamanho de tranche ou contraparte sem **análise de
  risco documentada** + contador/jurídico → `PENDING_LEGAL`. Sem eles, `planejarConversao` **recusa**
  (`parametros_pendentes`). Os parâmetros do ensaio são marcados TESTE e não são recomendação.

## 7. OD-NFT-22 — multisig (política PARTIALLY_CLOSED)

`TREASURY_MODE=MULTISIG` · `PLANNING_THRESHOLD=2_OF_3` · nenhum signatário controla a tesouraria sozinho
(`validarConfig` recusa limiar < 2-de-3). Identidades: **PENDING_OWNER_IDENTITY_SELECTION**.

| papel | quem (perfil, não nome) |
|---|---|
| **A** | CEO / autoridade corporativa principal |
| **B** | autoridade independente financeira/segurança |
| **C** | autoridade independente de recuperação/continuidade |

Os três são identidades **humanas separadas**, cada uma com seu próprio dispositivo.

**Guarda de chaves (princípios):** carteira de hardware por signatário; frase de recuperação só offline, em local
físico próprio de cada signatário; **nunca** em nuvem, e-mail, chat, foto, repositório, `.env` ou gerenciador
compartilhado; nenhum signatário guarda material de outro; nenhuma chave é gerada por este repositório ou por um
agente (trava em `guardas-seguranca.test.ts`).

**Aprovação de transação:** proposta com destino, valor, motivo e referência à linha do orçamento → simulação →
cada signatário confere no **próprio** dispositivo (endereço e valor por canal independente) → 2 de 3 assinam →
execução → evento de auditoria com hash da transação.

**Verificação de endereço:** antes de publicar e antes de qualquer pagamento, `verificarTesouraria` compara o declarado
(endereço, donos, limiar) com o observado na chain e exige simulação aprovada; só `OK` libera; publicar
`fingerprintEndereco`. Ensaio primeiro em devnet com o mesmo arranjo.

**Perda/recuperação:** perda de **uma** chave → os outros dois (2-de-3) executam a troca de membro imediatamente e
registram o evento; perda de **duas** → incidente crítico: congelar operações, ninguém improvisa, recuperação só pelo
procedimento do programa de multisig escolhido com assessoria. **Troca de signatário:** proposta 2-de-3 que remove e
adiciona membro, nova verificação de endereço/limiar, novo fingerprint publicado. **Emergência** (comprometimento
suspeito): pausar a venda, mover fundos com 2-de-3 para uma multisig nova já verificada, investigar, relatório.

**Evidência de auditoria:** cada proposta, assinatura, execução, troca de membro e verificação vira evento encadeado
(hash/anterior), sem segredo, com hashes de transação e fingerprints.

## 8. Reserva não paga (OD-NFT-04 — APPROVED)

PRO **30** · TRADER **10** · PILOT **0** = **40**, **fora** dos 2.850 pagos → coleção máxima **2.890**; o capital
continua sobre os 2.850. Usos: **só** parceiros estratégicos do ecossistema e recompensas/campanhas de comunidade
**auditadas**. Sem alocação de equipe, sem insider, sem sorteio de Pilot. Cada emissão: finalidade + categoria de
destinatário + aprovação por **dois** operadores autorizados distintos + registro de mint + evento de auditoria
(`LivroDaReserva`). Não usada = **não mintada**, salvo política futura aprovada. Divulgada na página pública
(seção de tiers e FAQ).

## 9. Royalty (OD-NFT-11 — APPROVED_SUBJECT_TO_LEGAL_AND_TECHNICAL_COMPATIBILITY)

**2,5 %** (250 bps) → **tesouraria**. Nenhuma distribuição a holders; nunca anunciado como benefício do comprador;
nenhuma promessa de renda de royalty (`publico: false`; travas de copy). **Limitação técnica, com honestidade:** no
padrão aprovado (Metaplex Core, OD-NFT-01) o royalty é registrado no ativo, mas o **pagamento** depende de como a regra
de transferência é configurada e de os marketplaces respeitarem — não é garantido por si só. Uma regra restritiva
aumenta a cobrança, mas pode limitar onde o passe circula. Escolher e **conferir no devnet** (`PENDING_CHAIN`) e passar
pela revisão jurídica antes da mainnet.

## 10. Relação com os planos mensais (OD-NFT-20 — APPROVED)

Produtos comerciais separados. "+30 %" = `NON_BINDING_PRICING_GUIDANCE` (evidência em
`FOUNDERS-NFT-OWNER-DECISIONS.md`). Nenhuma promessa de prêmio percentual futuro do mensal sobre o NFT.

## 11. O que continua pendente (e de quem)

`PENDING_OWNER`: identidades dos signatários · `PENDING_REAL_DEMAND_VALIDATION`: preço final · `PENDING_LEGAL`:
OD-16/17, Termos/Privacidade, consentimento da coleta, revisão de royalty, parâmetros de conversão (com análise de
risco), gross-up do CEO · `PENDING_VERCEL`: Early Access/rotas/admin hospedados, janela de coleta, adapter 0071/0072 ·
`PENDING_EXTERNAL`: e-mail/DNS, RPC/DAS, wallet adapter, provedor de referência SOL/USD · `PENDING_CHAIN`: multisig
(devnet → mainnet), coleção/programa, compatibilidade de royalty, snapshot real de preço, data (OD-08) depois de tudo isso.
