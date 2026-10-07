# Z-SWAP — SUPPLY CHAIN DISPOSITION

Data de referência: 07/10/2026
Start HEAD: `35b7c727802343c5b6ba55dffa18da6fad19191e`
Base Founders aceita: `efdf6ee5a64d4f5491b806da6258706615b6ffec`
Candidato de código desta campanha: `63326edb6d4cd3f6f95be8fc77b9d0382db91dc0`
Tree: `3cb3affc8da4472b360984274d459157c2faec44`
Package-lock final: `8969d5501b2e52f46ef0a1c2e14fe0b4dcaad9979448683fe507094ee8334f17`

## Executive verdict

O CRITICAL de `shell-quote` foi remediado de `1.10.0` para `1.12.0`. Os HIGH alcançáveis que tinham correção patch/minor foram remediados: `sharp` passou de `0.35.4` para `0.35.5` e `source-map-js` de `1.2.1` para `1.2.2`. Não houve major upgrade, override, remoção de Solana, alteração de código financeiro, mudança de Founders, migration, deploy ou write hospedado.

O audit de produção passou de **1 critical / 22 high / 37 moderate / 0 low** para **0 critical / 20 high / 37 moderate / 0 low**. Os 20 registros HIGH restantes são a propagação de um único advisory raiz, `braces <=3.0.3` (`GHSA-vfj7-8cjw-p6xm`). Não existe versão corrigida. A cadeia residual pertence ao tooling React Native/Metro/Jest trazido transitivamente pelo adapter móvel de Solana; a análise do build encontrou zero referências exatas dessa cadeia em client, server e edge.

A disposição proposta para esses registros é `NOT_RUNTIME_REACHABLE`, sujeita a auditoria independente. A exceção de CI continua **temporária**, `corrigido=false` e com revisão obrigatória antes da seleção de RC. Por isso o veredito de segurança desta campanha é **CONDITIONAL**, e não “release ready”.

## Measurements before and after

| Scope | Critical | High | Moderate | Low | Total |
|---|---:|---:|---:|---:|---:|
| Baseline full | 1 | 27 | 40 | 0 | 68 |
| Baseline `--omit=dev` | 1 | 22 | 37 | 0 | 60 |
| Final full | 0 | 25 | 40 | 0 | 65 |
| Final `--omit=dev` | 0 | 20 | 37 | 0 | 57 |

`npm audit` conta linhas de pacote afetadas. Os 20/25 HIGH finais não são 20/25 advisories independentes: todos derivam do único advisory de `braces`.

## Authoritative CRITICAL/HIGH inventory

Todos os itens CRITICAL/HIGH do baseline aparecem abaixo, inclusive os removidos pelo upgrade.

| ID | Package | Severity | Advisory | Installed baseline → final | Vulnerable range / fixed | Direct / transitive | Parent chain | `fixAvailable` baseline | Runtime reachability | Exploitability in Z-SWAP | Disposition | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC-001 | `shell-quote` | CRITICAL | `GHSA-pqg4-j6r4-53mv` | 1.10.0 → 1.12.0 | `>=1.8.4 <1.11.0`; fixed 1.11.0 | transitive | Solana adapter → mobile adapter → React Native → react-devtools-core | yes | vulnerable version absent from final artifacts and graph | vulnerable library behavior reproduced; application path not proven; final version rejects payload | REMEDIATED | `17`, `30`, `47`, `66` |
| SC-002 | `sharp` | HIGH | `GHSA-wq5f-xc86-pv6w` | 0.35.4 → 0.35.5 | `<0.35.5`; fixed 0.35.5 | transitive optional | Next.js → sharp | yes | SERVER, 34 NFT traces | potentially reachable image processing path; waiver not used | REMEDIATED | `14`, `44a`, `66` |
| SC-003 | `source-map-js` | HIGH | `GHSA-68fv-2mgg-jv7q` | 1.2.1 → 1.2.2 | `<1.2.2`; fixed 1.2.2 | transitive | Next/PostCSS; Tailwind/PostCSS | yes | BUILD only, 8 references | no deployed request path found; fixed regardless | REMEDIATED | `14`, `44a`, `66` |
| SC-004 | `braces` | HIGH | `GHSA-vfj7-8cjw-p6xm` | 3.0.3 → 3.0.3 | `<=3.0.3`; no fixed release | transitive | micromatch → braces | no | MOBILE/BUILD tooling; 0 client/server/edge | no deployed web path; crafted glob could affect a tooling invocation | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-005 | `micromatch` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 4.0.8 → 4.0.8 | via braces; no root fix | transitive | Metro file map / fast-glob / Tailwind → micromatch | no | MOBILE/BUILD tooling; 0 client/server/edge | no deployed web path | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-006 | `@jest/environment` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via Jest → micromatch → braces | transitive | React Native tooling → Jest | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-007 | `@jest/fake-timers` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via Jest → micromatch → braces | transitive | React Native tooling → Jest | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-008 | `@jest/transform` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via Jest/istanbul/micromatch | transitive | React Native tooling → Jest transform | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66`, `71` |
| SC-009 | `babel-jest` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via Jest transform | transitive | React Native tooling → Babel/Jest | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-010 | `jest-environment-node` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via Jest/micromatch | transitive | React Native tooling → Jest | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-011 | `jest-haste-map` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via micromatch → braces | transitive | React Native tooling → Jest haste map | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-012 | `jest-message-util` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 29.7.0 → 29.7.0 | via micromatch → braces | transitive | React Native tooling → Jest message util | no | TEST/MOBILE tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-013 | `@react-native/community-cli-plugin` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.84.1/0.85.3 unchanged | via Metro/micromatch/braces | transitive | Solana mobile packages → React Native CLI | no | MOBILE CLI tooling; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-014 | `@react-native/virtualized-lists` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.85.3 unchanged | via React Native tooling | transitive | Solana adapter → React Native | no | MOBILE dependency; vulnerable branch absent | no braces path in deployed web artifact | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-015 | `react-native` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.84.1/0.85.3 unchanged | via Metro/Jest/micromatch/braces | transitive | Solana mobile packages → React Native | no | MOBILE dependency; 0 artifact reference | no deployed braces path | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-016 | `metro` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.83.7/0.84.4 unchanged | via Metro file map → micromatch | transitive | React Native CLI/tooling → Metro | no | MOBILE bundler; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-017 | `metro-config` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.83.7/0.84.4 unchanged | via Metro | transitive | React Native CLI/tooling | no | MOBILE bundler; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-018 | `metro-file-map` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.83.7/0.84.4 unchanged | via micromatch → braces | transitive | Metro file watcher | no | MOBILE file watcher; 0 artifact | vulnerable glob accepts tooling paths, not web input | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-019 | `metro-transform-worker` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.83.7/0.84.4 unchanged | via Metro | transitive | React Native bundler | no | MOBILE build worker; 0 artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-020 | `@solana-mobile/mobile-wallet-adapter-protocol` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 2.3.0 unchanged | via React Native tooling | transitive | wallet-adapter-react → mobile adapter | no | adapter code can be bundled, but vulnerable braces branch cannot | no braces path in artifact | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-021 | `@solana-mobile/mobile-wallet-adapter-protocol-web3js` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 2.3.0 unchanged | via protocol/React Native tooling | transitive | wallet-adapter-react → mobile adapter | no | vulnerable tooling branch absent | no braces path in artifact | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-022 | `@solana-mobile/wallet-adapter-mobile` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 2.3.0 unchanged | via React Native tooling | transitive | wallet-adapter-react → mobile adapter | no | wallet adapter may run; propagated vulnerable tooling does not | no braces path in artifact | NOT RUNTIME REACHABLE | `51a`, `52`, `66`, `70` |
| SC-023 | `@solana-mobile/wallet-standard-mobile` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 0.6.0 unchanged | via protocol/React Native tooling | transitive | mobile adapter → wallet standard mobile | no | vulnerable tooling branch absent | no braces path in artifact | NOT RUNTIME REACHABLE | `51a`, `52`, `66` |
| SC-024 | `@next/eslint-plugin-next` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 16.3.4 unchanged | via fast-glob/micromatch/braces | transitive dev | eslint-config-next → plugin | major suggestion | LINT only; 0 runtime artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-025 | `eslint-config-next` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 16.3.4 unchanged | via plugin/fast-glob | direct dev | root dev dependency | major suggestion | LINT only; 0 runtime artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-026 | `fast-glob` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 3.3.1/3.3.3 unchanged | via micromatch/braces | transitive dev/build | ESLint/Tailwind tooling | major suggestion | BUILD/LINT only; 0 runtime artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-027 | `chokidar` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 3.6.0 unchanged | via braces | transitive dev | Tailwind → chokidar | Tailwind major suggestion | BUILD watcher only; 0 runtime artifact | no deployed path | NOT RUNTIME REACHABLE | `52`, `66` |
| SC-028 | `tailwindcss` | HIGH propagated | `GHSA-vfj7-8cjw-p6xm` | 3.4.19 unchanged | via chokidar/fast-glob/micromatch | direct dev | root dev dependency | major suggestion | BUILD only; 1 build-cache reference | no deployed request path | NOT RUNTIME REACHABLE | `52`, `66` |

Evidence numbers refer to files in `zswap-local/evidence/supply-chain-disposition-20261007T153104Z/`.

## Required disposition matrix

| Advisory | Severity | Package | Chain | Runtime | Exploitable | Fix | Action | Residual Risk | Release Status |
|---|---|---|---|---|---|---|---|---|---|
| `GHSA-pqg4-j6r4-53mv` | CRITICAL | shell-quote | Solana mobile → RN → devtools | absent after fix | NO after fix | 1.11.0+ | 1.12.0 installed | future transitive drift | CLOSED |
| `GHSA-wq5f-xc86-pv6w` | HIGH | sharp | Next server | server | NO after fix | 0.35.5 | 0.35.5 installed | normal image parser exposure remains, advisory removed | CLOSED |
| `GHSA-68fv-2mgg-jv7q` | HIGH | source-map-js | Next/PostCSS | build only | NO after fix | 1.2.2 | 1.2.2 installed | build input only | CLOSED |
| `GHSA-vfj7-8cjw-p6xm` | HIGH | braces and 19 omit-dev propagations | Solana mobile → RN → Metro/Jest → micromatch | absent from client/server/edge | NO in deployed web artifact | no patched release | narrow fail-closed exception; non-runtime disposition | tooling DoS remains possible if that tooling is run on attacker-controlled glob input | CONDITIONAL — independent review before RC |
| `GHSA-vfj7-8cjw-p6xm` | HIGH | 5 additional full-audit propagations | Tailwind/ESLint build tooling | build/lint only | NO in deployment | no patched release | same narrow exception | local/CI tooling DoS surface | CONDITIONAL — independent review before RC |

## SHELL-QUOTE CRITICAL

- **Advisory:** `GHSA-pqg4-j6r4-53mv`, npm source `1241332`.
- **CWE:** CWE-78.
- **Baseline version:** `1.10.0`.
- **Fixed version:** `1.11.0`; selected final version `1.12.0` within the parent-supported `^1.6.1` range.
- **Dependency chains:** `@solana/wallet-adapter-react` → `@solana-mobile/wallet-adapter-mobile` → React Native → `react-devtools-core` → `shell-quote`. `npm explain` proved all installed paths.
- **Vulnerable API:** `quote()` when a token following `{ comment }` contains a line terminator.
- **Runtime presence:** zero references in final client, server, edge and build artifacts.
- **Attacker-controlled input:** no Z-SWAP call path to `shell-quote` was found.
- **Safe PoC:** the baseline library transformed the malicious token without executing a shell (`VULNERABLE_LIBRARY_BEHAVIOR=YES`); `1.12.0` rejects it with an exception. No command was executed.
- **Remediation:** supported transitive update, no override and no parent major.
- **After audit:** CRITICAL 0 in full and omit-dev audits.
- **Regression:** wallet/security 187/187, provider imports, full suite 4,674/4,674, build PASS.
- **Final disposition:** `REMEDIATED`.

## Changes made

1. `package-lock.json`: supported transitive updates only:
   - `shell-quote` 1.10.0 → 1.12.0;
   - `sharp` 0.35.4 → 0.35.5;
   - platform-specific sharp packages 0.35.4 → 0.35.5;
   - sharp libvips packages 1.3.3 → 1.3.4;
   - `source-map-js` 1.2.1 → 1.2.2.
2. `scripts/release/audit-exceptions.json`: the existing temporary `braces` chain was refreshed for the current npm advisory graph; `corrigido=false` and pre-RC review remain mandatory.
3. `src/lib/release/fixtures/npm-audit-r03-20261004.json`: refreshed with the exact current full audit.
4. `src/lib/release/audit-gate.test.ts`: locked review date and new lock hash. The fail-closed behavior remains covered by 9 tests.

No dependency was moved between production/dev scopes. No package was suppressed. No audit setting changed. No `npm audit fix --force`, override or major migration was used.

## Verification

- `npm ci`: PASS on Node 24.21.0/npm 11.19.0; lock unchanged.
- Type-check: PASS after an explicitly diagnosed first-run V8 heap OOM; isolated run used a 1.9 GiB heap.
- Lint: PASS, 0 errors and 145 pre-existing warnings.
- Audit gate: 9/9 tests PASS and current audit report accepted only by the exact temporary chain.
- Wallet/security: 14 files, 187 tests PASS.
- Wallet provider smoke: wagmi, MetaMask, WalletConnect, Coinbase, Phantom, Solflare and Solana React exports PASS; no network or transaction.
- Founders: 21 files, 287 tests PASS.
- Full suite: 314 files, 4,674 tests PASS.
- Production build: PASS.
- Economics: deterministic regeneration, no diff.
- Migrations: unchanged.
- Founders product/economics: unchanged.
- Secret scan over campaign diff: 0 suspect matches.

The first full-suite run failed only because the slim Node image lacks `git`, used by two repository-integrity tests. That log is preserved. The corrected Node 24 + Git run passed 4,674/4,674 without product changes. The first baseline `npm ci` also failed with `ECONNRESET`; a 3/3 registry preflight passed and the subsequent justified install passed. Neither failure was discarded or reclassified as product success.

## Open risks

1. `braces <=3.0.3` remains installed and vulnerable in mobile/build tooling. The deployment-artifact disposition is strong but must be independently reviewed before RC.
2. `npm sbom` and `npm ls --omit=dev --all` exit nonzero because `use-sync-external-store@1.2.0` declares React support only through 18 while the lock uses React 19.2.8. Install, tests and build pass; this peer metadata issue remains open.
3. Final audits retain 40 moderate (full) and 37 moderate (omit-dev), outside this campaign's CRITICAL/HIGH objective.
4. Lint retains 145 warnings with zero errors.
5. Provider export smoke and mocked regressions do not send real wallet transactions, by design.

## Release security verdict

**CONDITIONAL.** CRITICAL is zero, the reachable fixed HIGH packages were remediated, and no residual HIGH path appears in the production artifacts. Independent audit must accept the non-runtime disposition for `braces` before the temporary exception can be reconsidered. This document does not authorize deploy, release or production changes.
