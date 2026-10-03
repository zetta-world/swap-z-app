import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { logSecurity } from "@/lib/admin/track";
import { lerGateEarlyAccess } from "@/lib/early-access/gate";
import { purgarNaoVerificados } from "@/lib/early-access/store";
import { reenviarPendentes } from "@/lib/early-access/email/enviar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/early-access/cron — retry de envio + purga por retenção.
 *
 * ⚠️ PREPARADO, NÃO AGENDADO (D-8). O dono aprovou o cron-job.org para quando
 * chegar a etapa operacional; agendar é ação externa e não foi feita.
 * Procedimento no `docs/RUNBOOK.md`.
 *
 * Autenticação: `Authorization: Bearer <CRON_SECRET>`, comparação
 * timing-safe (o mesmo padrão de `/api/dca/cron`). Sem segredo configurado =
 * 401 para todos, sem trabalho nenhum.
 *
 * · A PURGA roda sempre (é obrigação de privacidade: não verificado some em
 *   7 dias — constante na 0069), mesmo com o gate fechado.
 * · O RETRY só roda com o gate ABERTO: fechado em incidente, nada é enviado.
 */
const LOTE_RETRY = 20;
const LOTE_PURGA = 500;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!autorizado(req)) return json({ ok: false, error: "unauthorized" }, 401);

  const purgadas = await purgarNaoVerificados(LOTE_PURGA);
  if (purgadas === null) logSecurity("early_access_purga_falhou", {}, "high");

  const gate = await lerGateEarlyAccess();
  const reenviados = gate.aberto ? await reenviarPendentes(LOTE_RETRY) : 0;
  if (reenviados === null) logSecurity("early_access_retry_falhou", {}, "med");

  const ok = purgadas !== null && reenviados !== null;
  return json({ ok, purgadas, reenviados, gate_aberto: gate.aberto }, ok ? 200 : 503);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
