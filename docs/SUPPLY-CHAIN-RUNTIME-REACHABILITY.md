# Z-SWAP — SUPPLY CHAIN RUNTIME REACHABILITY

Candidate: `63326edb6d4cd3f6f95be8fc77b9d0382db91dc0`
Tree: `3cb3affc8da4472b360984274d459157c2faec44`
Build runtime: Node 24.21.0 / npm 11.19.0
Evidence: `zswap-local/evidence/supply-chain-disposition-20261007T153104Z/`

## Method

The reachability result combines four independent observations:

1. `npm explain`/`npm ls` prove every installed parent chain.
2. Source inspection identifies the actual import boundary: Z-SWAP uses `@solana/wallet-adapter-react`; its provider imports the mobile adapter, while the vulnerable `braces` path is imported by `micromatch`, and the relevant `micromatch` importer is Metro's file watcher.
3. A clean Next production build was generated from the exact candidate.
4. Every `.next` file was scanned for exact `node_modules/<package>/` path references and classified as CLIENT, SERVER, EDGE, BUILD or OTHER. This avoids false matches on generic words.

Exact path absence alone is not treated as conclusive for minified client code. The conclusion also depends on the static importer chain: `braces` is reached by Metro/Jest/build file tooling, not by the mobile adapter's browser execution path. The full build and wallet regressions corroborate tree-shaking and compatibility.

## Artifact result

| Package/group | Client | Server | Edge | Build/cache | Finding |
|---|---:|---:|---:|---:|---|
| shell-quote | 0 | 0 | 0 | 0 | absent; final graph is patched 1.12.0 |
| braces | 0 | 0 | 0 | 0 | vulnerable root absent |
| micromatch | 0 | 0 | 0 | 0 | vulnerable parent absent |
| React Native + RN CLI | 0 | 0 | 0 | 0 | mobile/tooling branch absent |
| Metro packages | 0 | 0 | 0 | 0 | mobile bundler branch absent |
| Jest packages propagated by RN | 0 | 0 | 0 | 0 | test tooling branch absent |
| Solana mobile packages listed by audit | 0 | 0 | 0 | 0 | no exact package-path trace; web wallet exports still pass |
| sharp 0.35.5 | 0 | 34 | 0 | 9 | real server runtime dependency, patched |
| source-map-js 1.2.2 | 0 | 0 | 0 | 8 | build-only, patched |
| Tailwind CSS | 0 | 0 | 0 | 1 | build-only |
| ESLint/Next lint packages | 0 | 0 | 0 | 0 | lint-only, not deployment |

The scan is preserved in `66-final-exact-artifact-scan.tsv` and tied to `.next/BUILD_ID` by SHA-256.

## CLIENT

- No exact reference to `shell-quote`, `braces`, `micromatch`, React Native, Metro or Jest appears in `.next/static`.
- App source has no direct import of `braces` or `micromatch`; the only source occurrences are release-gate fixtures/tests.
- Solana remains supported. `@solana/wallet-adapter-react`, Phantom and Solflare import/export smoke passed. No dependency was removed.
- EVM remains supported. wagmi plus MetaMask, WalletConnect and Coinbase connector exports passed.
- **Disposition:** PASS for the remediated packages and `NOT_RUNTIME_REACHABLE` for the residual braces branch.

## SERVER / SERVERLESS

- `sharp@0.35.5` is present in 34 Next NFT traces and is a real server dependency. It was upgraded rather than waived.
- `source-map-js`, shell-quote and the residual braces chain have zero server trace references.
- **Disposition:** PASS.

## EDGE

- No CRITICAL/HIGH package from the baseline inventory appears in middleware/edge artifacts.
- **Disposition:** PASS.

## BUILD

- `source-map-js@1.2.2` appears only in 8 build/cache files.
- `tailwindcss@3.4.19` appears in one cache file.
- `sharp@0.35.5` appears in build/cache plus runtime NFT traces.
- The residual braces chain has zero exact build-output references even though it remains installed in the dependency graph.
- **Disposition:** patched where a safe patch exists; `braces` remains a tooling risk with no upstream fixed release.

## MOBILE-ONLY / TOOLING

The root production dependency chain is:

`@solana/wallet-adapter-react` → `@solana-mobile/wallet-adapter-mobile` → React Native → CLI/Metro/Jest → `micromatch` → `braces`.

`WalletProvider.js` imports the mobile adapter. That fact does not make all of React Native's CLI/tooling dependencies browser-reachable. The vulnerable path is specifically Metro's file watcher importing `micromatch`, whose entry imports `braces`. Neither Metro, its watcher, micromatch nor braces is present in the production build.

- **Attacker input required by advisory:** a deeply nested glob pattern passed to braces/micromatch.
- **Observed Z-SWAP web path:** none.
- **Residual environment:** local/mobile/CI tooling if someone runs that tooling with attacker-controlled glob patterns.
- **Disposition:** `NOT_RUNTIME_REACHABLE` for the deployed web application; independent review required.

## TEST

Jest packages are installed only because of the React Native tooling branch. Z-SWAP's active test runner is Vitest. Jest/Metro packages are absent from deployment artifacts.

## Exact package dispositions

| Packages | Location | Attacker-controlled input | Production artifact | Disposition |
|---|---|---|---|---|
| shell-quote 1.12.0 | transitive mobile tooling | no app path | absent | REMEDIATED |
| sharp 0.35.5 | Next server | image data may be processed | present server | REMEDIATED |
| source-map-js 1.2.2 | PostCSS/Next build | build source maps | build only | REMEDIATED |
| braces 3.0.3, micromatch 4.0.8 | Metro/Tailwind/ESLint tooling | no web request path | absent | NOT RUNTIME REACHABLE |
| React Native / Metro / Jest propagated rows | mobile build/test tooling | no web request path | absent | NOT RUNTIME REACHABLE |
| Tailwind/ESLint propagated rows | build/lint | repository-controlled patterns | absent from deployment | NOT RUNTIME REACHABLE |

## Limits of proof

- No real wallet transaction or production call was made.
- No mobile React Native artifact was built; the product under certification is the Z-SWAP Next web deployment.
- A future dependency, Next, Solana adapter or bundler update can invalidate the result. The narrow audit gate intentionally fails on any chain drift.
- The temporary exception cannot be made permanent from this report alone.
