/**
 * O CLIMA DO MERCADO — a variável que faltava, e que os dados apontaram.
 *
 * ⚠️ DE ONDE ISTO VEIO (04/08).
 *
 * A mesma biblioteca, as mesmas travas, medida em três janelas de 174 dias:
 *
 *   janela        mercado    biblioteca    playbooks positivos (n≥30)
 *   hoje          −18.49%    −0.619%       0
 *   180d atrás    −56.50%    −0.505%       1  (support_accumulation +0.05%)
 *   360d atrás     −2.76%    −0.132%       3  (continuação +0.16%, rompimento
 *                                              +0.13%, reversão no canal +0.06%)
 *
 * A janela neutra foi CINCO VEZES melhor que a pior, e é a única onde alguma
 * coisa ficou positiva com amostra. E o detalhe que fecha o argumento:
 * `trend_continuation` foi a PIOR estratégia na janela de hoje (−0.81%) e a
 * MELHOR na de 12 meses (+0.16%, n=103). Continuação de tendência funciona
 * quando existe tendência — não é ruído, é a estratégia fazendo o que o nome
 * dela promete e falhando quando o terreno não é o dela.
 *
 * A biblioteca é long-only. Ela não escolhe o mar em que navega, e até agora
 * nada no sistema OLHAVA o mar antes de decidir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO NÃO AFIRMA, e é importante:
 *
 * Três janelas não são uma calibragem. A relação não é sequer monotônica — o
 * mercado de −56% deu resultado MELHOR que o de −18%. O que os dados sustentam
 * é mais modesto que "pior mercado, pior resultado": é que MERCADO NEUTRO OU
 * DE ALTA é materialmente diferente de mercado em queda, e ninguém estava
 * medindo essa diferença.
 *
 * Por isso os limiares abaixo são PALPITE DECLARADO, como a coluna `priority`
 * era antes de o backtest medi-la. E por isso o clima é gravado em cada
 * sugestão e medido no backtest: para que ele seja substituído por medição em
 * vez de virar mais uma constante que ninguém confere.
 */

import { envNumber } from "@/lib/env-number";
import type { Candle } from "@/lib/api/market-indicators";

/**
 * O clima, em três estados.
 *
 * Três e não dois de propósito: um limiar único força a decidir no meio, e o
 * meio é justamente onde a evidência é fraca. "Misto" é a resposta honesta para
 * o mercado que não está claramente em nenhum dos dois lados.
 */
export type Weather = "favoravel" | "misto" | "adverso";

/**
 * Que fração dos símbolos precisa estar em alta para o mar estar a favor.
 *
 * PALPITE DECLARADO. 0.55 e 0.35 são as fronteiras clássicas de amplitude de
 * mercado (breadth), não medições nossas.
 */
export const BREADTH_GOOD = envNumber(process.env.WEATHER_BREADTH_GOOD, 0.55, { positive: true });
export const BREADTH_BAD = envNumber(process.env.WEATHER_BREADTH_BAD, 0.35, { positive: true });

/**
 * AMPLITUDE: quantos símbolos estão acima da própria média longa.
 *
 * Por que amplitude e não "o BTC subiu": o BTC pode subir sozinho enquanto o
 * resto sangra — foi exatamente o quadro da janela de 12 meses, com ETH +49% e
 * OP −33%. Uma referência única teria chamado aquele mercado de favorável para
 * TODOS os símbolos, quando metade estava caindo.
 *
 * Amplitude responde "o mar está a favor de quem compra?", que é a pergunta de
 * uma mesa long-only.
 */
export function breadth(aboveLongMa: boolean[]): number | null {
  if (aboveLongMa.length === 0) return null;
  return aboveLongMa.filter(Boolean).length / aboveLongMa.length;
}

export function weatherFromBreadth(
  b: number | null, good = BREADTH_GOOD, bad = BREADTH_BAD,
): Weather {
  // Sem leitura, "misto": ausência de dado não pode virar nem permissão nem
  // veto. Chamar de adverso calaria a mesa por falta de medição; chamar de
  // favorável liberaria pelo mesmo motivo.
  if (b == null) return "misto";
  if (b >= good) return "favoravel";
  if (b <= bad) return "adverso";
  return "misto";
}

/**
 * O clima a partir de UMA série de referência — usado no backtest, onde não há
 * amplitude cross-símbolo disponível barata a cada barra.
 *
 * Regra: preço acima da média longa E a média subindo = favorável; abaixo E
 * caindo = adverso; o resto é misto. A inclinação importa tanto quanto o nível
 * — preço acima de uma média que está desabando é topo de queda, não alta.
 *
 * ⚠️ SEM OLHAR O FUTURO: recebe a série JÁ CORTADA no instante da decisão. A
 * responsabilidade do corte é de quem chama, igual ao resto do backtest.
 */
export function weatherFromSeries(closes: number[], period = 50): Weather {
  if (closes.length < period + 10) return "misto";
  const sma = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const agora = sma(closes.slice(-period));
  const antes = sma(closes.slice(-period - 10, -10));
  const preco = closes[closes.length - 1];
  const subindo = agora > antes;
  if (preco > agora && subindo) return "favoravel";
  if (preco < agora && !subindo) return "adverso";
  return "misto";
}

/** Conveniência: o clima a partir de velas. */
export function weatherFromCandles(candles: Candle[], period = 50): Weather {
  return weatherFromSeries(candles.map((c) => c.close), period);
}

/**
 * A MESA DEVE OPERAR NESTE CLIMA?
 *
 * ⚠️ ESTE É O ÚNICO PONTO DO MÓDULO QUE MUDA COMPORTAMENTO, e ele é deliberadamente
 * tímido.
 *
 * Nas duas janelas de queda medidas, NENHUM playbook ficou positivo com amostra
 * nas duas — o único que apareceu (`support_accumulation`, +0.05%) foi positivo
 * numa e negativo na outra. Não há evidência de que alguma estratégia long-only
 * da biblioteca pague em mercado adverso.
 *
 * Então em clima adverso a mesa fica de fora. Não é pessimismo: é a aplicação
 * da mesma regra que já governa a URÐR — não operar o que não tem evidência de
 * pagar.
 *
 * Em clima MISTO ela opera. Foi nele que os três positivos apareceram, e barrar
 * o misto seria calar a mesa quase sempre — cripto raramente tem 55% dos majors
 * em alta ao mesmo tempo.
 */
export function shouldTrade(w: Weather): boolean {
  return w !== "adverso";
}

/** Em uma linha, para o log e para a tela. */
export function weatherNote(w: Weather, b: number | null): string {
  const amp = b == null ? "sem amplitude" : `${Math.round(b * 100)}% dos símbolos em alta`;
  if (w === "adverso") {
    return `mar contra (${amp}) — mesa long-only de fora: nas duas janelas de queda medidas, `
      + "nenhum playbook ficou positivo com amostra";
  }
  if (w === "favoravel") return `mar a favor (${amp})`;
  return `mar misto (${amp}) — opera: foi neste terreno que os positivos apareceram`;
}
