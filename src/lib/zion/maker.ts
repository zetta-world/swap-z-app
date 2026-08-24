/**
 * MESA MAKER — postar o spread em vez de atravessá-lo.
 *
 * ⚠️ POR QUE ESTA MESA EXISTE, e é a conclusão da semana inteira (04/08).
 *
 * A curva de equilíbrio sobre 4.085 medições reais de livro respondeu a
 * pergunta "como competir com quem lucra de verdade":
 *
 *   custo de ida e volta   quantas pagariam
 *   0.40% (o nosso)        17 de 4.085
 *   0.10%                  137
 *   0.05%                  165
 *   0.00%  — de graça      209   (5.1%)
 *
 * Com taxa ZERO, 95% continuam perdendo. Logo a barreira nunca foi taxa nem
 * velocidade: é que a mesa ATRAVESSA dois bid-ask (1.1% médio medido) para
 * capturar uma discordância entre venues de 0.05%.
 *
 * As mesas grandes não atravessam o spread — elas POSTAM o spread. O 1.1% que
 * nós pagaríamos é exatamente o que elas ganham. Isso não é arbitragem mais
 * rápida: é outro negócio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ O PERIGO DESTE MÓDULO, DITO ANTES DE QUALQUER NÚMERO:
 *
 * Simular ordem limitada é o jeito mais fácil que existe de fabricar lucro.
 * Basta assumir "minha ordem foi preenchida no meu preço" e a mesa vira uma
 * máquina de dinheiro no papel. Foi assim que os +34% do arbiter nasceram —
 * assumindo preenchimento no topo do livro — e o ledger levou três semanas
 * anotando lucro que não existia.
 *
 * As três regras que governam este módulo existem contra isso:
 *
 *  1. ORDEM SÓ ENCHE SE O PREÇO PASSOU POR ELA. Compra a P enche apenas se a
 *     MÍNIMA da barra ≤ P. Venda a Q apenas se a MÁXIMA ≥ Q. Nada de "o preço
 *     chegou perto".
 *
 *  2. SELEÇÃO ADVERSA É CONTABILIZADA, NÃO IGNORADA. Se a compra encheu, o
 *     preço ESTAVA CAINDO — ele veio até nós. Ser preenchido é informação ruim,
 *     não boa. O módulo mede quanto o preço andou contra DEPOIS do fill.
 *
 *  3. PERNA SOLTA É POSIÇÃO DIRECIONAL, E LEVA STOP. Encher só um lado
 *     transforma uma posição neutra em aposta. É o risco que a versão taker
 *     não tinha, e o motivo de o dono ter pedido "stop com ordem limitada".
 *
 * E uma quarta, que é a mais fácil de esquecer: preenchimento parcial. A
 * mínima tocar o preço não garante que TODO o tamanho encheu — só que alguém
 * negociou ali. Este módulo assume tudo-ou-nada e DECLARA isso como otimismo
 * residual, em vez de esconder.
 */

import type { Candle } from "@/lib/api/market-indicators";

/** Taxa de MAKER por perna, em %. Positiva = paga; negativa = rebate. */
export const MAKER_FEE_PCT = Number(process.env.MAKER_FEE_PCT ?? 0.02);
/** Quantas barras a ordem fica na fila antes de ser cancelada. */
export const MAKER_TTL_BARS = Number(process.env.MAKER_TTL_BARS ?? 5);
/** Stop da perna solta, em % contra a entrada. */
export const MAKER_STOP_PCT = Number(process.env.MAKER_STOP_PCT ?? 0.5);

export type CycleOutcome =
  /** As duas pernas encheram: capturou o spread. */
  | "hedged"
  /** Só uma encheu e o stop foi tocado: perda direcional. */
  | "stopped"
  /** Só uma encheu e o TTL acabou: fecha a mercado, atravessando o spread. */
  | "unwound"
  /** Nenhuma encheu: cancelou sem custo. O caso MAIS COMUM, e não é falha. */
  | "unfilled";

export interface MakerCycle {
  outcome: CycleOutcome;
  /** Resultado líquido em %, já com as taxas das pernas que existiram. */
  netPct: number;
  /** Barras até resolver. */
  bars: number;
  /** Encheu a compra? E a venda? */
  filledBuy: boolean;
  filledSell: boolean;
  /**
   * SELEÇÃO ADVERSA: quanto o preço andou CONTRA a perna cheia, em %, entre o
   * fill e o desfecho. Positivo = andou contra. É o custo invisível de ser
   * preenchido, e a razão de market making não ser dinheiro de graça.
   */
  adversePct: number;
}

/** Compra limitada a `limit` enche se a MÍNIMA da barra passou por ela. */
export function fillsBuy(limit: number, bar: Candle): boolean {
  return bar.low <= limit;
}

/** Venda limitada a `limit` enche se a MÁXIMA da barra passou por ela. */
export function fillsSell(limit: number, bar: Candle): boolean {
  return bar.high >= limit;
}

export interface MakerParams {
  /** Preço da compra limitada (na venue barata, ou no bid da própria). */
  buyLimit: number;
  /** Preço da venda limitada. */
  sellLimit: number;
  feePct?: number;
  ttlBars?: number;
  stopPct?: number;
}

/**
 * Um ciclo maker sobre as barras FUTURAS — sem olhar adiante por construção:
 * cada barra é avaliada em ordem, e a decisão de uma barra nunca usa a
 * seguinte.
 *
 * `buyBars` e `sellBars` são as séries das duas pontas. Quando a mesa opera nas
 * duas venues são séries diferentes; quando é market making numa venue só, é a
 * mesma série nos dois argumentos.
 *
 * ⚠️ ORDEM DENTRO DA BARRA É DESCONHECIDA. Se a mínima E a máxima passaram
 * pelos dois limites na MESMA barra, não dá para saber qual encheu primeiro.
 * Este módulo assume o caso BOM (as duas encheram, posição neutra) porque a
 * alternativa — assumir que uma encheu e a outra não — inventaria uma perna
 * solta que pode não ter existido. É otimismo, está declarado, e é o único
 * ponto onde o módulo escolhe o lado favorável.
 */
export function simulateMakerCycle(
  buyBars: Candle[], sellBars: Candle[], p: MakerParams,
): MakerCycle {
  const fee = p.feePct ?? MAKER_FEE_PCT;
  const ttl = p.ttlBars ?? MAKER_TTL_BARS;
  const stop = p.stopPct ?? MAKER_STOP_PCT;
  const n = Math.min(buyBars.length, sellBars.length, ttl);

  let filledBuy = false, filledSell = false;
  let barraCompra = -1, barraVenda = -1;

  for (let i = 0; i < n; i++) {
    if (!filledBuy && fillsBuy(p.buyLimit, buyBars[i])) { filledBuy = true; barraCompra = i; }
    if (!filledSell && fillsSell(p.sellLimit, sellBars[i])) { filledSell = true; barraVenda = i; }

    if (filledBuy && filledSell) {
      // As duas pernas: o spread postado foi capturado, menos duas taxas maker.
      const bruto = ((p.sellLimit - p.buyLimit) / p.buyLimit) * 100;
      return {
        outcome: "hedged", netPct: bruto - fee * 2, bars: i + 1,
        filledBuy: true, filledSell: true,
        // Neutro: o preço andar depois não muda mais o resultado.
        adversePct: 0,
      };
    }

    // ── Perna solta. A partir daqui é posição direcional, e o stop manda.
    if (filledBuy !== filledSell) {
      const compradoSolto = filledBuy;
      const entrada = compradoSolto ? p.buyLimit : p.sellLimit;
      const desdeFill = compradoSolto ? barraCompra : barraVenda;
      // Só as barras a partir do fill contam para o stop — antes dele não
      // havia posição.
      if (i >= desdeFill) {
        const bar = compradoSolto ? buyBars[i] : sellBars[i];
        // Comprado sozinho morre na queda; vendido sozinho morre na alta.
        const gatilho = compradoSolto ? entrada * (1 - stop / 100) : entrada * (1 + stop / 100);
        const bateu = compradoSolto ? bar.low <= gatilho : bar.high >= gatilho;
        if (bateu) {
          return {
            outcome: "stopped",
            // Stop é saída a MERCADO: paga taxa maker na entrada e atravessa o
            // spread na saída. Contabilizar a saída como maker seria fingir que
            // um stop é passivo, e stop nunca é passivo.
            netPct: -stop - fee,
            bars: i + 1, filledBuy, filledSell, adversePct: stop,
          };
        }
      }
    }
  }

  if (!filledBuy && !filledSell) {
    // Nada encheu: nenhuma taxa, nenhum risco. É o desfecho MAIS FREQUENTE de
    // uma mesa maker, e contá-lo como fracasso distorceria a leitura — a mesa
    // passa a maior parte do tempo na fila, não em posição.
    return { outcome: "unfilled", netPct: 0, bars: n, filledBuy, filledSell, adversePct: 0 };
  }

  // TTL acabou com uma perna solta: desmonta a mercado, atravessando o spread.
  const compradoSolto = filledBuy;
  const entrada = compradoSolto ? p.buyLimit : p.sellLimit;
  const ultima = (compradoSolto ? buyBars : sellBars)[n - 1];
  const saida = ultima.close;
  const bruto = compradoSolto
    ? ((saida - entrada) / entrada) * 100
    : ((entrada - saida) / entrada) * 100;
  return {
    outcome: "unwound",
    netPct: bruto - fee,   // maker na entrada, taker no desmonte
    bars: n, filledBuy, filledSell,
    adversePct: -bruto,     // positivo quando o preço andou contra
  };
}

export interface MakerSummary {
  cycles: number;
  hedged: number;
  stopped: number;
  unwound: number;
  unfilled: number;
  /** Fração dos ciclos em que ALGUMA perna encheu. */
  fillRate: number;
  /** Fração dos ciclos com as DUAS pernas — os únicos que capturam o spread. */
  hedgeRate: number;
  /** Líquido médio POR CICLO, contando os que não encheram. */
  netPerCyclePct: number;
  /** Líquido médio só dos ciclos que encheram alguma coisa. */
  netPerFilledPct: number;
  /** Seleção adversa média nos ciclos de perna solta. */
  avgAdversePct: number;
}

/**
 * O resumo de uma série de ciclos.
 *
 * ⚠️ `netPerCyclePct` inclui os `unfilled`, e é ele que descreve a mesa. Olhar
 * só os ciclos preenchidos responde "quanto rende quando dá certo", que é a
 * pergunta que sempre parece boa. A mesa vive dos dois.
 */
export function summarizeMaker(cycles: MakerCycle[]): MakerSummary {
  const n = cycles.length;
  if (n === 0) {
    return {
      cycles: 0, hedged: 0, stopped: 0, unwound: 0, unfilled: 0,
      fillRate: 0, hedgeRate: 0, netPerCyclePct: 0, netPerFilledPct: 0, avgAdversePct: 0,
    };
  }
  const conta = (o: CycleOutcome) => cycles.filter((c) => c.outcome === o).length;
  const cheios = cycles.filter((c) => c.outcome !== "unfilled");
  const soltas = cycles.filter((c) => c.outcome === "stopped" || c.outcome === "unwound");
  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return {
    cycles: n,
    hedged: conta("hedged"), stopped: conta("stopped"),
    unwound: conta("unwound"), unfilled: conta("unfilled"),
    fillRate: cheios.length / n,
    hedgeRate: conta("hedged") / n,
    netPerCyclePct: soma(cycles.map((c) => c.netPct)) / n,
    netPerFilledPct: cheios.length ? soma(cheios.map((c) => c.netPct)) / cheios.length : 0,
    avgAdversePct: soltas.length ? soma(soltas.map((c) => c.adversePct)) / soltas.length : 0,
  };
}
