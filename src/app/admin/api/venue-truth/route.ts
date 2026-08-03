import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { measureVenues, truthVerdict, type VenueQuote } from "@/lib/zion/venue-truth";
import { spreadWindow } from "@/lib/zion/arbiter";

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
  const janela = spreadWindow();

  // Quantos símbolos sequer têm quórum de 3 venues. Se forem poucos, a nova
  // regra de MIN_VENUES é a razão de as mesas terem emudecido — e essa é uma
  // explicação diferente de "o spread não existe".
  const comQuorum = [...bySymbol.values()].filter((q) => q.filter((x) => x.priceUsd > 0).length >= 3).length;

  return NextResponse.json({
    verdict: truthVerdict(stats, janela.floorPct),
    stats,
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
