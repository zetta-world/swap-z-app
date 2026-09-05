/**
 * A SAÍDA DE UMA POSIÇÃO — stop-first, `expirada` à parte, e NADA de servidor.
 *
 * ⚠️⚠️ POR QUE ISTO SAIU DE `paper/engine.ts` (05/09).
 *
 * A convenção de fechamento é UMA nesta casa, e a bancada do cliente precisa
 * dela. Mas `engine.ts` importa `supabase/server` na linha 13, e o empacotador
 * puxa o MÓDULO, não a função: qualquer componente de cliente que chegasse aqui
 * por qualquer cadeia de imports arrastaria a service-role key para o
 * navegador — e a guarda de lá LANÇA, matando o Z-SWAP inteiro em toda rota.
 *
 * ⚠️ E NÃO É HIPÓTESE: aconteceu em 24/08 com o `ÚlfhéðnarPanel`, por um import
 * de TIPO PURO. type-check, lint, build e 1.696 testes passaram; quem achou foi
 * o dono, no celular, com a aplicação fora do ar. A trava que pegou isto agora
 * é `supabase/nao-vaza-para-o-cliente.test.ts`, e ela pegou de novo — desta vez
 * antes de subir.
 *
 * Então a regra que este arquivo encarna: **função pura morando ao lado de um
 * import de servidor é uma armadilha carregada**. Aqui não há nenhum.
 *
 * ⚠️ `engine.ts` reexporta o que está aqui, então nenhum chamador antigo mudou.
 */

import { CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";

/** O mesmo custo de sempre — ida e volta. Ver `zion/custo.ts`. */
const COST_PCT = CUSTO_IDA_E_VOLTA_PCT;

export interface Candle { t: number; high: number; low: number; close: number; }

export interface ExitVerdict { exit: number; reason: "target" | "stop" | "expired"; netPct: number; pnlUsd: number; win: boolean; }

/** Decide a paper position's fate against the current live price. Stop-first
 *  pessimism (mirrors the flywheel): if the tick shows BOTH crossed we book the
 *  stop. Returns null while still in-flight. P&L is net of round-trip cost.
 *
 *  ⚠️ `custoIdaEVoltaPct` é PARÂMETRO desde 05/09, com o mesmo default de antes
 *  — nenhum chamador existente muda de comportamento. Ele existe porque a
 *  bancada do cliente precisa da MESMA convenção de saída (stop-first, expirada
 *  separada) com a taxa da praça E do papel que o cliente escolheu, e um
 *  segundo simulador de bracket seria uma segunda verdade sobre dinheiro. Foi
 *  exatamente uma taxa única aplicada a todo mundo que aposentou o Maker de
 *  Faixa por engano (ver `celeiro/taxas.ts`). */
export function computeExit(
  pos: { side: string; entry_price: number; cost_usd: number; target_price: number | null; stop_price: number | null; opened_at: string; horizon_hours: number },
  cur: number, nowMs: number, custoIdaEVoltaPct: number = COST_PCT,
): ExitVerdict | null {
  if (!(cur > 0)) return null;
  const dir = pos.side === "buy" ? 1 : -1;
  const horizonMs = Date.parse(pos.opened_at) + pos.horizon_hours * 3_600_000;
  const hitStop   = pos.stop_price   != null && (dir > 0 ? cur <= pos.stop_price   : cur >= pos.stop_price);
  const hitTarget = pos.target_price != null && (dir > 0 ? cur >= pos.target_price : cur <= pos.target_price);

  let exit: number, reason: ExitVerdict["reason"];
  if (hitStop)               { exit = pos.stop_price!;   reason = "stop"; }
  else if (hitTarget)        { exit = pos.target_price!; reason = "target"; }
  else if (nowMs >= horizonMs) { exit = cur;            reason = "expired"; }
  else return null;

  const grossPct = ((exit - pos.entry_price) / pos.entry_price) * dir * 100;
  const netPct   = grossPct - custoIdaEVoltaPct;
  const pnlUsd   = pos.cost_usd * (netPct / 100);
  const win      = reason === "target" || (reason === "expired" && pnlUsd > 0);
  return { exit, reason, netPct, pnlUsd, win };
}


/** Path-aware exit (F3): replay Gate.io candles since the position opened; the
 *  FIRST target/stop touched in time wins (stop-first when one candle straddles
 *  both — the honest pessimistic convention). Horizon elapsed with no touch →
 *  expired at the last close. Falls back to the coarse spot check when no
 *  candles are available. Much fairer than a single end-of-tick spot read. */
export function computeExitPath(
  pos: { side: string; entry_price: number; cost_usd: number; target_price: number | null; stop_price: number | null; opened_at: string; horizon_hours: number },
  candles: Candle[], curSpot: number | undefined, nowMs: number,
  /** ⚠️ Ver a nota em `computeExit`: default idêntico ao de sempre. */
  custoIdaEVoltaPct: number = COST_PCT,
): ExitVerdict | null {
  const dir = pos.side === "buy" ? 1 : -1;
  const openedMs = Date.parse(pos.opened_at);
  const horizonMs = openedMs + pos.horizon_hours * 3_600_000;
  const mk = (exit: number, reason: ExitVerdict["reason"]): ExitVerdict => {
    const grossPct = ((exit - pos.entry_price) / pos.entry_price) * dir * 100;
    const netPct = grossPct - custoIdaEVoltaPct;
    return { exit, reason, netPct, pnlUsd: pos.cost_usd * (netPct / 100), win: reason === "target" || (reason === "expired" && netPct > 0) };
  };
  const window = candles.filter((c) => c.t >= openedMs && c.t <= Math.min(nowMs, horizonMs));
  if (window.length > 0) {
    for (const c of window) {
      const hitStop   = pos.stop_price   != null && (dir > 0 ? c.low  <= pos.stop_price   : c.high >= pos.stop_price);
      const hitTarget = pos.target_price != null && (dir > 0 ? c.high >= pos.target_price : c.low  <= pos.target_price);
      if (hitStop)   return mk(pos.stop_price!,   "stop");
      if (hitTarget) return mk(pos.target_price!, "target");
    }
    if (nowMs >= horizonMs) return mk(window[window.length - 1].close, "expired");
    return null;
  }
  return curSpot == null ? null : computeExit(pos, curSpot, nowMs, custoIdaEVoltaPct);
}

// ── Gate.io live spot (public, no key) ────────────────────────────────────

