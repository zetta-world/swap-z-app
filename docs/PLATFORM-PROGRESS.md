# Z-SWAP — Platform Progress Tracker

> Living document. Updated with every significant feature delivery.  
> Last updated: June 2026.

---

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Shipped to production |
| 🔄 | In progress |
| ⏳ | Planned — infrastructure ready |
| 🚧 | Blocked — external dependency |
| ❌ | Descoped |

---

## Engineering

### Foundation & Infrastructure

| Feature | Status | Notes |
|---|---|---|
| Next.js 14 App Router scaffold | ✅ | TypeScript strict, Tailwind 3.4 |
| Design system (aurora, glass, grain, tier accents) | ✅ | `globals.css` |
| 11-chain registry | ✅ | `lib/chains.ts` |
| Token universe | ✅ | `lib/tokens.ts` |
| Zustand stores (ui, swap, cex, tx) | ✅ | — |
| TanStack Query integration | ✅ | Dedupe, cache, stale-while-revalidate |
| Route handlers with ISR caching | ✅ | All `/api/*` endpoints |
| Error boundaries per route | ✅ | `app/error.tsx` + `global-error.tsx` |
| Page transitions (AnimatePresence) | ✅ | `<PageTransition>` in AppShell |
| Skeleton loading states | ✅ | `<Skeleton>` component |
| Empty states | ✅ | `<EmptyState>` component |
| i18n — 4 locales (EN/PT-BR/ES/ZH) | ✅ | Custom `useT()` hook |
| Bundle analyzer | ✅ | `ANALYZE=true npm run build` |
| Security headers (CSP, HSTS, X-Frame-Options) | ✅ | `next.config.js` |
| Accessibility (skip-to-content, lang sync, aria) | ✅ | WCAG 2.1 AA |
| PBKDF2 → 600k migration (OWASP hardening) | ✅ | Auto-migrates on first unlock |

### Wallet & Auth

| Feature | Status | Notes |
|---|---|---|
| wagmi v2 wallet connection (EVM) | ✅ | MetaMask, Coinbase, WalletConnect |
| Phantom / Solana wallet | ✅ | sign-message auth |
| SIWE (EVM) auth | ✅ | viem `verifyMessage`, nonce anti-replay |
| SIWS (Solana) auth | ✅ | tweetnacl ed25519 |
| JWT session (httpOnly cookie, 30d) | ✅ | `jose`, SameSite=Lax, Secure |
| Supabase auth schema | ✅ | `supabase/migrations/0001_auth.sql` |

### Swap & Routing

| Feature | Status | Notes |
|---|---|---|
| 0x v2 same-chain routing | ✅ | Proxy at `/api/quote` |
| LiFi cross-chain routing | ✅ | Proxy at `/api/quote` |
| Jupiter Solana routing | ✅ | — |
| CoW Protocol | ✅ | — |
| Quote comparison panel | ✅ | Side-by-side, best-quote badge |
| Permit2 ERC-20 approval flow | ✅ | Gasless sign typed data |
| Native ETH/BNB handling | ✅ | — |
| Wrong network detection + switch | ✅ | — |
| Price impact display | ✅ | — |
| Transaction summary | ✅ | — |

### Pro Terminal

| Feature | Status | Notes |
|---|---|---|
| TradingView Lightweight Charts v4 | ✅ | Candlestick, OHLC, Line, Area |
| Real OHLCV from GeckoTerminal | ✅ | 6 timeframes: 1m/5m/15m/1h/4h/1d |
| Live trades list | ✅ | Periodic polling |
| EMA 9/21/50/100/200 overlays | ✅ | — |
| VWAP overlay | ✅ | Intraday anchor |
| Bollinger Bands | ✅ | — |
| RSI 14 oscillator | ✅ | — |
| MACD (12/26/9) | ✅ | Histogram with bull/bear colors |
| Stochastic RSI (14/3/3) | ✅ | K and D lines |
| OBV (On-Balance Volume) | ✅ | — |
| Relative Volume | ✅ | vs. 20-period avg |
| RSI divergence detection | ✅ | Bullish/bearish divergence |
| Support & Resistance levels | ✅ | From OHLCV pivot analysis |
| Daily pivot levels | ✅ | R1/R2/S1/S2/PP |
| ATR(14) computation | ✅ | Wilder's smoothing |
| ATR-based ZION strategy levels | ✅ | Conservative / Moderate / Aggressive |
| Conviction Score | ✅ | % of indicators aligned with price |
| Market Regime badge | ✅ | TRENDING ↑/↓ · VOLATILE · RANGING |
| Multi-timeframe (MTF) strip | ✅ | EMA 21/50 across 6 TFs |
| Order panel (Market/Limit/Stop) | ✅ | Size, % buttons, est. total |
| OCO orders (TP + SL bracket) | ✅ | Live R/R ratio display |
| Pair selector with logos | ✅ | Token + chain logos |
| Pool stats panel | ✅ | TVL, volume, fees |
| Depth chart | ✅ | Order book depth visualization |
| ZION AI dock in Pro Terminal | ✅ | Lazy-loaded, tier-aware |

### ZION AI

| Feature | Status | Notes |
|---|---|---|
| Claude Sonnet 4.6 streaming | ✅ | Tool use + prompt caching |
| Rate limiting | ✅ | 8 req/min per IP |
| ZION Tier 1 — Core signals | ✅ | EMA, VWAP, RSI, MACD, volume |
| ZION Tier 2 — Market structure | ✅ | OBV, Funding Rate + OI, Confidence Score |
| ZION Tier 3 — Advanced | ✅ | Rel. Volume, RSI divergence, S/R, pivots |
| GoPlus security scoring in ZION | ✅ | Integrated in analysis prompt |
| Honeypot.is contract audit in ZION | ✅ | — |
| 5 action cards output | ✅ | buy_limit, sell_safe/medium/aggressive, stop_loss |
| Conviction badge (BULLISH/NEUTRAL/BEARISH) | ✅ | — |
| Follow-up questions | ✅ | Context-aware multi-turn |
| 4-locale output | ✅ | Language passed from user session |
| Tier gating (402 for free tier) | ⏳ | `TIER_GATES_ENABLED=false` — infrastructure live |

### CEX & Autopilot

| Feature | Status | Notes |
|---|---|---|
| CCXT integration (10+ exchanges) | ✅ | Read-only API key vault |
| CEX portfolio rollup | ✅ | Multi-exchange, USD aggregate |
| CEX order placement | ✅ | Via autopilot |
| Autopilot rebalance (one-time) | ✅ | — |
| Autopilot background execution | ✅ | Supabase + GitHub Actions cron |
| Position-aware autopilot re-scan | ✅ | Arms profitable exits after disconnect |
| Dynamic balance sizing | ✅ | Per tier and risk profile |
| Unified order history (CEX + on-chain) | ✅ | `/orders` page |
| CEX pair selector with logos | ✅ | All exchange markets |

### Security Scanner

| Feature | Status | Notes |
|---|---|---|
| GoPlus token security API | ✅ | `/api/risk` proxy |
| Honeypot.is contract audit | ✅ | EVM chains |
| Risk score (0–10) + label | ✅ | — |
| Pre-trade token screening | ✅ | Embedded in swap flow |

### Tier & Monetization

| Feature | Status | Notes |
|---|---|---|
| Tier definitions (Free/Pro/Trader/Pilot) | ✅ | `lib/tier/gods.ts` |
| `useTier()` hook | ✅ | Helius `getAssetsByOwner` + TTL cache |
| `<TierGate>` wrapper | ✅ | `required` prop for hard gates |
| `TierAccentProvider` (per-tier color) | ✅ | Gold / Violet / Prismatic |
| `BrandMark` tier emblems | ✅ | Freyr (Pro) · Thor (Trader) |
| Pricing page | ✅ | NFT-first: 1.5 / 4 / 30 SOL |
| Enterprise page | ✅ | `contact@zettaword.global` |
| NFT mint UI (Metaplex Core) | 🚧 | Pending collection decisions |
| Mercado Pago subscription (BR) | 🚧 | Planned after NFT mint |
| `TIER_GATES_ENABLED` toggle | ⏳ | Infrastructure live, gate dormant |

### Phase 3 — Advanced Trading

Items shipped with current infrastructure (candle data + existing trade feed):

| Feature | Status | Notes |
|---|---|---|
| Volume Profile (candle-based) | ✅ | POC + Value Area (70%) from OHLCV; `ProVolumeProfile.tsx`. Approximation — candle distribution, not tick-level |
| ProOrderPanel + Trailing Stop | ✅ | Market/Limit/Stop/OCO/Trailing types; trailing: %-based with computed stop level; `ProOrderPanel.tsx` |
| Smart Money feed | ✅ | Whale bias (buy/sell volume split), largest trade, verdict (ACCUMULATING/DISTRIBUTING/NEUTRAL); `ProSmartMoney.tsx` |
| MEV Exposure badge | ✅ | Proxy signal: price variance (CV) + whale concentration from trade feed; LOW/MEDIUM/HIGH; rendered in `ProSmartMoney` |

Items **blocked** — require external infrastructure not yet wired:

| Feature | What's missing | Effort estimate |
|---|---|---|
| MEV actual protection | Protected RPC endpoint (Flashbots Protect or bloXroute) — needs `PROTECTED_RPC_URL` env var per chain | ~1 day wiring + Flashbots account |
| Trailing Stop execution | Server-side order engine: watches price via polling/ws, fires on-chain tx when stop triggers | ~2–3 days (new Supabase table + background job) |
| Paper Trading | Persistent order book per user: `paper_trades` + `paper_positions` Supabase tables, P&L calculation, UI | ~3–4 days |
| Volume Profile (tick accuracy) | GeckoTerminal only provides candle OHLCV; need tick/trade-level data feed or paid Amberdata/Kaiko API | External paid API |
| Smart Money wallet clustering | Deep wallet analysis (whale address tagging, fund flows) needs on-chain indexer | The Graph subgraph or Dune query |

---

## Product

### Pages shipped

| Page | Status |
|---|---|
| `/` — Swap | ✅ |
| `/pro` — Pro Terminal | ✅ |
| `/bridge` — Cross-chain bridge | ✅ |
| `/cex` — CEX portfolio + autopilot | ✅ |
| `/orders` — Unified order history | ✅ |
| `/explorer` — Risk scanner | ✅ |
| `/pools` — Pool browser | ✅ |
| `/portfolio` — Multi-chain portfolio | ✅ |
| `/pair/[chain]/[addr]` — Pair deep-dive | ✅ |
| `/zion` — Full ZION session | ✅ |
| `/pricing` — Tier comparison | ✅ |
| `/about` — Architecture whitepaper | ✅ |
| `/changelog` — Git changelog (ISR) | ✅ |
| `/enterprise` — Enterprise contact | ✅ |
| `/settings` — User settings | ✅ |
| `/launchpad` — Z-PAD (teaser) | ✅ |
| `/governance` — DAO (teaser) | ✅ |
| `/buy` `/otc` `/p2p` `/nft` | ✅ teasers w/ waitlists |

### UX polish completed

| Item | Status |
|---|---|
| i18n complete across all 19 pages | ✅ |
| Mobile nav + sidebar badges (SOON/NEW/BETA/AI) | ✅ |
| Hardcoded string audit — zero PT-BR outside i18n tree | ✅ |
| Page transitions (AnimatePresence) | ✅ |
| Skeleton loaders across all data-heavy views | ✅ |
| Empty states with CTA across all views | ✅ |
| Error boundaries on every route | ✅ |
| Mobile overflow audit across all 19 routes | ✅ |

---

## Business

### Grant applications

| Target | Status | Notes |
|---|---|---|
| Solana Foundation convertible grant — US$ 50k | 🔄 | Pitch deck ready (`docs/PITCH-DECK.md`). Metrics `{{}}` to fill pre-submission. |
| Colosseum Eternal Hackathon | 🔄 | Eternal cohort — submit when ready |

### Go-to-market

| Milestone | Status | Notes |
|---|---|---|
| Landing page live at swap-z.app | ✅ | Vercel production |
| PT-BR native interface | ✅ | Zero translation debt |
| Demo video (5 scenes, ~3:50) | ⏳ | Script ready (`docs/DEMO-VIDEO-SCRIPT.md`). Needs recording. |
| NFT collection launch (Metaplex Core) | 🚧 | Pending briefing decisions |
| Paid tier activation (`TIER_GATES_ENABLED=true`) | ⏳ | Flips when NFT mint ships |
| Mercado Pago PIX subscriptions | 🚧 | Planned after NFT mint |
| Superteam Brazil partnership | ⏳ | Planned post-grant |
| Smart contract audit (P2P escrow) | 🚧 | Budget: ~US$ 7,500 from grant |

### Legal & compliance

| Item | Status | Notes |
|---|---|---|
| Non-custodial architecture confirmed | ✅ | No private key handling anywhere |
| BCB Resolutions 519/520/521 posture | ✅ | Non-custodial design aligns with Feb 2026 rules |
| Brazilian crypto regulation groundwork | 🔄 | Planned: ~US$ 2,500 from grant |

---

## Metrics to fill before grant submission

> Source: Vercel Analytics + Mixpanel (capture week of submission)

| Metric | Value |
|---|---|
| Wallets connected (all-time) | `{{WALLETS_CONNECTED}}` |
| Swap volume routed (USD) | `{{TOTAL_VOLUME_USD}}` |
| Active users (30d) | `{{ACTIVE_USERS_30D}}` |
| On-chain routes executed | `{{ROUTES_EXECUTED}}` |
| Avg session duration (min) | `{{AVG_SESSION_DURATION}}` |

---

## Technical debt & known issues

| Item | Priority | Notes |
|---|---|---|
| Pente fino final — smoke test all 19 routes | High | Pre-launch checklist in `POLISH-PLAN.md` |
| Full Lighthouse sweep on Vercel preview URLs | High | 17 routes, mobile viewport, 4G throttle |
| `tsc --noEmit` + `next lint` clean pass | High | Run before each deploy |
| OG preview validation | Medium | Facebook debugger + Twitter Card validator |
| Trailing stop (Phase 3) | Low | Needs server-side order engine |
| Volume Profile (Phase 3) | Low | Needs tick-level data feed |
