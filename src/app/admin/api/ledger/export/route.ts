import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { comandoAuditado, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
/**
 * ⚠️ A célula mora em `lib/admin/csv.ts` (achado A29). Ela estava inline aqui e
 * escapava só para o PARSER — planilha não apenas lê, ela AVALIA.
 */
import { csvCell } from "@/lib/admin/csv";
import { lerTodasPorChave } from "@/lib/supabase/paginar";

export const dynamic = "force-dynamic";

const COLS = ["created_at", "wallet_address", "kind", "chain", "pair", "side", "volume_usd", "pnl_usd", "status", "route"] as const;

/** Teto do arquivo. Passou disso, o arquivo diz que foi cortado. */
const TETO_EXPORT = 10_000;

type Leitura = { linhas: Record<string, unknown>[]; truncado: boolean; ate: string };

/**
 * Download do ledger de operações em CSV (contabilidade).
 *
 * ⚠️ TRÊS MENTIRAS QUE ESTA ROTA CONTAVA (Admin CC 2.0, R0):
 *   1. erro de leitura virava CSV só com cabeçalho — "nenhuma operação";
 *   2. `.limit(10_000)` batia no `db-max-rows` e entregava 1.000 linhas como
 *      se fossem todas;
 *   3. o arquivo (carteiras + volumes) saía sem registro de quem baixou.
 * Agora: fotografia em `t0` paginada por chave (db-max-rows); qualquer página falha
 * → 503 sem arquivo; acima do teto → 413 sem arquivo parcial; e a intenção
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
      /**
       * ⚠️ FOTOGRAFIA, NÃO OFFSET (revisão adversarial). Por offset com a mais nova
       * primeiro, cada operação gravada DURANTE o export entrava na página 0 e
       * empurrava as seguintes: linha de fronteira saía DUPLICADA num CSV contábil.
       * Agora: `t0` antes da 1ª página, só `created_at <= t0`, paginação por CHAVE
       * (`id`, única) — cada linha existente em t0 sai exatamente uma vez.
       */
      const t0 = new Date().toISOString();
      const l = await lerTodasPorChave<Record<string, unknown>>((depoisDe, limite) => {
        let q = db.from("operations").select([...COLS, "id"].join(",")).lte("created_at", t0);
        if (depoisDe != null) q = q.gt("id", depoisDe);
        return q.order("id", { ascending: true }).limit(limite) as unknown as
          PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
      }, "id", { teto: TETO_EXPORT + 1 });
      if (l.erro) return { ok: false, codigo: "leitura_falhou", detalhe: l.erro.slice(0, 160) };
      // Lê 1 a mais que o teto: exatamente 10.000 não é "cortado".
      if (l.linhas.length > TETO_EXPORT) {
        // Subconjunto por chave NÃO é "as últimas N" — e CSV contábil parcial engana.
        return { ok: false, codigo: "acima_do_teto", detalhe: `mais de ${TETO_EXPORT} operações até ${t0}` };
      }
      const linhas = [...l.linhas].sort((x, y) =>
        String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")) || String(y.id).localeCompare(String(x.id)));
      return { ok: true, valor: { linhas, truncado: false, ate: t0 } };
    },
  });

  if (cmd.estado === "recusado" || cmd.estado === "repetido") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  if (cmd.estado === "falhou") {
    const teto = cmd.codigo === "acima_do_teto";
    return NextResponse.json({
      error: cmd.codigo,
      porque: teto
        ? `o ledger NÃO foi exportado: há mais de ${TETO_EXPORT} operações e um CSV contábil parcial engana — export por período é pendência`
        : "o ledger NÃO foi exportado: a leitura falhou — um arquivo vazio diria 'nenhuma operação'",
    }, { status: teto ? 413 : 503 });
  }

  const { linhas, truncado, ate } = cmd.valor;
  const lines = [COLS.join(",")];
  for (const r of linhas) lines.push(COLS.map((c) => csvCell(r[c])).join(","));
  const dia = new Date().toISOString().slice(0, 10);

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="operations-${dia}${truncado ? `-ultimas-${TETO_EXPORT}` : ""}.csv"`,
      "Cache-Control": "no-store",
      "X-Export-Linhas": String(linhas.length),
      "X-Export-Ate": ate,
      "X-Export-Truncado": truncado ? "1" : "0",
    },
  });
}
