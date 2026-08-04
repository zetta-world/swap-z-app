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

/**
 * ⚠️ A JANELA TEM QUE SER A MESMA DO BACKTEST (04/08) — e não era.
 *
 * O comentário no topo desta rota dizia "na MESMA janela em que a biblioteca
 * foi medida". Era falso, e a diferença apareceu no número mais visível de
 * todos: o backtest reportava o mercado a −17.99% e este estudo, no mesmo dia,
 * a −47.86%.
 *
 * Não era discordância nenhuma — eram janelas diferentes. 320 barras diárias
 * menos 60 de aquecimento medem 260 dias; o backtest mede 174 (4.400 barras de
 * 1h menos 220). Oitenta e seis dias a mais, e nesses 86 dias o mercado caiu
 * muito.
 *
 * Comparar "a nossa biblioteca" com "o que teria funcionado" em janelas
 * distintas é o mesmo erro do filtro de clima: atribuir a uma variável uma
 * diferença que veio de outra. Aqui teria sido pior, porque o resultado ia
 * embasar uma decisão de produto.
 *
 * `WARMUP + 174` é derivado, não digitado — se o backtest mudar de janela,
 * alguém precisa mudar aqui, e este comentário é o aviso.
 */
const JANELA_DIAS = Number(process.env.WHATWORKED_WINDOW_DAYS ?? 174);
const WARMUP = 60;
const BARS_1D = Number(process.env.WHATWORKED_BARS ?? (WARMUP + JANELA_DIAS));

export async function POST(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const backDays = Math.max(0, Number(new URL(req.url).searchParams.get("backDays") ?? 0));
  const endAtMs = backDays > 0 ? Date.now() - backDays * 86_400_000 : undefined;

  /**
   * ⚠️ A FALHA TAMBÉM PRECISA DEIXAR RASTRO (04/08).
   *
   * O dono rodou a janela de 12 meses e NADA foi gravado. Sem um registro de
   * falha, "rodou e deu erro" fica idêntico a "nunca clicou" — e eu passei a
   * resposta seguinte adivinhando entre as duas.
   *
   * É a mesma família de tudo o que esta semana achou: ausência de rastro. Só
   * que aqui é pior, porque o caso que some é justamente o que deu errado — a
   * medição que funciona se anuncia, a que falha desaparece, e o histórico fica
   * com um viés de sobrevivência embutido.
   */
  const falhou = async (motivo: string, detalhe?: string) => {
    // AWAIT — ver a nota grande no `recordEvent` de sucesso, mais abaixo.
    await recordEvent("what_worked_failed", { meta: {
      backDays, windowDays: JANELA_DIAS, motivo, detalhe: detalhe ?? null,
      tookMs: Date.now() - t0,
    } });
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  let series: Array<{ symbol: string; candles: Awaited<ReturnType<typeof fetchTimedCandles>> }>;
  try {
    series = await Promise.all(SYMBOLS.map(async (symbol) => ({
      symbol,
      candles: await fetchTimedCandles(symbol, "1d", BARS_1D, 3600, endAtMs),
    })));
  } catch (e) {
    return await falhou("falha ao buscar candles", String(e).slice(0, 200));
  }

  const ok = series.filter((s) => s.candles.length >= WARMUP + 40);
  if (ok.length === 0) {
    // Diz QUANTAS velas cada símbolo trouxe. "Sem candles" sozinho não
    // distingue "a API caiu" de "esta janela é anterior à listagem do símbolo",
    // e são consertos completamente diferentes.
    return await falhou(
      "nenhum símbolo com histórico suficiente nesta janela",
      series.map((s) => `${s.symbol}:${s.candles.length}`).join(" "),
    );
  }

  // ── As estratégias, por símbolo, depois agregadas.
  //
  // Média entre símbolos, não soma: a pergunta é "quanto renderia por moeda
  // operada", e somar dez faria uma carteira de dez vezes o tamanho parecer uma
  // estratégia melhor.
  /**
   * ⚠️ SÓ OS SÍMBOLOS QUE REALMENTE PRODUZIRAM LINHAS (04/08).
   *
   * `runBenchmarks` devolve `[]` quando a série é curta demais para os
   * indicadores nascerem.
   *
   * HOJE isso não dispara: o filtro daqui exige `WARMUP + 40` velas e o de lá
   * dentro exige `warmup + 20`, então o de fora é o mais rígido dos dois e nada
   * passa aqui para voltar vazio. Não estou consertando um bug ativo — estou
   * tirando do caminho um que só depende de alguém mexer num dos dois números
   * sem olhar o outro, o que é justamente o tipo de coisa que esta semana
   * inteira mostrou que acontece.
   *
   * Duas coisas quebrariam, e as duas em silêncio:
   *
   *  1. `nomes` saía de `porSimbolo[0]`. Se o PRIMEIRO símbolo fosse o vazio, a
   *     lista de estratégias saía vazia inteira — a tela mostraria nada e o
   *     evento gravaria `todas: []`, indistinguível de "nenhuma estratégia deu
   *     lucro".
   *
   *  2. `perSymbol` casava `linhas[i]` com `porSimbolo[i].symbol`. `linhas` é
   *     FILTRADA e `porSimbolo` não — um vazio no meio desloca todas as
   *     etiquetas seguintes, e o resultado do SOL apareceria com o nome do BNB.
   *
   * O segundo é o defeito da semana inteira em miniatura: um número certo sob o
   * rótulo errado, sem nada na tela avisando. Carrego o símbolo JUNTO com a
   * linha em vez de reconstruir por índice, que é o único jeito de isso não
   * poder voltar.
   */
  const porSimbolo = ok
    .map((s) => ({ symbol: s.symbol, results: runBenchmarks(s.candles, WARMUP) }))
    .filter((p) => p.results.length > 0);

  if (porSimbolo.length === 0) {
    return await falhou(
      "nenhum símbolo produziu resultado de estratégia",
      ok.map((s) => `${s.symbol}:${s.candles.length}`).join(" "),
    );
  }

  // Todos os nomes vistos em QUALQUER símbolo, não só no primeiro.
  const nomes = [...new Set(porSimbolo.flatMap((p) => p.results.map((r) => r.name)))];

  const estrategias = nomes.map((nome) => {
    // O símbolo viaja junto com a linha. Nada de reconstruir por índice.
    const linhas = porSimbolo
      .map((p) => { const r = p.results.find((x) => x.name === nome); return r && { symbol: p.symbol, r }; })
      .filter((x): x is { symbol: string; r: NonNullable<typeof x>["r"] } => !!x)
      .map(({ symbol, r }) => ({ symbol, ...r }));
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
      perSymbol: linhas.map((r) => ({ symbol: r.symbol, totalPct: r.totalPct })),
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
  /**
   * ⚠️⚠️ ESTE `await` É O CONSERTO INTEIRO. SEM ELE A MEDIÇÃO SOME (04/08).
   *
   * O dono rodou a janela de 12 meses DUAS vezes. Na segunda mandou o print: a
   * tela mostrou tudo, correlação de 75%, cinco estratégias, 0.8s. E o banco não
   * tinha uma linha — nem `what_worked`, nem `what_worked_failed`, que eu tinha
   * acabado de adicionar justamente para esse caso.
   *
   * Não falhou. GRAVOU NO VAZIO.
   *
   * `recordEvent` é fire-and-forget por padrão, e o comentário DENTRO dele
   * avisa, com todas as letras:
   *
   *   "Returns the insert promise so callers in a streaming/serverless context
   *    can AWAIT it before the response closes — otherwise the function freezes
   *    and the write is lost (this is why manual ZION analyses weren't being
   *    logged)."
   *
   * Ou seja: este projeto JÁ perdeu dados exatamente assim uma vez, alguém
   * escreveu o aviso no lugar certo, e eu escrevi a rota nova sem ler.
   *
   * Isso também explica por que era intermitente e por que eu não achava: numa
   * corrida entre o `insert` e o congelamento da função, às vezes o insert
   * ganha. As três rodadas de 00:16 gravaram; as de 360 não. Não havia nada de
   * especial na janela de 12 meses — ela só perdeu a corrida duas vezes.
   *
   * E o efeito é o pior possível para o que esta semana vinha tentando
   * consertar: o rastro que some é aleatório, então o histórico não fica só
   * incompleto, fica ENVIESADO de um jeito que não dá para detectar de dentro.
   */
  await recordEvent("what_worked", { meta: {
    backDays, windowDays: JANELA_DIAS, symbols: ok.length,
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
    windowDays: JANELA_DIAS,
    endedAt: endAtMs ? new Date(endAtMs).toISOString() : null,
    symbols: ok.map((s) => s.symbol),
    aviso: "Parâmetros CLÁSSICOS (50, 20, 14), não escolhidos olhando estes dados. "
      + "A pergunta é binária: alguma coisa simples extraía lucro? Não é encontrar a melhor.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
