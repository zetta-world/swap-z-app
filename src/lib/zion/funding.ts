/**
 * BASIS / FUNDING — a única arbitragem da família que não depende de velocidade.
 *
 * ⚠️ POR QUE MEDIR ISTO AGORA (04/08).
 *
 * A arbitragem spot-spot entre CEXes foi REPROVADA com três medições
 * independentes (`docs/PLANO-ARBITER-REAL.md`): dispersão real de 0.052% contra
 * custo de 0.40%, e a profundidade do livro virando +0.451% teóricos em −0.629%
 * reais em 4.085 amostras.
 *
 * O motivo estrutural é velocidade: spread entre CEXes grandes vive
 * milissegundos, e a mesa olha a cada minuto por REST. Não é um problema de
 * lógica, é de infraestrutura, e não é um jogo em que entramos.
 *
 * O funding não tem esse problema. Ele é PUBLICADO, muda a cada 8 horas, e é
 * um fluxo de caixa contratual — quem está comprado no perpétuo paga quem está
 * vendido (ou o contrário, quando é negativo). Ler com um minuto de atraso não
 * atrapalha nada.
 *
 * A mecânica: comprado no spot + vendido no perpétuo da MESMA moeda, mesmo
 * tamanho. A posição é neutra em direção — se o preço dobra ou cai pela metade,
 * as duas pernas se cancelam. O que sobra é o funding.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO NÃO FINGE MEDIR, e é obrigação dizer:
 *
 *  · BASIS DE ENTRADA E SAÍDA. Entrar com o perpétuo acima do spot dá um ganho
 *    extra na convergência; entrar abaixo dá perda. Medir isso exige o histórico
 *    de mark price contra spot, que não temos. Fica FORA da conta — e como o
 *    basis típico é <0.05% nos dois sentidos, deixá-lo de fora é neutro, não
 *    otimista.
 *
 *  · LIQUIDAÇÃO. A perna vendida pode ser liquidada num pico se a margem for
 *    fina. Com margem isolada e alavancagem 1x — a regra da casa em
 *    PLANO-ARBITER-REAL.md — o risco é remoto, mas não é zero, e nada aqui o mede.
 *
 *  · CUSTO DE MARGEM além do funding, e risco de custódia na corretora.
 *
 * O que ESTÁ na conta: o funding realizado, período a período, e o custo das
 * quatro pernas (spot entra/sai + perp entra/sai).
 */

import { median } from "@/lib/zion/stats";

/** Custo do ciclo completo, 4 pernas — o mesmo do arbiter 2.0, não um novo. */
export const COST_PCT = Number(process.env.ARB2_COST_PCT ?? 0.45);

/** Períodos de funding por dia. Binance/Bybit pagam a cada 8h. */
export const PERIODS_PER_DAY = 3;

export interface FundingPoint { t: number; ratePct: number }

export interface FundingStats {
  symbol: string;
  periods: number;
  days: number;
  /** Média por período de 8h, em %. */
  meanPct: number;
  /** Mediana por período — a média sozinha é refém de um pico de mania. */
  medianPct: number;
  /** Anualizado a partir da MÉDIA. Otimista por construção; ver nota abaixo. */
  annualizedPct: number;
  /** Soma simples do funding na janela, sem reinvestir. */
  grossPct: number;
  /** O que sobra depois das 4 pernas. É este o número que decide. */
  netPct: number;
  /** Fração dos períodos em que o funding foi NEGATIVO (você paga). */
  negativeShare: number;
  /** Pior queda pico-a-vale da curva acumulada de funding. */
  maxDrawdownPct: number;
  /** Dias de funding médio só para pagar as 4 pernas. */
  breakEvenDays: number | null;
  /** A maior sequência de períodos negativos seguidos. */
  worstNegativeStreak: number;
}

/**
 * As estatísticas de uma série de funding.
 *
 * ⚠️ `grossPct` é SOMA, não composição. Compor assumiria reinvestir o funding
 * na mesma posição a cada 8h, o que exige aumentar as duas pernas e pagar
 * corretagem de novo. A soma é o que uma posição de tamanho fixo realmente
 * embolsa, e é o número menor dos dois — quando houver dúvida, o menor.
 */
export function fundingStats(symbol: string, pontos: FundingPoint[], costPct = COST_PCT): FundingStats | null {
  if (pontos.length < 10) return null;
  const taxas = pontos.map((p) => p.ratePct);
  const n = taxas.length;

  const soma = taxas.reduce((s, r) => s + r, 0);
  const meanPct = soma / n;
  const negativos = taxas.filter((r) => r < 0).length;

  // Curva acumulada — é nela que o tombo aparece. Uma média positiva pode
  // esconder semanas de sangria, e é a sangria que faz alguém fechar no pior
  // momento.
  let acumulado = 0, pico = 0, maxDd = 0;
  let streak = 0, piorStreak = 0;
  for (const r of taxas) {
    acumulado += r;
    if (acumulado > pico) pico = acumulado;
    const dd = pico - acumulado;
    if (dd > maxDd) maxDd = dd;
    if (r < 0) { streak++; if (streak > piorStreak) piorStreak = streak; } else streak = 0;
  }

  const porDia = meanPct * PERIODS_PER_DAY;

  return {
    symbol,
    periods: n,
    days: n / PERIODS_PER_DAY,
    meanPct,
    medianPct: median(taxas) ?? 0,
    /**
     * ⚠️ ANUALIZADO É EXTRAPOLAÇÃO, NÃO MEDIÇÃO. Ele repete a janela medida
     * 365 dias adentro e assume que o regime não muda. Está aqui porque é a
     * unidade em que o mercado fala de funding, mas o número que decide é o
     * `netPct` da janela REAL — esse aconteceu.
     */
    annualizedPct: porDia * 365,
    grossPct: soma,
    netPct: soma - costPct,
    negativeShare: negativos / n,
    maxDrawdownPct: maxDd,
    // Sem funding médio positivo não existe ponto de equilíbrio: a posição
    // nunca paga as pernas, e devolver um número grande sugeriria "é só
    // esperar mais", que é falso.
    breakEvenDays: porDia > 0 ? costPct / porDia : null,
    worstNegativeStreak: piorStreak,
  };
}

/**
 * Quantas apostas independentes existem de verdade.
 *
 * O funding é uma variável de POSICIONAMENTO do mercado: quando todo mundo está
 * comprado, ele fica positivo em tudo ao mesmo tempo. Se for esse o caso, medir
 * 50 moedas não dá 50 observações — dá uma, repetida.
 *
 * É o mesmo cuidado que o estudo de estratégias exigiu, e lá a resposta foi
 * ρ≈0.78: dez símbolos valendo 1.2 apostas.
 *
 * ⚠️ Reexportado de `stats.ts` em vez de reimplementado. Eu escrevi uma segunda
 * cópia aqui no mesmo commit em que documentei por que duas cópias são
 * perigosas — a discordância de onze pontos de 04/08 nasceu exatamente assim.
 */
export { meanPairwiseRateCorrelation as fundingCorrelation } from "@/lib/zion/stats";

/**
 * O VEREDITO, com a mesma régua do resto do laboratório.
 *
 * Regras que não se negociam aqui:
 *
 *  · amostra curta não vira número — abaixo de `minDays` a resposta é
 *    "inconclusivo", nunca "aprovado". É a cicatriz de `inconclusivo ≠ aprovado`.
 *  · o que decide é o LÍQUIDO da janela real, não o anualizado.
 *  · funding negativo em fração alta dos períodos reprova mesmo com média
 *    positiva: significa que a renda depende de um regime, e regime vira.
 */
export interface FundingVerdict {
  readable: boolean;
  verdict: string;
  positivos: number;
  total: number;
}

export function fundingVerdict(
  stats: FundingStats[], minDays = 60, maxNegativeShare = 0.35,
): FundingVerdict {
  const comAmostra = stats.filter((s) => s.days >= minDays);
  if (comAmostra.length === 0) {
    return {
      readable: false, positivos: 0, total: stats.length,
      verdict: `nenhum símbolo com ${minDays}+ dias de funding — inconclusivo, que não é o mesmo que reprovado`,
    };
  }

  const positivos = comAmostra.filter((s) => s.netPct > 0);
  const robustos = positivos.filter((s) => s.negativeShare <= maxNegativeShare);
  const medianaLiquida = median(comAmostra.map((s) => s.netPct)) ?? 0;

  if (robustos.length === 0) {
    return {
      readable: true, positivos: positivos.length, total: comAmostra.length,
      verdict: positivos.length === 0
        ? `nenhum dos ${comAmostra.length} símbolos pagou as 4 pernas na janela medida — `
          + `mediana líquida ${medianaLiquida.toFixed(2)}%`
        : `${positivos.length} de ${comAmostra.length} ficaram positivos, mas TODOS com funding negativo `
          + `em mais de ${Math.round(maxNegativeShare * 100)}% dos períodos — é renda de regime, não de estrutura`,
    };
  }

  return {
    readable: true, positivos: positivos.length, total: comAmostra.length,
    verdict: `${robustos.length} de ${comAmostra.length} símbolos pagaram as 4 pernas COM funding negativo `
      + `em menos de ${Math.round(maxNegativeShare * 100)}% dos períodos · mediana líquida da janela `
      + `${medianaLiquida.toFixed(2)}% · o anualizado NÃO é a medida, esta janela é`,
  };
}
