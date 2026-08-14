/**
 * RETORNO ÷ TOMBO — as três armadilhas da divisão crua.
 *
 * A conta é trivial; as guardas é que são o módulo. Cada teste abaixo
 * corresponde a uma leitura errada que a divisão sem guarda produziria numa
 * coluna ordenada.
 */

import { describe, it, expect } from "vitest";
import {
  razaoRetornoTombo, lerRazao, comparaveis, PORQUE_SEM_RAZAO, UNIDADE_DO_RETORNO,
} from "@/lib/lab/retorno-tombo";
import { LAB_STRATEGIES } from "@/lib/lab/registry";

describe("a conta, quando ela é legítima", () => {
  it("15%/ano com 10% de tombo dá 1,50", () => {
    const r = razaoRetornoTombo(15, 10, "nivel");
    expect(r.razao).toBeCloseTo(1.5, 6);
  });

  it("30%/ano com 45% de tombo dá 0,67 — pior que a de cima", () => {
    expect(razaoRetornoTombo(30, 45, "nivel").razao).toBeCloseTo(0.667, 3);
  });

  it("aceita tombo gravado como negativo — as medições não concordam no sinal", () => {
    expect(razaoRetornoTombo(15, -10, "nivel").razao).toBeCloseTo(1.5, 6);
  });

  /** Os dois casos reais que motivaram o módulo. */
  it("coberta 9,26/46,10 fica em 0,20 e funding 0,68/5,88 em 0,12", () => {
    expect(razaoRetornoTombo(9.258, 46.10, "vantagem").razao).toBeCloseTo(0.201, 3);
    expect(razaoRetornoTombo(0.676, 5.88, "nivel").razao).toBeCloseTo(0.115, 3);
  });
});

describe("as armadilhas", () => {
  /**
   * ⚠️ `15 / 0 = Infinity` sentaria no topo de qualquer ordenação PARA SEMPRE.
   * A `carteira_verde` mediu tombo 0,00 com amostra EFETIVA de 4: coroar essa
   * linha seria premiar a falta de dado.
   */
  it("tombo ZERO não vira razão infinita", () => {
    const r = razaoRetornoTombo(15, 0, "nivel");
    expect(r.razao).toBeNull();
    expect(r).toMatchObject({ motivo: "tombo_zero" });
    expect(PORQUE_SEM_RAZAO.tombo_zero).toContain("janela curta");
  });

  /**
   * ⚠️ `−5/10 = −0,5` senta ACIMA de `−0,8` numa ordenação crescente e sugere
   * que perder menos é uma qualidade que a razão mede. Não é.
   */
  it("retorno NEGATIVO não vira razão ruim — vira nada", () => {
    expect(razaoRetornoTombo(-5, 10, "nivel")).toMatchObject({ razao: null, motivo: "retorno_negativo" });
    expect(razaoRetornoTombo(-50, 60, "nivel").razao).toBeNull();
  });

  /**
   * ⚠️ A INVARIANTE Nº 17 APLICADA À RAZÃO. O padrão é `desconhecida` de
   * propósito: assumir "nível" sem ninguém conferir misturaria vantagem com
   * nível em silêncio, que é exatamente o que este campo impede.
   */
  it("sem declarar a unidade, NÃO há razão", () => {
    expect(razaoRetornoTombo(15, 10)).toMatchObject({ razao: null, motivo: "unidade_desconhecida" });
  });

  it("vantagem e nível não são comparáveis entre si", () => {
    const a = razaoRetornoTombo(9.26, 46.1, "vantagem");
    const b = razaoRetornoTombo(3.04, 12, "nivel");
    expect(a.razao).not.toBeNull();
    expect(b.razao).not.toBeNull();
    expect(comparaveis(a, b)).toBe(false);
    expect(comparaveis(a, razaoRetornoTombo(1, 2, "vantagem"))).toBe(true);
  });

  it("dado ausente diz QUAL dado faltou", () => {
    expect(razaoRetornoTombo(null, 10, "nivel")).toMatchObject({ motivo: "sem_retorno" });
    expect(razaoRetornoTombo(10, null, "nivel")).toMatchObject({ motivo: "sem_tombo" });
    expect(razaoRetornoTombo(Number.NaN, 10, "nivel")).toMatchObject({ motivo: "sem_retorno" });
  });

  it("todo motivo tem frase de tela — motivo sem frase vira célula muda", () => {
    for (const [k, v] of Object.entries(PORQUE_SEM_RAZAO)) expect(v.trim().length, k).toBeGreaterThan(15);
  });
});

describe("lerRazao — texto de tela, nunca portão", () => {
  it("nomeia as faixas", () => {
    expect(lerRazao(1.6)).toContain("forte");
    expect(lerRazao(1.2)).toContain("boa");
    expect(lerRazao(0.7)).toContain("modesta");
    expect(lerRazao(0.2)).toContain("fraca");
  });
});

/**
 * ⚠️ UM SLUG ERRADO AQUI DESLIGA A RAZÃO EM SILÊNCIO. `UNIDADE_DO_RETORNO`
 * é consultado por chave; um typo cai em `desconhecida`, a célula fica "—", e
 * ninguém descobre que a linha perdeu a coluna — só que ela "não tem tombo".
 */
describe("UNIDADE_DO_RETORNO aponta para estratégias que existem", () => {
  it("toda chave é um slug do registro", () => {
    const slugs = new Set(LAB_STRATEGIES.map((s) => s.slug));
    for (const k of Object.keys(UNIDADE_DO_RETORNO)) expect(slugs.has(k), k).toBe(true);
  });

  it("nenhuma declara `desconhecida` — isso é o padrão, não uma declaração", () => {
    for (const [k, v] of Object.entries(UNIDADE_DO_RETORNO)) {
      expect(v, k).not.toBe("desconhecida");
    }
  });
});
