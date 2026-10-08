# Z-SWAP — FOUNDERS PUBLIC SALES EXPERIENCE CLOSURE

Reference date: 2026-10-07
Start HEAD: `dd04b7b66ac025c04a0ee4347adcdd8e5ce3b1f4`
Recertified code candidate: `acd44d2c85b0568022af49d4e3ebdff286fcc92c`
Candidate tree: `ee72bc9bdb28575780914ff4ad5e1b824d02deae`
Campaign: `founders-public-sales-page-20261007T215055Z`

## 1. EXECUTIVE VERDICT

The local public Founder experience is complete and ready for independent audit. The canonical `/founders-pass` route now explains Z-SWAP, the live product surfaces, tier differences, Founder ownership, the 36-month Premium period, sale mechanics, fees, networks, custody boundaries and risk. It contains no active buy, mint or checkout control.

This result does not authorize publication, sale, deploy or release. Sale date, final supply, final price, payment method and the legal gates remain open. A new registry advisory for the unchanged Next.js version also makes the current supply-chain gate fail pending its separate disposition.

## 2. SOURCE OF TRUTH

`docs/ZSWAP-PUBLIC-SOURCE-OF-TRUTH.md` records each public fact with status, approved wording, qualifier, source and verification date. Runtime-critical presentation data is projected by `src/lib/founders-public/facts.ts` from existing canonical modules instead of being copied into components.

The projection deliberately omits internal planning supply and provisional price numbers from the public page. It distinguishes:

- `PUBLIC_FACT`;
- `PUBLIC_WITH_QUALIFIER`;
- `ROADMAP`;
- `IMPLEMENTED_DISABLED`;
- `A_CONFIRMAR`;
- `NOT_PART_OF_PRODUCT`;
- `DO_NOT_DISCLOSE`.

## 3. PUBLIC PRODUCT POSITIONING

The page leads with Z-SWAP as a multi-chain trading-tools platform and presents the Founder Pass as verifiable membership. It avoids investment, yield, dividend, revenue-share, guaranteed-return and guaranteed-future-benefit claims.

The product grid exposes concrete routes for Swap, ZION, Workbench, paper simulation, Dashboard, Portfolio, Orders and Pools. Every item carries its current status. The visitor can explore Free product surfaces without purchasing a Founder Pass.

## 4. PAGE STRUCTURE

The canonical public route is `/founders-pass`. Its narrative is:

1. Hero and sale-closed state;
2. real platform surfaces;
3. Founder status versus Premium;
4. benefit-status disclosures;
5. tier cards and complete comparison;
6. fees and Pilot standard-run definition;
7. sale mechanics;
8. DEX/CEX custody boundaries;
9. how to start;
10. searchable FAQ;
11. risk disclosures and verified CTAs.

The older local sale simulator is available only when the server-side `FOUNDERS_SALE_PREVIEW=1` flag is explicitly set. It is not the default public behavior.

## 5. TIER PRESENTATION

Free, Pro, Trader and Pilot are shown through compact cards and a detailed responsive comparison derived from canonical quotas. The comparison includes ZION, Workbench, backtests, assets, history, saved strategies, paper desks, simulation notional, EVM platform fee and support.

Public Founder prices remain hidden because their canonical status is `PROVISIONAL_FOR_DEMAND_VALIDATION`. The page says pricing is being finalized and does not duplicate planning amounts.

Pilot is described as up to 5,000 standard own-strategy backtests in a rolling 24-hour window. A standard run is up to 3 assets, 365 days and 4-hour candles. Larger runs consume data budget proportionally; Mesa mode has a separate budget.

## 6. SALE MECHANICS

The page preserves the closed sale-domain decisions:

- allowlist: 48 hours;
- allowlist limit: 1 Pro, 1 Trader and 1 Pilot per wallet;
- cumulative event limit: 2 Pro, 2 Trader and 1 Pilot per wallet;
- allowlist purchases count toward cumulative limits;
- unsold Pilot supply may enter public sale;
- sale ends at real sold-out or exactly 14 days from allowlist opening;
- unsold passes remain unminted;
- no fake sold-out, countdown, buyer count or remaining-pass count.

Date and final supply are explicitly unannounced.

## 7. FAQ COVERAGE

The page contains 59 substantive questions in each of EN, PT, ES and ZH. Categories cover the platform, Founder Pass, sale, pricing and tiers, ZION and tools, fees and networks, security and risk, support and partnerships.

The FAQ provides client-side search, category filters, accessible native accordions, keyboard behavior and stable per-question hash links. `faq_search` records locale, category, query length and result count; the query text is never sent.

## 8. SECURITY/CUSTODY COPY

The DEX and CEX models are explicitly separated:

- DEX transactions require wallet signatures;
- CEX integrations, when used, rely on explicit and revocable API permissions;
- Z-SWAP never asks for a seed phrase or private key;
- no absolute security or no-loss claim is made.

Internal credentials, infrastructure, recovery mechanics, vulnerability findings, anti-abuse thresholds, costs and treasury operations are excluded from public facts.

## 9. ROADMAP DISCLOSURE

- CEX Autopilot: `IMPLEMENTED / DISABLED`;
- arbitrage scanner: `A CONFIRMAR`;
- Pilot advanced automation: `COMING SOON / ROADMAP`, subject to safety gates and certification;
- ZETTA Chain: roadmap, without a promised date.

None receives an available-state treatment. Pilot is not sold on future automation.

## 10. MOBILE

Production-artifact browser checks passed at 390×844, 412×915, 768×1024 and 1440×900. Each viewport returned HTTP 200, one H1, 59 FAQ entries, no page-width overflow, no active buy/mint/purchase control, valid structured data, working skip link and no console or page errors.

The hero was visually inspected after fixing word splitting. Mobile uses readable whole words; desktop retains the intended composition. The comparison becomes stacked content on narrow screens instead of an unusable horizontal table.

## 11. ACCESSIBILITY

Automated Axe checks for WCAG 2 A/AA and 2.1 A/AA returned zero violations at 390×844 and 1440×900. The same run found no clipped text, sub-24-by-24 interactive controls, running animation under reduced motion, or missing labelled page sections.

The implementation provides semantic headings, a visible-on-focus skip link, native `details`/`summary`, labelled search and filters, focus styles, adequate touch height and user zoom. The root-level `maximumScale=1` restriction was removed.

## 12. SEO

The route provides a specific title, description, canonical URL, OpenGraph data, X/Twitter data and official existing artwork. Factual `FAQPage` and `SoftwareApplication` JSON-LD are present. No review, rating, buyer-count or social-proof schema was invented.

## 13. ANALYTICS READINESS

The existing `/api/beacon` route was reused. It accepts a closed Founders event vocabulary:

`founders_page_view`, `tier_view`, `tier_compare`, `faq_open`, `faq_search`, `community_click`, `platform_click`, `price_view`, `sale_mechanics_view`.

Unknown fields are rejected and no FAQ query text or other unnecessary PII is accepted. A production-artifact smoke returned HTTP 204 for an allowed event.

## 14. TESTS

- Public targeted tests: PASS, final focused run 3 files / 10 tests; earlier complete public group 4 files / 12 tests.
- Founders commercial/domain non-regression: PASS, 25 files / 299 tests before the final presentation-only adjustment; included again in the full suite.
- Full suite on exact candidate: PASS, 318 files / 4,689 tests.
- Type-check: PASS. The first final executor used an undersized 1.2 GiB V8 heap and exited 134 before reporting TypeScript diagnostics; the preserved corrected-executor run passed with the previously validated 1.7 GiB heap and no source change.
- Lint: PASS, 0 errors / 145 pre-existing warnings.
- Production build: PASS. Existing warnings remain for middleware/Edge deprecation and an oversized llama.fi cache response.
- Browser behavior: EN/PT/ES/ZH switching PASS; FAQ search PASS; beacon PASS.
- `git diff --check`: PASS.

## 15. OPEN DECISIONS

`docs/FOUNDERS-SALES-PAGE-OPEN-DECISIONS.md` records ten unresolved public or sale-opening decisions. Informational-page publication does not require inventing them; sale activation does require closure of the relevant legal, payment, price, supply and date items.

A new registry result discovered after the separate supply-chain closure adds `GHSA-cjq9-62q9-8jv4` against the locked Next.js 16.3.6. The current omit-dev graph is 0 critical, 21 high and 37 moderate. The lockfile did not change in this round. The new reachable direct-runtime HIGH requires its own supply-chain disposition before release or public deployment.

## 16. NON-REGRESSION

- Founders sale rules: unchanged;
- 48-hour allowlist and 1/1/1 limit: unchanged;
- 2/2/1 cumulative limit: unchanged;
- exact 14-day window: unchanged;
- Pilot public-sale eligibility: unchanged;
- Premium 36 months: unchanged;
- durable Founder status attached to the pass: unchanged;
- economics: deterministic output hashes unchanged;
- fees and Workbench quotas: unchanged;
- package-lock: unchanged at `8969d5501b2e52f46ef0a1c2e14fe0b4dcaad9979448683fe507094ee8334f17`;
- migrations: unchanged;
- production, Vercel and hosted Supabase: untouched.

## 17. AUDITOR HANDOFF

Audit candidate: `acd44d2c85b0568022af49d4e3ebdff286fcc92c` with tree `ee72bc9bdb28575780914ff4ad5e1b824d02deae`. The subsequent control-plane commit contains only this closure report and authority/current-state/ledger updates; it is not the recertified code candidate.

Evidence is under `zswap-local/evidence/founders-public-sales-page-20261007T215055Z/`. The external audit package contains exact Git identity, patch, bundle, reports, logs, responsive screenshots, manifest, SHA-256 inventory and secret-scan result.

Disposition: **IMPLEMENTATION COMPLETE — READY FOR INDEPENDENT AUDIT**. This is not release approval, sale approval, publication approval or deploy authorization.
