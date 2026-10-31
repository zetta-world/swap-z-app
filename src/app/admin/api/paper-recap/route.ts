import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { planRecap, recapitalize, lastRecap } from "@/lib/paper/recapitalize";
import { comandoAuditado, avisoDeAuditoria, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";

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
  await autorizarAdmin("paper.recap.plan");
  return NextResponse.json({
    plan: await planRecap(),
    last: await lastRecap(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { wallet: ator } = await autorizarAdmin("paper.recap.execute");
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

  // ⚠️ RESETA CAPITAL DAS MESAS: sem intenção gravada (quem/quais/por quê), não roda.
  type Entradas = Awaited<ReturnType<typeof recapitalize>>;
  const r = await comandoAuditado<Entradas>({
    acao: "paper.recap", ator, alvo: sources.map(String).join(",").slice(0, 200),
    dados: { sources: sources.map(String), reason: reason.slice(0, 500) },
    executar: async () => ({ ok: true, valor: await recapitalize(sources, reason) }),
  });
  if (r.estado === "recusado" || r.estado === "repetido") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  if (r.estado === "falhou") {
    return NextResponse.json({
      error: r.codigo, detalhe: r.detalhe, ...avisoDeAuditoria(r.auditoria),
      porque: "a recapitalização falhou no meio — releia o plano (GET) antes de repetir",
    }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entries: r.valor, last: await lastRecap(), ...avisoDeAuditoria(r.auditoria) });
}
