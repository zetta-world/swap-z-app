import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { planRecap, recapitalize, lastRecap } from "@/lib/paper/recapitalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RECAPITALIZAR AS MESAS — dar a cada uma o capital que a estratégia pede.
 *
 * Ver o cabeçalho de `paper/recapitalize.ts` para o porquê de isto ser um
 * RESET e não um ajuste de coluna: mudar `starting_usd` com trades antigos
 * dentro reescreveria o retorno histórico da mesa sem nenhum trade novo ter
 * acontecido.
 *
 * GET  mostra o plano, sem fazer. Operação de capital que só existe na forma
 *      "clica e confia" é a coisa errada — dá para ver a conta antes.
 * POST executa, exige MOTIVO escrito, e deixa marco.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({
    plan: await planRecap(),
    last: await lastRecap(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<NextResponse> {
  await requireAdmin();
  let body: { sources?: string[]; reason?: string };
  try { body = await req.json(); } catch { body = {}; }

  const sources = Array.isArray(body.sources) ? body.sources : [];
  const reason = String(body.reason ?? "");
  if (sources.length === 0) {
    return NextResponse.json({ error: "nenhuma mesa selecionada" }, { status: 400 });
  }
  // O motivo é checado aqui ALÉM do módulo e do banco. Três camadas para a
  // mesma regra não é exagero: é uma operação que reescreve capital.
  if (reason.trim().length < 15) {
    return NextResponse.json(
      { error: "recapitalização exige motivo escrito com pelo menos 15 caracteres" },
      { status: 400 },
    );
  }

  try {
    const entries = await recapitalize(sources, reason);
    return NextResponse.json({ ok: true, entries, last: await lastRecap() });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
