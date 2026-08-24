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
 * ⚠️⚠️ A MEDIÇÃO DERRUBOU A HIPÓTESE. O PORTÃO ESTÁ DESLIGADO (04/08).
 *
 * Este módulo nasceu de uma comparação ENTRE janelas: a biblioteca rendia
 * −0.132%/trade num mercado neutro e −0.619% num de queda, então "não opere em
 * mar contra" parecia óbvio.
 *
 * O `byWeather` mediu a mesma coisa DENTRO da janela — mesmos símbolos, mesmo
 * período, só o clima variando — e disse o oposto:
 *
 *   playbook                 misto            adverso
 *   pivot_reversion    −0.098% (n=44)   +0.328% (n=43)   ← o maior da amostra
 *   trend_pullback     −1.754% (n=19)   −0.111% (n=26)
 *   capitulation       −2.784%  (n=4)   −1.068%  (n=6)
 *   ...
 *   PONDERADO          −0.764% (183)    −0.351% (164)
 *
 * ADVERSO foi melhor em SETE de nove playbooks, e por margem larga no agregado.
 * O portão bloquearia exatamente a metade que rende mais.
 *
 * POR QUE A PRIMEIRA LEITURA ENGANOU, e a lição vale mais que o resultado:
 *
 * Comparar ENTRE janelas muda tudo de uma vez — outros símbolos se movem, a
 * volatilidade é outra, a dispersão é outra. Atribuí a diferença a UMA variável
 * porque era a que eu estava olhando. A comparação DENTRO da janela isola de
 * verdade, e é a única das duas que responde à pergunta.
 *
 * ⚠️ E O ESTADO QUE O PORTÃO MAIS LIBERARIA NUNCA FOI TESTADO: "favorável"
 * apareceu em TRÊS trades no total. Numa janela que caiu 17.5%, o BTC quase
 * nunca esteve acima de uma média longa em alta. Um portão calibrado num estado
 * sem amostra é chute com aparência de regra.
 *
 * O clima continua sendo MEDIDO e gravado — ele pode significar alguma coisa
 * numa janela de alta, e aí a resposta virá do `byWeather`, não daqui. O que
 * não continua é o portão decidindo com base numa hipótese que a medição negou.
 *
 * Religar exige `WEATHER_GATE=on` E um `byWeather` que sustente.
 */
export const WEATHER_GATE_ON = process.env.WEATHER_GATE === "on";

export function shouldTrade(w: Weather): boolean {
  if (!WEATHER_GATE_ON) return true;
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
