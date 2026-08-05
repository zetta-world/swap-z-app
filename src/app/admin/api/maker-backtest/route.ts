import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { fetchTimedCandles } from "@/lib/api/market-indicators";
import { simulateMakerCycle, summarizeMaker, MAKER_FEE_PCT, type MakerCycle } from "@/lib/zion/maker";
import { recordEvent } from "@/lib/admin/track";
import { median } from "@/lib/zion/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MESA MAKER — o trade-off que decide, medido em barras de 1 minuto.
 *
 * Ver o cabeçalho de `src/lib/zion/maker.ts`, inclusive o aviso de que simular
 * ordem limitada é o jeito mais fácil de fabricar lucro no papel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A PERGUNTA, e por que é uma CURVA e não um número:
 *
 * Postar mais longe do preço rende mais por preenchimento e enche menos.
 * Postar mais perto enche sempre e rende quase nada — e ainda pega toda a
 * seleção adversa. Existe um ponto ótimo, e ele pode ser negativo em todo
 * lugar. Um "resultado da mesa maker" com um número só esconderia isso: seria
 * um ponto da curva escolhido por mim, que é o viés de seleção que esta semana
 * já pegou uma vez ao gravar só a estratégia vencedora por janela.
 *
 * Então varre-se a largura postada e grava-se a CURVA INTEIRA.
 *
 * ⚠️ AS LARGURAS SÃO REDONDAS E FIXAS (0.02% a 0.50%), não escolhidas olhando
 * o resultado. No instante em que eu ajustar a grade para achar o melhor, o
 * número vira sobreajuste com cara de descoberta.
 *
 * ⚠️ LEITURA PURA: não abre posição, não escreve em `admin_kv`, não altera mesa.
 *
 * ⚠️ E O QUE ESTA SIMULAÇÃO NÃO TEM, dito aqui e na tela:
 *
 *  · FILA. Numa venue real você está atrás de outras ordens no mesmo preço, e
 *    o preço tocar o seu nível não garante que chegou a vez da sua ordem. Aqui
 *    tocar = encher. É o otimismo mais pesado deste estudo.
 *  · PREENCHIMENTO PARCIAL. É tudo-ou-nada.
 *  · IMPACTO. A nossa própria ordem não move o livro.
 *
 * Os três empurram o resultado para CIMA. Se a curva vier negativa mesmo com
 * eles a favor, a conclusão é sólida; se vier positiva, é só um convite para
 * medir com livro de verdade, não uma mesa aprovada.
 */

const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LINK"];
/** Larguras CLÁSSICAS, em % de cada lado do preço. Não varridas para otimizar. */
const LARGURAS = [0.02, 0.05, 0.10, 0.20, 0.35, 0.50];
const BARRAS = Number(process.env.MAKER_BT_BARS ?? 1000);
/** Espaçamento entre ciclos: um a cada N barras, para não medir a mesma barra 6×. */
const PASSO = Number(process.env.MAKER_BT_STEP ?? 10);

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const falhou = async (motivo: string, detalhe?: string) => {
    await recordEvent("maker_backtest_failed", {
      meta: { motivo, detalhe: detalhe ?? null, tookMs: Date.now() - t0 },
    });
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  let series: Array<{ symbol: string; candles: Awaited<ReturnType<typeof fetchTimedCandles>> }>;
  try {
    series = await Promise.all(SYMBOLS.map(async (symbol) => ({
      symbol, candles: await fetchTimedCandles(symbol, "1m", BARRAS, 60),
    })));
  } catch (e) {
    return await falhou("falha ao buscar candles de 1m", String(e).slice(0, 200));
  }

  const ok = series.filter((s) => s.candles.length >= 100);
  if (ok.length === 0) {
    return await falhou(
      "nenhum símbolo com barras suficientes",
      series.map((s) => `${s.symbol}:${s.candles.length}`).join(" "),
    );
  }

  /**
   * Um ciclo por passo: a cada `PASSO` barras, posta compra e venda em torno do
   * FECHAMENTO daquela barra e avalia nas SEGUINTES.
   *
   * ⚠️ Postar em torno do fechamento da barra `i` e avaliar de `i+1` em diante
   * é o que garante ausência de look-ahead. Postar em torno do fechamento e
   * avaliar a MESMA barra usaria a máxima e a mínima que já aconteceram — o
   * erro clássico, e o que faria qualquer mesa maker parecer genial.
   */
  const porLargura = LARGURAS.map((larguraPct) => {
    const porSimbolo = ok.map(({ symbol, candles }) => {
      const ciclos: MakerCycle[] = [];
      for (let i = 0; i + 1 < candles.length; i += PASSO) {
        const ref = candles[i].close;
        if (!(ref > 0)) continue;
        const futuras = candles.slice(i + 1);
        if (futuras.length < 2) break;
        ciclos.push(simulateMakerCycle(futuras, futuras, {
          buyLimit: ref * (1 - larguraPct / 100),
          sellLimit: ref * (1 + larguraPct / 100),
        }));
      }
      return { symbol, ...summarizeMaker(ciclos) };
    });

    const med = (f: (r: (typeof porSimbolo)[number]) => number) =>
      median(porSimbolo.map(f)) ?? 0;

    return {
      larguraPct,
      simbolos: porSimbolo.length,
      // MEDIANA entre símbolos: um símbolo com um dia atípico não descreve a mesa.
      netPerCyclePct: med((r) => r.netPerCyclePct),
      hedgeRate: med((r) => r.hedgeRate),
      fillRate: med((r) => r.fillRate),
      avgAdversePct: med((r) => r.avgAdversePct),
      ciclos: porSimbolo.reduce((s, r) => s + r.cycles, 0),
      stops: porSimbolo.reduce((s, r) => s + r.stopped, 0),
      hedged: porSimbolo.reduce((s, r) => s + r.hedged, 0),
      unfilled: porSimbolo.reduce((s, r) => s + r.unfilled, 0),
      porSimbolo,
    };
  });

  /**
   * ⚠️⚠️ LARGURA QUE NÃO HEDGEIA NÃO PODE SER "A MELHOR" (05/08).
   *
   * A primeira versão ordenava por líquido e anunciava o topo. Na primeira
   * rodada real o topo foi ±0.20% com **hedge 0%** e cinco ciclos hedgeados em
   * oitocentos — ou seja, a largura "vencedora" é aquela em que a mesa
   * praticamente NÃO OPERA, e o +0.0013% é o resíduo de umas poucas pernas
   * soltas desmontadas. Na largura de ±0.50% o líquido é exatamente 0.000%
   * porque nada aconteceu.
   *
   * Anunciar isso como "melhor largura" seria coroar o não-fazer-nada. É a
   * regra da casa que já custou caro em outro painel: amostra abaixo do limiar
   * NUNCA vira número, e ranking sem piso de amostra elege sempre a linha mais
   * vazia.
   *
   * O piso: uma largura só concorre se hedgeou pelo menos `MIN_HEDGED` vezes.
   * Sem candidata, o veredito diz que a mesa não operou — que é diferente de
   * "a mesa deu lucro".
   */
  const MIN_HEDGED = 30;
  const candidatas = porLargura.filter((l) => l.hedged >= MIN_HEDGED);
  const melhor = [...candidatas].sort((a, b) => b.netPerCyclePct - a.netPerCyclePct)[0];
  const algumPositivo = candidatas.some((l) => l.netPerCyclePct > 0);
  // As que "ganharam" só por não operar — nomeadas, para o zero não passar por lucro.
  const vazias = porLargura.filter((l) => l.hedged < MIN_HEDGED && l.netPerCyclePct >= 0);

  const veredito = !melhor
    ? `NENHUMA largura hedgeou ${MIN_HEDGED}+ vezes — a mesa não operou, e isso não é `
      + "resultado. Larguras acima de ±0.10% quase não enchem os dois lados em 5 barras de 1m."
    : algumPositivo
      ? `melhor largura COM amostra: ±${melhor.larguraPct}% → ${melhor.netPerCyclePct.toFixed(4)}%/ciclo `
        + `(${melhor.hedged} hedges, ${melhor.stops} stops). ⚠️ SEM fila, SEM parcial, SEM impacto — `
        + "os três empurram para cima. Positivo aqui é convite para medir com livro real."
      : `NENHUMA largura com amostra ficou positiva. A mais operada (±${porLargura[0].larguraPct}%) `
        + `hedgeou ${porLargura[0].hedged}× e rendeu ${porLargura[0].netPerCyclePct.toFixed(4)}%/ciclo. `
        + `${vazias.length > 0 ? `As larguras ≥±${vazias[0].larguraPct}% aparecem em zero ou positivo `
          + "porque quase NÃO OPERAM — é o não-fazer-nada, não lucro. " : ""}`
        + "E a simulação já é otimista de propósito: com fila, parcial e impacto a favor "
        + "e ainda negativo, a conclusão é sólida — a taxa maker não paga a seleção adversa.";

  await recordEvent("maker_backtest", { meta: {
    barras: BARRAS, passo: PASSO, feePct: MAKER_FEE_PCT, simbolos: ok.length,
    verdict: veredito, algumPositivo,
    minHedged: MIN_HEDGED,
    comAmostra: candidatas.length,
    curva: porLargura.map((l) => ({
      larg: l.larguraPct,
      liq: Math.round(l.netPerCyclePct * 10000) / 10000,
      hedge: Math.round(l.hedgeRate * 1000) / 1000,
      fill: Math.round(l.fillRate * 1000) / 1000,
      adverso: Math.round(l.avgAdversePct * 1000) / 1000,
      ciclos: l.ciclos, stops: l.stops, hedged: l.hedged,
    })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    curva: porLargura, veredito, algumPositivo,
    minHedged: MIN_HEDGED, comAmostra: candidatas.length,
    feePct: MAKER_FEE_PCT, barras: BARRAS, passo: PASSO,
    simbolos: ok.map((s) => s.symbol),
    naoMedido: [
      "FILA: numa venue real você está atrás de outras ordens no mesmo preço",
      "preenchimento PARCIAL — aqui é tudo-ou-nada",
      "IMPACTO da própria ordem no livro",
    ],
    aviso: "Leitura pura. Os três itens não medidos empurram o resultado para CIMA — "
      + "negativo aqui é conclusão sólida, positivo é só convite para medir com livro real.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
