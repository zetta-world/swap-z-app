# FOUNDERS NFT — DECISÕES DO DONO · 🟢 decisões do dono fechadas · 🟡 restam jurídico, externos e chain

> **Revisão 4 — 04/10/2026** (aplica "FOUNDERS TREASURY POLICY + OWNER DECISION CLOSURE"; substitui a revisão 3, que
> segue no histórico do Git em `8cbca28`). Lane B. Implementação local em `src/lib/founders-sale/` (L-038, L-039).
> Política de capital e tesouraria: **`FOUNDERS-TREASURY-AND-CAPITAL-POLICY.md`** (autoritativa).
> Desenho: `FOUNDERS-NFT-SALE-DESIGN.md` · economia: `FOUNDERS-NFT-CAPITAL-MODEL.md` · funil e validação de demanda:
> `FOUNDERS-NFT-LAUNCH-FUNNEL.md` §D · copy: `FOUNDERS-NFT-COPY-CORRECTION.md` (aplicada, `a8378d9`).

## Registro das decisões do dono (04/10/2026)

```
OD-NFT-14=APPROVED
PREMIUM_TERM_MONTHS=36            # contados do encerramento oficial da venda
VERSION_BASED_EXPIRY=REMOVED

OD-NFT-02=PENDING_REAL_DEMAND_VALIDATION
PRICE_PRO_USD=149 · PRICE_TRADER_USD=399 · PRICE_PILOT_USD=1990   # provisórios, NÃO mudam nesta rodada
PRICE_STATUS=PROVISIONAL_FOR_DEMAND_VALIDATION
PAYMENT_ANCHOR=USD · PAYMENT_ASSET=SOL · PHASE_PRICE_BEHAVIOR=SNAPSHOT_AND_FREEZE

PAID_SALE_SUPPLY_PRO=2000 · PAID_SALE_SUPPLY_TRADER=750 · PAID_SALE_SUPPLY_PILOT=100 · PAID_SALE_SUPPLY_TOTAL=2850

OD-NFT-04=APPROVED
RESERVED_PRO=30 · RESERVED_TRADER=10 · RESERVED_PILOT=0 · TOTAL_RESERVED=40   # FORA dos 2.850 pagos
COLLECTION_MAX=2890                                                          # capital continua sobre os 2.850 pagos
RESERVE_USES=STRATEGIC_ECOSYSTEM_PARTNERS | AUDITED_COMMUNITY_REWARDS_CAMPAIGNS

OD-NFT-11=APPROVED_SUBJECT_TO_LEGAL_AND_TECHNICAL_COMPATIBILITY
ROYALTY_PERCENT=2.5 · ROYALTY_DESTINATION=TREASURY · HOLDER_DISTRIBUTION=NONE · MARKETED_AS_BENEFIT=NO

OD-NFT-20=APPROVED
MONTHLY_PLAN_RELATIONSHIP=SEPARATE_COMMERCIAL_PRODUCTS
PLUS_30_PERCENT_RULE=NON_BINDING_PRICING_GUIDANCE

OD-NFT-21=APPROVED
DEMAND_VALIDATION_RULE_VERSION=1
QUALIFIED_INTEREST_MIN=35% do supply PAGO do tier (teto inteiro) · NON_BINDING_INTENT_MIN=20% (teto inteiro)
PASS exige os três tiers

OD-NFT-22=PARTIALLY_CLOSED
TREASURY_MODE=MULTISIG · PLANNING_THRESHOLD=2_OF_3
SIGNER_ROLES=A_CEO / B_INDEPENDENT_FINANCE_SECURITY / C_INDEPENDENT_RECOVERY_CONTINUITY
SIGNER_IDENTITIES=PENDING_OWNER_IDENTITY_SELECTION
CONVERSION_PRINCIPLE=APPROVED (obrigações operacionais de 24 meses fora do risco SOL)
CONVERSION_PARAMETERS=PENDING_LEGAL (análise de risco documentada + revisão contábil/jurídica)

OD-NFT-08=PENDING_EXTERNAL_READINESS
OD-NFT-16=PENDING_LEGAL · OD-NFT-17=PENDING_LEGAL

CAPITAL_POLICY=APPROVED · RUNWAY_TARGET_MONTHS=24 · CEO_MONTHLY_REFERENCE_BRL=15000
```

## Status de cada decisão

| OD | tema | status | o que vale / quem destrava |
|---|---|---|---|
| 01 | chain/padrão | **APPROVED** | Solana + Metaplex Core, programa de venda padrão, sem contrato próprio |
| 02 | preço | **PENDING_REAL_DEMAND_VALIDATION** | $149 / $399 / $1.990 provisórios; final só depois do resultado real da regra v1 (OD-21) |
| 03 | ativo de pagamento | **APPROVED** | só SOL no lançamento |
| 04 | reserva fora da venda | **APPROVED** | 30 / 10 / 0 = 40, divulgada, fora dos 2.850; só parceiros estratégicos e campanhas de comunidade auditadas; cada emissão com finalidade, categoria, aprovação, registro de mint e evento de auditoria; não usada = não mintada |
| 05 | teto por carteira | **APPROVED** | allowlist 1 por tier; pública 2 (Pilot 1) |
| 06 | elegibilidade | **APPROVED** (modelo) · país **PENDING_LEGAL** | híbrido (Early Access verificado + lista curada pequena; Pilot só allowlist); critério de país = OD-16 |
| 07 | fases | **APPROVED** | allowlist 48 h → pública até esgotar ou 14 dias |
| 08 | momento | **APPROVED** (regra) · data **PENDING_EXTERNAL_READINESS** | data só depois de jurídico + Vercel + ensaio hospedado + devnet + provedores + antecedência de anúncio (≥ 14 dias) |
| 09 | não vendido | **APPROVED** | fica não mintado |
| 10 | tesouraria | **APPROVED** | multisig 2-de-3; política em `FOUNDERS-TREASURY-AND-CAPITAL-POLICY.md` |
| 11 | royalty | **APPROVED_SUBJECT_TO_LEGAL_AND_TECHNICAL_COMPATIBILITY** | 2,5 % → tesouraria; nenhuma distribuição a holders; nunca anunciado como benefício; compatibilidade **PENDING_CHAIN** (devnet) e revisão jurídica antes da mainnet |
| 12 | transferência | **APPROVED** | premium e status seguem o holder atual |
| 13 | revelação/metadata | **APPROVED** | sem revelação; metadata travado ao fim da venda |
| 14 | janela premium | **APPROVED** | 36 meses do encerramento oficial |
| 15 | governança | **APPROVED** | enquetes de produto não vinculantes; sem governança de tesouraria |
| 16 | jurisdição/geoblock/KYC | **PENDING_LEGAL** | aplicação técnica configurável pronta (`juridico.*`), sem lista inventada |
| 17 | reembolso/consumidor | **PENDING_LEGAL** | idem |
| 18 | utilidades no lançamento | **APPROVED** | grupo A + grupo B como roadmap sem data; nada do grupo C |
| 19 | copy ao vivo | **APPROVED** · aplicada (`a8378d9`) | levar ao release exige C1 + recert |
| 20 | planos mensais | **APPROVED** | produtos separados; "+30 %" = orientação NÃO vinculante (abaixo) |
| 21 | validação de demanda | **APPROVED** (regra v1) | coleta real **PENDING_VERCEL** + consentimento **PENDING_LEGAL** |
| 22 | signatários e conversão | **PARTIALLY_CLOSED** | papéis e procedimentos aprovados; identidades **PENDING_OWNER**; parâmetros de conversão **PENDING_LEGAL** |

Contagem (OD-NFT-01…22): **APPROVED 17** (01, 03, 04, 05, 06-modelo, 07, 08-regra, 09, 10, 12, 13, 14, 15, 18, 19, 20, 21) ·
**APPROVED_SUBJECT_TO… 1** (11) · **PARTIALLY_CLOSED 1** (22) · **PENDING_REAL_DEMAND_VALIDATION 1** (02) ·
**PENDING_LEGAL 2** (16, 17). Nenhuma `UNRESOLVED`.

## OD-NFT-20 — interpretação usada (com evidência)

- **Origem do "+30 %":** `docs/NFT-BRIEFING.md` §9 ("Por que +30 %: recompensa quem entra no lançamento … maior margem")
  e `src/lib/pricing/plans.ts` `NORMAL_PREMIUM = 1.3`, que só entra em `normalMonthlyUsd()` quando um tier **não** tem
  `monthlyUsd`. Os três tiers têm âncora explícita definida pelo CEO (7,90 / 20,90 / 159) — o fator nunca é usado.
- **Nunca foi direito do cliente:** nenhuma copy pública (`messages.ts`, 4 línguas) menciona "+30 %" (trava em
  `guardas-seguranca.test.ts`); não existe termo, página ou contrato que prometa prêmio mínimo do mensal sobre o NFT.
- **Classificação:** `NON_BINDING_PRICING_GUIDANCE`. NFT Founders e assinaturas são produtos comerciais separados; os
  Founders têm o direito premium aprovado por 36 meses; as assinaturas continuam abertas a não holders; o preço futuro
  do mensal é decisão comercial livre, sem armadilha de manter um percentual sobre a economia do NFT.

## OD-NFT-21 — regra pré-registrada v1 (congelada antes de qualquer dado real)

| tier | supply pago | qualificados ≥ ⌈35 %⌉ | intenção não vinculante ≥ ⌈20 %⌉ |
|---|---|---|---|
| Pro | 2.000 | **700** | **400** |
| Trader | 750 | **263** (262,5 → teto) | **150** |
| Pilot | 100 | **35** | **20** |

- `QUALIFIED_INTEREST` = e-mail verificado + carteira assinada + elegível pela política de jurisdição futura + tier
  escolhido. `NON_BINDING_PURCHASE_INTENT` = qualificado + intenção explícita "pretende comprar" **ao preço provisório
  declarado do tier** (o preço exibido é gravado — migration 0072). Ninguém fica obrigado.
- **PASS** = os três tiers nos dois mínimos. **INCONCLUSIVE** = algum tier abaixo com demanda **agregada material** —
  operacionalizada como soma dos qualificados ≥ 998 **e** soma das intenções ≥ 570 (a soma dos mínimos pré-registrados,
  sem número novo) — ou política de jurisdição não final / alterada durante a janela. **FAIL** = janela fechada e
  agregado abaixo dessas somas. Antes da coleta: `AWAITING_REAL_COLLECTION`; janela aberta: `COLLECTING`.
- Regra alterada = `INVALID_RULE` (falha fechada); mudança exige nova decisão do dono + **v2**, preservando o resultado
  v1. Cada resultado carrega versão e fingerprint da regra.
- `PRICE_STATUS` continua `PROVISIONAL_FOR_DEMAND_VALIDATION` até um resultado real PASS (e decisão OD-NFT-02).

## O que NÃO é decisão do dono (classificado)

| item | classe | por quê |
|---|---|---|
| identidades humanas dos 3 signatários | **PENDING_OWNER** | única escolha que continua dele |
| preço final (OD-02) | **PENDING_REAL_DEMAND_VALIDATION** | depende do resultado real da regra v1 |
| data de lançamento (OD-08) | **PENDING_EXTERNAL_READINESS** | depende de jurídico, Vercel, ensaio hospedado, devnet, provedores |
| jurisdição/KYC/geoblock (OD-16), reembolso/consumidor (OD-17), Termos/Privacidade, consentimento dos sinais de demanda | **PENDING_LEGAL** | advogado |
| parâmetros de conversão (frações, tranches, limites, contrapartes) | **PENDING_LEGAL** | análise de risco documentada + contador/jurídico; números finais voltam ao dono **depois** da análise |
| janela de coleta de demanda | **PENDING_VERCEL** | só existe com o Early Access hospedado; registrada antes do primeiro dado |
| endereço da multisig, compatibilidade de royalty, programa da coleção, snapshot real de preço | **PENDING_CHAIN** | devnet → mainnet com autorização |
| provedor da referência SOL/USD, e-mail/DNS, RPC/DAS, wallet adapter | **PENDING_EXTERNAL** | provedores |

**Ações externas:** advogado cripto-BR (OD-16, OD-17, framing, termos/privacidade — hoje `UNAPPROVED`, consentimento
da coleta de demanda, revisão de royalty), contador (reserva tributária, conversão, gross-up da remuneração do CEO),
R-01 Vercel, provedor de e-mail/DNS do Early Access.
