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
- [ ] **1.2 — Badges nos navs mobile e ⌘K** — MobileNav e CommandBar hoje não renderizam os badges (SOON / NEW / BETA / AI). Aplicar a mesma lógica do Sidebar.
- [ ] **1.3 — Auditoria de hardcoded strings** — varrer todos os componentes funcionais (não-teaser) pra garantir zero pt-BR fora do tree de i18n. Migrar achados.
- [ ] **1.4 — Empty states padronizados** — Pools sem resultados, ZION sem cards, Orders sem ordens, Portfolio sem wallet conectada, RiskScanner sem busca: cada um precisa de mensagem clara + ícone + ação de saída.

---

## FASE 2 — Consistência UX

Foco: o produto sentir "uma marca", não 17 páginas separadas.

- [ ] **2.1 — Extrair `<TeaserShell>` reutilizável** — OnrampView / OtcView / P2pView / NftView duplicam ~70% (hero + tabs + stats + waitlist + trust line). Extrair em um shell único parametrizado por slots. Garante identidade visual idêntica.
- [ ] **2.2 — Loading states (skeleton)** — Pools, pair detail, portfolio, /cex balance: substituir flash branco por skeleton shimmer consistente.
- [ ] **2.3 — Error boundaries por rota** — `error.tsx` por rota com fallback bonito + link de status + botão tentar de novo. Sem flash de tela em branco quando algo crasha.
- [ ] **2.4 — Page transitions** — Framer Motion route transitions discretas (fade + 8px translateY) — `loading.tsx` + animação consistente.

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
| 1 — Críticos | 1 | 4 |
| 2 — UX consistency | 0 | 4 |
| 3 — Perf + A11y | 0 | 3 |
| 4 — Materiais grant | 0 | 4 |
| 5 — Monetização | 0 | 5 |
| **Total geral** | **1** | **20** |

**Próximo passo:** FASE 1 / item 1.2 — badges nos navs mobile e ⌘K.

---

## Convenções

- Cada PR atualiza os checkboxes deste arquivo no mesmo commit.
- Título de PR: `polish(fase<N>): <item>` (ex: `polish(fase1): i18n p2p`).
- Após mergeio, eu atualizo este doc com data + PR link no item correspondente.
