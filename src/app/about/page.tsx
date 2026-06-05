import type { Metadata } from "next";
import AppShell from "@/components/layout/AppShell";
import AboutView from "@/components/about/AboutView";

export const metadata: Metadata = {
  title: "About · Z-SWAP",
  description:
    "Technical whitepaper for Z-SWAP — architecture, real integrations (0x, LiFi, Jupiter, CCXT, Anthropic, GoPlus), and non-custodial posture.",
  openGraph: {
    title: "About Z-SWAP — The Liquidity Nexus",
    description:
      "Multi-chain DEX aggregator with ZION AI advisory. Architecture, integrations, and tech stack.",
  },
};

export default function Page() {
  return (
    <AppShell>
      <AboutView />
    </AppShell>
  );
}
