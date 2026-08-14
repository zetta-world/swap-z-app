import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QUANDO CADA ESTRATÉGIA RODOU PELA ÚLTIMA VEZ — só o carimbo, nada mais.
 *
 * ⚠️ POR QUE UMA ROTA SÓ PARA ISTO (14/08).
 *
 * Os painéis de MEDIÇÃO são de botão: o dono aperta, a medição roda, a tela
 * mostra aquele resultado. Eles não têm relógio de propósito — auto-refresh
 * neles dispararia medição sozinho, de hora em hora, gastando API e gravando
 * `lab_runs` que ninguém pediu (ver `PLANO-PAINEL-SINCRONIZADO.md`).
 *
 * Mas isso deixava um buraco: se o cron, outra aba ou outro dia produziu uma
 * rodada mais nova, a tela continua mostrando a antiga **sem dizer que é
 * antiga**. Um número velho apresentado como o número atual é a mesma família
 * de defeito que este repositório persegue desde o começo.
 *
 * A resposta certa não é recarregar — é AVISAR. E avisar custa um carimbo de
 * data, não o resultado inteiro.
 *
 * ⚠️ POR QUE NÃO REUSAR `/admin/api/lab`. Aquela rota faz três consultas POR
 * ESTRATÉGIA (última rodada, resultado, contagem) — são 28 estratégias, quase
 * noventa idas ao banco, para o aviso precisar de um número por slug. Numa tela
 * aberta o dia inteiro isso repetiria para sempre.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ultima: {} });

  const [estrategias, runs] = await Promise.all([
    selectAllRows<{ id: string; slug: string }>((from, to) =>
      db.from("lab_strategies").select("id, slug").range(from, to)),
    selectAllRows<{ strategy_id: string; started_at: string; status: string }>((from, to) =>
      db.from("lab_runs").select("strategy_id, started_at, status").eq("status", "ok").range(from, to)),
  ]);

  const slugPorId = new Map(estrategias.map((e) => [e.id, e.slug]));
  const ultima: Record<string, string> = {};
  for (const r of runs) {
    const slug = slugPorId.get(r.strategy_id);
    if (!slug || !r.started_at) continue;
    // ⚠️ Só rodada `ok`. Uma que FALHOU não produz resultado novo para ver, e
    // avisar "há algo mais recente" apontando para uma falha mandaria o dono
    // procurar um número que não existe.
    if (!ultima[slug] || r.started_at > ultima[slug]) ultima[slug] = r.started_at;
  }

  return NextResponse.json({ ultima, fetchedAt: new Date().toISOString() });
}
