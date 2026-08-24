import { describe, it, expect } from "vitest";
import {
  decompor, usdtProduzido, capitalAportado, extratoDe, julgarMutacao, ranquear,
  curvaAcumulada, contraOPiso, PISO_MINIMO_PARA_RAZAO,
  retornoSobreCapital, BANCA_MINIMA_PARA_RETORNO,
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

describe("a curva do minigráfico", () => {
  const emT = (t: number, usdt: number): Fluxo =>
    ({ agente: "a", causa: "preco", usdt, ocorreuEmMs: t });

  /**
   * ⚠️ ACUMULADO, NÃO POR LANÇAMENTO. Uma série de valores soltos mostraria a
   * volatilidade do lançamento e esconderia a pergunta do Celeiro, que é quanto
   * USDT existe a MAIS. A linha tem de subir quando o agente produz.
   */
  it("acumula em vez de listar os lançamentos", () => {
    expect(curvaAcumulada([emT(1, 1), emT(2, 2), emT(3, 3)])).toEqual([1, 3, 6]);
  });

  /**
   * ⚠️ ORDENA POR TEMPO ANTES DE SOMAR. Fluxo fora de ordem produziria uma
   * curva que sobe e desce sem o agente ter feito nada — e a forma do gráfico é
   * justamente o que a pessoa lê primeiro.
   */
  it("ordena por tempo, mesmo recebendo fora de ordem", () => {
    expect(curvaAcumulada([emT(3, 3), emT(1, 1), emT(2, 2)])).toEqual([1, 3, 6]);
  });

  /** ⚠️ APORTE FORA: depositar não é render, e o degrau pareceria um dia ótimo. */
  it("aporte não entra na curva", () => {
    const fluxos: Fluxo[] = [
      emT(1, 1),
      { agente: "a", causa: "aporte", usdt: 1000, ocorreuEmMs: 2 },
      emT(3, 1),
    ];
    expect(curvaAcumulada(fluxos)).toEqual([1, 2]);
  });

  it("série vazia não vira ponto solto", () => {
    expect(curvaAcumulada([])).toEqual([]);
  });

  it("reduz a série longa sem perder as pontas", () => {
    const muitos = Array.from({ length: 500 }, (_, i) => emT(i, 1));
    const c = curvaAcumulada(muitos, 40);
    expect(c).toHaveLength(40);
    expect(c[0]).toBe(1);
    expect(c[c.length - 1]).toBe(500);
  });
});

describe("a comparação com o piso", () => {
  /**
   * ⚠️⚠️ O CASO REAL QUE MOTIVOU A FUNÇÃO. Piso em 0,0725 e agente em 1,3661 —
   * a porcentagem honesta dá **+1.784%**, que não cabe na coluna e ainda passa
   * impressão de erro de cálculo. Acima de 10× a leitura vira MÚLTIPLO.
   */
  it("razão grande vira múltiplo, não porcentagem", () => {
    const c = contraOPiso(1.3661, 0.0725, false);
    expect(c.forma).toBe("vezes");
    expect(c.valor).toBeCloseTo(18.84, 1);
    expect(c.usdt).toBeCloseTo(1.2936, 6);
  });

  it("razão pequena continua em porcentagem", () => {
    const c = contraOPiso(1.1, 1.0, false);
    expect(c.forma).toBe("pct");
    expect(c.valor).toBeCloseTo(10, 6);
  });

  /**
   * ⚠️ PISO ~ZERO NÃO PRODUZ RAZÃO. Dividir por quase-nada devolveria número
   * gigante ou infinito — e a diferença em USDT, que é sempre verdadeira,
   * continua sendo entregue.
   */
  it("piso perto de zero devolve sem_base, e nunca infinito", () => {
    const c = contraOPiso(5, 0.0001, false);
    expect(c.forma).toBe("sem_base");
    expect(c.valor).toBeNull();
    expect(c.usdt).toBeCloseTo(4.9999, 6);
    expect(Number.isFinite(c.usdt)).toBe(true);
    expect(Math.abs(0.0001)).toBeLessThan(PISO_MINIMO_PARA_RAZAO);
  });

  /** O próprio piso não se compara consigo: a diferença é zero por definição. */
  it("o piso é marcado e não vira 0% nem 1×", () => {
    const c = contraOPiso(0.0725, 0.0725, true);
    expect(c.forma).toBe("piso");
    expect(c.usdt).toBe(0);
    expect(c.valor).toBeNull();
  });

  /** Agente abaixo do piso mantém o sinal negativo em USDT. */
  it("abaixo do piso, a diferença é negativa", () => {
    const c = contraOPiso(0.5, 1.0, false);
    expect(c.usdt).toBeCloseTo(-0.5, 9);
    expect(c.forma).toBe("pct");
    expect(c.valor).toBeCloseTo(-50, 6);
  });
});

describe("o retorno sobre capital", () => {
  /**
   * ⚠️⚠️ O VIÉS QUE ELE CONSERTA, COM NÚMEROS QUE O EXPÕEM. Dois agentes
   * produzem o MESMO USDT — mas um administra $1.000 e o outro $300. Em USDT
   * absoluto eles empatam; sobre capital, o segundo rende 3,3× mais.
   *
   * O placar anterior comparava USDT e premiava quem arrisca mais, que é o pior
   * viés possível num placar de risco.
   */
  it("dois agentes com o MESMO USDT não empatam se a banca difere", () => {
    const grande = retornoSobreCapital(10, 1000, null);
    const pequeno = retornoSobreCapital(10, 300, null);
    expect(grande.pct).toBeCloseTo(1, 6);
    expect(pequeno.pct).toBeCloseTo(3.333, 3);
    expect(pequeno.pct!).toBeGreaterThan(grande.pct!);
  });

  it("compara com o piso em pontos percentuais", () => {
    const r = retornoSobreCapital(20, 1000, 1.2);
    expect(r.pct).toBeCloseTo(2, 6);
    expect(r.contraOPisoPp).toBeCloseTo(0.8, 6);
    expect(r.porque).toContain("do piso");
  });

  /** Abaixo do piso, a diferença fica negativa — sem maquiagem. */
  it("agente abaixo do piso mostra diferença negativa", () => {
    const r = retornoSobreCapital(2, 1000, 1.2);
    expect(r.contraOPisoPp).toBeCloseTo(0.2 - 1.2, 6);
  });

  /** ⚠️ Banca ~zero não produz retorno — devolve null em vez de estourar. */
  it("banca insuficiente devolve null, e nunca um número gigante", () => {
    const r = retornoSobreCapital(5, 0, 1);
    expect(r.pct).toBeNull();
    expect(r.contraOPisoPp).toBeNull();
    expect(BANCA_MINIMA_PARA_RETORNO).toBeGreaterThan(0);
  });

  it("sem retorno do piso, devolve só o próprio", () => {
    const r = retornoSobreCapital(10, 1000, null);
    expect(r.pct).toBeCloseTo(1, 6);
    expect(r.contraOPisoPp).toBeNull();
  });
});
