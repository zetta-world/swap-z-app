/**
 * A COORTE DO ARBITER — os três gêmeos medidos como experimento, não como placar.
 *
 * A pergunta que gerou este módulo foi: "o arbiter com multiplicador está indo
 * bem mesmo ou é só ilusão?". Ela merece resposta medida, e a medição de 03/08
 * respondeu com uma clareza desconfortável.
 *
 * O QUE O LEDGER DIZIA:
 *
 *   JÖRMUNGANDR 1×  613 ciclos, +$102.89 sobre $300 em 13 dias  (+34%)
 *   NÍÐHÖGGR    3×   31 ciclos,   +$6.25 em 7,5 horas
 *   FÁFNIR      5×   15 ciclos,   +$3.04 em 7,5 horas
 *
 * E, nos três: ZERO ciclos perdedores. 661 de 661 fecharam no lucro.
 *
 * Um resultado assim não se comemora, se investiga — porque nenhuma estratégia
 * real ganha sempre. O que ganha sempre é um MODELO que não consegue perder, e
 * a diferença entre as duas coisas é a diferença entre um produto e um
 * prejuízo com gráfico bonito.
 *
 * O QUE A INVESTIGAÇÃO ACHOU (as três marcas ficaram como verificação abaixo):
 *
 *  1. O spread de entrada NUNCA fica abaixo de 0.60%, e 0.60% é exatamente o
 *     portão de entrada (custo 0.45 + líquido mínimo 0.15). A distribuição está
 *     CORTADA no portão: a mesa só vê a cauda de uma distribuição de ruído que
 *     ultrapassou o gatilho, e chama a volta dela de "convergência".
 *  2. Uma única venue aparece em ~90% das pernas — e nos DOIS sentidos
 *     (comprando dela e vendendo para ela em proporções parecidas). Venue
 *     genuinamente barata apareceria de UM lado. Nos dois lados é preço
 *     oscilando em volta dos outros: ruído de feed, não estrutura de mercado.
 *  3. 100% dos ciclos "convergiram" em ~18 minutos. Ruído volta a zero por
 *     definição — é isso que faz dele ruído. A mesa está colhendo a variância
 *     do feed de uma corretora e contabilizando como spread capturado.
 *
 * Isto já tinha acontecido, em escala maior: MATIC a +353% e RNDR a +375% eram
 * cadáveres de migração de ticker, e o teto de 3% foi posto para matá-los. O
 * teto não pega 0.7% — e 0.7% entre duas CEXes grandes num ativo líquido é
 * igualmente impossível de ser real, só que discreto o bastante para passar.
 *
 * SOBRE A ALAVANCAGEM, especificamente: o lucro POR CICLO em dólar é
 * praticamente idêntico nos três (~$0.17–$0.20), como a teoria manda — a perna
 * é de $50 nos três. A alavanca não cria lucro, ela ENCOLHE O DENOMINADOR. O
 * "3× rende mais em %" é aritmética de divisão, não desempenho. E a única coisa
 * que a alavanca REALMENTE adiciona — liquidação — não foi amostrada nem uma
 * vez, porque exige um movimento adverso de 20% (5×) e a coorte tem horas de
 * vida.
 */

/** Uma mesa da coorte, do jeito que o ledger a descreve. */
export interface CohortDesk {
  source: string;
  label: string;
  leverage: number;
  startingUsd: number;
  cycles: number;
  losses: number;
  realizedUsd: number;
  /** Lucro médio POR CICLO, em dólar. É aqui que a alavanca não aparece. */
  avgPnlUsd: number;
  /** Margem imobilizada por ciclo. É aqui que ela aparece. */
  marginPerCycleUsd: number;
  /** Horas entre o primeiro e o último ciclo. */
  hoursLive: number;
}

/** Uma perna observada: de qual venue comprou, para qual vendeu. */
export interface Leg { buyVenue: string; sellVenue: string }

export type FlagLevel = "fatal" | "aviso" | "ok";

export interface CohortFlag {
  id: string;
  level: FlagLevel;
  title: string;
  /** O que foi medido, em uma linha. */
  finding: string;
  /** Por que isso importa — o que muda na decisão. */
  meaning: string;
}

/**
 * NUNCA PERDER É O SINAL MAIS FORTE DE QUE O MODELO NÃO PODE PERDER.
 *
 * Não é uma heurística frouxa: com uma taxa de acerto verdadeira de até 95%, a
 * chance de 200 ciclos seguidos sem UMA perda é de 0.95^200 ≈ 0.003%. Ver isso
 * significa quase certamente que o caminho da perda não existe no código, e não
 * que ele existe e não foi sorteado.
 *
 * Abaixo de `minSample` a mesma observação não significa nada — 10 vitórias
 * seguidas acontecem por acaso o tempo todo, e acusar aí seria alarme falso.
 */
export function flagNeverLoses(cycles: number, losses: number, minSample = 30): CohortFlag | null {
  if (cycles < minSample || losses > 0) return null;
  return {
    id: "never_loses", level: "fatal",
    title: "nenhum ciclo perdedor em toda a amostra",
    finding: `${cycles} ciclos, ${losses} perdas`,
    meaning: "estratégia real perde às vezes; o que ganha sempre é um modelo sem caminho de perda. "
      + "Trate o lucro como não medido até um ciclo perdedor aparecer.",
  };
}

/**
 * O PORTÃO CORTANDO A DISTRIBUIÇÃO.
 *
 * Se o menor spread observado encosta no gatilho de entrada, a mesa não está
 * escolhendo boas oportunidades entre muitas: ela está vendo só o pedaço de uma
 * distribuição que passou do gatilho. Quando esse pedaço é a cauda de um ruído,
 * a "convergência" seguinte é o retorno à média — garantida, e sem valor.
 *
 * O sinal de que é ruído e não oportunidade: o mínimo COLADO no portão. Uma
 * oportunidade real teria mínimo bem acima dele às vezes, e a mesa passaria
 * períodos inteiros sem achar nada.
 */
export function flagGateTruncated(
  minSpreadPct: number, gatePct: number, cycles: number, tolerance = 0.02,
): CohortFlag | null {
  if (cycles < 20) return null;
  const folga = minSpreadPct - gatePct;
  if (folga > tolerance) return null;
  return {
    id: "gate_truncated", level: "fatal",
    title: "a distribuição do spread está cortada no próprio gatilho",
    finding: `menor spread ${minSpreadPct.toFixed(4)}% contra portão de ${gatePct.toFixed(2)}% — folga de ${folga.toFixed(4)} ponto`,
    meaning: "a mesa não seleciona entre oportunidades, ela vê só a cauda que passou do gatilho. "
      + "Se a cauda for de ruído, a volta dela é certa e não vale nada.",
  };
}

/**
 * A VENUE DOS DOIS LADOS.
 *
 * Se uma corretora é genuinamente mais barata, ela aparece do lado da COMPRA.
 * Mais cara, do lado da VENDA. Aparecer nos dois em proporção parecida quer
 * dizer que o preço dela oscila em volta dos demais — que é a descrição de um
 * feed com atraso ou com ruído, não de uma praça com preço próprio.
 *
 * `balance` mede o quanto ela é simétrica: 1.0 é perfeitamente dos dois lados,
 * 0 é de um lado só.
 */
export function flagVenueDominance(
  legs: Leg[], minShare = 0.6, minSample = 20,
): CohortFlag | null {
  if (legs.length < minSample) return null;
  const buy = new Map<string, number>(), sell = new Map<string, number>();
  for (const l of legs) {
    buy.set(l.buyVenue, (buy.get(l.buyVenue) ?? 0) + 1);
    sell.set(l.sellVenue, (sell.get(l.sellVenue) ?? 0) + 1);
  }
  const venues = new Set([...buy.keys(), ...sell.keys()]);
  let pior: { venue: string; share: number; b: number; s: number } | null = null;
  for (const v of venues) {
    const b = buy.get(v) ?? 0, s = sell.get(v) ?? 0;
    const share = (b + s) / legs.length;
    if (!pior || share > pior.share) pior = { venue: v, share, b, s };
  }
  if (!pior || pior.share < minShare) return null;
  const total = pior.b + pior.s;
  const balance = total > 0 ? 1 - Math.abs(pior.b - pior.s) / total : 0;
  // De um lado só ainda pode ser praça genuinamente barata/cara. É a SIMETRIA
  // que denuncia oscilação.
  if (balance < 0.5) {
    return {
      id: "venue_dominance", level: "aviso",
      title: `${pior.venue} domina as pernas, mas de um lado só`,
      finding: `${(pior.share * 100).toFixed(0)}% das pernas · ${pior.b} compras × ${pior.s} vendas`,
      meaning: "concentração num sentido pode ser praça genuinamente mais barata — vale checar taxa e liquidez antes de confiar.",
    };
  }
  return {
    id: "venue_dominance", level: "fatal",
    title: `${pior.venue} aparece nos DOIS lados das pernas`,
    finding: `${(pior.share * 100).toFixed(0)}% das pernas · ${pior.b} compras × ${pior.s} vendas (simetria ${(balance * 100).toFixed(0)}%)`,
    meaning: "venue barata apareceria só na compra. Nos dois lados, o preço dela oscila em volta dos outros — "
      + "isso é ruído de feed, e o 'spread' capturado é a variância dela.",
  };
}

/**
 * O RISCO QUE A ALAVANCA CRIA E A AMOSTRA AINDA NÃO VIU.
 *
 * A liquidação é um evento de CAUDA: exige um movimento adverso de ~33% (3×) ou
 * ~20% (5×) enquanto a posição está aberta. Em cripto isso acontece — algumas
 * vezes por ano, em quedas gerais. Uma coorte de horas não amostrou esse risco;
 * ela mediu o lucro e não mediu o custo dele.
 *
 * Sem isto na tela, "o 5× está lucrando" é verdade e é enganoso ao mesmo tempo:
 * o lucro aparece desde o primeiro dia e a conta chega uma vez por ano.
 */
export function flagTailUnsampled(
  leverage: number, hoursLive: number, liquidations: number, minDays = 90,
): CohortFlag | null {
  if (leverage <= 1) return null;
  const dias = hoursLive / 24;
  if (dias >= minDays || liquidations > 0) return null;
  return {
    id: "tail_unsampled", level: "fatal",
    title: "o risco da alavanca ainda não foi amostrado",
    finding: `${dias < 1 ? `${hoursLive.toFixed(1)} horas` : `${dias.toFixed(1)} dias`} de vida · ${liquidations} liquidação(ões)`,
    meaning: `liquidação a ${leverage}× exige movimento adverso grande, que acontece algumas vezes por ANO. `
      + "O lucro aparece desde o primeiro dia; a conta chega depois. Comparar agora mede metade do trade.",
  };
}

/**
 * A ALAVANCA NÃO CRIA LUCRO — ela encolhe o denominador.
 *
 * Num par spot+perp o resultado por ciclo vem do spread e do funding sobre o
 * NOCIONAL, que é o mesmo nos três gêmeos. Se o lucro por ciclo em DÓLAR for
 * igual, o retorno percentual maior do alavancado é aritmética de divisão.
 *
 * Isto não é um defeito: é o funcionamento correto. Mas precisa estar escrito
 * ao lado do número, porque a leitura natural de "3× rende o dobro" é que ele
 * ganha mais — quando ele ganha o MESMO, arriscando a liquidação.
 */
export function flagLeverageIsDenominator(desks: CohortDesk[], tolerance = 0.35): CohortFlag | null {
  const comAmostra = desks.filter((d) => d.cycles >= 10);
  if (comAmostra.length < 2) return null;
  const pnls = comAmostra.map((d) => d.avgPnlUsd);
  const min = Math.min(...pnls), max = Math.max(...pnls);
  if (min <= 0 || (max - min) / min > tolerance) return null;
  return {
    id: "leverage_is_denominator", level: "ok",
    title: "a alavanca encolhe o capital, não aumenta o ganho",
    finding: comAmostra.map((d) => `${d.leverage}×: $${d.avgPnlUsd.toFixed(3)}/ciclo`).join(" · "),
    meaning: "lucro por ciclo em dólar é o mesmo (a perna é do mesmo tamanho nos três). "
      + "O retorno percentual maior vem de dividir por menos capital — e por aceitar liquidação.",
  };
}

/** Todas as marcas de uma coorte, pior primeiro. */
export function auditCohort(
  desks: CohortDesk[], legs: Leg[], minSpreadPct: number, gatePct: number, liquidations: number,
): CohortFlag[] {
  const cycles = desks.reduce((n, d) => n + d.cycles, 0);
  const losses = desks.reduce((n, d) => n + d.losses, 0);
  const horas = Math.max(0, ...desks.map((d) => d.hoursLive));
  const maiorAlavanca = Math.max(1, ...desks.map((d) => d.leverage));
  const flags = [
    flagNeverLoses(cycles, losses),
    flagGateTruncated(minSpreadPct, gatePct, cycles),
    flagVenueDominance(legs),
    flagTailUnsampled(maiorAlavanca, horas, liquidations),
    flagLeverageIsDenominator(desks),
  ].filter((f): f is CohortFlag => f !== null);
  const ordem: Record<FlagLevel, number> = { fatal: 0, aviso: 1, ok: 2 };
  return flags.sort((a, b) => ordem[a.level] - ordem[b.level]);
}

/**
 * O VEREDITO. Uma marca fatal significa que o número não pode ser lido como
 * desempenho — não que a mesa deu prejuízo.
 *
 * A distinção importa: "não medido" é diferente de "ruim", e tratar os dois
 * igual leva a desligar coisa boa e a confiar em coisa não verificada com o
 * mesmo gesto.
 */
export function cohortReadable(flags: CohortFlag[]): boolean {
  return !flags.some((f) => f.level === "fatal");
}
