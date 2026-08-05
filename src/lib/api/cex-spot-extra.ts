/**
 * VENUES EM OBSERVAÇÃO — cotadas, medidas, e fora do caminho do dinheiro.
 *
 * ⚠️ POR QUE UM MÓDULO SEPARADO (04/08).
 *
 * O dono tem conta em ~19 corretoras e quis somar todas. A vontade está certa:
 * a nossa dispersão de 0.05% foi medida numa matriz de seis, e mais testemunhas
 * é melhor mediana e mais pares possíveis.
 *
 * Só que ONTEM a Kucoin entrou e o resultado foi:
 *
 *   ruído   kucoin 0.601%  ·  gateio 0.044%  ·  binance 0.037%  ·  okx 0.027%
 *   dos 32 símbolos acima do piso, TRINTA E UM eram ela
 *   e 16 de 19 desvios eram NEGATIVOS — barata em dezesseis moedas ao mesmo
 *   tempo não é praça barata, é feed atrasado
 *
 * Se ela tivesse ido direto para a matriz das mesas, a mesa estaria vendo 31
 * oportunidades de comprar barato — todas falsas. Uma venue nova é uma
 * hipótese, não um upgrade.
 *
 * Por isso estas venues NÃO entram em `CexSpotSource`. Aquele tipo é o que as
 * mesas consomem, e mantê-lo estreito é o que impede uma venue nova de virar
 * caminho de dinheiro por descuido — foi exatamente assim que a Kucoin quase
 * entrou na `arbiter2` pela porta dos fundos, quando o literal de exclusão
 * estava copiado em três arquivos.
 *
 * Aqui elas são OBSERVADAS. O `venue-truth` as lê, mede a dispersão de cada
 * uma, e o número decide quem sobe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O PORTÃO PARA PROMOVER UMA VENUE (declarado antes de qualquer dado):
 *
 *  1. dispersão na mesma casa das boas — ≤0.05%, não ≤0.6%;
 *  2. em VÁRIAS leituras, em DIAS diferentes (a Kucoin foi de 0.140% às 13h
 *     para 0.601% às 21h; uma leitura só teria absolvido);
 *  3. desvio SEM viés de direção — barata sempre, em muitas moedas, é atraso
 *     de feed. `classifyVenue` já separa isso por bias/dispersão;
 *  4. e a pergunta que nenhum código responde: dá para sacar de lá?
 *
 * ⚠️ O ITEM 4 NÃO É TÉCNICO E É O QUE MAIS IMPORTA. O modelo dos "dois bolsos"
 * exige saldo parado em CADA venue. Dezenove venues é o capital dividido por
 * dezenove e o risco de custódia multiplicado por dezenove — e várias desta
 * lista são pequenas. Spread numa corretora de onde não se saca não é
 * oportunidade, é armadilha, e é exatamente por isso que ele fica grande e
 * PERSISTE: ninguém consegue tomá-lo.
 */

/** Venues em observação. Nomes em minúsculo, como o resto da casa. */
export type ObservedVenue =
  | "poloniex"
  | "htx"        // ex-Huobi
  | "bitfinex"
  | "blockchain" // Blockchain.com Exchange
  | "bitmex"
  | "latoken"
  | "p2b"        // p2pb2b
  | "bit2me";

export const OBSERVED_VENUES: ObservedVenue[] = [
  "poloniex", "htx", "bitfinex", "blockchain", "bitmex", "latoken", "p2b", "bit2me",
];

/**
 * ⚠️ AS QUE O DONO CITOU E QUE EU **NÃO** ADICIONEI, com o motivo.
 *
 * Não é preguiça e não é opinião sobre a corretora — é que cada uma quebra uma
 * premissa da medição, e incluí-la produziria número com cara de válido.
 *
 * · `stormgain` — é corretora-broker com preço SINTÉTICO derivado de feeds, não
 *   livro de ordens próprio. Arbitrar contra um preço sintético não é
 *   arbitragem: não existe a contraparte do outro lado do livro.
 *
 * · `mercatox` — histórico longo de saque travado. Spread lá é o caso-escola do
 *   "spread que persiste é spread que ninguém consegue tomar". Mediria bonito e
 *   seria intomável.
 *
 * · `bithumb global` — encerrada/rebatizada; não há endpoint público estável.
 *
 * · `cointiger`, `toobit` — sem endpoint público de tickers em massa que eu
 *   possa afirmar com confiança. Entrariam como adaptador por símbolo, que a
 *   ~55 símbolos por minuto é volume de requisição real, e entrariam ADIVINHADO
 *   — que é como se escreve um adaptador que devolve vazio em silêncio.
 *
 * · `okex`, `kraken`, `binance`, `gate.io`, `coinbase`, `kucoin` — já estão na
 *   casa (a coinbase excluída por cotar USD, a kucoin excluída por medição).
 *
 * Nenhuma delas está descartada para sempre. Estão descartadas SEM MEDIÇÃO, que
 * é diferente, e o motivo está escrito para poder ser contestado com dado.
 */
export const DECLINED_VENUES: Record<string, string> = {
  stormgain: "preço sintético de broker, sem livro próprio — não há contraparte para arbitrar",
  mercatox: "histórico de saque travado — spread que persiste é spread intomável",
  bithumb_global: "encerrada/rebatizada, sem endpoint público estável",
  cointiger: "sem endpoint de tickers em massa confiável — entraria adivinhado",
  toobit: "sem endpoint de tickers em massa confiável — entraria adivinhado",
};

export interface ObservedQuote { venue: ObservedVenue; priceUsd: number }

/**
 * O resultado de UMA venue, com o motivo quando não deu.
 *
 * ⚠️ `status` existe porque adaptador novo é escrito às cegas: o proxy do
 * sandbox bloqueia as CEX, então nenhum destes formatos foi exercitado daqui.
 * Um adaptador com o formato errado devolve lista vazia, e lista vazia na tela
 * lê-se como "sem oportunidade" — o defeito que esta semana achou seis vezes.
 * Com o status, adaptador quebrado se ANUNCIA em vez de sumir.
 */
export interface VenueFetch {
  venue: ObservedVenue;
  ok: boolean;
  status: number | string;
  parsed: number;
  quotes: Map<string, number>;
}

async function getJson(url: string): Promise<{ body: unknown; status: number | string }> {
  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) return { body: null, status: res.status };
    return { body: await res.json(), status: res.status };
  } catch (e) { return { body: null, status: String(e).slice(0, 60) }; }
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Extrai a base de um par como "BTC_USDT", "BTCUSDT", "tBTCUST", "BTC-USDT".
 *
 * ⚠️ EXPORTADA PARA TESTE porque é onde adaptador escrito às cegas erra.
 * Cada corretora escolheu um separador diferente, e um sufixo mal casado não
 * estoura: ele só não encontra o símbolo, e a venue inteira aparece com zero
 * cotações — indistinguível de "a venue não tem esses pares".
 */
export function baseDe(par: string, sufixos: string[]): string | null {
  const p = par.toUpperCase();
  for (const s of sufixos) {
    if (p.endsWith(s) && p.length > s.length) {
      return p.slice(0, p.length - s.length).replace(/[-_/]$/, "");
    }
  }
  return null;
}

type Linha = { par: string; preco: number };

/** Roda um adaptador genérico: baixa, mapeia para {par, preço}, filtra o que interessa. */
async function adaptar(
  venue: ObservedVenue, url: string, sufixos: string[],
  extrair: (body: unknown) => Linha[],
  querido: Set<string>,
): Promise<VenueFetch> {
  const { body, status } = await getJson(url);
  const quotes = new Map<string, number>();
  if (body == null) return { venue, ok: false, status, parsed: 0, quotes };
  let linhas: Linha[] = [];
  try { linhas = extrair(body); } catch (e) {
    return { venue, ok: false, status: `parse: ${String(e).slice(0, 40)}`, parsed: 0, quotes };
  }
  for (const { par, preco } of linhas) {
    if (!(preco > 0)) continue;
    const base = baseDe(par, sufixos);
    if (!base || !querido.has(base)) continue;
    quotes.set(base, preco);
  }
  // `ok` é sobre o TRANSPORTE. Zero símbolos com HTTP 200 é adaptador com
  // formato errado, e precisa aparecer diferente de "a venue caiu".
  return { venue, ok: true, status, parsed: quotes.size, quotes };
}

/**
 * Busca as venues observadas. Cada uma falha sozinha e reporta o próprio status.
 *
 * ⚠️ Todos os formatos abaixo são de documentação pública e NÃO foram
 * exercitados daqui (o proxy bloqueia as CEX). O `parsed: 0` com status 200 é
 * o sinal de adaptador errado, e a rota de sonda existe para mostrá-lo.
 */
export async function fetchObservedVenues(simbolos: string[]): Promise<VenueFetch[]> {
  const querido = new Set(simbolos.map((s) => s.toUpperCase()));

  return Promise.all([
    // Poloniex: [{symbol:"BTC_USDT", markPrice/close:"..."}]
    adaptar("poloniex", "https://api.poloniex.com/markets/ticker24h", ["_USDT", "USDT"],
      (b) => (b as Array<{ symbol?: string; close?: string; markPrice?: string }>)
        .map((r) => ({ par: r.symbol ?? "", preco: num(r.close ?? r.markPrice) })), querido),

    // HTX (ex-Huobi): {data:[{symbol:"btcusdt", close:number}]}
    adaptar("htx", "https://api.huobi.pro/market/tickers", ["USDT"],
      (b) => ((b as { data?: Array<{ symbol?: string; close?: number }> }).data ?? [])
        .map((r) => ({ par: (r.symbol ?? "").toUpperCase(), preco: num(r.close) })), querido),

    // Bitfinex v2: [["tBTCUSD", bid, ..., lastPrice(idx 7), ...]]
    adaptar("bitfinex", "https://api-pub.bitfinex.com/v2/tickers?symbols=ALL", ["USD", "UST"],
      (b) => (b as unknown[][])
        .filter((r) => typeof r[0] === "string" && String(r[0]).startsWith("t"))
        .map((r) => ({ par: String(r[0]).slice(1), preco: num(r[7]) })), querido),

    // Blockchain.com: [{symbol:"BTC-USDT", last_trade_price:number}]
    adaptar("blockchain", "https://api.blockchain.com/v3/exchange/tickers", ["-USDT", "USDT"],
      (b) => (b as Array<{ symbol?: string; last_trade_price?: number }>)
        .map((r) => ({ par: r.symbol ?? "", preco: num(r.last_trade_price) })), querido),

    // BitMEX: [{symbol:"XBTUSDT", lastPrice:number}] — nota: BTC é "XBT" lá.
    adaptar("bitmex", "https://www.bitmex.com/api/v1/instrument/active", ["USDT"],
      (b) => (b as Array<{ symbol?: string; lastPrice?: number }>)
        .map((r) => ({
          // XBT é o ticker histórico da BitMEX para BTC. Sem esta troca, o BTC
          // some da matriz dela em silêncio.
          par: (r.symbol ?? "").replace(/^XBT/, "BTC"),
          preco: num(r.lastPrice),
        })), querido),

    // LATOKEN: [{symbol:"BTC/USDT", lastPrice:"..."}]
    adaptar("latoken", "https://api.latoken.com/v2/ticker", ["/USDT", "USDT"],
      (b) => (b as Array<{ symbol?: string; lastPrice?: string }>)
        .map((r) => ({ par: r.symbol ?? "", preco: num(r.lastPrice) })), querido),

    // P2B: {result:{"BTC_USDT":{ticker:{last:"..."}}}}
    adaptar("p2b", "https://api.p2pb2b.com/api/v2/public/tickers", ["_USDT", "USDT"],
      (b) => Object.entries((b as { result?: Record<string, { ticker?: { last?: string } }> }).result ?? {})
        .map(([par, v]) => ({ par, preco: num(v?.ticker?.last) })), querido),

    // Bit2Me: [{symbol:"BTC/USDT", close:"..."}]
    adaptar("bit2me", "https://gateway.bit2me.com/v1/trading/ticker", ["/USDT", "USDT"],
      (b) => (Array.isArray(b) ? b as Array<{ symbol?: string; close?: string }> : [])
        .map((r) => ({ par: r.symbol ?? "", preco: num(r.close) })), querido),
  ]);
}
