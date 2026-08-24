/**
 * A TAXA DE CORRETAGEM — por PRAÇA e por PAPEL.
 *
 * ⚠️⚠️ POR QUE ESTE MÓDULO PRECISOU EXISTIR (23/08).
 *
 * O Celeiro tinha UMA constante de taxa (`0,1125%/perna`) aplicada a todo mundo
 * — e a `modalidade` do agente, declarada desde sempre, não entrava na conta.
 * Os quatro agentes declarados `futuros_gate` pagavam taxa de spot.
 *
 * Isso não é detalhe de arredondamento. O `maker_de_faixa` foi APOSENTADO por
 * ser negativo no líquido, e a autópsia dele fecha assim:
 *
 *     preço  +$3,1557   taxa  −$3,3750   líquido  −$0,2193
 *
 * Ele acertava o preço — 19 alvos contra 8 stops num bracket SIMÉTRICO, onde o
 * acaso dá 50% — e entregava tudo no pedágio. Com a taxa da praça e do papel
 * que o nome dele anuncia (um MAKER, postando ordem limitada, em FUTUROS), a
 * mesma sequência de operações vira positiva. Ele foi morto por um número que
 * o modelo inventou, não por um que ele produziu.
 *
 * ⚠️ ALAVANCA NÃO CONSERTA ISSO. A taxa é cobrada sobre o NOCIONAL, o lucro
 * também: alavancar multiplica os dois pelo mesmo fator e a fração taxa/bruto
 * fica exatamente onde estava. Quem move essa fração é a TABELA — e é por isso
 * que este módulo existe, e não um multiplicador maior.
 */

import type { Modalidade, Execucao } from "@/lib/celeiro/agentes";

/**
 * ⚠️ `maker` POSTA e espera; `taker` cruza o livro e paga mais. A diferença é
 * pequena no spot e ENORME nos futuros — e é a que decide se uma estratégia de
 * faixa fecha no azul. O tipo mora em `agentes.ts` para não fechar ciclo.
 */
export type { Execucao };

/**
 * A tabela publicada da Gate.io para conta sem desconto (VIP 0, sem GT), em %
 * por perna.
 *
 * ⚠️⚠️ ESTES NÚMEROS SÃO DECLARADOS, NÃO MEDIDOS. São a tabela pública do nível
 * mais caro — a conta real pode pagar menos (desconto de GT, nível VIP). Errar
 * para o CARO é a direção segura: uma estratégia que fecha no azul aqui fecha
 * no azul de verdade, enquanto o contrário aprovaria o que não paga a conta.
 *
 * ⚠️ `dex` não é corretagem, é a taxa do POOL — e ela não paga o gás, que anda
 * em linha própria. Manter os dois juntos esconderia qual dos dois matou a
 * operação, que é o erro que a arena antiga cometeu por meses.
 */
export const TAXA_POR_PERNA: Record<Modalidade, Record<Execucao, number>> = {
  spot_gate:    { maker: 0.20,  taker: 0.20  },
  margem_gate:  { maker: 0.20,  taker: 0.20  },
  futuros_gate: { maker: 0.015, taker: 0.05  },
  dex:          { maker: 0.30,  taker: 0.30  },
};

/**
 * A taxa antiga, aplicada a TODOS até 23/08.
 *
 * ⚠️ Não é a taxa de lugar nenhum — é uma mistura que ninguém documentou. Ela
 * fica aqui porque as posições abertas antes da fronteira precisam fechar com
 * a taxa com que foram abertas: mudar a régua no meio da posição faria o
 * extrato dela não bater com o dinheiro que ela moveu.
 */
export const TAXA_LEGADA_PCT = Number(process.env.CELEIRO_TAXA_PERNA_PCT ?? 0.1125);

/**
 * ⚠️⚠️ A FRONTEIRA. Antes disto, todo agente pagava `TAXA_LEGADA_PCT`.
 *
 * Comparar um agente que operou antes com um que operou depois é comparar
 * réguas diferentes — e a diferença é grande o bastante para inverter sinal.
 * Quem apresentar ranking cruzando esta data e não disser isso está mentindo
 * por omissão.
 */
export const FRONTEIRA_TAXA_ISO = "2026-08-23T00:00:00.000Z";

/**
 * A taxa por perna de um agente, em %.
 *
 * ⚠️ NA DÚVIDA, A MAIS CARA. Modalidade desconhecida cai no spot, que é o
 * dobro do pior futuro. Um default barato aprovaria estratégia que não paga a
 * conta — e o erro só apareceria com dinheiro de verdade.
 */
export function taxaPorPerna(modalidade: Modalidade, execucao: Execucao): number {
  const daPraca = TAXA_POR_PERNA[modalidade] ?? TAXA_POR_PERNA.spot_gate;
  const t = daPraca[execucao];
  return Number.isFinite(t) && t >= 0 ? t : TAXA_POR_PERNA.spot_gate.taker;
}

/**
 * O pedágio de ida-e-volta como FRAÇÃO do movimento bruto que a estratégia
 * persegue — o número que decide se ela sobrevive.
 *
 * ⚠️ É ESTA CONTA QUE MATOU O MAKER, e ela não depende de alavanca nenhuma.
 * Com bracket de ±0,6%:
 *
 *     spot taker    0,20%/perna  →  67% do bruto vai em taxa
 *     futuros taker 0,05%/perna  →  17%
 *     futuros maker 0,015%/perna →   5%
 *
 * Devolve `null` quando o alvo não é positivo: dividir por zero produziria
 * Infinity, e Infinity numa tela parece um número.
 */
export function fracaoDoPedagio(taxaPernaPct: number, alvoPct: number): number | null {
  if (!(alvoPct > 0)) return null;
  return (taxaPernaPct * 2) / alvoPct;
}

/**
 * O custo das QUATRO pernas de um carry (base spot-perpétuo).
 *
 * ⚠️⚠️ AS PERNAS NÃO SÃO TODAS DA MESMA PRAÇA. Um carry é spot comprado contra
 * perpétuo vendido: duas pernas no spot e duas no futuro, com tabelas que
 * diferem em mais de dez vezes. Cobrar as quatro pela mesma taxa — que é o que
 * o Celeiro fazia — erra a conta que decide se o carry paga.
 *
 * Aqui o erro era PEQUENO por sorte: 0,45% cobrado contra 0,43% real de maker.
 * A Colheita e a Convergência seguram posição por dias e postam limitada, então
 * `maker` é o papel delas.
 */
export function custoDoCarryPct(execucao: Execucao): number {
  return 2 * taxaPorPerna("spot_gate", execucao) + 2 * taxaPorPerna("futuros_gate", execucao);
}
