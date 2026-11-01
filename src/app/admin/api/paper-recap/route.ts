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
  type Resultado = Awaited<ReturnType<typeof recapitalize>>;
  const r = await comandoAuditado<Resultado>({
    acao: "paper.recap", ator, alvo: sources.map(String).join(",").slice(0, 200),
    dados: { sources: sources.map(String), reason: reason.slice(0, 500) },
    executar: async () => {
      const x = await recapitalize(sources, reason);
      // `executado` só se TODAS as mesas pedidas foram recapitalizadas E o marco gravou.
      const falhas = x.entries.filter((e) => !e.ok);
      if (x.entries.length === 0) return { ok: false, codigo: "nada_recapitalizado", valor: x };
      if (falhas.length > 0 || !x.marcoGravado) {
        return {
          ok: false, codigo: "parcial", valor: x,
          detalhe: [...falhas.map((e) => `${e.source}:${e.erro}`), ...(x.marcoGravado ? [] : ["marco_nao_gravado"])].join(",").slice(0, 200),
        };
      }
      return { ok: true, valor: x };
    },
  });
  if (r.estado === "recusado" || r.estado === "repetido") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  if (r.estado === "falhou") {
    return NextResponse.json({
      error: r.codigo, detalhe: r.detalhe, entries: r.valor?.entries ?? [], ...avisoDeAuditoria(r.auditoria),
      porque: r.codigo === "nada_recapitalizado"
        ? "NADA foi recapitalizado: nenhuma das mesas pedidas está no plano"
        : "a recapitalização NÃO terminou em todas as mesas — veja `entries` e releia o plano (GET) antes de repetir",
    }, { status: r.codigo === "nada_recapitalizado" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true, entries: r.valor.entries, last: await lastRecap(), ...avisoDeAuditoria(r.auditoria) });
}
