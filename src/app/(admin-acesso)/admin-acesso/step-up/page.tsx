import { notFound } from "next/navigation";
import { lerConfigCorp } from "@/lib/admin/corp/config";
import { voltaSegura } from "@/lib/admin/corp/selo";
import FormStepUp from "./FormStepUp";
import { caixa } from "../estilo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar identidade", robots: { index: false, follow: false } };

/** Ações sensíveis exigem TOTP dos últimos 5 min (design §4.5). Sem ele o Admin responde 404 à ação. */
export default async function Page({ searchParams }: { searchParams: Promise<{ volta?: string }> }) {
  if (!lerConfigCorp().ok) notFound();
  const sp = await searchParams;
  return <main style={caixa}><FormStepUp volta={voltaSegura(sp.volta)} /></main>;
}
