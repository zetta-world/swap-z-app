# Z-SWAP — PUBLIC SOURCE OF TRUTH

Verified on: 2026-10-08
Public route: `/founders-pass`
Purpose: reusable public facts for the sales page, presentations, partners, FAQ and a future Community ZION round.

This document is a public projection. Operational security, credentials, incident details, internal economics and release mechanics are deliberately excluded. Code remains authoritative for executable limits; this table records the wording that may be published.

## Status vocabulary

| Status | Meaning |
|---|---|
| `PUBLIC_FACT` | Current fact that may be stated directly. |
| `PUBLIC_WITH_QUALIFIER` | Publish only with the qualifier shown. |
| `ROADMAP` | Planned direction without a delivery promise. |
| `IMPLEMENTED_DISABLED` | Code/infrastructure exists, but public use is disabled. |
| `A_CONFIRMAR` | No public availability claim is allowed yet. |
| `NOT_PART_OF_PRODUCT` | Explicitly excluded from the offer. |
| `DO_NOT_DISCLOSE` | The category may be named; its sensitive content must stay private. |

## Platform and products

| FACT | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| Z-SWAP | `PUBLIC_FACT` | Multi-chain crypto software combining supported swap execution, market analysis, strategy testing, simulation, portfolio and operational tools. | It is not a bank or traditional broker. | `src/lib/founders-public/content.ts` | 2026-10-07 |
| Swap | `PUBLIC_WITH_QUALIFIER` | Compare and prepare supported multi-chain swap routes. | Availability depends on the route, network and provider. | `/`, `src/lib/chains.ts` | 2026-10-07 |
| ZION | `PUBLIC_WITH_QUALIFIER` | Advisory analysis and platform guidance. | It does not autonomously move funds, guarantee profit or replace financial advice. | `src/lib/founders-commercial-truth.ts`, `src/lib/tier/types.ts` | 2026-10-07 |
| Workbench | `PUBLIC_WITH_QUALIFIER` | Configure strategies, backtest historical data and compare measured outcomes. | Historical or simulated performance does not guarantee future results. | `src/lib/tier/types.ts` | 2026-10-07 |
| Paper simulation | `PUBLIC_WITH_QUALIFIER` | Follow strategies with simulated capital before considering real execution. | It does not use real money; modeled execution can differ from live execution. | `src/lib/tier/types.ts` | 2026-10-07 |
| Dashboard | `PUBLIC_WITH_QUALIFIER` | Available consolidated view of real local, wallet and platform activity. | Empty state and navigation are usable without a connected wallet; individual data sources retain their own provider/session limits. | `/dashboard`, `PUBLIC_PRODUCT_CERTIFICATION` | 2026-10-08 |
| Portfolio | `PUBLIC_WITH_QUALIFIER` | Partially available tracking for the curated assets currently supported. | Coverage is not wallet-wide, and RPC/price failures are not yet distinguished from an empty balance. | `/portfolio`, `PUBLIC_PRODUCT_CERTIFICATION` | 2026-10-08 |
| Orders | `PUBLIC_WITH_QUALIFIER` | Partially available preparation and browser-local review of order plans. | It is not a durable unified DEX/CEX order history. | `/orders`, `PUBLIC_PRODUCT_CERTIFICATION` | 2026-10-08 |
| Pools | `PUBLIC_WITH_QUALIFIER` | Available read-only discovery of supported liquidity pools and live provider data. | No LP deposit, withdrawal or liquidity-management action is offered on this surface. | `/pools`, `PUBLIC_PRODUCT_CERTIFICATION` | 2026-10-08 |

### Public product status matrix

| Product | Public status | Certified scope | Canonical source |
|---|---|---|---|
| Swap | `AVAILABLE` | Supported route preparation and execution with network/provider qualifiers. | `src/lib/founders-public/facts.ts` |
| ZION | `AVAILABLE` | Advisory analysis within quota; no autonomous fund movement. | `src/lib/founders-public/facts.ts` |
| Workbench | `AVAILABLE` | Strategy configuration, backtest and measured comparison. | `src/lib/founders-public/facts.ts` |
| Paper simulation | `AVAILABLE` | Simulated capital only; not live execution. | `src/lib/founders-public/facts.ts` |
| Dashboard | `AVAILABLE` | Consolidated real platform/wallet/local activity with usable empty state. | `src/lib/founders-public/facts.ts` |
| Portfolio | `PARTIAL` | Curated connected-wallet assets; incomplete coverage and error distinction. | `src/lib/founders-public/facts.ts` |
| Orders | `PARTIAL` | Browser-local order-plan preparation/review; no unified durable history. | `src/lib/founders-public/facts.ts` |
| Pools | `AVAILABLE` | Read-only live discovery, filtering and provider failure handling. | `src/lib/founders-public/facts.ts` |

Changing a public badge requires updating `PUBLIC_PRODUCT_CERTIFICATION`, its dated evidence and the product-status regression test. A route existing by itself is not certification.

## Founder Pass and Premium

| FACT | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| Founder Pass | `PUBLIC_FACT` | An on-chain membership pass focused on product utility. | Do not position it as an investment. | `src/lib/founders-commercial-truth.ts` | 2026-10-07 |
| Founder status | `PUBLIC_FACT` | Durable Founder status attached to the pass. | It is a property of the pass, not perpetual personal status independent of ownership. | `POLITICA_STATUS_FOUNDER` | 2026-10-07 |
| Premium duration | `PUBLIC_FACT` | Exactly 36 months of Premium. | The common clock starts at the official sale close. | `CONFIG_APROVADA.premium` | 2026-10-07 |
| Transfer | `PUBLIC_FACT` | Transfer does not restart the 36-month clock. | Rights linked to the status follow the current holder under the applicable ownership policy. | `POLITICA_STATUS_FOUNDER` | 2026-10-07 |
| After 36 months | `PUBLIC_WITH_QUALIFIER` | Premium ends; durable Founder status remains attached to the pass. | No automatic future product, benefit or allowlist entitlement. | `POLITICA_STATUS_FOUNDER` | 2026-10-07 |
| Economic rights | `NOT_PART_OF_PRODUCT` | No equity, yield, guaranteed return, revenue share, holder dividend or treasury governance. | Secondary-market liquidity or value is not guaranteed. | `BENEFICIOS` exclusions | 2026-10-07 |

## Benefits and support

| FACT | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| ZION advisory | `PUBLIC_FACT` | Available according to the tier quota. | Assistance is informational; it can be wrong. | `BENEFICIOS`, `TIER_DAILY_ANALYSES` | 2026-10-07 |
| Reduced EVM fee | `PUBLIC_WITH_QUALIFIER` | Free 1.00%, Pro 0.50%, Trader 0.25%, Pilot 0.10%. | Only on supported EVM routes where the Z-SWAP fee mechanism is active. | `TAXA_SWAP_BPS`, `TIER_FEE_BPS` | 2026-10-07 |
| Solana Z-SWAP platform fee | `PUBLIC_WITH_QUALIFIER` | No Z-SWAP platform fee currently. | Network, DEX, aggregator, bridge or exchange fees can still apply. | commercial closure + current fee module | 2026-10-07 |
| Priority support | `PUBLIC_WITH_QUALIFIER` | Available from Trader as an asynchronous priority queue. | No hard SLA, human 24/7 coverage, concierge or personal CEO obligation. | `POLITICA_SUPORTE_PRIORITARIO` | 2026-10-07 |
| CEX Autopilot | `IMPLEMENTED_DISABLED` | Infrastructure exists, but public use is disabled. | It is not an available Founder benefit. | `BENEFICIOS.cex_autopilot` | 2026-10-07 |
| Arbitrage scanner | `A_CONFIRMAR` | Its place in the Founder offer is still to be confirmed. | Never show an available check mark. | `BENEFICIOS.arb_scanner` | 2026-10-07 |
| Pilot advanced automation | `ROADMAP` | Planned subject to safety gates and certification. | No launch date and no unrestricted autonomous-execution promise. | `BENEFICIOS.pilot_advanced_automation` | 2026-10-07 |

## Tier limits

| Tier | ZION/day | Backtests/rolling 24h | Assets/test | History days | Saved strategies | Paper desks | Simulation notional | Supported EVM fee |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Free | 5 | 10 | 3 | 365 | 1 | 0 | US$1,000 | 1.00% |
| Pro | 10 | 100 | 10 | 730 | 10 | 0 | US$25,000 | 0.50% |
| Trader | 25 | 500 | 10 | 730 | 50 | 3 | US$250,000 | 0.25% |
| Pilot | 30 | 5,000 | 10 | 730 | 200 | 10 | US$100,000,000 | 0.10% |

The public Pilot promise is narrower than the generic tier ceiling: up to 5,000 standard own-strategy backtests per rolling 24 hours, where a standard run is up to 3 assets × 365 days × 4-hour candles. Larger runs consume data budget proportionally. Mesa mode has a separate budget and is excluded from the 5,000 promise.

Sources: `src/lib/tier/types.ts`, `src/lib/founders-commercial-truth.ts`.

## Networks

| FACT | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| Current networks | `PUBLIC_FACT` | Ethereum, BNB Chain, Polygon, Base, Arbitrum, Optimism, Avalanche and Solana. | Individual routes/providers can have narrower availability. | `src/lib/chains.ts` | 2026-10-07 |
| ZETTA Chain | `ROADMAP` | Coming later; not a live supported network. | No promised date. | `src/lib/chains.ts` | 2026-10-07 |

## Sale mechanics

| FACT | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| Sale state | `PUBLIC_FACT` | Sale not open. | No buy, mint or checkout control is active. | public projection | 2026-10-07 |
| Sale date | `A_CONFIRMAR` | To be announced. | Do not show a countdown or implied date. | `CONFIG_APROVADA.dataLancamento` | 2026-10-07 |
| Final supply | `A_CONFIRMAR` | Will be announced before the sale. | Do not publish internal planning supply as final public supply. | owner instruction 2026-10-07 | 2026-10-07 |
| Founder prices | `PUBLIC_WITH_QUALIFIER` | Public prices remain hidden while provisional. | Planning references exist, but final values require demand validation and confirmation. | `FOUNDERS_PRICE_STATUS`, `precoPublicoUsd` | 2026-10-07 |
| Allowlist | `PUBLIC_FACT` | 48-hour priority phase. | It grants timing priority, not extra supply. | `CONFIG_APROVADA.duracaoAllowlistMs` | 2026-10-07 |
| Allowlist wallet limit | `PUBLIC_FACT` | 1 Pro, 1 Trader and 1 Pilot. | Purchases count toward the event total. | `CONFIG_APROVADA.tetos.allowlist` | 2026-10-07 |
| Event wallet limit | `PUBLIC_FACT` | 2 Pro, 2 Trader and 1 Pilot in total. | Cumulative across allowlist and public sale. | `CONFIG_APROVADA.tetos.publica` | 2026-10-07 |
| Pilot public sale | `PUBLIC_FACT` | Unsold Pilot supply can continue into the public phase. | Pilot is not allowlist-exclusive. | final sale closure | 2026-10-07 |
| End condition | `PUBLIC_FACT` | Real sold-out or exactly 14 days after allowlist opens, whichever happens first. | No administrative early close is approved. | `CONFIG_APROVADA.duracaoMaximaVendaMs` | 2026-10-07 |
| Unsold passes | `PUBLIC_FACT` | Remain unminted. | No fake sold-out or advance minting. | final sale closure | 2026-10-07 |
| Payment network/method | `A_CONFIRMAR` | Will be published before sale. | Do not claim SOL, card, PIX or another method as final. | `FOUNDERS-SALES-PAGE-OPEN-DECISIONS.md` | 2026-10-07 |

## Custody, security and risk

| FACT | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| DEX authorization | `PUBLIC_WITH_QUALIFIER` | The wallet signs each on-chain transaction. | Never share seed phrase or private key. | current wallet flow | 2026-10-07 |
| CEX authorization | `PUBLIC_WITH_QUALIFIER` | Uses explicit, revocable exchange API permissions when applicable. | This differs from the DEX wallet-signature model. | current CEX flow | 2026-10-07 |
| Financial outcome | `NOT_PART_OF_PRODUCT` | No guaranteed profit, availability, liquidity or protection against loss. | Crypto, smart contracts, bridges, networks, providers, exchanges and user actions carry risk. | current risk copy | 2026-10-07 |

## Do not disclose

| FACT CATEGORY | STATUS | PUBLIC WORDING | QUALIFIER | SOURCE | LAST VERIFIED |
|---|---|---|---|---|---|
| Credentials, secrets and private keys | `DO_NOT_DISCLOSE` | Never publish. | Includes values, storage paths and recovery material. | security boundary | 2026-10-07 |
| Internal security controls and exploitable detail | `DO_NOT_DISCLOSE` | Describe safety outcomes only. | Do not publish bypass conditions, internal thresholds or incident mechanics. | security boundary | 2026-10-07 |
| Internal costs, salaries, stress models and treasury operations | `DO_NOT_DISCLOSE` | Not public product facts. | Economic policy remains in controlled documents. | economics boundary | 2026-10-07 |
| Internal infrastructure, host identities and release metadata | `DO_NOT_DISCLOSE` | Not public product facts. | Do not publish IPs, environment layout, branches or SHAs. | operational boundary | 2026-10-07 |

## Public analytics wording

Founder events do not store raw IP addresses or FAQ search text. The existing beacon derives a pseudonymous identifier from request IP/User-Agent for aggregate visitor counting. This is pseudonymous telemetry and must not be described generically as "PII-free".
