# FOUNDERS NFT SALE READINESS — WHITELIST, SALE ENGINE & LAUNCH EXPERIENCE · 🟢 PRONTIDÃO LOCAL FECHADA (lane B) · 🟡 externos pendentes

> **Aberto em:** 04/10/2026, lane B `pre-vercel-forward-20261003T234200Z` (L-031, PV-A08).
> **Não é feature nova:** é o item 5.4 de `docs/POLISH-PLAN.md` ("coleção NFT + mint UI"), com o modelo de
> 2 camadas travado em `docs/NFT-BRIEFING.md`. Este documento cobre só a parte **independente de decisão**.
> **Invariantes:** `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF`. Nenhum contrato, nenhuma rede
> real, nenhum fundo, nenhuma rota pública, nenhuma migration.

## 1. O que já existia (inventário, 04/10)

| coisa | o que é | relação |
|---|---|---|
| `NFT-BRIEFING.md` | modelo 2 camadas (Premium 36 meses do fim da venda — v3 removido, OD-NFT-14 de 04/10/2026 + Founder permanente), tiers, metadata proposta (§6), decisões em aberto (§7) | fonte das decisões |
| `src/lib/tier/{types,gods}.ts`, `/pricing`, `FounderBenefits` | tiers e UI de preço (UI-only; CTA de mint abre waitlist local) | consumidores futuros |
| `/nft` (`NftView`) | **agregador de mercado NFT** (OpenSea/Blur/…) | **sem relação** com a venda |
| `WhitelistPanel` (admin) | lista `ADMIN_WALLETS` (env) | **sem relação** (é allowlist de admin) |
| Early Access (Fases 1–2) | lista pública de interessados, gate fechado | pode alimentar elegibilidade **se o dono decidir** |
| motor de venda / allowlist de mint / Merkle / mint | **não existia** | este trabalho |

## 2. Decisões do dono (NÃO inventadas aqui)

> ⚠️ **Estado vigente de todas as decisões: `docs/FOUNDERS-NFT-OWNER-DECISIONS.md` (rev. 3, 04/10/2026).** A tabela
> abaixo é o inventário original; as linhas de supply e preço foram atualizadas.

| decisão | estado | fonte |
|---|---|---|
| supply por tier | **decidido (04/10/2026)**: **2.000 Pro / 750 Trader / 100 Pilot** (supply pago da proposta comercial; antes 1.500/500/50) | `FOUNDERS-NFT-OWNER-DECISIONS.md` — entra como **configuração**, não constante |
| chain de mint | aberta ("Solana confirmada?") | §7.7 |
| preço final / moeda de pagamento | **parcial (04/10/2026)**: $149 / $399 / $1.990 **provisórios** até validação de demanda; âncora USD, pagamento SOL, snapshot-e-congela por fase | `FOUNDERS-NFT-OWNER-DECISIONS.md` (OD-NFT-02, 03) |
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

## 4. Estado do trabalho independente de decisão (04/10, rodada L-038)

🟢 **feito e testado localmente** (L-038): correção de copy + guardas; modelo de domínio completo
(`src/lib/founders-sale/`: config, máquina de estados autoritativa, preço com congelamento, estoque/reservas sem
oversell, allowlist híbrida + Merkle, validação de demanda, carteira/chain falsas, admin de dois passos, benefícios
36 meses, telemetria, funil, tesouraria); página `/founders-pass` com 17 seções (atrás de `FOUNDERS_SALE_PREVIEW=1`,
404 sem a flag); migration 0071 (provada em banco descartável, NÃO aplicada em produção); suítes E2E/adversarial/caos;
ensaio local com todas as flags PASS e OVERSELL = 0; runbook `docs/FOUNDERS-SALE-RUNBOOK.md`.

🟢 **L-039 (04/10):** política de tesouraria/capital aprovada (`FOUNDERS-TREASURY-AND-CAPITAL-POLICY.md`), decisões
OD-04/11/20/21 fechadas e OD-22 parcialmente (papéis), aplicadas no domínio, na página e na migration 0072. Nenhuma
decisão do dono bloqueia trabalho local; resta jurídico, Vercel, provedores, chain e as identidades dos signatários.

## 5. O que destrava cada próximo passo

| passo | precisa de |
|---|---|
| preço FINAL | resultado REAL PASS da regra de demanda v1 (OD-NFT-21, APPROVED) + decisão OD-NFT-02 |
| tesouraria | identidades dos signatários (dono) · parâmetros de conversão (jurídico/contábil) · multisig criada (chain) |
| reserva / royalty / planos mensais | ✅ decididos e aplicados (OD-NFT-04/11/20, L-039) |
| coleta de sinais de demanda (adapter 0071) | texto de consentimento aprovado (jurídico) + rotas hospedadas (Vercel) |
| página pública | termos/privacidade aprovados, OD-NFT-16/17 (jurídico) + deploy autorizado |
| integração com carteira/chain | provedores (RPC/DAS, wallet adapter) + programa em devnet |
| mint real | tudo acima + revisão legal + multisig criada + autorização do dono (categoria E) |
