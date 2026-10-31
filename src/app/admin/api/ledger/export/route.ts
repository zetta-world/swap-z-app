import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { comandoAuditado, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
/**
 * ⚠️ A célula mora em `lib/admin/csv.ts` (achado A29). Ela estava inline aqui e
 * escapava só para o PARSER — planilha não apenas lê, ela AVALIA.
 */
import { csvCell } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";

const COLS = ["created_at", "wallet_address", "kind", "chain", "pair", "side", "volume_usd", "pnl_usd", "status", "route"] as const;

/** Teto do arquivo. Passou disso, o arquivo diz que foi cortado. */
const TETO_EXPORT = 10_000;
/** `db-max-rows` do PostgREST: um `.limit(10_000)` devolvia em silêncio só 1.000. */
const PAGINA = 1_000;

type Leitura = { linhas: Record<string, unknown>[]; truncado: boolean };

/**
 * Download do ledger de operações em CSV (contabilidade).
 *
 * ⚠️ TRÊS MENTIRAS QUE ESTA ROTA CONTAVA (Admin CC 2.0, R0):
 *   1. erro de leitura virava CSV só com cabeçalho — "nenhuma operação";
 *   2. `.limit(10_000)` batia no `db-max-rows` e entregava 1.000 linhas como
 *      se fossem todas;
 *   3. o arquivo (carteiras + volumes) saía sem registro de quem baixou.
 * Agora: pagina de 1.000 em 1.000; qualquer página falha → 503 sem arquivo;
 * corte no teto vai no cabeçalho `X-Export-Truncado` e no nome; e a intenção
 * de exportar é gravada ANTES — sem trilha, sem arquivo (mesma regra do
 * export do early access).
 */
export async function GET(): Promise<NextResponse> {
  const { wallet: ator } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const cmd = await comandoAuditado<Leitura>({
    acao: "ledger.export", ator, dados: { teto: TETO_EXPORT },
    executar: async () => {
      const linhas: Record<string, unknown>[] = [];
      for (let de = 0; de < TETO_EXPORT; de += PAGINA) {
        const { data, error } = await db.from("operations")
          .select(COLS.join(","))
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(de, Math.min(de + PAGINA, TETO_EXPORT) - 1);
        if (error) return { ok: false, codigo: "leitura_falhou", detalhe: String(error.message ?? "").slice(0, 160) };
        const pagina = (data ?? []) as unknown as Record<string, unknown>[];
        linhas.push(...pagina);
        if (pagina.length < PAGINA) return { ok: true, valor: { linhas, truncado: false } };
      }
      return { ok: true, valor: { linhas, truncado: true } };
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
