/** @type {import('next').NextConfig} */

// Security headers applied to every route.
// We intentionally allow inline-style (Tailwind injects CSS-in-JS at build,
// some Radix primitives use inline style), Google Fonts, and connect-src to
// the public APIs we use (GeckoTerminal, DexScreener, GoPlus, Honeypot.is,
// Anthropic) + EIP-1193 RPCs for wagmi.

const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",       // Next.js dev/prod needs unsafe-eval for fast refresh + RSC
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https: wss:",                         // wagmi+walletconnect needs wss + RPC over https
  "worker-src 'self' blob:",
  // frame-src whitelist for embedded iframes. Defaults to 'self' so we
  // never accidentally allow a malicious origin to embed inside us, but
  // we have to opt-in each legitimate partner explicitly:
  //   - walletconnect / reown — WC v2 verification + pairing iframe
  //   - transak — fiat onramp + offramp widget (BUY/SELL via PIX)
  "frame-src 'self' https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://*.transak.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy",         value: ContentSecurityPolicy },
  { key: "X-Frame-Options",                  value: "DENY"                },
  { key: "X-Content-Type-Options",           value: "nosniff"             },
  { key: "Referrer-Policy",                  value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",               value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security",        value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control",           value: "on"                  },
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
    optimizePackageImports: ["lucide-react", "@radix-ui/react-dialog", "framer-motion"],
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

export default nextConfig;
