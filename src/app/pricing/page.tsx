import type { Metadata } from "next";
import PricingView from "@/components/pricing/PricingView";

export const metadata: Metadata = {
  title: "Pricing · Z-SWAP Access Pass",
  description:
    "Z-SWAP Access Pass — NFT lifetime tiers (Pro / Trader / Pilot). 3 years of premium plus eternal Founder status. Utility NFT, non-custodial, not a financial instrument.",
  openGraph: {
    title: "Z-SWAP Access Pass — premium for 3 years, Founder forever",
    description:
      "Buy once. Premium benefits run for 3 years; Founder status is eternal. Pro 1.5 SOL · Trader 4 SOL · Pilot 30 SOL.",
  },
};

export default function Page() {
  return <PricingView />;
}
