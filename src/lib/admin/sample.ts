/**
 * HONESTIDADE DE AMOSTRA — o número ao lado do número.
 *
 * POR QUE ISTO EXISTE (crítica do dono, 01/08):
 *
 * O painel do Valhalla mostrava cinco mesas lado a lado, com o mesmo peso
 * visual:
 *
 *     SAGA            +1,19%
 *     VÖLVA · Mistral +0,72%
 *     VÖLVA · Kimi    +0,64%
 *     VEÐRFÖLNIR      +0,03%
 *     HEIMDALL        +0,44%
 *
 * As amostras por trás desses cinco números eram 3, 5, 2, 14 e 268.
 *
 * SAGA "lucrou" porque UM trade deu certo. VÖLVA·Kimi aparece no positivo com
 * ZERO ganhos — uma expirada fechou acima e carregou a média de DUAS
 * observações. VEÐRFÖLNIR é 7 ganhos e 7 perdas, ou seja, cara-ou-coroa exibido
 * como resultado.
 *
 * O dono olhou aquilo e perguntou de onde vinha o lucro. A pergunta certa era
 * outra: quantas vezes isso aconteceu? E a tela não respondia, porque não
 * mostrava a amostra em lugar nenhum.
 *
 * É a regra da casa — `inconclusivo ≠ aprovado` — sendo violada dentro de casa.
 * A bancada recusa aprovar o que não conseguiu testar; o laboratório exibia
 * ruído com a mesma tinta de um resultado.
 *
 * A REGRA AQUI: todo número derivado de amostra carrega o `n` ao lado, e abaixo
 * do limiar ele muda de cor. Não some — sumir esconderia que a mesa existe e
 * está sendo medida. Fica visível E desqualificado, que é a única forma de
 * dizer "ainda não sei" sem mentir para nenhum dos lados.
 */

/**
 * Abaixo disto, a média é ruído.
 *
 * Trinta não é sagrado, mas é onde a média amostral começa a se comportar de
 * forma estável para distribuições com a assimetria de um bracket de trade. O
 * limiar da BARRA DE LANÇAMENTO é bem mais alto (100 decididos) de propósito:
 * aqui a pergunta é "posso ler este número?", lá é "posso apostar dinheiro de
 * gente nele?" — e essa segunda exige muito mais.
 */
export const NOISE_THRESHOLD = 30;

export type SampleGrade = "noise" | "thin" | "solid";

/**
 * `noise` — não dá para ler; `thin` — dá para desconfiar; `solid` — dá para
 * discutir. Nenhum dos três significa "provado": mesmo `solid` é evidência
 * fraca no padrão da barra de lançamento.
 */
export function gradeSample(decided: number, threshold = NOISE_THRESHOLD): SampleGrade {
  if (decided < threshold) return "noise";
  if (decided < threshold * 3) return "thin";
  return "solid";
}

/** O `n` como o operador lê: sempre presente, nunca escondido. */
export function sampleLabel(decided: number, threshold = NOISE_THRESHOLD): string {
  return decided < threshold ? `n=${decided} · ruído` : `n=${decided}`;
}

/**
 * Um número de desempenho só deve ser PINTADO (verde/vermelho) quando a amostra
 * sustenta a leitura. Abaixo do limiar ele sai em cinza — presente, legível, e
 * visivelmente sem autoridade.
 *
 * Pintar de verde um +1,19% que veio de três trades é o mesmo erro do selo de
 * segurança que era constante: produz confiança sem produzir garantia.
 */
export function shouldTint(decided: number, threshold = NOISE_THRESHOLD): boolean {
  return decided >= threshold;
}
