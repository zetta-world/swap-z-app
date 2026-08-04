import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { fetchTimedCandles } from "@/lib/api/market-indicators";
import { runBenchmarks, meanPairwiseCorrelation, effectiveSampleSize } from "@/lib/zion/benchmarks";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O QUE TERIA DADO LUCRO — a pergunta que a semana de ajustes não respondia.
 *
 * O dono: "traders conseguem lucrar com consistência em queda e em subida" e
 * "todas as moedas seguem um padrão de movimento, principalmente as majors".
 *
 * Esta rota mede as duas coisas na MESMA janela em que a biblioteca foi medida:
 *
 *  1. Um punhado de estratégias CANÔNICAS — média móvel, canal de Donchian,
 *     RSI — com parâmetro de livro, comprado e vendido. Se alguma delas extraía
 *     lucro, sabemos onde procurar. Se nenhuma extraía, a resposta honesta é que
 *     aquele mercado não pagava quem opera assim, e nenhum ajuste na nossa
 *     biblioteca mudaria isso.
 *
 *  2. A CORRELAÇÃO entre os símbolos, que muda a leitura de tudo o que já foi
 *     medido: se as moedas andam juntas, 350 trades em 10 símbolos não são 350
 *     observações independentes.
 *
 * ⚠️ NENHUM PARÂMETRO FOI ESCOLHIDO OLHANDO ESTES DADOS. 50, 20 e 14 são os
 * valores clássicos. No instante em que eu varrer parâmetros procurando o
 * melhor, o resultado vira sobreajuste com cara de descoberta — e este projeto
 * já produziu esse tipo de número uma vez.
 */

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];
/** Diárias: 174 dias de janela + folga para as médias nascerem. */
const BARS_1D = Number(process.env.WHATWORKED_BARS ?? 320);
const WARMUP = 60;

export async function POST(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const backDays = Math.max(0, Number(new URL(req.url).searchParams.get("backDays") ?? 0));
  const endAtMs = backDays > 0 ? Date.now() - backDays * 86_400_000 : undefined;

  const series = await Promise.all(SYMBOLS.map(async (symbol) => ({
    symbol,
    candles: await fetchTimedCandles(symbol, "1d", BARS_1D, 3600, endAtMs),
  })));
  const ok = series.filter((s) => s.candles.length >= WARMUP + 40);
  if (ok.length === 0) return NextResponse.json({ error: "sem candles" }, { status: 503 });

  // ── As estratégias, por símbolo, depois agregadas.
  //
  // Média entre símbolos, não soma: a pergunta é "quanto renderia por moeda
  // operada", e somar dez faria uma carteira de dez vezes o tamanho parecer uma
  // estratégia melhor.
  const porSimbolo = ok.map((s) => ({ symbol: s.symbol, results: runBenchmarks(s.candles, WARMUP) }));
  const nomes = porSimbolo[0]?.results.map((r) => r.name) ?? [];

  const estrategias = nomes.map((nome) => {
    const linhas = porSimbolo
      .map((p) => p.results.find((r) => r.name === nome))
      .filter((r): r is NonNullable<typeof r> => !!r);
    const med = (f: (r: (typeof linhas)[number]) => number) =>
      linhas.reduce((s, r) => s + f(r), 0) / linhas.length;
    // Quantos símbolos deram positivo — mais informativo que a média sozinha.
    // Uma média puxada por um único símbolo que triplicou não é uma estratégia,
    // é um bilhete premiado.
    const positivos = linhas.filter((r) => r.totalPct > 0).length;
    return {
      name: nome,
      what: linhas[0].what,
      usesShort: linhas[0].usesShort,
      avgTotalPct: med((r) => r.totalPct),
      medianTotalPct: [...linhas.map((r) => r.totalPct)].sort((a, b) => a - b)[Math.floor(linhas.length / 2)],
      symbolsPositive: positivos,
      symbols: linhas.length,
      avgTrades: med((r) => r.trades),
      avgExposurePct: med((r) => r.exposurePct),
      avgMaxDrawdownPct: med((r) => r.maxDrawdownPct),
      perSymbol: linhas.map((r, i) => ({ symbol: porSimbolo[i].symbol, totalPct: r.totalPct })),
    };
  }).sort((a, b) => b.medianTotalPct - a.medianTotalPct);

  // ── A correlação: quantas apostas realmente existem aqui.
  const rho = meanPairwiseCorrelation(ok.map((s) => s.candles.map((c) => c.close)));
  const efetivo = effectiveSampleSize(ok.length, rho);

  /**
   * ⚠️ GRAVA TODAS AS ESTRATÉGIAS, NÃO SÓ A MELHOR (04/08).
   *
   * A primeira versão registrava `melhor: <nome>` por janela. As três primeiras
   * rodadas voltaram assim:
   *
   *   hoje         média 50 comprado e VENDIDO    −0.47%
   *   180d atrás   canal 20 comprado e VENDIDO   +54.39%
   *   360d atrás   reversão à média (RSI)         −1.25%
   *
   * Três janelas, três vencedores DIFERENTES. Guardar só o campeão de cada uma
   * é o viés de seleção em estado puro: sempre vai existir um melhor, e ele
   * sempre vai parecer bom. A pergunta honesta é outra — existe UMA estratégia
   * que se sustenta nas três? — e ela é impossível de responder com o que eu
   * estava gravando.
   *
   * É a quarta vez nesta semana que persisto menos do que a análise precisa.
   * As três anteriores foram esquecimento; esta foi pior, porque eu escolhi o
   * que guardar e escolhi o pedaço que confirma.
   */
  recordEvent("what_worked", { meta: {
    backDays, symbols: ok.length,
    rho: rho == null ? null : Math.round(rho * 1000) / 1000,
    effectiveSymbols: Math.round(efetivo * 100) / 100,
    // TODAS, para a comparação entre janelas ser possível depois.
    todas: estrategias.map((e) => ({
      nome: e.name,
      mediana: Math.round(e.medianTotalPct * 100) / 100,
      positivos: e.symbolsPositive,
      simbolos: e.symbols,
      vende: e.usesShort,
      tombo: Math.round(e.avgMaxDrawdownPct * 10) / 10,
      exposicao: Math.round(e.avgExposurePct),
    })),
  } });

  return NextResponse.json({
    estrategias,
    correlacao: {
      rho,
      symbols: ok.length,
      effectiveSymbols: efetivo,
      nota: rho == null
        ? "sem correlação medida"
        : `correlação média de ${(rho * 100).toFixed(0)}% entre os ${ok.length} símbolos — `
          + `equivalem a ${efetivo.toFixed(1)} apostas independentes, não ${ok.length}. `
          + "Toda amostra medida neste laboratório vale menos do que o número de trades sugere.",
    },
    backDays,
    endedAt: endAtMs ? new Date(endAtMs).toISOString() : null,
    symbols: ok.map((s) => s.symbol),
    aviso: "Parâmetros CLÁSSICOS (50, 20, 14), não escolhidos olhando estes dados. "
      + "A pergunta é binária: alguma coisa simples extraía lucro? Não é encontrar a melhor.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
