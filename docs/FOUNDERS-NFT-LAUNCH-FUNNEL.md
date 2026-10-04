# FOUNDERS NFT — FUNIL, MÉTRICAS, VALIDAÇÃO DE DEMANDA E O QUE DÁ PARA CONSTRUIR ANTES DA VERCEL · 🟡 PROPOSTA

> **Revisão 2 (04/10/2026):** decisões do dono aplicadas (36 meses; 2.000/750/100; $149/$399/$1.990 provisórios).
> Novo §D: gate de validação de demanda antes de `PRICE_STATUS=FINAL`. Dependências do §12 atualizadas.

> 04/10/2026, lane B, só docs. Nenhuma mensagem foi enviada. Nenhuma meta numérica: não existe valor do dono.
> Eventos de telemetria já definidos: `src/lib/founders-sale/telemetria.ts` (11 eventos, sem PII).

## 9. Funil de captação

| etapa | objetivo | CTA | evento de conversão | risco de abandono | evento de medição | asset/copy necessário | já implementado? |
|---|---|---|---|---|---|---|---|
| DESCOBERTA | trazer público qualificado | link para a página | visita com origem | público errado (curioso de "mint barato") | page view + UTM (Early Access guarda UTM) | posts, vídeo demo, página | **não** (sem campanha) |
| LANDING | entender o que é em 10 s | "Entrar na allowlist" | clique no CTA | página genérica de mint | `sale_state_viewed` | hero + tese + preço em USD | **parcial** (`/pricing`, copy desatualizada) |
| VALOR | entender Camada A × B e o prazo | "Ver benefícios" | leitura da seção | promessa confusa, cheiro de investimento | scroll/seção vista | utilidades A/B, FAQ, risco | **parcial** (`FounderBenefits`, FAQ) |
| INSCRIÇÃO NA ALLOWLIST | capturar interesse com consentimento | formulário do Early Access | inscrição `pending` | atrito do formulário, termos | `early_access` evento `created` | termos/privacidade **aprovados** | **sim, certificado, não deployado** (gate fechado; versões legais `UNAPPROVED`) |
| QUALIFICAÇÃO | provar e-mail, carteira e país | link de confirmação; "assinar com a carteira" | `email_verified_at`; `wallet_verified_at` | e-mail não chega; usuário sem carteira | `eligibility_checked`, `allowlist_verified` | e-mail transacional; tela de assinatura | e-mail double opt-in **sim** (Fase 2); **assinatura de carteira não existe** |
| CARTEIRA PRONTA | ter carteira na chain certa com saldo | "Conectar carteira" | carteira conectada na rede certa | rede errada, saldo insuficiente | `wallet_connected` | guia "como preparar a carteira" | conexão de carteira **sim** (app); checagem de rede da venda **não** |
| LEMBRETE | trazer de volta na abertura | e-mail "a janela abre em X" | clique no lembrete | e-mail no spam (sem DKIM/DMARC hoje) | abertura/clique | e-mail de lembrete | **não** (provedor real pendente) |
| COMPRA | concluir com segurança | "Mint" | `tx_confirmed` | prompt abandonado, tx falha, esgotou | `mint_intent_created`, `wallet_prompted`, `tx_submitted`, `tx_confirmed`, `tx_failed`, `sold_out_seen` | estados de transação, erros claros | **local** (painel + mint falso) |
| ONBOARDING DO HOLDER | ativar o premium e reter | "Abrir o app como Founder" | primeira ação premium | não perceber o valor | tier ativado (`tier_cache`) | tela de boas-vindas | leitura do passe **sim** (`tier/check.ts`); tela **não** |
| REFERRAL / COMUNIDADE | trazer pares | código de convite; comunidade | inscrição com `referred_by` | incentivo virar spam/sybil | `referral_*` (Early Access) | política de referral **sem recompensa** | código de referral **sim** (sem recompensa) |

Proibido: escassez falsa ("restam 3" sem dado on-chain), número de compradores inventado, contagem sem horário real.

## 10. Métricas de sucesso (definidas antes; sem metas)

**Capital**
- vendas pagas por tier · sell-through % por tier · gross em USD (preço na confirmação) · NFTs médios por comprador ·
  tempo até 25 / 50 / 75 / 100% · receita por fase (allowlist × pública).

**Comunidade**
- inscrições na allowlist · inscrições qualificadas (e-mail + carteira + país) · conversão conectar-carteira ·
  conversão elegível → compra · compradores únicos · concentração de holders (top-10 carteiras / supply; Gini) ·
  conversão de referral (se usado) · holders que fazem a 1ª ação premium em 7 dias.

**Segurança / operação**
- taxa de transação falha · prompts de carteira abandonados · tentativas em rede errada · recusas por prova Merkle ·
  recusas por teto de carteira · pausas acionadas · divergência vendido (app) × supply on-chain (deve ser 0) ·
  ações de admin registradas · tempo entre `tx_submitted` e `tx_confirmed`.

## D. Validação de demanda — gate antes de `PRICE_STATUS=FINAL`

Até este gate passar: **`PRICE_STATUS=PROVISIONAL_FOR_DEMAND_VALIDATION`**. Nenhuma página diz "preço final".

**Princípios:** só sinal coletado com consentimento (Early Access, termos aprovados); nada de escassez falsa, demanda
fabricada, contador inflado, promessa de esgotar ou "reserva" paga. Intenção declarada é **não vinculante** e é
apresentada assim.

**Evidência exigida (por tier):**

| sinal | como se mede | de onde vem | já existe? |
|---|---|---|---|
| interesse na allowlist | inscrições `pending` | Early Access (`created`) | sim (não deployado; gate fechado) |
| interesse qualificado | e-mail confirmado + carteira assinada + país permitido | `email_verified_at`, `wallet_verified_at`, país | e-mail sim; **assinatura de carteira não existe** |
| preferência de tier | pergunta opcional "qual passe você pretende" (Pro/Trader/Pilot/indeciso) | campo novo no Early Access + texto de consentimento | **não** (exige produto + jurídico) |
| intenção de conversão | pergunta opcional não vinculante sobre o preço provisório exibido | idem | **não** |
| feedback da comunidade | comentários estruturados / enquete | canal oficial | não |
| carteiras com saldo suficiente | checagem só-leitura no momento da qualificação, sem guardar saldo | RPC | não |

**Critério de aceitação — OD-NFT-21 APPROVED (04/10/2026), regra pré-registrada v1:** por tier, sobre o supply PAGO,
qualificados ≥ ⌈35 %⌉ **e** intenção não vinculante (ao preço provisório exibido) ≥ ⌈20 %⌉ → Pro 700/400 · Trader
263/150 · Pilot 35/20; PASS exige os três; INCONCLUSIVE = tier abaixo com agregado ≥ soma dos mínimos (998/570) ou
política de jurisdição não final/alterada; FAIL = janela fechada com agregado abaixo. Regra mexida = `INVALID_RULE`;
mudança = v2 com o resultado v1 preservado. Implementação: `src/lib/founders-sale/demanda.ts`; preço exibido gravado
pela migration 0072. Janela: registrada antes do primeiro dado, quando o Early Access estiver hospedado (PENDING_VERCEL).
O que fazer depois de um FAIL/INCONCLUSIVE (repreço, menos supply, adiar) é a decisão OD-NFT-02 tomada **com** o
resultado na mão — não muda a regra.

**Pacote para promover a FINAL:** contagens por tier e por estágio (inscrito → qualificado → com preferência), datas
da janela, regra `k_t` registrada antes, resultado, decisão do dono registrada no ledger. Só então
`PRICE_STATUS=FINAL` e os preços entram na configuração versionada da venda (com fingerprint).

## 12. O que dá para construir LOCALMENTE antes da Vercel (sem começar agora)

Prioridade = quão perto deixa de poder vender.

| # | trabalho | classe | depende de |
|---|---|---|---|
| 1 | aplicar a copy corrigida (`FOUNDERS-NFT-COPY-CORRECTION.md`, 4 línguas) | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS — **decisão aprovada**, só falta rodada de produto | OD-NFT-19 ✅ |
| 2 | configuração da venda (supply 2.000/750/100, preços provisórios, snapshot-e-congela por fase, tetos, fases) como dado versionado + fingerprint; atualizar `plans.ts` | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS — pode começar com preço marcado PROVISÓRIO | OD-NFT-02 (parcial), 05 ✅, 07 ✅; reserva OD-NFT-04 |
| 3 | geração do snapshot da allowlist a partir do Early Access (e-mail verificado + carteira verificada + país) + lista curada | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-06 (princípio ✅); filtro de país depende do jurídico (OD-NFT-16) |
| 4 | verificação de carteira por assinatura (preenche `wallet_verified_at`) | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-01 ✅ (Solana) |
| 5 | adaptadores reais da chain no domínio local (normalizador de endereço, hash Merkle, leitor de confirmação) | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-01 ✅ |
| 6 | metadata final dos 3 tiers + atributos Founder ("Premium Window" = 36 meses do fim da venda; sem "v3") | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-12, 13, 14, 15 ✅ |
| 7 | página de venda real (rota atrás de flag desligada) reaproveitando o painel | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-19 ✅ + copy |
| 8 | migration de persistência (allowlist, reservas, eventos da venda) — testada em banco descartável | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-05 ✅, 06 (princípio ✅) |
| 9 | ensaio completo em **devnet/localnet** (coleção, guardas, prova Merkle, teto, pausa, preço snapshot-e-congela, reconciliação) | CAN_BUILD_NOW_AFTER_OWNER_DECISIONS | OD-NFT-01 ✅, 02 (parcial), 10 (signatários: OD-NFT-22) |
| 10 | tela de onboarding do holder + badge/tema Founder | CAN_BUILD_NOW_WITHOUT_OWNER_DECISIONS | — |
| 11 | rascunhos de FAQ, divulgação de risco e termos da venda **para o advogado** | CAN_BUILD_NOW_WITHOUT_OWNER_DECISIONS | — (o texto final é jurídico) |
| 12 | painel admin da venda (estado, pausa em 2 passos, snapshot, reconciliação) só local | CAN_BUILD_NOW_WITHOUT_OWNER_DECISIONS | — |
| 13 | métricas do §10 e do §D como consultas/painel sobre a telemetria já definida | CAN_BUILD_NOW_WITHOUT_OWNER_DECISIONS | — |
| 13b | campos opcionais de preferência de tier e intenção (Early Access) para a validação de demanda | ✅ domínio + 0071/0072 feitos (L-038/L-039); formulário/adapter **PENDING_LEGAL** (consentimento) + **PENDING_VERCEL** | OD-NFT-21 ✅ |
| 14 | Hall of Fame opt-in (componente + preferência) | CAN_BUILD_NOW_WITHOUT_OWNER_DECISIONS | — |
| 15 | deploy da página, do Early Access e das rotas de venda | REQUIRES_VERCEL | R-01 |
| 16 | coleção e venda em mainnet, tesouraria recebendo | REQUIRES_CHAIN/MAINNET | OD-NFT-01, 10 + autorização |
| 17 | e-mails reais (confirmação, lembrete), DNS/DKIM/DMARC | REQUIRES_EXTERNAL_PROVIDER | Resend/domínio (gates EA) |
| 18 | comunidade token-gated, RPC/DAS de produção | REQUIRES_EXTERNAL_PROVIDER | provedores |
| 19 | termos/privacidade aprovados, framing do royalty, geoblock/KYC, abertura pública | REQUIRES_LEGAL_APPROVAL | advogado cripto-BR |

**CAN_BUILD_BEFORE_VERCEL = 15** (contagem de 04/10, rev. 2). Situação em L-039: o que era local foi feito (L-038/L-039); nenhum item segue bloqueado por decisão do dono — o restante é jurídico, Vercel, provedor ou chain.
