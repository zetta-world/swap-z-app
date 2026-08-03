import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { ARBITER2_PROFILES } from "@/lib/zion/arbiter2";
import { auditCohort, cohortReadable, realismBySymbol, type CohortDesk, type Leg } from "@/lib/zion/arbiter-cohort";

export const dynamic = "force-dynamic";

/**
 * A COORTE DO ARBITER — os três gêmeos lidos do ledger e submetidos às marcas.
 *
 * A pergunta era "o alavancado está indo bem mesmo ou é ilusão?", e a resposta
 * exige comparar as três mesas COM as verificações do lado, não só os saldos.
 * Saldo sozinho já respondeu "sim, muito bem" — 661 ciclos sem uma perda — e
 * era exatamente esse "muito bem" que precisava ser desconfiado.
 *
 * O portão de entrada é derivado das MESMAS variáveis que a mesa usa. Redigitar
 * 0.60 aqui faria a verificação envelhecer no dia em que alguém ajustasse o
 * custo por env e continuar exibindo um veredito com cara de atual.
 */
const COST_PCT = Number(process.env.ARB2_COST_PCT ?? 0.45);
const MIN_NET_PCT = Number(process.env.ARB2_MIN_NET_PCT ?? 0.15);
const SIZE_USD = Number(process.env.ARB2_SIZE_USD ?? 50);

const ROUTE_RE = /arb2 ([a-z]+)→([a-z]+)/i;

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const sources = ARBITER2_PROFILES.map((p) => p.source);
  const { data: accounts } = await db.from("paper_accounts")
    .select("id, source, label, starting_usd, cash_usd, realized_pnl_usd").in("source", sources);

  // Paginado: o 1× já passou de 600 ciclos e o teto silencioso do PostgREST é
  // 1000. Uma coorte truncada mediria o começo da amostra e chamaria de tudo.
  const positions = await selectAllRows<{
    source: string; status: string; pnl_usd: number | null; cost_usd: number | null;
    entry_price: number | null; target_price: number | null;
    exit_reason: string | null; opened_at: string; closed_at: string | null;
  }>((from, to) => db.from("paper_positions")
    .select("source, status, pnl_usd, cost_usd, entry_price, target_price, exit_reason, opened_at, closed_at")
    .in("source", sources).is("archived_at", null).range(from, to));

  const legs: Leg[] = [];
  let minSpreadPct = Infinity, liquidations = 0;
  const bySource = new Map<string, typeof positions>();
  for (const p of positions) {
    const list = bySource.get(p.source) ?? [];
    list.push(p); bySource.set(p.source, list);
    const m = ROUTE_RE.exec(p.exit_reason ?? "");
    if (m) legs.push({ buyVenue: m[1].toLowerCase(), sellVenue: m[2].toLowerCase() });
    if ((p.exit_reason ?? "").includes("LIQUIDADO")) liquidations++;
    const e = Number(p.entry_price), t = Number(p.target_price);
    if (e > 0 && t > 0) minSpreadPct = Math.min(minSpreadPct, ((t - e) / e) * 100);
  }

  const desks: CohortDesk[] = ARBITER2_PROFILES.map((prof) => {
    const acc = (accounts ?? []).find((a) => a.source === prof.source);
    const list = bySource.get(prof.source) ?? [];
    const fechadas = list.filter((p) => p.status === "closed");
    const realized = fechadas.reduce((s, p) => s + Number(p.pnl_usd ?? 0), 0);
    const times = list.map((p) => Date.parse(p.opened_at)).filter(Number.isFinite);
    const fim = fechadas.map((p) => (p.closed_at ? Date.parse(p.closed_at) : NaN)).filter(Number.isFinite);
    return {
      source: prof.source, label: prof.label, leverage: prof.leverage,
      startingUsd: prof.startingUsd,
      cycles: fechadas.length,
      losses: fechadas.filter((p) => Number(p.pnl_usd ?? 0) < 0).length,
      realizedUsd: realized,
      avgPnlUsd: fechadas.length ? realized / fechadas.length : 0,
      marginPerCycleUsd: SIZE_USD + SIZE_USD / prof.leverage,
      hoursLive: times.length && fim.length ? (Math.max(...fim) - Math.min(...times)) / 3_600_000 : 0,
      // Contexto do ledger, para a tela poder mostrar o caixa ao lado do lucro.
      cashUsd: acc ? Number(acc.cash_usd) : null,
    } as CohortDesk & { cashUsd: number | null };
  });

  /**
   * O QUE A VALIDAÇÃO DE ORDERBOOK JÁ VINHA DIZENDO — e ninguém lia.
   *
   * A sonda de profundidade roda desde 28/07 e gravou 4.085 medições em
   * `platform_events`. Todas com livro suficiente para os $50. Todas dizendo
   * que o líquido real era NEGATIVO enquanto o ledger anotava positivo.
   *
   * A medição existia, estava certa, e foi para um feed de eventos que ninguém
   * agrega. É o defeito mais caro desta semana inteira: não faltou instrumento,
   * faltou alguém ler o instrumento. Por isso ele agora sobe para o painel
   * junto do veredito, e não fica esperando ser procurado.
   */
  const { data: realismRows } = await db.from("platform_events")
    .select("metadata").eq("event_type", "arb_realism")
    .order("created_at", { ascending: false }).limit(5000);

  const amostras = (realismRows ?? [])
    .map((r) => (r as { metadata: Record<string, unknown> | null }).metadata)
    .filter((m): m is Record<string, unknown> => !!m)
    .map((m) => ({
      teorico: Number(m.theoreticalNet), real: Number(m.realisticNet),
      slippage: Number(m.slippage), cheio: m.fullyFilled === true,
      symbol: String(m.symbol ?? ""),
    }))
    .filter((x) => Number.isFinite(x.real) && Number.isFinite(x.teorico));

  const realism = amostras.length === 0 ? null : {
    samples: amostras.length,
    withDepth: amostras.filter((x) => x.cheio).length,
    avgTheoreticalPct: amostras.reduce((s, x) => s + x.teorico, 0) / amostras.length,
    avgRealisticPct: amostras.reduce((s, x) => s + x.real, 0) / amostras.length,
    avgSlippagePct: amostras.reduce((s, x) => s + x.slippage, 0) / amostras.length,
    // O número que responde tudo: quantas sobreviveram à profundidade.
    survivors: amostras.filter((x) => x.real > 0).length,
    symbols: new Set(amostras.map((x) => x.symbol)).size,
    // Quantas passariam do mínimo da mesa, não só "positivas". Das 17
    // positivas, 16 estavam entre +0.016% e +0.021% — zero dentro do
    // arredondamento. Contar essas como sobreviventes seria repetir, na
    // verificação, o mesmo otimismo que ela existe para pegar.
    passesGate: amostras.filter((x) => x.real >= MIN_NET_PCT).length,
    bySymbol: realismBySymbol(
      amostras.map((x) => ({ symbol: x.symbol, realisticNet: x.real, slippage: x.slippage })),
      MIN_NET_PCT,
    ).slice(0, 8),
  };

  const gatePct = COST_PCT + MIN_NET_PCT;
  const flags = auditCohort(desks, legs, Number.isFinite(minSpreadPct) ? minSpreadPct : 0, gatePct, liquidations);

  // As pernas por venue viajam junto: a marca diz QUE há concentração, e o
  // operador precisa ver ONDE para conferir na corretora.
  const porVenue = new Map<string, { compras: number; vendas: number }>();
  for (const l of legs) {
    const b = porVenue.get(l.buyVenue) ?? { compras: 0, vendas: 0 };
    b.compras++; porVenue.set(l.buyVenue, b);
    const s = porVenue.get(l.sellVenue) ?? { compras: 0, vendas: 0 };
    s.vendas++; porVenue.set(l.sellVenue, s);
  }

  return NextResponse.json({
    desks, flags, realism,
    readable: cohortReadable(flags),
    gatePct, minSpreadPct: Number.isFinite(minSpreadPct) ? minSpreadPct : null,
    liquidations, legs: legs.length,
    venues: [...porVenue.entries()]
      .map(([venue, v]) => ({ venue, ...v, total: v.compras + v.vendas }))
      .sort((a, b) => b.total - a.total),
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
