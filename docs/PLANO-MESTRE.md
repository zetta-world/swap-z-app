# 🗺️ PLANO-MESTRE Z-SWAP — Roadmap de Lançamento

> **Topo da hierarquia.** Este doc amarra tudo; os sub-planos detalham cada peça.
> **Versão:** afiada (2026-06-30) — plano do founder + 7 ajustes de proteção/força.
> **Objetivo final:** lançar com **tração demonstrável honesta** → captar seed
> com conhecidos → grant Solana Foundation + acelerador Colosseum → launch público.

## Hierarquia de documentos

| Tema | Doc |
|------|-----|
| **Mestre (este)** | `PLANO-MESTRE.md` |
| Produto / polimento | `POLISH-PLAN.md`, `PLATFORM-PROGRESS.md` |
| NFT / monetização | `NFT-BRIEFING.md` |
| ZION (risco + aprendizado) | `PLANO-DE-ACAO-ZION.md` |
| Híbrido multi-modelo (custo) | `PLANO-HIBRIDO-MULTI-MODEL.md` (branch `feature/hybrid-ai-orchestrator`) |
| Materiais de captação | `PITCH-DECK.md`, `DEMO-VIDEO-SCRIPT.md` |
| Teste de dinheiro real | `TESTE-DINHEIRO-REAL.md` |
| Backlog | `IDEIAS-ESTACIONADAS.md` |

---

## ⚖️ Princípios que atravessam todas as fases (os 7 ajustes)

1. **Narrativa de tração HONESTA.** O flywheel mostra expectancy ~negativa hoje —
   **NÃO vender "a IA lucra"** (risco regulatório + credibilidade). Vender o que é
   verdade e forte: **produto multi-chain funcional + metodologia rigorosa de
   medição** (o flywheel que mede o próprio edge cientificamente). Isso É a tração.
2. **Definir o que o seed COMPRA** (ver Fase C) antes de captar.
3. **Gate jurídico** (advogado cripto-BR) **antes** de mint público e marketing
   com claims (autopilot=advice? custódia? NFT utility-não-security?). Ver `NFT-BRIEFING §4`.
4. **Marco 11/07** (teste de dinheiro real) é validação **antes** de captar.
5. **Moat no pitch:** unit economics sustentável (IA = centavos no híbrido) +
   dataset proprietário que melhora sozinho (flywheel) = defensibilidade.
6. **Pricing USD-pegged em SOL** (ver §Pricing) — sem risco de volatilidade.
7. **Dois tiros de capital:** grant Solana Foundation ($50k convertível) **+**
   acelerador Colosseum ($250k) — separados, perseguir os dois.

---

## 💱 Pricing — USD-pegged, liquidado em SOL

Fixa o **valor em USD** de cada tier; cobra o **equivalente em SOL na cotação**
(oráculo **Pyth** SOL/USD lido no mint). SOL sobe → menos SOL; SOL cai → mais SOL.
Receita em dólar **estável**, nunca astronômica nem deficitária.
**Marketing:** divulgar o preço em **USD** ("Founder Pass · $X"), mostrar o SOL ao vivo.

| Tier | Valor-alvo (USD)* | SOL hoje (~) | Supply |
|------|-------------------|--------------|--------|
| Pro / Freyr | a definir (~$270) | 1.5 SOL | 1.500 |
| Trader / Thor | a definir (~$720) | 4 SOL | 500 |
| Pilot / Odin | a definir (~$5.400) | 30 SOL | 50 |

\* Travar o **valor USD-alvo** (não a quantidade de SOL). A coluna SOL é só o
equivalente atual — vai flutuar com a cotação, e tudo bem.

---

## FASE A — Produto pronto ✅ (quase tudo feito)

- DEX agregadora multi-chain (Solana principal + 10 EVM).
- ZION advisory rodando (Sonnet 4.6) + telemetria de custo por modelo.
- Polimento FASE 1-4 (i18n, UX, perf/A11y, materiais de grant) — mergeado.
- Auth wallet-first (SIWE/SIWS) + tier gates **dormentes** — mergeado.
- Segurança auditada — 0 críticos reais; fixes mapeados.

---

## FASE B — Monetização NFT-first 🔄 (em execução = FASE 5)

- Coleção **Deuses Nórdicos**: 1.500 Pro · 500 Trader · 50 Pilot = **2.050 NFTs**.
- Estrutura **2 camadas:** Premium (3 anos/v3) + Founder (vitalícia). Ver `NFT-BRIEFING.md`.
- **Pricing USD-pegged** (acima) via oráculo Pyth no mint.
- **Planos lançamento (deuses) vs normais (guerreiros, +30%)** — ver `NFT-BRIEFING §9`.
- Mint na mainnet Solana (Metaplex Core); `/pricing` com as 3 artes.
- Tesouraria: Phantom + Squads multi-sig. Stack: Vercel + Supabase + Helius.
- **Custo de IA:** mira o **modelo híbrido** (centavos) — é o que torna as margens
  seguras (Pilot 93%) e o pitch sustentável. Ver `PLANO-HIBRIDO-MULTI-MODEL.md`.

---

## FASE C — Seed (~R$ 20k com conhecidos)

- **⚠️ DECIDIR O INSTRUMENTO primeiro:** pré-venda de NFT (recomendado — não dilui,
  é o próprio mecanismo de launch) vs equity/angel (mexe no cap table) vs empréstimo.
- **Pré-requisito = marco 11/07:** rodar o teste de dinheiro real (`TESTE-DINHEIRO-REAL.md`)
  pra ter **alguma** validação antes de captar.
- Mostra plataforma viva + NFTs (mint em devnet/preview pra demo).
- Capta ~R$20k → ~R$6k infra mínima + resto marketing com cautela.

---

## 🔒 GATE JURÍDICO (antes da Fase D pública e de qualquer claim de marketing)

- 2-3h com advogado cripto-BR: framing do royalty-share (rewards≠dividend),
  autopilot=advice?, custódia, NFT utility-não-security, jurisdição/geoblock.
- **Trava marketing público até fechar.** Seguro barato perto do risco existencial.

---

## FASE D — Grant + Hackathon Solana

- **Colosseum (datas reais):**
  - Próximo hackathon global: **28/set – 2/nov 2026** ← alvo.
  - **Eternal:** sprint de 4 semanas iniciável **a qualquer momento** → mesmo acelerador.
  - **Acelerador: US$ 250k** por startup aceita.
- **Grant Solana Foundation:** US$ 50k **convertível** (pitch deck pronto, materiais
  corrigidos: convertible, 11 chains, concorrentes reconhecidos).
- **Posicionamento:** NFT como **access pass / comunidade (utility)**, NÃO cash-grab;
  liderar com produto + metodologia de medição (moat), não com "IA lucra".
- Vídeo demo + /about whitepaper prontos.

---

## FASE E — Launch público

- **Pré-requisito: gate jurídico fechado.**
- Mint público (allowlist 48h → público), com pricing USD-pegged.
- **Mercado Pago (PIX)** como trilho B recorrente (pós-grant) — o motor de receita
  perpétuo + de maior margem (planos normais +30%). *(Recorrente em cripto tem
  fricção; PIX é o trilho recorrente ideal.)*
- Marketing BR-first.

---

## 🗓️ Cronograma-âncora (hoje = 30/jun/2026)

| Quando | Marco |
|--------|-------|
| **11/jul** | Teste de dinheiro real (~$50, sem permissão de saque) |
| jul–ago | Mint infra + `/pricing` + **gate jurídico** + construir tração + seed |
| set | Prep de launch público + allowlist |
| **28/set–2/nov** | Submissão Colosseum (ou Eternal antes) |
| pós-grant | Mercado Pago trilho B + escalar |

---

## Status atual (medido)

- Produto: ✅ pronto e no ar. Flywheel ZION: rodando autônomo, dado limpo,
  expectancy ~break-even (medindo honestamente).
- Monetização: 🔄 supply travado; pricing USD-pegged definido; falta codar 5.4.
- Decisões §7 do NFT pendentes: royalty %, critério de "v3".
- Próximo passo crítico: **teste 11/07** + recarregar créditos de IA.
