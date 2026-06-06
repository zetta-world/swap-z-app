# Z-SWAP — Pitch Deck (Solana Foundation Grant + Colosseum Eternal)
> **Status: SKELETON ONLY — titles, placeholders, and section intent. Full copy pending approval.**
>
> **⚠️ Metrics to fill pre-submission:** capture via Vercel Analytics + Mixpanel in submission week.
>
> **Metric placeholders (fill before sending):**
> - `{{WALLETS_CONNECTED}}` — unique wallets ever connected (all-time)
> - `{{TOTAL_VOLUME_USD}}` — cumulative swap volume routed (USD)
> - `{{ACTIVE_USERS_30D}}` — distinct active users last 30 days
> - `{{ROUTES_EXECUTED}}` — total on-chain routes executed
> - `{{AVG_SESSION_DURATION}}` — avg session time (minutes)

---

## Slide 1 — Cover

**Z-SWAP — The Liquidity Nexus**

*Multi-chain DEX aggregation · AI advisory · CEX bridging*
*Non-custodial · Open architecture*

`swap-z.app` | Solana / EVM / multi-chain

---

## Slide 2 — Problem

**DeFi is fragmented. Users pay the price.**

- Liquidity lives across 13+ chains and 10+ CEX — no unified interface
- Route aggregators don't talk to CEX; CEX dashboards don't show DeFi positions
- AI market intelligence exists but is siloed from execution
- "Non-custodial" is a promise most aggregators break by routing through custodial bridges

*[placeholder: 1 data point on DEX fragmentation cost — slippage lost / missed routes — source TBD]*

---

## Slide 3 — Solution

**One interface. Every liquidity source. Your keys.**

Z-SWAP aggregates:
- **DEX routes:** 0x v2, LiFi, Jupiter, CoW Protocol (best-quote routing, not a single AMM)
- **CEX balances + autopilot:** CCXT (10+ exchanges), read-only key model — non-custodial
- **AI advisory:** Anthropic Claude Haiku 4.5 via ZION dock — conviction badge, risk score, pair analysis
- **Security layer:** GoPlus + Honeypot.is on every token before execution
- **Data layer:** GeckoTerminal + DexScreener price feeds

Non-custodial posture is architectural, not a toggle.

---

## Slide 4 — Demo

**11 live pages. Real integrations. No mocks.**

*[screenshot grid: swap card / ZION AI dock / CEX portfolio / changelog]*

> Full demo video: `[link to Loom — add before submission]`

- `/` Swap — live 0x/LiFi/Jupiter routing
- `/pro` Terminal — pair analysis + ZION AI
- `/cex` — CCXT CEX bridge, autopilot rebalance
- `/portfolio` — multi-chain aggregated view
- `/explorer` — GoPlus risk scanner
- 4 teaser pages with waitlists (/buy /otc /p2p /nft)

---

## Slide 5 — Architecture

**Layered, modular, auditable**

```
┌─────────────────────────────────────────────┐
│            UI Layer (Next.js 14)            │
│   11 routes · App Router · Server + Client  │
├─────────────────────────────────────────────┤
│           Aggregation Layer                  │
│   0x v2 · LiFi · Jupiter · CoW Protocol    │
├─────────────────────────────────────────────┤
│         Intelligence Layer                   │
│   Claude Haiku 4.5 · GoPlus · Honeypot.is  │
├─────────────────────────────────────────────┤
│           Data Layer                         │
│   GeckoTerminal · DexScreener · CCXT        │
└─────────────────────────────────────────────┘
         ↓ Non-custodial throughout ↓
```

No custody of funds. No private key handling. Read-only CEX keys. SIWE + Solana sign-message auth.

---

## Slide 6 — Integrations (Real, Not Planned)

| Layer | Integration | Status |
|---|---|---|
| DEX routing | 0x v2 | ✅ Live |
| DEX routing | LiFi | ✅ Live |
| DEX routing | Jupiter | ✅ Live |
| DEX routing | CoW Protocol | ✅ Live |
| CEX bridge | CCXT (Binance, OKX, Bybit, Kraken…) | ✅ Live |
| AI advisory | Anthropic Claude Haiku 4.5 | ✅ Live |
| Security | GoPlus Security API | ✅ Live |
| Security | Honeypot.is | ✅ Live |
| Data | GeckoTerminal | ✅ Live |
| Data | DexScreener | ✅ Live |

*[placeholder: add chain logos / integration badge grid for visual slide]*

---

## Slide 7 — Traction

> ⚠️ Fill these before submission week. Source: Vercel Analytics + Mixpanel.

| Metric | Value |
|---|---|
| Wallets connected (all-time) | `{{WALLETS_CONNECTED}}` |
| Swap volume routed (USD) | `{{TOTAL_VOLUME_USD}}` |
| Active users (30d) | `{{ACTIVE_USERS_30D}}` |
| On-chain routes executed | `{{ROUTES_EXECUTED}}` |
| Avg session duration | `{{AVG_SESSION_DURATION}}` min |
| Live pages | 11 functional + 4 teaser |
| Chains supported | 13 |

*[placeholder: add a simple growth chart if week-over-week data is available by submission]*

---

## Slide 8 — Market Opportunity

**DeFi aggregation is a category, not a feature.**

- Total DEX volume (2024): `[source: DefiLlama — fill TBD]`
- Multi-chain swaps growing `[%YoY — source: TBD]`
- CEX-to-DeFi bridge market: nascent, no dominant non-custodial player
- Brazil + LatAm: `{{LATAM_CRYPTO_USERS}}` crypto users, underserved by PT-BR tooling

*Z-SWAP's TAM = aggregation fee layer on top of existing DEX + CEX volume, not competing liquidity.*

---

## Slide 9 — Tech Stack

**Production-grade. No vendor lock-in.**

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| State | Zustand, TanStack Query |
| Auth | SIWE (EVM) + Solana sign-message (wallet-native) |
| AI | Anthropic Claude Haiku 4.5 (streaming, tool use) |
| Deployment | Vercel (edge, ISR, serverless functions) |
| Analytics | Vercel Analytics + Mixpanel |
| i18n | Custom hook (`useT()`), 4 locales (EN/PT/ES/ZH) |

*No database required for MVP. Non-custodial means no user fund custody, no compliance surface.*

---

## Slide 10 — Team

**Founder / CEO:** [redacted pending public announce]

**Open to advisor intros:**
- Solana ecosystem (protocol, BD, grants committee)
- CEX partnerships (regional LATAM, Asia)
- Legal-BR (crypto regulation, payment compliance)

*If you're a Solana Foundation grantee or Colosseum alum with relevant network, we'd love an intro call.*

`contact@zettaword.global`

---

## Slide 11 — Ask

**Solana Foundation Grant — Developer Tooling + DeFi Infra**
**Ask: US$ 50,000** (regular grant cycle, non-RFG)

**Colosseum Eternal Hackathon**
Submitting for next available cohort — prize pool, not a grant ask.

**Use of capital (6-month runway):**

| Allocation | % | Purpose |
|---|---|---|
| Engineering | 60% | Feature gates (Pro/Trader tiers), auth system, Mercado Pago integration |
| Go-to-market BR | 20% | PT-BR marketing, community, partnerships |
| Smart contract audit | 15% | On-chain escrow for P2P module (security pre-req) |
| Legal + compliance | 5% | Brazilian crypto regulation groundwork |

---

## Slide 12 — Why Solana

**Z-SWAP is already multi-chain, but Solana is the primary growth surface.**

- Jupiter integration live — Solana's dominant DEX already in our routing stack
- Solana's throughput + fee profile enables the autopilot CEX flow to be non-custodial on-chain
- Brazilian crypto community is strongly Solana-aligned (Solana Superteam BR)
- Colosseum hackathon ecosystem = fastest path to builder + partner network

*Grant funds completion of Solana-native features: Jupiter advanced routing, SPL token support in ZION analysis, Solana wallet session (sign-message auth).*
