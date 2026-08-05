/**
 * BARRA DE LANÇAMENTO — o critério pré-registrado, medido
 * (docs/PLANO-BARRA-DE-LANCAMENTO.md).
 *
 * Registrado em 30/07/2026, ANTES dos dados chegarem, porque depois que o número
 * aparece é humano demais racionalizar: "só falta amostra", "esse mês foi
 * atípico", "tira esse trade que foi azar". A barra escrita antes é a única
 * defesa contra isso.
 *
 * Mesma lógica do `inconclusivo ≠ aprovado` da bancada de auditoria: o mecanismo
 * existe para tornar o autoengano trabalhoso.
 *
 * Mede sobre a CARTEIRA (USDT acumulado), nunca sobre win-rate — o mandato da
 * mesa é aumentar a quantidade de USDT, então é isso que decide.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { deskFor } from "@/lib/zion/desks";

// ── Limiares. Mudar qualquer um exige registrar no doc: data, valor
//    anterior, novo valor e motivo. Uma barra que se move em silêncio não é barra.
export const MIN_DECIDED = Number(process.env.LAUNCH_MIN_DECIDED ?? 100);
export const MAX_DRAWDOWN_PCT = Number(process.env.LAUNCH_MAX_DRAWDOWN ?? 15);
export const MIN_REGIMES = 2;

export interface Criterion {
  id: string;
  name: string;
  pass: boolean;
  /** Não pôde ser avaliado (sem dado ainda). NUNCA conta como aprovado. */
  pending: boolean;
  detail: string;
  why: string;
}

export interface DeskVerdict {
  source: string;
  name: string;
  criteria: Criterion[];
  passed: boolean;
  /** Quantos critérios ainda esperam dado. */
  pending: number;
  usdt: number;
  startingUsd: number;
  decided: number;
}

/** Curva de patrimônio → maior queda do pico. É o número que decide o tamanho
 *  de posição padrão: quem não pode perder US$100 não pode ver −40%. */
export function maxDrawdownPct(equity: number[]): number {
  if (equity.length < 2) return 0;
  let peak = equity[0];
  let worst = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = ((peak - v) / peak) * 100;
      if (dd > worst) worst = dd;
    }
  }
  return Math.round(worst * 100) / 100;
}

/**
 * Retorno de comprar-e-segurar os MESMOS ativos, com peso igual, na MESMA
 * janela. É o único competidor honesto: se a mesa perde para "não fazer nada",
 * ela destrói valor, por mais bonita que seja a curva.
 */
export function buyHoldReturnPct(
  legs: Array<{ first: number; last: number }>,
): number | null {
  const valid = legs.filter((l) => l.first > 0 && l.last > 0);
  if (valid.length === 0) return null;
  const sum = valid.reduce((s, l) => s + ((l.last - l.first) / l.first) * 100, 0);
  return Math.round((sum / valid.length) * 100) / 100;
}

export function evaluate(input: {
  source: string;
  startingUsd: number;
  usdt: number;
  decided: number;
  regimes: Set<string>;
  drawdownPct: number;
  buyHoldPct: number | null;
  netExpectancy: number | null;
}): DeskVerdict {
  const growthPct = input.startingUsd > 0
    ? ((input.usdt - input.startingUsd) / input.startingUsd) * 100
    : 0;
  const d = deskFor(input.source);

  const criteria: Criterion[] = [
    {
      id: "beats_hold",
      name: "Bate comprar-e-segurar",
      why: "se perde do 'não fazer nada', a mesa destrói valor — é o único competidor honesto",
      pending: input.buyHoldPct === null,
      pass: input.buyHoldPct !== null && growthPct > input.buyHoldPct,
      detail: input.buyHoldPct === null
        ? "sem preço de referência suficiente na janela"
        : `mesa ${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(2)}% vs hold ${input.buyHoldPct >= 0 ? "+" : ""}${input.buyHoldPct.toFixed(2)}%`,
    },
    {
      id: "sample",
      name: `Amostra ≥ ${MIN_DECIDED} decididos`,
      why: "abaixo disso é sorte com narrativa",
      pending: false,
      pass: input.decided >= MIN_DECIDED,
      detail: `${input.decided}/${MIN_DECIDED} decididos`,
    },
    {
      id: "regimes",
      name: `Opera em ≥ ${MIN_REGIMES} regimes`,
      why: "estratégia que só funciona num clima é coincidência de estação, não estratégia",
      pending: false,
      pass: input.regimes.size >= MIN_REGIMES,
      detail: input.regimes.size === 0
        ? "nenhum regime registrado ainda"
        : `${input.regimes.size}: ${[...input.regimes].join(", ")}`,
    },
    {
      id: "drawdown",
      name: `Drawdown ≤ ${MAX_DRAWDOWN_PCT}%`,
      why: "define o tamanho de posição padrão — quem não pode perder US$100 não pode ver −40%",
      pending: input.decided === 0,
      pass: input.decided > 0 && input.drawdownPct <= MAX_DRAWDOWN_PCT,
      detail: input.decided === 0 ? "sem trade fechado" : `pior queda do pico: ${input.drawdownPct.toFixed(2)}%`,
    },
    {
      id: "net_positive",
      name: "Expectancy líquida positiva",
      why: "lucro bruto que a taxa come não é lucro",
      /**
       * ⚠️ O `decided === 0` FALTAVA AQUI, E O PORTÃO APROVAVA NO VAZIO (05/08).
       *
       * O critério de drawdown, quinze linhas acima, tem a guarda de amostra:
       * `pending: input.decided === 0`. Este não tinha — só checava se o número
       * era nulo.
       *
       * Resultado no painel, e o dono viu antes de mim: a FREYJA aparecia com
       *
       *   ✗ Amostra ≥ 100 decididos ......... 0/100 decididos
       *   ✓ Expectancy líquida positiva ..... +0.290% por trade, líquido
       *
       * Um critério dizendo ZERO trades decididos e o de baixo dando VERDE numa
       * média desses zero trades — no mesmo cartão, um do lado do outro.
       *
       * De onde saía o +0.290%: de posições não resolvidas, que entram no
       * cálculo de expectancy mas não contam como decididas. Média de amostra
       * vazia não é zero nem nulo, é indefinida — e aqui virava aprovação.
       *
       * É a regra da casa que mais custou caro: amostra abaixo do limiar NUNCA
       * vira número, e ela vale em dobro num portão que decide lançamento.
       */
      pending: input.netExpectancy === null || input.decided === 0,
      pass: input.netExpectancy !== null && input.decided > 0 && input.netExpectancy > 0,
      detail: input.decided === 0
        ? "sem trade decidido — média de amostra vazia não é resultado"
        : input.netExpectancy === null
          ? "sem trade resolvido"
          : `${input.netExpectancy >= 0 ? "+" : ""}${input.netExpectancy.toFixed(3)}% por trade, líquido`,
    },
  ];

  const pending = criteria.filter((c) => c.pending).length;
  // CONJUNÇÃO, não média: quatro de cinco reprova. E pendente nunca aprova —
  // é a mesma regra da bancada, pela mesma razão.
  const passed = criteria.every((c) => c.pass && !c.pending);

  return {
    source: input.source,
    name: d ? `${d.sigil} ${d.name}` : input.source,
    criteria, passed, pending,
    usdt: input.usdt, startingUsd: input.startingUsd, decided: input.decided,
  };
}

const COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);

/** As mesas que precisam passar na barra para ir ao mercado. */
const GATED = ["strat_mech", "strat_ai", "strat_dex", "strat_day", "ullr_launch"];

export interface LaunchReport {
  desks: DeskVerdict[];
  anyPassed: boolean;
  verdict: string;
  measuredAt: string;
}

export async function measureLaunchGate(): Promise<LaunchReport> {
  const db = getSupabaseAdmin();
  if (!db) {
    return { desks: [], anyPassed: false, verdict: "banco indisponível", measuredAt: new Date().toISOString() };
  }

  const [{ data: accounts }, positions, sug] = await Promise.all([
    db.from("paper_accounts").select("source, starting_usd, realized_pnl_usd").in("source", GATED),
    // ⚠️ PAGINADO: este é o portão que decide se o produto pode ir ao ar. Uma
    // leitura truncada aqui aprova o lançamento com metade da evidência — e o
    // `.limit(5000)` nunca valeu, porque o teto do PostgREST chega antes.
    selectAllRows<{ source: string; pnl_usd: number | null; status: string; closed_at: string | null; entry_price: number | null; exit_price: number | null; symbol: string }>(
      (from, to) => db.from("paper_positions").select("source, pnl_usd, status, closed_at, entry_price, exit_price, symbol")
        .in("source", GATED).eq("status", "closed").is("archived_at", null)
        .order("closed_at", { ascending: true }).range(from, to)),
    selectAllRows<{ source: string; regime: string | null; status: string; outcome_pct: number | null }>(
      (from, to) => db.from("zion_suggestions").select("source, regime, status, outcome_pct")
        .in("source", GATED).is("archived_at", null)
        .order("id", { ascending: true }).range(from, to)),
  ]);

  const desks: DeskVerdict[] = [];
  for (const source of GATED) {
    const acc = (accounts ?? []).find((a) => a.source === source);
    const startingUsd = Number(acc?.starting_usd) || 1000;
    const realized = Number(acc?.realized_pnl_usd) || 0;
    const mine = (positions ?? []).filter((p) => p.source === source);

    // Curva de patrimônio realizada, em ordem de fechamento.
    let cash = startingUsd;
    const equity = [startingUsd];
    for (const p of mine) { cash += Number(p.pnl_usd) || 0; equity.push(cash); }

    // Buy-and-hold: cada posição fechada é uma perna; entrada→saída do MESMO
    // ativo no MESMO período mede o que o mercado deu sem a mesa fazer nada.
    const legs = mine
      .map((p) => ({ first: Number(p.entry_price), last: Number(p.exit_price) }))
      .filter((l) => Number.isFinite(l.first) && Number.isFinite(l.last));

    const rows = (sug ?? []).filter((r) => r.source === source);
    const regimes = new Set(rows.map((r) => r.regime).filter((r): r is string => !!r && r !== "TRANSITIONING"));
    const resolved = rows.filter((r) => r.status !== "open");
    const decidedRows = rows.filter((r) => ["hit_target", "hit_stop", "win", "loss"].includes(r.status));
    const netExpectancy = resolved.length > 0
      ? resolved.reduce((s, r) => s + (Number(r.outcome_pct) || 0), 0) / resolved.length - COST_PCT
      : null;

    desks.push(evaluate({
      source, startingUsd,
      usdt: startingUsd + realized,
      decided: decidedRows.length,
      regimes,
      drawdownPct: maxDrawdownPct(equity),
      buyHoldPct: buyHoldReturnPct(legs),
      netExpectancy,
    }));
  }

  const anyPassed = desks.some((d) => d.passed);
  const totalPending = desks.reduce((s, d) => s + d.pending, 0);
  const verdict = anyPassed
    ? `🟢 ${desks.filter((d) => d.passed).map((d) => d.name).join(", ")} passou a barra — pode ir ao mercado`
    : totalPending > 0
      ? "🟡 ainda medindo — nenhuma mesa completou os 5 critérios (pendente nunca conta como aprovado)"
      : "🔴 nenhuma mesa passou a barra — lançar SEM as mesas de trade (agregador + execução + proteção)";

  return { desks, anyPassed, verdict, measuredAt: new Date().toISOString() };
}
