import { describe, it, expect } from "vitest";
import {
  decompor, usdtProduzido, capitalAportado, extratoDe, julgarMutacao, ranquear,
  MINIMO_POR_BRACO, CAUSAS_DE_RESULTADO, type Fluxo,
} from "@/lib/celeiro/fluxo";

/**
 * O EXTRATO — os testes que fazem a decomposição valer alguma coisa.
 *
 * ⚠️ CADA CASO AQUI DISTINGUE. A arena antiga tinha um teste de mediana que
 * passava se trocássemos mediana por MÉDIA, porque os três casos tinham as duas
 * iguais — oito asserções verdes provando nada. Os números abaixo foram
 * escolhidos para que a troca de uma operação por outra QUEBRE.
 */

/** Atalho para montar fluxo sem repetir campos. */
function f(agente: string, causa: Fluxo["causa"], usdt: number, extra: Partial<Fluxo> = {}): Fluxo {
  return { agente, causa, usdt, ocorreuEmMs: 0, ...extra };
}

describe("a decomposição do USDT", () => {
  it("soma cada causa separadamente e não mistura agentes", () => {
    const fluxos = [
      f("a", "taxa", -3.1), f("a", "funding", 1.2), f("a", "preco", -2.4),
      f("b", "taxa", -99),
    ];
    const d = decompor(fluxos.filter((x) => x.agente === "a"));
    expect(d.taxa).toBeCloseTo(-3.1, 6);
    expect(d.funding).toBeCloseTo(1.2, 6);
    expect(d.preco).toBeCloseTo(-2.4, 6);
    expect(d.aluguel).toBe(0);
  });

  /**
   * ⚠️ APORTE NÃO É RESULTADO — o teste que impede depósito de virar lucro.
   *
   * Os números são assimétricos de propósito: se alguém somar o aporte ao
   * resultado, o total sai +995,70 em vez de −4,30, e a diferença é grande
   * demais para passar despercebida.
   */
  it("aporte fica FORA do resultado", () => {
    const fluxos = [
      f("a", "aporte", 1000), f("a", "taxa", -3.1),
      f("a", "funding", 1.2), f("a", "preco", -2.4),
    ];
    expect(usdtProduzido(fluxos)).toBeCloseTo(-4.3, 6);
    expect(capitalAportado(fluxos)).toBe(1000);
    expect(CAUSAS_DE_RESULTADO).not.toContain("aporte");
  });

  /**
   * ⚠️ O CASO QUE MOTIVOU O MÓDULO INTEIRO. Reproduz o `hybrid_scan`: acerta
   * muito e perde mesmo assim. O extrato tem de dizer ONDE, e a maior sangria
   * aqui é TAXA — não preço. É essa distinção que o placar antigo não fazia.
   */
  it("aponta a maior sangria, mesmo quando o preço foi favorável", () => {
    const fluxos = [
      f("maker", "preco", 6.0),      // o mercado até ajudou
      f("maker", "taxa", -8.5),      // e a corretagem comeu tudo
      f("maker", "derrapagem", -1.5),
    ];
    const e = extratoDe("maker", fluxos);
    expect(e.usdt).toBeCloseTo(-4.0, 6);
    expect(e.vazamentos[0].causa).toBe("taxa");
    expect(e.vazamentos[0].fatiaDoVazamento).toBeCloseTo(8.5 / 10.0, 6);
    expect(e.fontes[0].causa).toBe("preco");
    expect(e.resumo).toContain("taxa -8.50");
  });

  it("agente sem nenhum fluxo diz que não tem dado, e não zero", () => {
    const e = extratoDe("ninguem", []);
    expect(e.usdt).toBe(0);
    expect(e.resumo).toContain("sem dado");
  });
});

describe("o julgamento da mutação", () => {
  /** Monta N lançamentos de um braço com o mesmo valor unitário. */
  function braco(b: "controle" | "mutacao", n: number, cada: number): Fluxo[] {
    return Array.from({ length: n }, () => f("x", "preco", cada, { braco: b }));
  }

  /**
   * ⚠️ O VEREDITO MAIS IMPORTANTE DOS TRÊS. Sem `inconclusiva`, uma amostra de
   * dois lançamentos empurraria para "pagou" e o Investigador seria premiado
   * por ruído — e um investigador premiado por ruído aprende a produzir ruído.
   */
  it("braço fraco dá inconclusiva, mesmo com diferença enorme", () => {
    const fluxos = [...braco("controle", 40, -1), ...braco("mutacao", 2, +50)];
    const j = julgarMutacao(fluxos);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.porque).toContain("2 lançamentos");
    // A diferença EXISTE e é gritante — e mesmo assim não decide.
    expect(j.diferenca).toBeGreaterThan(100);
  });

  /**
   * ⚠️ É O BRAÇO FRACO QUE MANDA, não a soma. 40 + 19 = 59 lançamentos, e
   * mesmo assim inconclusiva. Trocar `Math.min` por soma ou média quebra aqui.
   */
  it("o mínimo olha o braço fraco, não o total", () => {
    /**
     * ⚠️ A MUTAÇÃO É CLARAMENTE MELHOR NOS DOIS CASOS (95 e 100 contra 40), e
     * isso é de propósito: assim a ÚNICA diferença entre eles é o tamanho do
     * braço fraco. Se os dois empatassem em USDT, o primeiro cairia em
     * "nao_pagou" e o teste passaria verde sem provar nada sobre a amostra.
     */
    const noLimite = [...braco("controle", 40, +1), ...braco("mutacao", MINIMO_POR_BRACO - 1, +5)];
    expect(julgarMutacao(noLimite).veredito).toBe("inconclusiva");

    const suficiente = [...braco("controle", 40, +1), ...braco("mutacao", MINIMO_POR_BRACO, +5)];
    expect(julgarMutacao(suficiente).veredito).toBe("pagou");
  });

  it("mutação pior que o controle manda reverter", () => {
    const fluxos = [...braco("controle", 25, +2), ...braco("mutacao", 25, +1)];
    const j = julgarMutacao(fluxos);
    expect(j.veredito).toBe("nao_pagou");
    expect(j.diferenca).toBeCloseTo(-25, 6);
    expect(j.porque).toContain("reverter");
  });

  /**
   * ⚠️ TOTAL, NÃO MÉDIA. O objetivo declarado é ACUMULAR USDT — 60 lançamentos
   * de +1 (total 60) valem mais que 25 de +2 (total 50), ainda que a média do
   * segundo seja o dobro. Se alguém trocar a soma por média, este caso inverte.
   */
  it("julga por USDT total acumulado, não por média por lançamento", () => {
    const fluxos = [...braco("controle", 25, +2), ...braco("mutacao", 60, +1)];
    const j = julgarMutacao(fluxos);
    expect(j.usdtControle).toBeCloseTo(50, 6);
    expect(j.usdtMutacao).toBeCloseTo(60, 6);
    expect(j.veredito).toBe("pagou");
  });
});

describe("o ranking da faixa", () => {
  /**
   * ⚠️ O CONTROLE APARECE NA TABELA E PODE GANHAR. Se o piso vencer, é
   * resultado legítimo — a resposta certa é guardar USDT rendendo, não inventar
   * um agente para salvar a tese.
   */
  it("mede todo mundo contra o controle, e o controle pode liderar", () => {
    const fluxos = [
      f("aluguel_ocioso", "aluguel", +12),
      f("colheita_funding", "funding", +9), f("colheita_funding", "taxa", -4.5),
      f("maker_de_faixa", "preco", +3), f("maker_de_faixa", "taxa", -6),
    ];
    const r = ranquear(fluxos, ["aluguel_ocioso", "colheita_funding", "maker_de_faixa"], "aluguel_ocioso");

    expect(r[0].agente).toBe("aluguel_ocioso");
    expect(r[0].ehControle).toBe(true);
    expect(r[0].acimaDoControle).toBe(0);

    // Os dois que operam ficaram ABAIXO de simplesmente emprestar o USDT.
    expect(r[1].agente).toBe("colheita_funding");
    expect(r[1].acimaDoControle).toBeCloseTo(4.5 - 12, 6);
    expect(r[2].acimaDoControle).toBeLessThan(0);
  });
});
