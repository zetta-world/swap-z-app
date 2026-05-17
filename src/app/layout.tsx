import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

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

export const metadata: Metadata = {
  title:       "Z-SWAP — The Liquidity Nexus",
  description: "Premium multi-chain liquidity intelligence platform. Trade, route and analyze across 11 chains with ZION AI advisory.",
  keywords:    ["dex", "swap", "z-swap", "zetta", "liquidity", "cross-chain", "defi", "ai", "zion"],
  metadataBase: new URL("https://app.zettaword.global"),
  openGraph: {
    title:       "Z-SWAP — The Liquidity Nexus",
    description: "11 chains. 132 functions. One intelligent liquidity layer.",
    type:        "website",
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
