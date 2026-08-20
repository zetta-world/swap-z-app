/**
 * MAKER DE FAIXA — ganha o spread, nunca a tendência.
 *
 * Cota os dois lados do livro em par que passe num teste ESTATÍSTICO de
 * lateralidade. Se o par sair da faixa medida, o agente PARA de cotar — em vez
 * de virar direcional, que é a fronteira escrita no `naoFaz` dele.
 *
 * ⚠️⚠️ POR QUE O TESTE DE FAIXA É ESTATÍSTICO E NÃO UM MODELO OPINANDO.
 *
 * Classificação de regime por LLM já existia na arena antiga (`RANGING`,
 * `TRENDING_UP`...) e o resultado por regime foi: RANGING −0,94%,
 * TRENDING_DOWN −0,93%, TRANSITIONING −0,70%, TRENDING_UP −1,54%. TODOS
 * negativos. O rótulo de regime não separava nada.
 *
 * Aqui a pergunta é outra e é aritmética: **quanto do caminho andado virou
 * deslocamento?** Uma série que sobe 10 andando 10 é tendência pura; uma que
 * anda 100 para terminar onde começou é faixa pura. É propriedade da série, não
 * opinião sobre o futuro.
 *
 * ⚠️ E O ACASO É CALCULÁVEL AQUI, o que é o ponto. Num passeio aleatório de n
 * passos o deslocamento esperado é ~√n contra um caminho de n — ou seja, razão
 * ~1/√n. Com 60 fatias isso dá ~0,13. Saber o número do acaso ANTES de escolher
 * o limiar é exatamente o que faltou na arena antiga: seis modelos ficaram
 * ABAIXO do acaso por dois meses porque ninguém tinha calculado qual era.
 *
 * ⚠️ POR QUE NÃO CONTAR "PASSOS QUE VOLTAM À MÉDIA", que era a ideia anterior:
 * ela não separa nada. Numa série que alterna 101/99 nenhum passo reduz a
 * distância à média (é sempre 1), e numa tendência que atravessa a média metade
 * dos passos se aproxima por construção. As duas dão ~50% — a métrica media o
 * próprio eixo, não o comportamento.
 */

export interface Fatia {
  fechamento: number;
}

export interface Lateralidade {
  /**
   * Deslocamento líquido dividido pelo caminho andado (0 a 1).
   * Perto de 0 = faixa; perto de 1 = tendência.
   */
  razaoDeEficiencia: number;
  /** O que o acaso daria nesta amostra: ~1/√n. O limiar se mede contra ISTO. */
  acasoEsperado: number;
  /** Amplitude da faixa, em % da média. */
  amplitudePct: number;
  amostras: number;
}

/**
 * Mede quanto do caminho andado virou deslocamento.
 *
 * ⚠️ NÃO É VARIÂNCIA. Uma série com variância alta pode ser tendência forte ou
 * faixa larga — opostas para este agente, e a variância não as distingue. A
 * razão de eficiência distingue: as duas andam muito, mas só uma chega longe.
 */
export function medirLateralidade(fatias: readonly Fatia[]): Lateralidade | null {
  const p = fatias.map((f) => f.fechamento).filter((n) => Number.isFinite(n) && n > 0);
  if (p.length < 20) return null;

  const media = p.reduce((s, v) => s + v, 0) / p.length;
  if (!(media > 0)) return null;

  let caminho = 0;
  for (let i = 1; i < p.length; i++) caminho += Math.abs(p[i] - p[i - 1]);
  if (!(caminho > 0)) return null;   // série travada: nada a cotar

  const deslocamento = Math.abs(p[p.length - 1] - p[0]);

  return {
    razaoDeEficiencia: deslocamento / caminho,
    acasoEsperado: 1 / Math.sqrt(p.length - 1),
    amplitudePct: (Math.max(...p) - Math.min(...p)) / media * 100,
    amostras: p.length,
  };
}

export interface Veredito {
  cota: boolean;
  porque: string;
}

/**
 * Teto de eficiência para o par ser considerado lateral.
 *
 * ⚠️ ESTE NÚMERO SÓ FAZ SENTIDO CONTRA O ACASO, e por isso `deveCotar` compara
 * com `acasoEsperado` em vez de usar o teto sozinho. Num passeio aleatório de
 * 60 fatias a razão já vem em ~0,13 sem tendência nenhuma; um teto fixo de
 * 0,30 aprovaria metade dos passeios aleatórios do mercado achando que achou
 * faixa. O limiar é um MÚLTIPLO do acaso, não um valor absoluto.
 */
export const MULTIPLO_DO_ACASO = Number(process.env.CELEIRO_MULTIPLO_ACASO ?? 1.5);

/**
 * Amplitude mínima: a faixa precisa ser mais larga que o custo de girar dentro
 * dela, senão o spread capturado não paga a corretagem das duas pontas.
 */
export const AMPLITUDE_MINIMA_PCT = Number(process.env.CELEIRO_AMPLITUDE_MIN_PCT ?? 0.8);

/** Acima disto não é faixa, é ativo quebrando — e cotar os dois lados sangra. */
export const AMPLITUDE_MAXIMA_PCT = Number(process.env.CELEIRO_AMPLITUDE_MAX_PCT ?? 12);

/**
 * O par serve para cotar?
 *
 * ⚠️ O TETO EXISTE E É TÃO IMPORTANTE QUANTO O PISO. Um par que oscila 40% num
 * dia tem reversão altíssima e mataria o agente: cotar os dois lados de algo
 * assim é vender opção de graça. Só piso deixaria passar exatamente o pior caso.
 */
export function deveCotar(
  l: Lateralidade | null,
  multiploDoAcaso: number = MULTIPLO_DO_ACASO,
): Veredito {
  if (l === null) {
    return { cota: false, porque: "série curta ou ilegível — não medido não é aprovado" };
  }
  const teto = l.acasoEsperado * multiploDoAcaso;
  if (l.razaoDeEficiencia > teto) {
    return {
      cota: false,
      porque: `eficiência ${l.razaoDeEficiencia.toFixed(3)} acima do teto `
        + `${teto.toFixed(3)} (${multiploDoAcaso}× o acaso de `
        + `${l.acasoEsperado.toFixed(3)}) — isto anda para algum lugar, é tendência`,
    };
  }
  if (l.amplitudePct < AMPLITUDE_MINIMA_PCT) {
    return {
      cota: false,
      porque: `faixa de ${l.amplitudePct.toFixed(2)}% é estreita demais — o spread `
        + "capturado não paga a corretagem das duas pontas",
    };
  }
  if (l.amplitudePct > AMPLITUDE_MAXIMA_PCT) {
    return {
      cota: false,
      porque: `amplitude de ${l.amplitudePct.toFixed(2)}% não é faixa, é ativo `
        + "quebrando — cotar os dois lados disso é vender opção de graça",
    };
  }
  return {
    cota: true,
    porque: `eficiência ${l.razaoDeEficiencia.toFixed(3)} contra acaso `
      + `${l.acasoEsperado.toFixed(3)} — anda muito e não chega a lugar nenhum · `
      + `faixa de ${l.amplitudePct.toFixed(2)}% em ${l.amostras} fatias`,
  };
}
