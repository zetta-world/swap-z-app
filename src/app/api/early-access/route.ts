import { NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/admin/track";
import { lerGateEarlyAccess } from "@/lib/early-access/gate";
import { ipHmac, emailHmac } from "@/lib/early-access/hmac";
import { validarInscricao, pareceRobo, LIMITE_CORPO_BYTES } from "@/lib/early-access/validate";
import { gerarCandidatos } from "@/lib/early-access/referral";
import { inscrever } from "@/lib/early-access/store";
import { lerCorpoLimitado, origemPermitida, ehJson } from "@/lib/early-access/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/early-access — inscrição PÚBLICA na lista de early access.
 *
 * ⚠️ NÃO É A WHITELIST DE ADMIN (`/admin/api/whitelist` = `ADMIN_WALLETS`).
 * Plano: docs/PLANO-EARLY-ACCESS.md.
 *
 * ⚠️⚠️ ANTI-ENUMERAÇÃO. Inscrição nova, email já inscrito, inscrição
 * bloqueada, email que estourou o próprio limite e envio com cara de robô
 * recebem a MESMA resposta: `202 {"ok":true}`. Nenhuma delas pode ensinar a
 * quem pergunta se um email está na lista. Não existe GET.
 *
 * ⚠️ FAIL-CLOSED. Sem gate aberto (ver `lib/early-access/gate.ts`) a rota não
 * aceita nada — e na Fase 1 ele está fechado por quatro motivos ao mesmo
 * tempo, de propósito.
 *
 * ⚠️ NENHUM IP CRU NO BANCO. Os buckets de rate limit usam HMAC do IP e do
 * email; a linha da inscrição guarda só o HMAC do IP.
 *
 * ORDEM FINAL (F-02 da auditoria adversarial):
 *   tipo/tamanho → parse → gate → origem → validação → limite por IP →
 *   honeypot/tempo → limite por email → teto global → RPC.
 *
 * · O limite por IP vem cedo: é barato e impede a própria rota de virar
 *   abuso de CPU/banco — inclusive por robôs.
 * · O filtro de robô vem ANTES do limite por email e do teto global. Antes,
 *   robôs (que recebem o mesmo 202 e não gravam nada) consumiam a cota
 *   COMPARTILHADA de 500/h e podiam fechar a inscrição para todo mundo.
 * · Isso não cria oráculo de email: o veredito de robô depende só do próprio
 *   envio (honeypot, form_ms), nunca do estado de um email.
 */
const LIMITE_IP_RAJADA = { windowMs: 60_000,      max: 5 };
const LIMITE_IP_HORA   = { windowMs: 3_600_000,   max: 20 };
const LIMITE_EMAIL     = { windowMs: 86_400_000,  max: 3 };
const TETO_GLOBAL      = { windowMs: 3_600_000,   max: 500 };

export async function POST(req: NextRequest): Promise<Response> {
  // 1. tipo e tamanho
  if (!ehJson(req)) return json({ ok: false, error: "unsupported_media_type" }, 415);
  const corpo = await lerCorpoLimitado(req, LIMITE_CORPO_BYTES);
  if (!corpo.ok) {
    return corpo.motivo === "grande_demais"
      ? json({ ok: false, error: "payload_too_large" }, 413)
      : json({ ok: false, error: "invalid_body" }, 400);
  }

  // 2. parse
  let bruto: unknown;
  try { bruto = JSON.parse(corpo.texto); } catch { return json({ ok: false, error: "invalid_body" }, 400); }

  // 3. gate — fechado é a resposta, sem dizer qual das quatro condições faltou
  const gate = await lerGateEarlyAccess();
  if (!gate.aberto) return json({ ok: false, error: "closed" }, 503);

  // 4. origem
  if (!origemPermitida(req)) {
    logSecurity("early_access_origem_recusada", {}, "low");
    return json({ ok: false, error: "forbidden_origin" }, 403);
  }

  // 5. validação (a estrutura que o HMAC precisa: email normalizado)
  const v = validarInscricao(bruto);
  if (!v.ok) return json({ ok: false, error: v.erro, ...(v.campo ? { field: v.campo } : {}) }, 400);
  const d = v.dados;

  const ipH = ipHmac(getClientId(req.headers));
  const emH = emailHmac(d.email);
  // O gate já exigiu o segredo; isto só fecha a janela de corrida.
  if (!ipH || !emH) return json({ ok: false, error: "closed" }, 503);

  // 6. limite por IP — 429 aqui não revela nada sobre email nenhum
  for (const [nome, opts] of [["r", LIMITE_IP_RAJADA], ["h", LIMITE_IP_HORA]] as const) {
    const rl = await rateLimitDurable(`ea:ip:${nome}:${ipH}`, opts);
    if (!rl.ok) {
      logSecurity("early_access_rate_ip", { janela: nome }, "low");
      return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });
    }
  }

  // 7. honeypot / tempo mínimo — mesmo 202, nada gravado, e SEM consumir o
  //    limite por email nem o teto global (F-02)
  if (pareceRobo(d)) {
    logSecurity("early_access_sinal_robo", { honeypot: d.honeypot !== "", formMs: d.formMs }, "low");
    return aceito();
  }

  // 8. limite por email — estouro é SILENCIOSO: um 429 diria "este email foi tentado"
  const rlEmail = await rateLimitDurable(`ea:em:${emH}`, LIMITE_EMAIL);
  if (!rlEmail.ok) {
    logSecurity("early_access_rate_email", {}, "med");
    return aceito();
  }

  // 9. teto global — proteção contra inscrição em massa distribuída
  const rlGlobal = await rateLimitDurable("ea:global:h", TETO_GLOBAL);
  if (!rlGlobal.ok) {
    logSecurity("early_access_teto_global", {}, "high");
    return json({ ok: false, error: "busy" }, 503);
  }

  // 10. RPC — novo e duplicado respondem igual
  const r = await inscrever(d, ipH, gerarCandidatos());
  if (!r.ok) {
    logSecurity("early_access_gravacao_falhou", { erro: r.erro }, "high");
    return json({ ok: false, error: "unavailable" }, 503);
  }
  return aceito();
}

function aceito(): Response {
  return json({ ok: true }, 202);
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}
