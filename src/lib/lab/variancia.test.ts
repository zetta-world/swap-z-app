/**
 * AS TRAVAS DO PRÊMIO DE VARIÂNCIA.
 *
 * ⚠️ ESTA FASE INVERTE UMA REGRA DA CASA, E A INVERSÃO PRECISA DE TESTE.
 *
 * Em todo o resto do laboratório eu briguei PELA mediana contra a média —
 * `stats.ts` existe por causa de um erro de mediana que inflava todo número que
 * eu reportava. Aqui é ao contrário: venda de volatilidade tem mediana positiva
 * quase sempre e média arrastada pela cauda, então a MÉDIA é que julga.
 *
 * Uma regra invertida sem teste é uma regra que alguém "corrige" de volta seis
 * meses depois, com a melhor das intenções.
 */

import { describe, it, expect } from "vitest";
import {
  volRealizadaAnualPct, construirVrp, resumirVrp, vereditoVrp,
  janelasIndependentes, MIN_JANELAS_INDEPENDENTES,
} from "@/lib/lab/variancia";

/** Série de preços com retorno diário constante em módulo, sinal alternado. */
function serie(n: number, passo: number): number[] {
  const out = [100];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + (i % 2 ? passo : -passo)));
  return out;
}

describe("volatilidade realizada — NÃO é o ATR que já existe", () => {
  it("preço parado tem volatilidade zero", () => {
    expect(volRealizadaAnualPct([100, 100, 100, 100])).toBeCloseTo(0, 10);
  });

  it("cresce com o tamanho do movimento diário", () => {
    const calma = volRealizadaAnualPct(serie(200, 0.005))!;
    const agitada = volRealizadaAnualPct(serie(200, 0.02))!;
    expect(agitada).toBeGreaterThan(calma * 3);
  });

  /**
   * 1% ao dia, anualizado por √365, dá ~19,1%. É a conta que dá para conferir
   * na mão — sem ela, "vol de 60%" é um número que ninguém audita.
   */
  it("1% ao dia dá ~19% ao ano — a conta confere na mão", () => {
    const v = volRealizadaAnualPct(serie(400, 0.01))!;
    expect(v).toBeGreaterThan(18);
    expect(v).toBeLessThan(20);
  });

  it("amostra curta devolve null, não um número pequeno", () => {
    expect(volRealizadaAnualPct([100])).toBeNull();
    expect(volRealizadaAnualPct([100, 101])).toBeNull();
  });

  /**
   * Preço zero ou negativo quebraria o log. Pular é certo; propagar NaN daria
   * um número que a tela mostraria como "—" e alguém leria como "sem dado".
   */
  it("preço inválido é pulado, não vira NaN", () => {
    const v = volRealizadaAnualPct([100, 0, 101, 102, 103]);
    expect(v).not.toBeNull();
    expect(Number.isFinite(v!)).toBe(true);
  });
});

describe("o alinhamento é PARA A FRENTE", () => {
  const dias = Array.from({ length: 90 }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));

  /**
   * ⚠️ A ARMADILHA Nº 4 DO PLANO. DVOL(D) prevê D..D+30. Casar com D−30..D
   * mediria a persistência da volatilidade, não o prêmio de quem vendeu — e
   * daria um número plausível, que é o pior tipo de errado.
   *
   * O teste constrói um mundo em que passado e futuro são MUITO diferentes:
   * calmo na primeira metade, agitado na segunda. Se o alinhamento fosse para
   * trás, a realizada do ponto do meio seria a baixa.
   */
  it("usa a volatilidade dos 30 dias SEGUINTES, não dos 30 anteriores", () => {
    const fech = new Map<string, number>();
    let p = 100;
    dias.forEach((d, i) => {
      p *= 1 + (i < 45 ? 0.0005 : 0.03) * (i % 2 ? 1 : -1);
      fech.set(d, p);
    });
    // Uma implícita no dia 40: os 30 dias seguintes caem na parte AGITADA.
    const iv = new Map([[dias[40], 50]]);
    const { pontos } = construirVrp(iv, fech, 30);
    expect(pontos).toHaveLength(1);

    /**
     * O CONTRASTE É A PROVA, não o tamanho do número.
     *
     * ⚠️ A primeira versão deste teste afirmava `> 100`, um limiar que eu
     * inventei sem calcular. O valor real para a frente é 53,4 e para trás é
     * 1,0 — a premissa estava certa e o número, chutado. Um teste que passa por
     * um limiar arbitrário não prova o alinhamento; prova que o número é
     * grande. Agora ele compara os dois lados e exige uma ordem de grandeza.
     */
    const paraTras = volRealizadaAnualPct(
      dias.slice(10, 41).map((d) => fech.get(d)!),
    )!;
    expect(pontos[0].realizadaPct).toBeGreaterThan(paraTras * 10);
    expect(paraTras).toBeLessThan(5);
    expect(pontos[0].realizadaPct).toBeGreaterThan(40);
  });

  /**
   * Janela incompleta contada como completa é como a medição de funding de
   * 04/08 virou 1,4%: o número sai, ninguém vê que faltou metade.
   */
  it("os últimos dias saem da conta e viram contagem, não zero", () => {
    const fech = new Map(dias.map((d, i) => [d, 100 + i]));
    // Implícita nos últimos 5 dias: não há 30 dias de futuro para nenhum.
    const iv = new Map(dias.slice(-5).map((d) => [d, 50]));
    const { pontos, semFuturo } = construirVrp(iv, fech, 30);
    expect(pontos).toHaveLength(0);
    expect(semFuturo).toBe(5);
  });

  it("implícita em dia sem preço é ignorada, sem inventar fechamento", () => {
    const fech = new Map(dias.map((d, i) => [d, 100 + i]));
    const iv = new Map([["1999-01-01", 50], [dias[0], 60]]);
    const { pontos } = construirVrp(iv, fech, 30);
    expect(pontos.map((p) => p.dia)).toEqual([dias[0]]);
  });
});

describe("a MÉDIA julga aqui, e a mediana só expõe a assimetria", () => {
  /**
   * ⚠️ A INVERSÃO, com números. Vinte janelas de +2 e uma de −60: a mediana diz
   * +2 (parece ótimo) e a média diz −0,95 (é ruim). Este é o formato exato do
   * retorno de quem vende opção, e é por isso que a regra do resto do
   * laboratório não vale nesta fase.
   */
  const pontos = [
    ...Array.from({ length: 20 }, (_, i) => ({
      dia: `d${i}`, implicitaPct: 60, realizadaPct: 58, vrpPct: 2,
    })),
    { dia: "crash", implicitaPct: 60, realizadaPct: 120, vrpPct: -60 },
  ];

  it("a mediana diz +2 e a média diz negativo — as duas saem", () => {
    const r = resumirVrp(pontos)!;
    expect(r.medianaPct).toBe(2);
    expect(r.mediaPct).toBeLessThan(0);
  });

  it("média negativa REPROVA mesmo com mediana positiva", () => {
    const r = resumirVrp(pontos)!;
    const v = vereditoVrp({ ...r, n: 300 }, 30);
    expect(v.status).toBe("morta");
    expect(v.verdict).toContain("NÃO paga");
    // E a mediana bonita aparece do lado, para a assimetria ficar visível.
    expect(v.verdict).toContain("mediana");
  });

  it("a cauda de 5% é reportada, e nunca fica vazia com n pequeno", () => {
    const r = resumirVrp(pontos)!;
    expect(r.piorPct).toBe(-60);
    expect(Number.isFinite(r.cauda5Pct)).toBe(true);
    // Com n=21, ceil(21*0.05)=2 → média das duas piores.
    expect(r.cauda5Pct).toBeLessThan(0);
    // E com n=1 ainda existe cauda, em vez de NaN virando "—" na tela.
    const um = resumirVrp([pontos[0]])!;
    expect(Number.isFinite(um.cauda5Pct)).toBe(true);
  });

  it("a fração negativa conta as janelas em que o vendedor perdeu", () => {
    expect(resumirVrp(pontos)!.fracaoNegativa).toBeCloseTo(1 / 21, 6);
  });
});

describe("janelas sobrepostas não são amostra", () => {
  /**
   * ⚠️ A INFLAÇÃO DE AMOSTRA DA FASE 4, com outra roupa. Lá era o mesmo emissor
   * em seis cadeias; aqui é o mesmo mês contado trinta vezes.
   */
  it("300 janelas diárias de 30 dias são ~10 independentes", () => {
    expect(janelasIndependentes(300, 30)).toBe(10);
    expect(janelasIndependentes(29, 30)).toBe(0);
  });

  it("abaixo do piso de janelas independentes é INCONCLUSIVO, não reprovado", () => {
    const bons = Array.from({ length: 100 }, (_, i) => ({
      dia: `d${i}`, implicitaPct: 60, realizadaPct: 50, vrpPct: 10,
    }));
    const v = vereditoVrp(resumirVrp(bons), 30);
    expect(v.status).toBe("cinza");
    expect(v.readable).toBe(false);
    expect(v.verdict).toContain(`piso de ${MIN_JANELAS_INDEPENDENTES}`);
    // E diz POR QUE 100 não são 100.
    expect(v.verdict).toContain("mesmo mês trinta vezes");
  });

  it("prêmio positivo com amostra suficiente aprova — e declara o que falta", () => {
    const bons = Array.from({ length: 300 }, (_, i) => ({
      dia: `d${i}`, implicitaPct: 60, realizadaPct: 50, vrpPct: 10,
    }));
    const v = vereditoVrp(resumirVrp(bons), 30);
    expect(v.status).toBe("verde");
    // ⚠️ Verde no PRÊMIO não é verde na estratégia, e o texto tem que dizer.
    expect(v.verdict).toContain("mede o PRÊMIO, não a estratégia");
    expect(v.verdict).toContain("teto de alta");
  });

  it("sem nenhuma janela utilizável é inconclusivo, nunca reprovado", () => {
    const v = vereditoVrp(null);
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("inconclusivo");
  });
});
