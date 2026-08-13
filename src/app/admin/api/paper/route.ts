import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { deskFor } from "@/lib/zion/desks";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { gateioSpot } from "@/lib/paper/engine";
import { readSilence, deskTickFrom, TICK_EVENT_BY_SOURCE, type DeskTick } from "@/lib/zion/silence";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** Realized equity curve (index 100 = starting) from closed positions in close
 *  order, downsampled to ≤40 points. */
function equityCurve(startingUsd: number, pts: Array<{ t: number; pnl: number }>, maxPts = 40): number[] {
  if (pts.length === 0 || !(startingUsd > 0)) return [];
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const eq: number[] = []; let cash = startingUsd;
  for (const p of sorted) { cash += p.pnl; eq.push((cash / startingUsd) * 100); }
  if (eq.length <= maxPts) return eq.map((v) => Math.round(v * 10) / 10);
  const step = (eq.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => Math.round(eq[Math.round(i * step)] * 10) / 10);
}

/**
 * Paper-trading dashboard — the Gate.io simulation at portfolio level, premium.
 * Per agent: equity marked-to-market on the LIVE Gate.io price, realized +
 * unrealized P&L, return, win-rate, avg win/loss, profit factor, best/worst
 * trade, open exposure + open book, and a realized equity curve.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  /**
   * ⚠️ A JANELA DO RASTRO — 24h, e o número tem motivo.
   *
   * `readSilence` recebe uma LISTA de ticks, nunca o último: um tick isolado
   * não distingue "seca de agora" de "seca sempre", e foi assim que a URÐR
   * quase foi desligada por estar cumprindo o mandato dela. Com as mesas
   * batendo a cada 30 min, 24h dá ~48 ticks — amostra suficiente para separar
   * o silêncio de uma rodada do silêncio de sempre.
   */
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [{ data: accounts }, open, closed, { data: ticksRaw }] = await Promise.all([
    db.from("paper_accounts").select("*"),
    selectAllRows<{ account_id: string; source: string; symbol: string; side: string; cost_usd: number; entry_price: number }>(
      (from, to) => db.from("paper_positions").select("account_id, source, symbol, side, cost_usd, entry_price")
        .eq("status", "open").is("archived_at", null).order("opened_at", { ascending: true }).range(from, to)),
    selectAllRows<{ account_id: string; symbol: string; side: string; pnl_usd: number | null; pnl_pct: number | null; exit_reason: string | null; closed_at: string | null }>(
      (from, to) => db.from("paper_positions").select("account_id, symbol, side, pnl_usd, pnl_pct, exit_reason, closed_at")
        .eq("status", "closed").is("archived_at", null).order("closed_at", { ascending: true }).range(from, to)),
    db.from("platform_events").select("event_type, metadata")
      .in("event_type", [...new Set(Object.values(TICK_EVENT_BY_SOURCE))])
      .gte("created_at", desde).limit(5000),
  ]);
  if (!accounts) return NextResponse.json({ error: "no_accounts" }, { status: 500 });

  const prices = await gateioSpot([...new Set(open.map((p) => p.symbol))]);

  // O rastro por tipo de evento. Mesas sem entrada aqui ficam com lista vazia,
  // e `readSilence` devolve `sem_rastro` — que é a resposta honesta: sem tick
  // nenhum, qualquer veredito sobre a mesa seria chute.
  const trilha = new Map<string, DeskTick[]>();
  for (const e of (ticksRaw ?? []) as Array<{ event_type: string; metadata: Record<string, unknown> | null }>) {
    const lista = trilha.get(e.event_type) ?? [];
    lista.push(deskTickFrom(e.event_type, e.metadata));
    trilha.set(e.event_type, lista);
  }

  /**
   * ⚠️ CADA MESA LÊ SÓ O RASTRO DELA — e isto não era verdade na primeira
   * versão desta rota (achado ao conferir contra o banco, 13/08).
   *
   * `arb2_window_empty` é emitido pelas TRÊS variantes do Arbiter 2.0, que se
   * identificam em `metadata.source`. Sem o filtro, cada uma somava os ticks
   * das outras duas e a tela dizia "nenhum candidato em **71** ticks" quando o
   * rastro real de cada uma tem 24.
   *
   * O veredito não mudava — as três estão secas de verdade — mas o número
   * mudava, e número errado numa frase que alguém vai citar é o começo de uma
   * investigação na direção errada. Quando a fonte não identifica a mesa
   * (`desk: null`), o tick vale para quem mapear nele: é o caso da arbiter 1×,
   * dona exclusiva de `arb_window_empty`.
   */
  const rastroDa = (source: string): DeskTick[] => {
    const ev = TICK_EVENT_BY_SOURCE[source];
    if (!ev) return [];
    return (trilha.get(ev) ?? []).filter((t) => t.desk == null || t.desk === source);
  };

  // Open book + unrealized (mark-to-market) + exposure per account.
  type OpenPos = { symbol: string; side: string; costUsd: number; unrealized: number };
  const unreal = new Map<string, number>(), exposure = new Map<string, number>(), openCount = new Map<string, number>();
  const openBook = new Map<string, OpenPos[]>();
  for (const p of open) {
    openCount.set(p.account_id, (openCount.get(p.account_id) ?? 0) + 1);
    exposure.set(p.account_id, (exposure.get(p.account_id) ?? 0) + Number(p.cost_usd));
    const cur = prices.get(p.symbol.toUpperCase());
    // arbiter2 cycles are hedged (long spot + short perp): directional MTM is
    // ~zero by construction — showing spot drift would invent P&L.
    const u = p.source === "arbiter2" || cur == null ? 0 : Number(p.cost_usd) * (((cur - Number(p.entry_price)) / Number(p.entry_price)) * (p.side === "buy" ? 1 : -1));
    unreal.set(p.account_id, (unreal.get(p.account_id) ?? 0) + u);
    const book = openBook.get(p.account_id) ?? []; book.push({ symbol: p.symbol, side: p.side, costUsd: Number(p.cost_usd), unrealized: u }); openBook.set(p.account_id, book);
  }

  // Closed-trade stats + curve points + recent fills per account. The recent
  // list is what makes the arbiter legible: its round-trips open and close in
  // the same instant, so the "open book" is (correctly) always empty — the
  // executed orders live here, route included (exit_reason "arb binance→okx").
  type RecentTrade = { symbol: string; side: string; pnlUsd: number; pnlPct: number | null; route: string | null; closedAt: string | null };
  type Closed = { pnls: number[]; pts: Array<{ t: number; pnl: number }>; recent: RecentTrade[] };
  const closedBy = new Map<string, Closed>();
  for (const c of closed) {
    const cb = closedBy.get(c.account_id) ?? { pnls: [], pts: [], recent: [] };
    const pnl = Number(c.pnl_usd) || 0;
    cb.pnls.push(pnl); cb.pts.push({ t: Date.parse(c.closed_at ?? ""), pnl });
    cb.recent.push({ symbol: c.symbol, side: c.side, pnlUsd: pnl, pnlPct: c.pnl_pct == null ? null : Number(c.pnl_pct), route: c.exit_reason, closedAt: c.closed_at });
    closedBy.set(c.account_id, cb);
  }

  const rows = accounts.map((a) => {
    const starting = Number(a.starting_usd);
    const realized = Number(a.realized_pnl_usd);
    const unrealized = unreal.get(a.id) ?? 0;
    /**
     * ⚠️⚠️ ESTE NÚMERO NÃO É O CAIXA, E A TELA DIZIA QUE ERA (05/08).
     *
     * `equity = capital + realizado + não-realizado` é a conta CONTÁBIL: o que
     * a carteira DEVERIA ter se nada tivesse vazado. A coluna `cash_usd` é o
     * que ela REALMENTE tem.
     *
     * Nas carteiras aposentadas as duas divergem brutalmente, e a tela mostrava
     * só a primeira:
     *
     *   oracle_mistral   equity exibido $1.001   ·   cash_usd real  $9,80
     *   deepseek_scan    equity exibido   $998   ·   cash_usd real  $0,40
     *   grok_scan        equity exibido   $994   ·   cash_usd real  $0,00
     *
     * O total do painel dizia PATRIMÔNIO $20.842. A soma real de `cash_usd` nas
     * 23 carteiras é ≈ $11.491. Nove mil e trezentos dólares de diferença, numa
     * tela que trazia um ✓ verde dizendo "caixa bate com os trades".
     *
     * O ✓ não estava mentindo por si: ele vem de `planRepair`, que por decisão
     * de 04/08 só olha as carteiras VIVAS. Nessas, bate mesmo. Só que ele era
     * exibido acima de uma lista com as 23, e lido como afirmação sobre todas.
     *
     * As aposentadas estarem furadas é DELIBERADO — é a cicatriz preservada do
     * vazamento de julho, e recreditá-las apagaria o registro. O defeito nunca
     * foi o buraco: foi a tela mostrar o valor contábil no lugar do caixa e
     * carimbar de "confere".
     *
     * Agora as duas viajam juntas, e o buraco é uma coluna.
     */
    const equity = starting + realized + unrealized;
    const cash = Number(a.cash_usd);
    // O que os trades justificam ter em caixa AGORA (posições abertas travam
    // capital, então elas saem da conta).
    const cashEsperado = starting + realized;
    const buracoUsd = cash - cashEsperado;
    const decided = Number(a.wins) + Number(a.losses);
    const cb = closedBy.get(a.id) ?? { pnls: [], pts: [], recent: [] };
    const wins = cb.pnls.filter((p) => p > 0), losses = cb.pnls.filter((p) => p < 0);
    const sumWin = wins.reduce((s, p) => s + p, 0), sumLoss = losses.reduce((s, p) => s + p, 0);

    /**
     * ⚠️⚠️ A LINHA DO PAINEL SOMAVA DOIS LIVROS DIFERENTES (13/08).
     *
     * `RET` e `WR` saem de `paper_accounts` (colunas `realized_pnl_usd`,
     * `wins`, `losses`). `FECH.`, `PROFIT F.`, `MELHOR`, `PIOR` e a curva saem
     * de `paper_positions` FILTRADO por `archived_at is null`. Os dois convivem
     * na MESMA linha, e ninguém tinha como saber que eram fontes distintas.
     *
     * Enquanto nada é arquivado, eles coincidem. Depois de um arquivamento,
     * divergem — e a divergência é permanente, porque `resetLedgers` (03/08)
     * zera as colunas da conta ao arquivar, mas o arquivamento de 28/07 é
     * ANTERIOR a esse módulo e arquivou as posições sem tocar nas contas.
     *
     * O resultado, hoje, na visão das mesas VIVAS:
     *
     *   HEIMDALL (radar)   RET −1,34%  ·  WR 39%  ·  FECH. 0
     *   JÖRMUNGANDR        RET  0,00%  ·  WR 100% ·  FECH. 0
     *
     * "Perdeu 1,34% em 33 decisões" e "não fechou nenhuma decisão" estão lado a
     * lado na mesma linha. Nenhum dos dois é mentira isolado; juntos são uma
     * contradição que a tela apresentava como um retrato só.
     *
     * ⚠️ E A CORREÇÃO NÃO É ESCOLHER UM DOS DOIS. A conta guarda a história
     * anterior ao arquivamento; o livro guarda o que ainda está sendo medido.
     * Apagar a conta perderia o passado, recalcular a conta a partir do livro
     * inventaria um passado que não houve. O que faltava era DIZER que são
     * dois — e por isso a divergência vira coluna, do mesmo jeito que o
     * `buracoUsd` do caixa virou em 05/08.
     */
    const decididosLivro = cb.pnls.length;
    const realizadoLivro = cb.pnls.reduce((s, p) => s + p, 0);
    const divTrades = decided - decididosLivro;
    const divUsd = realized - realizadoLivro;
    const divergencia = (divTrades === 0 && Math.abs(divUsd) < 0.01) ? null : {
      trades: divTrades,
      usd: Math.abs(divUsd) < 0.01 ? 0 : divUsd,
      livroTrades: decididosLivro,
      livroUsd: realizadoLivro,
    };

    /**
     * ⚠️ POR QUE ESTA MESA ESTÁ CALADA — a leitura que existia em código e não
     * chegava a nenhuma tela.
     *
     * `readSilence` foi escrito em 06/08 e até 13/08 seu único importador era o
     * próprio teste. Cinco silêncios que pedem ações OPOSTAS (disciplina pede
     * nada, fome pede capital, quebra pede código, seca pede investigar a
     * fonte, sem-rastro pede não julgar) continuavam aparecendo como uma coisa
     * só: "0 trades".
     *
     * A amostra fechada usada aqui é a do LIVRO VIVO, não a da conta: uma mesa
     * com contadores antigos e livro vazio está calada AGORA, e é sobre agora
     * que o veredito fala.
     */
    const silencio = readSilence(rastroDa(a.source), cash, openCount.get(a.id) ?? 0, decididosLivro);

    return {
      source: a.source, label: a.label,
      startingUsd: starting, cashUsd: cash, equity,
      /**
       * ⚠️ APOSENTADA? — decisão do dono, 05/08: "mesa aposentada vira arquivo".
       *
       * Elas ocupavam 10 das 23 linhas e apareciam em vermelho como se
       * tivessem perdido operando, quando o buraco delas é a cicatriz
       * PRESERVADA do vazamento de julho. Mesa fora do registro conta como
       * VIVA: o desconhecido não ganha dispensa.
       */
      retired: deskFor(a.source)?.status === "valhalla",
      /** O caixa que os trades justificam, e o buraco entre ele e o real. */
      cashEsperadoUsd: cashEsperado,
      buracoUsd: Math.abs(buracoUsd) < 0.01 ? 0 : buracoUsd,
      realizedPnl: realized, unrealizedPnl: unrealized,
      returnPct: (equity / starting - 1) * 100,
      wins: Number(a.wins), losses: Number(a.losses),
      winRate: decided > 0 ? (Number(a.wins) / decided) * 100 : null,
      avgWin:  wins.length   ? sumWin / wins.length   : null,
      avgLoss: losses.length ? sumLoss / losses.length : null,
      profitFactor: sumLoss < 0 ? sumWin / Math.abs(sumLoss) : null,
      best:  cb.pnls.length ? Math.max(...cb.pnls) : null,
      worst: cb.pnls.length ? Math.min(...cb.pnls) : null,
      closedTrades: cb.pnls.length,
      openPositions: openCount.get(a.id) ?? 0,
      exposure: exposure.get(a.id) ?? 0,
      divergencia, silencio,
      openBook: (openBook.get(a.id) ?? []).sort((x, y) => y.costUsd - x.costUsd).slice(0, 6),
      recentTrades: cb.recent.slice(-8).reverse(), // newest first
      curve: equityCurve(starting, cb.pts),
    };
  // Rank by RETURN %, not absolute equity — wallets start with different
  // capital (arbiter2 seeds at the real-deposit $300 vs $1000 elsewhere), and
  // absolute equity would pin a smaller-seeded desk to the bottom forever.
  }).sort((x, y) => y.returnPct - x.returnPct || y.equity - x.equity);

  const totals = {
    startingUsd:   rows.reduce((s, r) => s + r.startingUsd, 0),
    equity:        rows.reduce((s, r) => s + r.equity, 0),
    /**
     * ⚠️ O CAIXA REAL SOMADO, ao lado do contábil (05/08).
     *
     * `equity` somava $20.842 enquanto o caixa real somava ≈$11.491, e só o
     * primeiro aparecia — sob um ✓ verde de "caixa bate". Um total que ignora a
     * coluna do caixa não pode ser o único total de um painel de carteiras.
     */
    cashUsd:       rows.reduce((s, r) => s + r.cashUsd, 0),
    buracoUsd:     rows.reduce((s, r) => s + r.buracoUsd, 0),
    /** Quantas carteiras têm buraco — o número que resume a honestidade da tela. */
    comBuraco:     rows.filter((r) => r.buracoUsd < -0.01).length,
    realizedPnl:   rows.reduce((s, r) => s + r.realizedPnl, 0),
    openPositions: rows.reduce((s, r) => s + r.openPositions, 0),
    exposure:      rows.reduce((s, r) => s + r.exposure, 0),
    closedTrades:  rows.reduce((s, r) => s + r.closedTrades, 0),
    /** Quantas linhas somam dois livros — o resumo da contradição acima. */
    comDivergencia: rows.filter((r) => r.divergencia != null).length,
    /** Mesas VIVAS caladas por um motivo que pede ação. Disciplina não conta. */
    comProblema: rows.filter((r) => !r.retired && r.silencio.isProblem).length,
  };

  return NextResponse.json({ rows, totals, fetchedAt: new Date().toISOString() });
}
