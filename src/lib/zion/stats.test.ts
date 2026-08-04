/**
 * A mediana que não era mediana — o teste que teria pego onze pontos.
 *
 * Ver a nota de cabeçalho em `stats.ts`. O resumo: duas rotas mediram o mesmo
 * mercado, na mesma janela, no mesmo dia, e disseram −17.99% e −6.74%. A
 * diferença inteira era `s[Math.floor(n / 2)]` no lugar da mediana.
 */

import { describe, it, expect } from "vitest";
import { median } from "@/lib/zion/stats";

describe("median", () => {
  it("com contagem ÍMPAR é o do meio", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("com contagem PAR é a média dos dois do meio, não o de cima", () => {
    // `s[Math.floor(4 / 2)]` daria 30. A mediana é 25.
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("vazio é null — não 0, que se confunde com 'mediu e deu zero'", () => {
    expect(median([])).toBeNull();
  });

  it("não depende da ordem de entrada", () => {
    expect(median([40, 10, 30, 20])).toBe(median([10, 20, 30, 40]));
  });

  it("não modifica o array recebido", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  /**
   * O CASO REAL, com a forma que os dez símbolos tinham: muito espalhado, e a
   * distância entre o 5º e o 6º larga. É aí que "o de cima do meio" para de ser
   * arredondamento e vira viés.
   */
  it("num mercado disperso, o de-cima-do-meio infla em mais de 10 pontos", () => {
    const dezSimbolos = [-52, -40, -30, -25, -18, 4, 10, 15, 30, 45];
    const certo = median(dezSimbolos)!;
    const errado = [...dezSimbolos].sort((a, b) => a - b)[Math.floor(dezSimbolos.length / 2)];

    expect(certo).toBe(-7);
    expect(errado).toBe(4);
    // E o erro tem SINAL: aponta sempre para cima, nunca para baixo.
    expect(errado).toBeGreaterThan(certo);
    expect(errado - certo).toBeGreaterThan(10);
  });

  it("o viés do de-cima-do-meio nunca é negativo, em qualquer amostra par", () => {
    const amostras = [
      [1, 2, 3, 4], [-5, -1, 0, 100], [0, 0, 0, 0], [-3, -3, 7, 7],
      [-52, -40, -30, -25, -18, 4, 10, 15, 30, 45],
    ];
    for (const xs of amostras) {
      const certo = median(xs)!;
      const errado = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      expect(errado).toBeGreaterThanOrEqual(certo);
    }
  });
});
