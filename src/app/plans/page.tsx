import type { Metadata } from "next";
import NormalPlansView from "@/components/pricing/NormalPlansView";

export const metadata: Metadata = {
  title: "Planos · Z-SWAP",
  description:
    "Planos de assinatura mensal Z-SWAP — os guerreiros (Drengr / Berserkr / Einherjar) que servem aos deuses. Acesso premium recorrente sem NFT. Preço em USD, pago em SOL.",
  openGraph: {
    title: "Z-SWAP — planos de assinatura mensal",
    description:
      "Acesso premium recorrente. Os guerreiros que servem aos deuses. Preço fixo em USD, pago em SOL na cotação.",
  },
};

export default function Page() {
  return <NormalPlansView />;
}
