# Lighthouse Baseline — Z-SWAP

> Captured: 2026-06-05 · FASE 3.1 of the pre-launch polish sprint  
> Environment: Next.js 14.2.35 build output + static code analysis  
> **Note:** Lighthouse requires a running browser session. Scores below are derived from
> code-level analysis of the production build. Full synthetic Lighthouse sweeps should be
> run from Vercel Preview URLs before the grant submission.

---

## Build output (post FASE 1 + 2 merges)

```
Route                           Size        First Load JS
/                               ~6 kB       ~472 kB
/bridge                         ~4 kB       ~470 kB
/buy                            ~3 kB       ~469 kB
/cex                            ~15 kB      ~487 kB
/explorer                       ~12 kB      ~484 kB
/governance                     ~1 kB       ~473 kB
/launchpad                      ~1 kB       ~473 kB
/nft                            ~4 kB       ~476 kB
/orders                         ~6 kB       ~479 kB
/otc                            ~3 kB       ~476 kB
/p2p                            ~4 kB       ~477 kB
/pair/[chain]/[address]         ~9 kB       ~482 kB
/pools                          ~4 kB       ~477 kB
/portfolio                      ~8 kB       ~481 kB
/pro                            ~63 kB      ~535 kB (heaviest route — Pro Terminal)
/settings                       ~10 kB      ~483 kB
/zion                           ~2 kB       ~475 kB

Shared by all                   89.1 kB    (just under 90 kB target ✓)
```

---

## Code-level findings by Lighthouse category

### Performance

| Finding | Status | Action taken |
|---------|--------|--------------|
| Font loading: `display: swap` on all 3 fonts (Syne, DM Sans, DM Mono) | ✓ Already optimal | — |
| `prefers-reduced-motion` media query | ✓ Already present in globals.css | — |
| Pro Terminal (63 kB) is route-specific, not in shared chunks | ✓ No bleed | — |
| `ccxt` (3 MB) externalized — not bundled at all | ✓ Config correct | — |
| `optimizePackageImports` for lucide-react, framer-motion, @radix-ui | ✓ Config correct | — |
| `<img>` tags in ConnectModal and PairView lacked `loading="lazy"` | ⚠ Fixed | Added `loading="lazy"` |
| ExecuteSwapGuard lazily imported in AppShell | ✓ Already dynamic | — |

**Estimated Performance score: 82–90** (mobile, 4G simulated)  
Main bottleneck is the 89 kB shared JS (wagmi + viem + framer-motion + wallet adapters). See 3.2 for tree-shake work.

---

### Accessibility

| Finding | Status | Action taken |
|---------|--------|--------------|
| Skip-to-content link | ✗ Missing | Added `<a class="skip-link" href="#main-content">` in AppShell |
| `<main id="main-content">` target | ✗ Missing | Added `id="main-content"` to `<main>` in AppShell |
| `aria-label` on icon-only buttons | ✓ All labeled (Topbar, MobileNav, SwapCard, PairView) | — |
| `aria-pressed` on toggle buttons | ✓ SwapCard MEV/Privacy toggles | — |
| `<html lang>` attribute dynamically reflects user language | ✗ Was static "en" | Added `LangSync` client component in Providers that sets `document.documentElement.lang` on language change (en→en, pt→pt-BR, es→es, zh→zh-CN) |
| Radix UI modals have focus traps | ✓ Built-in | — |
| Focus ring visible | ✓ 1px cyan, see 3.3 for 2px upgrade | — |
| Decorative images use `alt=""` | ✓ Compliant | — |

**Estimated A11y score: 90–95**  
The skip-to-content link and `lang` attribute fix are the two highest-value improvements.

---

### Best Practices

| Finding | Status | Action taken |
|---------|--------|--------------|
| HTTPS enforced via HSTS preload (2yr) | ✓ | — |
| CSP blocks inline-eval in production | ✓ | — |
| `X-Frame-Options: DENY` | ✓ | — |
| `poweredByHeader: false` | ✓ | — |
| No mixed content | ✓ upgrade-insecure-requests in CSP | — |
| Console errors | None observed in static analysis | — |

**Estimated Best Practices score: 95–100**

---

### SEO

| Finding | Status | Action taken |
|---------|--------|--------------|
| `<meta name="description">` present | ✓ | — |
| OpenGraph (og:title, og:description, og:image) | ✓ via Next.js metadata + opengraph-image.tsx | — |
| Twitter Card (`summary_large_image`) | ✓ via twitter-image.tsx | — |
| `robots: index, follow` | ✓ | — |
| Canonical URL via `metadataBase` | ✓ | — |
| `<html lang>` correct per locale | ✗ Was hardcoded "en" | Fixed (see above) |
| Viewport meta with `width=device-width` | ✓ | — |
| Page titles: `title.template = "%s · Z-SWAP"` | ✓ | — |

**Estimated SEO score: 95–100**

---

## Improvements shipped in this PR

1. **Skip-to-content link** (WCAG 2.4.1 Bypass Blocks): `<a href="#main-content">` in AppShell, styled with `.skip-link` CSS class — invisible until focused via Tab key, then slides down from top of viewport.

2. **`<main id="main-content">`**: The skip link target.

3. **Dynamic `lang` attribute** (`LangSync` component in Providers): Updates `document.documentElement.lang` whenever the user switches language. Maps: en→"en", pt→"pt-BR", es→"es", zh→"zh-CN".

4. **`loading="lazy"`** on wallet adapter icons in ConnectModal (2 img tags) and token avatar in PairView — these images are never LCP candidates, deferring their fetch reduces initial bandwidth.

5. **i18n**: Added `common.skipToContent` key in all 4 locales (en/pt/es/zh).

---

## What requires a live browser to measure

The following can only be audited with real Lighthouse runs against a deployed URL:

- **LCP (Largest Contentful Paint)**: Depends on server response time + TTFB from Vercel edge
- **CLS (Cumulative Layout Shift)**: Can only be measured during real render
- **TBT (Total Blocking Time)**: Requires JavaScript profiling
- **INP (Interaction to Next Paint)**: Requires user interaction simulation
- **Contrast ratios**: Lighthouse checks computed contrast, not just declared CSS values
- **Tap target sizes** (mobile): Requires rendered viewport

**Recommended action before grant submission**:  
Run `npx @lhci/cli autorun --collect.url=https://<your-preview-url> --preset=lighthouse:recommended` against the Vercel preview deploy, targeting all 17 routes at mobile viewport (360×640, 4G throttle).

---

## Tracking table

| Route | Perf (est.) | A11y (est.) | Best Prac. | SEO (est.) | Needs work? |
|-------|-------------|-------------|------------|------------|-------------|
| / | 85 | 93 | 97 | 97 | — |
| /pro | 78 | 93 | 97 | 97 | Bundle (3.2) |
| /pair | 80 | 93 | 97 | 97 | — |
| /cex | 82 | 93 | 97 | 97 | — |
| /portfolio | 83 | 93 | 97 | 97 | — |
| Other 12 | 87–92 | 93 | 97 | 97 | — |

*After 3.3 (A11y) closes, A11y score expected to reach 95–97.*
