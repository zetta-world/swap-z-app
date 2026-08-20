/**
 * COLHEITA DE FUNDING — a única fonte de retorno que sobreviveu a uma medição
 * honesta nesta casa.
 *
 * Comprado no spot e vendido no perpétuo do MESMO ativo, mesmo tamanho. As duas
 * pernas cancelam a direção: se o ativo dobra ou cai pela metade, o resultado é
 * o mesmo. O que sobra é o funding — fluxo de caixa contratual, publicado, que
 * muda a cada 8 horas.
 *
 * ⚠️⚠️ POR QUE ESTA E NÃO ARBITRAGEM.
 *
 * A arbitragem spot-spot entre CEXes foi reprovada com três medições: dispersão
 * real de 0,052% contra custo de 0,40%, e a profundidade virando +0,451%
 * teóricos em −0,629% reais em 4.085 amostras. O motivo é VELOCIDADE — spread
 * entre CEXes grandes vive milissegundos e olhamos por REST a cada minuto. Não
 * é um jogo em que entramos.
 *
 * O funding não tem esse problema. Ler com um minuto de atraso não atrapalha
 * nada, porque o pagamento é a cada 8h e o preço dele é publicado antes.
 *
 * ⚠️ E POR QUE ELE É `swing`, NUNCA `day`. São QUATRO pernas de corretagem
 * (spot entra/sai + perp entra/sai) pagas UMA vez, contra um funding que pinga
 * de 8 em 8h. O ponto de equilíbrio mediano MEDIDO é 42 dias. Um agente que
 * entra e sai no mesmo dia paga a entrada inteira e sai antes de colher — vira
 * uma máquina de pagar corretagem.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O QUE ESTE MÓDULO NÃO MEDE, e é obrigação dizer:
 *
 *  · **BASIS DE ENTRADA E SAÍDA.** Entrar com o perpétuo acima do spot dá ganho
 *    extra na convergência; abaixo, perda. Fica FORA da conta. Como o basis
 *    típico é <0,05% nos dois sentidos, deixá-lo de fora é neutro, não otimista.
 *
 *  · **LIQUIDAÇÃO.** A perna vendida pode ser liquidada num pico se a margem
 *    for fina. Com margem isolada e alavancagem 1x o risco é remoto, mas não é
 *    zero, e nada aqui o mede.
 *
 *  · **CUSTO DE MARGEM** além do funding, e risco de custódia.
 */

/** Períodos de funding por dia na Gate.io — pagamento de 8 em 8 horas. */
export const PERIODOS_POR_DIA = 3;

/**
 * Corretagem de UMA perna, em %.
 *
 * ⚠️ QUATRO PERNAS, NÃO DUAS. Spot entra, spot sai, perp entra, perp sai. Contar
 * duas foi o erro que fez a arbitragem parecer viável por semanas: o ciclo
 * completo custa o dobro do que a conta ingênua diz.
 */
export const TAXA_POR_PERNA_PCT = Number(process.env.CELEIRO_TAXA_PERNA_PCT ?? 0.1125);
export const PERNAS_DO_CICLO = 4;

/** O custo do ciclo completo, em % do nocional — pago UMA vez. */
export const CUSTO_DO_CICLO_PCT = TAXA_POR_PERNA_PCT * PERNAS_DO_CICLO;

/** Uma leitura de funding: a taxa daquele período, em % do nocional. */
export interface PeriodoDeFunding {
  taxaPct: number;
  emMs: number;
}

export interface Colheita {
  /** Soma dos períodos, em % — SOMA, não composição. */
  brutoPct: number;
  /** Já descontado o ciclo de 4 pernas. */
  liquidoPct: number;
  /** Fração dos períodos em que o funding foi NEGATIVO (você paga). */
  fatiaNegativa: number;
  /** A maior sequência de períodos negativos seguidos. */
  piorSequenciaNegativa: number;
  /** Dias de funding médio só para pagar as 4 pernas. `null` se nunca paga. */
  equilibrioEmDias: number | null;
  periodos: number;
}

/**
 * O que uma série de funding entrega.
 *
 * ⚠️ `brutoPct` É SOMA, NÃO COMPOSIÇÃO. Compor assumiria reinvestir o funding na
 * mesma posição a cada 8h, o que exige aumentar as DUAS pernas e pagar
 * corretagem de novo. A soma é o que uma posição de tamanho fixo realmente
 * recebe — e a diferença, num ano, é grande o bastante para virar promessa.
 */
export function colher(serie: readonly PeriodoDeFunding[]): Colheita {
  const taxas = serie.map((p) => p.taxaPct).filter((t) => Number.isFinite(t));
  const periodos = taxas.length;
  if (periodos === 0) {
    return {
      brutoPct: 0, liquidoPct: -CUSTO_DO_CICLO_PCT, fatiaNegativa: 0,
      piorSequenciaNegativa: 0, equilibrioEmDias: null, periodos: 0,
    };
  }

  const brutoPct = taxas.reduce((s, t) => s + t, 0);
  const negativos = taxas.filter((t) => t < 0).length;

  let corrente = 0, pior = 0;
  for (const t of taxas) {
    corrente = t < 0 ? corrente + 1 : 0;
    if (corrente > pior) pior = corrente;
  }

  const medioPorPeriodo = brutoPct / periodos;
  const porDia = medioPorPeriodo * PERIODOS_POR_DIA;

  return {
    brutoPct,
    liquidoPct: brutoPct - CUSTO_DO_CICLO_PCT,
    fatiaNegativa: negativos / periodos,
    piorSequenciaNegativa: pior,
    /**
     * ⚠️ `null` QUANDO O FUNDING MÉDIO NÃO É POSITIVO. Devolver um número
     * enorme diria "paga em 40.000 dias", que a tela arredonda e alguém lê como
     * "paga". Não pagar nunca é uma resposta diferente de pagar devagar.
     */
    equilibrioEmDias: porDia > 0 ? CUSTO_DO_CICLO_PCT / porDia : null,
    periodos,
  };
}

export interface Portao {
  entra: boolean;
  porque: string;
}

/**
 * Piso de períodos para um veredito valer.
 *
 * ⚠️ 90 períodos ≈ 30 dias. Abaixo disso a série não viu um ciclo de regime, e
 * o funding é sazonal: uma semana de alta euforia mostra taxa alta que não se
 * repete. Julgar com menos é premiar o momento, que foi o erro de "+7,04% com
 * amostra pequena".
 */
export const MINIMO_DE_PERIODOS = 90;

/** Teto de períodos negativos seguidos que ainda se tolera. */
export const TETO_SEQUENCIA_NEGATIVA = 9;

/**
 * O portão de entrada.
 *
 * ⚠️ COMPARA COM O CONTROLE, NÃO COM ZERO. Funding positivo não basta: se ele
 * render menos que o Aluguel de Ocioso, montar duas pernas e correr risco de
 * liquidação para ganhar menos do que emprestar o USDT parado é destruir valor
 * com trabalho extra. É a regra que o `aposentaQuando` deste agente já escreve.
 */
export function portao(
  c: Colheita,
  controleAnualPct: number,
  janelaDias: number,
): Portao {
  if (c.periodos < MINIMO_DE_PERIODOS) {
    return {
      entra: false,
      porque: `série com ${c.periodos} períodos, mínimo ${MINIMO_DE_PERIODOS} `
        + "— sem um ciclo de regime a taxa vista é momento, não regime",
    };
  }
  if (c.equilibrioEmDias === null) {
    return { entra: false, porque: "funding médio não é positivo — o ciclo nunca se paga" };
  }
  if (c.piorSequenciaNegativa > TETO_SEQUENCIA_NEGATIVA) {
    return {
      entra: false,
      porque: `${c.piorSequenciaNegativa} períodos negativos seguidos (teto `
        + `${TETO_SEQUENCIA_NEGATIVA}) — a posição sangra por dias antes de virar`,
    };
  }

  const anualizado = anualizar(c, janelaDias);
  if (anualizado <= controleAnualPct) {
    return {
      entra: false,
      porque: `${anualizado.toFixed(2)}%/ano contra ${controleAnualPct.toFixed(2)}% `
        + "do Aluguel de Ocioso — duas pernas e risco de liquidação para render menos "
        + "que emprestar o USDT parado",
    };
  }
  return {
    entra: true,
    porque: `${anualizado.toFixed(2)}%/ano depois das 4 pernas, contra `
      + `${controleAnualPct.toFixed(2)}% do controle · equilíbrio em `
      + `${c.equilibrioEmDias.toFixed(0)} dias`,
  };
}

/**
 * Quanto sobra em um ano, com UMA entrada e UMA saída.
 *
 * ⚠️ ESTE É O NÚMERO QUE COMPARA, e o `liquidoPct` cru NÃO era. Ele confronta um
 * funding ACUMULADO NA JANELA com um custo que se paga UMA VEZ — e numa janela
 * de 30 dias o custo fixo esmaga um funding que ainda nem teve tempo de somar.
 * Foi assim que se leu "mediana líquida −0,22%" como "funding não paga", quando
 * o que o número dizia era "trinta dias não pagam a entrada". São afirmações
 * diferentes, e a segunda é quase uma tautologia.
 */
export function anualizar(c: Colheita, janelaDias: number): number {
  if (!(janelaDias > 0) || c.periodos === 0) return 0;
  const brutoAnual = (c.brutoPct / janelaDias) * 365;
  return brutoAnual - CUSTO_DO_CICLO_PCT;
}

/**
 * Lê a série de funding de um contrato perpétuo na Gate.io.
 *
 * ⚠️ Endpoint público, sem credencial — mesma razão do controle: a régua antes
 * do dinheiro. E falha devolve `null`, nunca lista vazia: lista vazia passaria
 * por "série sem funding" e o portão a leria como dado, não como ausência.
 */
export async function lerSerieDeFunding(
  simbolo: string,
  limite = 200,
  buscar: (url: string) => Promise<unknown> = padraoBuscar,
): Promise<PeriodoDeFunding[] | null> {
  const url = "https://api.gateio.ws/api/v4/futures/usdt/funding_rate"
    + `?contract=${simbolo.toUpperCase()}_USDT&limit=${limite}`;
  try {
    const corpo = await buscar(url);
    return converterSerie(corpo);
  } catch {
    return null;
  }
}

/** Converte a resposta bruta em série. `null` quando não dá para confiar. */
export function converterSerie(corpo: unknown): PeriodoDeFunding[] | null {
  if (!Array.isArray(corpo)) return null;
  const out: PeriodoDeFunding[] = [];
  for (const linha of corpo) {
    const r = Number((linha as { r?: unknown })?.r);
    const t = Number((linha as { t?: unknown })?.t);
    if (!Number.isFinite(r) || !Number.isFinite(t)) continue;
    // ⚠️ A Gate.io devolve a taxa como FRAÇÃO (0.0001) e o instante em SEGUNDOS.
    out.push({ taxaPct: r * 100, emMs: t * 1000 });
  }
  return out.length > 0 ? out : null;
}

async function padraoBuscar(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`gate.io respondeu ${r.status}`);
  return r.json();
}
