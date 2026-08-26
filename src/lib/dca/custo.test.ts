import { describe, it, expect } from "vitest";
import {
  projetarTaxa, compararComRealizado, precoMedio,
  TAXA_DO_CICLO_PCT, PERNAS_DO_DCA,
} from "@/lib/dca/custo";
import { CUSTO_POR_PERNA_PCT, CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";

/**
 * ⚠️ O QUE ESTES TESTES SEGURAM.
 *
 * O primeiro bloco é o único que realmente importa: DCA paga UMA perna. Se
 * alguém "consertar" isto para `CUSTO_IDA_E_VOLTA_PCT` — que é o que quase todo
 * o resto do repositório usa — a taxa projetada dobra em silêncio e a tela
 * passa a desencorajar planos que estão bons. É a mesma divergência que
 * `lib/zion/custo.ts` foi escrito para matar em 16/08.
 */

describe("a alíquota do DCA é de UMA perna", () => {
  it("é o primitivo por perna, não o ciclo de ida e volta", () => {
    expect(PERNAS_DO_DCA).toBe(1);
    expect(TAXA_DO_CICLO_PCT).toBe(CUSTO_POR_PERNA_PCT);
    expect(TAXA_DO_CICLO_PCT).toBe(CUSTO_IDA_E_VOLTA_PCT / 2);
  });

  it("$10 x 90 ciclos a 0,2% custa $1,80 — e não $3,60", () => {
    const r = projetarTaxa({ orcamentoTotalUsd: 900, porCicloUsd: 10, ciclosTotal: 90, taxaPct: 0.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taxaTotalUsd).toBeCloseTo(1.8, 10);
    expect(r.pctDoOrcamento).toBeCloseTo(0.2, 10);
    expect(r.taxaPorCicloUsd).toBeCloseTo(0.02, 10);
  });
});

describe("os ciclos que VÃO rodar, não os que foram pedidos", () => {
  it("o orçamento manda quando ele acaba antes da contagem", () => {
    // 100 ciclos pedidos, mas $250 só pagam 25 de $10.
    const r = projetarTaxa({ orcamentoTotalUsd: 250, porCicloUsd: 10, ciclosTotal: 100, taxaPct: 0.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ciclosQueVaoRodar).toBe(25);
    expect(r.gastoPrevistoUsd).toBeCloseTo(250, 10);
    // ⚠️ A conta ingênua (porCiclo × ciclosTotal = $1.000) cobraria $2,00.
    expect(r.taxaTotalUsd).toBeCloseTo(0.5, 10);
  });

  it("a contagem manda quando ela acaba antes do orçamento", () => {
    const r = projetarTaxa({ orcamentoTotalUsd: 1000, porCicloUsd: 10, ciclosTotal: 3, taxaPct: 0.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ciclosQueVaoRodar).toBe(3);
    expect(r.gastoPrevistoUsd).toBeCloseTo(30, 10);
    // ⚠️ E a sobra de $970 NÃO vira um ciclo parcial: a contagem já acabou.
    expect(r.ultimoCicloParcial).toBe(false);
  });

  it("a sobra vira ciclo PARCIAL quando passa do mínimo", () => {
    // $95 com ciclos de $10: nove cheios e $5 de sobra, que a corretora aceita.
    const r = projetarTaxa({
      orcamentoTotalUsd: 95, porCicloUsd: 10, ciclosTotal: 20, minimoUsd: 5, taxaPct: 0.2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ciclosQueVaoRodar).toBe(10);
    expect(r.ultimoCicloParcial).toBe(true);
    expect(r.gastoPrevistoUsd).toBeCloseTo(95, 10);
  });

  it("a sobra ABAIXO do mínimo não compra — igual ao tetoDoCiclo", () => {
    // $94 com ciclos de $10 e mínimo $5: sobram $4, que viram nada.
    const r = projetarTaxa({
      orcamentoTotalUsd: 94, porCicloUsd: 10, ciclosTotal: 20, minimoUsd: 5, taxaPct: 0.2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ciclosQueVaoRodar).toBe(9);
    expect(r.ultimoCicloParcial).toBe(false);
    expect(r.gastoPrevistoUsd).toBeCloseTo(90, 10);
  });
});

describe("entrada inválida recusa com motivo, não com zero", () => {
  it("cada campo ruim tem seu nome", () => {
    const casos = [
      [{ orcamentoTotalUsd: 0,   porCicloUsd: 10, ciclosTotal: 5 }, "orcamento_invalido"],
      [{ orcamentoTotalUsd: -5,  porCicloUsd: 10, ciclosTotal: 5 }, "orcamento_invalido"],
      [{ orcamentoTotalUsd: 100, porCicloUsd: 0,  ciclosTotal: 5 }, "por_ciclo_invalido"],
      [{ orcamentoTotalUsd: 100, porCicloUsd: 10, ciclosTotal: 0 }, "ciclos_invalido"],
      [{ orcamentoTotalUsd: 100, porCicloUsd: 10, ciclosTotal: 1.5 }, "ciclos_invalido"],
      [{ orcamentoTotalUsd: 100, porCicloUsd: 10, ciclosTotal: Infinity }, "ciclos_invalido"],
      [{ orcamentoTotalUsd: NaN, porCicloUsd: 10, ciclosTotal: 5 }, "orcamento_invalido"],
    ] as const;
    for (const [entrada, motivo] of casos) {
      const r = projetarTaxa(entrada);
      expect(r.ok, JSON.stringify(entrada)).toBe(false);
      if (!r.ok) expect(r.motivo, JSON.stringify(entrada)).toBe(motivo);
    }
  });

  it("orçamento menor que um ciclo e sem mínimo ainda compra a sobra", () => {
    // $3 com ciclo de $10: zero cheios, mas $3 passam do mínimo 0.
    const r = projetarTaxa({ orcamentoTotalUsd: 3, porCicloUsd: 10, ciclosTotal: 5, taxaPct: 0.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ciclosQueVaoRodar).toBe(1);
    expect(r.gastoPrevistoUsd).toBeCloseTo(3, 10);
  });

  it("orçamento menor que o mínimo não roda ciclo nenhum", () => {
    const r = projetarTaxa({
      orcamentoTotalUsd: 3, porCicloUsd: 10, ciclosTotal: 5, minimoUsd: 5, taxaPct: 0.2,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("nao_cabe_nenhum_ciclo");
  });
});

describe("aferição — alíquota contra alíquota", () => {
  const projecao = projetarTaxa({
    orcamentoTotalUsd: 900, porCicloUsd: 10, ciclosTotal: 90, taxaPct: 0.2,
  });

  it("um plano no ciclo 3 de 90 não parece uma economia", () => {
    expect(projecao.ok).toBe(true);
    if (!projecao.ok) return;
    const a = compararComRealizado(
      [{ custoUsd: 10, taxaUsd: 0.02 }, { custoUsd: 10, taxaUsd: 0.02 }, { custoUsd: 10, taxaUsd: 0.02 }],
      projecao,
    );
    expect(a.ciclosMedidos).toBe(3);
    expect(a.taxaRealUsd).toBeCloseTo(0.06, 10);
    // ⚠️ O total real ($0,06) é 3% do projetado ($1,80) — e não quer dizer NADA.
    // A alíquota é que bate, e é ela que responde à pergunta.
    expect(a.taxaRealPct).toBeCloseTo(0.2, 10);
    expect(a.desvioPontos).toBeCloseTo(0, 10);
  });

  it("corretora cobrando mais aparece como desvio positivo", () => {
    if (!projecao.ok) return;
    const a = compararComRealizado([{ custoUsd: 100, taxaUsd: 0.35 }], projecao);
    expect(a.taxaRealPct).toBeCloseTo(0.35, 10);
    expect(a.desvioPontos).toBeCloseTo(0.15, 10);
  });

  it("⚠️ ciclo SEM taxa registrada não entra como zero", () => {
    if (!projecao.ok) return;
    const a = compararComRealizado(
      [
        { custoUsd: 10, taxaUsd: 0.02 },
        { custoUsd: 10, taxaUsd: null },  // ciclo antigo, anterior à coluna
        { custoUsd: 10, taxaUsd: null },
      ],
      projecao,
    );
    expect(a.ciclosMedidos).toBe(1);
    expect(a.ciclosSemRegistro).toBe(2);
    // Se os nulos virassem zero, a alíquota cairia para 0,067% e a tela leria
    // "a corretora está cobrando um terço do previsto".
    expect(a.taxaRealPct).toBeCloseTo(0.2, 10);
  });

  it("ciclo que não comprou não conta em lugar nenhum", () => {
    if (!projecao.ok) return;
    const a = compararComRealizado(
      [{ custoUsd: null, taxaUsd: null }, { custoUsd: 0, taxaUsd: null }],
      projecao,
    );
    expect(a.ciclosMedidos).toBe(0);
    expect(a.ciclosSemRegistro).toBe(0);
    expect(a.taxaRealPct).toBeNull();
    expect(a.desvioPontos).toBeNull();
  });
});

describe("preço médio — gasto sobre quantidade", () => {
  it("⚠️ NÃO é a média aritmética dos preços quando os valores diferem", () => {
    // Ciclo 1: $100 a $100 = 1 unidade. Ciclo 2 (parcial): $20 a $20 = 1 unidade.
    // Média dos preços = $60. Preço médio real = $120 / 2 = $60... escolhemos
    // números que separam as duas contas:
    // Ciclo 1: $100 compra 1 un a $100. Ciclo 2: $10 compra 1 un a $10.
    // Média dos preços = $55. Gasto/quantidade = $110/2 = $55. Ainda coincide.
    // Só diverge quando as QUANTIDADES diferem:
    const m = precoMedio([
      { custoUsd: 100, quantidade: 1 },   // $100/un
      { custoUsd: 100, quantidade: 4 },   // $25/un
    ]);
    // Média aritmética dos preços seria (100 + 25) / 2 = $62,50.
    expect(m.precoMedioUsd).toBeCloseTo(40, 10); // 200 / 5
    expect(m.quantidadeTotal).toBeCloseTo(5, 10);
    expect(m.ciclosContados).toBe(2);
  });

  it("sem quantidade devolve null, nunca zero", () => {
    const m = precoMedio([{ custoUsd: 10, quantidade: null }, { custoUsd: null, quantidade: 3 }]);
    expect(m.ciclosContados).toBe(0);
    expect(m.precoMedioUsd).toBeNull();
  });

  it("ciclo pulado ou falhado não entra na média", () => {
    const m = precoMedio([
      { custoUsd: 50, quantidade: 2 },
      { custoUsd: null, quantidade: null }, // pulado
      { custoUsd: 0, quantidade: 0 },       // falhou antes de preencher
    ]);
    expect(m.ciclosContados).toBe(1);
    expect(m.precoMedioUsd).toBeCloseTo(25, 10);
  });
});
