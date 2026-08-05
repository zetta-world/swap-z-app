import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readLab, syncRegistry } from "@/lib/lab/store";
import { FAMILIES } from "@/lib/lab/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O LABORATÓRIO — as 26 estratégias, o capital de cada uma e a última medição.
 *
 * ⚠️ UMA FONTE DE VERDADE, e é por isso que esta rota existe (05/08).
 *
 * A auditoria visual encontrou a mesma carteira exibida como $995 num painel e
 * $997 em outro, e um total de $20.842 onde o caixa somava $11.491 — porque
 * cada tela derivava o próprio número da própria fonte.
 *
 * Daqui para a frente: se dois painéis mostram a mesma estratégia, eles leem
 * DESTA rota. Divergência entre telas passa a ser impossível por construção, e
 * não por disciplina de quem escreve.
 *
 * GET  devolve o laboratório inteiro, agrupado por família.
 * POST espelha o registro do código para a tabela (código → banco, nunca o
 *      contrário: registro em arquivo passa por revisão de PR, linha em tabela
 *      é alterada por quem tiver a chave).
 */

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "sem banco" }, { status: 503 });

  try {
    const rows = await readLab(db);
    // Registro vazio no banco não é erro — é a primeira vez. Espelha e relê,
    // para o painel nunca abrir vazio dizendo "nenhuma estratégia".
    if (rows.length === 0) {
      await syncRegistry(db);
      return NextResponse.json({
        familias: FAMILIES, estrategias: await readLab(db),
        sincronizadoAgora: true,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      familias: FAMILIES, estrategias: rows, sincronizadoAgora: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "sem banco" }, { status: 503 });
  try {
    const { synced } = await syncRegistry(db);
    return NextResponse.json({ synced, estrategias: await readLab(db) });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
