import { NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/admin/track";
import { lerGateEarlyAccess } from "@/lib/early-access/gate";
import { ipHmac } from "@/lib/early-access/hmac";
import { hashToken } from "@/lib/early-access/token";
import { validarConfirmacao, LIMITE_CORPO_CONFIRMACAO } from "@/lib/early-access/validate";
import { previewToken, confirmarEmail, recusarEmail } from "@/lib/early-access/store";
import { lerCorpoLimitado, origemPermitida, ehJson } from "@/lib/early-access/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/early-access/verify — o titular do email age com o token do link.
 * Especificação: docs/PLANO-EARLY-ACCESS-FASE2.md §3, §6.
 *
 *   { token, action: "preview" }                    → dados a confirmar (não consome)
 *   { token, action: "confirm", accept_terms_version, acknowledge_privacy_version,
 *     display_name?, country?, marketing_opt_in? }  → prova a posse (uso único)
 *     (as versões são as que a tela apresentou; marketing omitido = sem escolha)
 *   { token, action: "decline" }                    → "não fui eu": apaga o pedido
 *
 * ⚠️ O TOKEN É A AUTORIZAÇÃO. Sem token válido, toda falha é a MESMA resposta
 * `400 invalid_or_expired` (inexistente, expirado, consumido, revogado,
 * inscrição bloqueada…): a rota não ensina nada a quem não tem o link.
 *
 * ⚠️ NÃO EXISTE GET. O link do email abre uma PÁGINA que não muda nada; só o
 * POST disparado por clique muda estado. Scanner de link (Safe Links e afins)
 * que faz GET não confirma nem apaga nada.
 *
 * ⚠️ FAIL-CLOSED: atrás do MESMO gate da inscrição. Fechar o early access em
 * incidente fecha também a confirmação.
 *
 * ⚠️ NADA DO TOKEN EM LOG. Nem o cru, nem o hash.
 *
 * ⚠️ CONFIRMAR NÃO APROVA: só grava a prova de posse. A triagem é do admin.
 */
const LIMITE_IP = { windowMs: 600_000, max: 30 };

export async function POST(req: NextRequest): Promise<Response> {
  if (!ehJson(req)) return json({ ok: false, error: "unsupported_media_type" }, 415);
  const corpo = await lerCorpoLimitado(req, LIMITE_CORPO_CONFIRMACAO);
  if (!corpo.ok) {
    return corpo.motivo === "grande_demais"
      ? json({ ok: false, error: "payload_too_large" }, 413)
      : json({ ok: false, error: "invalid_body" }, 400);
  }
  let bruto: unknown;
  try { bruto = JSON.parse(corpo.texto); } catch { return json({ ok: false, error: "invalid_body" }, 400); }

  const gate = await lerGateEarlyAccess();
  if (!gate.aberto) return json({ ok: false, error: "closed" }, 503);

  if (!origemPermitida(req)) {
    logSecurity("early_access_verify_origem_recusada", {}, "low");
    return json({ ok: false, error: "forbidden_origin" }, 403);
  }

  const v = validarConfirmacao(bruto);
  if (!v.ok) {
    // token malformado é "inválido ou expirado" como qualquer outro: sem dica de formato
    if (v.campo === "token") return invalido();
    return json({ ok: false, error: v.erro, ...(v.campo ? { field: v.campo } : {}) }, 400);
  }
  const d = v.dados;
  const hash = hashToken(d.token);
  if (!hash) return invalido();

  const ipH = ipHmac(getClientId(req.headers));
  if (!ipH) return json({ ok: false, error: "closed" }, 503);
  const rl = await rateLimitDurable(`ea:vf:${ipH}`, LIMITE_IP);
  if (!rl.ok) {
    logSecurity("early_access_verify_rate_ip", {}, "low");
    return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  if (d.acao === "preview") {
    const p = await previewToken(hash);
    if (!p.ok) return indisponivel();
    if (!p.preview) return invalido();
    return json({ ok: true, preview: {
      display_name: p.preview.display_name, country: p.preview.country,
      terms_version: p.preview.terms_version, privacy_version: p.preview.privacy_version,
    } }, 200);
  }

  if (d.acao === "decline") {
    const r = await recusarEmail(hash);
    if (r === null) return indisponivel();
    if (r === "invalido") return invalido();
    logSecurity("early_access_recusado_pelo_titular", {}, "low");
    return json({ ok: true, result: "declined" }, 200);
  }

  // EA2-A02: só a escolha explícita do titular, feita AGORA; ausente = sem escolha (opt-out)
  // EA2-IA05: + as versões que a tela apresentou (o validador já as exigiu)
  const r = await confirmarEmail(
    hash, { termos: d.versaoTermos ?? "", privacidade: d.versaoPrivacidade ?? "" },
    d.displayName, d.country, ipH, d.marketingOptIn,
  );
  if (!r.ok) {
    if (r.erro === "correcao_invalida") return json({ ok: false, error: "campo_invalido" }, 400);
    if (r.erro === "versao_divergente") return json({ ok: false, error: "versao_legal" }, 400);
    return indisponivel();
  }
  if (r.resultado === "confirmado") {
    // F-11: o código de indicação só aparece para quem provou a posse do email.
    return json({ ok: true, result: "confirmed", referral_code: r.referralCode }, 200);
  }
  if (r.resultado === "ja_confirmado") return json({ ok: true, result: "already_confirmed" }, 200);
  return invalido();
}

function invalido(): Response {
  return json({ ok: false, error: "invalid_or_expired" }, 400);
}

function indisponivel(): Response {
  logSecurity("early_access_verify_banco_falhou", {}, "high");
  return json({ ok: false, error: "unavailable" }, 503);
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}
