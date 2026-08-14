/**
 * A DECISÃO DE ATUALIZAR — pura, sem React, sem DOM.
 *
 * ⚠️ Mora em arquivo próprio porque o hook que a usa é `"use client"` e importa
 * o provider (JSX). Um teste que importasse o hook arrastaria a árvore inteira
 * de componentes só para afirmar uma comparação de dois números — e aí a parte
 * que decide fica sem teste, que é sempre a que mais precisa.
 */

/**
 * Já passou tempo suficiente desde a última busca?
 *
 * ⚠️ ISTO É UM ESTRANGULADOR DE RAJADA. `recordEvent` emite um ping do tempo
 * real a CADA evento do flywheel, e só o radar bate uma vez por minuto. Um tick
 * que grava seis eventos seguidos dispararia seis buscas no mesmo segundo —
 * seis vezes o custo, para seis vezes a mesma tela.
 *
 * ⚠️ E `forcado` É O CASO DO CELULAR. Quem tira o telefone do bolso quer ver o
 * AGORA, não o de quando guardou. O retorno à aba força, e forçar ignora o
 * estrangulamento de propósito.
 */
export function devoRodar(
  agoraMs: number, ultimoMs: number, minGapMs: number, forcado = false,
): boolean {
  if (forcado) return true;
  if (ultimoMs <= 0) return true;          // nunca rodou
  return agoraMs - ultimoMs >= minGapMs;
}
