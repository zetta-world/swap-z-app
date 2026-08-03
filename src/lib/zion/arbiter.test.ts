import { describe, it, expect } from "vitest";
import { findArbs, spreadWindow } from "@/lib/zion/arbiter";

const matrix = (entries: Record<string, Record<string, number>>) => {
  const m = new Map<string, Map<string, { priceUsd: number }>>();
  for (const [sym, venues] of Object.entries(entries)) {
    m.set(sym, new Map(Object.entries(venues).map(([v, p]) => [v, { priceUsd: p }])));
  }
  return m;
};

/**
 * ⚠️ AS FIXTURES DE DUAS VENUES FORAM TROCADAS POR TRÊS (03/08).
 *
 * Quatro testes daqui quebraram quando `MIN_VENUES` passou a 3, e eles estavam
 * certos em quebrar: documentavam o contrato antigo, em que um símbolo cotado
 * por duas praças era operável. Era esse contrato que deixava o buraco.
 *
 * Com duas cotações discordando não existe informação para decidir qual está
 * parada — a mesa escolhia a mais barata como referência, que é um chute com
 * cara de método. Foi por aí que 661 ciclos de ruído de feed entraram no ledger
 * como lucro.
 *
 * As propriedades continuam sendo as mesmas; o quórum é que subiu.
 */
describe("arbiter — pure spread detector", () => {
  it("books only spreads whose NET clears the floor", () => {
    const arbs = findArbs(matrix({
      // 1% gross − 0.4% cost = 0.6% net → passes
      SOL: { binance: 100, gateio: 101, okx: 100.5 },
      // 0.4% gross − 0.4% = 0% net → fails the 0.15 floor
      ETH: { binance: 1000, okx: 1004, mexc: 1002 },
    }), 0.4, 0.15, 3, 2, 3);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].symbol).toBe("SOL");
    expect(arbs[0].buyVenue).toBe("binance");
    expect(arbs[0].sellVenue).toBe("gateio");
    expect(arbs[0].netPct).toBeCloseTo(0.6, 5);
  });

  it("picks the widest venue pair when three quote the symbol", () => {
    const arbs = findArbs(matrix({ BTC: { kraken: 60000, binance: 60300, mexc: 60900 } }), 0.4, 0.15, 3, 2, 3);
    expect(arbs).toHaveLength(1);
    expect(arbs[0].buyVenue).toBe("kraken");
    expect(arbs[0].sellVenue).toBe("mexc");
    expect(arbs[0].spreadPct).toBeCloseTo(1.5, 5);
  });

  it("sorts opportunities best-net-first", () => {
    const arbs = findArbs(matrix({
      A: { x: 100, y: 100.7, z: 100.35 },   // 0.7 gross → 0.3 net
      B: { x: 100, y: 102, z: 101 },        // 2.0 gross → 1.6 net
    }), 0.4, 0.15, 3, 5, 3);
    expect(arbs.map((a) => a.symbol)).toEqual(["B", "A"]);
  });

  it("flags too-good-to-be-true spreads as suspect (the MATIC→POL / RNDR→RENDER stale-listing trap)", () => {
    const arbs = findArbs(matrix({
      MATIC: { coinbase: 0.0835, binance: 0.3794, kraken: 0.3799 }, // +354% "spread" = dead listing
      TON:   { binance: 1.585, okx: 1.60, mexc: 1.592 },            // 0.95% gross → real candidate
    }), 0.4, 0.15, 3, 400, 3);
    const matic = arbs.find((a) => a.symbol === "MATIC")!;
    const ton   = arbs.find((a) => a.symbol === "TON")!;
    expect(matic.suspect).toBe(true);   // detected but NEVER booked
    expect(ton.suspect).toBe(false);
  });

  it("drops a stale-quote outlier via the cross-venue median (3+ venues)", () => {
    const arbs = findArbs(matrix({
      // mexc is a corpse at ~-78% of the median → dropped; sobram 2 de 3, o que
      // agora reprova o símbolo INTEIRO (ver o teste do quórum abaixo).
      MATIC: { mexc: 0.0835, binance: 0.3794, okx: 0.3801 },
      // outlier dropped e ainda sobram 3 sãos que passam do piso
      SOL: { a: 100, b: 101, c: 100.4, morta: 250 },
    }), 0.4, 0.15, 3, 2, 3);
    expect(arbs.find((a) => a.symbol === "MATIC")).toBeUndefined();
    const sol = arbs.find((a) => a.symbol === "SOL")!;
    expect(sol.buyVenue).toBe("a");
    expect(sol.sellVenue).toBe("b");
    expect(sol.suspect).toBe(false);
  });

  it("fails closed: single venue, equal venues, or junk prices book nothing", () => {
    expect(findArbs(matrix({ SOL: { binance: 100 } }))).toHaveLength(0);                       // 1 venue
    expect(findArbs(matrix({ SOL: { a: 100, b: 100, c: 100 } }))).toHaveLength(0);             // no spread
    expect(findArbs(matrix({ SOL: { a: 0, b: -5, c: 0 } }))).toHaveLength(0);                  // junk
  });
});

/**
 * O QUÓRUM DE TRÊS TESTEMUNHAS (03/08).
 *
 * O filtro de mediana já existia e já só rodava com 3+ cotações — o comentário
 * do código dizia, em voz alta, que com duas "não dá para saber qual está
 * parada". E o código seguia operando com duas assim mesmo, protegido só pelo
 * teto bruto de 3%, que não pega desvio de 0.7%.
 *
 * A auditoria da coorte mediu a consequência: 661 ciclos, zero perdas, spread
 * médio de 0.72%, uma venue nos DOIS lados de 90% das pernas. A mesa estava
 * colhendo a variância do feed de uma corretora.
 */
describe("quórum de venues — duas testemunhas não bastam", () => {
  it("símbolo com 2 cotações é INOPERÁVEL, por maior que seja o spread", () => {
    // Este é o caso exato dos 0.7%: duas praças discordando, sem árbitro.
    const arbs = findArbs(matrix({ SOL: { gateio: 100.7, binance: 100 } }), 0.4, 0.15, 3, 2, 3);
    expect(arbs).toHaveLength(0);
  });

  it("com a terceira cotação, o mesmo símbolo volta a ser decidível", () => {
    // E o resultado muda de sentido: com binance e okx concordando, a gateio é
    // que está fora — e sai no corte de mediana em vez de virar contraparte.
    const arbs = findArbs(matrix({ SOL: { gateio: 100.7, binance: 100, okx: 100.02 } }), 0.4, 0.15, 3, 0.5, 3);
    expect(arbs).toHaveLength(0);
  });

  it("perder uma testemunha no corte de mediana reprova o símbolo", () => {
    // Sobrar 2 de 3 depois do corte é voltar ao caso de duas testemunhas pela
    // porta dos fundos — com o agravante de que uma já foi reprovada.
    const arbs = findArbs(matrix({ SOL: { a: 100, b: 101, morta: 5 } }), 0.4, 0.15, 3, 2, 3);
    expect(arbs).toHaveLength(0);
  });

  it("o quórum é configurável — e em 2 volta o comportamento antigo", () => {
    // Não para usar: para deixar explícito que a mudança é uma DECISÃO, e que
    // reverter é um ato consciente com um número, não um acidente.
    expect(findArbs(matrix({ SOL: { a: 100, b: 101 } }), 0.4, 0.15, 3, 2, 2)).toHaveLength(1);
  });
});

/**
 * A JANELA DE DISPARO — e a conclusão desconfortável.
 *
 * O teto caiu de 3% para 0.30% porque spread real entre CEXes grandes vive em
 * 0.01–0.05%. Só que o custo de ida-e-volta é 0.40% e o líquido mínimo 0.15%,
 * então o PISO para abrir é 0.55%.
 *
 * Piso acima do teto = janela vazia = a estratégia não tem trade neste custo.
 * Isso é o resultado, não um efeito colateral — e é melhor descobrir num ledger
 * de papel do que com dinheiro.
 */
describe("a janela entre o piso que paga e o teto do que é crível", () => {
  it("com o custo real da mesa, a janela está VAZIA", () => {
    const j = spreadWindow(0.4, 0.15, 0.3);
    expect(j.floorPct).toBeCloseTo(0.55, 6);
    expect(j.empty).toBe(true);
  });

  it("a janela só abre se o custo cair ou o teto subir — e ambos são decisões", () => {
    // Baratear a execução (custo 0.1) abre a janela honestamente.
    expect(spreadWindow(0.1, 0.05, 0.3).empty).toBe(false);
    // Subir o teto de volta também abre — mas aí volta a comprar ruído, e é
    // isso que o teto existia para impedir.
    expect(spreadWindow(0.4, 0.15, 3).empty).toBe(false);
  });

  it("o piso é custo + líquido mínimo, não um número solto", () => {
    // Derivado, para a tela não envelhecer em silêncio quando alguém mexer no
    // custo por variável de ambiente.
    expect(spreadWindow(0.45, 0.15, 0.3).floorPct).toBeCloseTo(0.6, 6);
  });
});
