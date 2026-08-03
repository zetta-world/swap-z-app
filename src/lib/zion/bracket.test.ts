import { describe, it, expect } from "vitest";
import {
  buildLongBracket, expectedMovePct, targetReachable,
  MAX_TARGET_ATR_MULT, MIN_RR,
} from "@/lib/zion/bracket";


/**
 * O ALVO CABE NO HORIZONTE? — a pergunta que ninguém fazia.
 *
 * O dono perguntou se nenhum agente estar positivo podia ser erro NOSSO. É, em
 * parte, e é isto.
 *
 * Os 17 trades fechados das mesas: alvo médio +4.96%, stop médio −2.20%, ZERO
 * alvos batidos, 12 stops. O alvo sempre veio da ESTRUTURA (resistência, altura
 * da faixa, pivô) e o horizonte sempre foi CONSTANTE do playbook. Os dois nunca
 * se falaram.
 *
 * ADA com alvo a +5.87% e horizonte de 8 horas: com ATR de 1h em ~0.5%, o
 * movimento esperado em 8h é ~1.4%. O alvo pedia QUATRO VEZES isso. O stop, a
 * 2.2%, estava a 1.6× do esperado — dentro do ruído normal.
 *
 * Lado que mata alcançável, lado que paga inalcançável. Perde por construção, e
 * o experimento deixa de medir estratégia para medir a própria geometria.
 */
describe("o alvo tem que caber no horizonte", () => {
  it("o movimento esperado escala com a RAIZ do tempo, não com o tempo", () => {
    // Preço vagueia, não anda em linha reta. Assumir escala linear faria um
    // horizonte longo parecer capaz de alcançar qualquer alvo.
    expect(expectedMovePct(0.5, 4)).toBeCloseTo(1.0, 6);
    expect(expectedMovePct(0.5, 16)).toBeCloseTo(2.0, 6);
    // Quadruplicar o tempo dobra o alcance — não quadruplica.
    expect(expectedMovePct(0.5, 16) / expectedMovePct(0.5, 4)).toBeCloseTo(2, 6);
  });

  it("REPROVA o caso real: ADA a +5.87% em 8 horas", () => {
    // ATR 1h de 0.5% → esperado em 8h ≈ 1.41%. O alvo pedia 4.2× isso.
    expect(targetReachable(5.87, 0.5, 8)).toBe(false);
  });

  it("o MESMO alvo passa a ser discutível num horizonte longo", () => {
    // 48h → esperado ≈ 3.46%; 5.87% é 1.7×, dentro do múltiplo de 2.0.
    // A geometria não é boa ou ruim em abstrato: ela é boa PARA UM PRAZO.
    expect(targetReachable(5.87, 0.5, 48)).toBe(true);
  });

  it("símbolo mais volátil alcança mais longe no mesmo tempo", () => {
    expect(targetReachable(5.87, 0.5, 12)).toBe(false);
    expect(targetReachable(5.87, 1.5, 12)).toBe(true);
  });

  it("SEM ATR não veta — não medido não pode virar veto silencioso", () => {
    // O piso de volatilidade já barra o caso sem dado por outro caminho.
    // Vetar aqui também transformaria ausência de dado em rejeição invisível.
    expect(targetReachable(50, null, 1)).toBe(true);
    expect(targetReachable(50, 0, 1)).toBe(true);
  });

  it("o bracket inteiro RECUSA quando o alvo não cabe", () => {
    // Geometria válida em todo o resto: stop fora do ruído, RR 2.4, alvo dentro
    // da escala. Só não cabe no tempo — e isso basta para não operar.
    const semTempo = buildLongBracket(
      "ADA", "range_reversion", 0.1886, 0.1997, 0.1839, 0.5, 8, "teste",
    );
    expect(semTempo).toBeNull();

    // O mesmo setup com prazo suficiente é operável.
    const comTempo = buildLongBracket(
      "ADA", "range_reversion", 0.1886, 0.1997, 0.1839, 0.5, 48, "teste",
    );
    expect(comTempo).not.toBeNull();
    expect(comTempo!.rr).toBeGreaterThan(MIN_RR);
  });

  it("o múltiplo é PALPITE declarado, como a prioridade era", () => {
    // 2.0 = "aceito pedir o dobro do movimento típico". O backtest por playbook
    // mede `mfe/alvo` empiricamente e é ele que deve substituir este número.
    expect(MAX_TARGET_ATR_MULT).toBeGreaterThan(1);
    expect(MAX_TARGET_ATR_MULT).toBeLessThan(5);
  });
});

/**
 * O RELÓGIO ENCURTADO — o defeito que o ledger mostrou de forma constrangedora.
 *
 * A SKAÐI é a mesma seleção da VÖLUNDR com prazo de day-trade. Ela conseguia
 * isso trocando SÓ o campo `horizon_hours` na linha gravada; o alvo, calculado
 * para um swing de 48 horas, ia junto intacto.
 *
 * No ledger os trades das duas mesas saíram IDÊNTICOS em entrada, alvo e stop —
 * só o relógio mudava. Não era uma mesa mais rápida: era a mesma mesa com um
 * sexto do tempo para chegar ao mesmo lugar.
 */
describe("encurtar o prazo sem refazer o alvo é mudar o relógio, não a mesa", () => {
  const setup = (h: number) => buildLongBracket(
    "ADA", "range_reversion", 0.1876, 0.19834, 0.18430, 0.5, h, "teste",
  );

  it("o MESMO setup é válido no swing e inválido no day", () => {
    // Esta é a assimetria inteira: com 48h o alvo está a 1.7× do movimento
    // esperado; com 8h, a 4.2×. A geometria não mudou — o tempo mudou.
    expect(setup(48)).not.toBeNull();
    expect(setup(8)).toBeNull();
  });

  it("no prazo curto o stop fica MUITO mais perto que o alvo — é isso que sangra", () => {
    // Se o alvo inalcançável viesse com um stop também inalcançável, o trade
    // apenas expiraria perto de zero. O que faz sangrar é a ASSIMETRIA: em
    // unidades de movimento esperado em 8h, o stop está a 1.2× e o alvo a 4.0×.
    // Três vezes mais fácil morrer do que ganhar, e nada media isso.
    const swing = setup(48)!;
    const esperado8h = expectedMovePct(0.5, 8);
    const alvoPct = ((swing.target - swing.entry) / swing.entry) * 100;

    expect(swing.stopPct / esperado8h).toBeLessThan(1.5);
    expect(alvoPct / esperado8h).toBeGreaterThan(3.5);
    // A razão entre as duas distâncias é o tamanho do desequilíbrio.
    expect(alvoPct / swing.stopPct).toBeGreaterThan(3);
  });
});
