import type { Metadata } from "next";
import NormalPlansView from "@/components/pricing/NormalPlansView";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

export const metadata: Metadata = {
  title: "A Hird · Z-SWAP",
  description:
    "A Hird — o bando juramentado que serve aos deuses. Assinatura mensal Z-SWAP (Drengr / Berserkr / Einherjar), premium recorrente sem NFT. Preço em USD, pago em SOL.",
  openGraph: {
    title: "Z-SWAP — A Hird · assinatura mensal",
    description:
      "Os juramentados que servem aos deuses do Panteão. Premium recorrente, preço fixo em USD, pago em SOL na cotação.",
  },
};

export default function Page() {
/**
 * ⚠️ O NOME DO MODELO VEM DO SERVIDOR, de `modeloDaVitrine()` — a mesma
 * `aiAtivo()` que a rota do ZION usa para chamar o modelo. A vitrine não tem
 * fonte própria, então não tem como divergir do produto.
 */
  return <NormalPlansView modelo={modeloDaVitrine().nome} />;
}
