import { describe, it, expect } from "vitest";
import { desempenhoDaInstancia, type PosicaoDaInstancia } from "@/lib/bancada/desempenho";

/**
 * ⚠️⚠️ ESTE ARQUIVO GUARDA A FRASE DO DONO (07/09): *"apenas estamos pegando os
 * resultados das mesas do painel e Admin e repetindo para o investidor... tinha
 * que ser isolado"*.
 *
 * O que se trava aqui não é aritmética de média — é que o número seja DELE,
 * contado do zero, e que ele não empreste peso que não tem.
 */

const H = 3_600_000;

function p(q: Partial<PosicaoDaInstancia> = {}): PosicaoDaInstancia {
  return {
    status: "ganhou", resultadoPct: 2, playbook: "pullback_ema", simbolo: "BTC",
    abertaEmMs: 0, fechadaEmMs: H, ...q,
  };
}

describe("a instância recém-contratada não empresta a amostra da casa", () => {
  /**
   * ⚠️⚠️ O CASO QUE MOTIVOU TUDO. Quem contratou agora tem ZERO. A tela tem de
   * poder dizer isso — e para isso o número precisa ser `null`, não 0%.
   * "Ainda não decidiu nada" e "decidiu e empatou" são coisas diferentes.
   */
  it("sem posição nenhuma, tudo que é média é `null` — nunca 0%", () => {
    const d = desempenhoDaInstancia([], null);
    expect(d.decididas).toBe(0);
    expect(d.acertoPct).toBeNull();
    expect(d.liquidoPorOpPct).toBeNull();
    expect(d.liquidoComExpiradasPct).toBeNull();
    expect(d.pinta).toBe(false);
  });

  it("uma operação vencedora NÃO ganha cor de veredito", () => {
    // O painel do Valhalla exibia +1,19% de UMA operação com o mesmo peso
    // visual de uma média de 268.
    const d = desempenhoDaInstancia([p({ resultadoPct: 12 })], 0);
    expect(d.liquidoPorOpPct).toBe(12);
    expect(d.pinta).toBe(false);
  });

  it("acima do limiar, o número passa a sustentar veredito", () => {
    const muitas = Array.from({ length: 40 }, (_, i) =>
      p({ status: i % 2 === 0 ? "ganhou" : "perdeu", resultadoPct: i % 2 === 0 ? 3 : -1 }));
    const d = desempenhoDaInstancia(muitas, 0);
    expect(d.decididas).toBe(40);
    expect(d.pinta).toBe(true);
    expect(d.acertoPct).toBe(50);
    expect(d.liquidoPorOpPct).toBe(1);
  });
});

describe("`expirada` não é nem ganho nem perda — cicatriz do flywheel", () => {
  const linhas = [
    p({ status: "ganhou", resultadoPct: 4 }),
    p({ status: "perdeu", resultadoPct: -2 }),
    p({ status: "expirada", resultadoPct: -0.4 }),
    p({ status: "expirada", resultadoPct: 0.2 }),
    p({ status: "aberta", resultadoPct: null, fechadaEmMs: null }),
  ];

  it("as quatro classes são contadas em separado", () => {
    const d = desempenhoDaInstancia(linhas, 0);
    expect({ dec: d.decididas, alvo: d.alvo, stop: d.stop, exp: d.expiradas, ab: d.abertas })
      .toEqual({ dec: 2, alvo: 1, stop: 1, exp: 2, ab: 1 });
  });

  it("o acerto sai só das decididas: 1 de 2, não 1 de 4", () => {
    expect(desempenhoDaInstancia(linhas, 0).acertoPct).toBe(50);
  });

  /**
   * ⚠️ AS DUAS MÉDIAS CONTAM HISTÓRIAS DIFERENTES, e por isso as duas existem:
   * a primeira diz se a TESE paga, a segunda diz o que o período REALMENTE
   * rendeu. Publicar só a primeira numa mesa que expira metade dos sinais é
   * escolher o número bonito.
   */
  it("uma média sem as expiradas, outra com — e elas divergem", () => {
    const d = desempenhoDaInstancia(linhas, 0);
    expect(d.liquidoPorOpPct).toBeCloseTo(1, 10);          // (4 − 2) / 2
    expect(d.liquidoComExpiradasPct).toBeCloseTo(0.45, 10); // (4 − 2 − 0,4 + 0,2) / 4
  });

  /**
   * ⚠️⚠️ A COR SAI DAS DECIDIDAS. Uma instância com 40 expiradas e 2 decididas
   * tem amostra de DOIS para efeito de veredito — pintá-la de verde por causa
   * do 40 é exatamente o que o painel do Valhalla fazia.
   */
  it("quarenta expiradas não compram cor para duas decididas", () => {
    const muitas = [
      ...Array.from({ length: 40 }, () => p({ status: "expirada", resultadoPct: 0.1 })),
      p({ status: "ganhou", resultadoPct: 5 }),
      p({ status: "perdeu", resultadoPct: -1 }),
    ];
    const d = desempenhoDaInstancia(muitas, 0);
    expect(d.decididas).toBe(2);
    expect(d.pinta).toBe(false);
  });
});

describe("ausência continua ausência", () => {
  it("`resultadoPct` nulo não entra na média como zero", () => {
    // ⚠️ `Number(null)` é 0 e passa em `isFinite` — a cicatriz mais barata de
    // repetir nesta base. Uma decidida sem resultado gravado puxaria a média
    // para baixo como se tivesse empatado.
    const d = desempenhoDaInstancia(
      [p({ status: "ganhou", resultadoPct: 4 }), p({ status: "perdeu", resultadoPct: null })], 0,
    );
    expect(d.decididas).toBe(2);
    expect(d.liquidoPorOpPct).toBe(4);
  });

  it("sem carimbo de quando ligou, o tempo decorrido é `null`, não zero", () => {
    // Número sem tempo decorrido é o mesmo defeito do número sem amostra.
    const d = desempenhoDaInstancia([p()], null);
    expect(d.desdeMs).toBeNull();
    expect(d.horasRodando).toBeNull();
  });

  it("com carimbo, conta as horas de verdade", () => {
    const d = desempenhoDaInstancia([p()], 0, 72 * H);
    expect(d.horasRodando).toBeCloseTo(72, 10);
  });
});

describe("o investidor vê QUAL regra operou", () => {
  it("conta por playbook, e só o que fechou", () => {
    const d = desempenhoDaInstancia([
      p({ playbook: "pullback_ema" }),
      p({ playbook: "pullback_ema", status: "perdeu", resultadoPct: -1 }),
      p({ playbook: "pivot_reversion", status: "expirada", resultadoPct: 0 }),
      // ⚠️ Aberta NÃO conta: ela não produziu desfecho, e contá-la misturaria
      // intenção com resultado.
      p({ playbook: "obv_thrust", status: "aberta", resultadoPct: null, fechadaEmMs: null }),
    ], 0);
    expect(d.porPlaybook).toEqual({ pullback_ema: 2, pivot_reversion: 1 });
  });

  it("conta os símbolos em que de fato operou", () => {
    const d = desempenhoDaInstancia([
      p({ simbolo: "BTC" }), p({ simbolo: "BTC", status: "perdeu", resultadoPct: -1 }),
      p({ simbolo: "ETH", status: "expirada", resultadoPct: 0 }),
      p({ simbolo: "SOL", status: "aberta", resultadoPct: null, fechadaEmMs: null }),
    ], 0);
    expect(d.simbolos).toBe(2);
  });
});
