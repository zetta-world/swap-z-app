# FOUNDERS NFT — MODELO DE CAPITAL · 🟡 preços PROVISÓRIOS (validação de demanda pendente)

> **Revisão 2 — 04/10/2026** (aplica as decisões do dono de 04/10; a revisão 1 com os cenários A/B/C está no Git em
> `204bb8b`). Lane B, só docs. **Cenário, não previsão nem garantia.** Uso interno: o comprador compra um produto
> (`FOUNDERS-NFT-SALE-DESIGN.md` §0); nenhum número daqui é meta pública.

## 1. Parâmetros aprovados (provisórios)

| tier | supply pago | preço (USD, âncora) | status do preço |
|---|---|---|---|
| Pro (Freyr) | 2.000 | 149 | PROVISIONAL_FOR_DEMAND_VALIDATION |
| Trader (Thor) | 750 | 399 | PROVISIONAL_FOR_DEMAND_VALIDATION |
| Pilot (Odin) | 100 | 1.990 | PROVISIONAL_FOR_DEMAND_VALIDATION |
| **total** | **2.850** | — | — |

Pagamento em SOL; referência SOL/USD fotografada antes de cada fase e preço em SOL congelado durante a fase
(mecanismo da referência: **não decidido**). Reserva (OD-NFT-04) **fora** destes números.

## 2. Gross bruto máximo

```
Pro     2.000 × 149   = 298.000
Trader    750 × 399   = 299.250
Pilot     100 × 1.990 = 199.000
TOTAL                 = 796.250 USD   (gross bruto teórico, 100% vendido)
```

## 3. Sell-through proporcional — CENÁRIO, não previsão

Unidades por tier arredondadas **para baixo** (não se vende meia NFT); o valor proporcional exato vai entre parênteses.

| sell-through | Pro (un. / USD) | Trader (un. / USD) | Pilot (un. / USD) | total USD |
|---|---|---|---|---|
| 25% | 500 / 74.500 | 187 / 74.613 | 25 / 49.750 | **198.863** (exato 199.062,50) |
| 50% | 1.000 / 149.000 | 375 / 149.625 | 50 / 99.500 | **398.125** |
| 75% | 1.500 / 223.500 | 562 / 224.238 | 75 / 149.250 | **596.988** (exato 597.187,50) |
| 100% | 2.000 / 298.000 | 750 / 299.250 | 100 / 199.000 | **796.250** |

**Líquido não estimado.** Os únicos custos com alguma evidência no repo são a revisão jurídica (R$1.500–3.000,
estimativa do `NFT-BRIEFING.md` §4) — tributos, infraestrutura, setup on-chain e marketing são **UNKNOWN** ou não
decididos. Qualquer "líquido" aqui seria inventado.

## 4. Comparação com o modelo comercial anterior

| | ANTIGO | NOVO | variação |
|---|---|---|---|
| supply Pro / Trader / Pilot | 1.500 / 500 / 50 | 2.000 / 750 / 100 | +500 (+33,3%) / +250 (+50%) / +50 (+100%) |
| supply total | 2.050 | 2.850 | **+800 (+39,0%)** |
| preço Pro | $218 | $149 | −$69 (**−31,7%**) |
| preço Trader | $580 | $399 | −$181 (**−31,2%**) |
| preço Pilot | $4.350 | $1.990 | −$2.360 (**−54,3%**) |
| gross Pro / Trader / Pilot | 327.000 / 290.000 / 217.500 | 298.000 / 299.250 / 199.000 | −29.000 / +9.250 / −18.500 |
| **gross máximo** | **834.500** | **796.250** | **−38.250 (−4,58%)** |
| participação no gross Pro / Trader / Pilot | 39,2% / 34,8% / 26,1% | 37,4% / 37,6% / 25,0% | distribuição mais uniforme |
| preço médio por NFT | $407,07 | $279,39 | −31,4% |
| Pilot como % da coleção (escassez) | 2,44% (50 de 2.050) | 3,51% (100 de 2.850) | Pilot menos raro |
| peso de 1 comprador de Pilot no gross máximo | 0,52% | 0,25% | concentração por comprador cai pela metade |
| NFTs para chegar a 50% do gross máximo (proporcional) | 1.025 | 1.425 | +400 unidades |

Leitura:
- **Acessibilidade:** o ticket de entrada cai de $218 para $149; o Pilot passa de $4.350 para $1.990. Pro em 36 meses
  ≈ $4,14/mês (antes $6,06).
- **Captação:** o teto cai 4,58% mesmo com 39% mais supply — o modelo novo depende de **mais compradores** para
  captar o mesmo.
- **Dificuldade de esgotar:** maior em unidades (2.850 × 2.050); menor em ticket. Qual efeito domina **não é
  conhecido**.
- **Concentração do capital:** cai — nenhum tier passa de 38% do gross, e cada comprador de Pilot pesa metade do que
  pesava.
- **Racional comercial pretendido (não é fato medido):** preço mais baixo e mais supply para ampliar a base de
  fundadores e a conversão. Isso só vira fato com a validação de demanda (`FOUNDERS-NFT-LAUNCH-FUNNEL.md` §D).
- **Efeito colateral a decidir:** a regra "plano normal = +30% sobre o holder" deixou de fechar (OD-NFT-20).

## 5. Riscos do modelo

- SOL/USD: o snapshot por fase protege contra variação **durante** a fase, não entre a decisão e o snapshot.
- Sell-through não é previsível pelo repo: o Early Access nunca abriu ao público; não há sinal de demanda ainda.
- O código ainda carrega os valores antigos (`src/lib/pricing/plans.ts`: 1.500/500/50, `usdTarget` 218/580/4.350) —
  atualização é trabalho de produto, fora desta rodada.
