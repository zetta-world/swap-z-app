import { NextRequest } from "next/server";
import { logSecurity } from "@/lib/admin/track";
import { segredoWebhook } from "@/lib/early-access/email/config";
import { assinaturaValida, lerEvento, CORPO_MAX } from "@/lib/early-access/email/webhook";
import { registrarWebhook } from "@/lib/early-access/store";
import { lerCorpoLimitado } from "@/lib/early-access/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/early-access/webhook/resend — bounce e complaint (D-10).
 *
 * ⚠️⚠️ WEBHOOK NÃO AUTENTICADO NÃO MUDA ESTADO. Sem
 * `EARLY_ACCESS_RESEND_WEBHOOK_SECRET` válido, ou com assinatura Svix que não
 * bate, ou com timestamp fora de ±5 min: 401 e NADA é lido além dos
 * cabeçalhos. O corpo só é parseado depois da assinatura.
 *
 * Idempotente: reentrega do mesmo `svix-id` devolve 200 sem efeito novo (o
 * banco guarda o id em `early_access_webhook_eventos`).
 *
 * `email.bounced` / `email.complained` → a inscrição para de receber email
 * (supressão + evento). Outros tipos → registrados como `ignorado`.
 *
 * ⚠️ NÃO depende do gate público: o webhook só pode RESTRINGIR (suprimir
 * envio), nunca abrir, e o provider reentrega por dias — perder um bounce
 * porque o gate está fechado só pioraria a reputação do remetente.
 *
 * Erro de banco → 500, para o provider reentregar.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const segredo = segredoWebhook();
  if (!segredo) return json({ ok: false, error: "unauthorized" }, 401);

  const corpo = await lerCorpoLimitado(req, CORPO_MAX);
  if (!corpo.ok) return json({ ok: false, error: "invalid_body" }, corpo.motivo === "grande_demais" ? 413 : 400);

  const id = req.headers.get("svix-id");
  if (!assinaturaValida({
    segredo, id, timestamp: req.headers.get("svix-timestamp"), assinaturas: req.headers.get("svix-signature"),
    corpo: corpo.texto, agoraS: Math.floor(Date.now() / 1000),
  })) {
    logSecurity("early_access_webhook_assinatura_invalida", {}, "med");
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const ev = lerEvento(corpo.texto);
  if (!ev || !id) return json({ ok: false, error: "invalid_body" }, 400);

  const r = await registrarWebhook(id, ev.tipo, ev.messageId);
  if (r === null) {
    logSecurity("early_access_webhook_banco_falhou", {}, "high");
    return json({ ok: false, error: "unavailable" }, 500);
  }
  if (r === "processado") logSecurity("early_access_email_suprimido", { tipo: ev.tipo }, "low");
  return json({ ok: true, result: r }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
