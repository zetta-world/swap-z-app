import { notFound } from "next/navigation";
import { lerConfigCorp } from "@/lib/admin/corp/config";
import BotaoSair from "./BotaoSair";
import { caixa } from "../estilo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sair", robots: { index: false, follow: false } };

export default function Page() {
  if (!lerConfigCorp().ok) notFound();
  return <main style={caixa}><BotaoSair /></main>;
}
