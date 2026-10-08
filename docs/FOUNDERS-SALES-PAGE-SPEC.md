# Z-SWAP — FOUNDERS SALES PAGE SPEC

Canonical URL: `/founders-pass`  
Public facts: `docs/ZSWAP-PUBLIC-SOURCE-OF-TRUTH.md`  
Implementation: `src/app/(previa)/founders-pass/page.tsx`

The page is an informational product and sales experience. It does not open the sale, create a lead database, mint a pass or activate checkout. The audited local simulator remains behind `FOUNDERS_SALE_PREVIEW=1` on the same route and is not public behavior.

## 1. Hero

- **PURPOSE:** identify Z-SWAP and explain the Founder Pass within seconds.
- **PUBLIC COPY:** multi-chain trading tools, clearer decisions and verifiable membership; sale closed; date and final supply to be announced.
- **FACT SOURCE:** public facts projection and `POLITICA_STATUS_FOUNDER`.
- **STATUS:** implemented.
- **COMPONENT:** `FoundersPublicPage` hero.
- **CTA:** Explore Z-SWAP, Compare plans, Join the community.
- **TRACKING:** `founders_page_view`, `platform_click`, `tier_compare`, `community_click`.
- **OPEN DECISION:** sale date, final supply and final price.

## 2. Explore the platform

- **PURPOSE:** show concrete product surfaces rather than generic crypto claims.
- **PUBLIC COPY:** Swap, ZION, Workbench, paper simulation, Dashboard, Portfolio, Orders and Pools, each with a visible status.
- **FACT SOURCE:** route inventory plus `src/lib/chains.ts`.
- **STATUS:** implemented with current network list and ZETTA Chain roadmap separation.
- **COMPONENT:** product card grid.
- **CTA:** opens the corresponding platform route.
- **TRACKING:** `platform_click`.
- **OPEN DECISION:** none for presentation; provider-specific availability remains qualified.

## 3. Founder Pass

- **PURPOSE:** separate durable status from temporary Premium.
- **PUBLIC COPY:** durable Founder status attached to the pass; exactly 36 months Premium from official sale close; transfer does not restart the clock; current holder receives applicable rights.
- **FACT SOURCE:** `src/lib/founders-commercial-truth.ts`, `CONFIG_APROVADA.premium`.
- **STATUS:** implemented.
- **COMPONENT:** paired Founder/Premium cards.
- **CTA:** comparison and FAQ links through page navigation.
- **TRACKING:** page view only.
- **OPEN DECISION:** final on-chain terms remain a pre-sale legal/technical gate.

## 4. Benefit status

- **PURPOSE:** prevent disabled or planned features from being sold as current.
- **PUBLIC COPY:** CEX Autopilot implemented/disabled; arbitrage scanner to be confirmed; priority support available at launch from Trader with limits; Pilot advanced automation roadmap.
- **FACT SOURCE:** `BENEFICIOS`, `POLITICA_SUPORTE_PRIORITARIO`.
- **STATUS:** implemented with distinct badges.
- **COMPONENT:** four status cards.
- **CTA:** FAQ details.
- **TRACKING:** no dedicated event.
- **OPEN DECISION:** arbitrage offer disposition and future roadmap dates.

## 5. Tier cards and comparison

- **PURPOSE:** compare Free, Pro, Trader and Pilot from canonical quotas.
- **PUBLIC COPY:** intended user, ZION/day, rolling backtests, assets, history, saved strategies, paper desks, notional, supported EVM fee and support.
- **FACT SOURCE:** `TIER_DAILY_ANALYSES`, `BANCADA_COTAS`, `TIER_FEE_BPS`, `FEATURE_TIER`.
- **STATUS:** implemented. Public prices are data-driven and remain hidden while provisional.
- **COMPONENT:** `FoundersTierComparison`; desktop table plus stacked mobile cards.
- **CTA:** See all details.
- **TRACKING:** `tier_view`, `tier_compare`, `price_view`.
- **OPEN DECISION:** final Founder prices.

## 6. Fees and Pilot standard

- **PURPOSE:** explain fee scope and the 5,000-backtest promise without ambiguity.
- **PUBLIC COPY:** tier EVM rates apply only where the mechanism is active; Solana currently has no Z-SWAP platform fee; third-party fees can apply. Pilot standard is 3 assets × 365 days × 4-hour candles, rolling 24 hours; Mesa has a separate budget.
- **FACT SOURCE:** fee modules and `OFERTA_PADRAO_PILOT`.
- **STATUS:** implemented.
- **COMPONENT:** qualifier cards beneath comparison.
- **CTA:** FAQ.
- **TRACKING:** `price_view` through the tier section.
- **OPEN DECISION:** none in this round.

## 7. Sale mechanics

- **PURPOSE:** explain the approved process without simulating an open sale.
- **PUBLIC COPY:** 48h allowlist; 1/1/1 allowlist; 2/2/1 cumulative totals; Pilot can continue public; exact day 14 or real sold-out; unsold remains unminted.
- **FACT SOURCE:** `CONFIG_APROVADA` and final sale closures.
- **STATUS:** implemented.
- **COMPONENT:** five-step sequence and numeric summary.
- **CTA:** none to buy or mint.
- **TRACKING:** `sale_mechanics_view`.
- **OPEN DECISION:** date, final supply, payment network/method, legal eligibility and final price.

## 8. Security and custody

- **PURPOSE:** explain authorization honestly without absolute security claims.
- **PUBLIC COPY:** DEX wallet signature and CEX permission models are separate; seed phrase/private key are never requested.
- **FACT SOURCE:** current DEX/CEX execution boundaries.
- **STATUS:** implemented.
- **COMPONENT:** DEX and CEX cards.
- **CTA:** none.
- **TRACKING:** page view only.
- **OPEN DECISION:** none for the public distinction.

## 9. How to start

- **PURPOSE:** let a new visitor explore Free tools before any Founder purchase.
- **PUBLIC COPY:** learn, connect only when needed, use tools, compare tiers, wait for the official sale announcement.
- **FACT SOURCE:** platform routes and sale state.
- **STATUS:** implemented.
- **COMPONENT:** five-step visual flow.
- **CTA:** platform and comparison links elsewhere on the page.
- **TRACKING:** existing CTA events.
- **OPEN DECISION:** none.

## 10. Complete FAQ

- **PURPOSE:** reduce repeated community questions and disclose uncertainty.
- **PUBLIC COPY:** 59 questions across platform, Founder, sale, plans, tools, fees, security, risk and support.
- **FACT SOURCE:** the same `FoundersPublicFacts` projection used by the page.
- **STATUS:** implemented in EN/PT/ES/ZH.
- **COMPONENT:** `FoundersFaq` with search, categories, native accessible accordions and stable hash links.
- **CTA:** per-question deep links.
- **TRACKING:** `faq_open`; `faq_search` stores only locale/category/query length/result count, never query text.
- **OPEN DECISION:** community DM/admin policy and dedicated partnership channel.

## 11. Risk and disclaimers

- **PURPOSE:** state financial and operational risk in plain language.
- **PUBLIC COPY:** crypto is volatile; protocol/provider/user risk exists; backtests and paper do not guarantee outcomes; roadmap can change.
- **FACT SOURCE:** public risk policy.
- **STATUS:** implemented.
- **COMPONENT:** risk cards and footer disclaimer.
- **CTA:** official community and platform.
- **TRACKING:** CTA events only.
- **OPEN DECISION:** jurisdiction, eligibility, KYC, refund, tax and final terms.

## 12. SEO and structured data

- **PURPOSE:** provide accurate discovery metadata without fabricated social proof.
- **PUBLIC COPY:** route-specific title/description, canonical URL, OpenGraph/Twitter and factual FAQPage/SoftwareApplication JSON-LD.
- **FACT SOURCE:** English FAQ projection.
- **STATUS:** implemented.
- **COMPONENT:** route metadata and JSON-LD script.
- **CTA:** none.
- **TRACKING:** none.
- **OPEN DECISION:** none.

## 13. Responsive and accessible behavior

- **PURPOSE:** treat mobile as the primary entry surface.
- **PUBLIC COPY:** unchanged across breakpoints.
- **FACT SOURCE:** same data and i18n content at every width.
- **STATUS:** implementation uses semantic headings, skip link, minimum touch targets, visible focus-compatible controls, native details/summary and reduced-motion-aware global styling. Visual evidence is captured separately.
- **COMPONENT:** all public components.
- **CTA:** keyboard and touch accessible.
- **TRACKING:** unchanged.
- **OPEN DECISION:** none.

## Public analytics schema

The existing `/api/beacon` accepts only a closed Founders event vocabulary: `founders_page_view`, `tier_view`, `tier_compare`, `faq_open`, `faq_search`, `community_click`, `platform_click`, `price_view`, `sale_mechanics_view`. It rejects unknown fields and never accepts FAQ query text.

