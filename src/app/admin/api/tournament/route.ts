import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { nEfetivo, porQueCoorteMenor, type TradeCorrelacionavel } from "@/lib/zion/amostra-efetiva";
import { DESKS as DESK_LIST, deskFor, type Desk } from "@/lib/zion/desks";
import { CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";
import { lerPontas, retornoDeSegurar, confrontar } from "@/lib/zion/comprar-e-segurar";

export const dynamic = "force-dynamic";

// Round-trip execution cost netted out of expectancy (mirrors backtest.ts /
// the Backtest panel) so the tournament ranks agents by the edge a user KEEPS,
// not the gross paper edge. Default 0.2%.
const ROUND_TRIP_COST_PCT = CUSTO_IDA_E_VOLTA_PCT;
const MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100);

// Nomes e taxonomia vêm do REGISTRO DE MESAS (src/lib/zion/desks.ts) — fonte
// única. Antes cada painel tinha a sua própria tabelinha de nomes e elas
// divergiam; agora renomear uma mesa é editar UM arquivo.
function kindOf(d: Desk): string {
  if (d.direction === "market_neutral") return "desk";
  if (d.brain === "none") return "strat";
  if (d.source.startsWith("oracle_")) return "oracle";
  if (d.status === "valhalla") return "retired";
  return d.source === "hybrid_scan" ? "agent" : "model";
}

// Zero-LLM desks: no zion_suggestions rows — their whole ledger IS the paper
// book, so their tournament line is built from closed paper positions
// (pnl_pct is already NET of the desk's own cost model).
const NEUTRAL_DESKS = DESK_LIST.filter((d) => d.direction === "market_neutral");

/** A ficha da mesa que vai junto de cada linha: COMO opera, ONDE, com que
 *  cérebro e o que está testando. É isso que permite ao painel parar de
 *  comparar day trade com swing na mesma régua. */
function taxonomy(source: string) {
  const d = deskFor(source);
  return {
    style: d?.style ?? null, venue: d?.venue ?? null,
    direction: d?.direction ?? null, brain: d?.brain ?? null,
    model: d?.model ?? null, tests: d?.tests ?? null,
    who: d?.who ?? null, horizonHours: d?.horizonHours ?? null,
    status: d?.status ?? null,
  };
}

function labelFor(source: string): { name: string; kind: string } {
  const d = deskFor(source);
  return d ? { name: `${d.sigil} ${d.name}`, kind: kindOf(d) } : { name: source, kind: "other" };
}

type Agg = {
  source: string; name: string; kind: string;
  total: number; open: number; resolved: number;
  wins: number; losses: number; expired: number;
  sum: number; winSum: number; lossSum: number;
  rrSum: number; rrCount: number;
  probSum: number; probCount: number;   // stated-confidence calibration
  form: string[];                        // recent decided outcomes ("W"/"L")
  curvePts: Array<{ t: number; net: number }>; // resolved trades for the equity curve
  /** Os decididos com símbolo + playbook + instante, para a amostra EFETIVA. */
  decididos: TradeCorrelacionavel[];
};

function downsample(eq: number[], maxPts: number): number[] {
  if (eq.length <= maxPts) return eq.map((v) => Math.round(v * 10) / 10);
  const step = (eq.length - 1) / (maxPts - 1);
  const out: number[] = [];
  for (let i = 0; i < maxPts; i++) out.push(Math.round(eq[Math.round(i * step)] * 10) / 10);
  return out;
}

/** Compound an equity curve (index 100) from resolved trades in resolution
 *  order (each trade's NET return), then downsample for a lean sparkline. */
function equityCurve(pts: Array<{ t: number; net: number }>, maxPts = 40): number[] {
  if (pts.length === 0) return [];
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const eq: number[] = []; let e = 100;
  for (const p of sorted) { e *= 1 + p.net / 100; eq.push(e); }
  return downsample(eq, maxPts);
}

/** Realized equity curve for a PAPER wallet: index 100 = starting capital,
 *  running cumulative realized P&L over its closed positions (in close order). */
function paperCurve(startingUsd: number, pts: Array<{ t: number; pnl: number }>, maxPts = 40): number[] {
  if (pts.length === 0 || !(startingUsd > 0)) return [];
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const eq: number[] = []; let cash = startingUsd;
  for (const p of sorted) { cash += p.pnl; eq.push((cash / startingUsd) * 100); }
  return downsample(eq, maxPts);
}

/** Tournament ranking: every logging source (Agent A / Agent B / each raw
 *  tournament model / radar) scored head-to-head on the SAME market, ranked by
 *  NET expectancy. This is the leaderboard that decides which brain wins. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  // Time window (27/07) — see the note in admin/api/backtest: the live round
  // holds several config eras, and a lifetime average hides whether a fix
  // worked. Suggestions cut by created_at (the config that produced the
  // card); desk cycles by closed_at (they open and close in the same tick).
  const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "");
  const days = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 3650 ? rawDays : null;
  const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  // Paginated full read (A1): PostgREST caps a plain select at 1000 rows with
  // no error — a truncated ledger would rank the agents on stale data.
  type TourRow = { source: string | null; status: string; outcome_pct: number | null; probability: number | null; entry_price: number | null; target_price: number | null; stop_price: number | null; created_at: string; resolved_at: string | null;
    /** ⚠️ Carregados desde 15/08 SÓ para a amostra efetiva — sem eles não dá
     *  para saber se dois trades são a mesma ideia. */
    symbol: string | null; kind: string | null;
    /** ⚠️ Desde 16/08: separa rodada viva de vida inteira NA MEMÓRIA, em vez
     *  de o banco decidir por nós e sumir com 2.114 decididos. */
    archived_at: string | null };
  /**
   * ⚠️⚠️ UMA LEITURA, DUAS VERDADES — e a linha que escondia 2.114 decididos.
   *
   * Até 16/08 esta consulta trazia `.is("archived_at", null)`: só a rodada
   * viva. A intenção era boa (o arquivo é história, e uma média vitalícia
   * esconde se um conserto funcionou). O efeito na tela não era:
   *
   *     GERI       torneio +7,040%  ·  1 decidido   │  arquivado: 691 a −0,517%
   *     SLEIPNIR   torneio +2,410%  ·  1 decidido   │  arquivado: 862 a −0,592%
   *     MUNINN     torneio +0,903%  ·  3 decididos  │  arquivado: 367 a −0,831%
   *
   * Uma mesa com 862 trades a −0,59% aparecia como "+2,41%, 1 trade" e podia
   * ganhar medalha. O dono viu antes de mim: *"essa amostra de 1 decidido vem
   * depois de centenas decididos historicamente"*. Estava certo.
   *
   * ⚠️ O CONSERTO NÃO É APAGAR O FILTRO — é mostrar as DUAS. A rodada viva
   * continua sendo o número que responde "o conserto funcionou?"; a vida
   * inteira responde "esta mesa já provou alguma coisa?". Trocar uma pela
   * outra só inverteria qual mentira a tela conta.
   *
   * ⚠️ E É UMA LEITURA SÓ. Duas consultas custariam o dobro e poderiam
   * divergir entre si por um trade que resolveu no meio; aqui os dois números
   * saem exatamente das mesmas linhas, separados em memória.
   *
   * ⚠️ A VIDA INTEIRA IGNORA A JANELA DE PROPÓSITO. "Vida inteira dos últimos
   * 7 dias" não é vida inteira, é a mesma janela com outro nome — e um rótulo
   * que mente é pior que uma coluna a menos.
   */
  const rows = await selectAllRows<TourRow>((from, to) =>
    db.from("zion_suggestions")
      .select("source, status, outcome_pct, probability, entry_price, target_price, stop_price, created_at, resolved_at, symbol, kind, archived_at")
      .order("created_at", { ascending: true }).range(from, to),
  );

  /** Esta linha conta para a RODADA VIVA? (não arquivada e dentro da janela) */
  const naRodadaViva = (r: TourRow): boolean =>
    r.archived_at == null && (since === null || r.created_at >= since);

  // Paper wallets (Gate.io sim) — realized equity curve per source, shown beside
  // the flywheel curve once a wallet has matured (enough closed positions).
  // leitura-limitada: o torneio mostra a curva das mesas na tela. O ranking
  // que DECIDE corte de agente vive em `cull.ts`, que lê paginado.
  const paperClosedQ = db.from("paper_positions").select("source, pnl_usd, pnl_pct, closed_at").eq("status", "closed").is("archived_at", null).order("closed_at", { ascending: true }).limit(5000);
  const [{ data: paperClosedRows }, { data: paperAccts }, { data: deskOpenRows }] = await Promise.all([
    since ? paperClosedQ.gte("closed_at", since) : paperClosedQ,
    db.from("paper_accounts").select("source, starting_usd"),
    // leitura-limitada: só a contagem de abertas por mesa para o rodapé.
    // inclui-arquivadas: irrelevante aqui — uma posição arquivada E aberta não
    // deveria existir, e se existir, aparecer no contador é o comportamento
    // desejado (é sintoma, não ruído).
    db.from("paper_positions").select("source").eq("status", "open").in("source", DESK_LIST.filter((d) => d.direction === "market_neutral").map((d) => d.source)),
  ]);
  const startingBy = new Map<string, number>((paperAccts ?? []).map((a) => [a.source, Number(a.starting_usd) || 1000]));

  /**
   * ⚠️⚠️ COMPRAR E SEGURAR — a régua que faltava (20/08).
   *
   * Nos sete dias até 20/08 as carteiras fecharam no positivo: SKAÐI +$14,92,
   * radar +$14,00, GERI +$13,98, VÖLUNDR +$9,96, com 29, 14, 18 e 17 posições.
   * Dinheiro de verdade. No MESMO período BTC fez +15,03% e ETH +23,34% — os
   * mesmos $1.000 parados em BTC dariam +$150, dez vezes a melhor mesa.
   *
   * O painel sabia dizer "está lucrando" e não sabia dizer "está lucrando MENOS
   * que parado". São frases diferentes e a segunda é a que decide.
   *
   * ⚠️ A referência usa os símbolos QUE A PRÓPRIA MESA OPEROU, não o BTC.
   * Comparar mesa de altcoin com "segurar BTC" mistura duas decisões — qual
   * ativo e quando entrar. Assim isola a segunda.
   */
  const simbolosPorMesa = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.source || !r.symbol || !naRodadaViva(r)) continue;
    const set = simbolosPorMesa.get(r.source) ?? new Set<string>();
    set.add(r.symbol.toUpperCase());
    simbolosPorMesa.set(r.source, set);
  }

  /**
   * ⚠️ TETO DE SÍMBOLOS POR MESA, e um cache por símbolo. Sem os dois, uma mesa
   * que tocou 60 tickers dispararia 60 chamadas de rede a cada abertura do
   * painel — e o custo apareceria como lentidão, não como erro.
   */
  const TETO_SIMBOLOS = 8;
  const janelaDias = days ?? 7;
  const unicos = [...new Set([...simbolosPorMesa.values()].flatMap((s) => [...s].slice(0, TETO_SIMBOLOS)))];
  const pontasPorSimbolo = new Map(
    (await Promise.all(unicos.map((sym) => lerPontas(sym, janelaDias)))).map((p) => [p.simbolo, p]),
  );

  /**
   * O confronto de uma mesa com "e se eu só tivesse segurado?".
   *
   * ⚠️⚠️ AS DUAS PONTAS TÊM DE ESTAR NA MESMA BASE, e é aqui que a comparação
   * mais falha. O torneio mede a mesa em **% líquido POR TRADE**; a referência é
   * **% do capital na janela**. Confrontar os dois diretamente compararia
   * "+1,5% por operação" com "+15% no período" — números de unidades diferentes,
   * e a mesa pareceria dez vezes pior ou melhor conforme quantas vezes operou.
   *
   * Por isso a mesa entra pelo USDT REALIZADO sobre o capital inicial: é a
   * mesma pergunta que se faz de segurar — quanto sobrou de quanto se pôs.
   *
   * ⚠️ SEM CARTEIRA, SEM CONFRONTO. Mesa sem posição fechada na janela devolve
   * `null`, e não zero: não ter operado é diferente de ter operado e empatado.
   */
  const confrontoDe = (source: string) => {
    const fechadas = (paperClosedRows ?? []).filter((r) => r.source === source);
    if (fechadas.length === 0) return null;

    const capital = startingBy.get(source) ?? 1000;
    if (!(capital > 0)) return null;

    const usdt = fechadas.reduce((acc, r) => acc + (Number(r.pnl_usd) || 0), 0);
    const mesaPct = usdt / capital * 100;

    const simbolos = [...(simbolosPorMesa.get(source) ?? [])].slice(0, TETO_SIMBOLOS);
    const pontas = simbolos
      .map((sym) => pontasPorSimbolo.get(sym))
      .filter((p): p is NonNullable<typeof p> => p != null);
    if (pontas.length === 0) return null;

    const ref = retornoDeSegurar(pontas);
    return { ...confrontar(mesaPct, ref), usdt, fechadas: fechadas.length, janelaDias };
  };

  const paperPtsBy = new Map<string, Array<{ t: number; pnl: number }>>();
  for (const r of paperClosedRows ?? []) {
    const arr = paperPtsBy.get(r.source) ?? [];
    arr.push({ t: Date.parse(r.closed_at ?? ""), pnl: Number(r.pnl_usd) || 0 });
    paperPtsBy.set(r.source, arr);
  }

  const by = new Map<string, Agg>();
  const get = (source: string): Agg => {
    let a = by.get(source);
    if (!a) {
      const { name, kind } = labelFor(source);
      a = { source, name, kind, total: 0, open: 0, resolved: 0, wins: 0, losses: 0, expired: 0, sum: 0, winSum: 0, lossSum: 0, rrSum: 0, rrCount: 0, probSum: 0, probCount: 0, form: [], curvePts: [], decididos: [] };
      by.set(source, a);
    }
    return a;
  };

  /**
   * ⚠️ A VIDA INTEIRA — o balde que faltava. Acumula TODA linha, arquivada ou
   * não, dentro ou fora da janela. É o que responde "esta mesa já provou
   * alguma coisa?" quando a rodada viva tem um decidido só.
   */
  const vida = new Map<string, { decididos: number; soma: number }>();

  /** Todos os decididos da rodada viva, SEM separar por mesa. Ver a nota em
   *  `porQueCoorteMenor`: a correlação que engana está entre mesas. */
  const decididosDaCoorte: TradeCorrelacionavel[] = [];

  for (const r of rows) {
    if (r.status === "hit_target" || r.status === "hit_stop") {
      const v = vida.get(r.source ?? "user") ?? { decididos: 0, soma: 0 };
      v.decididos++; v.soma += typeof r.outcome_pct === "number" ? r.outcome_pct : 0;
      vida.set(r.source ?? "user", v);
    }
    // ⚠️ A partir daqui é SÓ rodada viva — todo campo já existente continua
    // significando exatamente o que significava antes de 16/08.
    if (!naRodadaViva(r)) continue;

    const a = get(r.source ?? "user");
    a.total++;
    if (typeof r.probability === "number") { a.probSum += r.probability; a.probCount++; }
    if (r.entry_price != null && r.target_price != null && r.stop_price != null) {
      const risk = Math.abs(r.entry_price - r.stop_price);
      if (risk > 0) { a.rrSum += Math.abs(r.target_price - r.entry_price) / risk; a.rrCount++; }
    }
    if (r.status === "open") { a.open++; continue; }
    a.resolved++;
    const oc = typeof r.outcome_pct === "number" ? r.outcome_pct : 0;
    a.sum += oc;
    // Equity-curve point: this trade's NET return, at its resolution time.
    a.curvePts.push({ t: Date.parse(r.resolved_at ?? r.created_at), net: oc - ROUND_TRIP_COST_PCT });
    if (r.status === "win" || r.status === "hit_target")      { a.wins++;   a.winSum  += oc; a.form.push("W"); }
    else if (r.status === "loss" || r.status === "hit_stop")  { a.losses++; a.lossSum += oc; a.form.push("L"); }
    else a.expired++;
    /**
     * ⚠️ OS DECIDIDOS GUARDADOS INTEIROS, para a amostra efetiva.
     *
     * Contar `wins + losses` diz quantas LINHAS existem; não diz quantas IDEIAS.
     * Em 15/08 quatro decididos eram duas ideias — três deles eram o mesmo OP,
     * mesmo playbook, mesma manhã. Sem símbolo e playbook aqui, não há como
     * distinguir uma coisa da outra.
     */
    if (r.status === "hit_target" || r.status === "hit_stop") {
      const ideia = {
        symbol: r.symbol, kind: r.kind,
        resolvidoEmMs: Date.parse(r.resolved_at ?? r.created_at),
      };
      a.decididos.push(ideia);
      /**
       * ⚠️ E A MESMA LINHA VAI PARA A COORTE, SEM O `source`.
       *
       * É essa a diferença inteira: agrupar por símbolo+playbook+janela DENTRO
       * de uma mesa perde os três UNI `sell_safe` de 14/08, porque eles estão
       * em três mesas. Sem o `source`, eles colapsam no que são — um movimento.
       */
      decididosDaCoorte.push(ideia);
    }
  }

  const agents = [...by.values()].map((a) => {
    const decided = a.wins + a.losses;
    const efetivo = nEfetivo(a.decididos);
    const gross = a.resolved > 0 ? a.sum / a.resolved : null;
    const winRate = decided > 0 ? a.wins / decided : null;
    const avgConfidence = a.probCount > 0 ? a.probSum / a.probCount : null;
    return {
      source: a.source, name: a.name, kind: a.kind,
      total: a.total, open: a.open, resolved: a.resolved,
      wins: a.wins, losses: a.losses, expired: a.expired,
      winRate,
      expectancy:    gross,                                   // gross, per resolved
      expectancyNet: gross === null ? null : gross - ROUND_TRIP_COST_PCT,
      /**
       * ⚠️ O QUE A MESA JÁ FEZ NA VIDA — arquivo incluído, janela ignorada.
       *
       * Sem isto a GERI é "+7,04% com 1 decidido"; com isto é "+7,04% com 1
       * decidido, depois de 692 decididos a −0,52% líquido". O segundo é a
       * mesma verdade com o contexto que muda a decisão.
       */
      vidaInteira: (() => {
        const v = vida.get(a.source);
        if (!v || v.decididos === 0) return null;
        const brutoVida = v.soma / v.decididos;
        return {
          decididos: v.decididos,
          bruto: brutoVida,
          liquido: brutoVida - ROUND_TRIP_COST_PCT,
          /** Quantos decididos a rodada viva NÃO está mostrando. */
          ocultos: Math.max(0, v.decididos - (a.wins + a.losses)),
        };
      })(),
      avgWin:        a.wins   > 0 ? a.winSum  / a.wins   : null,
      avgLoss:       a.losses > 0 ? a.lossSum / a.losses : null,
      profitFactor:  a.lossSum < 0 ? a.winSum / Math.abs(a.lossSum) : null,
      avgRR:         a.rrCount > 0 ? a.rrSum / a.rrCount : null,
      avgConfidence,                                          // mean stated probability
      // Calibration: actual win% minus stated confidence. + = under-confident
      // (better than it claims), − = over-confident (worse than it claims).
      calibration:   winRate != null && avgConfidence != null ? winRate * 100 - avgConfidence : null,
      form:          a.form.slice(-12),                       // recent W/L streak
      curve:         equityCurve(a.curvePts),                 // flywheel signal-edge curve (index 100)
      paperCurve:    paperCurve(startingBy.get(a.source) ?? 1000, paperPtsBy.get(a.source) ?? []),
      paperClosed:   (paperPtsBy.get(a.source) ?? []).length, // "matured" gate on the client
      /** Quanto da maré a mesa capturou — ver o bloco de COMPRAR E SEGURAR. */
      contraSegurar: confrontoDe(a.source),
      /**
       * ⚠️ O PISO DE AMOSTRA OLHA A IDEIA, NÃO A LINHA (15/08).
       *
       * `decided` conta quantas linhas resolveram; `efetivo` conta quantas
       * vezes o MERCADO falou. Três trades do mesmo símbolo, mesmo playbook e
       * mesma manhã são uma fala só, e tratá-los como três confirmações
       * independentes é o que colocava medalha em coincidência.
       *
       * ⚠️ A EXPECTÂNCIA ACIMA NÃO MUDA. Correlação não enviesa a média — ela
       * infla a CONFIANÇA. Mexer no número seria consertar a coisa errada.
       */
      decidedEffective: efetivo,
      sufficientSample: efetivo >= MIN_SAMPLE,
      sampleProgress: Math.min(1, efetivo / MIN_SAMPLE),
      ...taxonomy(a.source),
    };
  });

  // Desk rows (arbiter/arbiter2): built from the paper book itself.
  const deskOpenBy = new Map<string, number>();
  for (const r of deskOpenRows ?? []) deskOpenBy.set(r.source, (deskOpenBy.get(r.source) ?? 0) + 1);
  for (const d of NEUTRAL_DESKS) {
    const source = d.source;
    const meta = { name: `${d.sigil} ${d.name}`, kind: "desk" };
    const closedRows = (paperClosedRows ?? []).filter((r) => r.source === source && r.pnl_pct != null);
    const open = deskOpenBy.get(source) ?? 0;
    if (closedRows.length === 0 && open === 0) continue; // desk never traded — no row
    const pcts = closedRows.map((r) => Number(r.pnl_pct));
    const wins = pcts.filter((p) => p > 0), losses = pcts.filter((p) => p <= 0);
    const decided = pcts.length;
    const net = decided > 0 ? pcts.reduce((s, p) => s + p, 0) / decided : null;
    agents.push({
      source, name: meta.name, kind: meta.kind,
      total: decided + open, open, resolved: decided,
      wins: wins.length, losses: losses.length, expired: 0,
      winRate: decided > 0 ? wins.length / decided : null,
      expectancy: net, expectancyNet: net, // paper pnl_pct is already net of the desk's cost model
      /**
       * ⚠️ MESA NEUTRA NÃO TEM "VIDA INTEIRA" AQUI, e é declaração.
       *
       * O ledger dela é a carteira de papel, e `paperClosedRows` já vem
       * filtrado por `archived_at is null`. Fabricar um número de vida inteira
       * a partir do que temos em mãos daria um valor que parece a mesma coluna
       * das outras mesas e mede outra coisa — exatamente a divergência
       * silenciosa que este campo existe para acabar.
       */
      vidaInteira: null,
      avgWin:  wins.length   ? wins.reduce((s, p) => s + p, 0) / wins.length     : null,
      avgLoss: losses.length ? losses.reduce((s, p) => s + p, 0) / losses.length : null,
      profitFactor: losses.length ? wins.reduce((s, p) => s + p, 0) / Math.abs(losses.reduce((s, p) => s + p, 0)) : null,
      avgRR: null, avgConfidence: null, calibration: null,
      form: closedRows.slice(-12).map((r) => (Number(r.pnl_pct) > 0 ? "W" : "L")),
      curve: equityCurve(closedRows.map((r) => ({ t: Date.parse(r.closed_at ?? ""), net: Number(r.pnl_pct) }))),
      paperCurve: paperCurve(startingBy.get(source) ?? 1000, paperPtsBy.get(source) ?? []),
      paperClosed: (paperPtsBy.get(source) ?? []).length,
      contraSegurar: confrontoDe(source),
      /**
       * ⚠️ AS MESAS NEUTRAS NÃO SÃO AGRUPADAS — e isto é declaração, não
       * esquecimento (15/08).
       *
       * A amostra efetiva agrupa por símbolo + playbook + janela, e essas três
       * coisas vivem em `zion_suggestions`. Um ciclo de arbitragem vem do livro
       * de PAPEL, que não carrega playbook: não há como dizer se dois ciclos são
       * a mesma ideia sem inventar o critério.
       *
       * Então aqui o efetivo é IGUAL ao bruto. É a direção otimista, e está
       * escrita: quando um arbiter voltar a operar, esta linha precisa de um
       * agrupamento próprio antes de o número dela valer como amostra.
       */
      decidedEffective: decided,
      sufficientSample: decided >= MIN_SAMPLE,
      sampleProgress: Math.min(1, decided / MIN_SAMPLE),
      ...taxonomy(source),
    });
  }

  // Rank by NET expectancy (nulls last), then by decided-sample as tiebreak so
  // a well-tested agent outranks a lucky one-shot with the same headline.
  agents.sort((x, y) => {
    const xn = x.expectancyNet, yn = y.expectancyNet;
    if (xn === null && yn === null) return (y.wins + y.losses) - (x.wins + x.losses);
    if (xn === null) return 1;
    if (yn === null) return -1;
    if (yn !== xn) return yn - xn;
    return (y.wins + y.losses) - (x.wins + x.losses);
  });

  // ── ⚔️ VALHALLA ───────────────────────────────────────────────────────────
  // A rodada direcional (bracket long/short) foi arquivada em 28/07. Os
  // guerreiros NÃO estão mortos — caíram em batalha e descansam em Valhalla,
  // esperando Ragnarök (a próxima rodada, com um mandato diferente). A epígrafe
  // é o registro HONESTO da vida inteira deles (todas as suggestions arquivadas).
  const CAUSE: Record<string, string> = {
    self_scan: "tombou sem edge direcional", hybrid_scan: "três cérebros, um destino",
    mistral_scan: "sangrou em campo aberto", grok_scan: "afogado em shorts", deepseek_scan: "sangrou em campo aberto",
    kimi_scan: "sangrou em campo aberto", llama_scan: "sangrou em campo aberto", radar: "o escaldo honesto",
    sniper: "caiu com a lâmina no zero", oracle_self: "a saga não o salvou", oracle_mistral: "a saga não o salvou",
    oracle_grok: "a saga não o salvou", oracle_deepseek: "a saga não o salvou", oracle_kimi: "a saga não o salvou",
  };
  /**
   * ⚠️ SEM SEGUNDA LEITURA DA TABELA (16/08). Isto era uma varredura própria
   * com `.not("archived_at", "is", null)`. Desde que `rows` deixou de filtrar
   * por arquivo, ela virou o mesmo trabalho feito duas vezes — e duas leituras
   * do mesmo ledger em instantes diferentes podem discordar por um trade que
   * resolveu no meio, o que faria a epígrafe de Valhalla divergir do torneio
   * sem causa visível.
   */
  const gAgg = new Map<string, { decided: number; sum: number; resolved: number }>();
  for (const r of rows) {
    if (r.archived_at == null) continue;
    if (!r.source || !(r.source in CAUSE)) continue;
    const a = gAgg.get(r.source) ?? { decided: 0, sum: 0, resolved: 0 };
    if (r.status !== "open") { a.resolved++; a.sum += Number(r.outcome_pct) || 0; }
    if (["hit_target", "hit_stop", "win", "loss"].includes(r.status)) a.decided++;
    gAgg.set(r.source, a);
  }
  const valhalla = [...gAgg.entries()].map(([source, a]) => ({
    name: labelFor(source).name,
    decided: a.decided,
    net: a.resolved > 0 ? Math.round((a.sum / a.resolved - ROUND_TRIP_COST_PCT) * 100) / 100 : null,
    cause: CAUSE[source],
  })).filter((g) => g.decided > 0).sort((x, y) => (x.net ?? 0) - (y.net ?? 0));

  // `graveyard` kept as an alias for older clients; `valhalla` is canonical.
  /**
   * ⚠️ A AMOSTRA EFETIVA DA COORTE — a correção do meu próprio conserto.
   *
   * O `decidedEffective` de cada mesa agrupa DENTRO dela. Os três UNI
   * `sell_safe` de 14/08 estão em três mesas diferentes, então cada uma marca
   * "1 ideia" e a tela mostra três confirmações independentes de um movimento
   * só. Na janela de 7 dias: 46 decididos, 23 ideias.
   */
  const coorteBruta = decididosDaCoorte.length;
  const coorteEfetiva = nEfetivo(decididosDaCoorte);

  return NextResponse.json({
    agents, valhalla, graveyard: valhalla,
    minSample: MIN_SAMPLE, windowDays: days,
    coorte: {
      decididos: coorteBruta,
      ideias: coorteEfetiva,
      aviso: porQueCoorteMenor(coorteBruta, coorteEfetiva),
    },
    fetchedAt: new Date().toISOString(),
  });
}
