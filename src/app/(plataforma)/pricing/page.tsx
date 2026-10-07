import type { Metadata } from "next";
import PricingView from "@/components/pricing/PricingView";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

export const metadata: Metadata = {
  title: "O Panteão · Z-SWAP Access Pass",
  description:
    "Z-SWAP Access Pass — NFT passes (Pro / Trader / Pilot). 36 months of premium from the official close of the sale plus durable Founder status attached to the pass. Utility NFT, non-custodial, not a financial instrument. Pricing being finalized.",
  openGraph: {
    title: "O Panteão — Z-SWAP Access Pass · 36 months of premium, durable Founder status with the pass",
    description:
      "Buy once. Premium benefits run for 36 months from the official close of the sale; durable Founder status is attached to the pass and follows its current holder. Sale date and pricing not announced yet.",
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
