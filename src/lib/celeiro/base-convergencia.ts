/**
 * CONVERGÊNCIA DE BASE — ganha da distância entre duas pontas do MESMO ativo.
 *
 * O perpétuo e o spot do mesmo ativo têm de convergir no vencimento do funding.
 * Quando a base abre além de um limiar, comprar a ponta barata e vender a cara
 * captura o fechamento — sem opinião sobre para onde o ativo vai.
 *
 * ⚠️ POR QUE ISTO NÃO É A ARBITRAGEM QUE MORREU. A spot-spot morreu por
 * VELOCIDADE: o spread entre dois CEXes vive milissegundos e olhamos por REST a
 * cada minuto. A base perpétuo-spot é outra coisa — ela é uma FUNÇÃO do funding,
 * que é publicado e muda a cada 8h. Uma base aberta não fecha em milissegundos;
 * ela fecha no ciclo. Ler com um minuto de atraso não perde a janela.
 *
 * ⚠️ E O QUE NÃO MUDA: as quatro pernas continuam custando 0,45%, e o portão de
 * profundidade continua obrigatório nas DUAS pernas. Foi ignorar a profundidade
 * que virou +0,451% teóricos em −0,629% reais em 4.085 medições.
 */

import { CUSTO_DO_CICLO_PCT } from "@/lib/celeiro/funding-colheita";

export interface Pontas {
  /** Preço do perpétuo. */
  perp: number;
  /** Preço do spot. */
  spot: number;
}

/**
 * A base, em % do spot. Positiva = perpétuo caro (vender perp, comprar spot).
 *
 * ⚠️ ASSINADA, e o sinal é a operação. Usar valor absoluto perderia QUAL ponta
 * comprar — e o agente abriria a perna errada metade das vezes, o que é
 * indistinguível de uma aposta direcional.
 */
export function basePct(p: Pontas): number | null {
  if (!(p.spot > 0) || !(p.perp > 0)) return null;
  return (p.perp - p.spot) / p.spot * 100;
}

export interface Decisao {
  abre: boolean;
  /** `vender_perp` quando a base é positiva; `comprar_perp` quando negativa. */
  lado: "vender_perp" | "comprar_perp" | null;
  basePct: number | null;
  /** O que sobra depois das 4 pernas, se a base fechar por inteiro. */
  sobraPct: number | null;
  porque: string;
}

/**
 * Margem exigida ACIMA do custo, em pontos percentuais.
 *
 * ⚠️ NÃO BASTA A BASE PAGAR O CUSTO — ela tem de pagar com folga. Uma base
 * exatamente igual ao custo é uma operação de resultado zero que ainda carrega
 * risco de execução, de liquidação e de a base ABRIR mais antes de fechar.
 * Operar no empate é pagar risco para não ganhar nada.
 */
export const MARGEM_EXIGIDA_PP = Number(process.env.CELEIRO_BASE_MARGEM_PP ?? 0.15);

/**
 * Decide se a base compensa.
 *
 * ⚠️ LEITURA FALTANDO REPROVA, e não vira "base zero". Base zero é uma
 * afirmação sobre o mercado; leitura falha é ausência de afirmação, e tratá-las
 * igual abriria posição na ausência de evidência.
 */
export function decidir(
  p: Pontas | null,
  margemPp: number = MARGEM_EXIGIDA_PP,
): Decisao {
  if (p === null) {
    return { abre: false, lado: null, basePct: null, sobraPct: null,
             porque: "pontas não lidas — não medido não é aprovado" };
  }
  const b = basePct(p);
  if (b === null) {
    return { abre: false, lado: null, basePct: null, sobraPct: null,
             porque: "preço inválido em uma das pontas" };
  }

  const sobraPct = Math.abs(b) - CUSTO_DO_CICLO_PCT;
  const lado = b > 0 ? "vender_perp" as const : "comprar_perp" as const;

  if (sobraPct < margemPp) {
    return {
      abre: false, lado, basePct: b, sobraPct,
      porque: `base ${b.toFixed(3)}% deixa ${sobraPct.toFixed(3)}pp depois das 4 `
        + `pernas (${CUSTO_DO_CICLO_PCT.toFixed(2)}%), abaixo da margem `
        + `${margemPp.toFixed(2)}pp — operar no empate é pagar risco por nada`,
    };
  }
  return {
    abre: true, lado, basePct: b, sobraPct,
    porque: `base ${b.toFixed(3)}% deixa ${sobraPct.toFixed(3)}pp depois das 4 pernas`,
  };
}
