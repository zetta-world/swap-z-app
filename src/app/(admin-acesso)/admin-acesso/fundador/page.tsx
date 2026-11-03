import { notFound } from "next/navigation";
import { lerConfigCorp } from "@/lib/admin/corp/config";
import { lerConfigFundador } from "@/lib/admin/corp/fundador";
import FormFundador from "./FormFundador";
import { caixa } from "../estilo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Governança do Admin", robots: { index: false, follow: false } };

/**
 * SOLO FOUNDER MODE (`docs/ADMIN-SOLO-FOUNDER-MODE.md`): bootstrap único, recuperação de MFA e
 * transição para multi_admin. Sem R1 configurado ou sem `ADMIN_FOUNDER_EMAIL`, a página não existe.
 * Nada aqui decide: quem decide é a rota `/api/admin-auth/fundador` (e a RPC no banco).
 */
export default async function Page() {
  if (!lerConfigCorp().ok || !lerConfigFundador()) notFound();
  return <main style={caixa}><FormFundador /></main>;
}
