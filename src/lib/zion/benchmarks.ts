/**
 * O QUE TERIA DADO LUCRO — estratégias canônicas medidas na mesma janela.
 *
 * ⚠️ POR QUE PARAR DE AJUSTAR A BIBLIOTECA E MEDIR OUTRA COISA (04/08).
 *
 * O dono disse duas frases que valem mais que a semana inteira de ajustes:
 *
 *   "o normal do mercado é isso, traders conseguem lucrar com consistência em
 *    queda e em subida"
 *   "todas as moedas seguem um padrão de movimento, principalmente as majors"
 *
 * A primeira aponta o buraco estrutural: a biblioteca é LONG-ONLY. Num mercado
 * que caiu 18%, ela está proibida de fazer a única coisa que teria funcionado.
 * Ajustar RR, stop e alvo dentro dessa restrição é rearranjar móveis.
 *
 * A segunda aponta um erro de MEDIÇÃO nosso: se as moedas andam juntas, 350
 * trades em 10 símbolos não são 350 observações independentes. São ~35
 * repetidas dez vezes. Todo intervalo de confiança que eu calculei nesta semana
 * está estreito demais.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A REGRA QUE GOVERNA ESTE MÓDULO:
 *
 *   ESTRATÉGIA CANÔNICA, PARÂMETRO REDONDO, NENHUM AJUSTE.
 *
 * Cada uma aqui é de livro — média móvel, canal de Donchian, RSI — com o
 * parâmetro clássico (50, 20, 14). Não porque sejam ótimos, mas porque NÃO
 * FORAM ESCOLHIDOS POR MIM olhando estes dados. No momento em que eu varrer
 * parâmetros procurando o melhor, o resultado vira sobreajuste com aparência de
 * descoberta — e este projeto já produziu esse tipo de número uma vez.
 *
 * O ponto não é achar a estratégia vencedora. É responder uma pergunta binária:
 * ALGUMA coisa simples extraía lucro dessas janelas? Se sim, sabemos onde
 * procurar. Se não, a resposta honesta é que o mercado dessas janelas não pagava
 * quem opera assim — e nenhum ajuste na nossa biblioteca mudaria isso.
 */

import type { Candle } from "@/lib/api/market-indicators";

/** O mesmo custo do resto do laboratório — ida e volta, taxa + slippage. */
const COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);

export interface BenchmarkResult {
  name: string;
  /** O que a estratégia faz, em uma linha — para a tela não virar sopa de sigla. */
  what: string;
  /** Retorno TOTAL da janela, em %, com custo em cada troca de posição. */
  totalPct: number;
  trades: number;
  /** Fração do tempo com posição aberta. Uma estratégia que só fica 5% do tempo
   *  exposta e rende 3% é MUITO diferente de uma que fica 100% para o mesmo 3%. */
  exposurePct: number;
  /** A maior queda do pico ao vale da curva — o que dói de verdade. */
  maxDrawdownPct: number;
  /** Opera vendido? Separa o que é possível hoje do que exigiria mudar a mesa. */
  usesShort: boolean;
}

/** Média simples das últimas `n` — sem olhar adiante, por construção. */
function sma(closes: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i + 1 - n; k <= i; k++) s += closes[k];
  return s / n;
}

/**
 * Roda uma sequência de POSIÇÕES DESEJADAS (+1 comprado, −1 vendido, 0 fora)
 * sobre a série e devolve o resultado com custo a cada TROCA.
 *
 * O sinal da barra `i` é aplicado ao retorno da barra `i+1`. Isso não é
 * detalhe: aplicar ao retorno da própria barra `i` seria decidir com o
 * fechamento que ainda não aconteceu — o lookahead clássico, e o que faz
 * qualquer estratégia parecer genial.
 */
export function runPositions(
  closes: number[], desired: Array<-1 | 0 | 1>, costPct = COST_PCT,
): { totalPct: number; trades: number; exposurePct: number; maxDrawdownPct: number } {
  let equity = 1, pico = 1, maxDd = 0, trades = 0, barrasExpostas = 0;
  let pos: -1 | 0 | 1 = 0;

  for (let i = 0; i < closes.length - 1; i++) {
    const quer = desired[i];
    if (quer !== pos) {
      // Trocar de posição custa. Sair de comprado e entrar em vendido são DUAS
      // pernas — o custo dobra, e ignorar isso é o jeito mais comum de um
      // backtest de trend-following mentir.
      const pernas = Math.abs(quer - pos);
      equity *= 1 - (costPct / 100) * pernas;
      trades++;
      pos = quer;
    }
    if (pos !== 0) barrasExpostas++;
    const ret = (closes[i + 1] - closes[i]) / closes[i];
    equity *= 1 + ret * pos;
    if (equity > pico) pico = equity;
    const dd = (pico - equity) / pico;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    totalPct: (equity - 1) * 100,
    trades,
    exposurePct: closes.length > 1 ? (barrasExpostas / (closes.length - 1)) * 100 : 0,
    maxDrawdownPct: maxDd * 100,
  };
}

/** RSI de Wilder — o mesmo do resto da casa, para não haver duas verdades. */
function rsiSeries(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let ganho = 0, perda = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ganho += d; else perda -= d;
  }
  let mg = ganho / period, mp = perda / period;
  out[period] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, p = d < 0 ? -d : 0;
    mg = (mg * (period - 1) + g) / period;
    mp = (mp * (period - 1) + p) / period;
    out[i] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
  }
  return out;
}

/**
 * As estratégias canônicas, sobre UMA série.
 *
 * `warmup` é quantas barras iniciais existem só para os indicadores nascerem —
 * elas não geram posição, e o resultado é medido só dali para a frente.
 */
export function runBenchmarks(candles: Candle[], warmup = 60, costPct = COST_PCT): BenchmarkResult[] {
  const closes = candles.map((c) => c.close);
  if (closes.length < warmup + 20) return [];
  const n = closes.length;
  const fora = (): Array<-1 | 0 | 1> => new Array(n).fill(0);

  // ── 1. Comprar e segurar: o denominador de tudo.
  const bh = fora();
  for (let i = warmup; i < n; i++) bh[i] = 1;

  // ── 2. Média 50, SÓ COMPRADO. É o que a nossa biblioteca poderia fazer hoje.
  const ma50Long = fora();
  for (let i = warmup; i < n; i++) {
    const m = sma(closes, i, 50);
    ma50Long[i] = m != null && closes[i] > m ? 1 : 0;
  }

  // ── 3. Média 50, COMPRADO E VENDIDO. É o que um trader de verdade faria, e
  //      o que a mesa NÃO pode fazer hoje. A diferença entre 2 e 3 é o preço
  //      exato da restrição long-only, em número.
  const ma50LS = fora();
  for (let i = warmup; i < n; i++) {
    const m = sma(closes, i, 50);
    ma50LS[i] = m == null ? 0 : closes[i] > m ? 1 : -1;
  }

  // ── 4. Canal de Donchian 20 (estilo Turtle), comprado e vendido.
  const don = fora();
  for (let i = warmup; i < n; i++) {
    const jan = candles.slice(i - 20, i);
    if (jan.length < 20) continue;
    const alta = Math.max(...jan.map((c) => c.high));
    const baixa = Math.min(...jan.map((c) => c.low));
    don[i] = closes[i] >= alta ? 1 : closes[i] <= baixa ? -1 : don[i - 1] ?? 0;
  }

  // ── 5. Reversão à média: compra RSI<30, sai em RSI>50. Só comprado.
  const rsi = rsiSeries(closes);
  const mr = fora();
  for (let i = warmup; i < n; i++) {
    const r = rsi[i];
    const anterior = mr[i - 1] ?? 0;
    mr[i] = r == null ? 0 : r < 30 ? 1 : r > 50 ? 0 : anterior;
  }

  const corta = <T>(a: T[]) => a.slice(warmup);
  const c = corta(closes);

  return [
    { key: bh, name: "comprar e segurar", what: "fica comprado a janela inteira", short: false },
    { key: ma50Long, name: "média 50 · só comprado", what: "comprado acima da média, FORA abaixo", short: false },
    { key: ma50LS, name: "média 50 · comprado e VENDIDO", what: "comprado acima da média, vendido abaixo", short: true },
    { key: don, name: "canal 20 · comprado e VENDIDO", what: "rompeu a máxima de 20 compra, a mínima vende", short: true },
    { key: mr, name: "reversão à média (RSI)", what: "compra RSI abaixo de 30, sai acima de 50", short: false },
  ].map(({ key, name, what, short }) => ({
    name, what, usesShort: short,
    ...runPositions(c, corta(key), costPct),
  }));
}

/**
 * O QUANTO AS MOEDAS ANDAM JUNTAS — e por que isso muda a leitura de tudo.
 *
 * O dono: "todas as moedas seguem um padrão de movimento, principalmente as
 * majors". Se for verdade, dez símbolos não são dez apostas — são uma aposta
 * repetida dez vezes, e a nossa amostra "de 350 trades" vale muito menos do que
 * o número sugere.
 *
 * Correlação de Pearson entre os retornos diários, par a par. Devolve a média —
 * perto de 1 quer dizer "é tudo a mesma coisa com nome diferente".
 */
export function meanPairwiseCorrelation(series: number[][]): number | null {
  const rets = series
    .map((s) => s.slice(1).map((v, i) => (v - s[i]) / s[i]))
    .filter((r) => r.length > 10);
  if (rets.length < 2) return null;
  const menor = Math.min(...rets.map((r) => r.length));
  const cortados = rets.map((r) => r.slice(r.length - menor));

  const corr = (a: number[], b: number[]): number => {
    const ma = a.reduce((x, y) => x + y, 0) / a.length;
    const mb = b.reduce((x, y) => x + y, 0) / b.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  };

  let soma = 0, pares = 0;
  for (let i = 0; i < cortados.length; i++) {
    for (let j = i + 1; j < cortados.length; j++) {
      soma += corr(cortados[i], cortados[j]);
      pares++;
    }
  }
  return pares > 0 ? soma / pares : null;
}

/**
 * Quantas observações INDEPENDENTES existem, de verdade, numa amostra de
 * símbolos correlacionados.
 *
 * Aproximação clássica: com N séries de correlação média ρ, o número efetivo é
 * N / (1 + (N−1)ρ). Com dez símbolos a ρ=0.8, dez viram 1.2.
 *
 * Isto não é preciosismo estatístico: é a diferença entre "350 trades, sabemos
 * bem" e "o equivalente a 40 trades, não sabemos quase nada".
 */
export function effectiveSampleSize(n: number, rho: number | null): number {
  if (rho == null || n <= 1) return n;
  const r = Math.max(0, Math.min(0.999, rho));
  return n / (1 + (n - 1) * r);
}
