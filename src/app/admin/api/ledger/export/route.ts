import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { comandoAuditado, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
/**
 * ⚠️ A célula mora em `lib/admin/csv.ts` (achado A29). Ela estava inline aqui e
 * escapava só para o PARSER — planilha não apenas lê, ela AVALIA.
 */
import { csvCell } from "@/lib/admin/csv";
import { lerTodasAsPaginas } from "@/lib/supabase/paginar";

export const dynamic = "force-dynamic";

const COLS = ["created_at", "wallet_address", "kind", "chain", "pair", "side", "volume_usd", "pnl_usd", "status", "route"] as const;

/** Teto do arquivo. Passou disso, o arquivo diz que foi cortado. */
const TETO_EXPORT = 10_000;

type Leitura = { linhas: Record<string, unknown>[]; truncado: boolean };

/**
 * Download do ledger de operações em CSV (contabilidade).
 *
 * ⚠️ TRÊS MENTIRAS QUE ESTA ROTA CONTAVA (Admin CC 2.0, R0):
 *   1. erro de leitura virava CSV só com cabeçalho — "nenhuma operação";
 *   2. `.limit(10_000)` batia no `db-max-rows` e entregava 1.000 linhas como
 *      se fossem todas;
 *   3. o arquivo (carteiras + volumes) saía sem registro de quem baixou.
 * Agora: `lerTodasAsPaginas` (db-max-rows); qualquer página falha → 503 sem arquivo;
 * corte no teto vai no cabeçalho `X-Export-Truncado` e no nome; e a intenção
 * de exportar é gravada ANTES — sem trilha, sem arquivo (mesma regra do
 * export do early access).
 */
export async function GET(): Promise<NextResponse> {
  const { wallet: ator } = await autorizarAdmin("finance.ledger.export");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const cmd = await comandoAuditado<Leitura>({
    acao: "ledger.export", ator, dados: { teto: TETO_EXPORT },
    executar: async () => {
      // Ordem TOTAL (created_at + id): página por offset sobre empate pula/repete linha.
      const l = await lerTodasAsPaginas<Record<string, unknown>>((de, ate) => db.from("operations")
        .select(COLS.join(","))
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
      { teto: TETO_EXPORT });
      return l.erro
        ? { ok: false, codigo: "leitura_falhou", detalhe: l.erro.slice(0, 160) }
        : { ok: true, valor: { linhas: l.linhas, truncado: l.truncado } };
    },
  });

  if (cmd.estado === "recusado" || cmd.estado === "repetido") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  if (cmd.estado === "falhou") {
    return NextResponse.json({
      error: cmd.codigo, porque: "o ledger NÃO foi exportado: a leitura falhou — um arquivo vazio diria 'nenhuma operação'",
    }, { status: 503 });
  }

  const { linhas, truncado } = cmd.valor;
  const lines = [COLS.join(",")];
  for (const r of linhas) lines.push(COLS.map((c) => csvCell(r[c])).join(","));
  const dia = new Date().toISOString().slice(0, 10);

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="operations-${dia}${truncado ? `-ultimas-${TETO_EXPORT}` : ""}.csv"`,
      "Cache-Control": "no-store",
      "X-Export-Linhas": String(linhas.length),
      "X-Export-Truncado": truncado ? "1" : "0",
    },
  });
}
