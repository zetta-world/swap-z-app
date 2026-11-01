import { notFound } from "next/navigation";
import { lerConfigCorp } from "@/lib/admin/corp/config";
import { voltaSegura } from "@/lib/admin/corp/selo";
import FormMfa from "./FormMfa";
import { caixa } from "../estilo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificação", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ volta?: string }> }) {
  if (!lerConfigCorp().ok) notFound();
  const sp = await searchParams;
  return <main style={caixa}><FormMfa volta={voltaSegura(sp.volta)} /></main>;
}
