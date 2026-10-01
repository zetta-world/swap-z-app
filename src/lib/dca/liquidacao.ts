/**
 * A LIQUIDAÇÃO DO CICLO DE DCA A PARTIR DO INTENT — achados A104 e A105.
 *
 * ⚠️⚠️ O QUE ESTE MÓDULO EXISTE PARA CONSERTAR. O cron do DCA fazia:
 *
 *     submit → timeout → status "falhou" → avança o ciclo
 *
 * e a ordem podia ter executado. O próprio código escrevia o dilema:
 *
 *     "Repetir arrisca comprar DUAS vezes; consumir o ciclo e seguir arrisca
 *      comprar uma vez a menos. Só um dos dois devolve dinheiro ao dono."
 *
 * Não havia terceira opção. Agora há: o intent durável fica em UNKNOWN, o ciclo
 * NÃO avança, e a passada seguinte RECONCILIA antes de decidir qualquer coisa.
 *
 * ⚠️ E O CICLO NÃO PODE FICAR RESERVADO PARA SEMPRE (A105). Se a dúvida
 * congelasse o plano, o conserto seria pior que o defeito — o dono veria
 * "1 de 12" parado sem uma linha dizendo por quê, que é exatamente a cicatriz
 * que o cron já carrega escrita. Por isso este módulo fecha o ciclo com a
 * verdade do LIVRO assim que o intent chega a um estado conclusivo.
 *
 * ⚠️ O QUE ENTRA NO CICLO É O QUE O LIVRO TEM, NUNCA O QUE FOI PEDIDO. É o
 * achado A81 no caminho do DCA: `filled` ausente não vira "comprou tudo".
 */

import type { IntentRow } from "@/lib/cex/execucao/intents";
import { ehTerminal, podeLiquidar } from "@/lib/cex/execucao/estados";

/** O que a passada do cron deve fazer com um intent que já existia. */
export type DecisaoDoCiclo =
  /** O intent concluiu. Feche o ciclo com estes números e avance o plano. */
  | { acao: "liquidar"; status: "feito" | "falhou"; motivo: string | null;
      quantidade: number; precoMedio: number | null; custoUsd: number;
      orderId: string | null; contaComoFeito: boolean }
  /**
   * ⚠️ AINDA EM DÚVIDA. O plano NÃO avança e NENHUMA ordem nova é enviada
   * para este ciclo. É a única resposta honesta enquanto a corretora não
   * responder — e é o oposto exato do que o código antigo fazia.
   */
  | { acao: "esperar"; porque: string }
  /** Quarentena: mão humana. Nada automático prossegue neste plano. */
  | { acao: "quarentena"; porque: string };

/**
 * Traduz o estado do intent na decisão do ciclo.
 *
 * ⚠️ FUNÇÃO PURA DE PROPÓSITO. A decisão "avança ou não avança o dinheiro do
 * plano" é a mais cara deste produto; ela precisa ser exercitável sem banco,
 * sem rede e sem corretora.
 */
export function decidirPeloIntent(intent: IntentRow): DecisaoDoCiclo {
  const executado = Number(intent.filled_qty);
  const gasto = Number(intent.filled_quote);

  if (intent.state === "QUARANTINED") {
    return { acao: "quarentena",
      porque: intent.state_reason ?? "intent em quarentena — reconciliacao nao concluiu" };
  }

  if (!ehTerminal(intent.state) && !podeLiquidar(intent.state)) {
    return { acao: "esperar",
      porque: `intent em ${intent.state} — a corretora ainda nao respondeu de forma conclusiva` };
  }

  /**
   * ⚠️ PARCIALMENTE PREENCHIDO AINDA ESTÁ VIVO NA CORRETORA. Fechar o ciclo
   * agora contaria como gasto um dinheiro que ainda pode crescer. Só se
   * liquida o que já não muda mais.
   */
  if (intent.state === "PARTIALLY_FILLED") {
    return { acao: "esperar",
      porque: `preenchimento parcial (${executado}) — a ordem segue viva na corretora` };
  }

  if (executado > 0) {
    const precoMedio = gasto > 0 && executado > 0 ? gasto / executado : null;
    return { acao: "liquidar", status: "feito", motivo: null,
      quantidade: executado, precoMedio, custoUsd: gasto,
      orderId: intent.external_order_id, contaComoFeito: true };
  }

  /**
   * ⚠️ ZERO EXECUTADO COM INTENT TERMINAL: a ordem existiu e não pegou nada,
   * ou nunca chegou a existir. O ciclo conta como CONSUMIDO — senão o plano
   * congela recalculando o mesmo número para sempre, que é a cicatriz de 26/08.
   */
  return { acao: "liquidar", status: "falhou",
    motivo: intent.state_reason?.slice(0, 200) ?? `intent ${intent.state} sem execucao`,
    quantidade: 0, precoMedio: null, custoUsd: 0,
    orderId: intent.external_order_id, contaComoFeito: false };
}
