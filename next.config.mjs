/** @type {import('next').NextConfig} */
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  // Set ANALYZE=true to produce an interactive bundle map in .next/analyze/.
  // Usage: ANALYZE=true npm run build
  enabled: process.env.ANALYZE === "true",
});


// Security headers applied to every route.
//
// Threat model:
//   - XSS via malicious token metadata (3rd-party DEX listings can carry
//     attacker-controlled text in name/symbol). Mitigated by React's
//     default escaping + CSP defaults.
//   - Cross-origin embedding / framejack: blocked by frame-ancestors 'none'
//     AND the legacy X-Frame-Options: DENY.
//   - Mixed-content downgrades: HSTS preload (2y) + upgrade-insecure-requests.
//   - Cross-origin data theft (Spectre, COOP/COEP): new headers added below.
//
// What's intentionally permissive and why:
//   - script-src 'unsafe-inline'   — Next.js boot script + per-page hydration
//                                    payload. Cannot be removed without
//                                    nonces, which App Router doesn't expose
//                                    in middleware-safe form yet.
//   - script-src 'unsafe-eval'     — wagmi + viem need it for some ABI
//                                    encoding paths; ZION JSON parsing
//                                    doesn't (we explicitly never eval the
//                                    model output). Kept in DEV always
//                                    (HMR/Refresh need it); guarded in PROD.
//   - style-src 'unsafe-inline'    — Tailwind + Radix inline styles.
//   - connect-src https: wss:      — wagmi connects to every chain's RPC
//                                    + WalletConnect relay. Whitelisting
//                                    per-chain would be a maintenance burden
//                                    with no real security gain (the RPCs
//                                    are public read-only).

const IS_DEV = process.env.NODE_ENV !== "production";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  // unsafe-eval ONLY in development (Next.js HMR needs it). In production
  // builds we deliberately drop it — wagmi/viem produce ABI bytecode via
  // BigInt arithmetic rather than eval, and ZION's JSON parser never
  // touches eval/Function. Stripping it tightens the XSS blast radius if
  // a 3rd-party listing ever sneaks <script> through React's escaping.
  IS_DEV ? "'unsafe-eval'" : "",
].filter(Boolean).join(" ");

const ContentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  // Iframe whitelist — every external partner that legitimately embeds
  // inside Z-SWAP needs an explicit entry. Default deny.
  //   - walletconnect / reown — WC v2 verification + pairing iframe
  //   - transak — fiat onramp + offramp widget (BUY/SELL via PIX)
  "frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://*.transak.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  // Report any violation to our endpoint — surfaces drift the moment a
  // new partner integration ships before someone files a bug.
  "report-uri /api/security/csp-report",
  "report-to csp-endpoint",
].join("; ");

// Reporting-API config — modern browsers prefer this over report-uri. We
// keep both so legacy Chrome/Safari that only understand report-uri still
// reach us, and modern browsers use the structured Reports API.
const ReportTo = JSON.stringify({
  group:    "csp-endpoint",
  max_age:  10886400,
  endpoints: [{ url: "/api/security/csp-report" }],
});

const securityHeaders = [
  { key: "Content-Security-Policy",       value: ContentSecurityPolicy },
  { key: "Report-To",                      value: ReportTo              },
  { key: "X-Frame-Options",                value: "DENY"                },
  { key: "X-Content-Type-Options",         value: "nosniff"             },
  { key: "Referrer-Policy",                value: "strict-origin-when-cross-origin" },
  // Permissions-Policy: opt-out of every powerful browser API we don't
  // use. Adds geo/usb/serial/hid/bluetooth/payment etc. to the existing
  // camera/mic/geolocation/FLoC lockdown.
  { key: "Permissions-Policy",             value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "interest-cohort=()",      // legacy FLoC opt-out
      "browsing-topics=()",       // Topics API opt-out
      "usb=()",
      "serial=()",
      "hid=()",
      "bluetooth=()",
      "payment=(self https://*.transak.com)",  // Transak widget needs payment for PIX confirmation
      "fullscreen=(self)",
      "picture-in-picture=()",
      "screen-wake-lock=()",
      "magnetometer=()",
      "gyroscope=(self https://*.transak.com)",
      "accelerometer=(self https://*.transak.com)",
    ].join(", ") },
  { key: "Strict-Transport-Security",      value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control",         value: "on"                  },
  // Cross-origin isolation: prevents other origins from poking at our
  // window via window.opener / window.parent, and prevents loading our
  // resources cross-origin without explicit CORS opt-in. Tightens
  // against Spectre-class side channels.
  //
  // Note: COEP "require-corp" would break Transak's iframe (their assets
  // are not served with Cross-Origin-Resource-Policy headers). We
  // intentionally use "credentialless" which is the modern, safer fallback
  // that doesn't require the embedded partner to opt in.
  { key: "Cross-Origin-Opener-Policy",     value: "same-origin"         },
  { key: "Cross-Origin-Embedder-Policy",   value: "credentialless"      },
  { key: "Cross-Origin-Resource-Policy",   value: "same-origin"         },
  // Origin-Agent-Cluster: hint to the browser to isolate this origin in
  // its own agent cluster so a sibling origin compromise can't poke at
  // our heap via shared workers.
  { key: "Origin-Agent-Cluster",           value: "?1"                  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,                  // Hide X-Powered-By: Next.js
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
    ],
    // ccxt is a huge runtime-only package (3+MB with all 100+ exchange
    // adapters and their crypto deps). Forcing it through webpack pulls in
    // optional deps for exchanges we don't use (dydx-v4 protobuf, etc.).
    // External-ize it so the route handler `require()`s it from node_modules
    // at runtime instead.
    serverComponentsExternalPackages: ["ccxt"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
