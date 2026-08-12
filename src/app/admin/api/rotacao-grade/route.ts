import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { fetchFechamentosDiarios } from "@/lib/api/binance-diario";
import { median } from "@/lib/zion/stats";
import {
  rodarRotacao, rodarGrade, vereditoRotacao, vereditoGrade,
  OLHAR_PARA_TRAS_DIAS, TOPO_N, REBALANCE_DIAS, FAIXA_PCT, DEGRAUS,
  MIN_REBALANCES, MIN_SIMBOLOS_GRADE, CUSTO_PCT,
  type ResultadoGrade,
} from "@/lib/lab/rotacao-grade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ROTAÇÃO E GRADE — C9 e C10 do Mapa do Lucro (Fase 8.2).
 *
 * ⚠️ DUAS MESAS, DUAS RODADAS NO LIVRO-RAZÃO. Elas dividem a busca de preço e o
 * competidor, mas cada uma tem slug e capital próprios — misturar os registros
 * seria perder a capacidade de dizer qual das duas foi medida quando.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera mesa.
 */

/**
 * ⚠️ OS SÍMBOLOS SÃO OS MESMOS DO 🧭, de propósito — e a lista é DECLARADA.
 *
 * Reusar a lista já publicada evita o pior viés desta família: escolher as
 * moedas depois de ver qual rotação funcionou. Mas ela carrega um problema que
 * NENHUMA escolha resolve, e que vai para a tela: são os sobreviventes de hoje.
 * As moedas que morreram no caminho não estão aqui para baixar o resultado.
 */
const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];

/** Janela declarada antes da rodada (invariante nº 12). */
const JANELA_DIAS = 365;
const CAPITAL_ROTACAO_USD = 2_000;
const CAPITAL_GRADE_USD   = 1_000;

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const db = getSupabaseAdmin();

  const ateMs   = Date.now();
  const desdeMs = ateMs - JANELA_DIAS * 86_400_000;

  let runRot: string | null = null;
  let runGra: string | null = null;
  if (db) {
    try {
      runRot = await startRun(db, {
        slug: "momentum_rotation", capitalUsd: CAPITAL_ROTACAO_USD, windowDays: JANELA_DIAS,
        params: { simbolos: SIMBOLOS, olharDias: OLHAR_PARA_TRAS_DIAS, topoN: TOPO_N, rebalanceDias: REBALANCE_DIAS },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
    try {
      runGra = await startRun(db, {
        slug: "grid_bot", capitalUsd: CAPITAL_GRADE_USD, windowDays: JANELA_DIAS,
        params: { simbolos: SIMBOLOS, faixaPct: FAIXA_PCT, degraus: DEGRAUS },
      });
    } catch { /* idem */ }
  }

  const historicos = await Promise.all(
    SIMBOLOS.map((s) => fetchFechamentosDiarios(s, desdeMs, ateMs)),
  );
  const falhas = historicos.map((h) => h.falha).filter(Boolean) as string[];

  const series = new Map<string, Map<string, number>>();
  historicos.forEach((h, i) => { if (h.porDia.size > 0) series.set(SIMBOLOS[i], h.porDia); });

  /**
   * ⚠️ FONTE RECUSADA NÃO É RETORNO ZERO. Sem preço não há mesa — a rodada
   * FALHA com o status, nunca devolve um resultado vazio que se lê como
   * medição (invariante nº 6).
   */
  if (series.size < MIN_SIMBOLOS_GRADE) {
    const motivo = `só ${series.size} símbolo(s) com preço — a fonte recusou o resto`;
    const detalhe = falhas.join(" · ") || "sem status capturado";
    await recordEvent("rotacao_grade_failed", { meta: { motivo, detalhe, tookMs: Date.now() - t0 } });
    if (db) {
      for (const id of [runRot, runGra]) {
        if (id) { try { await failRun(db, id, motivo, detalhe, Date.now() - t0); } catch { /* idem */ } }
      }
    }
    return NextResponse.json({ error: motivo, detail: detalhe }, { status: 503 });
  }

  // ── C9 ────────────────────────────────────────────────────────────────
  const pontos = rodarRotacao(series);
  const vRot = vereditoRotacao(pontos, MIN_REBALANCES);
  const rotMediana = pontos.length ? median(pontos.map((p) => p.retornoPct)) ?? 0 : 0;
  const rotSegurar = pontos.length ? median(pontos.map((p) => p.segurarPct)) ?? 0 : 0;

  // ── C10 ───────────────────────────────────────────────────────────────
  const grades: ResultadoGrade[] = [];
  for (const [simbolo, porDia] of series) {
    const dias = [...porDia.keys()].sort();
    const closes = dias.map((d) => porDia.get(d)!);
    const r = rodarGrade(closes);
    if (!r) continue;
    const segurarPct = closes[0] > 0
      ? Number(((closes[closes.length - 1] / closes[0] - 1) * 100).toFixed(4)) : 0;
    grades.push({ simbolo, ...r, segurarPct });
  }
  const vGra = vereditoGrade(grades, MIN_SIMBOLOS_GRADE);
  const graTotal   = grades.length ? median(grades.map((g) => g.totalPct)) ?? 0 : 0;
  const graRealiz  = grades.length ? median(grades.map((g) => g.realizadoPct)) ?? 0 : 0;
  const graSegurar = grades.length ? median(grades.map((g) => g.segurarPct)) ?? 0 : 0;

  /**
   * ⚠️ O QUE ESTAS MEDIÇÕES NÃO INCLUEM. Omissão que só vive no comentário
   * vira, semanas depois, um número que alguém leu como completo.
   */
  const naoMedido = [
    "⚠️ VIÉS DE SOBREVIVÊNCIA, e ele empurra os DOIS resultados para CIMA: a "
      + "lista é dos majors de HOJE. As moedas que morreram no caminho não estão "
      + "aqui para baixar a média, e a rotação é a mais sensível a isso",
    `⚠️ a amostra da rotação são as DECISÕES (${pontos.length} rebalanceamentos), não `
      + "os dias. E rebalanceamentos vizinhos compartilham mercado — não são "
      + "independentes entre si",
    "⚠️ a grade detecta preenchimento no FECHAMENTO diário: uma oscilação "
      + "intradiária que cruzasse vários degraus no mesmo dia conta como um só. "
      + "Isso SUBESTIMA a grade — é o lado conservador",
    `o custo é ${CUSTO_PCT}% por perna (taxa + slippage), o mesmo do resto do `
      + "laboratório; corretora e par mudam esse número",
    "nenhuma das duas modela financiamento, imposto ou o custo de atenção",
  ];

  if (db && runRot) {
    try {
      await finishRun(db, runRot, {
        netPct: rotMediana,
        // ⚠️ A régua é a VANTAGEM contra segurar todos, não o retorno bruto.
        netAnnualizedPct: Number((rotMediana - rotSegurar).toFixed(4)),
        sampleN: pontos.length,
        benchmarkPct: rotSegurar,
        verdict: vRot.status, verdictText: vRot.texto, notMeasured: naoMedido,
      }, Date.now() - t0);
    } catch { /* idem */ }
  }
  if (db && runGra) {
    try {
      await finishRun(db, runGra, {
        netPct: graTotal,
        grossPct: graRealiz,
        // ⚠️ O "custo" da grade é o estoque preso — a parcela que some das
        // propagandas. Sem ela, ruína aparece como renda.
        costPct: Number((graRealiz - graTotal).toFixed(4)),
        sampleN: grades.length,
        benchmarkPct: graSegurar,
        verdict: vGra.status, verdictText: vGra.texto, notMeasured: naoMedido,
      }, Date.now() - t0);
    } catch { /* idem */ }
  }

  await recordEvent("rotacao_grade_study", {
    meta: {
      rotacao: vRot.status, rotVantagem: Number((rotMediana - rotSegurar).toFixed(4)),
      grade: vGra.status, graTotal, graSegurar,
      tookMs: Date.now() - t0,
    },
  });

  return NextResponse.json({
    janelaDias: JANELA_DIAS, simbolos: [...series.keys()], falhas,
    custoPct: CUSTO_PCT,
    rotacao: {
      capitalUsd: CAPITAL_ROTACAO_USD,
      olharDias: OLHAR_PARA_TRAS_DIAS, topoN: TOPO_N, rebalanceDias: REBALANCE_DIAS,
      minRebalances: MIN_REBALANCES,
      medianaPct: rotMediana, segurarPct: rotSegurar,
      vantagemPct: Number((rotMediana - rotSegurar).toFixed(4)),
      pontos, veredito: vRot,
    },
    grade: {
      capitalUsd: CAPITAL_GRADE_USD, faixaPct: FAIXA_PCT, degraus: DEGRAUS,
      minSimbolos: MIN_SIMBOLOS_GRADE,
      totalPct: graTotal, realizadoPct: graRealiz, segurarPct: graSegurar,
      resultados: grades, veredito: vGra,
    },
    naoMedido,
    tookMs: Date.now() - t0,
  });
}
