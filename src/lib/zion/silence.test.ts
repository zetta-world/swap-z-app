/**
 * O SILÊNCIO DAS MESAS — cinco estados que parecem um só na tela.
 *
 * ⚠️ O CASO QUE ORIGINOU ISTO (06/08).
 *
 * A URÐR aparecia com zero trades e caixa intacto. Qualquer um concluiria
 * "quebrada". O rastro dizia: 142 ticks, 15 com oferta, e nas 15
 * `vetoedByRecord: 1` — a mesa cujo mandato é obedecer ao histórico MEDIDO
 * recusou tudo porque o histórico é negativo.
 *
 * Ela é a ÚNICA mesa fazendo exatamente o que deveria, e no painel parecia a
 * mais morta de todas. Desligá-la seria desligar a única certa.
 */

import { describe, it, expect } from "vitest";
import { readSilence, MIN_CASH_USD } from "@/lib/zion/silence";

const tick = (o: Partial<Parameters<typeof readSilence>[0][number]> = {}) => ({ ...o });

describe("mesa que opera não está calada", () => {
  it("com posição aberta, o veredito é 'operando'", () => {
    expect(readSilence([], 1000, 3, 0).kind).toBe("operando");
  });

  it("com trade fechado também — histórico conta", () => {
    expect(readSilence([], 1000, 0, 12).kind).toBe("operando");
  });
});

describe("o caso da URÐR — disciplina não é problema", () => {
  /**
   * Os números reais dela: 15 ofertas ao longo da janela, 15 vetadas pelo
   * histórico. Este é o teste que impede alguém de "consertar" a mesa certa.
   */
  it("recebeu e recusou tudo por veto do histórico → NÃO é problema", () => {
    const ticks = Array.from({ length: 15 }, () => tick({ offered: 1, vetoedByRecord: 1, taken: 0 }));
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(false);
    expect(v.label).toContain("15");
    expect(v.action).toMatch(/nada a fazer/i);
  });

  /**
   * ⚠️ Recusar SEM ser pelo histórico é outra coisa: aí o bracket não fechou
   * por algum outro motivo, e isso merece investigação.
   */
  it("recusou sem veto do histórico → É problema, e diz para investigar", () => {
    const ticks = [tick({ offered: 3, vetoedByRecord: 0, taken: 0 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(true);
    expect(v.action).toMatch(/bracket/i);
  });
});

describe("os outros quatro estados", () => {
  it("sem tick nenhum: não dá para julgar, e isso É problema", () => {
    const v = readSilence([], 1000, 0, 0);
    expect(v.kind).toBe("sem_rastro");
    expect(v.isProblem).toBe(true);
    expect(v.action).toMatch(/antes de qualquer veredito/i);
  });

  it("quebra vence os outros — quem estoura não chegou a decidir", () => {
    const ticks = [tick({ erro: "fetch falhou" }), tick({ offered: 5, vetoedByRecord: 5 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("quebra");
    expect(v.action).toContain("fetch falhou");
  });

  /**
   * Fome vem antes de seca: sem caixa a mesa não abriria nem se recebesse
   * oferta. Diagnosticar "seca" aqui mandaria consertar a fonte quando o
   * problema é capital.
   */
  it("fome vence seca — sem caixa não abre nem com oferta", () => {
    const ticks = [tick({ offered: 0 })];
    const v = readSilence(ticks, 10, 0, 0);
    expect(v.kind).toBe("fome");
    expect(v.label).toContain(`$${MIN_CASH_USD}`);
    expect(v.action).toMatch(/recapitalizar/i);
  });

  it("seca COM motivo reportado não é problema — é o mercado", () => {
    const ticks = [tick({ offered: 0, skipped: [{ symbol: "BTC", reason: "sem estrutura" }] })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("seca");
    expect(v.isProblem).toBe(false);
    expect(v.action).toContain("sem estrutura");
  });

  /**
   * Seca SEM motivo é problema: "zero candidatos" não distingue mercado calmo
   * de fonte caída, e as duas pedem ações opostas.
   */
  it("seca SEM motivo é problema — não distingue mercado de fonte caída", () => {
    const ticks = [tick({ offered: 0 }), tick({ offered: 0 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("seca");
    expect(v.isProblem).toBe(true);
    expect(v.action).toMatch(/fonte caída/i);
  });
});

describe("a janela, não o tick", () => {
  /**
   * ⚠️ O ERRO QUE EU QUASE COMETI. Olhei UM tick da URÐR, vi `offered: 0`, e
   * ia reportar "desconectada". Com os 142 a resposta era o contrário.
   *
   * A assinatura pede a LISTA justamente para que um tick vazio no meio de uma
   * janela cheia de ofertas não vire veredito.
   */
  it("um tick vazio no meio de ofertas não vira 'seca'", () => {
    const ticks = [tick({ offered: 0 }), tick({ offered: 1, vetoedByRecord: 1 }), tick({ offered: 0 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(false);
  });
});
