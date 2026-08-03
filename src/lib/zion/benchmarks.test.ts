import { describe, it, expect } from "vitest";
import {
  runPositions, runBenchmarks, meanPairwiseCorrelation, effectiveSampleSize,
} from "@/lib/zion/benchmarks";
import type { Candle } from "@/lib/api/market-indicators";

/**
 * O QUE TERIA DADO LUCRO — e as armadilhas de medir isso.
 *
 * O dono apontou o buraco estrutural: "traders conseguem lucrar com
 * consistência em queda e em subida". A biblioteca é long-only, e num mercado
 * que caiu 18% ela está proibida de fazer a única coisa que teria funcionado.
 *
 * E apontou um erro de medição nosso: "todas as moedas seguem um padrão de
 * movimento". Se andam juntas, 350 trades em 10 símbolos não são 350
 * observações — e todo intervalo de confiança desta semana está estreito demais.
 *
 * Estes testes guardam as três propriedades sem as quais o estudo mentiria.
 */

const serie = (closes: number[]): Candle[] =>
  closes.map((c) => ({ high: c * 1.005, low: c * 0.995, close: c, volume: 1000 }));

describe("o motor de posições", () => {
  it("NÃO olha o futuro: o sinal da barra i rende na barra i+1", () => {
    // Esta é a propriedade que separa backtest de ficção. Aplicar o sinal ao
    // retorno da própria barra seria decidir com o fechamento que ainda não
    // aconteceu — e faz qualquer estratégia parecer genial.
    const closes = [100, 110, 100];
    // Comprado só na ÚLTIMA barra: não há barra seguinte, então não rende nada.
    const r = runPositions(closes, [0, 0, 1], 0);
    expect(r.totalPct).toBeCloseTo(0, 6);

    // Comprado na primeira: colhe o movimento da primeira para a segunda.
    const r2 = runPositions(closes, [1, 0, 0], 0);
    expect(r2.totalPct).toBeCloseTo(10, 4);
  });

  it("VENDIDO ganha na queda — é o que a mesa não pode fazer hoje", () => {
    const r = runPositions([100, 90, 81], [-1, -1, 0], 0);
    expect(r.totalPct).toBeGreaterThan(0);
  });

  it("inverter de comprado para vendido custa DUAS pernas", () => {
    // Ignorar isso é o jeito mais comum de um backtest de trend-following
    // mentir: cada reversão paga entrada E saída, não uma só.
    const semCusto = runPositions([100, 100, 100], [1, -1, 0], 0);
    const comCusto = runPositions([100, 100, 100], [1, -1, 0], 1);
    // Preço parado: a diferença é SÓ custo. Uma perna na entrada + duas na
    // inversão = 3% com custo de 1% por perna.
    expect(semCusto.totalPct).toBeCloseTo(0, 6);
    expect(comCusto.totalPct).toBeLessThan(-2.5);
  });

  it("mede EXPOSIÇÃO — render 3% ficando fora 95% do tempo não é o mesmo que render 3% sempre exposto", () => {
    const sempre = runPositions([100, 101, 102, 103], [1, 1, 1, 1], 0);
    const quase_nunca = runPositions([100, 101, 102, 103], [1, 0, 0, 0], 0);
    expect(sempre.exposurePct).toBe(100);
    expect(quase_nunca.exposurePct).toBeLessThan(50);
  });

  it("mede o TOMBO, não só o resultado final", () => {
    // Uma curva que termina em +10% depois de cair 40% no meio não é a mesma
    // coisa que uma que sobe reto. Quem opera dinheiro sai no tombo.
    const r = runPositions([100, 60, 110], [1, 1, 0], 0);
    expect(r.maxDrawdownPct).toBeGreaterThan(35);
  });
});

describe("as estratégias canônicas", () => {
  const alta = serie(Array.from({ length: 200 }, (_, i) => 100 * Math.exp(i / 400)));
  const queda = serie(Array.from({ length: 200 }, (_, i) => 200 * Math.exp(-i / 400)));

  it("em ALTA limpa, comprar e segurar ganha", () => {
    const r = runBenchmarks(alta)!.find((x) => x.name === "comprar e segurar")!;
    expect(r.totalPct).toBeGreaterThan(0);
  });

  it("em QUEDA limpa, comprar e segurar perde e o VENDIDO ganha", () => {
    // Esta é a frase do dono virando teste: o mesmo mercado paga quem pode
    // vender e pune quem só pode comprar.
    const rs = runBenchmarks(queda);
    const bh = rs.find((x) => x.name === "comprar e segurar")!;
    const ls = rs.find((x) => x.usesShort)!;
    expect(bh.totalPct).toBeLessThan(0);
    expect(ls.totalPct).toBeGreaterThan(bh.totalPct);
  });

  it("série curta demais devolve lista vazia em vez de número inventado", () => {
    expect(runBenchmarks(serie([100, 101, 102]))).toEqual([]);
  });

  it("toda estratégia declara se usa VENDIDO", () => {
    // A diferença entre as que usam e as que não usam É o preço da restrição
    // long-only, e ela precisa estar visível na tela, não no código.
    const rs = runBenchmarks(alta);
    expect(rs.some((r) => r.usesShort)).toBe(true);
    expect(rs.some((r) => !r.usesShort)).toBe(true);
  });
});

describe("as moedas andam juntas?", () => {
  // A correlação é dos RETORNOS, não dos preços — e a diferença pega quem não
  // presta atenção. Duas retas opostas (100+i e 100−i) têm retornos que
  // encolhem JUNTOS em módulo, e saem com correlação POSITIVA de 0.98. A
  // fixture ingênua testaria o oposto do que pretende.
  const passos = [0.02, -0.01, 0.03, -0.02, 0.01, 0.015, -0.025, 0.005, -0.012, 0.018, -0.008, 0.022];
  const daRetornos = (rets: number[], p0 = 100) => {
    const out = [p0];
    for (const r of rets) out.push(out[out.length - 1] * (1 + r));
    return out;
  };

  it("séries idênticas dão correlação 1", () => {
    const s = daRetornos(passos);
    expect(meanPairwiseCorrelation([s, s])).toBeCloseTo(1, 6);
  });

  it("séries com retornos ESPELHADOS dão correlação −1", () => {
    // Espelhar os RETORNOS é o que significa "anda ao contrário". Quando uma
    // sobe 2%, a outra cai 2% no mesmo passo.
    const a = daRetornos(passos);
    const b = daRetornos(passos.map((r) => -r));
    expect(meanPairwiseCorrelation([a, b])!).toBeCloseTo(-1, 3);
  });

  it("série curta demais não vira correlação — devolve null", () => {
    // Menos de dez retornos é ruído com aparência de relação.
    expect(meanPairwiseCorrelation([[100, 101], [100, 99]])).toBeNull();
  });

  it("dez símbolos muito correlacionados NÃO são dez apostas", () => {
    // A conta que muda a leitura de tudo: com ρ=0.8, dez viram ~1.2. Uma
    // amostra de 350 trades passa a valer o que valeria uma de ~42.
    expect(effectiveSampleSize(10, 0.8)).toBeCloseTo(10 / (1 + 9 * 0.8), 5);
    expect(effectiveSampleSize(10, 0.8)).toBeLessThan(1.5);
  });

  it("sem correlação, dez símbolos são dez apostas", () => {
    expect(effectiveSampleSize(10, 0)).toBe(10);
  });

  it("sem medição, não encolhe a amostra — ausência não vira penalidade", () => {
    expect(effectiveSampleSize(10, null)).toBe(10);
  });
});
