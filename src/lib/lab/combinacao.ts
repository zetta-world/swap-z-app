/**
 * COMBINAR AS VERDES — a única coisa que a correlação diz que funciona.
 *
 * ⚠️ DE ONDE VEIO (08/08).
 *
 * A Fase 4 respondeu mais do que se propôs a medir. O gás NÃO é a barreira —
 * foi lido (`gasLido: true`) e é desprezível com L2. A correlação é: ρ=0,07
 * transforma 50 símbolos em 12 apostas, e dobrar para 100 daria ~14. Adicionar
 * o 51º perpétuo não faz nada.
 *
 * O que a correlação diz que FUNCIONA é combinar rendas com MOTORES diferentes:
 * funding paga por posicionamento, empréstimo paga por demanda de crédito,
 * Tesouro paga por juro soberano, staking paga por emissão do protocolo.
 * Quatro causas, não quatro sabores da mesma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ AS TRÊS ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA NÃO CAIR.
 *
 * 1. DIVERSIFICAÇÃO NÃO AUMENTA RETORNO — ELA REDUZ VARIÂNCIA. Uma carteira de
 *    3,40% e 1,18% rende ~2,3%: MENOS que a melhor parte. Um painel que
 *    anuncia "o Sharpe da carteira é melhor!" esconde que o dono ganharia
 *    menos. Os dois números saem juntos, sempre, e a escolha é dele.
 *
 * 2. O RISCO QUE DECIDE NÃO ESTÁ NA SÉRIE. O retorno do empréstimo de
 *    stablecoin quase nunca é negativo — o risco dele é exploit de contrato e
 *    despegue, que a Fase 4 declarou NÃO medido. Ranquear por volatilidade
 *    ordenaria as estratégias por QUAL RISCO NÓS DEIXAMOS DE MEDIR, premiando
 *    justamente a que esconde melhor. Por isso `vol` nunca vira veredito
 *    sozinha aqui.
 *
 * 3. DIVERSIFICAR CUSTA. Cada fluxo cobra a própria entrada. Dividir $1.000 em
 *    quatro paga QUATRO entradas de $250, e o gás é fixo. A carteira é medida
 *    líquida do custo no capital DIVIDIDO — a lição da Fase 4 aplicada contra
 *    a tese desta fase.
 */

import { pearson, median } from "@/lib/zion/stats";

/** Um dia UTC, `YYYY-MM-DD`. A chave de alinhamento. */
export type Dia = string;

/** Um fluxo de renda: uma série de retornos DIÁRIOS em %, indexada por dia. */
export interface Fluxo {
  slug: string;
  nome: string;
  /** O que faz esse fluxo pagar. É a razão de ele diversificar, ou não. */
  motor: string;
  /** dia UTC → retorno do dia, em % do capital alocado nele. */
  porDia: Map<Dia, number>;
  /** Custo de UMA ida e volta, em % — medido na Fase 4. */
  idaEVoltaPct: number;
}

export function diaUtc(ms: number): Dia {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * ⚠️⚠️ ALINHAMENTO POR DATA, NÃO POR POSIÇÃO (08/08).
 *
 * `meanPairwiseRateCorrelation` em `stats.ts` alinha com
 * `s.slice(s.length - menor)` — os N últimos de cada série. Aquilo está CERTO
 * lá: as séries de funding vivem todas na mesma grade de 8h e terminam juntas.
 *
 * Aqui não. O funding vem de 8 em 8 horas da okx; o APY das piscinas vem uma
 * vez por dia da DefiLlama, com fins diferentes por piscina. Cortar os N
 * últimos correlacionaria segunda-feira de um fluxo com quinta-feira do outro
 * — e devolveria um número plausível, que é o pior tipo de errado.
 *
 * A interseção é deliberadamente ESTRITA: só entram os dias em que TODOS os
 * fluxos têm valor. Preencher buraco com zero inventaria um dia sem renda; com
 * o último valor, inventaria persistência. Perder dia é honesto; inventar não.
 */
export function alinhar(fluxos: Fluxo[]): { dias: Dia[]; matriz: number[][] } {
  if (fluxos.length === 0) return { dias: [], matriz: [] };
  const comuns = [...fluxos[0].porDia.keys()]
    .filter((d) => fluxos.every((f) => f.porDia.has(d)))
    .sort();
  return {
    dias: comuns,
    matriz: fluxos.map((f) => comuns.map((d) => f.porDia.get(d)!)),
  };
}

/** Matriz de correlação par a par. Diagonal 1, simétrica. */
export function matrizCorrelacao(series: number[][]): number[][] {
  return series.map((a, i) => series.map((b, j) => (i === j ? 1 : pearson(a, b))));
}

/**
 * A correlação MÉDIA fora da diagonal — a que entra na conta de apostas
 * efetivas. Média de pares, não da matriz inteira (a diagonal puxaria para 1).
 */
export function correlacaoMedia(m: number[][]): number | null {
  let soma = 0, pares = 0;
  for (let i = 0; i < m.length; i++) {
    for (let j = i + 1; j < m.length; j++) { soma += m[i][j]; pares++; }
  }
  return pares > 0 ? soma / pares : null;
}

export interface Estatistica {
  /** Retorno anualizado a partir da média diária. Extrapolação, e dita. */
  anualizadoPct: number;
  /** Desvio padrão dos retornos diários, anualizado. */
  volAnualPct: number;
  /** Pior queda pico-a-vale da curva acumulada, em pontos percentuais. */
  tomboPct: number;
  /** Fração de dias negativos. */
  diasNegativos: number;
  dias: number;
}

export function estatisticas(retornosDiarios: number[]): Estatistica | null {
  const n = retornosDiarios.length;
  if (n < 2) return null;
  const media = retornosDiarios.reduce((s, r) => s + r, 0) / n;
  const varia = retornosDiarios.reduce((s, r) => s + (r - media) ** 2, 0) / (n - 1);
  let acumulado = 0, pico = 0, maxDd = 0, negativos = 0;
  for (const r of retornosDiarios) {
    acumulado += r;
    if (acumulado > pico) pico = acumulado;
    if (pico - acumulado > maxDd) maxDd = pico - acumulado;
    if (r < 0) negativos++;
  }
  return {
    anualizadoPct: media * 365,
    volAnualPct: Math.sqrt(varia) * Math.sqrt(365),
    tomboPct: maxDd,
    diasNegativos: negativos / n,
    dias: n,
  };
}

/**
 * A carteira de peso igual, LÍQUIDA do custo de entrada no capital dividido.
 *
 * ⚠️ É AQUI QUE A TESE DESTA FASE APANHA DA FASE 4. Dividir $1.000 em quatro
 * fluxos não paga um custo de entrada — paga QUATRO, cada um sobre $250. O
 * custo percentual de cada fluxo já foi medido na Fase 4 com o gás dentro, e
 * gás é FIXO: quanto menor a fatia, maior o custo em percentual.
 *
 * Sem isso a combinação sempre pareceria de graça, e a conclusão sairia
 * enviesada a favor da hipótese que eu mesmo levantei.
 */
export function carteiraIgual(
  fluxos: Fluxo[], matriz: number[][],
): { retornosDiarios: number[]; custoEntradaPct: number } {
  const k = fluxos.length;
  if (k === 0 || matriz.length === 0) return { retornosDiarios: [], custoEntradaPct: 0 };
  const dias = matriz[0].length;
  const retornosDiarios: number[] = [];
  for (let d = 0; d < dias; d++) {
    let soma = 0;
    for (let f = 0; f < k; f++) soma += matriz[f][d];
    retornosDiarios.push(soma / k);
  }
  // Cada fluxo cobra a entrada dele sobre a FATIA — e a fatia é 1/k do capital.
  // Em percentual da carteira inteira, isso é a média dos custos.
  const custoEntradaPct = fluxos.reduce((s, f) => s + f.idaEVoltaPct, 0) / k;
  return { retornosDiarios, custoEntradaPct };
}

export interface VereditoCombinacao {
  readable: boolean;
  status: "verde" | "cinza" | "morta";
  verdict: string;
}

/**
 * ⚠️ PISO DE DIAS EM COMUM. Duas semanas de interseção não medem correlação —
 * medem uma quinzena. Palpite declarado, como o de 35% de períodos negativos.
 */
export const MIN_DIAS_COMUNS = 45;
/** Combinar exige pelo menos dois fluxos. Um fluxo é o fluxo, não carteira. */
export const MIN_FLUXOS = 2;

/**
 * O veredito.
 *
 * ⚠️ ELE COMPARA CONTRA A MELHOR PARTE, NÃO CONTRA A MÉDIA DAS PARTES.
 *
 * Comparar carteira contra média é uma tautologia: a carteira de peso igual É a
 * média. O que decide se vale combinar é se ela ganha de CONCENTRAR na melhor —
 * que é a alternativa real que o dono tem.
 */
export function vereditoCombinacao(args: {
  fluxos: number;
  diasComuns: number;
  carteira: Estatistica | null;
  carteiraLiquidaPct: number | null;
  melhorParteNome: string;
  melhorParteLiquidaPct: number | null;
  melhorParteTomboPct: number | null;
  rhoMedio: number | null;
}): VereditoCombinacao {
  const {
    fluxos, diasComuns, carteira, carteiraLiquidaPct,
    melhorParteNome, melhorParteLiquidaPct, melhorParteTomboPct, rhoMedio,
  } = args;

  if (fluxos < MIN_FLUXOS) {
    return {
      readable: false, status: "cinza",
      verdict: `só ${fluxos} fluxo com série utilizável — um fluxo é o fluxo, não uma `
        + "carteira. INCONCLUSIVO, que não é reprovado.",
    };
  }
  if (diasComuns < MIN_DIAS_COMUNS) {
    return {
      readable: false, status: "cinza",
      verdict: `só ${diasComuns} dias em que TODOS os ${fluxos} fluxos têm valor, abaixo do `
        + `piso de ${MIN_DIAS_COMUNS} — isso mede uma quinzena, não uma correlação. `
        + "INCONCLUSIVO.",
    };
  }
  if (!carteira || carteiraLiquidaPct == null || melhorParteLiquidaPct == null) {
    return {
      readable: false, status: "cinza",
      verdict: "faltou série ou custo para fechar a conta — sem os dois não há veredito.",
    };
  }

  const rho = rhoMedio == null ? "—" : `${Math.round(rhoMedio * 100)}%`;
  const ganhaRetorno = carteiraLiquidaPct > melhorParteLiquidaPct;
  const ganhaTombo = melhorParteTomboPct != null && carteira.tomboPct < melhorParteTomboPct;

  const base = `${fluxos} fluxos · ${diasComuns} dias em comum · correlação média ${rho} · `
    + `carteira ${carteiraLiquidaPct.toFixed(2)}%/ano líquido contra `
    + `${melhorParteLiquidaPct.toFixed(2)}% de ${melhorParteNome} sozinha`;

  /**
   * ⚠️ O CASO QUE EU ESPERO, e ele NÃO é reprovação da diversificação.
   *
   * A carteira quase certamente rende MENOS que a melhor parte — é aritmética,
   * não descoberta: a média de 3,40% e 1,18% é 2,29%. O que ela pode ganhar é
   * tombo. Chamar isso de "morta" seria tão errado quanto chamar de "verde"
   * pelo Sharpe: são duas perguntas, e a resposta é uma tabela, não um selo.
   */
  if (!ganhaRetorno && !ganhaTombo) {
    return {
      readable: true, status: "morta",
      verdict: `${base} — e o tombo TAMBÉM não melhora. Combinar perde nas duas pontas: `
        + "concentrar na melhor parte é o certo.",
    };
  }
  if (!ganhaRetorno && ganhaTombo) {
    return {
      readable: true, status: "cinza",
      verdict: `${base} — rende MENOS, como manda a aritmética, mas o tombo cai de `
        + `${melhorParteTomboPct!.toFixed(2)} para ${carteira.tomboPct.toFixed(2)} pontos. `
        + "É troca de retorno por sono, não ganho: quem decide é o dono, não o Sharpe.",
    };
  }
  return {
    readable: true, status: "verde",
    verdict: `${base} — a carteira rende MAIS que a melhor parte sozinha`
      + (ganhaTombo ? " E com tombo menor" : ", embora com tombo maior")
      + ". Correlação baixa o bastante para o conjunto valer mais que as partes.",
  };
}

/** A melhor parte pelo LÍQUIDO — a alternativa real a combinar. */
export function melhorParte<T extends { nome: string; liquidoPct: number | null }>(
  partes: T[],
): T | null {
  const validas = partes.filter((p) => p.liquidoPct != null);
  if (validas.length === 0) return null;
  return validas.reduce((a, b) => (b.liquidoPct! > a.liquidoPct! ? b : a));
}

/** Mediana exposta para quem monta séries a partir de várias piscinas. */
export { median };
