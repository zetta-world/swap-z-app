/**
 * ARBITER 2.0 — cross-CEX spread capture via SPOT + PERP SHORT, zero-LLM
 * (docs/PLANO-ARBITER-REAL.md).
 *
 * The 1.0 desk assumes inventory on both venues (coin to sell on the rich
 * one). Real clients arrive with USDT only — so 2.0 solves the cold-start:
 * buy spot on the cheap venue, SHORT the perp on the rich venue (1x, USDT
 * margin), which locks the spread with no coin held anywhere. The hedged
 * pair stays open until the venues converge (or a timeout), then both legs
 * close: profit = locked spread − full 4-leg cost + funding received while
 * short. Simulated against the REAL capital constraint the CEO set: the
 * wallet starts at $300 and each cycle locks 2×size (spot leg + 1x margin),
 * so at most 3 positions ride at once — exactly like the first real deposit.
 *
 * Declared approximation (paper only): the rich venue's PERP price ≈ its
 * SPOT price. Typical basis is <0.05% and ARB2_COST_PCT carries a buffer
 * for it; F2 (orderbook validation) measures the real thing before money.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { findArbs, spreadWindow, gateOrderbook, deveAnunciar, thinBookSymbols } from "@/lib/zion/arbiter";
import { recordEvent } from "@/lib/admin/track";

// Full-cycle cost: spot taker in/out (~0.2%) + perp taker in/out (~0.11%) +
// spot↔perp basis buffer (~0.14%). Deliberately fatter than 1.0's 0.4%.
const COST_PCT       = Number(process.env.ARB2_COST_PCT        ?? 0.45);
const MIN_NET_PCT    = Number(process.env.ARB2_MIN_NET_PCT     ?? 0.15);
const EXIT_SPREAD    = Number(process.env.ARB2_EXIT_SPREAD_PCT ?? 0.05); // converged when spread ≤ this
const MAX_HOLD_H     = Number(process.env.ARB2_MAX_HOLD_H      ?? 48);
const SIZE_USD       = Number(process.env.ARB2_SIZE_USD        ?? 50);   // per leg; cycle locks 2×
const STARTING_USD   = Number(process.env.ARB2_STARTING_USD    ?? 300);  // the CEO's real-seed scenario
// Loosened 28/07 (was 20) — it was capping its own paper sample by 02:00 UTC.
// Still bounded by capital: each cycle locks 2×SIZE, so ~3 hedges ride at once
// regardless. Tighten via env for real money.
const DAILY_CAP      = Number(process.env.ARB2_DAILY_CAP       ?? 120);
const COOLDOWN_MIN   = Number(process.env.ARB2_COOLDOWN_MIN    ?? 30);
// Uma definição só — ver a nota em arbiter.ts. Três cópias deste literal quase
// deixaram a Kucoin entrar na matriz desta mesa pela porta dos fundos.
import { EXCLUDE_VENUES } from "@/lib/zion/arbiter";

/**
 * OS GÊMEOS ALAVANCADOS (03/08).
 *
 * O JÖRMUNGANDR original trava 2×SIZE por ciclo, sem alavancagem. Os gêmeos
 * rodam o MESMO motor com margem reduzida: a perna de perp posta `SIZE/L` em
 * vez de `SIZE`, então o mesmo capital sustenta L vezes mais ciclos.
 *
 * ⚠️ ALAVANCAGEM NÃO É "MAIS DO MESMO". Ela muda a natureza do risco.
 *
 * A posição é delta-neutra: o que o spot ganha, o perp perde, e vice-versa. Sem
 * alavancagem isso é seguro por construção — um lado sempre cobre o outro.
 *
 * COM alavancagem deixa de ser. Se o preço dispara, a perna VENDIDA no perp é
 * liquidada ANTES de o ganho do spot ser realizado: a margem vira zero, a
 * proteção some, e sobra uma posição comprada no spot que ninguém pediu. A
 * distância até isso é ~1/L: a 3× um salto de 33%, a 5× um salto de 20%. Em
 * cripto, 20% num movimento acontece.
 *
 * Por isso a liquidação é SIMULADA aqui (`liquidationHit`) em vez de ignorada.
 * Um backtest de arbitragem alavancada que não modela liquidação produz uma
 * curva linda e mente com convicção — o lucro aparece e o evento que apagaria a
 * conta simplesmente não é contado.
 */
export interface Arbiter2Profile {
  source: string;
  label: string;
  /** 1 = sem alavancagem (o JÖRMUNGANDR original). */
  leverage: number;
  startingUsd: number;
}

export const ARBITER2_PROFILES: Arbiter2Profile[] = [
  { source: "arbiter2",    label: "ᛇ JÖRMUNGANDR",       leverage: 1, startingUsd: STARTING_USD },
  { source: "arbiter2_3x", label: "ᚼ NÍÐHÖGGR (3×)",     leverage: 3, startingUsd: STARTING_USD },
  { source: "arbiter2_5x", label: "ᚠ FÁFNIR (5×)",       leverage: 5, startingUsd: STARTING_USD },
];

/**
 * Fração de MANUTENÇÃO da margem. Abaixo dela a corretora liquida.
 *
 * 0.5% é o padrão de mercado para pares líquidos; deixa o gatilho um pouco
 * ANTES de 1/L, que é o comportamento real — ninguém é liquidado exatamente no
 * ponto teórico, é sempre um pouco antes.
 */
export const MAINTENANCE_PCT = Number(process.env.ARB2_MAINTENANCE_PCT ?? 0.5);

/**
 * O movimento adverso, em %, que zera a margem da perna vendida.
 *
 * Sem alavancagem devolve `Infinity`: não há liquidação possível, e é por isso
 * que o gêmeo original é qualitativamente outra coisa, não só uma versão menor.
 */
export function liquidationDistancePct(leverage: number, maintenancePct = MAINTENANCE_PCT): number {
  if (!(leverage > 1)) return Infinity;
  return 100 / leverage - maintenancePct;
}

/**
 * A perna vendida foi liquidada?
 *
 * `adverseMovePct` é quanto o preço SUBIU contra o short desde a entrada.
 */
export function liquidationHit(adverseMovePct: number, leverage: number): boolean {
  return adverseMovePct >= liquidationDistancePct(leverage);
}

/**
 * O que se perde quando a liquidação bate: a MARGEM INTEIRA da perna de perp.
 *
 * O spot continua valendo — mas comprado e desprotegido, que é outro trade, não
 * este. O ciclo é encerrado com a perda da margem, e não com a média do que o
 * spot fez depois: contabilizar o "salvamento" do spot seria assumir que
 * alguém estava olhando na hora para reagir.
 */
export function liquidationLossUsd(sizeUsd: number, leverage: number): number {
  return -(sizeUsd / leverage);
}

// ── Pure math (unit-tested) ─────────────────────────────────────────────────

/** P&L of one hedged cycle: the spread narrowed from entry to exit (in %),
 *  minus the full 4-leg cost, plus funding collected while short. A timeout
 *  exit with a barely-narrowed spread can lose — the flywheel logs it. */
export function cycleProfit(entrySpreadPct: number, exitSpreadPct: number, sizeUsd: number, costPct = COST_PCT, fundingUsd = 0): number {
  return sizeUsd * ((entrySpreadPct - exitSpreadPct) / 100) - sizeUsd * (costPct / 100) + fundingUsd;
}

/** Funding collected by the short leg: rate per 8h period × periods held ×
 *  notional. Positive funding pays shorts; negative charges them. */
export function fundingAccrued(rate8h: number, heldHours: number, sizeUsd: number): number {
  if (!Number.isFinite(rate8h)) return 0;
  return rate8h * (heldHours / 8) * sizeUsd;
}

// ── Bybit funding (public, best-effort) ─────────────────────────────────────

async function fetchFundingRates(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", { next: { revalidate: 300 } });
    if (!res.ok) return out;
    const body = await res.json() as { result?: { list?: Array<{ symbol?: string; fundingRate?: string }> } };
    const want = new Set(symbols.map((s) => s.toUpperCase()));
    for (const r of body.result?.list ?? []) {
      const base = (r.symbol ?? "").replace(/USDT$/, "");
      if (!want.has(base)) continue;
      const f = parseFloat(r.fundingRate ?? "");
      if (Number.isFinite(f)) out.set(base, f);
    }
  } catch { /* no funding data → accrue 0 */ }
  return out;
}

// ── One tick ────────────────────────────────────────────────────────────────

export interface Arbiter2Result { closed: number; opened: number; skipped: string | null }

const ROUTE_RE = /^arb2 (\w+)→(\w+)/;

/** Roda TODOS os perfis: o original e os dois gêmeos alavancados. */
export async function runArbiter2Scan(opts: { leveraged?: boolean } = {}): Promise<Arbiter2Result> {
  const { leveraged = true } = opts;
  let closed = 0, opened = 0;
  // Gate próprio para os gêmeos: alavancagem é risco de outra natureza, e o
  // operador tem de poder calar SÓ ela sem derrubar o original — que é o
  // controle sem alavanca desta comparação.
  const perfis = leveraged ? ARBITER2_PROFILES : ARBITER2_PROFILES.filter((p) => p.leverage === 1);
  // O motivo de cada perfil sobe junto. Sem isso, o tick agregado diria
  // "opened: 0" sem dizer se foi falta de oportunidade ou veto de profundidade —
  // e são conclusões opostas sobre a estratégia.
  const motivos: string[] = [];
  for (const profile of perfis) {
    const r = await runArbiter2Profile(profile);
    closed += r.closed; opened += r.opened;
    if (r.skipped) motivos.push(`${profile.source}: ${r.skipped}`);
  }
  return { closed, opened, skipped: motivos.length > 0 ? motivos.join(" · ") : null };
}

export async function runArbiter2Profile(profile: Arbiter2Profile): Promise<Arbiter2Result> {
  const db = getSupabaseAdmin();
  if (!db) return { closed: 0, opened: 0, skipped: "db" };

  const spot = await getMultiExchangeSpot([...CEX_TRACKED_SYMBOLS], { skipVenues: EXCLUDE_VENUES as CexSpotSource[] });
  const matrix = spot as unknown as Map<string, Map<string, { priceUsd: number }>>;
  for (const venues of matrix.values()) for (const v of EXCLUDE_VENUES) venues.delete(v);

  // Wallet (idempotent seed at the CEO's $300 real-deposit scenario).
  await db.from("paper_accounts").upsert(
    { source: profile.source, label: profile.label, exchange: "multi-cex", starting_usd: profile.startingUsd, cash_usd: profile.startingUsd },
    { onConflict: "source", ignoreDuplicates: true },
  );
  const { data: acc } = await db.from("paper_accounts")
    .select("id, cash_usd, realized_pnl_usd, wins, losses").eq("source", profile.source).maybeSingle();
  if (!acc) return { closed: 0, opened: 0, skipped: "no_account" };

  // ① Resolve open hedges FIRST — freed capital can re-enter this same tick.
  /**
   * ⚠️ `archived_at is null` FALTAVA AQUI (03/08).
   *
   * Todo leitor do ledger filtra posições arquivadas; este não filtrava. Ficou
   * invisível enquanto nada era arquivado — e apareceu no minuto seguinte ao
   * zeramento: a mesa encontrou uma posição que já tinha sido tirada da
   * medição, fechou-a, e devolveu `custo + P&L` ao caixa. Cem dólares e dezenove
   * centavos que a conta não devia.
   *
   * É o mesmo defeito de sempre em roupa nova: a mesma verdade ("o que conta é
   * o não-arquivado") escrita em N lugares, e o lugar esquecido é justamente o
   * que credita dinheiro.
   */
  // leitura-limitada: as abertas de UMA carteira, e o capital limita quantas
  // existem ao mesmo tempo (margem por ciclo × posições ≤ $300). Dezenas, não
  // milhares.
  const { data: openPos } = await db.from("paper_positions")
    .select("id, symbol, entry_price, target_price, cost_usd, exit_reason, opened_at")
    .eq("account_id", acc.id).eq("status", "open").is("archived_at", null);
  const nowMs = Date.now();
  let closed = 0, cashDelta = 0, pnlDelta = 0, wins = 0, losses = 0;
  const funding = await fetchFundingRates([...new Set((openPos ?? []).map((p) => p.symbol))]);

  for (const p of openPos ?? []) {
    const m = ROUTE_RE.exec(p.exit_reason ?? "");
    if (!m) continue;
    const [, buyV, sellV] = m;
    const venues = matrix.get(p.symbol);
    const buyNow = venues?.get(buyV)?.priceUsd, sellNow = venues?.get(sellV)?.priceUsd;
    // No live price on either leg → do nothing this tick (fail-closed).
    if (!buyNow || !sellNow || !(buyNow > 0)) continue;

    const exitSpread = ((sellNow - buyNow) / buyNow) * 100;
    const heldH = (nowMs - Date.parse(p.opened_at)) / 3_600_000;

    // ⚠️ LIQUIDAÇÃO DA PERNA VENDIDA — só existe com alavancagem.
    //
    // O preço subiu contra o short. Sem alavancagem isso é irrelevante (o spot
    // cobre), mas alavancado a margem acaba antes: a proteção some e sobra uma
    // compra de spot desprotegida, que é outro trade. Encerra com a perda da
    // margem, sem contabilizar o "salvamento" do spot — assumir que alguém
    // estava olhando para reagir seria inventar um operador que não existe.
    const adverseMovePct = ((sellNow - Number(p.target_price)) / Number(p.target_price)) * 100;
    if (liquidationHit(adverseMovePct, profile.leverage)) {
      const perda = liquidationLossUsd(SIZE_USD, profile.leverage);
      const { error: liqErr } = await db.from("paper_positions").update({
        status: "closed", exit_price: sellNow, exit_reason: `${p.exit_reason} LIQUIDADO`,
        pnl_usd: perda, pnl_pct: (perda / Number(p.cost_usd)) * 100,
        closed_at: new Date(nowMs).toISOString(),
      }).eq("id", p.id);
      if (liqErr) continue;
      closed++; cashDelta += Number(p.cost_usd) + perda; pnlDelta += perda; losses++;
      recordEvent("arb2_liquidation", { meta: {
        source: profile.source, symbol: p.symbol, leverage: profile.leverage,
        adverse_move_pct: Math.round(adverseMovePct * 100) / 100,
        liq_distance_pct: Math.round(liquidationDistancePct(profile.leverage) * 100) / 100,
        loss_usd: Math.round(perda * 100) / 100,
      } });
      continue;
    }

    const converged = exitSpread <= EXIT_SPREAD;
    if (!converged && heldH < MAX_HOLD_H) continue;

    // NOTIONAL, não margem. Com alavancagem o `cost_usd` guardado é a MARGEM
    // do ciclo, e usar metade dela como tamanho subestimaria o spread capturado
    // e o funding — o gêmeo alavancado apareceria menos lucrativo do que é,
    // escondendo justamente o risco que ele carrega em troca.
    const size = SIZE_USD;
    const entrySpread = ((Number(p.target_price) - Number(p.entry_price)) / Number(p.entry_price)) * 100;
    const fund = fundingAccrued(funding.get(p.symbol) ?? 0, heldH, size);
    const pnl = cycleProfit(entrySpread, exitSpread, size, COST_PCT, fund);
    const { error } = await db.from("paper_positions").update({
      status: "closed", exit_price: buyNow,
      exit_reason: `${p.exit_reason} ${converged ? "conv" : "timeout"}`,
      pnl_usd: pnl, pnl_pct: (pnl / Number(p.cost_usd)) * 100,
      closed_at: new Date(nowMs).toISOString(),
    }).eq("id", p.id);
    if (error) continue;
    closed++; cashDelta += Number(p.cost_usd) + pnl; pnlDelta += pnl;
    if (pnl >= 0) wins++; else losses++;
    recordEvent("arb2_close", { meta: {
      symbol: p.symbol, route: `${buyV}→${sellV}`, held_h: Math.round(heldH * 10) / 10,
      entry_spread: Math.round(entrySpread * 100) / 100, exit_spread: Math.round(exitSpread * 100) / 100,
      funding_usd: Math.round(fund * 100) / 100, pnl_usd: Math.round(pnl * 100) / 100,
    } });
  }

  // ② Entradas sob a restrição REAL de capital.
  //
  // A MARGEM por ciclo depende da alavancagem: a perna de spot é comprada
  // inteira (não dá para alavancar spot aqui), e a de perp posta `SIZE/L`. Com
  // L=1 volta a ser 2×SIZE, exatamente como o original.
  const marginPerCycle = SIZE_USD + SIZE_USD / profile.leverage;
  // A janela é calculada com o custo DESTA mesa (0.45 nas quatro pernas), não
  // com o da mesa spot. Herdar o número do vizinho faria a tela dizer uma coisa
  // e a mesa fazer outra.
  const janela = spreadWindow(COST_PCT, MIN_NET_PCT);
  // Fora os que o livro já condenou: spread grande em livro fino não é
  // oportunidade, é o próprio sintoma da iliquidez que impede executá-lo.
  for (const s of await thinBookSymbols(db)) matrix.delete(s);
  const all = findArbs(matrix, COST_PCT, MIN_NET_PCT);
  // Mesma regra da mesa spot: uma vez por hora, não por tick. A `source` entra
  // na chave para que as três mesas não calem umas às outras.
  if (janela.empty && (openPos ?? []).length === 0
      && await deveAnunciar(db, `arb2_window_empty:${profile.source}`)) {
    // Só anuncia quando não há mais nada em aberto: enquanto houver ciclo vivo,
    // a mesa ainda tem trabalho e "parada" seria mentira.
    recordEvent("arb2_window_empty", { meta: {
      source: profile.source,
      floor_pct: Math.round(janela.floorPct * 100) / 100,
      ceil_pct: Math.round(janela.ceilPct * 100) / 100,
      over_ceiling: all.filter((x) => x.suspect).length,
    } });
  }
  const arbs = all.filter((x) => !x.suspect);
  const openSymbols = new Set((openPos ?? []).map((p) => p.symbol));

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  // leitura-limitada: UM dia de UMA carteira. O teto diário da própria mesa
  // (DAILY_CAP) mantém isto na casa das centenas de linhas — bem abaixo do
  // corte do PostgREST — e o número serve justamente para fazer o teto valer.
  // inclui-arquivadas: o teto conta o que foi ABERTO hoje. Arquivar uma posição
  // tira ela da medição, não desfaz o fato de a mesa ter operado.
  const { data: today } = await db.from("paper_positions")
    .select("symbol, opened_at").eq("account_id", acc.id).gte("opened_at", dayStart.toISOString());
  const cooldownCut = nowMs - COOLDOWN_MIN * 60_000;
  const cooling = new Set((today ?? []).filter((r) => Date.parse(r.opened_at) > cooldownCut).map((r) => r.symbol));

  // Mesmo portão da mesa spot, mesmo caminho de código. Ver `gateOrderbook`.
  const checarLivro = process.env.ARB_ORDERBOOK_CHECK !== "off";
  const REALISM_MAX_CHECKS = Number(process.env.ARB_REALISM_MAX_CHECKS ?? 6);
  let checados = 0, vetados = 0;
  let opened = 0;
  let cashAvail = Number(acc.cash_usd) + cashDelta;
  let room = Math.max(0, DAILY_CAP - (today ?? []).length);
  for (const a of arbs) {
    if (room <= 0 || cashAvail < marginPerCycle) break;
    if (cooling.has(a.symbol) || openSymbols.has(a.symbol)) continue;

    // O PORTÃO DE PROFUNDIDADE. Vale aqui tanto quanto na mesa spot: a perna
    // comprada anda o livro igual. A medição de 4.085 amostras dizia −0.629% de
    // líquido real onde o topo prometia +0.451%, e esta mesa abria em cima do
    // topo. Livro ilegível REPROVA — não medido não é aprovado.
    if (checarLivro) {
      if (checados >= REALISM_MAX_CHECKS) break;
      checados++;
      const gate = await gateOrderbook(a, COST_PCT, MIN_NET_PCT, SIZE_USD, profile.source);
      if (!gate.book) { vetados++; continue; }
    }
    const { error } = await db.from("paper_positions").insert({
      account_id: acc.id, suggestion_id: randomUUID(), source: profile.source,
      symbol: a.symbol, side: "buy", qty: SIZE_USD / a.buyPrice,
      entry_price: a.buyPrice, cost_usd: marginPerCycle,
      target_price: a.sellPrice, stop_price: null, horizon_hours: MAX_HOLD_H,
      status: "open", exit_reason: `arb2 ${a.buyVenue}→${a.sellVenue}`,
      opened_at: new Date(nowMs).toISOString(),
    });
    if (error) continue;
    opened++; room--; cashAvail -= marginPerCycle; cooling.add(a.symbol); openSymbols.add(a.symbol);
    recordEvent("arb2_open", { meta: {
      symbol: a.symbol, route: `${a.buyVenue}→${a.sellVenue}`,
      spread: Math.round(a.spreadPct * 100) / 100, net: Math.round(a.netPct * 100) / 100,
    } });
  }

  if (closed > 0 || opened > 0) {
    await db.from("paper_accounts").update({
      cash_usd: Number(acc.cash_usd) + cashDelta - opened * marginPerCycle,
      realized_pnl_usd: Number(acc.realized_pnl_usd) + pnlDelta,
      wins: Number(acc.wins) + wins, losses: Number(acc.losses) + losses,
      updated_at: new Date(nowMs).toISOString(),
    }).eq("id", acc.id);
  }
  return { closed, opened, skipped: vetados > 0 ? `${vetados} vetado(s) pela profundidade` : null };
}
