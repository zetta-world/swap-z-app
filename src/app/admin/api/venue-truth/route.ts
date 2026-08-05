import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { measureVenues, measureSymbols, truthVerdict, type VenueQuote } from "@/lib/zion/venue-truth";
import { spreadWindow } from "@/lib/zion/arbiter";
import { recordEvent } from "@/lib/admin/track";
import { fetchObservedVenues } from "@/lib/api/cex-spot-extra";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "ABRE AS DUAS CORRETORAS E OLHA" — só que com número, e toda vez.
 *
 * A auditoria da coorte concluiu que o spread de ~0.72% que as mesas vinham
 * capturando era ruído do feed de uma venue, não preço de mercado. A prova
 * definitiva proposta era manual: abrir as duas corretoras no mesmo par, no
 * mesmo instante, e ver se a diferença está lá.
 *
 * Na mão isso responde uma vez, para quem olhou. Aqui responde sempre, guarda o
 * número, e o veredito sai escrito — porque uma tabela de desvios obriga cada
 * leitor a refazer o raciocínio sozinho, inclusive eu daqui a duas semanas.
 *
 * A leitura é ao vivo de propósito: o ledger diria o que aconteceu, e a pergunta
 * aqui é o que ESTÁ acontecendo agora, nas mesmas cotações que a mesa usaria
 * para abrir um ciclo neste instante.
 */

/**
 * ⚠️ EXCLUSÃO PRÓPRIA, SEPARADA DA DO ARBITER (04/08).
 *
 * Esta rota MEDE; o arbiter OPERA. Até hoje as duas liam a mesma variável, o
 * que estava certo enquanto a lista era idêntica — e deixou de estar no minuto
 * em que a Kucoin entrou.
 *
 * O dono pediu a Kucoin "na medição de dispersão". Só que a matriz é
 * compartilhada: incluí-la no fetch a colocaria também na matriz das MESAS, que
 * é caminho de dinheiro, sem ninguém ter medido o que ela faz lá.
 *
 * É exatamente o caso da mediana do corte de outlier, ontem: a conta certa
 * afrouxava um portão, e a resposta foi medir antes de trocar. Mesma regra
 * aqui. A Kucoin entra AQUI (leitura pura, não abre posição) e continua fora do
 * `ARB_EXCLUDE_VENUES` das mesas até este número existir.
 *
 * Só a coinbase segue excluída dos dois, e por motivo diferente: ela cota
 * BASE-USD e não USDT, então a base USD/USDT se disfarça de spread. Isso não é
 * cautela, é validade de medição — incluí-la mediria a moeda, não a venue.
 */
const EXCLUDE_VENUES = (process.env.VENUE_TRUTH_EXCLUDE ?? "coinbase")
  .split(",").map((s) => s.trim()).filter(Boolean);

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const simbolos = [...CEX_TRACKED_SYMBOLS];
  const spot = await getMultiExchangeSpot(simbolos, { skipVenues: EXCLUDE_VENUES as CexSpotSource[] });
  const matrix = spot as unknown as Map<string, Map<string, { priceUsd: number }>>;
  for (const venues of matrix.values()) for (const v of EXCLUDE_VENUES) venues.delete(v);

  const bySymbol = new Map<string, VenueQuote[]>();
  for (const [symbol, venues] of matrix) {
    bySymbol.set(symbol, [...venues.entries()].map(([venue, { priceUsd }]) => ({ venue, priceUsd })));
  }

  /**
   * ⚠️ AS VENUES EM OBSERVAÇÃO ENTRAM AQUI — e SÓ aqui (04/08).
   *
   * O dono tem conta em ~19 corretoras e quis somar todas. Elas entram na
   * MEDIÇÃO, não na matriz das mesas: `ObservedVenue` é um tipo separado de
   * `CexSpotSource` justamente para que nenhuma mesa possa enxergá-las por
   * descuido.
   *
   * A Kucoin é o precedente inteiro. Ontem ela entrou e mediu 0.601% de ruído
   * contra 0.037% da binance, com 31 dos 32 gaps acima do piso vindo dela e 16
   * de 19 desvios negativos — feed atrasado, não praça barata. Se tivesse ido
   * direto para a matriz, a mesa estaria vendo 31 oportunidades falsas.
   *
   * Venue nova é hipótese, não upgrade. Esta rota é onde a hipótese é testada.
   */
  const observadas = await fetchObservedVenues(simbolos);
  for (const r of observadas) {
    if (!r.ok || r.parsed === 0) continue;
    for (const [symbol, priceUsd] of r.quotes) {
      const linha = bySymbol.get(symbol);
      if (linha) linha.push({ venue: r.venue, priceUsd });
      // Símbolo que SÓ a venue observada cota não vira linha nova: com uma
      // cotação só não há mediana, e um símbolo com uma testemunha entraria na
      // conta como se tivesse dispersão zero.
    }
  }

  const stats = measureVenues(bySymbol);
  // POR SÍMBOLO, não só por venue. A média entre 57 símbolos é dominada pelos
  // majors; a mesa selecionava a cauda (MANA, SAND, RUNE — altcoin de livro
  // fino). Medir só a média responde a pergunta ao lado da que importa.
  const gaps = measureSymbols(bySymbol);
  const janela = spreadWindow();

  // Quantos símbolos sequer têm quórum de 3 venues. Se forem poucos, a nova
  // regra de MIN_VENUES é a razão de as mesas terem emudecido — e essa é uma
  // explicação diferente de "o spread não existe".
  const comQuorum = [...bySymbol.values()].filter((q) => q.filter((x) => x.priceUsd > 0).length >= 3).length;

  /**
   * ⚠️ A MEDIÇÃO PRECISA DEIXAR RASTRO (03/08).
   *
   * Esta rota lia os preços ao vivo, devolvia o veredito para a tela, e não
   * gravava nada. O dono rodou o teste e me pediu para olhar o resultado — e eu
   * não tinha o que olhar: a medição existiu, foi correta, e evaporou.
   *
   * É o mesmo defeito da sonda de orderbook em outra forma. Lá o número ia para
   * um feed que ninguém agregava; aqui não ia para lugar nenhum. Uma medição que
   * não pode ser comparada com a de ontem não responde a única pergunta que
   * importa numa série temporal: mudou?
   */
  // AWAIT obrigatório: sem ele o insert perde a corrida contra o congelamento
  // da função serverless e a medição some sem deixar rastro. Ver a nota em
  // what-worked/route.ts e o comentário dentro de recordEvent.
  await recordEvent("venue_truth", { meta: {
    biggestDispersionPct: stats[0]?.dispersionPct ?? null,
    floorPct: janela.floorPct,
    gapsAboveFloor: gaps.filter((g) => g.gapPct >= janela.floorPct).length,
    worstSymbol: gaps[0]?.symbol ?? null,
    worstGapPct: gaps[0]?.gapPct ?? null,
    symbolsWithQuorum: comQuorum,
    symbolsTotal: bySymbol.size,
    noisiestVenue: stats[0]?.venue ?? null,
    /**
     * ⚠️ QUAIS SÍMBOLOS, E POR CULPA DE QUEM (04/08).
     *
     * A primeira rodada com a Kucoin passou `gapsAboveFloor` de 0 para 2 e o
     * pior gap de 0.54% (RUNE) para 1.78% (MANA). O agregado dizia que algo
     * mudou e não dizia O QUÊ — e sem os nomes eu não conseguia distinguir "a
     * Kucoin abriu spread real" de "a Kucoin trouxe duas cotações paradas".
     *
     * São conclusões OPOSTAS: uma promove a venue, a outra a proíbe. É a mesma
     * lição da mediana do what-worked, agora numa decisão de dinheiro.
     */
    acimaDoPiso: gaps
      .filter((g) => g.gapPct >= janela.floorPct)
      .slice(0, 20)
      .map((g) => ({
        s: g.symbol,
        gap: Math.round(g.gapPct * 1000) / 1000,
        venues: g.venues,
        // Quem está fora da mediana, e quanto — é isto que separa praça barata
        // de cotação parada.
        fora: g.outlier,
        desvio: Math.round(g.outlierDeviationPct * 1000) / 1000,
      })),
    /** As venues mais ruidosas, com o número — não só a campeã. */
    ruido: stats.slice(0, 8).map((s) => ({
      v: s.venue,
      disp: Math.round(s.dispersionPct * 1000) / 1000,
    })),
  } });

  return NextResponse.json({
    verdict: truthVerdict(stats, janela.floorPct, gaps),
    stats,
    gapsAboveFloor: gaps.filter((g) => g.gapPct >= janela.floorPct),
    worstGaps: gaps.slice(0, 8),
    window: janela,
    symbolsTotal: bySymbol.size,
    symbolsWithQuorum: comQuorum,
    // O maior desvio de UMA venue contra a mediana é o teto do spread que
    // poderia existir de verdade. Comparado ao piso da mesa, responde a
    // pergunta inteira em dois números.
    biggestDispersionPct: stats[0]?.dispersionPct ?? null,
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
