# FOUNDERS NFT — decisões do dono ainda em aberto

> Fontes lidas: `docs/NFT-BRIEFING.md` (§0–§7) e `docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md` §2 (04/10/2026).
> **Já decidido — não perguntar de novo:** modelo de 2 camadas (Premium por 3 anos OU v3; Founder vitalício),
> os 4 tiers e o mapa Freyr/Thor/Odin, **supply 1.500 Pro / 500 Trader / 50 Pilot**, a lista de benefícios Founder
> da Camada B, a regra de framing do royalty ("rewards", nunca "dividend"), a narrativa de marketing do §5.
> Nada abaixo é escolhido aqui. `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF`.

| # | DECISION | WHY_REQUIRED | WHAT_IT_BLOCKS | SAFE_DEFAULT_EXISTS |
|---|---|---|---|---|
| 1 | **Chain de mint** (Solana/Metaplex Core está só *proposta*, §7.7) | define padrão do token, formato de endereço e função de hash da prova Merkle | normalizador de endereço e hash reais, contrato/programa, integração de carteira, metadata final | **NO** |
| 2 | **Preço final por tier** (1,5 / 4 / 30 SOL são proposta a confirmar, §7.2) | é o que o comprador paga | exibição de preço, fluxo de pagamento, economia do lançamento | **NO** (a UI mostra "indisponível") |
| 3 | **Moeda de pagamento** (SOL nativo? stable? — o pricing em USD do plano antigo está SUPERSEDED) | ligada à chain e ao preço; muda conversão, slippage e contabilidade | pagamento, recibo, reconciliação de vendido | **NO** |
| 4 | **Teto por carteira** (quantos passes por carteira, por tier/fase) | proteção contra concentração/bots; o motor já aplica o teto, falta o número | configuração do livro de alocação, view de alocação real | **NO** |
| 5 | **Fases e horários** (só allowlist? allowlist → pública? datas de início/fim) | a máquina de estados e a contagem só abrem com horário definido | transições da venda, contagem regressiva real | **YES** — a venda fica em rascunho/COMING_SOON e nada abre sem horário |
| 6 | **Política de elegibilidade da allowlist** (ex.: early access verificado? holders? lista manual?) | define quem entra no snapshot | geração e congelamento do snapshot, raiz Merkle real | **YES** — allowlist vazia = ninguém elegível (falha fechada) |
| 7 | **Tesouraria de destino** (endereço/multisig, quem assina) | para onde vai o dinheiro do mint | qualquer pagamento real | **NO** |
| 8 | **Royalty %** e **fração pool Founder × tesouraria** (§7.3) | gravado na coleção; alimenta o benefício Founder rewards | config de royalty da coleção, metadata, texto de marketing | **NO** |
| 9 | **Transferência e revelação** (transferível? o status Founder acompanha o NFT ou a carteira original? revelação imediata ou adiada?) | muda contrato/metadata e a promessa "status eterno" | programa/contrato, metadata, Hall of Fame | **NO** |
| 10 | **Jurisdição / geoblock** (quem pode comprar, §7.8) | risco regulatório (CVM/Howey) | abertura pública, termos da venda | **NO** |
| 11 | **Aprovação jurídica** do framing do royalty-share e dos disclaimers (§4: "ação obrigatória antes do mint") | o próprio briefing exige antes de publicar | marketing público, abertura da venda | **NO** |
| 12 | **Peso de governança** (`TIER_RANK` 1/2/3 ou outra curva, §7.4) | vai no metadata (atributo `Governance Weight`) | metadata final | **NO** (metadata é gravado no mint) |
| 13 | **Critério objetivo da "v3"** (§7.5) | o fim da Camada A é "3 anos OU v3" — sem critério, o gatilho é ambíguo | texto legal/termos, aplicação do fim do premium | **NO** |
| 14 | **Utilidade extra** além da lista (§7.6, opcional) | só se o dono quiser acrescentar | nada obrigatório | **YES** — nenhuma além da lista aprovada |

**Total: 14 decisões** (3 com padrão seguro: 5, 6, 14). Também externo (não é decisão de valor): contratação do
advogado do item 11 e, depois do item 1, auditoria do contrato/programa.
