import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import AppShell from "@/components/layout/AppShell";
import ClientErrorReporter from "@/components/telemetry/ClientErrorReporter";

const syne = Syne({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

// metadataBase: where Next.js resolves relative OG image paths from.
// ⚠️ NEVER use VERCEL_URL here: that's the per-deployment UNIQUE url
// (swap-z-app-<hash>.vercel.app), which Vercel protects behind auth — link
// scrapers (WhatsApp/Telegram/Twitter) got a 401 on og:image and showed NO
// preview at all. Use the PUBLIC production alias instead: explicit env
// override first, then Vercel's production-domain system var, then the
// hardcoded public alias.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ??
  "https://swap-z-app.vercel.app";

const TITLE       = "Z-SWAP — The Liquidity Nexus";
const DESCRIPTION =
  "Solana-native DEX aggregator with ZION AI advisory, autopilot trading, and CEX-bridged arbitrage. Solana plus 10 EVM chains, 132 functions, one intelligent liquidity layer.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:  TITLE,
    template: "%s · Z-SWAP",
  },
  description: DESCRIPTION,
  applicationName: "Z-SWAP",
  authors: [{ name: "Zettaword", url: "https://zettaword.global" }],
  generator: "Next.js",
  keywords: [
    "dex", "swap", "z-swap", "zetta", "zion ai", "liquidity",
    "cross-chain", "defi", "multi-chain", "autopilot", "arbitrage",
    "metamask", "phantom", "uniswap", "0x", "lifi", "pix", "onramp",
  ],

  // OpenGraph — opengraph-image.tsx supplies the image automatically.
  openGraph: {
    type:       "website",
    siteName:   "Z-SWAP",
    title:      TITLE,
    description: DESCRIPTION,
    url:        SITE_URL,
    locale:     "en_US",
    alternateLocale: ["pt_BR", "es_ES", "zh_CN"],
  },

  // Twitter — twitter-image.tsx supplies the image automatically.
  twitter: {
    card:        "summary_large_image",
    title:       TITLE,
    description: DESCRIPTION,
    creator:     "@zettaword",
    site:        "@zettaword",
  },

  // Browsers + crawlers
  robots: {
    index:    true,
    follow:   true,
    noimageindex: false,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // iOS / Android home-screen integration
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Z-SWAP",
  },

  formatDetection: {
    telephone: false,
    email:     false,
    address:   false,
  },

  // Discovery + verification slots — wire these up later by setting the
  // matching env var on Vercel without code changes.
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#02030A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body className="font-sans antialiased min-h-screen">
        <ClientErrorReporter />
        <Providers><AppShell>{children}</AppShell></Providers>
      </body>
    </html>
  );
}
