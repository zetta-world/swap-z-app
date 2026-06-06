# Z-SWAP — Demo Video Script

> **Format:** Screen recording (OBS). No voiceover — hardcoded captions only (EN).
> **Resolution:** 1920×1080, 30 fps. Zoom browser to 110% for readability.
> **Length:** ~3:50 (5 scenes).
> **Audience:** Solana Foundation grant committee (primary) + Twitter/X (secondary).
> **Tone:** Hybrid — technical substance first, product demo pacing.

---

## Pre-recording checklist

- [ ] Browser: Chrome, dark system theme, no extensions visible in toolbar
- [ ] Wallets installed: MetaMask (EVM) + Phantom (Solana) — both funded with small amounts
- [ ] App running at production URL (`swap-z.app`) — not localhost
- [ ] OBS scene: display capture, no mouse highlight, caption overlay ready
- [ ] Test one full run-through before recording the real take
- [ ] Silence notifications (macOS: Focus mode / Win: Do Not Disturb)

---

## Scene 1 — Establishing shot (~0:10)

**What to do on screen:**
1. Start with the landing page open — hero visible, swap card centered, topbar showing.
2. Hold for 3 seconds.
3. Navigate to `/about` — scroll slowly to the architecture layer diagram.
4. Hold the diagram for 3 seconds.
5. Hard cut — scene ends.

**Captions (display at bottom, white text, dark semi-transparent bar):**

```
[0:00 – 0:04]  Z-SWAP — 11 live pages. 11 chains. Real integrations.
[0:04 – 0:10]  No mocks. No demo wallet. Production.
```

**Purpose:** Grant-committee reviewer sees technical substance in the first 10 s. The `/about`
architecture diagram proves this is not a landing-page prototype.

---

## Scene 2 — Live swap: route aggregation (~1:00)

**Wallet:** MetaMask (EVM — Arbitrum network)

**What to do on screen:**
1. Navigate to `/` (swap card).
2. Select **ETH → USDC**, network **Arbitrum**.
3. Enter amount: **0.01 ETH**. Pause 2 seconds on the quote panel — route split must be visible
   (0x v2 label or LiFi label in the route display).
4. Hover over the route info tooltip if it shows providers.
5. Click **Swap** — MetaMask modal appears.
6. Show the non-custodial language in the modal ("Your keys, your funds" or similar) — pause 2 s.
7. Confirm in MetaMask.
8. Show transaction pending → confirmed state in the UI.

**Captions:**

```
[0:10 – 0:18]  Live swap — ETH → USDC on Arbitrum.
[0:18 – 0:28]  Best route selected across 0x v2, LiFi, and CoW Protocol.
[0:28 – 0:38]  MetaMask — your keys, your funds. Non-custodial.
[0:38 – 0:48]  Transaction submitted on-chain.
[0:48 – 1:10]  Confirmed. Funds delivered to your wallet.
               Lower-third badge: "0x v2 · LiFi · CoW Protocol"
```

**Purpose:** Proves real on-chain execution. The route aggregation panel distinguishes Z-SWAP
from single-AMM interfaces.

---

## Scene 3 — ZION AI pair analysis (~1:00)

**Wallet:** Phantom (Solana)

**What to do on screen:**
1. Navigate to `/pro` terminal.
2. Open the pair selector — search for a mid-cap Solana token (e.g., JUP, BONK, or WIF).
3. Select the pair — chart loads.
4. Open the ZION dock (AI panel) — click the ZION button or expand the dock.
5. Pause on the **conviction badge** animating in (BULLISH / NEUTRAL / BEARISH). Hold 3 s.
6. Scroll down to show:
   - **GoPlus risk score** (the number + label, e.g., "Risk: 2 / 10 — Low").
   - **Honeypot.is flag** (green = clean).
   - **AI reasoning text** streaming (Claude Sonnet 4.6 output visible).
7. Pan back to show GeckoTerminal chart in the same view.

**Captions:**

```
[1:10 – 1:18]  ZION AI — analyzing a Solana mid-cap in real time.
[1:18 – 1:28]  Conviction badge: [BULLISH / NEUTRAL / BEARISH].
               Powered by Anthropic Claude Sonnet 4.6.
[1:28 – 1:40]  GoPlus security scan — risk score live.
               Honeypot.is contract audit — clean.
[1:40 – 1:55]  AI reasoning streaming. Not a score — an analysis.
               Lower-third badge: "Claude Sonnet 4.6 · GoPlus · Honeypot.is · GeckoTerminal"
[1:55 – 2:10]  Every token. Every trade. Screened before execution.
```

**Purpose:** Shows the AI layer is live production, not a marketing promise. Names the
integrations explicitly for the grant committee.

---

## Scene 4 — CEX autopilot rebalance (~0:45)

**Wallet:** not required (CEX key vault — read-only API, no on-chain signing)

**What to do on screen:**
1. Navigate to `/cex`.
2. Show the CEX balance rollup — multiple exchanges visible, total USD aggregate at the top.
3. Highlight the **"Read-only keys — non-custodial"** label in the UI (hover or zoom if small).
4. Trigger the **autopilot rebalance** — open the rebalance panel.
5. Show the order preview (pair, amount, direction) — pause 2 s.
6. Confirm — show the loading state.
7. Navigate to `/orders` — new order entry appears in history.

**Captions:**

```
[2:10 – 2:18]  CEX bridge — 10+ exchanges via CCXT.
               Read-only API keys. Non-custodial throughout.
[2:18 – 2:30]  Autopilot detects portfolio imbalance.
               Rebalance preview — review before confirming.
[2:30 – 2:42]  Order submitted. No private key ever leaves your device.
               Lower-third badge: "CCXT · Binance · OKX · Bybit · Kraken · +"
[2:42 – 2:55]  Full order history — on-chain and CEX, unified.
```

**Purpose:** Demonstrates the CEX-bridge differentiator. Reinforces non-custodial posture
(read-only keys = no custody risk) — critical for the grant committee's due-diligence lens.

---

## Scene 5 — Multi-chain portfolio + closing thesis (~0:55)

**Wallet:** Phantom (connected, showing Solana + cross-chain holdings)

**What to do on screen:**
1. Navigate to `/portfolio`.
2. Show the multi-chain breakdown — ETH, SOL, ARB chain tabs or unified list visible.
3. Slow scroll through holdings — show real balances (small amounts fine).
4. Fade to black.
5. Title card appears (white text on black, centered):

```
Non-custodial · Multi-chain · AI-overlayed
```

6. Second title card:

```
Applying: Solana Foundation Grant — Developer Tooling + DeFi Infra
Submitting: Colosseum Eternal Hackathon
```

7. Final frame — product URL held for 5 seconds:

```
swap-z.app
```

**Captions:**

```
[2:55 – 3:08]  Portfolio — ETH, SOL, Arbitrum. One view.
[3:08 – 3:20]  Every asset. Every chain. Your keys.
[3:20 – 3:35]  [title card] Non-custodial · Multi-chain · AI-overlayed
[3:35 – 3:50]  [title card] swap-z.app
```

**Purpose:** Closes with the product thesis and grant context. Reviewers who watch to the end
know exactly what to do next.

---

## Post-production checklist

- [ ] Add lower-third badge overlays in OBS (static PNG, bottom-left, 12 s each)
- [ ] Add caption bars in OBS (bottom-center, white 24px font, dark 60% opacity bar)
- [ ] Export: 1080p 30fps MP4, H.264, ~150–200 MB
- [ ] Upload to Loom (private link for grant submission) + unlisted YouTube (for Twitter embed)
- [ ] Thumbnail: `/about` architecture diagram with "Z-SWAP · Solana Foundation Grant 2026" text

---

## Lower-third badge assets (to create in Figma / Canva)

Four static PNGs, dark glass style matching the app:

| Scene | Text |
|---|---|
| 2 | `0x v2 · LiFi · CoW Protocol` |
| 3 | `Claude Sonnet 4.6 · GoPlus · Honeypot.is · GeckoTerminal` |
| 4 | `CCXT · Binance · OKX · Bybit · Kraken · +5 more` |
| 5 | `Non-custodial · Multi-chain · AI-overlayed` |
