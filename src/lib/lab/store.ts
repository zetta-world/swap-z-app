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
import { selectAllRows } from "@/lib/supabase/paginate";
import type { LivroDaEstrategia } from "./conferencia";
import { LAB_STRATEGIES, type LabStrategy, type LabStatus } from "@/lib/lab/registry";

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
    /**
     * ⚠️ ESTES DOIS PRECISAM VIAJAR JUNTO COM O STATUS (Fase 10).
     *
     * `not_measurable_why` tem CHECK no banco: `nao_mensuravel` sem motivo de
     * 25+ caracteres é rejeitado. Esquecer a coluna aqui não daria um campo
     * vazio — daria o upsert INTEIRO falhando, e `syncRegistry` roda no GET do
     * laboratório. O painel cairia com 500 em vez de degradar.
     */
    not_measurable_why: s.notMeasurableWhy ?? null,
    measured_elsewhere: s.measuredElsewhere ?? null,
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
  /**
   * ⚠️ O VOCABULÁRIO INTEIRO, e não os três de antes (Fase 10).
   *
   * Este campo era `"verde" | "cinza" | "morta"`, e ERA AQUI que a informação
   * morria. Os módulos de medição já devolvem `readable: boolean` ao lado do
   * status — `false` = não deu para ler, `true` = leu e não há vantagem — e o
   * campo não tinha para onde ir na hora de gravar. Pior: os TEXTOS gravados
   * já diziam a palavra certa ("EMPATE:", "INCONCLUSIVO.", "não é uma mesa que
   * se opera") enquanto esta coluna dizia `cinza` nos três casos.
   *
   * O texto sabia. A coluna não. Agora as duas usam a mesma lista.
   */
  verdict?: LabStatus | null;
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
/**
 * O LIVRO, para a conferência da Fase 10 — quantas rodadas fecharam, com que
 * veredito, e quantas ficaram penduradas.
 *
 * ⚠️ NÃO É O MESMO QUE `readLab`, e a diferença é o defeito que se quer pegar.
 *
 * `readLab` pega a rodada MAIS RECENTE, qualquer que seja o status dela, e só
 * lê o resultado se ela tiver dado `ok`. Serve para a tela: mostrar a última
 * tentativa. Não serve para conferir, porque uma medição que FALHOU depois de
 * uma que deu certo apagaria o veredito bom e a conferência acusaria
 * discordância onde não há.
 *
 * Aqui a pergunta é outra: **qual foi o último veredito que existe de fato?**
 * Rodada `falhou` e rodada `rodando` não têm veredito e não são parcela — elas
 * contam noutra coluna, a de pendência.
 *
 * ⚠️ PAGINADO, mesmo com 28 estratégias. `.limit()` é pedido do cliente e o
 * PostgREST tem teto próprio; foi assim que uma leitura truncada virou base de
 * decisão em 07/08 (ver `docs/LEITURA-SEGURA-DO-BANCO.md`). O laboratório
 * acumula rodadas para sempre — o dia em que passar de mil não deve ser o dia
 * em que a conferência começa a mentir por omissão.
 */
export async function lerLivro(db: Db): Promise<LivroDaEstrategia[]> {
  const estrategias = await selectAllRows<{ id: string; slug: string }>((from, to) =>
    db.from("lab_strategies").select("id, slug")
      .order("id", { ascending: true }).range(from, to));

  const runs = await selectAllRows<{ id: string; strategy_id: string; status: string; started_at: string }>(
    (from, to) => db.from("lab_runs").select("id, strategy_id, status, started_at")
      .order("started_at", { ascending: true }).range(from, to));

  const okIds = runs.filter((r) => r.status === "ok").map((r) => r.id);
  const vereditos = new Map<string, LabStatus | null>();
  if (okIds.length > 0) {
    const res = await selectAllRows<{ run_id: string; verdict: string | null }>((from, to) =>
      db.from("lab_results").select("run_id, verdict")
        .in("run_id", okIds).order("run_id", { ascending: true }).range(from, to));
    for (const r of res) vereditos.set(r.run_id, (r.verdict as LabStatus | null) ?? null);
  }

  return estrategias.map((e) => {
    /** Já vêm ordenadas por `started_at` crescente — a última do filtro é a mais nova. */
    const minhas = runs.filter((r) => r.strategy_id === e.id);
    const ok = minhas.filter((r) => r.status === "ok");
    const ultima = ok.length > 0 ? ok[ok.length - 1] : null;
    return {
      slug: e.slug,
      rodadasOk: ok.length,
      ultimoVeredito: ultima ? (vereditos.get(ultima.id) ?? null) : null,
      penduradas: minhas.filter((r) => r.status === "rodando").length,
    };
  });
}

export async function readLab(db: Db): Promise<StrategyRow[]> {
  const { data: strategies, error } = await db
    .from("lab_strategies")
    .select("id, slug, name, subtitle, family, capital_required_usd, capital_why, status, hypothesis, killed_why, not_measurable_why, measured_elsewhere")
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
      notMeasurableWhy: s.not_measurable_why ? String(s.not_measurable_why) : undefined,
      measuredElsewhere: s.measured_elsewhere ? String(s.measured_elsewhere) : undefined,
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
