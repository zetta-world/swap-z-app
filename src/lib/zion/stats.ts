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

/**
 * Correlação de Pearson entre duas séries do MESMO comprimento.
 *
 * Mora aqui pelo mesmo motivo da mediana: `benchmarks.ts` já tinha uma cópia
 * privada, e o estudo de funding precisava de outra. Duas cópias da mesma
 * fórmula é como nasceram os onze pontos de discordância de 04/08.
 *
 * Devolve 0 quando alguma das séries é constante — variância zero não tem
 * correlação definida, e 0 ("não sei dizer") é menos perigoso que null virando
 * um buraco na média de pares.
 */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Correlação média par a par de séries JÁ EM FORMA DE TAXA/RETORNO.
 *
 * ⚠️ Diferente de `meanPairwiseCorrelation` do `benchmarks.ts`, que recebe
 * PREÇOS e converte para retornos antes de correlacionar. Aqui a série já é a
 * grandeza certa (funding é uma taxa, não um nível) e converter de novo seria
 * medir a variação da variação.
 *
 * A distinção parece pedante e não é: correlacionar níveis em vez de retornos
 * infla a correlação para perto de 1 quase sempre, e o número de apostas
 * independentes despenca sem motivo real.
 */
export function meanPairwiseRateCorrelation(series: number[][]): number | null {
  const usaveis = series.filter((s) => s.length > 10);
  if (usaveis.length < 2) return null;
  const menor = Math.min(...usaveis.map((s) => s.length));
  const cortadas = usaveis.map((s) => s.slice(s.length - menor));
  let soma = 0, pares = 0;
  for (let i = 0; i < cortadas.length; i++) {
    for (let j = i + 1; j < cortadas.length; j++) { soma += pearson(cortadas[i], cortadas[j]); pares++; }
  }
  return pares > 0 ? soma / pares : null;
}
