import { notFound } from "next/navigation";
import { lerConfigCorp } from "@/lib/admin/corp/config";
import { janelaBreakglass } from "@/lib/admin/corp/fluxo";
import BotaoBreakglass from "./BotaoBreakglass";
import { caixa } from "../estilo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emergência", robots: { index: false, follow: false } };

/** Break-glass (design §6): só em `corp` e com a janela do dono aberta (`ADMIN_BREAKGLASS_UNTIL`). */
export default function Page() {
  const c = lerConfigCorp();
  if (!c.ok || c.cfg.modo !== "corp" || !janelaBreakglass(process.env).aberta) notFound();
  return <main style={caixa}><BotaoBreakglass /></main>;
}
