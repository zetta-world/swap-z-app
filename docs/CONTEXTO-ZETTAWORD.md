# CONTEXTO ZETTA WORD — dossiê completo do ecossistema

> **Propósito:** contexto total do projeto para QUALQUER agente (IA ou humano)
> que for trabalhar em qualquer repo do ecossistema. Gerado a partir da leitura
> integral dos 17 repositórios (04-05/07/2026): todos os .md, todo o conteúdo
> institucional, configs de monetização e o caminho do dinheiro linha a linha.
> **Atualize este arquivo quando decisões estratégicas mudarem.**

---

## 1. O que é o projeto

**ZETTA WORD** (zettaword.global / zettaword.com) é um ecossistema Web3+Fiat de
**horizonte de 5 anos** com 23+ produtos anunciados, token próprio e IA
proprietária (ZION). Founder/CEO único (zettaceo, contact@zettaword.global),
operando do Paraguai ("Built in Paraguay" no z-pad-app).

**Token Z:** BEP-20 na BSC, contrato `0x8AaCC38933007eC530c552007E210B4667749DF1`,
supply 1B → queima de 500M PRÉ-fair-launch → 500M final. Audit Cyberscope
nov/2024 (0 críticos, 0 médios, 14 informativos respondidos), KYC verificado.
**Tokenomics oficial (versão 2026, canônica no site institucional):** Fair
Launch AMM sem hardcap/preço fixo, softcap US$6M, 51% arrecadado → liquidez /
49% → tesouraria. Distribuição sobre 500M: 45% fair launch+liquidez, 20%
staking, 13% tesouraria, 10% marketing, 10% dev, 4% founders (vesting longo),
3% advisors. Postura legal: "não é banco, não é instituição financeira, sem
promessa financeira; serviços via parceiros autorizados/regulados".

⚠️ **CONTRADIÇÃO PÚBLICA CONHECIDA:** o repo `zettaceo/zetta-official-docs`
(dez/2024, público) ainda publica a tokenomics ANTIGA (presale 20% Pinksale,
taxas 5% buy/sell, queima gradual até ano 2, LP lock 100 anos, "Investment
Calculator" com projeções de preço, "ZION AI = GPT-4", "Z-BANCK"). Isso
contradiz e enfraquece a postura legal 2026. **Deve ser atualizado/arquivado
ANTES de reativar a comunidade do token.**

## 2. Estratégia definida pelo CEO (05/07/2026)

1. **Dinheiro primeiro, token depois.** Gerar receita com **ZION Vision** (B2B,
   fora de cripto) e **Z-SWAP** (produto + NFT) ANTES da venda dos tokens Z.
2. **Sequência Z-SWAP:** reativar a comunidade ZETTA → crescimento orgânico +
   parcerias com influencers de pequeno porte → venda dos NFTs (Panteão).
3. **NFTs são plataforma contínua**, não evento único — novos drops/utilidades
   ao longo do tempo; ideia estacionada: **jogo simples estilo Dragon Mania
   onde os NFTs invocam personagens** (utility pós-mint; o repo `tal` prova a
   capacidade de fazer jogo em Next.js).
4. **Depois da arrecadação:** preparar os demais produtos **um por vez, por
   ordem de facilidade de regulamentação e lançamento**.
5. Projeto de 5 anos — os 23 produtos são visão de longo prazo, não promessa
   de curto prazo.

## 3. Mapa dos repositórios (17)

### Núcleo com produto vivo
| Repo | O quê | Estado |
|---|---|---|
| `zetta-world/swap-z-app` | **Z-SWAP produção** (swap-z.app): agregador DEX 11 chains + 10 CEX (CCXT read-only), terminal Pro TradingView-class, ZION AI multi-modelo, flywheel de backtest, painel admin, autopilot com guards. 68k linhas. | ÚNICO produto em produção. Flywheel com 1ª safra: Agent A net +0,39% (n=72 < MIN_SAMPLE 100 → direcional). Scans pausados por crédito Anthropic até **11/07** (data do teste com dinheiro real, US$50, protocolo em `TESTE-DINHEIRO-REAL.md`) |

### Motores de receita definidos pelo CEO
| Produto | Repo | Modelo de receita |
|---|---|---|
| **ZION Vision** (B2B visão computacional: CFTV existente→IA, RTSP/Intelbras/Hikvision/Dahua, alertas WhatsApp <10s, LGPD edge, deploy 48h; varejo/indústria/agro) | `zion_vision_institucional` | Cloud Starter **R$397/mês** (4 cams) · Pro Edge **R$597/mês + R$1.500 setup** (16) · Business **R$997/mês + R$2.500 setup** (32, multi-unidade) · Enterprise sob consulta. ⚠️ Landing com WhatsApp placeholder — checklist de go-live aberto |
| **Z-SWAP NFT "O Panteão"** (Metaplex Core, Solana) | swap-z-app | 1.500 Freyr/Pro (~1.5 SOL) · 500 Thor/Trader (~4) · 50 Odin/Pilot (~30) = 2.050 NFTs ≈ R$4,6M a 100%. **USD-pegged via oráculo Pyth**. 2 camadas: Premium 3 anos/v3 + Founder vitalício. Bloqueado em: §7 do `NFT-BRIEFING.md` (royalty %, critério de v3) + revisão jurídica (framing rewards≠dividend) |
| **Z-SWAP assinaturas "A Hird"** (mensal, trilho PIX futuro) | swap-z-app `plans.ts` | Drengr **$7.90** · Berserkr **$20.90** · Einherjar **$159** /mês (+30% vs equivalente NFT; margem maior). Free = Thrall |

### Demos prontos aguardando a vez (ordem futura por facilidade regulatória)
| Produto | Repo(s) | Estado | Nota regulatória |
|---|---|---|---|
| **Z-PAD** launchpad | `z-pad-app` (Next 15, 30+ rotas i18n, mock) | Config: fee 2% plataforma (1% p/ staker ≥10k Z), listing 0.5 BNB. Segurança exemplar (CSP nonce, CodeQL) | Non-custodial → fácil; 1º case natural = o próprio token Z |
| **Obelisk-Z** wallet | `obelisk-z_app` (demo interativa L1-L5: advisory/privacy/analysis/verify/custody) · `obelisk-z` (versão antiga, arquivar) | Institucional + demo | Non-custodial → fácil |
| **Z-PAY** pagamentos | `z-pay` (institucional; ⚠️ links http://95.111.247.134:8082 = backend demo em IP cru SEM https — trocar antes de divulgar) · `z-pay-app` (dashboard demo 22 seções, ZION proxy) · `z-pay-white-paper` (programa **Founding Clients**: condições vitalícias, 3 customizações, prioridade roadmap, contato founding@zettaceo.com) | Demo completo; taxas Core PIX 4,5%/Pro 3,2% (R$79/mês) | Exige sub-adquirência/parceiro BACEN → médio-difícil |
| **Z-FINANCE** conta híbrida | `z-finance_app` (demo Vite: personas Retail/Business/Institutional, contas BRL/USD/AED/invest, admin console) · `z-finance-institucional-` (ZF-CORE v1.0, "piloto fechado", roadmap 5 fases sem datas, alinhado VARA/Dubai) | Demo institucional maduro | Mais regulado (contas, PIX, câmbio) → por último |
| **ZION** (IA transversal) | dentro do swap-z-app (`ARQUITETURA-IA.md`: Agent A Sonnet · Agent B "Ferrari" Kimi-macro+Grok-sentimento+DeepSeek-cérebro+Opus-CEO · torneio · radar T3 sem-IA · geo-routing china_ok/western) | Operacional (pausado por crédito) | — |

### Institucionais e fora do core
- `zettaceo-zetta-word-site-institucional` — site-mãe (home, whitepaper, tokenomics, technical + versões print, privacy/terms dez-2024). Fonte canônica do token.
- `zetta-official-docs` — hub público DESATUALIZADO (ver §1 ⚠️).
- `zion_vision_institucional` — landing do Z-Vision.
- Fora do core (**CEO mandou ignorar**): `luxo-reborn` (e-commerce), `Go-store` (Z-Store), `sa_lonas` (demo cliente). `tal` = jogo "A História da Princesa Tal" (10 cenas, chiptune) — prova de capacidade p/ o futuro jogo NFT.

## 4. Estado operacional e pendências (05/07/2026)

**Feito recentemente:**
- Auditoria interna (`AUDITORIA-GERAL.md`, nota 8.0) + M1-M6 entregues (testes+CI, health ping, prompt enxuto, breaker visível, RUNBOOK, preço Opus $5/$25).
- Auditoria linha-a-linha do caminho do dinheiro (05/07, ver `PLANO-MELHORIAS-AUDITORIA.md` seção A1-A8): A1 (stats>1000 linhas), A3 (venue guard), A4 (race trades_today), A6 (preço fresco no saque) **corrigidos** no commit `c2a668c`.
- Proxies Anthropic abertos corrigidos: PRs abertos em `z-pay-app#1` e `sa_lonas#1` (**aguardando merge do CEO**).

**Pendências críticas (ordem):**
1. **Merge** dos PRs de segurança z-pay-app#1 / sa_lonas#1.
2. **11/07:** recarga Anthropic → `TESTE-DINHEIRO-REAL.md` (5 fases, chaves SEM saque) + golden set + religar scans/torneio + M8 (A/B Sonnet 5).
3. **A2** do caminho do dinheiro (limit buy fantasma) — decidir se o teste usa `buy_limit` em background; design no plano.
4. **Gate jurídico** (2-3h advogado cripto-BR): framing royalty, autopilot=advice?, NFT utility, jurisdição — **trava QUALQUER marketing público**.
5. **M7:** `TIER_GATES_ENABLED=true` antes de divulgar (ZION hoje aberto a anônimos).
6. **Atualizar `zetta-official-docs`** para a tokenomics 2026 antes de reativar a comunidade.
7. §7 do NFT-BRIEFING (royalty %, critério "v3") — decisões do founder.
8. Grant Solana Foundation (US$50k convertível, pitch pronto, faltam métricas `{{}}` via Vercel Analytics+Mixpanel) + Colosseum: **Eternal a qualquer momento; global 28/set–2/nov/2026**.
9. Branch protection no GitHub (config manual) + prints mobile do admin (R3.4).

## 5. Roadmap estratégico acordado (tração + monetização)

> Decidido com o CEO em 05/07/2026. Detalhe das fases na conversa; resumo:

- **FASE 0 (agora→~15/07) — destravar:** pendências 1-7 acima. Nada de anúncio antes do gate jurídico + docs alinhados.
- **FASE 1 (imediato, paralelo) — caixa B2B:** ZION Vision go-live (WhatsApp real, domínio, demo com câmeras do cliente). Meta: 3 pilotos pagos em 90 dias (~R$2-3k MRR cobre o custo de IA do ecossistema). Venda direta local/WhatsApp; narrativa comercial SEPARADA de cripto ("Powered by Zetta World" discreto).
- **FASE 2 (~ago) — reativação + lançamento público Z-SWAP:** dois funis: (a) comunidade ZETTA existente = funil do NFT/token — mensagem "prometemos, entregamos: 1º produto no ar"; (b) público frio de traders BR = funil do produto (terminal grátis), marca ZETTA discreta. Build-in-public semanal com dados reais do flywheel (a arma de credibilidade). Micro-influencers BR de trading pagos em acesso/NFT, não cash. Whitelist do mint com **gate numérico** (não mintar sem X wallets na whitelist).
- **FASE 3 (set-nov) — captação:** Colosseum 28/09 como deadline de polimento; mint do Panteão quando a whitelist bater o gate; Hird mensal depois (trilho PIX/Mercado Pago).
- **FASE 4 — fair launch do token Z:** só com Z-SWAP tracionado + receita provada + docs públicos coerentes. Queima de 500M on-chain como evento de mídia.
- **FASE 5 — próximos produtos, 1 por vez, por facilidade regulatória:** Z-PAD (1º case: o token Z) → Obelisk → Z-PAY (Founding Clients; precisa parceiro) → Z-FINANCE (piloto fechado). **Jogo NFT** (personagens invocados pelos passes): utility drop PÓS-mint para engajamento de holders — não construir pré-receita.

## 6. Convenções que os agentes DEVEM seguir

- **swap-z-app:** ler `CLAUDE.md` + `docs/README.md` (índice vivos×históricos). Documentar antes de implementar (`docs/PLANO-*.md`). Flywheel honesto: NUNCA "melhorar" números sem entender os filtros (expectancy líquida, expired≠win/loss, MIN_SAMPLE=100, stop-first). Caminho de dinheiro FALHA FECHADO. Regra: **LLM propõe, código dispõe** (`price-guard.ts` é o juiz). Nenhuma mudança de prompt sem rodar o `GOLDEN-SET.md`. Segredos só em `process.env`.
- **Nomenclatura nórdica canônica:** Panteão (NFT: Freyr/Thor/Odin) · A Hird (mensal: Drengr/Berserkr/Einherjar) · Thrall (free).
- **i18n:** sempre 4 locales (en/pt-BR/es/zh) no swap-z-app; PT/EN/ZH nos institucionais Z-PAY.
- **Não tocar** em luxo-reborn, Go-store, sa_lonas, tal sem ordem explícita do CEO.
- Branch de trabalho da auditoria/sessões Claude: `claude/zettaword-project-audit-ggsgxx`.

## 7. Referências primárias

`PLANO-MESTRE.md` (roadmap A-E) · `NFT-BRIEFING.md` (monetização NFT) ·
`ARQUITETURA-IA.md` · `RUNBOOK.md` (60 env vars, playbooks) ·
`TESTE-DINHEIRO-REAL.md` · `PLANO-MELHORIAS-AUDITORIA.md` (M1-M8 + A1-A8) ·
`ANALISE-DADOS-01/02.md` (baseline flywheel + lição da inversão) ·
`PITCH-DECK.md` (grant $50k) · `IDEIAS-ESTACIONADAS.md` (backlog central).
