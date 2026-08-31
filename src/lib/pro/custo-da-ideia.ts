import { fracaoDoPedagio } from "@/lib/celeiro/taxas";
import { stopPorVolatilidade, MULTIPLO_DO_RUIDO } from "@/lib/celeiro/regime";

/**
 * O CUSTO DA IDEIA — as duas perguntas que o trader tem antes de clicar, e que
 * nenhum terminal do mercado responde.
 *
 * ⚠️⚠️ ESTE MÓDULO NÃO INVENTA CONTA NENHUMA. Ele compõe duas medições que já
 * existem nesta casa, cada uma paga com cicatriz:
 *
 *   `fracaoDoPedagio`      matou o `maker_de_faixa`, que acertava 70% das vezes
 *                          e perdia dinheiro. O alvo de ±0,6% entregava 37% do
 *                          movimento bruto para a corretora antes de o preço se
 *                          mexer, e o placar não sabia dizer isso.
 *
 *   `stopPorVolatilidade`  nasceu de três entradas mortas no mesmo minuto,
 *                          todas no SOL, todas em exatamente −1,200%. O stop
 *                          estava DENTRO do ruído: 39,6% das janelas de 1,5h o
 *                          tocam sem tendência nenhuma.
 *
 * O DEXTools mostra o mercado. Isto mostra **a decisão** — e é a única frente em
 * que temos vantagem, porque a máquina de medir já estava pronta.
 */

export type Severidade = "ok" | "atencao" | "grave" | "sem_dado";

export interface LeituraDoCusto {
  severidade: Severidade;
  /** A frase da tela. Nunca afirma quando falta insumo. */
  texto: string;
  /** A fração do alvo que vira taxa (0 a 1+). `null` = não deu para medir. */
  fracao: number | null;
}

/**
 * ⚠️ ONDE O PEDÁGIO DEIXA DE SER DETALHE.
 *
 * Um terço do alvo em taxa é o ponto em que o acerto de direção precisa ser
 * excepcional só para empatar; metade é onde nenhuma taxa de acerto desta casa
 * jamais chegou. Os dois números vêm da nota do `regime.ts`, que varreu o
 * múltiplo do pedágio em 166 dias.
 */
export const PEDAGIO_ATENCAO = 1 / 3;
export const PEDAGIO_GRAVE   = 1 / 2;

/**
 * Quanto do alvo vira taxa.
 *
 * @param taxaPernaPct  taxa de UMA perna, em % (ida-e-volta é 2×)
 * @param alvoPct       distância até o alvo, em % do preço de entrada
 */
export function pedagioSobreAlvo(taxaPernaPct: number | null, alvoPct: number | null): LeituraDoCusto {
  if (taxaPernaPct == null || alvoPct == null || !(alvoPct > 0) || !(taxaPernaPct >= 0)) {
    return { severidade: "sem_dado", fracao: null,
             texto: "defina um alvo para ver quanto dele vira taxa" };
  }
  const f = fracaoDoPedagio(taxaPernaPct, alvoPct);
  if (f === null) {
    return { severidade: "sem_dado", fracao: null, texto: "alvo inválido" };
  }
  const pct = (f * 100).toFixed(0);
  if (f >= PEDAGIO_GRAVE) {
    return { severidade: "grave", fracao: f,
             texto: `${pct}% do alvo vai em taxa — acima da metade, e nenhuma mesa desta casa jamais teve acerto que pague isso` };
  }
  if (f >= PEDAGIO_ATENCAO) {
    return { severidade: "atencao", fracao: f,
             texto: `${pct}% do alvo vai em taxa antes de o preço se mexer` };
  }
  return { severidade: "ok", fracao: f, texto: `${pct}% do alvo em taxa` };
}

/**
 * O stop está dentro ou fora do ruído do ativo?
 *
 * ⚠️ REUSA `stopPorVolatilidade` EM VEZ DE REIMPLEMENTAR, e a diferença importa:
 * lá a função ALARGA o stop (é um piso do Celeiro); aqui ela só é consultada
 * para LER. O terminal não mexe na ordem de ninguém — informa e cala.
 */
export function stopContraRuido(
  stopPct: number | null,
  amplitudeMediaPct: number | null,
): LeituraDoCusto {
  if (stopPct == null || !(stopPct > 0)) {
    return { severidade: "sem_dado", fracao: null, texto: "defina um stop para comparar com o ruído" };
  }
  if (amplitudeMediaPct == null || !(amplitudeMediaPct > 0)) {
    return { severidade: "sem_dado", fracao: null,
             texto: "amplitude das velas não medida — sem ela não dá para dizer o que é ruído" };
  }
  const v = stopPorVolatilidade(amplitudeMediaPct, stopPct);
  const pedido = amplitudeMediaPct * MULTIPLO_DO_RUIDO;
  const razao = stopPct / amplitudeMediaPct;

  /**
   * ⚠️ `stopPct` MAIOR QUE O PEDIDO SIGNIFICA QUE JÁ ESTÁ FORA DO RUÍDO —
   * `stopPorVolatilidade` devolve o declarado sem alargar, e é esse o caso bom.
   */
  if (v.stopPct <= stopPct) {
    return { severidade: "ok", fracao: razao,
             texto: `${razao.toFixed(1)}× a amplitude média da vela — fora do ruído` };
  }
  const dentro = razao < 2;
  return {
    severidade: dentro ? "grave" : "atencao",
    fracao: razao,
    texto: `${razao.toFixed(1)}× a amplitude da vela — o ruído deste ativo pede `
      + `${pedido.toFixed(2)}%, e um stop dentro dele é tocado sem tendência nenhuma`,
  };
}

/**
 * A amplitude média das velas, em % — o insumo do ruído.
 *
 * ⚠️ (high−low)/close E NÃO |close−open|. O corpo da vela mede para onde ela
 * foi; a amplitude mede o quanto ela CHACOALHOU no caminho, e é o chacoalho que
 * arranca stop. Uma vela que abre e fecha no mesmo lugar depois de oscilar 2%
 * tem corpo zero e ruído enorme.
 */
export function amplitudeMediaPct(
  velas: ReadonlyArray<{ high: number; low: number; close: number }>,
  janela = 50,
): number | null {
  const ultimas = velas.slice(-janela).filter((c) => c.close > 0 && c.high >= c.low);
  if (ultimas.length === 0) return null;
  const soma = ultimas.reduce((s, c) => s + (c.high - c.low) / c.close * 100, 0);
  const media = soma / ultimas.length;
  return Number.isFinite(media) && media > 0 ? media : null;
}

/** A taxa de UMA perna a partir do rótulo do par ("0.05%"). `null` se ilegível. */
export function taxaDaPerna(feeTier: string | undefined | null): number | null {
  if (!feeTier) return null;
  const n = parseFloat(String(feeTier).replace("%", "").trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}
