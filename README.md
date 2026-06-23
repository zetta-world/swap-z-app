# Z-SWAP

> Multi-chain liquidity intelligence. CEX-to-DEX bridging. AI-native trading terminal. Non-custodial throughout.

**[swap-z.app](https://swap-z.app)** — part of the [ZETTA ecosystem](https://zettaword.global).

---

## What this is

Z-SWAP is a production-grade DeFi aggregation platform. It routes swaps across 11 chains and 10+ CEX via read-only keys, layers ZION AI (Claude Sonnet 4.6) over every trade decision, and surfaces pre-trade security scoring before any token touches a wallet.

The Pro Terminal is TradingView-class: real candle data from GeckoTerminal, a full in-browser TA engine (EMA/VWAP/MACD/Stoch RSI/Bollinger Bands), ATR-based strategy levels, multi-timeframe alignment, OCO orders, and a live conviction score derived from indicator alignment.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router · TypeScript strict · Tailwind CSS |
| State | Zustand · TanStack Query · Radix UI · Framer Motion |
| Charts | TradingView Lightweight Charts v4 |
| 3D | React Three Fiber · custom GLSL plasma shaders |
| Wallet auth | wagmi v2 (EVM) · SIWE · Solana sign-message |
| AI | Anthropic Claude Sonnet 4.6 (streaming, tool use, prompt caching) |
| CEX | CCXT — 10+ exchanges, read-only API keys |
| Deployment | Vercel edge runtime · ISR · serverless Route Handlers |
| i18n | Custom `useT()` hook — EN / PT-BR / ES / ZH |
| Bundle | 89 kB shared JS |

**DEX aggregators:** 0x v2 · LiFi · Jupiter · CoW Protocol  
**Free APIs:** GeckoTerminal · DexScreener · GoPlus Security · Honeypot.is

---

## Pages

| Route | Description |
|---|---|
| `/` | Swap — best-quote routing across 0x v2, LiFi, Jupiter, CoW |
| `/pro` | Pro Terminal — full TA chart · ZION AI · order panel |
| `/bridge` | Cross-chain bridge aggregation |
| `/cex` | CEX portfolio + CCXT autopilot rebalance |
| `/orders` | Unified order history (on-chain + CEX) |
| `/explorer` | GoPlus + Honeypot.is token risk scanner |
| `/pools` | Liquidity pool browser |
| `/portfolio` | Multi-chain asset aggregator |
| `/pair/[chain]/[addr]` | Pair deep-dive with live trades + risk score |
| `/zion` | Full ZION AI session interface |
| `/pricing` | Tier comparison — Free / Pro / Trader / Pilot |
| `/about` | Architecture whitepaper |
| `/changelog` | ISR-rendered git changelog |
| `/enterprise` | Enterprise + white-label contact |
| `/launchpad` | Z-PAD token launch (pre-launch) |
| `/governance` | ZETTA DAO (pre-launch) |
| `/buy` `/otc` `/p2p` `/nft` | Teaser pages with waitlists |

---

## Pro Terminal

The flagship feature. A full TA suite computed in-browser from raw OHLCV data:

**Chart overlays:** EMA 9/21/50/100/200 · VWAP · Bollinger Bands  
**Oscillators:** RSI 14 · MACD (12/26/9) · Stochastic RSI (14/3/3)  
**Advanced indicators:** OBV · Relative Volume · RSI Divergence · Support/Resistance · Daily Pivots  
**ZION levels:** ATR(14)-based entry / target / stop for Conservative · Moderate · Aggressive  
**Conviction Score:** percentage of active indicators aligned with price direction  
**Market Regime:** TRENDING ↑/↓ · VOLATILE ⚡ · RANGING ↔ — derived from ATR and EMA spread  
**MTF strip:** EMA 21/50 alignment across 6 timeframes (1m → 1d) with a bull/bear verdict  
**Order panel:** Market · Limit · Stop · OCO with TP + SL brackets and live R/R ratio  
**Chart types:** Candlestick · OHLC Bar · Line · Area  
**Timeframes:** 1m · 5m · 15m · 1h · 4h · 1d

---

## ZION AI

Every analysis is a streaming Claude Sonnet 4.6 session with prompt caching. ZION has three intelligence tiers:

**Tier 1 — Core signals:** EMA alignment, VWAP position, RSI, MACD, volume analysis  
**Tier 2 — Market structure:** OBV trend, Funding Rate + OI (when available), Confidence Score  
**Tier 3 — Advanced:** Relative Volume, RSI divergence, Support/Resistance, daily pivots  

Output: conviction badge (BULLISH/NEUTRAL/BEARISH), GoPlus risk score, Honeypot.is audit, streaming analysis, 5 action cards (buy limit, sell safe/medium/aggressive, stop loss).

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       UI Layer                            │
│   Next.js 14 App Router · TypeScript · Tailwind CSS      │
│   19 pages · 4 locales · tier-gated features             │
├──────────────────────────────────────────────────────────┤
│                   Aggregation Layer                       │
│   0x v2 · LiFi · Jupiter · CoW · CCXT (10+ CEX)         │
│   Best-quote routing — never single-AMM                  │
├──────────────────────────────────────────────────────────┤
│                  Intelligence Layer                       │
│   Anthropic Claude Sonnet 4.6 (streaming, tool use)      │
│   GoPlus Security · Honeypot.is · in-browser TA engine   │
├──────────────────────────────────────────────────────────┤
│                     Data Layer                            │
│   GeckoTerminal · DexScreener · Helius (Solana)          │
│   All proxied via Next.js Route Handlers with ISR        │
└──────────────────────────────────────────────────────────┘
                   Non-custodial throughout
          No custody · No private key handling · Read-only CEX
```

**Auth:** SIWE (EVM, viem `verifyMessage`) + SIWS (Solana, ed25519). JWT in httpOnly cookie, 30-day sessions, single-use nonces, anti-replay.

**Tier gating:** `useTier()` → Helius `getAssetsByOwner` on Solana mainnet. NFT-first: Pro (1.5 SOL) / Trader (4 SOL) / Pilot (30 SOL). `TIER_GATES_ENABLED` flag keeps the gate dormant until NFT mint ships.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY required for ZION
npm run dev                  # → http://localhost:3000
```

See `.env.example` for optional keys: `ZEROX_API_KEY`, `HELIUS_API_KEY`, `NEXT_PUBLIC_MIXPANEL_TOKEN`, `SUPABASE_*`, `CCXT_*`.

---

## Project structure

```
src/
├── app/
│   ├── api/                    # Route handlers — zion, risk, pools, ohlcv, auth, …
│   ├── (pages)/                # 19 routes
│   ├── layout.tsx              # Root layout + providers
│   └── globals.css             # Design system — aurora, glass, grain, tier accents
├── components/
│   ├── layout/                 # AppShell, Sidebar, Topbar, BrandMark
│   ├── pro/                    # ProTerminal, ProChart, ProOrderPanel, ProMTF, ProZionDock
│   ├── swap/                   # SwapCard, TokenSelector, RoutePreview, QuoteComparison
│   ├── zion/                   # ZionDrawer (Claude streaming)
│   ├── tier/                   # TierGate, TierAccentProvider, useTier
│   ├── dashboard/              # LiquidityPulse, TopMovers, MarketCard
│   └── viz/                    # LiquidNexus (R3F + GLSL)
└── lib/
    ├── zion/                   # ZION system prompts + streaming logic
    ├── tier/                   # Tier definitions + Helius NFT gating
    ├── store/                  # Zustand slices — ui, swap, cex, tx
    ├── i18n/                   # Translation files — EN/PT/ES/ZH
    ├── chains.ts               # 11-chain registry
    └── tokens.ts               # Default token universe
```

---

## Docs

| File | Contents |
|---|---|
| [`docs/PLATFORM-PROGRESS.md`](docs/PLATFORM-PROGRESS.md) | Living tracker — all features shipped, in-progress, blocked |
| [`docs/POLISH-PLAN.md`](docs/POLISH-PLAN.md) | Pre-launch polish sprint — 21 items, 19 complete |
| [`docs/PITCH-DECK.md`](docs/PITCH-DECK.md) | Solana Foundation grant pitch — 12 slides |
| [`docs/DEMO-VIDEO-SCRIPT.md`](docs/DEMO-VIDEO-SCRIPT.md) | 5-scene demo script for grant submission |
| [`docs/MANUAL_TEST_PLAN.md`](docs/MANUAL_TEST_PLAN.md) | Manual QA checklist — 10 test suites |
| [`docs/LIGHTHOUSE-BASELINE.md`](docs/LIGHTHOUSE-BASELINE.md) | Lighthouse estimates across 17 routes |

---

## License

Z-SWAP is commercial software, part of the ZETTA ecosystem.  
This platform does not constitute financial advice and does not guarantee returns of any kind.  
`contact@zettaword.global`
