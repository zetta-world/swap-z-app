import type { ConfigEmail } from "./config";
import type { MensagemEmail, ResultadoEnvio } from "./provedor";

/**
 * ADAPTADOR RESEND — `fetch` puro, sem SDK (zero pacote novo).
 *
 * POST https://api.resend.com/emails com `Idempotency-Key`: a mesma chave
 * reenviada não gera um segundo email (retry de rede não duplica).
 *
 * ⚠️ TRACKING. Click/open tracking do Resend é configuração do DOMÍNIO no
 * painel e tem de ficar DESLIGADO (D-2): click tracking reescreve o link e
 * levaria o token para os logs do provider. Não há como forçar isso por aqui;
 * está no RUNBOOK como pré-requisito do envio real.
 *
 * ⚠️ NADA DA RESPOSTA SAI DAQUI além do id — ver `provedor.ts`.
 */
export const RESEND_URL = "https://api.resend.com/emails";
export const TIMEOUT_MS = 8_000;
const ID_FORMATO = /^[!-~]{1,200}$/;

export async function enviarResend(
  cfg: ConfigEmail, msg: MensagemEmail, chaveIdempotencia: string,
): Promise<ResultadoEnvio> {
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization:     `Bearer ${cfg.apiKey}`,
        "Content-Type":    "application/json",
        "Idempotency-Key": chaveIdempotencia,
      },
      body: JSON.stringify({
        from: cfg.from, to: [msg.para], subject: msg.assunto, text: msg.texto, html: msg.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, codigo: "rede", transitorio: true };
  }

  if (res.ok) {
    let id: unknown;
    try { id = ((await res.json()) as { id?: unknown })?.id; } catch { id = undefined; }
    return typeof id === "string" && ID_FORMATO.test(id)
      ? { ok: true, id }
      : { ok: false, codigo: "resposta_invalida", transitorio: false };
  }
  // corpo de erro descartado sem ler para log
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 401 || res.status === 403) return { ok: false, codigo: "config", transitorio: false };
  if (res.status === 429) return { ok: false, codigo: "rate_limited", transitorio: true };
  if (res.status >= 500) return { ok: false, codigo: "provider_5xx", transitorio: true };
  return { ok: false, codigo: "rejeitado", transitorio: false };
}
