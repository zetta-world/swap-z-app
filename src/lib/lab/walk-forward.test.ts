/**
 * WALK-FORWARD — a disciplina que separa escolher de medir.
 *
 * ⚠️ O teste que mais importa aqui não mede número: mede que a função de
 * escolha NÃO CONSEGUE ver o teste. É a única razão de o módulo existir.
 */

import { describe, it, expect } from "vitest";
import {
  montarDobras, rodarWalkForward, porDia, vereditoWalkForward, MIN_DOBRAS,
} from "@/lib/lab/walk-forward";

const serie = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("montarDobras — fatias de teste DISJUNTAS por construção", () => {
  it("encadeia treino e teste na ordem do tempo", () => {
    const d = montarDobras(100, { treinoDias: 60, testeDias: 20 });
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ treinoIni: 0, treinoFim: 60, testeIni: 60, testeFim: 80 });
    expect(d[1]).toMatchObject({ treinoIni: 20, treinoFim: 80, testeIni: 80, testeFim: 100 });
  });

  /**
   * ⚠️ SE ESTE TESTE CAIR, a amostra infla sem nada mudar na tela: o mesmo dia
   * entra em duas dobras e conta duas vezes. É a invariante nº 26 na forma de
   * calendário.
   */
  it("nenhuma fatia de teste toca a seguinte", () => {
    const d = montarDobras(500, { treinoDias: 100, testeDias: 30 });
    expect(d.length).toBeGreaterThan(3);
    for (let i = 1; i < d.length; i++) {
      expect(d[i].testeIni).toBe(d[i - 1].testeFim);
    }
  });

  it("série curta demais não produz dobra nenhuma", () => {
    expect(montarDobras(50, { treinoDias: 60, testeDias: 20 })).toEqual([]);
    expect(montarDobras(0, { treinoDias: 10, testeDias: 5 })).toEqual([]);
  });

  it("parâmetro degenerado devolve vazio em vez de laço infinito", () => {
    expect(montarDobras(100, { treinoDias: 10, testeDias: 0 })).toEqual([]);
    expect(montarDobras(100, { treinoDias: 0, testeDias: 10 })).toEqual([]);
  });
});

describe("porDia — normaliza janelas de tamanhos diferentes", () => {
  /**
   * ⚠️ SEM ISTO, TODA LEITURA DE DEGRADAÇÃO SERIA ARTEFATO DO TAMANHO DA
   * JANELA: "+9% em 360 dias" pareceria 4,5× melhor que "+2% em 90 dias",
   * quando as duas taxas diárias são quase idênticas.
   */
  it("+9% em 360 dias e +2% em 90 dias têm taxa diária parecida", () => {
    const a = porDia(9, 360)!;
    const b = porDia(2, 90)!;
    expect(Math.abs(a - b)).toBeLessThan(0.002);
  });

  it("é geométrica, não divisão", () => {
    // Dividir daria 0,5%/dia; compor 0,5%/dia por 100 dias daria +64%, não +50%.
    const taxa = porDia(50, 100)!;
    expect(taxa).toBeLessThan(0.5);
    expect(Math.pow(1 + taxa / 100, 100) - 1).toBeCloseTo(0.5, 6);
  });

  it("perda total devolve null em vez de -Infinity", () => {
    expect(porDia(-100, 30)).toBeNull();
    expect(porDia(-150, 30)).toBeNull();
  });

  it("dias inválidos devolvem null", () => {
    expect(porDia(10, 0)).toBeNull();
    expect(porDia(Number.NaN, 10)).toBeNull();
  });
});

describe("rodarWalkForward — a trava estrutural", () => {
  /**
   * ⚠️⚠️ O TESTE CENTRAL DO MÓDULO.
   *
   * A função de escolha recebe a fatia de treino e MAIS NADA. Se um dia alguém
   * mudar a assinatura para passar a série inteira "só para conferir uma
   * coisa", este teste cai — e a mudança vira uma decisão visível em revisão,
   * em vez de um vazamento silencioso.
   */
  it("a escolha NUNCA recebe um único dado da fatia de teste", () => {
    const dados = serie(200);
    const vistos: number[][] = [];
    rodarWalkForward(
      dados,
      (treino) => { vistos.push([...treino]); return { params: 1, resultadoPct: 1 }; },
      () => 1,
      { treinoDias: 100, testeDias: 25 },
    );
    expect(vistos).toHaveLength(4);
    vistos.forEach((treino, i) => {
      const testeIni = 100 + i * 25;
      // Nenhum elemento do treino pode pertencer à janela de teste da dobra.
      for (const x of treino) expect(x).toBeLessThan(testeIni);
    });
  });

  it("mede FORA com os parâmetros escolhidos DENTRO", () => {
    const wf = rodarWalkForward(
      serie(300),
      () => ({ params: "p", resultadoPct: 10 }),
      (p) => { expect(p).toBe("p"); return 4; },
      { treinoDias: 100, testeDias: 50 },
    );
    expect(wf.dobras).toHaveLength(4);
    expect(wf.dobras.every((d) => d.foraPct === 4)).toBe(true);
    expect(wf.suficiente).toBe(true);
  });

  /** Composto, não somado: as fatias são consecutivas e o capital atravessa. */
  it("compõe o retorno fora em vez de somar", () => {
    const wf = rodarWalkForward(
      serie(300), () => ({ params: 0, resultadoPct: 0 }), () => 10,
      { treinoDias: 100, testeDias: 50 },
    );
    // 4 dobras de +10% → 1.1^4 − 1 = 46,41%, não 40%.
    expect(wf.foraCompostoPct).toBeCloseTo(46.41, 2);
  });

  /**
   * ⚠️ DOBRA ILEGÍVEL NÃO VIRA ZERO. Tratar "não consegui medir" como 0%
   * gravaria "mediu e deu neutro" — invariante nº 6.
   */
  it("dobra que não dá para medir é DESCARTADA e contada, não zerada", () => {
    let n = 0;
    const wf = rodarWalkForward(
      serie(300), () => ({ params: 0, resultadoPct: 5 }),
      () => (++n === 2 ? Number.NaN : 5),
      { treinoDias: 100, testeDias: 50 },
    );
    expect(wf.dobras).toHaveLength(3);
    expect(wf.dobrasIlegiveis).toBe(1);
    expect(wf.foraPorDia).not.toBeNull();
  });

  it("avaliação que explode não derruba o walk-forward inteiro", () => {
    let n = 0;
    const wf = rodarWalkForward(
      serie(300), () => ({ params: 0, resultadoPct: 5 }),
      () => { if (++n === 1) throw new Error("fonte caiu"); return 5; },
      { treinoDias: 100, testeDias: 50 },
    );
    expect(wf.dobras).toHaveLength(3);
    expect(wf.dobrasIlegiveis).toBe(1);
  });

  it("sem dobra legível devolve tudo null, e nada de zero", () => {
    const wf = rodarWalkForward(serie(10), () => ({ params: 0, resultadoPct: 1 }), () => 1,
      { treinoDias: 100, testeDias: 50 });
    expect(wf.dentroPorDia).toBeNull();
    expect(wf.foraPorDia).toBeNull();
    expect(wf.foraCompostoPct).toBeNull();
    expect(wf.suficiente).toBe(false);
  });

  it("conta as dobras positivas fora — média não basta", () => {
    let n = 0;
    const wf = rodarWalkForward(
      serie(300), () => ({ params: 0, resultadoPct: 5 }),
      () => (++n === 1 ? 60 : -3),
      { treinoDias: 100, testeDias: 50 },
    );
    expect(wf.dobrasPositivas).toBe(1);
    expect(wf.consistencia).toBeCloseTo(0.25, 6);
  });
});

describe("vereditoWalkForward", () => {
  const wf = (foras: number[], dentro = 10) => rodarWalkForward(
    serie(100 + foras.length * 50),
    () => ({ params: 0, resultadoPct: dentro }),
    (() => { let i = 0; return () => foras[i++] ?? 0; })(),
    { treinoDias: 100, testeDias: 50 },
  );

  it("abaixo do piso de dobras é INCONCLUSIVA, mesmo positivo", () => {
    const v = vereditoWalkForward(wf([8, 9]));
    expect(v.status).toBe("inconclusiva");
    expect(v.texto).toContain(String(MIN_DOBRAS));
  });

  it("negativo fora da amostra é MORTA", () => {
    expect(vereditoWalkForward(wf([-2, -3, -1, -4])).status).toBe("morta");
  });

  /**
   * ⚠️ UMA DOBRA ENORME CARREGANDO CINCO NEGATIVAS não é estratégia — é uma
   * janela de sorte cercada de perdas. A média positiva sozinha aprovaria.
   */
  it("positivo na média mas em menos de metade das dobras é EMPATE", () => {
    const v = vereditoWalkForward(wf([200, -3, -2, -4, -1, -2]));
    expect(v.status).toBe("empate");
  });

  it("positivo e consistente é VERDE", () => {
    expect(vereditoWalkForward(wf([4, 5, -1, 6])).status).toBe("verde");
  });

  it("nenhuma dobra legível é INCONCLUSIVA e diz por quê", () => {
    const v = vereditoWalkForward(rodarWalkForward(
      serie(10), () => ({ params: 0, resultadoPct: 1 }), () => 1,
      { treinoDias: 100, testeDias: 50 },
    ));
    expect(v.status).toBe("inconclusiva");
    expect(v.texto).toContain("nenhuma dobra");
  });

  /** Degradação é esperada; o veredito olha SINAL e CONSISTÊNCIA, não queda. */
  it("cair de 18 para 12 continua VERDE — degradação não é reprovação", () => {
    expect(vereditoWalkForward(wf([12, 11, 13, 12], 18)).status).toBe("verde");
  });
});
