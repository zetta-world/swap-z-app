import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { fetchOrderbook } from "@/lib/api/cex-orderbook";
import type { CexSpotSource } from "@/lib/api/cex-spot";
import { censusSymbol, censusVerdict, type BookRead, type SymbolCensus } from "@/lib/zion/depth-census";
import { EXCLUDE_VENUES } from "@/lib/zion/arbiter";
import { recordEvent } from "@/lib/admin/track";
import { median } from "@/lib/zion/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CENSO DE PROFUNDIDADE — mede os MAJORS sempre, não só quando parecem oferta.
 *
 * Ver a nota grande em `src/lib/zion/depth-census.ts`. O resumo: a sonda do
 * arbiter só olhava a melhor oportunidade aparente do tick, e livro fino sempre
 * ganha esse concurso — então as 4.085 medições acumuladas são de oito altcoins
 * rasas e ZERO de BTC/ETH/SOL. Um viés de seleção que eu construí.
 *
 * Aqui a lista é FIXA e a medição é incondicional. Se o resultado for ruim, é
 * resultado; não é a amostra escolhendo o que confirma.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera mesa.
 */

/**
 * Os símbolos onde a hipótese pode viver, mais os que já sabemos rasos.
 *
 * ⚠️ OS RASOS FICAM DE PROPÓSITO. Sem MANA/RUNE/SAND na mesma tabela, o número
 * dos majors não tem contra o que ser lido — e "0.03% de pedágio" só significa
 * alguma coisa ao lado de "1.2%". O controle é metade da medição.
 */
const MAJORS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LINK", "AVAX", "LTC", "TRX", "DOT"];
const CONTROLE = ["GRT", "MANA", "RUNE", "SAND", "IMX", "JUP"];

/** Só as venues que a matriz viva prova que respondem, menos as excluídas. */
const VENUES: CexSpotSource[] = (["binance", "okx", "gateio", "bybit", "mexc", "kraken"] as CexSpotSource[])
  .filter((v) => !EXCLUDE_VENUES.includes(v));

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const falhou = async (motivo: string, detalhe?: string) => {
    await recordEvent("depth_census_failed", {
      meta: { motivo, detalhe: detalhe ?? null, tookMs: Date.now() - t0 },
    });
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  const simbolos = [...MAJORS, ...CONTROLE];
  const linhas: SymbolCensus[] = [];
  const semLivro: string[] = [];

  // Em lotes: são ~18 símbolos × 5 venues = 90 chamadas de orderbook. Tudo de
  // uma vez leva 429 em pelo menos uma venue.
  const LOTE = 3;
  for (let i = 0; i < simbolos.length; i += LOTE) {
    const bloco = simbolos.slice(i, i + LOTE);
    const lidos = await Promise.all(bloco.map(async (symbol) => {
      const livros = await Promise.all(VENUES.map(async (v) => {
        try {
          const b = await fetchOrderbook(v, symbol);
          return b ? { venue: v, asks: b.asks, bids: b.bids } as BookRead : null;
        } catch { return null; }
      }));
      return { symbol, livros: livros.filter((b): b is BookRead => b != null) };
    }));
    for (const { symbol, livros } of lidos) {
      if (livros.length < 2) { semLivro.push(symbol); continue; }
      linhas.push(censusSymbol(symbol, livros));
    }
  }

  if (linhas.length === 0) {
    return await falhou(
      "nenhum símbolo com duas venues legíveis",
      `tentados ${simbolos.length} em ${VENUES.length} venues · sem livro: ${semLivro.join(",")}`,
    );
  }

  const majors = linhas.filter((l) => MAJORS.includes(l.symbol));
  const controle = linhas.filter((l) => CONTROLE.includes(l.symbol));
  const veredito = censusVerdict(majors);

  const resumoDe = (ls: SymbolCensus[]) => ({
    n: ls.length,
    medianaPedagio: median(ls.map((l) => l.crossCostPct).filter((x): x is number => x != null)),
    medianaDispersao: median(ls.map((l) => l.dispersionPct).filter((x): x is number => x != null)),
    medianaBorda: median(ls.map((l) => l.edgeBeforeFeesPct).filter((x): x is number => x != null)),
    positivos: ls.filter((l) => (l.edgeBeforeFeesPct ?? -1) > 0).length,
  });

  const resumo = { majors: resumoDe(majors), controle: resumoDe(controle), semLivro };

  await recordEvent("depth_census", { meta: {
    ...resumo,
    verdict: veredito.verdict,
    venues: VENUES,
    // Por símbolo, como o resto do laboratório passou a gravar: agregado sem
    // parcela não é auditável, e número não auditável acaba conferido por chute.
    porSimbolo: linhas.map((l) => ({
      s: l.symbol,
      pedagio: l.crossCostPct == null ? null : Math.round(l.crossCostPct * 1000) / 1000,
      disp: l.dispersionPct == null ? null : Math.round(l.dispersionPct * 1000) / 1000,
      borda: l.edgeBeforeFeesPct == null ? null : Math.round(l.edgeBeforeFeesPct * 1000) / 1000,
      barata: l.cheapVenue, cara: l.richVenue, venues: l.venues.length,
    })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    resumo, veredito,
    majors, controle, venues: VENUES,
    aviso: "Leitura pura. `borda` = dispersão entre mids MENOS o pedágio de atravessar "
      + "meio bid-ask em cada ponta. Borda NEGATIVA antes da taxa fecha a questão: "
      + "não existe tier de taxa nem velocidade que salve.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
