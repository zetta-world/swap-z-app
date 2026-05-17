# Z-SWAP — The Liquidity Nexus

Premium multi-chain liquidity intelligence platform within the **ZETTA ecosystem**.
Cinematic UI · ZION AI advisory · 11 chains · real on-chain risk analysis.

```
Sprint 1 ✓  Foundation + Liquid Nexus 3D + Swap Card + ZION drawer shell
Sprint 2 ✓  Real data: LiquidityPulse + Top Movers (GeckoTerminal + DexScreener)
            Real ZION AI streaming (Claude Haiku 4.5 + prompt caching)
            Risk Scanner with GoPlus + Honeypot.is + GeckoTerminal
```

## Tech Stack

- **Next.js 14 App Router** · TypeScript strict · Tailwind 3.4
- **Framer Motion** + **React Three Fiber** (custom GLSL plasma shaders)
- **wagmi v2-ready** · Zustand · TanStack Query · Radix · cmdk · sonner
- **`@anthropic-ai/sdk`** — Claude Haiku 4.5 streaming for ZION
- **Public APIs (no keys required):** GoPlus Security, Honeypot.is,
  GeckoTerminal, DexScreener

## Run locally

```bash
npm install
cp .env.example .env.local      # add your ANTHROPIC_API_KEY
npm run dev
# → http://localhost:3000
```

## Deploy to Vercel — step by step

> **Vercel only deploys from `main`.** This repo's `main` branch tracks the
> latest known-good build. Pushes to `main` auto-deploy.

### 1 — Connect the repo to Vercel

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import this GitHub repository.
3. Vercel auto-detects **Next.js** → no build/install command overrides needed.
4. Click **Deploy** (it will fail at runtime without the Claude key — that's
   fine, we add it next).

### 2 — Add the Anthropic API key

1. Open the project on Vercel → **Settings** → **Environment Variables**.
2. Add a new variable:
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** your Claude API key (the `sk-ant-api03-…` string you created
     at [platform.claude.com](https://platform.claude.com) → Settings →
     API Keys → *z-swap*)
   - **Environments:** check **Production**, **Preview**, **Development**
     (all three).
3. Click **Save**.

### 3 — Trigger a fresh deploy

After adding the env var, redeploy so the new build picks it up:

- Either push a commit to `main`, OR
- On Vercel: **Deployments** → click the latest deployment → **⋯** menu →
  **Redeploy** → **Use existing build cache** OFF → **Redeploy**.

### 4 — Verify ZION is live

1. Open your Vercel URL.
2. Click **ZION** in the topbar (or the gold chip inside the swap card).
3. The terminal should start streaming a real Claude Haiku 4.5 analysis
   of the selected pair (ETH → USDC by default).

If you see `[ZION offline: Missing ANTHROPIC_API_KEY ...]` → the env var
isn't set for the environment you're on (probably Preview vs Production).
Add it for all three environments and redeploy.

## Cost calibration (Claude Haiku 4.5)

Approximate per-analysis cost with prompt caching enabled:

| Component               | Tokens   | Cost                 |
|-------------------------|----------|----------------------|
| System prompt (cached)  | ~4 500   | $0.0045 write / $0.00045 read |
| Pair data (uncached)    | ~600     | $0.0006              |
| Output                  | ~400-600 | $0.0020-0.0030       |
| **First call** (cache miss) | —    | **~$0.007**          |
| **Subsequent calls** (cache hit, within 5 min) | — | **~$0.003** |

With $3.82 of credit and warm cache: **~1 200 analyses**.
Cold cache or follow-up questions: still ~500 analyses.

## Public APIs used (all free, no keys)

- **GoPlus Security** — `api.gopluslabs.io/api/v1/token_security/{chainId}`
- **Honeypot.is** — `api.honeypot.is/v2/IsHoneypot` (Ethereum, BSC, Base)
- **GeckoTerminal v2** — `api.geckoterminal.com/api/v2/networks/{net}/pools`
  and `/tokens/{addr}` — 30 req/min unauthenticated tier
- **DexScreener** — `api.dexscreener.com/latest/dex/search` and
  `/tokens/{addr}` — generous public tier

All four endpoints are proxied via Next.js Route Handlers (`/api/*`) with
per-endpoint `revalidate` caching so the same request to multiple users
hits the CDN, not the upstream API.

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── zion/route.ts         # Streaming Claude Haiku 4.5 advisory
│   │   ├── risk/route.ts         # GoPlus + Honeypot.is + scoring
│   │   ├── pools/route.ts        # GeckoTerminal top pools
│   │   └── trending/route.ts     # DexScreener trending pairs
│   ├── (pages)/                  # /, /bridge, /pro, /pools, /explorer, etc.
│   ├── layout.tsx                # Root layout + Providers
│   └── globals.css               # Design system, aurora, glass, grain
├── components/
│   ├── layout/                   # AppShell, Sidebar, Topbar, CommandBar
│   ├── dashboard/                # SwapDashboard, LiquidityPulse, etc.
│   ├── swap/                     # SwapCard, TokenSelector, RoutePreview
│   ├── zion/                     # ZionDrawer (Claude streaming)
│   ├── explorer/                 # RiskScanner
│   └── viz/                      # LiquidNexus (R3F + GLSL)
└── lib/
    ├── api/                      # goplus, honeypot, geckoterminal, dexscreener
    ├── zion/                     # System prompt for ZION
    ├── store/                    # Zustand (ui, swap)
    ├── chains.ts                 # 11-chain registry
    ├── tokens.ts                 # Default token universe
    └── format.ts                 # USD / amount / pct formatters
```

## License

Z-SWAP is part of the ZETTA ecosystem. This software is infrastructure;
it does not constitute financial advice or guarantee returns of any kind.
