/**
 * A DERRAPAGEM — o custo que este laboratório NUNCA mediu.
 *
 * ⚠️⚠️ POR QUE ISTO É O MAIOR BURACO QUE RESTA (17/08).
 *
 * Todo resultado direcional daqui é líquido de `CUSTO_POR_PERNA_PCT` = 0,2%.
 * Em 15/08 a consulta à Gate.io mostrou que a **taxa publicada é 0,2% por
 * ordem** — ou seja, a taxa consome o orçamento INTEIRO e sobra **zero** para
 * impacto de preço.
 *
 * O `compararCusto` já dizia isso com todas as letras. O que faltava era o
 * outro lado da conta: *quanto* a derrapagem custa. Sem esse número, "os
 * resultados são otimistas" é uma frase; com ele, é uma quantidade.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ GATE.IO, NÃO BINANCE — e essa escolha é a metade do valor desta medição.
 *
 * O repositório já tem um caminho de livro de ofertas: `fetchOrderBook` em
 * `market-indicators.ts`, que lê a **Binance**. Seria o caminho fácil, e estaria
 * errado: as carteiras de papel preenchem na **Gate.io** (`gateioSpot`,
 * `gateioKlines` em `paper/engine.ts`), e a taxa de 0,2% que estamos tentando
 * complementar também é da Gate.io.
 *
 * Medir profundidade numa corretora para calibrar preenchimento em outra é o
 * mesmo tipo de descasamento que fez o custo do HEIMDALL ser carimbado com o
 * nome da GERI: dois números que parecem a mesma grandeza e descrevem coisas
 * diferentes. Um livro mais fundo na Binance faria a derrapagem parecer menor
 * do que a que as mesas de fato pagam.
 *
 * ⚠️ E O QUE ISTO **NÃO** MEDE, que continua sendo bastante:
 *
 *  1. **Derrapagem de tempo.** Isto anda o livro de AGORA. Entre decidir e
 *     preencher o preço anda, e esse pedaço só aparece comparando
 *     `quoted_price` com `executed_price` em ordem real — instrumentação que
 *     ainda não existe.
 *  2. **Maker versus taker.** Andar o livro é execução a mercado (taker). Uma
 *     ordem limitada que descansa no livro tem derrapagem diferente, e às
 *     vezes negativa.
 *  3. **O livro no instante do preenchimento.** Um retrato não é um filme;
 *     em notícia o livro afina em segundos.
 *
 * Ainda assim é o PISO honesto: se o impacto já não cabe no orçamento com o
 * livro calmo de agora, ele nunca vai caber.
 */

import { vwapBuy, vwapSell, type Level } from "@/lib/zion/arb-realism";
import { CUSTO_POR_PERNA_PCT } from "@/lib/zion/custo";

export const GATEIO_API = "https://api.gateio.ws/api/v4";

export interface LivroDeOfertas {
  simbolo: string;
  asks: Level[];
  bids: Level[];
}

/**
 * ⚠️ OS TAMANHOS SÃO VÁRIOS DE PROPÓSITO, e é a decisão central do módulo.
 *
 * Derrapagem não é uma propriedade do par — é uma propriedade do par NAQUELE
 * tamanho. Um número só esconderia exatamente a pergunta que o dono precisa
 * responder: *"até quanto eu posso crescer antes de o custo comer a borda?"*
 *
 * $50 é o que as mesas de papel operam hoje (`cost_usd` = 49,99 nas posições
 * abertas). Os outros são os degraus de crescimento — e o valor da tabela está
 * em ver ONDE ela vira vermelha.
 */
export const TAMANHOS_USD = [50, 100, 500, 1_000, 5_000, 25_000] as const;

export interface ImpactoNoTamanho {
  usd: number;
  /** Impacto da perna de COMPRA, em % acima do melhor ask. */
  compraPct: number | null;
  /** Impacto da perna de VENDA, em % abaixo do melhor bid. */
  vendaPct: number | null;
  /** Ida e volta: as duas pernas somadas. */
  idaEVoltaPct: number | null;
  /**
   * ⚠️ O LIVRO ACABOU ANTES DO TAMANHO PEDIDO.
   *
   * Quando isto é `true` o impacto medido é um PISO, não o valor: o resto da
   * ordem preencheria em preços piores que nem estão no retrato. Errar aqui
   * para o lado otimista é o pior erro possível — seria dizer "cabe" sobre um
   * tamanho que a corretora não consegue atender.
   */
  livroAcabou: boolean;
}

/**
 * Anda o livro nos dois sentidos e mede o quanto o preço piora.
 *
 * ⚠️ A REFERÊNCIA É O TOPO DO LIVRO, não o preço médio. O que se quer saber é
 * "quanto pior que o melhor preço visível eu fecho" — que é a definição de
 * impacto. Comparar com o meio do spread misturaria impacto com o spread, e o
 * spread é custo de outra natureza (já pago por quem cruza).
 */
export function impactoNoLivro(livro: LivroDeOfertas, usd: number): ImpactoNoTamanho {
  const melhorAsk = livro.asks[0]?.[0] ?? 0;
  const melhorBid = livro.bids[0]?.[0] ?? 0;
  if (!(melhorAsk > 0) || !(melhorBid > 0) || !(usd > 0)) {
    return { usd, compraPct: null, vendaPct: null, idaEVoltaPct: null, livroAcabou: true };
  }

  const compra = vwapBuy(livro.asks, usd);
  // Vende a MESMA quantidade base que a compra trouxe — é o que fecha o ciclo.
  const base = compra.baseFilled > 0 ? compra.baseFilled : usd / melhorAsk;
  const venda = vwapSell(livro.bids, base);

  const compraPct = compra.avgPrice > 0 ? ((compra.avgPrice - melhorAsk) / melhorAsk) * 100 : null;
  const vendaPct  = venda.avgPrice  > 0 ? ((melhorBid - venda.avgPrice) / melhorBid) * 100 : null;

  return {
    usd, compraPct, vendaPct,
    idaEVoltaPct: compraPct != null && vendaPct != null ? compraPct + vendaPct : null,
    livroAcabou: !compra.fullyFilled || !venda.fullyFilled,
  };
}

/** ⚠️ MEDIANA, NÃO MÉDIA — pelo mesmo motivo da taxa: um par fino com impacto
 *  enorme puxaria a média para um número que nenhuma mesa paga. */
export function mediana(valores: readonly (number | null)[]): number | null {
  const v = valores.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export interface VereditoDerrapagem {
  usd: number;
  /** Mediana do impacto de ida e volta entre os pares medidos, em %. */
  idaEVoltaPct: number | null;
  /** Quantos pares tiveram o livro esgotado neste tamanho. */
  paresComLivroCurto: number;
  pares: number;
  /**
   * ⚠️ O QUE SOBRA DEPOIS DE TAXA **E** DERRAPAGEM.
   *
   * `orçamento(ida e volta) − taxa(ida e volta) − impacto(ida e volta)`.
   * Negativo = o modelo de custo do laboratório é insuficiente, e todo
   * resultado gravado está otimista nessa margem.
   */
  sobraPct: number | null;
  cabe: boolean;
}

/**
 * O veredito por tamanho.
 *
 * ⚠️ A TAXA ENTRA AQUI, e é o que torna o número acionável. Medir impacto
 * sozinho responderia "o livro é fundo?"; o que decide é se impacto + taxa
 * cabem no que a simulação assume. A taxa publicada da Gate.io é passada por
 * quem chama — vem da MESMA consulta que já alimenta o painel de custo, em vez
 * de uma segunda cópia que pode divergir.
 */
export function vereditoPorTamanho(
  impactos: readonly ImpactoNoTamanho[],
  taxaPorPernaPct: number,
  orcamentoPorPernaPct: number = CUSTO_POR_PERNA_PCT,
): VereditoDerrapagem {
  const usd = impactos[0]?.usd ?? 0;
  const idaEVoltaPct = mediana(impactos.map((i) => i.idaEVoltaPct));
  const orcamentoCiclo = orcamentoPorPernaPct * 2;
  const taxaCiclo = taxaPorPernaPct * 2;
  const sobraPct = idaEVoltaPct == null ? null : orcamentoCiclo - taxaCiclo - idaEVoltaPct;

  return {
    usd, idaEVoltaPct,
    paresComLivroCurto: impactos.filter((i) => i.livroAcabou).length,
    pares: impactos.length,
    sobraPct,
    // ⚠️ Sem medição não é "cabe". Ausência nunca vira aprovação.
    cabe: sobraPct != null && sobraPct >= 0,
  };
}

/** A frase para a tela — diz o que o número significa, não só o número. */
export function leituraDaDerrapagem(v: VereditoDerrapagem): string {
  if (v.idaEVoltaPct == null) {
    return "nenhum par respondeu — sem dado, o custo continua sem calibração. "
      + "Isto NÃO é o mesmo que derrapagem zero.";
  }
  const base = `${v.usd < 1000 ? `$${v.usd}` : `$${(v.usd / 1000).toFixed(0)}k`}: `
    + `impacto de ida e volta ${v.idaEVoltaPct.toFixed(3)}%`;

  const curto = v.paresComLivroCurto > 0
    ? ` ⚠️ ${v.paresComLivroCurto} de ${v.pares} pares esgotaram o livro — o impacto real é MAIOR que este.`
    : "";

  if (v.sobraPct == null) return base + curto;
  if (v.sobraPct < 0) {
    return base + `, e faltam ${Math.abs(v.sobraPct).toFixed(3)} ponto para caber no orçamento `
      + "do laboratório depois da taxa. Todo resultado direcional gravado está OTIMISTA nessa margem."
      + curto;
  }
  return base + `, e sobram ${v.sobraPct.toFixed(3)} ponto do orçamento depois da taxa.` + curto;
}

/**
 * Busca o livro de ofertas da Gate.io.
 *
 * ⚠️ FALHA DEVOLVE `null` COM MOTIVO, nunca livro vazio. Livro vazio andaria
 * como "impacto zero" e recalibraria o laboratório para o lado otimista por
 * causa de uma queda de rede — a invariante nº 33 na sua forma mais cara.
 */
export async function fetchLivroGateio(
  simbolo: string, limite = 100,
): Promise<{ livro: LivroDeOfertas | null; falha?: string }> {
  const par = `${simbolo.toUpperCase()}_USDT`;
  try {
    const res = await fetch(
      `${GATEIO_API}/spot/order_book?currency_pair=${par}&limit=${limite}`,
      { cache: "no-store" },
    );
    if (!res.ok) return { livro: null, falha: `${simbolo}:${res.status}` };
    const j = await res.json() as { asks?: [string, string][]; bids?: [string, string][] };
    const conv = (xs?: [string, string][]): Level[] =>
      (xs ?? []).map(([p, q]) => [parseFloat(p), parseFloat(q)] as Level)
        .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0);
    const asks = conv(j.asks), bids = conv(j.bids);
    if (asks.length === 0 || bids.length === 0) return { livro: null, falha: `${simbolo}: livro vazio` };
    return { livro: { simbolo: simbolo.toUpperCase(), asks, bids } };
  } catch (e) {
    return { livro: null, falha: `${simbolo}:${String(e).slice(0, 40)}` };
  }
}
