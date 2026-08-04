import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getMultiExchangeSpot, CEX_TRACKED_SYMBOLS, type CexSpotSource } from "@/lib/api/cex-spot";
import { findArbs, dropOutliers, upperMiddle, trueMedian, EXCLUDE_VENUES } from "@/lib/zion/arbiter";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ANTES E DEPOIS DA MEDIANA DO ARBITER — a mesma matriz, as duas contas.
 *
 * ⚠️ POR QUE ESTA ROTA EXISTE, e por que o conserto não foi junto (04/08).
 *
 * O corte de outlier do arbiter usa `s[Math.floor(n / 2)]`, que não é mediana
 * com `n` par — o mesmo defeito que inflava em 11 pontos o relatório do "o que
 * teria funcionado". A diferença é que ali ele mentia num número de tela, e
 * aqui ele decide onde a mesa compra.
 *
 * A troca AFROUXA o portão. A conta errada enviesa a mediana para cima, o que
 * desloca a faixa aceita para cima, o que corta preferencialmente as cotações
 * BARATAS — e barata é justamente a ponta onde a mesa compra. Consertar a
 * aritmética devolve essas cotações, aumenta os spreads detectados e reabre
 * símbolos que hoje morrem por quórum.
 *
 * Essa é a direção que já custou caro aqui: os +34% da coorte eram variância do
 * feed da Gate.io entrando como "venue barata", que é exatamente a classe de
 * coisa que este corte existe para matar. Trocar a fórmula e no mesmo movimento
 * reabrir essa porta seria corrigir um erro de conta criando um risco de
 * dinheiro, sem medir nenhum dos dois.
 *
 * Então: mede primeiro. Esta rota lê a matriz VIVA — a mesma de
 * `getMultiExchangeSpot`, mesmas exclusões — e roda as duas fórmulas sobre ela,
 * lado a lado. O resultado diz, em número, quantos símbolos mudam de
 * sobreviventes, quantos mudam de quórum e quantas oportunidades aparecem que
 * hoje não existem.
 *
 * ⚠️ ESTA ROTA NÃO MUDA NADA. É leitura pura; não abre posição, não escreve em
 * `admin_kv`, não altera o padrão do `findArbs`. O padrão só vira a mediana de
 * verdade depois que este número for lido.
 */


const OUTLIER_PCT = Number(process.env.ARB_OUTLIER_PCT ?? 2);
const MIN_VENUES = Number(process.env.ARB_MIN_VENUES ?? 3);

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const falhou = async (motivo: string, detalhe?: string) => {
    await recordEvent("arbiter_median_probe_failed", {
      meta: { motivo, detalhe: detalhe ?? null, tookMs: Date.now() - t0 },
    });
    return NextResponse.json({ error: motivo, detail: detalhe ?? null }, { status: 503 });
  };

  let matrix: Map<string, Map<string, { priceUsd: number }>>;
  try {
    const spot = await getMultiExchangeSpot([...CEX_TRACKED_SYMBOLS], {
      skipVenues: EXCLUDE_VENUES as CexSpotSource[],
    });
    matrix = spot as unknown as Map<string, Map<string, { priceUsd: number }>>;
    for (const venues of matrix.values()) for (const v of EXCLUDE_VENUES) venues.delete(v);
  } catch (e) {
    return await falhou("falha ao ler a matriz de venues", String(e).slice(0, 200));
  }

  if (matrix.size === 0) return await falhou("matriz vazia — nenhuma venue respondeu");

  // ── Por símbolo: o que cada fórmula deixa passar.
  //
  // ⚠️ Note que NÃO removo os símbolos de livro fino aqui, como as mesas fazem.
  // A pergunta é sobre a aritmética do corte, e tirar símbolos antes esconderia
  // justamente os casos em que ela é decisiva.
  const linhas = [...matrix].map(([symbol, venues]) => {
    const quotes: Array<{ v: string; p: number }> = [];
    for (const [v, { priceUsd }] of venues) if (priceUsd > 0) quotes.push({ v, p: priceUsd });

    const antes = dropOutliers(quotes, OUTLIER_PCT, upperMiddle);
    const depois = dropOutliers(quotes, OUTLIER_PCT, trueMedian);

    const nomes = (qs: typeof quotes) => qs.map((q) => q.v).sort().join(",");
    const menor = (qs: typeof quotes) => (qs.length ? Math.min(...qs.map((q) => q.p)) : null);
    const spread = (qs: typeof quotes) => {
      if (qs.length < 2) return null;
      const lo = Math.min(...qs.map((q) => q.p)), hi = Math.max(...qs.map((q) => q.p));
      return lo > 0 ? ((hi - lo) / lo) * 100 : null;
    };

    return {
      symbol,
      venues: quotes.length,
      par: quotes.length % 2 === 0,
      sobrevivemAntes: antes.length,
      sobrevivemDepois: depois.length,
      mudouSobreviventes: nomes(antes) !== nomes(depois),
      // Só quem sobrou em UMA das duas — é o que a troca literalmente devolve.
      devolvidas: depois.filter((d) => !antes.some((a) => a.v === d.v)).map((q) => q.v),
      removidas: antes.filter((a) => !depois.some((d) => d.v === a.v)).map((q) => q.v),
      quorumAntes: antes.length >= MIN_VENUES,
      quorumDepois: depois.length >= MIN_VENUES,
      compraAntes: menor(antes),
      compraDepois: menor(depois),
      spreadAntes: spread(antes),
      spreadDepois: spread(depois),
    };
  }).sort((a, b) => Number(b.mudouSobreviventes) - Number(a.mudouSobreviventes));

  // ── E o efeito de ponta a ponta: as oportunidades que cada conta produz.
  const oppAntes = findArbs(matrix, undefined, undefined, undefined, OUTLIER_PCT, MIN_VENUES, upperMiddle);
  const oppDepois = findArbs(matrix, undefined, undefined, undefined, OUTLIER_PCT, MIN_VENUES, trueMedian);
  const chave = (o: { symbol: string; buyVenue: string; sellVenue: string }) =>
    `${o.symbol}:${o.buyVenue}>${o.sellVenue}`;
  const antesSet = new Set(oppAntes.map(chave));
  const depoisSet = new Set(oppDepois.map(chave));

  const resumo = {
    simbolos: linhas.length,
    simbolosComQuorum: linhas.filter((l) => l.quorumAntes).length,
    // Onde as duas contas PODEM divergir: contagem par de cotações.
    contagemPar: linhas.filter((l) => l.par).length,
    // Onde de fato divergiram.
    mudaramSobreviventes: linhas.filter((l) => l.mudouSobreviventes).length,
    ganharamQuorum: linhas.filter((l) => !l.quorumAntes && l.quorumDepois).length,
    perderamQuorum: linhas.filter((l) => l.quorumAntes && !l.quorumDepois).length,
    cotacoesDevolvidas: linhas.reduce((s, l) => s + l.devolvidas.length, 0),
    cotacoesRemovidas: linhas.reduce((s, l) => s + l.removidas.length, 0),
    oportunidadesAntes: oppAntes.length,
    oportunidadesDepois: oppDepois.length,
    oportunidadesNovas: oppDepois.filter((o) => !antesSet.has(chave(o))).map((o) => ({
      symbol: o.symbol, buy: o.buyVenue, sell: o.sellVenue,
      spreadPct: Math.round(o.spreadPct * 1000) / 1000,
      netPct: Math.round(o.netPct * 1000) / 1000,
      suspect: o.suspect,
    })),
    oportunidadesPerdidas: oppAntes.filter((o) => !depoisSet.has(chave(o))).map((o) => ({
      symbol: o.symbol, buy: o.buyVenue, sell: o.sellVenue,
      spreadPct: Math.round(o.spreadPct * 1000) / 1000,
    })),
  };

  await recordEvent("arbiter_median_probe", { meta: {
    ...resumo,
    outlierPct: OUTLIER_PCT, minVenues: MIN_VENUES,
    // As linhas que mudaram, com nome — sem isso o agregado não é auditável,
    // que foi a lição da mediana do what-worked.
    mudancas: linhas.filter((l) => l.mudouSobreviventes).slice(0, 40).map((l) => ({
      s: l.symbol, n: l.venues,
      devolvidas: l.devolvidas, removidas: l.removidas,
      spreadAntes: l.spreadAntes == null ? null : Math.round(l.spreadAntes * 1000) / 1000,
      spreadDepois: l.spreadDepois == null ? null : Math.round(l.spreadDepois * 1000) / 1000,
    })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    resumo,
    linhas: linhas.slice(0, 80),
    outlierPct: OUTLIER_PCT,
    minVenues: MIN_VENUES,
    aviso: "Leitura pura: não abre posição, não escreve em admin_kv, não muda o "
      + "padrão do findArbs. O padrão continua sendo a conta ANTIGA até este "
      + "número ser lido.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
