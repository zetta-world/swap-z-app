/**
 * O GRAVADOR DO LABORATÓRIO — uma rodada, um resultado, nada solto.
 *
 * ⚠️ POR QUE ISTO SUBSTITUI `recordEvent` PARA MEDIÇÃO (05/08).
 *
 * As medições de 04/08 gravavam tudo em `platform_events.metadata`, jsonb solto
 * numa tabela que também guarda `page_view` e `alert`. Isso custou caro:
 *
 *  · a discordância de onze pontos entre duas rotas levou UMA HORA para ser
 *    isolada, porque só a mediana estava gravada e "a janela é outra" / "a
 *    conta é outra" / "os símbolos são outros" ficavam indistinguíveis;
 *  · o painel exibia patrimônio de $20.842 onde o caixa somava $11.491, porque
 *    cada tela derivava o próprio número de uma fonte diferente;
 *  · uma rodada que falhava não tinha onde existir, então "rodou e deu erro"
 *    ficava idêntico a "nunca clicou".
 *
 * Aqui cada coisa tem sua linha: estratégia, execução e resultado. E o ciclo é
 * SEMPRE o mesmo — `startRun` antes, `finishRun` OU `failRun` depois. Rodada
 * que começa e não termina fica em `rodando` e aparece como pendência, em vez
 * de sumir.
 *
 * ⚠️ TUDO AQUI É `await`. Em serverless a função congela depois da resposta e
 * um insert disparado sem espera perde a corrida — foi assim que a janela de 12
 * meses do estudo de estratégias não gravou duas vezes seguidas.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { LAB_STRATEGIES, type LabStrategy } from "@/lib/lab/registry";

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/**
 * Espelha o registro do código para a tabela.
 *
 * ⚠️ A DIREÇÃO IMPORTA: código → banco, nunca o contrário. Registro em arquivo
 * passa por revisão de PR; linha em tabela é alterada por quem tiver a chave.
 * O capital de uma mesa é decisão de produto, e decisão de produto vive no
 * código onde alguém pode discordar antes de virar fato.
 */
export async function syncRegistry(db: Db): Promise<{ synced: number }> {
  const rows = LAB_STRATEGIES.map((s) => ({
    slug: s.slug,
    name: s.name,
    subtitle: s.subtitle,
    family: s.family,
    capital_required_usd: s.capitalRequiredUsd,
    capital_why: s.capitalWhy,
    status: s.status,
    hypothesis: s.hypothesis ?? null,
    killed_why: s.killedWhy ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from("lab_strategies").upsert(rows, { onConflict: "slug" });
  if (error) throw new Error(`syncRegistry: ${error.message}`);
  return { synced: rows.length };
}

/** Devolve o id da estratégia, criando-a a partir do registro se faltar. */
export async function strategyId(db: Db, slug: string): Promise<string> {
  const { data } = await db.from("lab_strategies").select("id").eq("slug", slug).maybeSingle();
  if (data?.id) return String(data.id);
  const s = LAB_STRATEGIES.find((x) => x.slug === slug);
  if (!s) throw new Error(`estratégia desconhecida: ${slug}`);
  await syncRegistry(db);
  const { data: again } = await db.from("lab_strategies").select("id").eq("slug", slug).maybeSingle();
  if (!again?.id) throw new Error(`não consegui registrar a estratégia ${slug}`);
  return String(again.id);
}

export interface StartRun {
  slug: string;
  /**
   * ⚠️ GRAVADO NO MOMENTO, não consultado depois. Se o capital exigido mudar
   * amanhã, as rodadas antigas têm que continuar dizendo com quanto foram
   * feitas — resultado sem o capital que o produziu não é comparável com nada.
   */
  capitalUsd: number;
  windowDays: number;
  windowEnd?: Date;
  params?: Record<string, unknown>;
}

/** Abre a rodada. O id devolvido é obrigatório para fechar ou falhar. */
export async function startRun(db: Db, r: StartRun): Promise<string> {
  const sid = await strategyId(db, r.slug);
  const { data, error } = await db.from("lab_runs").insert({
    strategy_id: sid,
    capital_usd: r.capitalUsd,
    window_days: r.windowDays,
    window_end: (r.windowEnd ?? new Date()).toISOString(),
    params: r.params ?? {},
    status: "rodando",
  }).select("id").single();
  if (error || !data) throw new Error(`startRun: ${error?.message ?? "sem id"}`);
  return String(data.id);
}

export interface RunResult {
  netPct?: number | null;
  netAnnualizedPct?: number | null;
  grossPct?: number | null;
  costPct?: number | null;
  /** Amostra. Coluna de primeira classe: sem ela o número não pode ser julgado. */
  sampleN: number;
  effectiveN?: number | null;
  correlationRho?: number | null;
  maxDrawdownPct?: number | null;
  winRatePct?: number | null;
  trades?: number | null;
  exposurePct?: number | null;
  /** O que comprar-e-segurar fez na MESMA janela. Sem isso "+18%" não diz nada. */
  benchmarkPct?: number | null;
  verdict?: "verde" | "cinza" | "morta" | null;
  verdictText?: string | null;
  perSymbol?: unknown[];
  /** O que esta medição NÃO inclui — vai para a tela, não só para o comentário. */
  notMeasured?: string[];
}

/** Fecha a rodada com resultado. */
export async function finishRun(
  db: Db, runId: string, res: RunResult, tookMs: number,
): Promise<void> {
  const { error: e1 } = await db.from("lab_results").insert({
    run_id: runId,
    net_pct: res.netPct ?? null,
    net_annualized_pct: res.netAnnualizedPct ?? null,
    gross_pct: res.grossPct ?? null,
    cost_pct: res.costPct ?? null,
    sample_n: res.sampleN,
    effective_n: res.effectiveN ?? null,
    correlation_rho: res.correlationRho ?? null,
    max_drawdown_pct: res.maxDrawdownPct ?? null,
    win_rate_pct: res.winRatePct ?? null,
    trades: res.trades ?? null,
    exposure_pct: res.exposurePct ?? null,
    benchmark_pct: res.benchmarkPct ?? null,
    verdict: res.verdict ?? null,
    verdict_text: res.verdictText ?? null,
    per_symbol: res.perSymbol ?? [],
    not_measured: res.notMeasured ?? [],
  });
  if (e1) throw new Error(`finishRun/result: ${e1.message}`);

  const { error: e2 } = await db.from("lab_runs").update({
    status: "ok", finished_at: new Date().toISOString(), took_ms: tookMs,
  }).eq("id", runId);
  if (e2) throw new Error(`finishRun/run: ${e2.message}`);
}

/**
 * Fecha a rodada como FALHA.
 *
 * ⚠️ `detail` NÃO É OPCIONAL POR DESCUIDO. A primeira rodada do estudo de
 * funding voltou "nenhum símbolo retornou funding" e levou outra rodada inteira
 * só para descobrir que a causa era `bybit:403` e `binance:451`. Gravar QUE
 * falhou sem gravar O QUÊ é gravar a parte inútil.
 */
export async function failRun(
  db: Db, runId: string, reason: string, detail: string, tookMs: number,
): Promise<void> {
  const { error } = await db.from("lab_runs").update({
    status: "falhou",
    failure_reason: reason,
    failure_detail: detail,
    finished_at: new Date().toISOString(),
    took_ms: tookMs,
  }).eq("id", runId);
  if (error) throw new Error(`failRun: ${error.message}`);
}

/** Registra mudança de capital, com o motivo. */
export async function logCapitalChange(
  db: Db, slug: string, fromUsd: number | null, toUsd: number, reason: string,
): Promise<void> {
  const sid = await strategyId(db, slug);
  const { error } = await db.from("lab_capital_log").insert({
    strategy_id: sid, from_usd: fromUsd, to_usd: toUsd, reason,
  });
  if (error) throw new Error(`logCapitalChange: ${error.message}`);
}

export interface StrategyRow extends LabStrategy {
  id: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "falhou" | "rodando" | null;
  lastNetPct: number | null;
  lastNetAnnualizedPct: number | null;
  lastSampleN: number | null;
  lastVerdict: string | null;
  lastVerdictText: string | null;
  runs: number;
}

/**
 * O painel inteiro numa consulta: cada estratégia com a ÚLTIMA rodada.
 *
 * ⚠️ LEITURA LIMITADA DE PROPÓSITO — o `limit` aqui é sobre as estratégias
 * (dezenas, não milhares) e a subconsulta de rodadas é por estratégia. Nenhuma
 * das duas cresce sem teto, então não há risco de truncagem silenciosa do
 * PostgREST. Ver `docs/LEITURA-SEGURA-DO-BANCO.md`.
 */
// leitura-limitada: lab_strategies tem dezenas de linhas, não milhares
export async function readLab(db: Db): Promise<StrategyRow[]> {
  const { data: strategies, error } = await db
    .from("lab_strategies")
    .select("id, slug, name, subtitle, family, capital_required_usd, capital_why, status, hypothesis, killed_why")
    .order("family", { ascending: true });
  if (error) throw new Error(`readLab: ${error.message}`);

  const rows: StrategyRow[] = [];
  for (const s of strategies ?? []) {
    // leitura-limitada: a última rodada de UMA estratégia
    const { data: run } = await db
      .from("lab_runs")
      .select("id, status, started_at")
      .eq("strategy_id", s.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let result: Record<string, unknown> | null = null;
    if (run?.id && run.status === "ok") {
      const { data } = await db
        .from("lab_results")
        .select("net_pct, net_annualized_pct, sample_n, verdict, verdict_text")
        .eq("run_id", run.id)
        .maybeSingle();
      result = data ?? null;
    }

    const { count } = await db
      .from("lab_runs")
      .select("id", { count: "exact", head: true })
      .eq("strategy_id", s.id);

    rows.push({
      id: String(s.id),
      slug: String(s.slug),
      name: String(s.name),
      subtitle: String(s.subtitle),
      family: s.family as LabStrategy["family"],
      capitalRequiredUsd: Number(s.capital_required_usd),
      capitalWhy: String(s.capital_why),
      status: s.status as LabStrategy["status"],
      hypothesis: s.hypothesis ? String(s.hypothesis) : undefined,
      killedWhy: s.killed_why ? String(s.killed_why) : undefined,
      lastRunAt: run?.started_at ? String(run.started_at) : null,
      lastStatus: (run?.status as StrategyRow["lastStatus"]) ?? null,
      lastNetPct: result?.net_pct == null ? null : Number(result.net_pct),
      lastNetAnnualizedPct: result?.net_annualized_pct == null ? null : Number(result.net_annualized_pct),
      lastSampleN: result?.sample_n == null ? null : Number(result.sample_n),
      lastVerdict: result?.verdict == null ? null : String(result.verdict),
      lastVerdictText: result?.verdict_text == null ? null : String(result.verdict_text),
      runs: count ?? 0,
    });
  }
  return rows;
}
