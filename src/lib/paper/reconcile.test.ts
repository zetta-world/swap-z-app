import { describe, it, expect } from "vitest";
import {
  computeDrift, significantDrifts, starvedWallets, liveDrifts, retiredDrifts, planRepair,
  realizedDrifts,
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

/**
 * A LEITURA TRUNCADA — o erro que fez a verificação INVENTAR os números.
 *
 * O reparo de 03/08 pagou US$ 1.429,09 que ninguém devia. O VÖLUNDR estava com
 * US$ 843,74, que era o valor exatamente correto, e recebeu US$ 156,26 para
 * "consertar" um déficit que não existia.
 *
 * A causa: `reconcileWallets` pedia `.limit(20000)` e achava que isso bastava.
 * Não basta — `limit` é um pedido do cliente, e o PostgREST tem teto PRÓPRIO no
 * servidor. Com ~2.100 posições vivas, voltaram ~1.000, sem erro e sem ordem
 * definida. As carteiras cujas posições ficaram de fora apareceram com ZERO
 * posições, logo `esperado = capital inicial`, logo um déficit fantasma.
 *
 * O agravante: o cabeçalho deste arquivo documenta essa mesma armadilha como
 * causa raiz do vazamento original, e `selectAllRows` existe no repositório
 * exatamente para ela.
 *
 * Estes testes cobram a PROPRIEDADE que a paginação garante, em vez de cobrar a
 * chamada — um teste que só verificasse "chamou selectAllRows" passaria com
 * qualquer paginação quebrada.
 */
describe("posição não lida não pode virar déficit", () => {
  it("carteira com posições ABERTAS não aparece devendo quando elas são contadas", () => {
    // O caso do VÖLUNDR: caixa 843.74, três posições abertas de 50 e −6.26 de
    // realizado. Contando tudo, o desvio é ZERO e não há reparo a fazer.
    const d = computeDrift(w({ source: "strat_mech", label: "VÖLUNDR", cashUsd: 843.74 }), 150, -6.26);
    expect(d.driftUsd).toBeCloseTo(0, 2);
    expect(planRepair([d])).toHaveLength(0);
  });

  it("as MESMAS posições, não lidas, produzem um déficit fantasma de $156.26", () => {
    // Este é o número que o reparo pagou. O teste existe para que a forma do
    // erro fique registrada: não é ruído, é a leitura truncada virando dinheiro.
    const cego = computeDrift(w({ source: "strat_mech", label: "VÖLUNDR", cashUsd: 843.74 }), 0, 0);
    expect(cego.driftUsd).toBeCloseTo(-156.26, 2);
    expect(planRepair([cego])[0].deltaUsd).toBeCloseTo(156.26, 2);
  });

  it("o custo ABERTO é o que mais dói quando some da leitura", () => {
    // P&L realizado some e erra por pouco; custo aberto some e erra pelo
    // tamanho da posição inteira, que é sempre a maior parcela.
    const semPnl   = computeDrift(w({ cashUsd: 800 }), 150, 0);
    const semCusto = computeDrift(w({ cashUsd: 800 }), 0, -6.26);
    expect(Math.abs(semCusto.driftUsd)).toBeGreaterThan(Math.abs(semPnl.driftUsd));
  });
});

/**
 * O SEGUNDO INVARIANTE: a coluna `realized_pnl_usd` contra o P&L das posições.
 *
 * ⚠️ POR QUE ELE FALTAVA, e por que a falta era invisível.
 *
 * `computeDrift` sempre recebeu o P&L CALCULADO das posições não-arquivadas, e
 * está certa nisso. Só que `paper_accounts.realized_pnl_usd` guarda a mesma
 * grandeza denormalizada — e é ELA que o painel lê.
 *
 * A conferência de caixa nunca pegou a divergência porque ela usa o calculado,
 * que estava correto. O defeito só existe quando se comparam as duas, e foi
 * assim que o `radar` ficou com as 89 posições arquivadas (P&L calculado = 0) e
 * a coluna em −$13,37: reset parcial, contador esquecido.
 */
describe("o contador de P&L contra as posições", () => {
  const base = { source: "x", label: "X", startingUsd: 1000, cashUsd: 1000 };

  it("as duas fontes concordando dá desvio ZERO", () => {
    const d = computeDrift({ ...base, storedRealizedUsd: -5 }, 0, -5);
    expect(d.realizedDriftUsd).toBe(0);
    expect(realizedDrifts([d])).toEqual([]);
  });

  /**
   * O caso REAL do radar, com os números dele: 89 posições arquivadas, então o
   * P&L calculado é 0, e a coluna guardada ficou em −13,37.
   */
  it("o caso do radar: posições arquivadas, contador para trás", () => {
    const d = computeDrift(
      { source: "radar", label: "HEIMDALL", startingUsd: 1000, cashUsd: 1000, storedRealizedUsd: -13.37 },
      0, 0,
    );
    expect(d.realizedDriftUsd).toBeCloseTo(-13.37, 2);
    expect(d.computedRealizedUsd).toBe(0);
    // ⚠️ E o desvio de CAIXA é zero — é por isso que a conferência antiga
    // nunca acusou nada: 1000 = 1000 − 0 + 0.
    expect(d.driftUsd).toBe(0);
    expect(realizedDrifts([d])).toHaveLength(1);
  });

  it("quem não informa a coluna não é conferido — não vira falso positivo", () => {
    const d = computeDrift(base, 0, -5);
    expect(d.realizedDriftUsd).toBe(0);
  });

  /**
   * Os dois desvios são sintomas DIFERENTES e não podem ser somados numa
   * verificação só: caixa errado é dinheiro que apareceu ou sumiu; contador
   * errado é a mesma verdade escrita duas vezes com valores distintos.
   */
  it("desvio de caixa e desvio de contador são independentes", () => {
    // Caixa furado, contador certo.
    const caixa = computeDrift({ ...base, cashUsd: 900, storedRealizedUsd: 0 }, 0, 0);
    expect(Math.abs(caixa.driftUsd)).toBeGreaterThan(0.5);
    expect(caixa.realizedDriftUsd).toBe(0);

    // Caixa certo, contador furado.
    const contador = computeDrift({ ...base, storedRealizedUsd: -13.37 }, 0, 0);
    expect(contador.driftUsd).toBe(0);
    expect(Math.abs(contador.realizedDriftUsd)).toBeGreaterThan(0.5);
  });

  it("ordena pelo pior desvio absoluto, não pelo sinal", () => {
    const pequeno = computeDrift({ ...base, source: "a", storedRealizedUsd: 2 }, 0, 0);
    const grande = computeDrift({ ...base, source: "b", storedRealizedUsd: -50 }, 0, 0);
    expect(realizedDrifts([pequeno, grande])[0].source).toBe("b");
  });
});
