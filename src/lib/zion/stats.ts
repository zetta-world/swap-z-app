/**
 * UMA definição de mediana para a casa inteira.
 *
 * ⚠️ DE ONDE ISTO VEIO (04/08).
 *
 * Duas rotas mediam a MESMA coisa — quanto o mercado andou nos últimos 174
 * dias, mediana do comprar-e-segurar dos mesmos 10 símbolos, no mesmo dia — e
 * responderam:
 *
 *   backtest da biblioteca   −17.99%
 *   "o que teria funcionado"  −6.74%
 *
 * Onze pontos de diferença, e nenhuma das duas estava com a janela errada
 * (isso já tinha sido consertado). A diferença era o que cada uma chamava de
 * mediana:
 *
 *   backtest      s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2     ← mediana
 *   what-worked   s[Math.floor(s.length / 2)]                   ← NÃO é
 *
 * Com dez símbolos, `s[5]` é o SEXTO menor — o de cima do meio, não o meio. Num
 * mercado disperso, onde a distância entre o 5º e o 6º símbolo é facilmente 20
 * pontos, isso não é arredondamento: é um viés SISTEMÁTICO PARA CIMA em toda
 * estratégia que aquela rota já reportou.
 *
 * E o viés cai do lado que engana: ele faz tudo parecer melhor do que foi. Os
 * números que eu apresentei como "o que teria dado lucro" estavam todos
 * inflados pelo mesmo lado, o que é pior que estarem errados ao acaso.
 *
 * A lição é a de sempre neste repo: duas implementações da mesma ideia viram
 * duas verdades. Uma função, um lugar, importada pelos dois.
 */

/** Mediana de verdade — resistente ao ponto único e absurdo, que a média não é. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
