import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { deskFor } from "@/lib/zion/desks";
import { STRAT_MECH, STRAT_AI, STRAT_DAY } from "@/lib/zion/ragnarok";
import { STRAT_DEX } from "@/lib/zion/ragnarok-dex";

export const dynamic = "force-dynamic";

/**
 * O PLACAR DO RAGNARÖK (docs/PLANO-RAGNAROK.md, S5).
 *
 * Responde as duas perguntas do experimento, lado a lado:
 *
 *   1. QUAL ESTRATÉGIA PAGA? — quebra o resultado por playbook
 *      (range / pullback / reversão). O `kind` da suggestion carrega o playbook,
 *      então dá pra ver se o mercado lateral — que o funil antigo descartava
 *      inteiro — é justamente onde mora o dinheiro.
 *
 *   2. A IA BATE O BOT? — VÖLUNDR (mecânico, zero token) contra MÍMIR (IA), no
 *      MESMO mercado e no MESMO tick.
 *
 * A régua principal é a CARTEIRA (USDT acumulado), não o win-rate: o mandato
 * desta mesa é aumentar a quantidade de USDT, então é isso que se mede.
 */

const COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);
// As quatro mesas do Ragnarök. Cada uma isola UMA variável contra o mesmo
// seletor: MECH é o controle, AI troca o cérebro, DEX troca a praça, DAY troca
// o relógio. Só uma variável por mesa — é o que torna o resultado legível.
const SOURCES = [STRAT_MECH, STRAT_AI, STRAT_DEX, STRAT_DAY];

type SugRow = { source: string; kind: string; status: string; outcome_pct: number | null; created_at: string };
type PosRow = { source: string; pnl_usd: number | null; pnl_pct: number | null; status: string; closed_at: string | null };

interface Bucket { trades: number; wins: number; losses: number; open: number; sum: number }
const empty = (): Bucket => ({ trades: 0, wins: 0, losses: 0, open: 0, sum: 0 });

function summarize(b: Bucket) {
  const decided = b.wins + b.losses;
  return {
    trades: b.trades, open: b.open, decided,
    wins: b.wins, losses: b.losses,
    winRate: decided > 0 ? b.wins / decided : null,
    // Expectancy LÍQUIDA por trade resolvido — a mesma régua honesta do resto
    // do flywheel (nunca a bruta).
    netPerTrade: b.trades - b.open > 0 ? b.sum / (b.trades - b.open) - COST_PCT : null,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "");
  const days = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 3650 ? rawDays : null;
  const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const sug = await selectAllRows<SugRow>((from, to) => {
    let q = db.from("zion_suggestions")
      .select("source, kind, status, outcome_pct, created_at")
      .in("source", SOURCES)
      .is("archived_at", null)
      .order("created_at", { ascending: true }).range(from, to);
    if (since) q = q.gte("created_at", since);
    return q;
  });

  const [{ data: positions }, { data: accounts }] = await Promise.all([
    db.from("paper_positions").select("source, pnl_usd, pnl_pct, status, closed_at").in("source", SOURCES).is("archived_at", null).limit(5000),
    db.from("paper_accounts").select("source, starting_usd, cash_usd, realized_pnl_usd, wins, losses").in("source", SOURCES),
  ]);

  // ── Por PLAYBOOK (qual estratégia paga?) — mecânico e IA somados, porque a
  //    pergunta aqui é sobre a ESTRATÉGIA, não sobre quem a escolheu.
  const byPlaybook = new Map<string, Bucket>();
  // ── Por MESA (a IA bate o bot?)
  const byDesk = new Map<string, Bucket>();
  // ── Cruzamento mesa × playbook: mostra SE a IA muda a escolha de estratégia.
  const cross = new Map<string, Bucket>();

  for (const r of sug) {
    for (const [map, key] of [
      [byPlaybook, r.kind] as const,
      [byDesk, r.source] as const,
      [cross, `${r.source}|${r.kind}`] as const,
    ]) {
      const b = map.get(key) ?? empty();
      b.trades++;
      if (r.status === "open") b.open++;
      else {
        b.sum += Number(r.outcome_pct) || 0;
        if (r.status === "hit_target" || r.status === "win") b.wins++;
        else if (r.status === "hit_stop" || r.status === "loss") b.losses++;
      }
      map.set(key, b);
    }
  }

  // ── A RÉGUA PRINCIPAL: quanto USDT cada mesa tem hoje.
  const wallets = (accounts ?? []).map((a) => {
    const mine = (positions ?? []).filter((p: PosRow) => p.source === a.source);
    const closed = mine.filter((p) => p.status === "closed");
    const starting = Number(a.starting_usd) || 1000;
    const realized = Number(a.realized_pnl_usd) || 0;
    const d = deskFor(a.source);
    return {
      source: a.source,
      name: d ? `${d.sigil} ${d.name}` : a.source,
      who: d?.who ?? null,
      brain: d?.brain ?? null,
      startingUsd: starting,
      // USDT na mão = o que o mandato pede. Sem posição aberta marcada a
      // mercado aqui de propósito: acumulação se mede no que JÁ foi realizado.
      usdt: starting + realized,
      realizedPnl: realized,
      growthPct: starting > 0 ? (realized / starting) * 100 : 0,
      closedTrades: closed.length,
      openPositions: mine.filter((p) => p.status === "open").length,
    };
  }).sort((x, y) => y.usdt - x.usdt);

  const playbooks = [...byPlaybook.entries()]
    .map(([playbook, b]) => ({ playbook, ...summarize(b) }))
    .sort((x, y) => (y.netPerTrade ?? -99) - (x.netPerTrade ?? -99));

  // Cada mesa declara qual variável ela isola — o painel mostra isso ao lado do
  // número, senão a comparação vira "quatro linhas parecidas".
  const VARIABLE: Record<string, string> = {
    [STRAT_MECH]: "controle · sem IA, CEX, 48h",
    [STRAT_AI]:   "troca o CÉREBRO (IA decide)",
    [STRAT_DEX]:  "troca a PRAÇA (on-chain)",
    [STRAT_DAY]:  "troca o RELÓGIO (8h)",
  };
  const desks = SOURCES.map((source) => {
    const d = deskFor(source);
    return {
      source,
      name: d ? `${d.sigil} ${d.name}` : source,
      brain: d?.brain ?? null,
      venue: d?.venue ?? null,
      variable: VARIABLE[source] ?? null,
      ...summarize(byDesk.get(source) ?? empty()),
      byPlaybook: [...cross.entries()]
        .filter(([k]) => k.startsWith(`${source}|`))
        .map(([k, b]) => ({ playbook: k.split("|")[1], ...summarize(b) }))
        .sort((x, y) => y.trades - x.trades),
    };
  });

  return NextResponse.json({
    wallets, playbooks, desks,
    windowDays: days,
    note: "A régua é USDT acumulado. Win-rate é secundário — o mandato é aumentar a quantidade de USDT.",
    fetchedAt: new Date().toISOString(),
  });
}
