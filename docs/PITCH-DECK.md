# Z-SWAP — Pitch Deck
## Solana Foundation Convertible Grant · Colosseum Eternal Hackathon

> **Format:** Markdown source → Canva / Figma slides.
> **Audience:** Solana Foundation grant committee (primary), Colosseum jury (secondary).
> **Ask:** US$ 50,000 — Solana Foundation **convertible grant** (Z-SWAP is a commercial project, so the convertible program is the applicable track — not the standard developer grant).

---

> ⚠️ **Metrics to fill before submission** (capture via Vercel Analytics + Mixpanel in submission week):
> - `{{WALLETS_CONNECTED}}` — unique wallets ever connected (all-time)
> - `{{TOTAL_VOLUME_USD}}` — cumulative swap volume routed (USD)
> - `{{ACTIVE_USERS_30D}}` — distinct active users last 30 days
> - `{{ROUTES_EXECUTED}}` — total on-chain routes executed
> - `{{AVG_SESSION_DURATION}}` — avg session duration (minutes)

---

## Slide 1 — Cover

# Z-SWAP
### The Liquidity Nexus

*Multi-chain DEX aggregation · AI advisory · CEX bridging*
*Non-custodial · Open architecture*

**`swap-z.app`**

Solana / EVM · 11 chains · 10 real integrations

---

## Slide 2 — Problem

### DeFi is fragmented. Users pay the price.

- **Liquidity is siloed.** 11+ chains and 10+ CEX each require separate interfaces — no unified non-custodial view exists.
- **Route aggregators ignore CEX.** Uniswap, 1inch, and Jupiter don't show your Binance balance. CEX dashboards don't show your DeFi positions.
- **AI market intelligence is disconnected from execution.** Signals live in Telegram groups and Twitter threads — not inside the trade interface.
- **"Non-custodial" is often a marketing claim.** Most aggregators route through custodial bridges or require custody of CEX keys. The user bears the risk while the platform takes the fee.

> *Every fragmented interface is a missed trade, a slippage hit, or a rug the user didn't see coming.*

---

## Slide 3 — Solution

### What Z-SWAP is — and what it isn't.

We are not trying to out-aggregate Jupiter on Solana, out-route 1inch on EVM, or out-perp Hyperliquid. Those teams have years and billions of liquidity ahead of us in their lanes.

Where we *do* compete and win:

1. **BR-first DeFi tooling.** ~16M crypto users in Brazil are underserved by English-only aggregators. Z-SWAP ships PT-BR-native, with PIX-aware UX and a non-custodial posture aligned with the new BCB Resolutions 519/520/521 (in force Feb 2026).
2. **Pre-trade security layer integrated into routing.** Every route quote pulls GoPlus + Honeypot.is on the target token *before* execution. Aggregators optimize for slippage; we optimize for slippage + scam-survival.
3. **ZION advisory for retail, not for bots.** 1inch's MCP exposes swap to AI agents (programmatic). ZION explains the trade to the human, in their language (4 locales), with conviction scoring and risk reasoning. Different layer of the stack.
4. **CEX-DEX bridge for non-custodial flows.** CCXT-driven read-only key model — we never custody CEX funds. OpenOcean compares prices; Orion combines venues but is custodial-flavored. Z-SWAP keeps the entire stack custody-free.

Honest about the field. Specific about the wedge.

**Non-custodial is architectural, not a toggle.** No private key handling. No user fund custody. Read-only CEX keys. SIWE + Solana sign-message auth.

---

## Slide 4 — Demo

### 11 live pages. Real integrations. No mocks.

> 🎬 **Full demo video:** `[Loom link — add before submission]`

**Live today:**

| Page | Function |
|---|---|
| `/` | Swap — live 0x v2 / LiFi / Jupiter routing |
| `/pro` | Pro Terminal — pair analysis + ZION AI |
| `/bridge` | Cross-chain bridge aggregation |
| `/cex` | CEX portfolio + CCXT autopilot rebalance |
| `/orders` | Unified order history (on-chain + CEX) |
| `/explorer` | GoPlus token risk scanner |
| `/pools` | Liquidity pool browser |
| `/portfolio` | Multi-chain asset aggregator |
| `/zion` | Full ZION AI session interface |
| `/launchpad` | Z-PAD token launch (pre-launch) |
| `/governance` | ZETTA DAO governance (pre-launch) |
| `/buy` `/otc` `/p2p` `/nft` | Teasers with waitlists (localStorage) |

---

## Slide 5 — Architecture

### Layered, modular, auditable

```
┌──────────────────────────────────────────────────────┐
│                   UI Layer                            │
│   Next.js 14 App Router · TypeScript · Tailwind CSS  │
│   11 functional pages · 4 teaser pages · 4 locales   │
├──────────────────────────────────────────────────────┤
│                Aggregation Layer                       │
│   0x v2 · LiFi · Jupiter · CoW Protocol              │
│   Best-quote routing — not a single AMM               │
├──────────────────────────────────────────────────────┤
│               Intelligence Layer                       │
│   Anthropic Claude Sonnet 4.6 (streaming, tool use)   │
│   GoPlus Security · Honeypot.is contract audit        │
├──────────────────────────────────────────────────────┤
│                  Data Layer                            │
│   GeckoTerminal · DexScreener · CCXT (10+ CEX)       │
└──────────────────────────────────────────────────────┘
              ↓  Non-custodial throughout  ↓
     No custody · No private key handling · Read-only CEX
```

**Auth:** SIWE (EVM wallet) + Solana sign-message — wallet-native, no password, no email required.

---

## Slide 6 — Real Integrations

### Not planned. Not mocked. Live in production.

| Layer | Integration | Status |
|---|---|---|
| DEX routing | 0x v2 | ✅ Live |
| DEX routing | LiFi | ✅ Live |
| DEX routing | Jupiter | ✅ Live |
| DEX routing | CoW Protocol | ✅ Live |
| CEX bridge | CCXT — Binance, OKX, Bybit, Kraken, Coinbase, Huobi, KuCoin, Gate, Bitfinex, MEXC | ✅ Live |
| AI advisory | Anthropic Claude Sonnet 4.6 (streaming, tool use) | ✅ Live |
| Security | GoPlus Security API | ✅ Live |
| Security | Honeypot.is | ✅ Live |
| Price data | GeckoTerminal | ✅ Live |
| Price data | DexScreener | ✅ Live |

> *Every integration listed has a live API call in production. Reviewers can verify via the public demo.*

---

## Slide 7 — Traction

> ⚠️ Fill before submission — Vercel Analytics + Mixpanel, week of submission.

| Metric | Value |
|---|---|
| Wallets connected (all-time) | `{{WALLETS_CONNECTED}}` |
| Swap volume routed (USD) | `{{TOTAL_VOLUME_USD}}` |
| Active users (30d) | `{{ACTIVE_USERS_30D}}` |
| On-chain routes executed | `{{ROUTES_EXECUTED}}` |
| Avg session duration | `{{AVG_SESSION_DURATION}}` min |
| Functional pages live | 11 |
| Teaser pages w/ waitlists | 4 |
| Chains supported | 11 |
| CEX supported via CCXT | 10+ |
| Locales (i18n) | 4 (EN / PT-BR / ES / ZH) |

*[Add week-over-week growth chart here if data is available by submission week.]*

---

## Slide 8 — Market Opportunity

### DeFi aggregation is a category, not a feature.

**Total addressable market:**

| Metric | Value | Source |
|---|---|---|
| Total DEX volume (2024) | ~US$ 2.5 trillion | DefiLlama, 2024 annual |
| Multi-chain swap growth | 3–4× YoY | DefiLlama cross-chain volume, 2023→2024 |
| Brazil crypto users | ~16 million | Chainalysis Geography of Cryptocurrency, 2024 |
| CEX-to-DeFi bridge market | Nascent — no dominant non-custodial player | — |

**Z-SWAP's TAM = the aggregation fee layer on top of existing DEX + CEX volume.** We are not competing with liquidity — we are the routing and intelligence layer that connects it.

**Brazil as beachhead:** 16M crypto users, the 3rd-largest crypto market globally (Chainalysis 2024), severely underserved by PT-BR native tooling. Z-SWAP ships with full PT-BR i18n — zero translation debt at launch.

---

## Slide 9 — Tech Stack

### Production-grade. No vendor lock-in.

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| State management | Zustand, TanStack Query |
| Wallet auth | SIWE (EVM) + Solana sign-message — wallet-native |
| AI | Anthropic Claude Sonnet 4.6 (streaming, tool use) |
| Deployment | Vercel (edge runtime, ISR, serverless functions) |
| Analytics | Vercel Analytics + Mixpanel |
| i18n | Custom `useT()` hook, 4 locales (EN/PT/ES/ZH) |
| Bundle | 89 kB shared JS — optimized via `@next/bundle-analyzer` |

**No database required for MVP.** Non-custodial posture means no user fund custody, no compliance surface for assets. Serverless architecture scales without ops overhead.

---

## Slide 10 — Team

**Founder / CEO:** [redacted — pending public announce]

**Open to advisor intros:**
- Solana ecosystem: protocol, BD, grants committee connections
- CEX partnerships: regional LATAM, Asia
- Legal-BR: Brazilian crypto regulation, payment compliance

> *If you're a Solana Foundation grantee or Colosseum alum with a relevant network, we'd welcome an intro call.*

`contact@zettaword.global`

---

## Slide 11 — Ask

### Solana Foundation convertible grant

Z-SWAP is a commercial project, so we're applying for the Solana Foundation's convertible grant program — non-dilutive support up-front, converts to investment terms only if we raise a priced round. This aligns Z-SWAP's growth with the Foundation's long-term ecosystem return.

**Target size:** US$ 50,000 — sufficient to complete the Solana-native features in Slide 12 over a 6-month delivery window.

Returns from the convertible (if conversion triggers) flow back into the Solana grants pool — we're explicit about that and it's a feature, not a bug, of this funding model.

> Solana Foundation convertible grants & investments: https://solana.com/news/solana-foundation-convertible-grants-investments

### Colosseum Eternal Hackathon
Submitting to the next available cohort — prize pool competition, not a grant ask.

---

### Use of Capital — 6-month delivery plan

| Allocation | % | Amount | Purpose |
|---|---|---|---|
| Engineering | 60% | $30,000 | Feature gates (Pro/Trader tiers), auth system, Mercado Pago integration, Solana-native features |
| Go-to-market BR | 20% | $10,000 | PT-BR marketing, community, influencer partnerships, Superteam BR |
| Smart contract audit | 15% | $7,500 | On-chain escrow for P2P module — security pre-req for production P2P |
| Legal + compliance | 5% | $2,500 | Brazilian crypto regulation groundwork (PIX + Mercado Pago compliance) |

**Deliverables at 6 months:**
- [ ] Pro/Trader subscription tiers live (Mercado Pago payment gateway)
- [ ] SIWE + Solana SIWS auth system with session persistence
- [ ] Jupiter v6 advanced routing with smart order types
- [ ] SPL token ZION analysis pipeline (mint authority, holder distribution, rarity scoring)
- [ ] P2P escrow module (audited smart contract, Solana-native)
- [ ] Go-to-market launch in Brazil (Superteam BR partnership)

---

## Slide 12 — Why Solana

### Z-SWAP is multi-chain by design. Solana is the primary growth surface.

**Already live on Solana:**
- **Jupiter integration** — Solana's dominant DEX aggregator already in our routing stack. Best-quote routing for SPL tokens is live.
- **Phantom wallet** — Solana sign-message auth supported. Phantom sessions work today.
- **Solana Superteam BR** — Z-SWAP's PT-BR native interface aligns directly with Superteam Brazil's mission of onboarding the Brazilian market to Solana.

**With grant funding (Solana-native features):**
- **ZION AI SPL-token analysis** — rarity scoring, holder distribution, mint authority audit. Requires Solana-specific RPC tooling that grant funds will accelerate.
- **Jupiter v6 advanced routing** — smart order types (TWAP, limit, DCA) leveraging Jupiter's full API surface.
- **Solana wallet session (SIWS)** — Sign-In with Solana — replacing the current sign-message pattern with the CAIP-122 standard, enabling persistent non-custodial sessions.
- **Solana Mobile Stack** — Z-SWAP's non-custodial architecture maps cleanly onto Saga / Seeker dApp Store distribution. Mobile-native routing is a natural next step.

**Grant funds 6-month Solana delivery:**
> (a) Jupiter v6 advanced routing with smart order types
> (b) SPL token ZION analysis pipeline (RPC + Claude Sonnet 4.6)
> (c) Solana wallet session auth (SIWS — CAIP-122 standard)
