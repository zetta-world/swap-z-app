import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { naoRefletidos } from "@/lib/zion/retro";
import { vereditoDoVolante, type EntradaDeMesa } from "@/lib/zion/aprendizado";
import { DESKS } from "@/lib/zion/desks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * O VOLANTE DE APRENDIZADO ESTÁ VIVO? — a pergunta que ninguém fez por 20 dias.
 *
 * ⚠️ POR QUE ESTA ROTA EXISTE (16/08). O `runRetroSweep` rodou a cada 30 minutos
 * de 27/07 a 16/08 sem escrever uma única lição, sem lançar um único erro. O
 * gatilho estava quebrado (marco absoluto contra população esvaziada pelo
 * arquivamento) e o modo de falha era silêncio — indistinguível de "ainda não
 * deu o número".
 *
 * Vinte dias de mercado. Descoberto por acaso, conferindo uma hipótese do dono.
 *
 * ⚠️ LEITURA PURA: não gera lição, não dispara reflexão, não escreve em
 * `agent_lessons`. O único efeito colateral é o evento — sem ele esta medição
 * só existiria enquanto alguém estivesse olhando a resposta HTTP
 * (invariante nº 14).
 */

/** O MESMO limiar que a varredura usa. Ler de outro lugar compararia com uma
 *  cópia, e uma cópia que diverge faz o mostrador mentir sobre o motor. */
const RETRO_EVERY_N = Number(process.env.RETRO_EVERY_N ?? 10);

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  /**
   * ⚠️ LEITURA PAGINADA. Um ledger truncado em 1000 linhas (o teto silencioso
   * do PostgREST) subcontaria os não-refletidos e transformaria uma mesa
   * travada em mesa quieta — exatamente o erro que este painel existe para
   * impedir.
   */
  const decididos = await selectAllRows<{ source: string | null; resolved_at: string | null }>(
    (from, to) => db.from("zion_suggestions")
      .select("source, resolved_at")
      .is("archived_at", null)
      .in("status", ["hit_target", "hit_stop"])
      .order("resolved_at", { ascending: false })
      .range(from, to),
  );

  const { data: licoes } = await db.from("agent_lessons")
    .select("source, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const ultimaLicaoBy = new Map<string, number>();
  for (const r of licoes ?? []) {
    if (ultimaLicaoBy.has(r.source)) continue;
    const t = Date.parse(r.created_at);
    if (Number.isFinite(t)) ultimaLicaoBy.set(r.source, t);
  }

  const resolvidosBy = new Map<string, number[]>();
  for (const r of decididos) {
    if (!r.source) continue;
    const arr = resolvidosBy.get(r.source) ?? [];
    arr.push(Date.parse(r.resolved_at ?? ""));
    resolvidosBy.set(r.source, arr);
  }

  /**
   * ⚠️ TODA MESA DO REGISTRO APARECE, mesmo sem um único trade. Listar só quem
   * tem movimento esconderia exatamente o caso que dói: a mesa que nunca
   * aprendeu e nunca vai aprender porque ninguém a ligou no volante. Foi assim
   * que o MÍMIR passou a existência inteira sem uma lição.
   */
  const entradas: EntradaDeMesa[] = DESKS.map((d) => ({
    source: d.source,
    ultimaLicaoMs: ultimaLicaoBy.get(d.source) ?? null,
    naoRefletidos: naoRefletidos(resolvidosBy.get(d.source) ?? [], ultimaLicaoBy.get(d.source) ?? null),
  }));

  const v = vereditoDoVolante(entradas, Date.now(), RETRO_EVERY_N);

  await recordEvent("volante_aprendizado", { meta: {
    com_licao: v.comLicao,
    travadas: v.travadas,
    dias_desde_ultima_licao: v.diasDesdeAUltimaLicao,
    travadas_quais: v.mesas.filter((m) => m.travado).map((m) => m.source),
    limiar: RETRO_EVERY_N,
    ms: Date.now() - t0,
  } });

  return NextResponse.json({
    ...v,
    limiar: RETRO_EVERY_N,
    /** ⚠️ As ressalvas viajam na resposta, não no comentário — um mostrador lido
     *  sem elas vira "o aprendizado está resolvido". */
    naoMedido: [
      "se a lição MELHOROU o resultado: este painel mede se o volante gira, não "
        + "se ele puxa. A GERI foi de −0,524% para −0,302% depois de refletir, "
        + "com 56 decididos — melhora real, amostra insuficiente para atribuir",
      "a qualidade da lição: uma lição errada é gravada igual a uma certa, e só "
        + "a expectância posterior separa as duas",
      "as mesas mecânicas: elas aparecem com o canal delas declarado, mas "
        + "`selectPlaybook` não tem prompt e nenhuma lição chega lá",
    ],
    fetchedAt: new Date().toISOString(),
  });
}
