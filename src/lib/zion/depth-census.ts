/**
 * CENSO DE PROFUNDIDADE — o custo de ATRAVESSAR, medido onde importa.
 *
 * ⚠️ POR QUE ISTO EXISTE (04/08), e é um viés de seleção que eu construí.
 *
 * A sonda de orderbook do arbiter só media a MELHOR oportunidade aparente de
 * cada tick. Parecia econômico e era um filtro perverso: livro fino é
 * exatamente o que produz o maior spread aparente, então a "melhor oportunidade"
 * era sempre uma altcoin rasa.
 *
 * Resultado: as 4.085 medições acumuladas são de OITO altcoins — MANA 2.122,
 * RUNE 561, SAND 576, IMX, VET, STX, JUP, GRT. Zero em BTC, ETH ou SOL.
 *
 * Medimos exatamente onde não pode funcionar, e nunca olhamos onde poderia.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A CONTA QUE DECIDE TUDO, e que a curva de equilíbrio revelou:
 *
 *   custo de ida e volta   quantas das 4.085 pagariam
 *   0.40% (o nosso)        17
 *   0.10%                  137
 *   0.05%                  165
 *   0.00%  — de graça      209   (5.1%)
 *
 * Com taxa ZERO, 95% continuam perdendo. Logo o problema NUNCA foi a taxa.
 *
 * O que come o spread é o BID-ASK, pago duas vezes: compra-se no ask de uma
 * venue e vende-se no bid da outra. O slippage médio medido foi 1.1% — e a
 * diferença entre venues que a mesa persegue é 0.05%. Não se atravessa dois
 * spreads de meio ponto para capturar cinco centésimos. É aritmética, não
 * competição: nenhuma velocidade e nenhum tier de taxa muda essa conta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO MEDE, e por que é a pergunta certa:
 *
 *   travessia = (ask−bid)/mid da venue barata + (ask−bid)/mid da venue cara
 *   dispersão = quanto os MIDs das venues discordam entre si
 *
 * Se `dispersão > travessia`, existe mesa. Se não, não existe em NENHUM nível
 * de taxa. Nos majors o bid-ask costuma ser 0.01–0.02% por lado, não 0.5% —
 * e é essa a hipótese que nunca foi testada porque a seleção a escondia.
 */

import type { Level } from "@/lib/zion/arb-realism";

export interface BookRead { venue: string; asks: Level[]; bids: Level[] }

export interface VenueCross {
  venue: string;
  bid: number;
  ask: number;
  mid: number;
  /** (ask − bid) / mid, em %. O pedágio para entrar E sair desta venue. */
  crossPct: number;
  /** Profundidade em USD nos `n` primeiros níveis de cada lado. */
  depthAskUsd: number;
  depthBidUsd: number;
}

export interface SymbolCensus {
  symbol: string;
  venues: VenueCross[];
  /** Discordância entre os MIDs: (maior − menor) / menor, em %. */
  dispersionPct: number | null;
  /** Onde comprar e onde vender, pelo mid — a rota que a mesa escolheria. */
  cheapVenue: string | null;
  richVenue: string | null;
  /**
   * O PEDÁGIO REAL da rota: metade do bid-ask de cada ponta.
   *
   * Metade porque atravessar é ir do mid até o ask (comprando) e do mid até o
   * bid (vendendo) — meio spread de cada lado, não um inteiro.
   */
  crossCostPct: number | null;
  /**
   * ⚠️ O NÚMERO QUE RESPONDE A PERGUNTA: dispersão menos pedágio.
   *
   * Positivo = existe borda ANTES de qualquer taxa. Negativo = não existe em
   * nível de taxa nenhum, e a conversa sobre velocidade e tier VIP é vazia.
   */
  edgeBeforeFeesPct: number | null;
}

const topo = (l: Level[]): number | null => (l.length && l[0][0] > 0 ? l[0][0] : null);
const somaUsd = (l: Level[], n = 5): number =>
  l.slice(0, n).reduce((s, [p, q]) => s + (p > 0 && q > 0 ? p * q : 0), 0);

/** O pedágio de UMA venue: o bid-ask relativo ao mid. */
export function venueCross(venue: string, asks: Level[], bids: Level[]): VenueCross | null {
  const ask = topo(asks), bid = topo(bids);
  if (ask == null || bid == null || !(ask > 0) || !(bid > 0)) return null;
  // Livro cruzado (bid acima do ask) é dado corrompido, não oportunidade —
  // devolver um pedágio negativo faria a conta inteira mentir a favor.
  if (bid >= ask) return null;
  const mid = (ask + bid) / 2;
  return {
    venue, bid, ask, mid,
    crossPct: ((ask - bid) / mid) * 100,
    depthAskUsd: somaUsd(asks),
    depthBidUsd: somaUsd(bids),
  };
}

/**
 * O censo de um símbolo a partir dos livros lidos.
 *
 * ⚠️ Usa MID, não último preço. O último negócio pode ter sido no bid ou no
 * ask, e num livro largo isso sozinho fabrica meio spread de "dispersão" que
 * não existe. Foi comparando últimos preços que a mesa achou 0.72% de borda.
 */
export function censusSymbol(symbol: string, livros: BookRead[]): SymbolCensus {
  const venues = livros
    .map((b) => venueCross(b.venue, b.asks, b.bids))
    .filter((v): v is VenueCross => v != null)
    .sort((a, b) => a.mid - b.mid);

  if (venues.length < 2) {
    return {
      symbol, venues, dispersionPct: null,
      cheapVenue: null, richVenue: null, crossCostPct: null, edgeBeforeFeesPct: null,
    };
  }

  const barata = venues[0], cara = venues[venues.length - 1];
  const dispersionPct = ((cara.mid - barata.mid) / barata.mid) * 100;
  // Meio spread de cada ponta: subir do mid ao ask na barata, descer do mid ao
  // bid na cara.
  const crossCostPct = barata.crossPct / 2 + cara.crossPct / 2;

  return {
    symbol, venues, dispersionPct,
    cheapVenue: barata.venue, richVenue: cara.venue, crossCostPct,
    edgeBeforeFeesPct: dispersionPct - crossCostPct,
  };
}

/**
 * O VEREDITO DO CENSO.
 *
 * Regras que não se negociam, e todas vêm de cicatriz desta semana:
 *
 *  · o que decide é `edgeBeforeFeesPct`. Borda negativa ANTES da taxa fecha a
 *    questão — não adianta discutir tier VIP nem colocation.
 *  · símbolo sem duas venues não vira número.
 *  · a MEDIANA manda, não a média: um símbolo com livro corrompido puxaria a
 *    média e descreveria um mercado que ninguém opera.
 */
export interface CensusVerdict {
  positivos: number;
  total: number;
  medianaEdge: number | null;
  verdict: string;
}

export function censusVerdict(linhas: SymbolCensus[], custoMinimoPct = 0.034): CensusVerdict {
  const uteis = linhas.filter((l) => l.edgeBeforeFeesPct != null);
  if (uteis.length === 0) {
    return { positivos: 0, total: 0, medianaEdge: null, verdict: "nenhum símbolo com duas venues legíveis — inconclusivo" };
  }
  const edges = uteis.map((l) => l.edgeBeforeFeesPct!).sort((a, b) => a - b);
  const m = Math.floor(edges.length / 2);
  const mediana = edges.length % 2 ? edges[m] : (edges[m - 1] + edges[m]) / 2;
  const positivos = uteis.filter((l) => l.edgeBeforeFeesPct! > 0).length;
  // Borda que nem paga a taxa mais barata possível não é borda operável.
  const operaveis = uteis.filter((l) => l.edgeBeforeFeesPct! > custoMinimoPct).length;

  if (positivos === 0) {
    return {
      positivos, total: uteis.length, medianaEdge: mediana,
      verdict: `nenhum dos ${uteis.length} símbolos tem borda ANTES da taxa — mediana ${mediana.toFixed(3)}%. `
        + "Atravessar os dois livros custa mais que a discordância entre venues, "
        + "então não existe nível de taxa que salve.",
    };
  }
  return {
    positivos, total: uteis.length, medianaEdge: mediana,
    verdict: `${positivos} de ${uteis.length} têm borda antes da taxa · ${operaveis} sobrariam mesmo `
      + `com o custo mais baixo possível (${custoMinimoPct}%) · mediana ${mediana.toFixed(3)}%. `
      + "Borda antes da taxa é condição NECESSÁRIA, não suficiente: velocidade e tier decidem o resto.",
  };
}
