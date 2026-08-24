import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { planReset, resetLedgers, lastReset } from "@/lib/paper/reset";

export const dynamic = "force-dynamic";

/**
 * ZERAR UM LEDGER QUE MEDIU A COISA ERRADA.
 *
 * GET  = mostra a conta sem fazer nada.
 * POST = zera, com motivo obrigatório no corpo.
 *
 * As fontes vêm do CLIENTE de propósito, e é uma decisão que merece nota: a
 * alternativa era fixar aqui a lista das mesas de arbitragem, o que
 * transformaria "zerar o que a auditoria reprovou hoje" em "zerar aquelas
 * quatro mesas para sempre". A próxima mesa reprovada seria outra.
 *
 * O que NÃO vem do cliente é o direito de fazer isso: `requireAdmin` primeiro,
 * e o motivo é exigido pelo módulo, não pela rota — assim ninguém contorna
 * chamando a função por outro caminho.
 */
export async function GET(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const sources = (new URL(req.url).searchParams.get("sources") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({
    plan: await planReset(sources),
    last: await lastReset(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<NextResponse> {
  await requireAdmin();
  let body: { sources?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const sources = Array.isArray(body.sources) ? body.sources.map(String).filter(Boolean) : [];
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (sources.length === 0) return NextResponse.json({ error: "no_sources" }, { status: 400 });
  // Motivo em branco é recusado aqui E no módulo. Zerar sem motivo produz, meses
  // depois, um ledger que ninguém sabe explicar — e a dúvida recai sobre o dado
  // bom, não só sobre o zerado.
  if (reason.length < 10) return NextResponse.json({ error: "reason_required" }, { status: 400 });

  const results = await resetLedgers(sources, reason);
  return NextResponse.json({
    ok: results.every((r) => r.ok),
    results,
    totalRemovedUsd: Math.round(results.filter((r) => r.ok).reduce((s, r) => s + r.realizedUsd, 0) * 100) / 100,
  }, { headers: { "Cache-Control": "no-store" } });
}
