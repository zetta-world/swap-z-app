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
import { recordEvent } from "@/lib/admin/track";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import { selectPlaybook, isPlan, type StrategyDecision, type StrategyPlan } from "@/lib/zion/strategist";
import { buildLongBracket } from "@/lib/zion/bracket";
import { runStrategistAi, STRAT_AI } from "@/lib/zion/strategist-ai";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { loadPlaybookRecord, loadHistory, rankByRecord, isStale } from "@/lib/zion/playbook-record";

/** A mesa mecânica — determinística, zero-LLM. É o CONTROLE do experimento. */
export const STRAT_MECH = "strat_mech";
/** A mesa intradiária: MESMO seletor, horizonte curto. A diferença entre day
 *  trade e swing aqui é só o relógio — de propósito, para isolar a variável.
 *  Se o mesmo playbook rende diferente em 8h e em 48h, o achado é sobre o
 *  HORIZONTE, não sobre a estratégia. */
export const STRAT_DAY = "strat_day";
export const DAY_HORIZON_HOURS = Number(process.env.RAGNAROK_DAY_HORIZON ?? 8);
export { STRAT_AI };

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
  horizonOverride?: number,
): Promise<RagnarokRun> {
  const decisions: StrategyDecision[] = indicators.map(selectPlaybook);
  const todos = decisions.filter(isPlan);

  /**
   * ⚠️ O HORIZONTE ENCURTADO TEM QUE REVALIDAR A GEOMETRIA (03/08).
   *
   * A SKAÐI é a mesma seleção da VÖLUNDR com prazo de day-trade. Ela fazia isso
   * trocando SÓ o campo `horizon_hours` na linha gravada — o alvo, calculado
   * para um swing de 48h, ia junto intacto.
   *
   * O resultado apareceu no ledger e é constrangedor de tão claro: os trades da
   * SKAÐI e da VÖLUNDR são IDÊNTICOS em entrada, alvo e stop. Só o relógio
   * muda. ADA com alvo a +5.87% e oito horas para chegar lá, quando o movimento
   * esperado em oito horas era ~1.4%.
   *
   * Isso não é uma mesa mais rápida, é a mesma mesa com um sexto do tempo para
   * o mesmo destino. O lado que mata continuava alcançável e o lado que paga
   * virou impossível — 17 trades fechados, ZERO alvos batidos, 12 stops.
   *
   * Agora o plano é RECONSTRUÍDO com o horizonte da mesa, e `buildLongBracket`
   * julga de novo. O que não couber no prazo simplesmente não é operado por
   * ela — que é o comportamento certo, e o que faltava.
   */
  const plans = horizonOverride == null ? todos : todos.flatMap((p) => {
    const refeito = buildLongBracket(
      p.symbol, p.playbook, p.entry, p.target, p.stop,
      indicators.find((i) => i.symbol === p.symbol)?.atrPct ?? null,
      horizonOverride, p.rationale,
    );
    return refeito ? [refeito] : [];
  });
  const foraDoPrazo = todos.length - plans.length;
  if (foraDoPrazo > 0) {
    recordEvent("ragnarok_horizon_reject", { meta: {
      source, horizon_hours: horizonOverride, rejected: foraDoPrazo,
      why: "alvo não alcançável no prazo desta mesa — o plano era de outro relógio",
    } });
  }
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
    // O plano já foi reconstruído com o horizonte da mesa acima — este campo
    // apenas reflete a geometria validada, em vez de sobrescrevê-la.
    horizon_hours: p.horizonHours,
    source,
  }));

  try {
    await db.from("zion_suggestions").insert(rows);
    out.logged = rows.length;
  } catch { /* best-effort: o próximo tick tenta de novo */ }
  return out;
}

/** Grava um conjunto de planos já decididos sob um `source`. Compartilhado
 *  pelas duas mesas para que a linha do ledger seja idêntica em forma — a
 *  comparação mecânico vs IA só é honesta se a única diferença for QUEM decidiu. */
async function persist(plans: StrategyPlan[], indicators: SymbolIndicators[], source: string): Promise<number> {
  if (plans.length === 0) return 0;
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const rows = plans.map((p) => ({
    symbol: p.symbol, kind: p.playbook, side: "buy" as const,
    ref_price: p.entry, entry_price: p.entry,
    target_price: p.target, stop_price: p.stop,
    probability: null,
    regime: indicators.find((i) => i.symbol === p.symbol)?.regime ?? null,
    horizon_hours: p.horizonHours, source,
  }));
  // O cliente do Supabase NÃO lança em erro de banco: resolve com
  // `{ error }`. Um `try/catch` aqui nunca dispararia, e a contagem devolvida
  // seria uma MENTIRA — linhas "gravadas" que não existem. Foi essa mesma
  // suposição que fez as carteiras de paper vazarem capital (ver
  // `paper/engine.ts`). Aqui o estrago é de medição, não de dinheiro, mas uma
  // mesa que relata trades inexistentes envenena o experimento igual.
  const { error } = await db.from("zion_suggestions").insert(rows);
  return error ? 0 : rows.length;
}

export interface RagnarokAiRun {
  /** Símbolos com pelo menos um candidato para escolher. */
  offered: number;
  /** Total de candidatos apresentados — o tamanho do cardápio. */
  candidates: number;
  picked: number; adjusted: number; passed: number; logged: number;
  brainRan: boolean; fallbackReason?: string;
  /** Decidiu com histórico medido, ou às cegas? */
  usedRecord: boolean;
}

/**
 * A MESA DE IA (MÍMIR). Recebe os mesmos indicadores do ferreiro mecânico e o
 * MESMO cardápio de candidatos da biblioteca, e ESCOLHE qual playbook operar —
 * ou nenhum. Grava sob `strat_ai`.
 *
 * Quando o cérebro não roda, `plans` vem vazio e nada é gravado: uma mesa que
 * não pensou não produz trade. A versão anterior gravava o plano do ferreiro
 * sob o nome da IA, e foi assim que MÍMIR acumulou quatro trades num
 * experimento onde IA nenhuma participou.
 *
 * As duas mesas veem O MESMO mercado no MESMO tick e escrevem em ledgers
 * separados — é isso que torna a comparação limpa. Se a IA vale alguma coisa
 * nesta pergunta, a carteira dela cresce mais que a do VÖLUNDR; se não vale,
 * fica atrás de um bot determinístico e a resposta também é clara.
 */
export async function runStrategistAiScan(indicators: SymbolIndicators[]): Promise<RagnarokAiRun> {
  const r = await runStrategistAi(indicators);
  const logged = await persist(r.plans, indicators, STRAT_AI);
  // Registra SEMPRE se a IA decidiu. Um tick em que ela não rodou grava plano
  // mecânico sob o nome dela — e sem este evento a contaminação do experimento
  // seria invisível para sempre.
  recordEvent("strat_ai_tick", {
    meta: {
      brainRan: r.brainRan, fallbackReason: r.fallbackReason ?? null,
      usedRecord: r.usedRecord,
      offered: r.offered, candidates: r.candidates, logged,
    },
  });
  return {
    offered: r.offered, candidates: r.candidates,
    picked: r.picked, adjusted: r.adjusted, passed: r.passed, logged,
    brainRan: r.brainRan, fallbackReason: r.fallbackReason, usedRecord: r.usedRecord,
  };
}

/** ᚢᚱ URÐR — a mesa que obedece ao histórico medido. */
export const STRAT_RECORD = "strat_record";

export interface RagnarokRecordRun {
  offered: number; taken: number; logged: number;
  /** Descartados por terem líquido MEDIDO negativo no regime atual. */
  vetoedByRecord: number;
  /** Havia registro para consultar? Sem ele, a mesa não opera. */
  hadRecord: boolean;
  reason?: string;
}

/**
 * O TICK DA URÐR — a terceira mesa, e o motivo de ela existir.
 *
 * Quando o MÍMIR passou a receber o histórico, o duelo ganhou uma segunda
 * variável: virou "IA COM evidência" contra "regra fixa SEM evidência". Se o
 * MÍMIR ganhasse, não daria para saber se venceu a IA ou o histórico.
 *
 * URÐR é mecânica como o VÖLUNDR e recebe o MESMO cardápio — o que muda é só o
 * critério de ordenação: ela obedece ao líquido medido em vez da prioridade
 * declarada. Com ela, cada par isola uma coisa:
 *
 *   VÖLUNDR × URÐR   → quanto vale a EVIDÊNCIA sozinha
 *   URÐR × MÍMIR     → quanto vale o JULGAMENTO da IA sobre a evidência
 *
 * SEM REGISTRO, ELA NÃO OPERA — e isso é deliberado. Cair na ordem declarada a
 * transformaria num VÖLUNDR com outro nome, enchendo o ledger de trades
 * idênticos aos do controle sob a bandeira de um terceiro braço. Foi exatamente
 * a contaminação que o MÍMIR sofreu por semanas.
 */
export async function runRecordScan(indicators: SymbolIndicators[]): Promise<RagnarokRecordRun> {
  const out: RagnarokRecordRun = { offered: 0, taken: 0, logged: 0, vetoedByRecord: 0, hadRecord: false };

  let record = await loadPlaybookRecord();
  // O HISTÓRICO, não só a última medição. Sem ele a URÐR teria operado o
  // `pivot_reversion` a +0.202% às 13:24 de 03/08 — número que às 19:45, na
  // mesma janela rolada por seis horas, já era −0.069%.
  const history = await loadHistory();
  if (record && isStale(record, Date.now())) record = null;
  if (!record) {
    out.reason = "sem histórico medido — rode o backtest por playbook primeiro";
    return out;
  }
  out.hadRecord = true;

  const plans: StrategyPlan[] = [];
  for (const ind of indicators) {
    const candidates = candidateAttempts(ind)
      .map((a) => a.plan)
      .filter((p): p is StrategyPlan => p !== null);
    if (candidates.length === 0) continue;
    out.offered++;

    const ranked = rankByRecord(candidates, record, ind.regime, undefined, history);
    // Lista vazia = TODOS os candidatos mediram negativo neste regime. Ficar de
    // fora É a decisão, e é a disciplina que a evidência compra: o VÖLUNDR
    // tomaria o primeiro da lista de qualquer jeito.
    if (ranked.length === 0) { out.vetoedByRecord++; continue; }

    const escolhido = ranked[0];
    plans.push({
      ...escolhido.candidate,
      rationale: escolhido.unknown
        ? `[URÐR] sem histórico neste regime — seguiu a ordem declarada`
        : `[URÐR] melhor líquido medido no regime: ${escolhido.measuredNet!.toFixed(2)}%/trade`,
    });
    out.taken++;
  }

  out.logged = await persist(plans, indicators, STRAT_RECORD);
  recordEvent("strat_record_tick", {
    meta: { hadRecord: out.hadRecord, offered: out.offered, taken: out.taken, vetoedByRecord: out.vetoedByRecord, logged: out.logged },
  });
  return out;
}

/** Tick da mesa intradiária (SKAÐI): mesmos planos, relógio curto. */
export async function runDayScan(indicators: SymbolIndicators[]): Promise<RagnarokRun> {
  return runStrategistScan(indicators, STRAT_DAY, DAY_HORIZON_HOURS);
}
