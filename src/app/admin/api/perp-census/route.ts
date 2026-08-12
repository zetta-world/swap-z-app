import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { fetchPerpBook, PERP_VENUES } from "@/lib/api/cex-perp";
import { censusSymbol, censusVerdict, type BookRead, type SymbolCensus } from "@/lib/zion/depth-census";
import { recordEvent } from "@/lib/admin/track";
import { median } from "@/lib/zion/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * CENSO DE PERPÉTUO — a mesa de futuros, medida antes de existir.
 *
 * Ver `src/lib/api/cex-perp.ts` para o porquê de uma mesa de futuros e para as
 * duas razões de desconfiar dela (funding e liquidação).
 *
 * A pergunta é a MESMA do censo spot, e a régua é a mesma função: a
 * discordância entre venues supera o pedágio de atravessar os dois livros?
 * Usar a mesma `censusSymbol` nos dois é de propósito — se cada mesa tivesse a
 * própria conta, a comparação entre elas não significaria nada, que foi o erro
 * das janelas de 260 e 174 dias.
 *
 * ⚠️ SÓ DUAS VENUES. `fapi.binance.com` devolveu 451 (bloqueio jurisdicional) e
 * a bybit 403, medidos em 57 símbolos cada e gravados em `funding_study_failed`.
 * Com duas venues não há testemunha independente para o corte de outlier — a
 * mediana de duas é o ponto médio, e qualquer uma pode ser a errada. Por isso
 * este censo MEDE mas não sustenta mesa: ele responde "vale a pena procurar
 * mais venues de perp?", não "abre posição".
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`.
 */

const MAJORS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "LINK", "AVAX", "LTC"];
const CONTROLE = ["MANA", "RUNE", "SAND", "GRT"];

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const falhou = async (motivo: string, detalhe?: string) => {
    await recordEvent("perp_census_failed", {
      meta: { motivo, detalhe: detalhe ?? null, tookMs: Date.now() - t0 },
    });
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  const simbolos = [...MAJORS, ...CONTROLE];
  const linhas: SymbolCensus[] = [];
  const semLivro: string[] = [];

  const LOTE = 4;
  for (let i = 0; i < simbolos.length; i += LOTE) {
    const bloco = simbolos.slice(i, i + LOTE);
    const lidos = await Promise.all(bloco.map(async (symbol) => {
      const livros = await Promise.all(PERP_VENUES.map(async (v) => {
        const b = await fetchPerpBook(v, symbol);
        return b ? { venue: v, asks: b.asks, bids: b.bids } as BookRead : null;
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
      "nenhum símbolo com duas venues de perp legíveis",
      `tentados ${simbolos.length} em ${PERP_VENUES.join(",")} · sem livro: ${semLivro.join(",")}`,
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

  await recordEvent("perp_census", { meta: {
    ...resumo,
    verdict: veredito.verdict,
    venues: PERP_VENUES,
    porSimbolo: linhas.map((l) => ({
      s: l.symbol,
      pedagio: l.crossCostPct == null ? null : Math.round(l.crossCostPct * 1000) / 1000,
      disp: l.dispersionPct == null ? null : Math.round(l.dispersionPct * 1000) / 1000,
      borda: l.edgeBeforeFeesPct == null ? null : Math.round(l.edgeBeforeFeesPct * 1000) / 1000,
      barata: l.cheapVenue, cara: l.richVenue,
    })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    resumo, veredito,
    majors, controle, venues: PERP_VENUES,
    naoMedido: [
      "funding acumulado enquanto a posição existe (mediana +1.4%/ano, cauda de −16% — medido em 04/08)",
      "risco de liquidação da perna vendida",
      "profundidade em USD: a gate.io cota em CONTRATOS e o multiplicador varia por moeda; "
        + "o bid-ask é uma razão entre preços e não depende disso, mas a profundidade absoluta depende",
    ],
    aviso: "Leitura pura, e só DUAS venues (binance-futuros 451, bybit 403). Com duas não há "
      + "testemunha independente para corte de outlier — este censo diz se vale procurar mais "
      + "venues de perp, não se abre posição.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
