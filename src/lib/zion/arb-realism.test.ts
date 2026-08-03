import { describe, it, expect } from "vitest";
import { vwapBuy, vwapSell, assessRealism, realismGate, type Realism, type Level } from "@/lib/zion/arb-realism";

describe("arb-realism — depth-walking (F2)", () => {
  it("vwapBuy: fills at top price when depth is deep", () => {
    const asks: Level[] = [[100, 1000], [101, 1000]]; // $100k available at 100
    const r = vwapBuy(asks, 5000); // buy $5k
    expect(r.avgPrice).toBeCloseTo(100);
    expect(r.baseFilled).toBeCloseTo(50);
    expect(r.fullyFilled).toBe(true);
  });

  it("vwapBuy: walks UP the book when the top level is thin", () => {
    const asks: Level[] = [[100, 10], [110, 1000]]; // only $1000 at 100, rest at 110
    const r = vwapBuy(asks, 5000); // $1000@100 (10 base) + $4000@110 (36.36 base)
    expect(r.avgPrice).toBeGreaterThan(100);
    expect(r.avgPrice).toBeLessThan(110);
    expect(r.fullyFilled).toBe(true);
  });

  it("vwapBuy: fullyFilled=false when the book can't cover the size", () => {
    const r = vwapBuy([[100, 1]], 5000); // only $100 of depth
    expect(r.fullyFilled).toBe(false);
  });

  it("assessRealism: deep book → realistic ≈ theoretical (little slippage)", () => {
    const asks: Level[] = [[100, 100000]];
    const bids: Level[] = [[100.5, 100000]];
    // theoretical spread 0.5%, cost 0.4%
    const a = assessRealism(asks, bids, 50, 0.5, 0.4);
    expect(a.fullyFilled).toBe(true);
    expect(a.realisticNetPct).toBeCloseTo(0.1, 2);
    expect(a.slippagePct).toBeCloseTo(0, 2);
  });

  it("assessRealism: THIN book turns a paper win into a real LOSS", () => {
    // Top-of-book says 0.8% spread, but depth is shallow: buying $50 walks the
    // asks up and selling walks the bids down → realistic spread collapses.
    const asks: Level[] = [[100, 0.2], [100.5, 0.2], [101.5, 5]];   // ~$20 then jumps
    const bids: Level[] = [[100.8, 0.2], [100.2, 0.2], [99, 5]];    // ~$20 then drops
    const a = assessRealism(asks, bids, 50, 0.8, 0.4);
    // paper (top-of-book) net was +0.4%; depth eats it
    expect(a.theoreticalNetPct).toBeCloseTo(0.4, 2);
    expect(a.realisticNetPct).toBeLessThan(a.theoreticalNetPct);
    expect(a.slippagePct).toBeGreaterThan(0);
  });
});

/**
 * O PORTÃO — o que faltava para 4.085 medições corretas valerem alguma coisa.
 *
 * `assessRealism` rodou desde 28/07 e mediu, ao vivo:
 *
 *   teórico médio (o que o paper contabilizava)   +0.451%
 *   realista médio (andando o livro)              −0.629%
 *   slippage médio                                 1.081%
 *   ainda positivos depois da profundidade        17 de 4.085
 *
 * A mesa abriu posição todas as vezes. O comentário da chamada dizia, com
 * todas as letras, "never blocks booking": a sonda foi construída como
 * observação, a ponte para o dinheiro real, e a ponte nunca foi atravessada.
 *
 * Uma medição que não muda decisão nenhuma não é medição, é decoração.
 */
describe("o portão de profundidade", () => {
  const r = (over: Partial<Realism> = {}): Realism => ({
    theoreticalNetPct: 0.45, realisticNetPct: -0.63, slippagePct: 1.08, fullyFilled: true, ...over,
  });

  it("VETA o caso real medido: topo prometia +0.45%, livro entrega −0.63%", () => {
    const g = realismGate(r(), 0.15);
    expect(g.book).toBe(false);
    expect(g.reason).toContain("1.080");   // a profundidade que comeu o spread
  });

  it("livro NÃO LIDO reprova — não medido não é aprovado", () => {
    // A alternativa seria abrir na ausência de evidência, que é exatamente o
    // hábito que produziu os $304 de lucro fictício.
    const g = realismGate(null, 0.15);
    expect(g.book).toBe(false);
    expect(g.reason).toContain("não medido");
  });

  it("livro sem profundidade para o tamanho reprova — é resposta, não falha", () => {
    // Significa que o preço de topo não existe no tamanho que a mesa opera.
    // Abrir aqui seria comprar a cotação, não a liquidez.
    expect(realismGate(r({ fullyFilled: false, realisticNetPct: 5 }), 0.15).book).toBe(false);
  });

  it("LIBERA quando o líquido sobrevive à profundidade", () => {
    // O portão não é um "não" com aparência de método: quando o spread é real
    // e o livro aguenta, ele deixa passar.
    const g = realismGate(r({ realisticNetPct: 0.31, slippagePct: 0.14 }), 0.15);
    expect(g.book).toBe(true);
  });

  it("o piso é o MESMO mínimo líquido da mesa, aplicado ao número REAL", () => {
    // Aplicar um piso mais frouxo aqui recriaria o problema num degrau abaixo.
    expect(realismGate(r({ realisticNetPct: 0.149 }), 0.15).book).toBe(false);
    expect(realismGate(r({ realisticNetPct: 0.151 }), 0.15).book).toBe(true);
  });

  it("o motivo do veto carrega os TRÊS números, não só o veredito", () => {
    // Quem lê o evento precisa poder refazer a conta sem abrir o código.
    const g = realismGate(r(), 0.15);
    expect(g.reason).toContain("-0.630");
    expect(g.reason).toContain("0.15");
    expect(g.reason).toContain("0.450");
  });
});
