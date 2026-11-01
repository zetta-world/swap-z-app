import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { planReset, resetLedgers, lastReset } from "@/lib/paper/reset";
import { comandoAuditado, avisoDeAuditoria, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";

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
  await autorizarAdmin("paper.reset.plan");
  const sources = (new URL(req.url).searchParams.get("sources") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({
    plan: await planReset(sources),
    last: await lastReset(),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { wallet: ator } = await autorizarAdmin("paper.reset.execute");
  let body: { sources?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const sources = Array.isArray(body.sources) ? body.sources.map(String).filter(Boolean) : [];
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (sources.length === 0) return NextResponse.json({ error: "no_sources" }, { status: 400 });
  // Motivo em branco é recusado aqui E no módulo. Zerar sem motivo produz, meses
  // depois, um ledger que ninguém sabe explicar — e a dúvida recai sobre o dado
  // bom, não só sobre o zerado.
  if (reason.length < 10) return NextResponse.json({ error: "reason_required" }, { status: 400 });

  // ⚠️ ZERAR APAGA HISTÓRICO: sem a intenção gravada (quem, quais mesas, por
  // quê) o comando NÃO roda. Antes não havia ator registrado em lugar nenhum.
  type Resultados = Awaited<ReturnType<typeof resetLedgers>>;
  const r = await comandoAuditado<Resultados>({
    acao: "paper.reset", ator, alvo: sources.join(",").slice(0, 200), dados: { sources, reason: reason.slice(0, 500) },
    executar: async () => {
      const results = await resetLedgers(sources, reason);
      return results.every((x) => x.ok)
        ? { ok: true, valor: results }
        : { ok: false, codigo: "parcial", valor: results, detalhe: results.filter((x) => !x.ok).map((x) => x.source).join(",") };
    },
  });
  if (r.estado === "recusado" || r.estado === "repetido") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  const results = r.valor ?? [];
  return NextResponse.json({
    ok: r.estado === "executado",
    ...(r.estado === "falhou" && r.codigo !== "parcial" ? { error: r.codigo, porque: "o reset lançou exceção — releia o plano antes de repetir" } : {}),
    results,
    totalRemovedUsd: Math.round(results.filter((x) => x.ok).reduce((s, x) => s + x.realizedUsd, 0) * 100) / 100,
    ...avisoDeAuditoria(r.auditoria),
  }, { status: r.estado === "falhou" && r.codigo !== "parcial" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
