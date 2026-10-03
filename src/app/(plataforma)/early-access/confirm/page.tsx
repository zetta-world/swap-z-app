import type { Metadata } from "next";
import ConfirmView from "@/components/early-access/ConfirmView";
import { lerGateEarlyAccess } from "@/lib/early-access/gate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm email · Z-SWAP early access",
  // ⚠️ o token mora no fragmento (#t=…), que nunca vai no Referer; isto é
  // defesa em profundidade para qualquer navegação a partir desta página.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * /early-access/confirm#t=<token> — destino do link do email (Fase 2).
 *
 * ⚠️ ESTA PÁGINA NÃO MUDA NADA. Abrir o link (inclusive por scanner de email
 * que faz GET) não confirma nem apaga: o servidor nem vê o token, que mora no
 * fragmento. Só o clique do titular dispara o POST para `/api/early-access/verify`.
 *
 * Gate fechado → mesma tela "em breve" do formulário (nada a confirmar).
 */
export default async function Page() {
  const gate = await lerGateEarlyAccess();
  return <ConfirmView aberto={gate.aberto} />;
}
