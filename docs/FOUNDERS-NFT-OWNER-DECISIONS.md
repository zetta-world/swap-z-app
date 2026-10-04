# FOUNDERS NFT — DECISÕES DO DONO · 🟡 maioria aprovada · 6 entradas ainda abertas

> **Revisão 3 — 04/10/2026** (aplica a atualização de decisões do dono de 04/10; substitui a revisão 2, cujos cartões
> com opções seguem no histórico do Git em `204bb8b`). Lane B, só docs. **Nada foi implementado.**
> Desenho: `FOUNDERS-NFT-SALE-DESIGN.md` · economia: `FOUNDERS-NFT-CAPITAL-MODEL.md` · funil e validação de demanda:
> `FOUNDERS-NFT-LAUNCH-FUNNEL.md` · copy corrigida pronta para aplicar: `FOUNDERS-NFT-COPY-CORRECTION.md`.

## Registro das decisões do dono (04/10/2026)

```
OD-NFT-14=APPROVED
PREMIUM_TERM_MONTHS=36            # contados do encerramento oficial da venda
VERSION_BASED_EXPIRY=REMOVED      # nenhuma versão, renome, "v3" ou release encurta os 36 meses

OD-NFT-02=PARTIALLY_APPROVED
PRICE_PRO_USD=149
PRICE_TRADER_USD=399
PRICE_PILOT_USD=1990
PRICE_STATUS=PROVISIONAL_FOR_DEMAND_VALIDATION
PAYMENT_ANCHOR=USD
PAYMENT_ASSET=SOL
PHASE_PRICE_BEHAVIOR=SNAPSHOT_AND_FREEZE   # referência SOL/USD fotografada antes de cada fase; preço em SOL congelado na fase
                                           # fonte/mecanismo da referência: NÃO decidido

PAID_SALE_SUPPLY_PRO=2000
PAID_SALE_SUPPLY_TRADER=750
PAID_SALE_SUPPLY_PILOT=100
PAID_SALE_SUPPLY_TOTAL=2850       # substitui 1.500/500/50 na proposta comercial; reserva (OD-NFT-04) NÃO entra aqui
```

## Status de cada decisão

| OD | tema | status | o que vale |
|---|---|---|---|
| 01 | chain/padrão | **APPROVED** | Solana + Metaplex Core, programa de venda padrão, sem contrato próprio |
| 02 | preço | **PARTIALLY_APPROVED** | $149 / $399 / $1.990 **provisórios**; âncora USD, pagamento em SOL, snapshot-e-congela por fase; final só após validação de demanda (`LAUNCH-FUNNEL` §D) |
| 03 | ativo de pagamento | **APPROVED** | só SOL no lançamento |
| 04 | reserva fora da venda | **PARTIALLY_APPROVED** | princípio: toda NFT reservada precisa de propósito/categoria divulgados antes de aprovar; quantidades **não** finalizadas; não somar ao supply pago |
| 05 | teto por carteira | **APPROVED** | allowlist 1 por tier; pública 2 (Pilot 1) |
| 06 | elegibilidade | **PARTIALLY_APPROVED** | híbrido aprovado em princípio (Early Access verificado + lista curada pequena; Pilot só allowlist); elegibilidade por país segue a política jurídica (OD-16) |
| 07 | fases | **APPROVED** | allowlist 48 h → pública até esgotar ou 14 dias, mesmo preço da fase |
| 08 | momento | **APPROVED** | data só depois de jurídico + Vercel + ensaio em devnet; anúncio com ≥ 14 dias |
| 09 | não vendido | **APPROVED** | fica não mintado; nova onda só por nova decisão, com aviso público e preço ≥ ao da venda |
| 10 | tesouraria | **APPROVED** (modelo) | multisig 2-de-3 + política escrita de conversão parcial para stable — signatários e números da política: OD-NFT-22 |
| 11 | royalty | **PARTIALLY_APPROVED** | royalty **para a tesouraria**; **nenhuma** distribuição de royalty/receita a holders; % **não** finalizado |
| 12 | transferência | **APPROVED** | premium e status seguem o holder atual; Hall of Fame registra o mintador original (opt-in) |
| 13 | revelação/metadata | **APPROVED** | sem revelação; arte do tier visível; metadata travado ao fim da venda |
| 14 | janela premium | **APPROVED** | 36 meses do encerramento oficial da venda; sem expiração por versão |
| 15 | governança | **APPROVED** | enquetes de produto não vinculantes, peso = tier (1/2/3); sem governança de tesouraria |
| 16 | jurisdição/geoblock/KYC | **DEFERRED** (jurídico) | — |
| 17 | reembolso/cancelamento (texto público) | **DEFERRED** (jurídico) | — |
| 18 | utilidades no lançamento | **APPROVED** | grupo A (premium por tier, desconto de taxa, badge) + grupo B como roadmap sem data; nada do grupo C |
| 19 | copy ao vivo em conflito | **APPROVED** | neutralizar — texto pronto em `FOUNDERS-NFT-COPY-CORRECTION.md`; **aplicação pendente** (está em código de produto; esta rodada é só docs) |
| 20 | relação preço do NFT × planos mensais (+30%) | **UNRESOLVED** (novo) | ver cartão abaixo |
| 21 | critérios de aceitação da validação de demanda | **UNRESOLVED** (novo) | ver cartão abaixo |
| 22 | signatários da tesouraria e números da política de conversão | **UNRESOLVED** (novo) | ver cartão abaixo |

Contagem (OD-NFT-01…22): **APPROVED 13** · **PARTIALLY_APPROVED 4** · **DEFERRED 2** · **UNRESOLVED 3**.

## Cartões das entradas ainda abertas

### OD-NFT-20 — Planos mensais: manter a regra "+30% sobre o equivalente do holder"?
- **WHY:** a regra **decidida** (`NFT-BRIEFING.md` §9, `plans.ts` `NORMAL_PREMIUM = 1.3`) fechava com o preço antigo
  ($218 / 36 × 1,3 = $7,87 ≈ Hird $7,90). Com os novos preços ela **não fecha mais**.
- **NÚMEROS:** equivalente mensal do holder (preço / 36) e o mensal atual do plano normal:

| tier | NFT / 36 | × 1,3 (regra) | mensal atual | prêmio real do mensal |
|---|---|---|---|---|
| Pro | $4,14 | $5,38 | $7,90 | +91% |
| Trader | $11,08 | $14,41 | $20,90 | +89% |
| Pilot | $55,28 | $71,86 | $159,00 | +188% |

- **BLOCKS:** página de planos normais, copy "+30%", coerência do argumento "o lançamento é o melhor negócio".
- **OPÇÕES:** A) manter os mensais atuais e abandonar a regra "+30%" (o NFT fica bem mais vantajoso — a copy muda);
  B) reprecificar os mensais pela regra (receita recorrente menor); C) decidir depois da validação de demanda.
- **RECOMMENDED = C, e até lá A** · **REASON:** o preço do NFT ainda é provisório; mexer no recorrente agora seria
  decidir duas vezes. Enquanto isso, nada de "+30%" na copy.

### OD-NFT-21 — Critérios de aceitação da validação de demanda (antes de `PRICE_STATUS=FINAL`)
- **WHY:** sem critério escrito **antes** de olhar os dados, a validação vira justificativa a posteriori.
- **BLOCKS:** `PRICE_STATUS=FINAL`, data de lançamento.
- **EVIDÊNCIA EXIGIDA:** `FOUNDERS-NFT-LAUNCH-FUNNEL.md` §D.
- **O QUE O DONO PRECISA FIXAR:** (a) razão mínima "interesse qualificado ÷ supply" por tier (`k_t`); (b) janela de
  coleta; (c) o que acontece se um tier ficar abaixo (repreço, menos supply na fase, ou adiar).
- **RECOMMENDED:** fixar `k_t` por tier antes de abrir o Early Access ao público; Pilot exigir sinal individual
  (lista curada) em vez de razão. Os números de `k_t` são do dono — este documento não os propõe como fato.

### OD-NFT-22 — Signatários da tesouraria e política de conversão
- **WHY:** o modelo (multisig 2-de-3 + conversão parcial para stable) foi aprovado; faltam quem assina e os números.
- **BLOCKS:** endereço de destino do pagamento, verificação pública, ensaio em devnet com o mesmo arranjo.
- **O QUE FALTA:** identidade/função dos 3 signatários (dono + 2), guarda das chaves (hardware?), % e gatilho da
  conversão para stable, quem executa.
- **RECOMMENDED:** dono + 1 sócio/conselheiro + 1 chave de recuperação em custódia separada; conversão de uma fração
  fixa logo após cada fase, definida pelo dono com o contador.

### Detalhes ainda em aberto dentro das decisões parciais

- **OD-NFT-04:** quantidades por tier e categoria/propósito de cada lote reservado.
- **OD-NFT-11:** percentual exato de royalty (5% era o número citado na copy antiga — não é decisão).
- **OD-NFT-02:** confirmação final dos preços, depois da validação (OD-NFT-21).

### Diferidos ao jurídico (não perguntar ao dono agora)

- **OD-NFT-16:** jurisdição, geoblock, KYC — e, por consequência, o critério de país da allowlist (OD-NFT-06).
- **OD-NFT-17:** texto público de reembolso/cancelamento.

## FORMULÁRIO DE RESPOSTA DO DONO (só o que ainda é dele)

```
OD-NFT-04 — Reserva fora da venda: quantos por tier e para qual propósito/categoria cada lote?
Recommended: pequena e divulgada (ex.: Pro 30 / Trader 10 / Pilot 0 — parcerias e prêmios), cada lote com propósito público
Owner answer: __________

OD-NFT-11 — Percentual de royalty para a tesouraria?
Recommended: definir junto com o parecer jurídico; sem distribuição a holders (já aprovado)
Owner answer: __________

OD-NFT-20 — Planos mensais: manter "+30% sobre o holder" (reprecificar) ou manter os mensais atuais?
Recommended: decidir depois da validação de demanda; até lá manter os mensais atuais e tirar "+30%" da copy
Owner answer: __________

OD-NFT-21 — Critérios para promover o preço a FINAL: razão mínima interesse-qualificado ÷ supply por tier, janela de coleta, ação se ficar abaixo
Recommended: fixar k_t por tier ANTES de abrir o Early Access; Pilot validado por lista curada
Owner answer: __________

OD-NFT-22 — Signatários da multisig 2-de-3 e política de conversão para stable (% e gatilho)
Recommended: dono + 1 sócio/conselheiro + chave de recuperação separada; fração fixa convertida após cada fase, com o contador
Owner answer: __________

OD-NFT-02 (depois da validação) — Confirmar os preços finais Pro / Trader / Pilot
Recommended: só depois de cumprir OD-NFT-21
Owner answer: __________
```

**Ações externas:** advogado cripto-BR (OD-16, OD-17, framing, termos/privacidade — hoje `UNAPPROVED`), contador
(tributos, conversão), R-01 Vercel, provedor de e-mail/DNS do Early Access.
