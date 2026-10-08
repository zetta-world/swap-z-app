# Z-SWAP — FOUNDERS PUBLIC SALES FINAL BLOCKERS CLOSURE

Date: 2026-10-08
Start HEAD: `4db8f78ae67fb6634427f48c92a856d1f81f7cfb`
Base sales-page candidate: `acd44d2c85b0568022af49d4e3ebdff286fcc92c`
Final code candidate: `fd68c4f663ced81c3e040367c62697e473b5d542`
Final code tree: `aea9a29aa766304a80dc6394d40377632966ce1f`

This is an implementer closure for independent audit. It is not a release, publication, deployment or authorization to open the Founder sale.

## 1. Independent audit findings

The independent review left two blockers:

1. direct `next@16.3.6` was affected by `GHSA-cjq9-62q9-8jv4`, and the image optimizer accepted an arbitrary remote hostname;
2. Dashboard, Portfolio, Orders and Pools were publicly labeled `AVAILABLE` without a dated user-flow certification for each surface.

Both classes are closed in the code candidate above. The public product result is intentionally mixed: Dashboard and read-only Pools are `AVAILABLE`; Portfolio and Orders are `PARTIAL`.

## 2. Next.js HIGH

The direct dependency moved from `next@16.3.6` to exactly `next@16.3.8`, the patched version identified by the [GitHub Security Advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) and the [Next.js 16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8). No React, wallet, Solana or unrelated dependency was upgraded.

Measured audit delta:

| Scope | Before critical | Before high | Before moderate | After critical | After high | After moderate |
|---|---:|---:|---:|---:|---:|---:|
| full | 0 | 26 | 40 | 0 | 25 | 40 |
| `--omit=dev` | 0 | 21 | 37 | 0 | 20 | 37 |

The advisory is absent from both final audit reports. The residual HIGH set is the pre-existing `braces` chain documented in `SUPPLY-CHAIN-DISPOSITION.md`; its graph and exception did not change in this delta.

## 3. Version before/after

| Item | Before | After |
|---|---|---|
| direct Next declaration | `^16.3.6` | `16.3.8` |
| installed Next | `16.3.6` | `16.3.8` |
| package-lock SHA-256 | `8969d5501b2e52f46ef0a1c2e14fe0b4dcaad9979448683fe507094ee8334f17` | `5d5d05c7d12c3a3905d82f8ee4347c629d6a5acf612483d4f05334c828638816` |

The lock diff is limited to the root Next declaration, `next`, `@next/env` and the eight platform-specific `@next/swc-*` optional packages, all from 16.3.6 to 16.3.8. The declaration is exact so a later install cannot silently select another patch during certification.

## 4. Advisory disposition

`GHSA-cjq9-62q9-8jv4` is **REMEDIATED**:

- final dependency and lock are 16.3.8;
- final full and omit-dev audits contain zero critical findings and no record for the advisory;
- the production artifact contains no advisory identifier or 16.3.6 Next path;
- production build, full suite, browser flow and wallet/security regressions pass on the exact candidate tree.

## 5. Image optimization

The old `hostname: "**"` remote image pattern was removed after a source-wide scan proved that current `next/image` consumers use local sources. A regression recursively scans every JS/TS source importing `next/image` and rejects both a wildcard remote boundary and literal HTTP(S) image sources.

The final build records:

- `images.loader=default`;
- `images.domains=[]`;
- `images.remotePatterns=[]`;
- no arbitrary remote hostname remains.

This is defense in depth in addition to the patched framework version.

## 6. Product certification method

A route was not accepted as evidence by itself. Each product was checked for HTTP/render, mobile and desktop layout, semantic landmarks, errors, empty/loading behavior, actual data boundary, usable core action and accuracy of the public wording. Browser evidence was captured against the production build of the exact code candidate at 390×844, 412×915, 768×1024 and 1440×900.

The status source is `PUBLIC_PRODUCT_CERTIFICATION` in `src/lib/founders-public/facts.ts`. Product cards consume that source directly and expose the same status to the browser test. A regression locks the full matrix so a marketing-only edit cannot promote a product.

## 7. Dashboard

**Final status: `AVAILABLE`.**

The static route renders a useful consolidated projection of real wallet, on-chain and browser-local platform activity. Anonymous/empty behavior, navigation actions, mobile and desktop layouts, and lack of page errors were exercised. The qualifier remains explicit because each source retains its provider and session boundary.

## 8. Portfolio

**Final status: `PARTIAL`.**

Connected-wallet balances are real for assets curated by the current page. It is not wallet-wide coverage, and the page does not yet distinguish an RPC/price-provider failure from a true zero balance. Public copy in EN/PT/ES/ZH was narrowed to the assets currently tracked; it no longer claims a complete multi-chain portfolio.

## 9. Orders

**Final status: `PARTIAL`.**

The browser flow creates, reviews and persists a valid order plan locally; the trigger and action were exercised in the production build. The surface is not a durable unified DEX/CEX order history, so `AVAILABLE` would overstate the current product.

## 10. Pools

**Final status: `AVAILABLE` for read-only discovery.**

The route consumes live provider-shaped data and implements loading, filtered/empty, upstream error and retry states. Fixture-backed browser tests exercised data, empty and 503 flows. Source and copy regressions prove that this surface offers no LP deposit, withdrawal or liquidity-management action. All four languages now state the read-only scope.

## 11. Final public status matrix

| Product | Previous public status | Route | Data/core flow | Mobile/error/empty | Final status | Evidence |
|---|---|---|---|---|---|---|
| Swap | `AVAILABLE` | `/` | supported route preparation/execution with qualifiers | existing regressions | `AVAILABLE` | canonical facts + full suite |
| ZION | `AVAILABLE` | `/zion` | advisory within tier quota; no autonomous execution | existing regressions | `AVAILABLE` | canonical facts + full suite |
| Workbench | `AVAILABLE` | `/laboratorio` | strategy configuration/backtest/comparison | existing regressions | `AVAILABLE` | canonical facts + full suite |
| Paper | `AVAILABLE` | `/laboratorio` | simulated capital only | existing regressions | `AVAILABLE` | canonical facts + full suite |
| Dashboard | `AVAILABLE` without dated evidence | `/dashboard` | real local/on-chain projection and useful empty flow | browser mobile/desktop PASS | `AVAILABLE` | exact-build browser certification |
| Portfolio | `AVAILABLE` | `/portfolio` | real curated balances; incomplete coverage/error distinction | browser mobile/desktop PASS | `PARTIAL` | code inspection + browser certification |
| Orders | `AVAILABLE` | `/orders` | local plan creation/review; no durable unified history | action/persistence/mobile PASS | `PARTIAL` | exact-build browser certification |
| Pools | `AVAILABLE` without declared read-only boundary | `/pools` | provider data; read-only filtering/discovery | data/empty/error/retry PASS | `AVAILABLE` | source regression + browser certification |

Autopilot remains `IMPLEMENTED_DISABLED`, Arb remains `A_CONFIRMAR`, and advanced automation remains `ROADMAP`. None was promoted by this round.

## 12. Analytics wording

No beacon architecture or event was added. Documentation and code comments now use the accurate statement: Founder events store neither raw IP addresses nor FAQ query text; the existing beacon derives a pseudonymous visitor identifier from IP/User-Agent for aggregate counting. The system is not described generically as “PII-free.”

## 13. Targeted tests

- Product/Founders/FAQ/public-claim/Next-image scope: 13 files, 108 tests, PASS.
- Wallet/security: 14 files, 187 tests, PASS.
- Wallet provider export smoke: wagmi, MetaMask, WalletConnect, Coinbase, Phantom, Solflare and Solana React providers, PASS; no network or transaction.
- Exact production browser: 73/73 checks, PASS.
- FAQ parity: 59 questions in each of EN/PT/ES/ZH.
- Axe WCAG A/AA set: zero violations.

## 14. Full recertification

All final commands targeted `fd68c4f663ced81c3e040367c62697e473b5d542`, tree `aea9a29aa766304a80dc6394d40377632966ce1f`, using Node 24.21.0 and npm 11.19.0.

| Gate | Result |
|---|---|
| targeted product/public tests | PASS — 13 files / 108 tests |
| type-check | PASS |
| lint | PASS — 0 errors / 145 pre-existing warnings |
| full suite | PASS — 320 files / 4,702 tests |
| production build | PASS — 240 s under capped executor |
| browser/mobile | PASS — 73/73 checks |
| accessibility | PASS — 0 Axe violations |
| economics | PASS — deterministic regeneration, identical hashes/no diff |
| migrations | PASS — unchanged |
| full supply-chain gate | PASS — narrow pre-existing R-03 exception still explicit |

Two executor failures remain preserved rather than rewritten:

1. the first exact-SHA full suite ran in `node:24-bookworm-slim`, which lacks Git; 4,700 tests passed and the only two failures were repository-integrity tests invoking `git show`. The same suite passed 4,702/4,702 in a local Debian Bookworm Node 24.21.0/npm 11.19.0 image with Git 2.39.5, without a product change;
2. the one authorized exact-SHA clean `npm ci` attempt ended with registry `ECONNRESET`. It was not retried. Recertification used the dependency snapshot produced by an earlier successful clean install of the identical final lock, with matching lock hash and Next 16.3.8. Independent audit should repeat clean install when registry transport is stable.

## 15. Supply chain

The Next HIGH is removed and critical remains zero. Final audits are full `0 critical / 25 high / 40 moderate` and omit-dev `0 / 20 / 37`. The residual HIGH entries remain the independently reviewed, non-runtime `braces` disposition from the prior campaign. Calling the full audit through `scripts/release/audit-gate.mjs` passes with the explicit R-03 warning. Calling that full-graph policy with an omit-dev report fails closed because five expected dev-chain packages are absent from that reduced scope; this is preserved as a scope mismatch, not interpreted as a product failure.

## 16. Non-regression

No migration, economic input/output, Founder sale rule, fee, Workbench quota, sale date, final supply, provisional-price visibility, checkout, production route or ZION Community behavior changed. The deterministic economic outputs remain byte-identical. No production, Vercel or hosted Supabase surface was read or changed.

## 17. Auditor handoff

Audit the final code candidate and its exact tree, then verify the external evidence manifest and Git bundle. The independent auditor should pay particular attention to:

- absence of `GHSA-cjq9-62q9-8jv4` from the current registry result;
- lock drift limited to the Next 16.3.8 patch family;
- `remotePatterns=[]` in the built artifact;
- the distinction between `AVAILABLE` Dashboard/read-only Pools and `PARTIAL` Portfolio/Orders;
- the preserved environmental `npm ci` failure;
- unchanged prior `braces` disposition.

This handoff means **ready for independent audit**. It does not mean production ready, sale ready or deployment authorized.
