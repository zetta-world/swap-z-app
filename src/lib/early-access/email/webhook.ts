import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WEBHOOK DO RESEND — verificação de assinatura (Svix) e parse mínimo. Puro.
 *
 * O Resend assina com Svix: `svix-signature` traz um ou mais `v1,<base64>`
 * separados por espaço; o conteúdo assinado é `${svix-id}.${svix-timestamp}.${corpo}`
 * e a chave são os bytes do segredo `whsec_…` decodificado (`config.ts`).
 *
 * ⚠️ SEM ASSINATURA VÁLIDA, NADA. O corpo só é parseado DEPOIS de a assinatura
 * bater, e o timestamp fora de ±5 min é recusado (replay de evento antigo).
 * A idempotência por `svix-id` fica no banco (`early_access_webhook_eventos`).
 *
 * ⚠️ Do payload só sai `type` e `data.email_id`. O endereço e o resto do
 * evento não são lidos nem guardados.
 */
export const TOLERANCIA_S = 300;
export const CORPO_MAX = 64 * 1024;

export function assinaturaValida(p: {
  segredo: Buffer; id: string | null; timestamp: string | null; assinaturas: string | null;
  corpo: string; agoraS: number;
}): boolean {
  const { segredo, id, timestamp, assinaturas, corpo, agoraS } = p;
  if (!id || !timestamp || !assinaturas) return false;
  if (!/^[!-~]{1,100}$/.test(id) || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(agoraS - Number(timestamp)) > TOLERANCIA_S) return false;
  const esperado = createHmac("sha256", segredo).update(`${id}.${timestamp}.${corpo}`).digest();
  for (const parte of assinaturas.split(" ")) {
    const [versao, b64] = parte.split(",", 2);
    if (versao !== "v1" || !b64) continue;
    let dada: Buffer;
    try { dada = Buffer.from(b64, "base64"); } catch { continue; }
    if (dada.length === esperado.length && timingSafeEqual(dada, esperado)) return true;
  }
  return false;
}

export interface EventoWebhook { tipo: string; messageId: string | null }

/** Só depois da assinatura. `null` = corpo que não é um evento do Resend. */
export function lerEvento(corpo: string): EventoWebhook | null {
  let j: unknown;
  try { j = JSON.parse(corpo); } catch { return null; }
  if (typeof j !== "object" || j === null) return null;
  const tipo = (j as { type?: unknown }).type;
  if (typeof tipo !== "string" || !/^[a-z][a-z._]{0,59}$/.test(tipo)) return null;
  const id = (j as { data?: { email_id?: unknown } }).data?.email_id;
  return { tipo, messageId: typeof id === "string" && /^[!-~]{1,200}$/.test(id) ? id : null };
}
