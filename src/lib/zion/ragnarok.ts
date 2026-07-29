/**
 * RAGNARÖK — o wiring do seletor de estratégia no flywheel
 * (docs/PLANO-RAGNAROK.md).
 *
 * Este módulo faz UMA coisa: pega os planos do `strategist` (puro) e grava no
 * ledger `zion_suggestions` para que a máquina existente cuide do resto —
 * `resolveOpenSuggestions` fecha os trades e o `paper/engine` abre a posição e
 * credita o USDT na carteira. Nada novo precisa ser inventado a jusante.
 *
 * POR QUE NÃO USA `logSuggestions`:
 * o funil antigo (`extractSuggestion`) foi construído para o scanner
 * direcional e contém a linha que MATOU este experimento antes dele existir —
 * `if (regime === "RANGING") return null`. Ou seja: descartava exatamente o
 * mercado lateral onde mean-reversion vive. O seletor já aplica os próprios
 * portões (long-only, RR, piso de stop por ATR, escala do alvo) em código puro
 * e testado, então passar por lá de novo só reintroduziria o veto que estamos
 * tentando remover. A gravação aqui é direta e deliberada.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import { selectPlaybook, isPlan, type StrategyDecision } from "@/lib/zion/strategist";

/** A mesa mecânica — determinística, zero-LLM. É o CONTROLE do experimento. */
export const STRAT_MECH = "strat_mech";

export interface RagnarokRun {
  scanned: number;
  logged: number;
  /** Por que ficou de fora, por símbolo — diagnóstico do painel/logs. */
  standAside: Array<{ symbol: string; reason: string }>;
  /** Quantos planos por playbook (o que o momento pediu). */
  byPlaybook: Record<string, number>;
}

/**
 * Roda o seletor mecânico sobre um conjunto de símbolos já analisados e grava
 * os planos no ledger. Best-effort: uma falha de DB nunca derruba o tick do
 * cron (mesma regra do resto do flywheel).
 */
export async function runStrategistScan(
  indicators: SymbolIndicators[],
  source: string = STRAT_MECH,
): Promise<RagnarokRun> {
  const decisions: StrategyDecision[] = indicators.map(selectPlaybook);
  const plans = decisions.filter(isPlan);
  const standAside = decisions
    .filter((d) => !isPlan(d))
    .map((d) => ({ symbol: d.symbol, reason: "reason" in d ? d.reason : "?" }));

  const byPlaybook: Record<string, number> = {};
  for (const p of plans) byPlaybook[p.playbook] = (byPlaybook[p.playbook] ?? 0) + 1;

  const out: RagnarokRun = { scanned: indicators.length, logged: 0, standAside, byPlaybook };
  if (plans.length === 0) return out;

  const db = getSupabaseAdmin();
  if (!db) return out;

  // `kind` carrega o PLAYBOOK: o schema não tem coluna própria e é assim que
  // o painel consegue perguntar "qual estratégia pagou?" — que é a pergunta
  // inteira deste experimento.
  const rows = plans.map((p) => ({
    symbol: p.symbol,
    kind: p.playbook,
    side: "buy" as const,
    ref_price: p.entry,
    entry_price: p.entry,
    target_price: p.target,
    stop_price: p.stop,
    probability: null,          // sem auto-relato: a confiança declarada provou-se anti-calibrada
    regime: indicators.find((i) => i.symbol === p.symbol)?.regime ?? null,
    horizon_hours: p.horizonHours,
    source,
  }));

  try {
    await db.from("zion_suggestions").insert(rows);
    out.logged = rows.length;
  } catch { /* best-effort: o próximo tick tenta de novo */ }
  return out;
}
