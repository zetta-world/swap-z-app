import { describe, it, expect } from "vitest";
import {
  computeDrift, significantDrifts, starvedWallets, liveDrifts, retiredDrifts, planRepair,
  DRIFT_TOLERANCE_USD,
} from "@/lib/paper/reconcile";

/**
 * O CAPITAL QUE SUMIA EM SILÊNCIO.
 *
 * Quatorze das vinte carteiras de paper haviam perdido de US$450 a US$1.000 de
 * capital fantasma. Grok e Mistral estavam em $0,00.
 *
 * E nada disso aparecia: o painel mostra `inicial + realizado + não-realizado`,
 * que continuava bonito. Quem decide se a mesa consegue ABRIR posição é o
 * `cash_usd` — e é ele que estava vazio. Sem caixa, `sizePosition` devolve 0 e
 * a mesa para de operar sem erro, sem alerta, sem linha vermelha. Quem olha
 * conclui "não apareceu setup".
 *
 * Estes testes existem para que a próxima fuga apareça no mesmo dia.
 */

const w = (over: Partial<Parameters<typeof computeDrift>[0]> = {}) => ({
  source: "strat_ai", label: "MÍMIR", startingUsd: 1000, cashUsd: 1000, ...over,
});

describe("a conta que pega a fuga", () => {
  it("carteira intocada não acusa desvio", () => {
    expect(computeDrift(w(), 0, 0).driftUsd).toBe(0);
  });

  it("capital preso em posição aberta NÃO é desvio", () => {
    // $200 em três posições abertas: o caixa tem de estar $200 menor, e isso é
    // o comportamento correto — não pode virar alarme.
    expect(computeDrift(w({ cashUsd: 800 }), 200, 0).driftUsd).toBe(0);
  });

  it("P&L realizado entra na conta", () => {
    expect(computeDrift(w({ cashUsd: 1050 }), 0, 50).driftUsd).toBe(0);
    expect(computeDrift(w({ cashUsd: 970 }), 0, -30).driftUsd).toBe(0);
  });

  it("O CASO REAL: MÍMIR com $49 e uma posição fechada de −$0,58", () => {
    // Esperado 999,42. Real 49,42. Faltavam exatamente $950.
    const d = computeDrift(w({ cashUsd: 49.42 }), 0, -0.58);
    expect(d.expectedUsd).toBeCloseTo(999.42, 2);
    expect(d.driftUsd).toBeCloseTo(-950, 2);
  });

  it("dinheiro que APARECE também é desvio", () => {
    // A Ferrari estava $37 ACIMA do esperado. Sobra é tão suspeita quanto falta:
    // as duas significam que o caixa deixou de refletir os trades.
    expect(computeDrift(w({ cashUsd: 1037.67 }), 0, 0).driftUsd).toBeCloseTo(37.67, 2);
  });
});

describe("mesa faminta — o silêncio que parece disciplina", () => {
  it("abaixo do piso de caixa, a mesa não abre mais nada", () => {
    // Este é o ponto: `sizePosition` devolve 0 e ninguém é avisado. A mesa fica
    // quieta e passa por "não apareceu setup".
    expect(computeDrift(w({ cashUsd: 20 }), 0, 0, 25).starved).toBe(true);
    expect(computeDrift(w({ cashUsd: 0 }), 0, 0, 25).starved).toBe(true);
  });

  it("com caixa acima do piso, segue operando", () => {
    expect(computeDrift(w({ cashUsd: 26 }), 0, 0, 25).starved).toBe(false);
  });

  it("uma carteira TODA aplicada em posições abertas está faminta, e está certo", () => {
    // Aqui o silêncio é legítimo: o dinheiro está no mercado, não sumiu. Por
    // isso `starved` e `drift` são coisas SEPARADAS — juntá-las esconderia
    // justamente o caso perigoso.
    const d = computeDrift(w({ cashUsd: 0 }), 1000, 0, 25);
    expect(d.starved).toBe(true);
    expect(d.driftUsd).toBe(0);
  });

  it("lista as famintas", () => {
    const all = [
      computeDrift(w({ source: "a", cashUsd: 1000 }), 0, 0, 25),
      computeDrift(w({ source: "b", cashUsd: 5 }), 0, 0, 25),
    ];
    expect(starvedWallets(all).map((d) => d.source)).toEqual(["b"]);
  });
});

describe("mesa aposentada não reprova — cicatriz não é ferida", () => {
  it("mesa VIVA com desvio reprova", () => {
    const d = computeDrift(w({ source: "strat_mech" }), 0, 0);
    expect(d.retired).toBe(false);
  });

  it("mesa em Valhalla é marcada como aposentada", () => {
    // Treze carteiras carregam a cicatriz do vazamento antigo, já corrigido na
    // origem. Elas não podem vazar mais — não operam. Deixar a verificação
    // vermelha por causa delas treinaria o operador a ignorá-la, que é o oposto
    // do motivo de ela existir.
    expect(computeDrift(w({ source: "grok_scan" }), 0, 0).retired).toBe(true);
  });

  it("carteira que ninguém declarou é tratada como VIVA", () => {
    // O desconhecido não ganha dispensa: se apareceu uma carteira que não está
    // em `desks.ts`, ela merece atenção, não silêncio.
    expect(computeDrift(w({ source: "fantasma_xyz" }), 0, 0).retired).toBe(false);
  });

  it("só as vivas entram no que reprova", () => {
    const all = [
      computeDrift(w({ source: "grok_scan", cashUsd: 0 }), 0, 0),      // aposentada
      computeDrift(w({ source: "strat_ai", cashUsd: 0 }), 0, 0),       // viva
    ];
    expect(liveDrifts(all).map((d) => d.source)).toEqual(["strat_ai"]);
    expect(retiredDrifts(all).map((d) => d.source)).toEqual(["grok_scan"]);
  });
});

describe("o relatório", () => {
  it("arredondamento de centavo não vira alarme", () => {
    // Alarme falso treina o operador a ignorar o alarme verdadeiro.
    const all = [computeDrift(w({ cashUsd: 1000.2 }), 0, 0)];
    expect(significantDrifts(all)).toEqual([]);
    expect(DRIFT_TOLERANCE_USD).toBeGreaterThan(0);
  });

  it("ordena do PIOR primeiro — quem perdeu mais aparece no topo", () => {
    const all = [
      computeDrift(w({ source: "leve", cashUsd: 900 }), 0, 0),
      computeDrift(w({ source: "grave", cashUsd: 0 }), 0, 0),
      computeDrift(w({ source: "ok", cashUsd: 1000 }), 0, 0),
    ];
    expect(significantDrifts(all).map((d) => d.source)).toEqual(["grave", "leve"]);
  });
});

/**
 * O REPARO — devolver o que o vazamento levou, sem virar encobridor dele.
 *
 * A correção do bug (01/08) parou a hemorragia e não devolveu nada: o Radar
 * seguiu com $51 de $1.000, e nesse estado ele não abre posição nenhuma. Some
 * do experimento em silêncio — que é o defeito que a reconciliação existe para
 * pegar, agora do outro lado.
 *
 * A tentação óbvia é reparar dentro da própria verificação. Seria destruí-la:
 * um vazamento NOVO seria zerado a cada rodada e o detector nunca mais acusaria
 * nada. Estes testes guardam as três fronteiras que impedem isso.
 */
describe("o reparo do rombo", () => {
  const drift = (over: Parameters<typeof computeDrift>[0], open = 0, pnl = 0) =>
    computeDrift(over, open, pnl);

  it("devolve o caixa ao valor que os TRADES justificam, não ao inicial", () => {
    // Uma mesa que perdeu $200 operando tem que ficar com $800, não com $1.000.
    // "Restaurar" para o inicial apagaria o resultado do experimento junto com
    // o bug — e o resultado é a única coisa que este laboratório produz.
    const d = drift(w({ source: "strat_record", label: "URÐR", cashUsd: 550 }), 0, -200);
    const [p] = planRepair([d]);
    expect(p.to).toBe(800);
    expect(p.deltaUsd).toBe(250);
  });

  it("desconta o que está preso em posição aberta", () => {
    const d = drift(w({ cashUsd: 400 }), 300, 0);
    expect(planRepair([d])[0].to).toBe(700);
  });

  it("NÃO mexe em mesa aposentada — cicatriz não se repara", () => {
    // VEÐRFÖLNIR está no Valhalla. Devolver capital a quem não opera só produz
    // um número bonito que não significa nada.
    const d = drift(w({ source: "sniper", label: "VEÐRFÖLNIR", cashUsd: 10 }));
    expect(d.retired).toBe(true);
    expect(planRepair([d])).toHaveLength(0);
  });

  it("NÃO mexe em caixa a MAIS — dinheiro que apareceu é outro bug", () => {
    // E provavelmente pior. Tirar o excesso apagaria a única pista dele.
    const d = drift(w({ cashUsd: 1500 }));
    expect(d.driftUsd).toBe(500);
    expect(planRepair([d])).toHaveLength(0);
  });

  it("ignora ruído de ponto flutuante", () => {
    expect(planRepair([drift(w({ cashUsd: 1000 - DRIFT_TOLERANCE_USD / 2 }))])).toHaveLength(0);
  });

  it("pior primeiro — a mesa mais sangrada é a que sumiu do experimento", () => {
    const plano = planRepair([
      drift(w({ source: "strat_record", label: "URÐR", cashUsd: 900 })),
      drift(w({ source: "radar", label: "Radar", cashUsd: 51 })),
    ]);
    expect(plano[0].label).toBe("Radar");
  });
});
