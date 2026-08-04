import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { measureVenues, measureSymbols, truthVerdict, type VenueQuote } from "@/lib/zion/venue-truth";
import { spreadWindow } from "@/lib/zion/arbiter";
import { recordEvent } from "@/lib/admin/track";

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

const EXCLUDE_VENUES = (process.env.ARB_EXCLUDE_VENUES ?? "coinbase")
  .split(",").map((s) => s.trim()).filter(Boolean);

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const spot = await getMultiExchangeSpot([...CEX_TRACKED_SYMBOLS], { skipVenues: EXCLUDE_VENUES as CexSpotSource[] });
  const matrix = spot as unknown as Map<string, Map<string, { priceUsd: number }>>;
  for (const venues of matrix.values()) for (const v of EXCLUDE_VENUES) venues.delete(v);

  const bySymbol = new Map<string, VenueQuote[]>();
  for (const [symbol, venues] of matrix) {
    bySymbol.set(symbol, [...venues.entries()].map(([venue, { priceUsd }]) => ({ venue, priceUsd })));
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
