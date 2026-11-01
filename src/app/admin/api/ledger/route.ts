import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerTodasPorChave } from "@/lib/supabase/paginar";
import { comTeto, contagemSegura, deContagem, deLeitura, indisponivel, type OperationalMetric } from "@/lib/admin/metrica";

export const dynamic = "force-dynamic";

const TETO_MS = 6_000;

type Linha = { id: string; kind: string; volume_usd: number | null; pnl_usd: number | null };
type Agregado = {
  totalVolume: number; totalPnl: number;
  byKind: Record<string, { count: number; volume: number; pnl: number }>;
};

/**
 * The operations ledger for the admin OPERATIONS panel: every client action with wallet, type,
 * pair, volume and realized P&L.
 *
 * ⚠️ R3/P1-11 (Admin CC 2.0): o TOTAL era `count: exact` (completo) e o volume/P&L eram somas das
 * linhas de UMA leitura sem paginação — o PostgREST corta em 1.000, então passado esse ponto a
 * tela mostrava o total certo ao lado de somas de um recorte. E `{ error }` nunca era lido:
 * banco fora = "No operations recorded yet.". Agora a contagem é do banco, as somas são sobre
 * TODAS as linhas (`lerTodasPorChave`, cobertura conferida contra a contagem) e as falhas viram
 * métricas indisponíveis; contagem E somas ilegíveis = 503.
 *
 * ⚠️ Volume/P&L aqui são DECLARADOS pelo navegador (W3-D separa o que a rede verificou, no
 * painel RECEITA) — qualidade `declared`.
 */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("finance.ledger.read");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable", state: "unavailable" }, { status: 503 });
  const asOf = new Date().toISOString();

  const [rCont, rLinhas, rRecentes] = await Promise.all([
    comTeto(() => contagemSegura(db.from("operations").select("*", { count: "exact", head: true })), TETO_MS),
    comTeto(() => lerTodasPorChave<Linha>((d, n) => {
      let q = db.from("operations").select("id, kind, volume_usd, pnl_usd");
      if (d) q = q.gt("id", d);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"), TETO_MS),
    comTeto(() => Promise.resolve(
      // leitura-limitada: a lista mostra as 50 operações mais recentes; nenhum total sai daqui.
      db.from("operations")
        .select("wallet_address, kind, pair, side, volume_usd, pnl_usd, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ), TETO_MS),
  ]);

  const total = rCont.ok ? deContagem(rCont.valor, "operations", { asOf }) : indisponivel<number>("operations", "measured", rCont.errorCode, asOf);
  const leitura = rLinhas.ok ? rLinhas.valor : { linhas: [] as Linha[], erro: rLinhas.errorCode, truncado: false, paginas: 0 };
  const agregado: OperationalMetric<Agregado> = deLeitura(leitura, "operations(volume,pnl)", (ls) => {
    let totalVolume = 0, totalPnl = 0;
    const byKind: Agregado["byKind"] = {};
    for (const r of ls) {
      totalVolume += Number(r.volume_usd) || 0;
      totalPnl    += Number(r.pnl_usd)    || 0;
      const k = (byKind[r.kind] ??= { count: 0, volume: 0, pnl: 0 });
      k.count++;
      k.volume += Number(r.volume_usd) || 0;
      k.pnl    += Number(r.pnl_usd)    || 0;
    }
    return { totalVolume, totalPnl, byKind };
  }, { asOf, quality: "declared", esperado: total.value });

  if (total.state === "unavailable" && agregado.state === "unavailable") {
    return NextResponse.json({ state: "unavailable", errorCode: total.errorCode, error: "livro_ilegivel", total, agregado }, { status: 503 });
  }
  // A soma cobriu menos linhas do que a contagem tinha → não é o total (escrita concorrente ou corte).
  const cobriu = total.value == null || leitura.linhas.length >= total.value;
  const agregadoFinal: OperationalMetric<Agregado> = agregado.state !== "unavailable" && !cobriu
    ? { ...agregado, state: "partial", errorCode: "truncado" } : agregado;

  const recentesOk = rRecentes.ok && !rRecentes.valor.error;
  return NextResponse.json({
    state: total.state === "unavailable" || agregadoFinal.state === "unavailable" || agregadoFinal.state === "partial" || !recentesOk ? "partial" : "ok",
    total,
    agregado: agregadoFinal,
    recent: recentesOk && rRecentes.ok ? rRecentes.valor.data ?? [] : null,
    recentMetrica: recentesOk
      ? { state: "ok", value: null, quality: "declared", source: "operations(recentes)", asOf }
      : indisponivel("operations(recentes)", "declared", rRecentes.ok ? "leitura_falhou" : rRecentes.errorCode, asOf),
    fetchedAt: asOf,
  });
}
