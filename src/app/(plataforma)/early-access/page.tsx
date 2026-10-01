import type { Metadata } from "next";
import EarlyAccessView from "@/components/early-access/EarlyAccessView";
import { lerGateEarlyAccess } from "@/lib/early-access/gate";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/early-access/legal-versions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Early access · Z-SWAP",
  description: "Z-SWAP early access list. Not an investment, a purchase or a reservation of any asset.",
};

/**
 * ⚠️ O GATE É LIDO NO SERVIDOR, a cada requisição. O formulário só é enviado
 * ao navegador quando o gate está ABERTO; fechado, a página mostra "em breve"
 * e não existe formulário que prometa uma inscrição que a rota recusaria.
 * Na Fase 1 ele está sempre fechado (docs/PLANO-EARLY-ACCESS.md §5).
 */
export default async function Page() {
  const gate = await lerGateEarlyAccess();
  return (
    <EarlyAccessView
      aberto={gate.aberto}
      termsVersion={TERMS_VERSION}
      privacyVersion={PRIVACY_VERSION}
    />
  );
}
