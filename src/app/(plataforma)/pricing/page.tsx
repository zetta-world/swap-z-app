import type { Metadata } from "next";
import PricingView from "@/components/pricing/PricingView";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

export const metadata: Metadata = {
  title: "O Panteão · Z-SWAP Access Pass",
  description:
    "Z-SWAP Access Pass — NFT lifetime tiers (Pro / Trader / Pilot). 3 years of premium plus eternal Founder status. Utility NFT, non-custodial, not a financial instrument.",
  openGraph: {
    title: "O Panteão — Z-SWAP Access Pass · premium for 3 years, Founder forever",
    description:
      "Buy once. Premium benefits run for 3 years; Founder status is eternal. Pro 1.5 SOL · Trader 4 SOL · Pilot 30 SOL.",
  },
};

export default function Page() {
/**
 * ⚠️ O NOME DO MODELO VEM DO SERVIDOR, de `modeloDaVitrine()` — a mesma
 * `aiAtivo()` que a rota do ZION usa para chamar o modelo. A vitrine não tem
 * fonte própria, então não tem como divergir do produto.
 */
  return <PricingView modelo={modeloDaVitrine().nome} />;
}
