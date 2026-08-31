import { fracaoDoPedagio } from "@/lib/celeiro/taxas";
import { stopPorVolatilidade, MULTIPLO_DO_RUIDO } from "@/lib/celeiro/regime";
import { MARE_MINIMA_PCT } from "@/lib/zion/comprar-e-segurar";

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

/**
 * ⚠️⚠️ A TERCEIRA PERGUNTA: E SE EU NÃO FIZESSE NADA?
 *
 * `comprar-e-segurar.ts` nasceu em 20/08 porque o painel sabia dizer *"está
 * lucrando"* e não sabia dizer *"está lucrando MENOS que parado"* — que é a
 * frase que decide. Em 29/08 ela mediu que **cinco de seis mesas perderam para
 * não fazer nada**, por 3 a 21 pontos percentuais.
 *
 * ⚠️ MAS AQUI A COMPARAÇÃO NÃO É A MESMA, E FINGIR QUE É SERIA MENTIR. Lá, os
 * dois lados são REALIZADOS: o que a mesa fez contra o que segurar teria dado.
 * Aqui, segurar é realizado e o alvo é INTENÇÃO — ele pode não ser tocado, e
 * geralmente não é em metade das vezes.
 *
 * Por isso esta função **não emite veredito**. Ela põe os dois números lado a
 * lado e deixa a conclusão com quem está olhando. Chamar de "bateu segurar" um
 * alvo que ainda não aconteceu seria exatamente o tipo de afirmação sobre o não
 * medido que este repositório passou o dia caçando.
 */
export function contraSegurar(
  alvoPct: number | null,
  velas: ReadonlyArray<{ close: number }>,
  rotuloJanela: string,
): LeituraDoCusto {
  if (alvoPct == null || !(alvoPct > 0)) {
    return { severidade: "sem_dado", fracao: null, texto: "" };
  }
  const usaveis = velas.filter((c) => c.close > 0);
  if (usaveis.length < 2) {
    return { severidade: "sem_dado", fracao: null,
             texto: "janela curta demais para medir o que segurar teria dado" };
  }
  const primeiro = usaveis[0].close, ultimo = usaveis[usaveis.length - 1].close;
  const segurarPct = (ultimo - primeiro) / primeiro * 100;

  /**
   * ⚠️ MERCADO DE LADO É UMA JANELA EM QUE A PERGUNTA NÃO SE APLICA — a mesma
   * guarda de `MARE_MINIMA_PCT`, reusada em vez de reinventada. Sem ela, uma
   * referência minúscula no denominador produziria "capturou 4.000% da maré".
   */
  if (Math.abs(segurarPct) < MARE_MINIMA_PCT) {
    return { severidade: "sem_dado", fracao: null,
             texto: `segurar rendeu ${segurarPct.toFixed(2)}% em ${rotuloJanela} — de lado demais para a comparação valer` };
  }

  const fatia = alvoPct / segurarPct;
  const base = `segurar rendeu ${segurarPct.toFixed(1)}% em ${rotuloJanela}; seu alvo é ${alvoPct.toFixed(1)}%`;

  /**
   * ⚠️ SEGURAR CAINDO É O CASO EM QUE UM ALVO DE ALTA JÁ SE JUSTIFICA — não há
   * o que "bater". Dizer o contrário inverteria o sinal da leitura.
   */
  if (segurarPct < 0) {
    return { severidade: "ok", fracao: fatia, texto: `${base} — segurar perdeu dinheiro nesta janela` };
  }
  if (fatia < 1) {
    return { severidade: "atencao", fracao: fatia,
             texto: `${base}, ou ${(fatia * 100).toFixed(0)}% do que não fazer nada já daria` };
  }
  return { severidade: "ok", fracao: fatia, texto: base };
}
