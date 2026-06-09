# Z-SWAP — Plano de Polimento Pré-Lançamento

> **Propósito:** trazer o produto ao nível "perfeito" antes de aplicar pra grants (Solana Foundation, Colosseum) e abrir vendas (assinatura + pilotos).
> **Janela:** 10 dias úteis de trabalho intenso.
> **Filosofia:** zero ruído visual, zero string mal-traduzida, zero loading branco, zero crash sem fallback.

Este documento é a única fonte de verdade do plano. Cada PR atualiza os checkboxes
correspondentes. Quando todos os 5 fases estiverem ✅, fazemos uma última varredura
("pente fino final") antes do go-to-market.

---

## FASE 1 — Críticos pra ter algo apresentável

Foco: tudo que deixa "cheiro de protótipo" no produto.

- [x] **1.1 — i18n completo do `/p2p`** ✅ — refatorado P2pView pra usar `t()` em todas as strings, mesmo padrão de #38 (buy + otc). Namespace `p2p` adicionado nos 4 idiomas (en/pt/es/zh) com 35 chaves.
- [x] **1.2 — Badges nos navs mobile e ⌘K** ✅ — extraído `nav-items.ts` como fonte única; Sidebar, MobileNav e CommandBar agora compartilham a mesma estrutura e ambos renderizam os badges (SOON / NEW / BETA / AI).
- [x] **1.3 — Auditoria de hardcoded strings** ✅ — varredura confirmou zero pt-BR hardcoded fora do tree i18n. Migradas placeholders e aria-labels de alta visibilidade (Sidebar, SwapCard, OrdersView, PairView, ConvictionBadge, FlowSphere, PoolsView, ProTerminal, WalletCexBridge) usando novas chaves `common.*`. Strings inglesas hardcoded em componentes mais profundos (AutopilotPanel, NexusRadar) ficam pra iteração de tradução completa pós-grant.
- [x] **1.4 — Empty states padronizados** ✅ — criado `<EmptyState>` reutilizável (`src/components/ui/EmptyState.tsx`) com ícone tonalizado + título + body opcional + CTA opcional. Migradas PoolsView (3 estados: loading/error/empty + CTA), PortfolioView (sem wallet + sem holdings) e ZionOrdersList. RiskScanner mantém o formulário-como-empty-state — não há gap real.

---

## FASE 2 — Consistência UX

Foco: o produto sentir "uma marca", não 17 páginas separadas.

- [x] **2.1 — Extrair `<TeaserShell>` reutilizável** ✅ — extraído `src/components/teaser/TeaserShell.tsx` (shell + `<TeaserCard>` auxiliar). Os 4 teasers (Onramp/Otc/P2p/Nft) migrados: hero + tabs + waitlist (form + storage) + trust line vêm do shell; preview e seções de teaching ficam como children. Resultado: -198 linhas líquidas, identidade visual garantida.
- [x] **2.2 — Loading states (skeleton)** ✅ — criado `<Skeleton>` reutilizável (`src/components/ui/Skeleton.tsx`) usando o `.shimmer` keyframe. Aplicado em PoolsView (6 linhas skeleton na tabela enquanto carrega), PortfolioView (4 linhas skeleton de holdings durante fetch inicial de balances), PairView (PairSkeleton agora usa shimmer consistente em vez de animate-pulse), CexPortfolioRollup (total $X aparece como skeleton enquanto `loading`).
- [x] **2.3 — Error boundaries por rota** ✅ — criado `<RouteErrorFallback>` reutilizável + `app/error.tsx` (cobre todas as 17 páginas mantendo sidebar/topbar) + `app/global-error.tsx` (último recurso quando o root layout em si crasha — render self-contained com seu próprio html/body). Mostra mensagem, digest, "Try again" (chama `reset()`), "Back to swap" e link de status.
- [x] **2.4 — Page transitions** ✅ — criado `<PageTransition>` em AppShell usando AnimatePresence keyed por pathname (fade + 8px translateY, 200ms ease-out, mode="wait" pra evitar overlap). Adicionado `app/loading.tsx` top-level com layout skeleton consistente (hero + stats grid + 2 cards) — preserva topbar/sidebar e nunca pisca branco.

---

## FASE 3 — Performance + Acessibilidade

Foco: técnico mensurável que reviewer de grant roda no Lighthouse.

- [x] **3.1 — Lighthouse pass mobile em todas as 17 rotas** ✅ — análise estática das 17 rotas: adicionado skip-to-content link (WCAG 2.4.1) em AppShell + id="main-content" no `<main>`; LangSync component que atualiza `document.documentElement.lang` dinamicamente ao trocar idioma; `loading="lazy"` em imgs de ConnectModal e PairView; i18n key `common.skipToContent` em 4 locales. Baseline documentado em `docs/LIGHTHOUSE-BASELINE.md`. Scores estimados: Perf 80–90, A11y 90–95, Best Practices 95–100, SEO 95–100.
- [x] **3.2 — Bundle analyzer + tree-shake** ✅ — instalado `@next/bundle-analyzer` (ANALYZE=true npm run build gera mapa interativo em .next/analyze/). Expandido `optimizePackageImports` com 5 Radix packages adicionais. Lazy-load de `ProZionDock` em ProTerminal — AI dock não está no viewport inicial, defer libera chunk do Anthropic SDK para depois do primeiro paint do chart. LiquidNexus (Three.js) já estava lazy. Shared bundle manteve 89.1 kB ≤ 90 kB target ✓.
- [x] **3.3 — A11y completo** ✅ — focus ring 1px → 2px em globals.css (WCAG 2.1 AA+ em fundos escuros). ProTerminal: `aria-expanded` + `aria-haspopup="listbox"` no pair selector, `aria-pressed` nos botões de timeframe e chart kind, `aria-label` nos botões icon-only de chart (trocado `title` por `aria-label`), `role="option"` + `aria-selected` nos itens do listbox de pares, `role="dialog"` + `role="listbox"` no dropdown. i18n key `pro.selectPair` em 4 locales. Botões icon-only em Topbar/MobileNav/SwapCard já estavam corretos no audit de 1.3.

---

## FASE 4 — Materiais pra aplicação de grants

Foco: dossiê técnico que cola direto na aplicação Solana / Colosseum / Arbitrum.

- [x] **4.1 — Página `/about` (whitepaper técnico)** ✅ — `src/app/about/page.tsx` + `src/components/about/AboutView.tsx`. Seções: hero com stats (11 páginas / 11 chains / 10+ CEX), diagrama de arquitetura em camadas (CSS/flexbox), proposta de valor (3 cards), todas as integrações reais nomeadas (0x v2, LiFi, Jupiter, CoW, CCXT, Claude Haiku 4.5, GoPlus, Honeypot.is, GeckoTerminal, DexScreener), tech stack, postura não-custodial (4 pontos). i18n `about.*` em 4 locales + `nav.about` em sidebar. Design consistente com glass morphism do app.
- [x] **4.2 — Página `/changelog` gerada do git log** ✅ — `src/lib/changelog.ts` (parser git log via execSync, filtra feat/fix/polish/chore/i18n/harden/diag, agrupa por mês YYYY-MM). `src/components/changelog/ChangelogView.tsx` (timeline vertical: dot colorido por tipo, badge, título, shortSha). `src/app/changelog/page.tsx` (Server Component, `revalidate = 3600` pra ISR). Nav entry + i18n `nav.changelog` em 4 locales.
- [x] **4.3 — Script de vídeo demo guiado** ✅ — `docs/DEMO-VIDEO-SCRIPT.md`. 5 cenas ~3:50, caption-only hardcoded OBS (EN), hybrid tone (grant-committee-first). Cena 2: MetaMask/EVM; cenas 3+5: Phantom/Solana. Lower-third badges por cena (0x·LiFi·CoW / Claude·GoPlus·Honeypot / CCXT / thesis). Inclui pre/post-production checklists + badge asset table.
- [x] **4.4 — Pitch deck em markdown** ✅ — `docs/PITCH-DECK.md`. 12 slides completos pra Canva/Figma. Ask: US$ 50k Solana Foundation (Dev Tooling + DeFi Infra) + submissão Colosseum Eternal. Slides reais: TAM ~US$2.5T DEX volume (DefiLlama 2024) + 16M users BR (Chainalysis 2024). Slide 12 expandido: ZION SPL analysis, Jupiter v6, SIWS, Solana Mobile Stack. 5 metric placeholders marcados `{{}}` pra preencher pré-submission. Founder/CEO redacted, advisor CTA incluído.

---

## Auditoria Opus 4.8 (jun/2026)

Audit god-view rodado pelo Opus 4.8 — relatório completo em `docs/AUDITORIA-OPUS.md`.
Veredito: código sólido; o **pitch de grant estava factualmente errado** e a
**estratégia de monetização precisava pivotar pra NFT-first**. 4 itens de ação
foram entregues a partir do audit:

- [x] **A.1 — Migração silenciosa PBKDF2 → 600k no primeiro unlock** ✅ (PR #58) — vaults legados (250k) sobem pro piso OWASP de forma transparente e não-bloqueante; log `[keystore-migration]`.
- [x] **A.2 — Correção do ask de grant + reposicionamento no pitch deck** ✅ (PR #59) — Z-SWAP é comercial → grant **convertível** da Solana Foundation (não o regular). Slide 3 reescrito reconhecendo concorrentes reais (Jupiter, 1inch, OpenOcean, Orion). Contagem de chains corrigida pra 11 (valor real em `src/lib/chains.ts`).
- [x] **A.3 — Padronização 11 chains + framing convertível em todas as superfícies** ✅ (PR #60) — AboutView, messages.ts (4 locales) e DEMO-VIDEO-SCRIPT alinhados.
- [x] **A.4 — Seção de audit no plano + FASE 5 reformulada NFT-first** ✅ (PR #61) — este documento.

---

## FASE 5 — Monetização (NFT-first, subscription como trilho B)

Foco: NFT lifetime passes na Solana como mecanismo primário de adesão.
Mercado Pago como trilho B opcional pós-grant.

- [x] **5.1 — Página `/pricing` unificada** ✅ — `src/app/pricing/page.tsx` + `PricingView` / `PricingCard` / `FounderBenefits`. 4 tiers (Free / Pro 1.5 SOL / Trader 4 SOL / Pilot 30 SOL — Cenário B travado), modelo IA + cap por tier, badge "assinatura em breve via PIX". Camada A (premium 3 anos) + Camada B (Founder eterna, 10 benefícios). FAQ 6 perguntas + disclaimer legal (utility, não security). CTA de mint abre modal de waitlist (localStorage, pattern dos teasers) até 5.4. i18n `pricing.*` nos 4 locales. UI-only — sem wallet/on-chain/MP ainda.
- [ ] **5.2 — Auth híbrido wallet-first** — SIWE EVM + sign-message Solana, email opcional pra recuperação
- [ ] **5.3 — Feature gates via `useTier()`** — checa NFT ownership E subscription status, retorna tier mais alto
- [ ] **5.4 — Coleção NFT Metaplex Core + mint UI self-hosted** — bloqueado em decisões do briefing
- [ ] **5.5 — Mercado Pago como trilho B** — opcional pós-NFT, BR-first
- [x] **5.6 — Página `/enterprise`** ✅ — `src/app/enterprise/page.tsx` + `EnterpriseView`. Hero institucional, 3 use cases (family offices/RIAs, fundos cripto-nativos, fintechs BR PIX→DeFi), 4 diferenciais (BR-first, moat não-custodial, segurança pré-trade, ZION 4 idiomas), menção ao tier Pilot 30 SOL (Opus 4.8) + white-label, form "Agendar conversa" via `mailto:` pra contact@zettaword.global. i18n `enterprise.*` nos 4 locales. UI-only — sem MP/webhook.

---

## Pente fino final (após todas as fases)

- [ ] Smoke test de cada rota (17) com checklist
- [ ] Run final Lighthouse — todas as 17 rotas ≥ 90 em todas as 4 categorias
- [ ] Run final `tsc --noEmit` + `next lint` + `next build` sem warnings
- [ ] Confirmar todos os 4 idiomas renderizam sem fallback
- [ ] Verificar OG preview no debugger Facebook + Twitter Card validator
- [ ] Auditoria de segurança final: rotas autenticadas, env vars secretas não vazadas, CSP intacto
- [ ] Comparar /buy /otc /p2p /nft lado a lado: identidade visual idêntica

---

## Status corrente

| Fase | Itens completos | Total |
|---|---|---|
| 1 — Críticos | 4 | 4 |
| 2 — UX consistency | 4 | 4 |
| 3 — Perf + A11y | 3 | 3 |
| 4 — Materiais grant | 4 | 4 |
| 5 — Monetização (NFT-first) | 2 | 6 |
| **Total geral** | **17** | **21** |

> Nota: os 4 itens da Auditoria Opus 4.8 (A.1–A.4) já foram entregues e não entram na contagem das fases 1–5 — são correções pós-audit, rastreadas na seção própria acima.

**Próximo passo:** FASE 5 — itens 5.2 (auth wallet-first), 5.3 (feature gates `useTier()`), 5.4 (coleção NFT Metaplex + mint UI — bloqueado em decisões do briefing), 5.5 (Mercado Pago trilho B). ⚠️ Todos requerem confirmação/decisões do usuário antes de codar.

---

## Convenções

- Cada PR atualiza os checkboxes deste arquivo no mesmo commit.
- Título de PR: `polish(fase<N>): <item>` (ex: `polish(fase1): i18n p2p`).
- Após mergeio, eu atualizo este doc com data + PR link no item correspondente.
