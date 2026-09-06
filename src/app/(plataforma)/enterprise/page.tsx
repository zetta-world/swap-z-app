import type { Metadata } from "next";
import EnterpriseView from "@/components/enterprise/EnterpriseView";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

export const metadata: Metadata = {
  title: "Enterprise · Z-SWAP",
  description:
    "Z-SWAP Enterprise — non-custodial DeFi infrastructure for institutional flows. Family offices, crypto-native funds, and Brazilian fintechs. Pilot tier + white-label.",
  openGraph: {
    title: "Z-SWAP Enterprise — DeFi infrastructure for institutional flows",
    description:
      "Non-custodial multi-chain execution, ZION advisory and pre-trade security. BR-first, BCB-aligned. Book a conversation.",
  },
};

export default function Page() {
/**
 * ⚠️ O nome do modelo vem de `modeloDaVitrine()`, no servidor — a mesma
 * `aiAtivo()` que a rota do ZION usa. Nenhuma tela escreve o nome à mão.
 */
  return <EnterpriseView modelo={modeloDaVitrine().nome} />;
}
