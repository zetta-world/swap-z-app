/**
 * A POSIÇÃO DO BOT É O TETO DA VENDA — e o que sobra continua existindo.
 *
 * ⚠️⚠️ DUAS SUPOSIÇÕES, EM DOIS ARQUIVOS, CADA UMA CONTANDO COM A OUTRA.
 * (achados A13/A14 da auditoria externa, 14/09 — confirmados no código)
 *
 * `price-guard.ts` isenta as VENDAS do teto por operação, e escreve o porquê:
 *
 *     "SELLS are only checked against the absolute ceiling — they reduce
 *      exposure and are naturally bounded by the user's holdings."
 *
 * E o ramo de venda do cron escreve a intenção oposta:
 *
 *     "only sell a base the bot actually holds — never dump an unrelated
 *      user holding"
 *
 * Só que ele conferia o SÍMBOLO e nunca o TAMANHO: `placeCexOrder` recebia
 * `intent.amount`, que vem do CARTÃO DO MODELO. A isenção do teto por operação
 * existe porque a posição supostamente limita a venda; a checagem da posição
 * nunca limitou. Entre as duas, o único freio que sobrava era o teto rígido de
 * US$ 100.000 por ordem, a cada 5 minutos.
 *
 * O "bounded by the user's holdings" do price-guard é verdadeiro e é
 * exatamente o problema: as posses do USUÁRIO incluem moedas que o bot nunca
 * comprou. O bound existia para proteger a conta de vender a descoberto — não
 * para proteger o dono de ter a própria bolsa despejada pelo robô dele.
 *
 * ⚠️ E A SAÍDA PARCIAL APAGAVA A LINHA INTEIRA. Depois de qualquer venda com
 * preenchimento > 0, `closeServerPosition` removia a posição toda. Vendeu US$
 * 100 de uma posição de US$ 500 e o bot passava a acreditar que não tem nada:
 * o resto fica órfão na conta do cliente — nunca mais gerido, nunca mais
 * vendido — e o teto de exposição libera os US$ 500 inteiros de volta, então
 * ele ainda compra mais por cima.
 *
 * Este módulo mora fora da rota para ter teste que o EXECUTA.
 */

export type Venda =
  | { ok: true; qtd: number; limitada: boolean; naPosicao: number }
  | { ok: false; porque: string };

/**
 * Quanto o bot pode de fato vender.
 *
 * ⚠️ FALHA FECHADO: posição ausente, zero, negativa ou não finita devolve
 * recusa — nunca "vende o que o modelo pediu". `Number(null) === 0` e passa no
 * `isFinite`, então ausência tem de ser tratada como ausência, não como zero.
 */
export function quantoPodeVender(pedido: unknown, naPosicao: unknown): Venda {
  const querido = Number(pedido);
  const tenho = Number(naPosicao);
  if (naPosicao === null || naPosicao === undefined || !Number.isFinite(tenho) || tenho <= 0) {
    return { ok: false, porque: "posição do bot ausente ou zerada" };
  }
  if (!Number.isFinite(querido) || querido <= 0) {
    return { ok: false, porque: "quantidade pedida inválida" };
  }
  return { ok: true, qtd: Math.min(querido, tenho), limitada: querido > tenho, naPosicao: tenho };
}

/**
 * Ruído de ponto flutuante ao vender "tudo": 0,1 − 0,1 pode deixar 1e-17.
 * É RELATIVO de propósito — não afirma nada sobre mercado, só sobre `double`.
 */
const RUIDO_RELATIVO = 1e-9;

export type Sobra =
  | { fecha: true; custoRemovido: number }
  | { fecha: false; baseRestante: number; custoRestante: number; custoRemovido: number };

/**
 * O que continua na mão depois do preenchimento.
 *
 * O custo sai em proporção — a mesma convenção de custo médio que
 * `realizedFromSell` usa (`costRemoved = avgCost × filledQty`), para que o P&L
 * realizado e o custo que fica não contem a mesma moeda duas vezes.
 *
 * ⚠️ SOBRA NÃO VENDÁVEL CONTINUA SENDO SOBRA. Não há corte em dólares aqui de
 * propósito: se o resto é pequeno demais para a corretora aceitar, a linha
 * ainda é VERDADE — o bot tem aquilo e não consegue vender. Apagá-la seria a
 * mentira, e o teto de exposição passaria a contar errado a favor de comprar
 * mais.
 */
export function oQueSobrou(naPosicao: number, custoUsd: number, preenchido: number): Sobra {
  const tenho = Number(naPosicao);
  const custo = Number.isFinite(Number(custoUsd)) ? Number(custoUsd) : 0;
  const vendido = Number(preenchido);
  if (!Number.isFinite(tenho) || tenho <= 0) return { fecha: true, custoRemovido: custo };
  if (!Number.isFinite(vendido) || vendido <= 0) return { fecha: false, baseRestante: tenho, custoRestante: custo, custoRemovido: 0 };

  const resto = tenho - vendido;
  if (resto <= tenho * RUIDO_RELATIVO) return { fecha: true, custoRemovido: custo };

  const fracaoQueFica = resto / tenho;
  const custoRestante = custo * fracaoQueFica;
  return { fecha: false, baseRestante: resto, custoRestante, custoRemovido: custo - custoRestante };
}
