import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { fetchVelasDiarias, type VelaDiaria } from "@/lib/api/binance-diario";
import {
  rodarTendencia, escolherRisco, PARAMS_PADRAO, TETO_PESO_PCT, TETO_EXPOSICAO_PCT,
  RISCOS_CANDIDATOS, montarSerie, EMA_CURTA, EMA_LONGA, ATR_PERIODO,
} from "@/lib/lab/tendencia";
import {
  rodarWalkForward, vereditoWalkForward, MIN_DOBRAS, porDia,
} from "@/lib/lab/walk-forward";
import { razaoRetornoTombo } from "@/lib/lab/retorno-tombo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TENDÊNCIA DE BAIXA FREQUÊNCIA, MEDIDA FORA DA AMOSTRA — `PLANO-FORA-DA-AMOSTRA.md`.
 *
 * ⚠️ É A PRIMEIRA MEDIÇÃO DESTE LABORATÓRIO COM WALK-FORWARD. Todas as outras
 * escolheram parâmetro e mediram resultado no MESMO dado. Aqui o risco por
 * trade sai do treino e o número que vale sai só do teste.
 *
 * ⚠️ LEITURA PURA: não abre posição, não escreve em `admin_kv`, não toca mesa.
 */

/**
 * ⚠️ A MESMA LISTA DO 🧭 E DA ROTAÇÃO, e ela é DECLARADA antes de medir.
 *
 * Reusar a lista já publicada evita o pior viés desta família — escolher as
 * moedas depois de ver qual configuração funcionou. E carrega o problema que
 * nenhuma escolha resolve, que vai junto para a tela: **são os sobreviventes de
 * hoje**. As moedas que morreram no caminho não estão aqui para baixar o
 * resultado.
 */
const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];

/**
 * Janelas declaradas ANTES da rodada (invariante nº 12).
 *
 * ⚠️ O AQUECIMENTO NÃO É JANELA DE MEDIÇÃO. A EMA de 200 precisa de 200 velas
 * antes de existir; os dias em que ela é `null` entram na série para alimentar
 * o indicador e o motor simplesmente não opera neles. Contar esses dias como
 * "medidos" inflaria a janela sem inflar a evidência.
 */
const JANELA_DIAS = 1460;          // 4 anos — o que a paginação da Binance alcança bem
const TREINO_DIAS = 365;
const TESTE_DIAS  = 120;
const CAPITAL_USD = 5_000;

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const db = getSupabaseAdmin();

  const ateMs = Date.now();
  const desdeMs = ateMs - JANELA_DIAS * 86_400_000;

  let runId: string | null = null;
  if (db) {
    try {
      runId = await startRun(db, {
        slug: "tendencia_baixa_freq", capitalUsd: CAPITAL_USD, windowDays: JANELA_DIAS,
        params: {
          simbolos: SIMBOLOS, emaCurta: EMA_CURTA, emaLonga: EMA_LONGA,
          atrPeriodo: ATR_PERIODO, atrStop: PARAMS_PADRAO.atrStop,
          custoPct: PARAMS_PADRAO.custoPct, riscosCandidatos: [...RISCOS_CANDIDATOS],
          treinoDias: TREINO_DIAS, testeDias: TESTE_DIAS,
          tetoPesoPct: TETO_PESO_PCT, tetoExposicaoPct: TETO_EXPOSICAO_PCT,
        },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }

  const historicos = await Promise.all(SIMBOLOS.map((s) => fetchVelasDiarias(s, desdeMs, ateMs)));
  const falhas = historicos.map((h) => h.falha).filter(Boolean) as string[];

  const porSimbolo = new Map<string, VelaDiaria[]>();
  historicos.forEach((h, i) => { if (h.velas.length > 0) porSimbolo.set(SIMBOLOS[i], h.velas); });

  const serie = montarSerie(porSimbolo);

  /**
   * ⚠️ SÉRIE CURTA NÃO VIRA MEDIÇÃO RUIM — VIRA "NÃO MEDIMOS". Sem dias
   * suficientes para o piso de dobras, o walk-forward produziria uma ou duas
   * dobras, que é um backtest com nome novo. Falhar aqui é o comportamento
   * correto (invariante nº 6).
   */
  const minimo = TREINO_DIAS + TESTE_DIAS * MIN_DOBRAS;
  if (serie.length < minimo) {
    const motivo = `só ${serie.length} dia(s) de série contra ${minimo} necessários para `
      + `${MIN_DOBRAS} dobras (treino ${TREINO_DIAS} + teste ${TESTE_DIAS})`;
    if (db && runId) await failRun(db, runId, "dados_insuficientes", motivo, Date.now() - t0).catch(() => {});
    await recordEvent("lab_tendencia", { meta: { erro: motivo, falhas: falhas.join(",") } });
    return NextResponse.json({ erro: motivo, falhas, dias: serie.length }, { status: 200 });
  }

  // ── FORA DA AMOSTRA. O risco sai do treino; o número que vale sai do teste.
  const wf = rodarWalkForward(
    serie,
    (treino) => escolherRisco(treino),
    (params, teste) => rodarTendencia(teste, params).retornoPct,
    { treinoDias: TREINO_DIAS, testeDias: TESTE_DIAS },
  );
  const veredito = vereditoWalkForward(wf);

  /**
   * ⚠️ O NÚMERO DENTRO DA AMOSTRA EXISTE PARA SER COMPARADO, NUNCA SOZINHO.
   * Ele é a série inteira com o risco padrão — o que qualquer backtest comum
   * teria publicado. Sem ele ao lado, "fora deu X" não diz se X é bom ou se é
   * o que sobrou de um número muito maior.
   */
  const dentroTudo = rodarTendencia(serie, PARAMS_PADRAO);

  const diasFora = wf.dobras.length * TESTE_DIAS;
  const foraAnualPct = wf.foraPorDia === null
    ? null
    : (Math.pow(1 + wf.foraPorDia / 100, 365) - 1) * 100;

  // ⚠️ O tombo vem do caminho DENTRO da amostra: as fatias de teste são medidas
  // isoladamente e cada uma reinicia a curva, então elas não têm um tombo
  // contínuo para observar. Isso é uma limitação e vai para a tela.
  const razao = razaoRetornoTombo(foraAnualPct, dentroTudo.tomboMaxPct, "nivel");

  const texto = `${veredito.texto} · fora: ${wf.foraCompostoPct?.toFixed(2) ?? "—"}% em `
    + `${diasFora} dias (${foraAnualPct?.toFixed(2) ?? "—"}%/ano) · dentro, série inteira: `
    + `${dentroTudo.retornoPct.toFixed(2)}% bruto ${dentroTudo.brutoPct.toFixed(2)}% custo `
    + `${dentroTudo.custoPct.toFixed(2)}% · ${dentroTudo.trades.length} trades · tombo `
    + `${dentroTudo.tomboMaxPct.toFixed(2)}% · exposição ${dentroTudo.exposicaoPct.toFixed(0)}%`
    + (razao.razao !== null ? ` · retorno/tombo ${razao.razao.toFixed(2)}` : "")
    + (falhas.length ? ` ⚠️ ${falhas.length} símbolo(s) sem dado: ${falhas.join(", ")}` : "");

  if (db && runId) {
    await finishRun(db, runId, {
      netPct: wf.foraCompostoPct,
      netAnnualizedPct: foraAnualPct,
      grossPct: dentroTudo.brutoPct,
      costPct: dentroTudo.custoPct,
      sampleN: wf.dobras.length,
      effectiveN: wf.dobras.length,
      maxDrawdownPct: dentroTudo.tomboMaxPct,
      winRatePct: dentroTudo.acertoPct,
      trades: dentroTudo.trades.length,
      exposurePct: dentroTudo.exposicaoPct,
      verdict: veredito.status,
      verdictText: texto,
      perSymbol: wf.dobras.map((d) => ({
        dobra: d.dobra.indice,
        risco: d.params.riscoPct,
        dentroPct: Number(d.dentroPct.toFixed(3)),
        foraPct: Number(d.foraPct.toFixed(3)),
      })),
      notMeasured: [
        "o tombo é o do caminho DENTRO da amostra — cada fatia de teste reinicia a "
          + "curva e não tem tombo contínuo próprio",
        "lista de símbolos são os sobreviventes de hoje: quem morreu no caminho não "
          + "está aqui para baixar o resultado",
        "custo é modelo por perna, não execução medida — derrapagem real não entra",
        "long-only: o lado vendido não foi medido nesta rodada",
      ],
    }, Date.now() - t0).catch(() => {});
  }

  await recordEvent("lab_tendencia", { meta: {
    veredito: veredito.status, dobras: wf.dobras.length,
    fora_por_dia: wf.foraPorDia, dentro_por_dia: wf.dentroPorDia,
    degradacao: wf.degradacaoPorDia, consistencia: wf.consistencia,
    ms: Date.now() - t0,
  } });

  return NextResponse.json({
    veredito: veredito.status,
    texto,
    dias: serie.length,
    falhas,
    fora: {
      dobras: wf.dobras.length,
      ilegiveis: wf.dobrasIlegiveis,
      compostoPct: wf.foraCompostoPct,
      anualPct: foraAnualPct,
      porDia: wf.foraPorDia,
      positivas: wf.dobrasPositivas,
      consistencia: wf.consistencia,
      suficiente: wf.suficiente,
    },
    dentro: {
      porDia: wf.dentroPorDia,
      // A série inteira com risco padrão: o backtest comum, para comparação.
      serieInteiraPct: dentroTudo.retornoPct,
      brutoPct: dentroTudo.brutoPct,
      custoPct: dentroTudo.custoPct,
      trades: dentroTudo.trades.length,
      tomboMaxPct: dentroTudo.tomboMaxPct,
      exposicaoPct: dentroTudo.exposicaoPct,
      acertoPct: dentroTudo.acertoPct,
      anualPct: porDia(dentroTudo.retornoPct, serie.length) === null ? null
        : (Math.pow(1 + porDia(dentroTudo.retornoPct, serie.length)! / 100, 365) - 1) * 100,
    },
    degradacaoPorDia: wf.degradacaoPorDia,
    razaoRetornoTombo: razao.razao,
    dobras: wf.dobras.map((d) => ({
      indice: d.dobra.indice, risco: d.params.riscoPct,
      dentroPct: d.dentroPct, foraPct: d.foraPct,
    })),
  });
}
