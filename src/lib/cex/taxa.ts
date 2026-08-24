/**
 * O QUE A ORDEM CUSTOU, EM DÓLARES — item A5 da auditoria do autopilot.
 *
 * ⚠️ Mora aqui, e não dentro da rota, por dois motivos. O primeiro é o
 * Next.js: arquivo de rota não pode exportar função qualquer, e sem exportar
 * não há como testar. O segundo é o que importa — esta é uma conta de DINHEIRO,
 * e conta de dinheiro que só existe dentro de um handler não é testável nem
 * reutilizável, então acaba copiada.
 */

import type { CexOrder } from "@/lib/cex/types";

/** Moedas cujo valor já É o dólar, dentro da tolerância desta conta. */
const STABLE_FEE = new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDP", "USD"]);

/**
 * A taxa da ordem, em dólares.
 *
 * ⚠️ POR QUE ISTO SAIU DE UMA LINHA (item A5 da auditoria, corrigido 14/08).
 *
 * A versão anterior era:
 *
 *     const fee = feeCost > 0 && STABLE_FEE.has(feeCur) ? feeCost : 0;
 *
 * Taxa cobrada em BNB, ou na própria moeda vendida, virava **zero**. E o
 * desdobramento não é cosmético: taxa ignorada faz o P&L realizado sair MAIOR
 * do que foi, o stop de perda conta as perdas a MENOS, e ele dispara mais
 * tarde do que deveria. Um erro que afrouxa o freio.
 *
 * ⚠️ O CASO DA MOEDA BASE DÁ PARA RESOLVER EXATO, sem consultar preço nenhum:
 * a venda que acabou de acontecer JÁ é a cotação. `proceeds / filledQty` é o
 * preço realizado, e a taxa em unidades da base vale isso vezes a quantidade.
 * Uma consulta a menos é uma fonte de erro a menos — a mesma razão pela qual o
 * custo de ida e volta do laboratório deixou de depender de dois preços.
 *
 * ⚠️ E O QUE NÃO DÁ PARA PRECIFICAR NÃO VIRA ZERO CALADO. Sem preço para a
 * moeda da taxa (BNB num par que não é BNB, por exemplo), devolvemos `null` no
 * campo e quem chama GRAVA o evento. Continuar subtraindo zero é a única saída
 * possível — inventar preço seria pior — mas ela para de ser invisível.
 */
export function taxaEmUsd(
  order: CexOrder, proceeds: number, filledQty: number, pair: string,
): { usd: number; naoPrecificada: { moeda: string; valor: number } | null } {
  const feeCost = Number(order.fee?.cost ?? 0);
  const feeCur  = (order.fee?.currency ?? "").toUpperCase();
  if (!(feeCost > 0) || !feeCur) return { usd: 0, naoPrecificada: null };
  if (STABLE_FEE.has(feeCur)) return { usd: feeCost, naoPrecificada: null };

  const base = (pair.split("/")[0] ?? "").toUpperCase();
  if (base && feeCur === base && filledQty > 0 && proceeds > 0) {
    return { usd: feeCost * (proceeds / filledQty), naoPrecificada: null };
  }
  return { usd: 0, naoPrecificada: { moeda: feeCur, valor: feeCost } };
}
