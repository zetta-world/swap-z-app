# FOUNDERS NFT — MODELO DE CAPITAL · 🟡 CENÁRIOS (nenhum valor aprovado)

> 04/10/2026, lane B, só docs. Cenários são **propostas** para o dono escolher; nada foi escrito em configuração.
> Não é promessa a comprador: o comprador compra um produto (`FOUNDERS-NFT-SALE-DESIGN.md` §0). Projeções de
> captação são de uso **interno**.

## 1. Fórmulas

```
paid_supply_t   = supply_t × (1 − r_t)            # r_t = fração reservada (não vendida) do tier t — OD-NFT-04
gross_raise     = Σ_t  paid_supply_t × s_t × price_t   # s_t = sell-through do tier (0..1) — NÃO é meta
net_usable      = gross_raise × (1 − m)            # m = fração destinada a marketing (não decidida)
                  − legal − setup_onchain − infra_launch
                  − tax (UNKNOWN) − fx_haircut (se a tesouraria ficar em SOL)
months_runway   = net_usable × k_BRL / burn_mensal_BRL
```

Constantes **decididas** no repositório: `supply` = 1.500 / 500 / 50 (`NFT-BRIEFING.md` §7.1, `plans.ts`).
Referência **não final** do repositório: `SOL_USD_REF = 145` e `usdTarget` ≈ $218 / $580 / $4.350 (`plans.ts`,
"CONFIRM at mint"); custo de 3 anos ≈ R$25k/mês solo (`NFT-BRIEFING.md` §10, SUPPORTING_REFERENCE, estimativa).
`k_BRL ≈ 5,5` está **implícito** no briefing (5.750 SOL ≈ R$4,6M a $145) — ilustrativo, não câmbio real.

## 2. Custos conhecidos e desconhecidos

| item | valor | fonte / status |
|---|---|---|
| revisão jurídica (framing + disclaimers) | R$1.500–3.000 | `NFT-BRIEFING.md` §4 (estimativa) — valor real **UNKNOWN** até orçar |
| tributos sobre a venda | **UNKNOWN** | nenhuma evidência no repo; exige contador |
| criação da coleção / programa de venda (programa padrão, sem contrato próprio) | pequeno, em SOL | **UNVERIFIED** — medir em devnet |
| custo on-chain por mint (rent + taxa de rede) | normalmente pago pelo comprador em fluxos padrão | **UNVERIFIED** — medir em devnet |
| processador de pagamento | nenhum (pagamento on-chain direto) | — |
| infraestrutura de lançamento (Vercel, RPC, e-mail) | **UNKNOWN** | Vercel bloqueada (R-01); planos não estão no repo |
| auditoria de contrato | ~0 se usar programa padrão auditado; alta se houver contrato próprio | depende de OD-NFT-01 |
| exposição a reembolso | ~0 com "venda final"; transação falha é atômica (sem cobrança do item) | depende de OD-NFT-17 |
| exposição cambial | tesouraria em SOL oscila | depende de OD-NFT-10 |
| marketing | `m` | **não decidido** |

## 3. Cenários (100% de sell-through e r = 0, para comparar; valores em USD)

| | **A — ACESSÍVEL / COMUNIDADE** | **B — EQUILIBRADO (recomendado)** | **C — PREMIUM / ESCASSEZ** |
|---|---|---|---|
| supply pago | 1.500 / 500 / 50 (tudo) | 1.500 / 500 / 50 (tudo) | **onda 1:** 750 / 250 / 50 (resto só em onda posterior anunciada) |
| preço unitário | $99 / $299 / $1.990 | **$218 / $580 / $4.350** (= referência do repo ≈ 1,5 / 4 / 30 SOL a $145) | $349 / $899 / $6.900 |
| gross a 100% | **397.500** (148.500 + 149.500 + 99.500) | **834.500** (327.000 + 290.000 + 217.500) | **831.500** na onda 1 (261.750 + 224.750 + 345.000); 1.318.000 com as duas ondas |
| perfil do comprador | usuário de varejo testando o premium | usuário DeFi ativo que já usaria Pro/Trader | trader de alto volume, colecionador |
| risco de concentração | baixo (Pilot = 25% do gross) | médio (Pilot = 26%) | **alto** (Pilot = 41% da onda 1: 50 compradores) |
| dificuldade de esgotar | baixa | média | alta |
| conversão | alta, ticket baixo; muitos compradores de baixo engajamento | equilibrada | baixa, ticket alto; dependente de poucos |
| escassez percebida | baixa | média (supply fixo) | alta (ondas + preço) |
| complexidade operacional | média (volume de transações e suporte) | média | alta (duas ondas, comunicação de onda) |
| equivalência com o plano normal | 3 anos de Pro sairiam ~$2,75/mês (abaixo do Hird $7,90 sem o +30%) — **canibaliza** o recorrente | Pro ≈ $6,06/mês em 3 anos vs Hird $7,90 → mantém a lógica "+30%" já decidida (`NFT-BRIEFING.md` §9) | coerente, mas o Pro fica acima do mensal |

**Por que B:** é o único cenário coerente com o que já está decidido — preço normal = +30% sobre o do holder
(`plans.ts`, `NORMAL_PREMIUM`) — e com o supply fixo; não inventa escassez por ondas.

### Sensibilidade a sell-through (s uniforme entre tiers — premissa só para comparar)

| s | A | B | C (onda 1) |
|---|---|---|---|
| 25% | 99.375 | 208.625 | 207.875 |
| 50% | 198.750 | 417.250 | 415.750 |
| 75% | 298.125 | 625.875 | 623.625 |
| 100% | 397.500 | 834.500 | 831.500 |

Reserva: `gross × (1 − r)` quando r é uniforme. Ex.: B com r = 5% → 792.775 a 100%.

### Ilustração de líquido (B, s = 50%, m = 15%, r = 0) — **não é garantia**

`417.250 × 0,85 = 354.662` USD antes de jurídico, setup, infra, tributos (UNKNOWN) e câmbio. Com `k_BRL = 5,5` e
`burn = R$25.000/mês` → ~78 meses **brutos de tributos**. Serve só para dimensionar; o número real depende de
tributos, câmbio e do preço final.

## 4. Riscos do modelo

- Preço em SOL fixo: a receita em USD varia com o SOL durante a janela; preço USD-pegged protege a receita mas
  exige operação de atualização de preço (ver `SALE-DESIGN` §11).
- Concentração: Pilot pesa 25–41% do gross com 50 unidades; poucos compradores movem o resultado.
- Sell-through **não** é previsível pelo repo: não há dado de demanda (o Early Access não foi aberto ao público).
  Não usar estes cenários como meta pública.
