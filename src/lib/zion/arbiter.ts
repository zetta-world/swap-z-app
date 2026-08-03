/**
 * ARBITER desk — cross-CEX arbitrage, polished by REMOVING the LLM.
 *
 * A spread between exchanges is arithmetic: (high − low) / low. A language
 * model adds nothing to arithmetic except cost and hallucination, so this desk
 * runs zero-token by design (docs/PLANO-MESA-AGENTES.md). It rides the radar's
 * 1-min tick, reads the public multi-exchange spot matrix, and books a
 * simulated INSTANT round-trip (buy the cheap venue, sell the rich one) into
 * the 'arbiter' paper wallet — realized P&L on the spot, equity curve for free.
 *
 * Honest caveat baked into the numbers: paper arb assumes both legs fill at
 * the observed price (no leg risk, no depth). ARB_COST_PCT carries a buffer
 * for that, and F2 validates against real orderbooks before anything real.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { fetchOrderbook } from "@/lib/api/cex-orderbook";
import { assessRealism } from "@/lib/zion/arb-realism";
import { recordEvent } from "@/lib/admin/track";

const COST_PCT     = Number(process.env.ARB_COST_PCT     ?? 0.4);  // 2 taker legs + slippage buffer
const MIN_NET_PCT  = Number(process.env.ARB_MIN_NET_PCT  ?? 0.15); // floor to act
/**
 * "Too good to be true" ceiling.
 *
 * ⚠️ BAIXADO DE 3% PARA 0.30% EM 03/08, e a mudança é grande.
 *
 * A primeira versão nasceu para matar cadáver de migração de ticker: MATIC a
 * +353% e RNDR a +375% (MATIC→POL, RNDR→RENDER — a listagem velha de uma venue
 * fica parada). Contra aquilo, 3% funcionou.
 *
 * A auditoria da coorte mostrou que o teto de 3% deixa passar a mesma doença em
 * dose menor. Os 661 ciclos das três mesas entraram com spread MÉDIO de 0.72% e
 * fecharam com 100% de convergência em ~18 minutos, ZERO perdas. Uma venue
 * aparecia em 90% das pernas, nos DOIS sentidos — a assinatura de preço
 * oscilando em volta dos outros, não de praça mais barata.
 *
 * Spread real entre CEXes grandes num ativo líquido vive na casa de 0.01% a
 * 0.05%; deslocamento genuíno em pico de volatilidade chega a uns 0.2–0.3% e
 * dura segundos. Acima disso, em 2026, é quase sempre o feed, não o mercado.
 *
 * ⚠️ CONSEQUÊNCIA QUE PRECISA SER DITA EM VOZ ALTA: com o custo de ida-e-volta
 * em 0.40–0.45% e o líquido mínimo em 0.15%, o PISO para disparar é ~0.60% —
 * acima deste teto. A janela de disparo fica VAZIA, e as mesas param de abrir.
 *
 * Isso não é um efeito colateral, é o resultado. Se o único spread que paga o
 * custo é grande demais para ser real, então a estratégia não tem trade — e é
 * melhor descobrir isso num ledger de papel do que com dinheiro. `spreadWindow`
 * calcula essa janela e as mesas anunciam quando ela está vazia, em vez de
 * simplesmente emudecer (mesa que emudece sozinha é como o vazamento de caixa
 * passou três semanas despercebido).
 */
const MAX_GROSS_PCT = Number(process.env.ARB_MAX_GROSS_PCT ?? 0.3);
/**
 * Quantas venues precisam cotar o símbolo para ele ser operável.
 *
 * O filtro de mediana já existia e só rodava com 3+ cotações — abaixo disso o
 * próprio comentário admitia "não dá para saber qual está parada". Só que o
 * código seguia operando com 2 assim mesmo, protegido apenas pelo teto bruto.
 * Era o buraco por onde os 0.7% entravam: com duas venues discordando, a mesa
 * chutava que a barata era a certa.
 *
 * Com três, a mediana é uma testemunha independente: a que se afasta dela é a
 * errada, e sai antes de formar par. Símbolo com menos de três cotações passa a
 * ser INOPERÁVEL em vez de operável às cegas.
 */
const MIN_VENUES = Number(process.env.ARB_MIN_VENUES ?? 3);
// Median outlier filter: with 3+ venues quoting a symbol, a venue whose price
// deviates more than this % from the cross-venue MEDIAN is a stale/dead quote
// (the MATIC→POL corpse pattern) and is dropped BEFORE pairing — so a corpse
// can't even form a "suspect" pair. With only 2 venues we can't tell which is
// stale; the gross ceiling still catches those.
const OUTLIER_PCT = Number(process.env.ARB_OUTLIER_PCT ?? 2);
// Venues excluded from the ARB matrix (still fine elsewhere). Coinbase quotes
// BASE-USD, not USDT — the USD/USDT basis masquerades as spread.
const EXCLUDE_VENUES = (process.env.ARB_EXCLUDE_VENUES ?? "coinbase").split(",").map((s) => s.trim()).filter(Boolean);
// Alavanca 4: the universe nearly doubled (30 → ~55 symbols), so the book
// scales with it. The per-symbol cooldown still guards against churning one
// pair; the cap only bounds the aggregate.
// Paper-measurement cap. 28/07: the desk hit the old 40/day by ~02:00 UTC and
// sat idle 17h — it was CAPPING OUR OWN SAMPLE, making the measured +6.67%
// an UNDERSTATEMENT of the real opportunity. Loosened for the paper phase so
// the true daily edge is visible; tighten again (env) for real money, where a
// cap is anti-churn safety, not a measurement limit. Per-symbol cooldown
// (COOLDOWN_MIN) still prevents churning one pair.
const DAILY_CAP    = Number(process.env.ARB_DAILY_CAP    ?? 240);  // round-trips per UTC day
const COOLDOWN_MIN = Number(process.env.ARB_COOLDOWN_MIN ?? 30);   // per-symbol re-entry wait
const SIZE_USD     = Number(process.env.ARB_SIZE_USD     ?? 50);   // per round-trip

export interface ArbOpportunity {
  symbol: string; buyVenue: string; sellVenue: string;
  buyPrice: number; sellPrice: number;
  spreadPct: number; netPct: number;
  /** spread above the sanity ceiling → data anomaly (stale/dead listing), not
   *  a trade. Logged for visibility, never booked. */
  suspect: boolean;
}

/**
 * A JANELA DE DISPARO: entre o piso que paga o custo e o teto do que é crível.
 *
 * Existe para que "a mesa parou de operar" nunca seja uma descoberta. Quando o
 * piso passa o teto a janela está vazia, e isso é uma AFIRMAÇÃO sobre a
 * estratégia — "o único spread que pagaria o custo é grande demais para ser
 * real" — não um silêncio a ser interpretado.
 */
export function spreadWindow(
  costPct = COST_PCT, minNetPct = MIN_NET_PCT, maxGrossPct = MAX_GROSS_PCT,
): { floorPct: number; ceilPct: number; empty: boolean } {
  const floorPct = costPct + minNetPct;
  return { floorPct, ceilPct: maxGrossPct, empty: floorPct > maxGrossPct };
}

/** Pure detector: scan the venue matrix for spreads whose NET (after costs)
 *  clears the floor. Needs ≥MIN_VENUES quoting the symbol; fail-closed on junk. */
export function findArbs(
  spot: Map<string, Map<string, { priceUsd: number }>>,
  costPct = COST_PCT,
  minNetPct = MIN_NET_PCT,
  maxGrossPct = MAX_GROSS_PCT,
  outlierPct = OUTLIER_PCT,
  minVenues = MIN_VENUES,
): ArbOpportunity[] {
  const out: ArbOpportunity[] = [];
  for (const [symbol, venues] of spot) {
    // TRÊS TESTEMUNHAS, não duas. Com duas cotações discordando não há como
    // saber qual está parada, e a mesa chutava que a barata era a certa — foi
    // por aí que os spreads de 0.7% entraram por três semanas.
    if (venues.size < minVenues) continue;
    let quotes: Array<{ v: string; p: number }> = [];
    for (const [v, { priceUsd }] of venues) if (priceUsd > 0) quotes.push({ v, p: priceUsd });
    // Median outlier drop: a mediana é a testemunha independente, e quem se
    // afasta dela sai ANTES de formar par.
    if (quotes.length >= 3) {
      const sorted = [...quotes].map((q) => q.p).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      quotes = quotes.filter((q) => Math.abs(q.p / median - 1) * 100 <= outlierPct);
    }
    // Depois do corte ainda precisa sobrar o quórum: dois sobreviventes de uma
    // matriz de três significa que UM já foi reprovado, e operar no que restou
    // seria voltar ao caso de duas testemunhas pela porta dos fundos.
    if (quotes.length < minVenues) continue;
    let lo = quotes[0], hi = quotes[0];
    for (const q of quotes) { if (q.p < lo.p) lo = q; if (q.p > hi.p) hi = q; }
    if (lo.v === hi.v) continue;
    const spreadPct = ((hi.p - lo.p) / lo.p) * 100;
    const netPct = spreadPct - costPct;
    if (netPct >= minNetPct) {
      out.push({ symbol, buyVenue: lo.v, sellVenue: hi.v, buyPrice: lo.p, sellPrice: hi.p, spreadPct, netPct, suspect: spreadPct > maxGrossPct });
    }
  }
  return out.sort((a, b) => b.netPct - a.netPct);
}

export interface ArbiterResult { detected: number; booked: number; skipped: string | null }

/** Runtime toggle from admin_kv (true/false). Best-effort — false on any
 *  hiccup so a KV blip never turns a feature silently on. */
async function kvFlag(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, key: string): Promise<boolean> {
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", key).maybeSingle();
    return data?.value === "true";
  } catch { return false; }
}

/** F2: fetch real depth for one opportunity and log how much of the paper
 *  spread survives real fills. Best-effort — logs `arb_realism` or nothing. */
async function assessArbRealism(a: ArbOpportunity): Promise<void> {
  const [buyBook, sellBook] = await Promise.all([
    fetchOrderbook(a.buyVenue as CexSpotSource, a.symbol),   // buy on cheap venue → its asks
    fetchOrderbook(a.sellVenue as CexSpotSource, a.symbol),  // sell on rich venue → its bids
  ]);
  if (!buyBook?.asks.length || !sellBook?.bids.length) return;
  const r = assessRealism(buyBook.asks, sellBook.bids, SIZE_USD, a.spreadPct, COST_PCT);
  recordEvent("arb_realism", { meta: {
    symbol: a.symbol, buy: a.buyVenue, sell: a.sellVenue, sizeUsd: SIZE_USD,
    theoreticalNet: r.theoreticalNetPct, realisticNet: r.realisticNetPct,
    slippage: r.slippagePct, fullyFilled: r.fullyFilled,
  } });
}

/** One arbiter tick: detect → cooldown/daily-cap gates → book instant paper
 *  round-trips into the 'arbiter' wallet. Zero LLM calls, best-effort. */
export async function runArbiterScan(): Promise<ArbiterResult> {
  const db = getSupabaseAdmin();
  if (!db) return { detected: 0, booked: 0, skipped: "db" };

  // Excluded venues (USD-quoted coinbase) are skipped at FETCH time — no point
  // paying ~55 per-symbol requests a minute for prices we'd delete.
  const spot = await getMultiExchangeSpot([...CEX_TRACKED_SYMBOLS], { skipVenues: EXCLUDE_VENUES as CexSpotSource[] });
  const matrix = spot as unknown as Map<string, Map<string, { priceUsd: number }>>;
  // Belt-and-braces: also strip in case a custom EXCLUDE_VENUES name slips past the fetch skip.
  for (const venues of matrix.values()) for (const v of EXCLUDE_VENUES) venues.delete(v);
  const all = findArbs(matrix);

  /**
   * MESA QUE PARA TEM QUE DIZER QUE PAROU.
   *
   * Com o teto em 0.30% e o piso em ~0.55%, a janela está vazia e nenhum
   * spread pode ser aberto. Sem esta linha, o painel mostraria "0 detectados"
   * indefinidamente e alguém concluiria "não apareceu oportunidade" — que foi
   * exatamente como o vazamento de caixa passou três semanas despercebido.
   *
   * A janela vazia é uma AFIRMAÇÃO: o único spread que pagaria o custo é
   * grande demais para ser real. Ela é a conclusão da auditoria, não um bug.
   */
  const janela = spreadWindow();
  if (janela.empty) {
    recordEvent("arb_window_empty", { meta: {
      floor_pct: Math.round(janela.floorPct * 100) / 100,
      ceil_pct: Math.round(janela.ceilPct * 100) / 100,
      detected_over_ceiling: all.filter((x) => x.suspect).length,
      why: "piso de custo acima do teto de credibilidade — estratégia sem trade neste custo",
    } });
  }

  // Data anomalies (spread over the sanity ceiling — stale/migrated listings):
  // surface them in the admin feed, never book them.
  for (const a of all.filter((x) => x.suspect)) {
    recordEvent("arb_data_anomaly", { meta: {
      symbol: a.symbol, buy: a.buyVenue, sell: a.sellVenue,
      spreadPct: Math.round(a.spreadPct * 100) / 100,
    } });
  }
  const arbs = all.filter((x) => !x.suspect);
  if (arbs.length === 0) return { detected: all.length, booked: 0, skipped: null };

  // F2 realism (docs/PLANO-ARBITER-REAL.md): the paper spread assumes both legs
  // fill at the top of book. When enabled, walk the REAL depth of the top
  // opportunity and log theoretical-vs-realistic net — the bridge to real
  // money. Best-effort, top-1/tick (2 fetches), never blocks booking. Toggle
  // via env ARB_ORDERBOOK_CHECK=on OR the admin_kv flag `arb_orderbook_check`
  // (runtime, no redeploy). (Live fetch is prod-only; the walk math is tested.)
  if (process.env.ARB_ORDERBOOK_CHECK === "on" || await kvFlag(db, "arb_orderbook_check")) {
    void assessArbRealism(arbs[0]).catch(() => undefined);
  }

  // Wallet (seeded in admin_kv setup; upsert keeps this idempotent).
  await db.from("paper_accounts").upsert(
    { source: "arbiter", label: "Arbiter ⚖️", exchange: "multi-cex", starting_usd: 1000, cash_usd: 1000 },
    { onConflict: "source", ignoreDuplicates: true },
  );
  const { data: acc } = await db.from("paper_accounts")
    .select("id, cash_usd, realized_pnl_usd, wins, losses").eq("source", "arbiter").maybeSingle();
  if (!acc) return { detected: arbs.length, booked: 0, skipped: "no_account" };

  // Gates: per-symbol cooldown + daily cap (both from today's book — one query).
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: recent } = await db.from("paper_positions")
    .select("symbol, opened_at").eq("account_id", acc.id)
    .gte("opened_at", dayStart.toISOString());
  const today = recent ?? [];
  if (today.length >= DAILY_CAP) return { detected: arbs.length, booked: 0, skipped: "daily_cap" };
  const cooldownCut = Date.now() - COOLDOWN_MIN * 60_000;
  const cooling = new Set(today.filter((r) => Date.parse(r.opened_at) > cooldownCut).map((r) => r.symbol));

  let booked = 0, pnlSum = 0;
  const room = DAILY_CAP - today.length;
  for (const a of arbs) {
    if (booked >= room) break;
    if (cooling.has(a.symbol)) continue;
    const pnl = SIZE_USD * (a.netPct / 100);
    const now = new Date().toISOString();
    const { error } = await db.from("paper_positions").insert({
      account_id: acc.id, suggestion_id: randomUUID(), source: "arbiter",
      symbol: a.symbol, side: "buy", qty: SIZE_USD / a.buyPrice,
      entry_price: a.buyPrice, cost_usd: SIZE_USD,
      target_price: a.sellPrice, stop_price: null, horizon_hours: 0,
      status: "closed", exit_price: a.sellPrice,
      exit_reason: `arb ${a.buyVenue}→${a.sellVenue}`,
      pnl_usd: pnl, pnl_pct: a.netPct, opened_at: now, closed_at: now,
    });
    if (error) continue;
    booked++; pnlSum += pnl; cooling.add(a.symbol);
    recordEvent("arb_opportunity", { meta: {
      symbol: a.symbol, buy: a.buyVenue, sell: a.sellVenue,
      spreadPct: Math.round(a.spreadPct * 100) / 100, netPct: Math.round(a.netPct * 100) / 100,
    } });
  }

  if (booked > 0) {
    await db.from("paper_accounts").update({
      cash_usd: Number(acc.cash_usd) + pnlSum,
      realized_pnl_usd: Number(acc.realized_pnl_usd) + pnlSum,
      wins: Number(acc.wins) + booked, // net-positive by construction (floor > 0)
      updated_at: new Date().toISOString(),
    }).eq("id", acc.id);
  }
  return { detected: arbs.length, booked, skipped: null };
}
