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
| `ciclo-tx.ts` | estados do ciclo da transação (`ocioso → preparando → assinando → enviada → confirmando → confirmada / falhou / expirada / rejeitada`) | carteira/chain |
| `relogio.ts` | relógio **autoritativo do servidor** (sincronização injetada + monotônico injetado; sem sync = `sem_hora`) e contagem para janela início/fim futura | horários |
| `visao.ts` | modelo de visão: os **14 estados de UI** (precedência: tx → venda → contagem → elegibilidade), `podeMintar`, progresso (mintado/reservado/disponível; percentual só com aritmética honesta, arredondado para baixo; `indisponivel`/`inconsistente` em vez de número inventado), alocação abstrata (alocação/usado/restante/elegibilidade/prova) | supply, tetos |
| `admin.ts` | camada de segurança do admin **local**: pedido → confirmação com frase exata, validade, segundo operador opcional, pausa/retomada, transição de fase, congelamento e identidade do snapshot (allowlist só abre com snapshot congelado); todo pedido/recusa/execução vira evidência `admin_audit` | quem são os operadores |
| `evidencia.ts` | evidência imutável encadeada (sha256, JSON canônico, deep-freeze): `allowlist_snapshot`, `merkle_root`, `proof_version`, `sale_config_fingerprint`, `mock_tx_lifecycle`, `admin_audit`, `sold_out_reconciliation`; `verificarCadeia` detecta elo quebrado/conteúdo alterado | — |
| `telemetria.ts` | esquema fechado dos 11 eventos (campos por evento, tipos estritos; hash só 16/64 hex — endereço cru de 40 hex é recusado; filtros de email/endereço/base58/prefixo de segredo) | provedor de analytics |

Testes: oversell em corrida, teto por carteira, replay/duplo envio, pausa, esgotado, Merkle válido/inválido,
determinismo de snapshot, matriz de transições; relógio/contagem; os 14 estados alcançáveis e "confirmada sem
id de transação" continua PENDING (**nenhum sucesso falso**); admin (frase, validade, reuso, segundo operador,
snapshot); cadeia de evidência (adulteração); telemetria (PII recusada).

### UI (`src/components/founders/`) — sem rota

| peça | o que é |
|---|---|
| `FoundersSalePanel.tsx` | painel só de apresentação, identidade Z-SWAP (vidro dourado/violeta, Syne/DM Mono, tokens do tema), `useT` com namespace `founders` nas 4 línguas |
| `galeria.ts` | dados **falsos e fixos** dos 14 estados (supply/horário/alocação de exemplo — não são decisões) |
| `founders-panel.test.ts` | render estático (sem DOM, sem rede) dos 14 estados × 4 línguas: sem chave crua, tradução real, botão só habilitado em ELIGIBLE/SALE_ACTIVE com motivo ligado por `aria-describedby`, região rotulada, `role=status` `aria-live=polite`, ícones `aria-hidden`, animação só `motion-safe:`, CONFIRMED só com referência, progresso sem percentual inventado |
| `scripts/founders/a11y-galeria.mjs` | checagem em Chrome local (file://, rede bloqueada): 375/768/1280 px em en e zh (sem rolagem horizontal, sem texto cortado, alvo ≥ 44 px), teclado (Tab só nos botões habilitados, foco visível), árvore de acessibilidade via CDP (14 regiões nomeadas, 14 status polite, 12 botões desabilitados com descrição, progressbar com valuetext, ícones fora da árvore), `prefers-reduced-motion: reduce` zera animações |

Resultado em 04/10 (lane B): **41 PASS / 0 FAIL**; evidência e screenshots em
`zswap-local/evidence/pre-vercel-forward-20261003T234200Z/founders-ui/`.
**Trava:** `isolamento.test.ts` falha se qualquer arquivo de `src/app` importar `founders-sale` ou
`components/founders`, se outro componente usar o painel, ou se o painel fizer chamada de rede. A prévia é
gerada fora do app (HTML estático), de propósito: nada disso vira rota antes das decisões do §2.

## 4. Estado do trabalho independente de decisão (04/10)

🟢 feito localmente: esqueleto de UI (14 estados), contagem, progresso, alocação, segurança do admin, telemetria,
formato de evidência, acessibilidade/responsivo (§3). Nada disso está em rota. O que sobra **depende do dono**
(§2) ou de provedor externo (carteira/chain/analytics) — ver §5.

## 5. O que destrava cada próximo passo

| passo | precisa de |
|---|---|
| persistência (migration de reservas/allowlist) | decisão de elegibilidade + tetos; depois vira trabalho A |
| integração com carteira/chain | §7.7 chain |
| preço/pagamento | §7.2 preço e moeda + tesouraria |
| mint real | tudo acima + revisão legal + autorização do dono (categoria E) |
