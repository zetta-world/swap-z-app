import type { Metadata } from "next";
import AboutView from "@/components/about/AboutView";
import { modeloDaVitrine } from "@/lib/ai/vitrine";

export const metadata: Metadata = {
  title: "About · Z-SWAP",
  description:
    "Technical whitepaper for Z-SWAP — architecture, real integrations (0x, LiFi, Jupiter, CCXT, Kimi, GoPlus), and non-custodial posture.",
  openGraph: {
    title: "About Z-SWAP — The Liquidity Nexus",
    description:
      "Multi-chain DEX aggregator with ZION AI advisory. Architecture, integrations, and tech stack.",
  },
};

export default function Page() {
/**
 * ⚠️ O nome do modelo vem de `modeloDaVitrine()`, no servidor — a mesma
 * `aiAtivo()` que a rota do ZION usa. Nenhuma tela escreve o nome à mão.
 */
  return <AboutView modelo={modeloDaVitrine().nome} />;
}
