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

- [ ] **3.1 — Lighthouse pass mobile em todas as 17 rotas** — atacar tudo abaixo de 90 em Perf / A11y / Best Practices / SEO. Documentar deltas.
- [ ] **3.2 — Bundle analyzer + tree-shake** — identificar dead weight em `lucide-react`, `framer-motion`, `@radix-ui`. Lazy-load Pro Terminal (mais pesado: 63 kB). Objetivo: First Load < 90 kB shared.
- [ ] **3.3 — A11y completo** — todos os botões-ícone com `aria-label`, focus visible em todos os interativos, contraste mín 4.5:1, navegação por teclado funcional pelo app inteiro.

---

## FASE 4 — Materiais pra aplicação de grants

Foco: dossiê técnico que cola direto na aplicação Solana / Colosseum / Arbitrum.

- [ ] **4.1 — Página `/about` (whitepaper técnico)** — architecture diagram, value prop, tech stack, integrações reais nomeadas (0x, LiFi, Jupiter, CCXT, Anthropic, GoPlus, Honeypot, GeckoTerminal, DexScreener, CoW). Tudo na cara.
- [ ] **4.2 — Página `/changelog` gerada do git log** — histórico PR #1 → #N com resumo, mostra maturidade.
- [ ] **4.3 — Script de vídeo demo guiado** — 5 cenas em ~4 min: (1) hero, (2) swap real, (3) ZION analisando pair, (4) autopilot CEX firing, (5) portfolio multi-chain. Tu grava com Loom/OBS.
- [ ] **4.4 — Pitch deck em markdown** — 10-12 slides com texto pronto pra Canva/Figma. Estrutura: problema → solução → demo → tração → arquitetura → equipe → ask.

---

## FASE 5 — Monetização (assinatura + pilotos)

Foco: caminhos reais de receita. Não precisa estar 100% funcional pro grant, mas precisa estar visível.

- [ ] **5.1 — Página `/pricing`** — 4 tiers (Free / Pro R$89 / Trader R$249 / Pilot R$5-50k). Comparação feature-by-feature, CTA por tier.
- [ ] **5.2 — Auth system híbrido** — wallet sign-in + email opcional (pra recuperação + receber update). Persistência via JWT + Vercel KV ou Supabase free tier.
- [ ] **5.3 — Feature gates** — implementar gate de assinatura no autopilot CEX (Pro+), Pro Terminal (Pro+), cross-CEX arb feed (Trader+). Free tem rate-limit no ZION (5/dia).
- [ ] **5.4 — Gateway pagamento — Stripe + Mercado Pago + Coinbase Commerce** — escolher 1 pra MVP (sugestão: **Mercado Pago** porque BR-first). Implementar webhook → atualizar tier do usuário.
- [ ] **5.5 — Landing pilot/white-label** — página `/enterprise` ou `/pilots` com case técnico, exemplos de uso, formulário de contato. CTA: "agendar conversa".

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
| 3 — Perf + A11y | 0 | 3 |
| 4 — Materiais grant | 0 | 4 |
| 5 — Monetização | 0 | 5 |
| **Total geral** | **8** | **20** |

**Próximo passo:** FASE 3 / item 3.1 — Lighthouse pass mobile em todas as rotas.

---

## Convenções

- Cada PR atualiza os checkboxes deste arquivo no mesmo commit.
- Título de PR: `polish(fase<N>): <item>` (ex: `polish(fase1): i18n p2p`).
- Após mergeio, eu atualizo este doc com data + PR link no item correspondente.
