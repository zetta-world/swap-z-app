/**
 * ARBITER F2 — orderbook realism (docs/PLANO-ARBITER-REAL.md).
 *
 * The paper arbiter assumes BOTH legs fill at the observed TOP price. Reality:
 * you walk the book, and depth eats the spread. This module computes the
 * REALISTIC round-trip against real bid/ask depth, so we learn how much of the
 * paper 0.30% survives before risking a cent. Pure math here (unit-tested);
 * the live orderbook fetch lives in cex-orderbook.ts and runs in prod.
 *
 * Model: buy `sizeUsd` of base on the cheap venue by walking its ASKS (paying
 * up the book) and sell the SAME quantity on the rich venue by walking its BIDS
 * (down the book), both legs at the same instant.
 * realisticSpread = (sellVWAP − buyVWAP)/buyVWAP.
 *
 * ⚠️ É O MODELO DOS "DOIS BOLSOS", NÃO UMA SEQUÊNCIA (corrigido em 04/08).
 *
 * A redação anterior dizia "then sell the base you got" — matemática certa,
 * linguagem errada. "Then" e "the base you got" descrevem comprar numa venue e
 * DEPOIS revender o que chegou, que é o desenho que o CEO descartou em 21/07 e
 * que este projeto nunca simulou.
 *
 * O desenho decidido (`docs/PLANO-ARBITER-REAL.md`, "aula dos dois bolsos") é:
 * saldo dos DOIS lados, as duas pernas disparadas no mesmo instante, nada
 * transferido entre corretoras, estoque rebalanceando pelas rotas contrárias.
 *
 * Custou caro: eu li este cabeçalho e afirmei ao dono que a nossa simulação
 * tinha risco de perna e que faltava inventário pré-posicionado. As duas coisas
 * falsas, e a decisão tinha semanas. Comentário que descreve certo em palavras
 * erradas é pior que comentário ausente — o ausente faz alguém ir ler o código.
 *
 * ⚠️ E O QUE ISSO NÃO MUDA, que é o mais importante:
 *
 * A ARITMÉTICA DOS DOIS DESENHOS É IDÊNTICA. Nos dois casos anda-se o ASK da
 * barata e o BID da cara, pela MESMA quantidade — `vwapSell` recebe exatamente
 * `buy.baseFilled`. O que os dois bolsos eliminam é risco de PREÇO entre as
 * pernas e a transferência; nenhum dos dois entra nesta conta.
 *
 * Logo os −0.629% realistas contra +0.451% teóricos NÃO são artefato de um
 * modelo sequencial. Andar os dois livros é o que qualquer execução faz, com
 * bolso ou sem. A profundidade come o spread nos dois desenhos igual.
 */

/** [price, size] level. Asks sorted ascending, bids descending. */
export type Level = [number, number];

export interface FillBuy { avgPrice: number; baseFilled: number; fullyFilled: boolean }
export interface FillSell { avgPrice: number; usdFilled: number; fullyFilled: boolean }

/** Spend `sizeUsd` walking asks; returns the volume-weighted fill price and how
 *  much base that bought. fullyFilled=false when the book is too thin. */
export function vwapBuy(asks: Level[], sizeUsd: number): FillBuy {
  let spent = 0, base = 0;
  for (const [price, size] of asks) {
    if (!(price > 0) || !(size > 0)) continue;
    const levelUsd = price * size;
    const take = Math.min(levelUsd, sizeUsd - spent);
    spent += take; base += take / price;
    if (spent >= sizeUsd - 1e-9) break;
  }
  return { avgPrice: base > 0 ? spent / base : 0, baseFilled: base, fullyFilled: spent >= sizeUsd - 1e-9 };
}

/** Sell `baseAmt` walking bids; returns the VWAP sell price and USD received. */
export function vwapSell(bids: Level[], baseAmt: number): FillSell {
  let sold = 0, usd = 0;
  for (const [price, size] of bids) {
    if (!(price > 0) || !(size > 0)) continue;
    const take = Math.min(size, baseAmt - sold);
    sold += take; usd += take * price;
    if (sold >= baseAmt - 1e-12) break;
  }
  return { avgPrice: sold > 0 ? usd / sold : 0, usdFilled: usd, fullyFilled: sold >= baseAmt - 1e-12 };
}

export interface Realism {
  theoreticalNetPct: number;   // top-of-book spread − cost (what paper booked)
  realisticNetPct:   number;   // depth-walked spread − cost
  slippagePct:       number;   // theoretical − realistic (how much depth ate)
  fullyFilled:       boolean;  // both legs had enough depth for sizeUsd
}

/**
 * O PORTÃO — o que faltava para a sonda valer alguma coisa.
 *
 * ⚠️ 03/08: ESTE MÓDULO ESTAVA CERTO E LIGADO A NADA.
 *
 * `assessRealism` rodou 4.085 vezes desde 28/07, sempre com profundidade
 * suficiente para os $50, e o que ele mediu foi:
 *
 *   teórico médio (o que o paper contabilizava)  +0.451%
 *   realista médio (andando o livro)             −0.629%
 *   slippage médio                                1.081%
 *   ainda positivos depois da profundidade       17 de 4.085  (0.4%)
 *
 * Ou seja: a validação de orderbook já provava, havia SEIS DIAS, que cada
 * ciclo perdia 0.63% na vida real enquanto o ledger anotava +0.45%. A
 * diferença era a profundidade comendo o spread inteiro e mais um pouco.
 *
 * E a mesa abria assim mesmo. O comentário da chamada dizia, textualmente,
 * "never blocks booking" — a sonda foi construída como observação, a ponte
 * para o dinheiro real, e a ponte nunca foi atravessada. Quatro mil medições
 * corretas foram para um feed de eventos que ninguém agrega.
 *
 * Uma medição que não muda decisão nenhuma não é medição, é decoração. Este
 * portão é o que transforma uma na outra.
 *
 * A regra do "não medido": livro que não pôde ser lido REPROVA. É a aplicação
 * direta de `inconclusivo ≠ aprovado` — a alternativa seria abrir posição na
 * ausência de evidência, que é exatamente o hábito que produziu os $304.
 */
export interface RealismGate { book: boolean; reason: string }

export function realismGate(r: Realism | null, minNetPct: number): RealismGate {
  if (!r) return { book: false, reason: "profundidade não lida — não medido não é aprovado" };
  // Livro fino é uma resposta, não uma falha: significa que o preço de topo não
  // existe no tamanho que a mesa quer operar. Abrir aqui seria comprar a cotação
  // e não a liquidez.
  if (!r.fullyFilled) return { book: false, reason: "livro sem profundidade para o tamanho" };
  if (r.realisticNetPct < minNetPct) {
    return {
      book: false,
      reason: `líquido real ${r.realisticNetPct.toFixed(3)}% abaixo do mínimo ${minNetPct.toFixed(2)}% `
        + `(topo prometia ${r.theoreticalNetPct.toFixed(3)}%, profundidade comeu ${r.slippagePct.toFixed(3)}%)`,
    };
  }
  return { book: true, reason: `líquido real ${r.realisticNetPct.toFixed(3)}% sobrevive à profundidade` };
}

/** Compare the paper (top-of-book) net against the depth-walked net. */
export function assessRealism(
  buyAsks: Level[], sellBids: Level[], sizeUsd: number,
  theoreticalSpreadPct: number, costPct: number,
): Realism {
  const buy  = vwapBuy(buyAsks, sizeUsd);
  const sell = vwapSell(sellBids, buy.baseFilled);
  const realisticSpreadPct = buy.avgPrice > 0 ? ((sell.avgPrice - buy.avgPrice) / buy.avgPrice) * 100 : 0;
  const theoreticalNetPct = theoreticalSpreadPct - costPct;
  const realisticNetPct   = realisticSpreadPct - costPct;
  return {
    theoreticalNetPct: Math.round(theoreticalNetPct * 1000) / 1000,
    realisticNetPct:   Math.round(realisticNetPct   * 1000) / 1000,
    slippagePct:       Math.round((theoreticalNetPct - realisticNetPct) * 1000) / 1000,
    fullyFilled:       buy.fullyFilled && sell.fullyFilled,
  };
}
