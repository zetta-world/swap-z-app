# FOUNDERS NFT SALE READINESS — WHITELIST, SALE ENGINE & LAUNCH EXPERIENCE · 🟡 FUNDAÇÕES LOCAIS (lane B)

> **Aberto em:** 04/10/2026, lane B `pre-vercel-forward-20261003T234200Z` (L-031, PV-A08).
> **Não é feature nova:** é o item 5.4 de `docs/POLISH-PLAN.md` ("coleção NFT + mint UI"), com o modelo de
> 2 camadas travado em `docs/NFT-BRIEFING.md`. Este documento cobre só a parte **independente de decisão**.
> **Invariantes:** `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF`. Nenhum contrato, nenhuma rede
> real, nenhum fundo, nenhuma rota pública, nenhuma migration.

## 1. O que já existia (inventário, 04/10)

| coisa | o que é | relação |
|---|---|---|
| `NFT-BRIEFING.md` | modelo 2 camadas (Premium 3a/v3 + Founder vitalício), tiers, metadata proposta (§6), decisões em aberto (§7) | fonte das decisões |
| `src/lib/tier/{types,gods}.ts`, `/pricing`, `FounderBenefits` | tiers e UI de preço (UI-only; CTA de mint abre waitlist local) | consumidores futuros |
| `/nft` (`NftView`) | **agregador de mercado NFT** (OpenSea/Blur/…) | **sem relação** com a venda |
| `WhitelistPanel` (admin) | lista `ADMIN_WALLETS` (env) | **sem relação** (é allowlist de admin) |
| Early Access (Fases 1–2) | lista pública de interessados, gate fechado | pode alimentar elegibilidade **se o dono decidir** |
| motor de venda / allowlist de mint / Merkle / mint | **não existia** | este trabalho |

## 2. Decisões do dono (NÃO inventadas aqui)

| decisão | estado | fonte |
|---|---|---|
| supply por tier | **decidido**: 1.500 Pro / 500 Trader / 50 Pilot | `NFT-BRIEFING.md` §7.1 — mesmo assim entra como **configuração**, não constante |
| chain de mint | aberta ("Solana confirmada?") | §7.7 |
| preço final / moeda de pagamento | aberto (1.5/4/30 SOL a confirmar; pricing USD-pegged no `PLANO-MESTRE`, SUPERSEDED) | §7.2 |
| alocação máxima por carteira | aberta | — |
| fases da venda (allowlist/pública), horários | abertos | — |
| royalties (% e destino) | aberto | §7.3 |
| utilidade extra | aberta | §7.6 |
| política de elegibilidade da allowlist (ex.: early access verificado?) | aberta | — |
| tesouraria de destino | aberta (Squads citado no `PLANO-MESTRE`, SUPERSEDED) | — |
| transfer/reveal | aberto | — |
| jurisdição/geoblock e revisão legal do royalty-share | abertos | §7.8, §4 |

## 3. Fundações implementadas (todas puras, sem rede, sem banco)

`src/lib/founders-sale/`:

| módulo | o que faz | decisão de que NÃO depende |
|---|---|---|
| `maquina.ts` | máquina de estados da venda: `rascunho → agendada → allowlist_aberta → publica_aberta → esgotada / encerrada`, `pausada` (com retorno ao estado anterior), `cancelada`; só transições da matriz | horários, fases concretas |
| `allowlist.ts` | snapshot versionado da allowlist: normalizador de endereço **injetado**, dedup, ordenação, id determinístico (sha256 do conteúdo canônico), diff entre versões | chain, formato de endereço |
| `merkle.ts` | árvore de Merkle com **hash injetado** e codificação de folha injetada; prova e verificação; pares ordenados | chain (keccak × sha256 × outro) |
| `alocacao.ts` | livro de reservas com teto de supply e teto por carteira, idempotência por chave, expiração, confirmação; serializado por fila (prova contra oversell em corrida) | preço, moeda, tetos concretos |
| `mint-falso.ts` | provedor de mint **falso e determinístico** (id derivado da reserva; falhas transitória/permanente configuráveis; idempotente) | qualquer rede real |
| `ciclo-tx.ts` | estados de UI do ciclo da transação (`ocioso → assinando → enviada → confirmando → confirmada / falhou / expirada / rejeitada`) | carteira/chain |

Testes: oversell em corrida, teto por carteira, replay/duplo envio, pausa, esgotado, Merkle válido/inválido,
determinismo de snapshot, matriz de transições.

## 4. Ainda não feito (A — pode ser feito localmente depois)

Esqueleto de UI (contagem regressiva, progresso, estados de elegibilidade, acessibilidade, responsivo),
esquema de telemetria, formato de evidência da venda, modelo de segurança do admin. Nada disso exige decisão,
mas também nada disso deve ir para uma rota pública antes das decisões do §2.

## 5. O que destrava cada próximo passo

| passo | precisa de |
|---|---|
| persistência (migration de reservas/allowlist) | decisão de elegibilidade + tetos; depois vira trabalho A |
| integração com carteira/chain | §7.7 chain |
| preço/pagamento | §7.2 preço e moeda + tesouraria |
| mint real | tudo acima + revisão legal + autorização do dono (categoria E) |
