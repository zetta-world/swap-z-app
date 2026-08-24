import { describe, it, expect } from "vitest";
import { lerCiclos, porCiclo, sobra, MAX_CICLOS } from "@/lib/orders/plano";

/**
 * ⚠️ CADA CASO AQUI É UM VALOR QUE A TELA ACEITAVA (auditoria de 24/08).
 *
 * Todos produziam resumo, habilitavam o botão e eram salvos como texto no
 * card. Nenhum era erro de digitação exótico: o campo é `type="number"` sem
 * `min` e sem `step`, então negativo, fracionário e expoente entram digitando.
 */

describe("lerCiclos — o que a tela aceitava e não devia", () => {
  it("aceita inteiro positivo dentro do teto", () => {
    expect(lerCiclos("12")).toEqual({ ok: true, ciclos: 12 });
    expect(lerCiclos("1")).toEqual({ ok: true, ciclos: 1 });
    expect(lerCiclos(String(MAX_CICLOS))).toEqual({ ok: true, ciclos: MAX_CICLOS });
  });

  it("zero e negativo — davam $Infinity e $-200.00 por ciclo", () => {
    expect(lerCiclos("0")).toEqual({ ok: false, motivo: "menor_que_um" });
    expect(lerCiclos("-5")).toEqual({ ok: false, motivo: "menor_que_um" });
  });

  it("fracionário — meio ciclo não existe, e o parseInt truncava calado", () => {
    // "1.9" virava 1 e o resumo seguia dizendo "1.9 ciclos".
    expect(lerCiclos("1.9")).toEqual({ ok: false, motivo: "nao_inteiro" });
    expect(lerCiclos("0.5")).toEqual({ ok: false, motivo: "nao_inteiro" });
  });

  it("⚠️ notação exponencial — o parseInt PARA no 'e' e devolve 1", () => {
    // "1e9" produzia "$1000.00 por ciclo · 1e9 ciclos" na mesma frase.
    expect(lerCiclos("1e9")).toEqual({ ok: false, motivo: "nao_inteiro" });
  });

  it("lixo com número na frente não passa — parseInt('12abc') dava 12", () => {
    expect(lerCiclos("12abc")).toEqual({ ok: false, motivo: "nao_inteiro" });
  });

  it("vazio é vazio, e não 1", () => {
    // `intervals || "1"` transformava campo em branco em plano de 1 ciclo.
    expect(lerCiclos("")).toEqual({ ok: false, motivo: "vazio" });
    expect(lerCiclos(null)).toEqual({ ok: false, motivo: "vazio" });
    expect(lerCiclos(undefined)).toEqual({ ok: false, motivo: "vazio" });
  });

  it("acima do teto — plano gigante devolve zero por ciclo", () => {
    expect(lerCiclos(String(MAX_CICLOS + 1))).toEqual({ ok: false, motivo: "acima_do_teto" });
    expect(lerCiclos("99999999999999999999")).toEqual({ ok: false, motivo: "acima_do_teto" });
  });
});

describe("porCiclo — o número que vai para o swap card", () => {
  it("divide o orçamento pelo número de ciclos", () => {
    expect(porCiclo("1000", 12)).toBe("83.333333333333333333");
    expect(porCiclo("1000", 4)).toBe("250");
    expect(porCiclo("1", 3)).toBe("0.333333333333333333");
  });

  it("mantém a unidade do TOKEN, não converte para dólar", () => {
    // ⚠️ O resumo antigo escrevia "$" fixo na frente. Num plano de 12 ETH
    // dizia "$1.00 por ciclo" — unidade errada, número certo.
    expect(porCiclo("12", 12)).toBe("1");
  });

  it("total ausente ou zero é `null` — não `0`", () => {
    // Invariante nº 33: "não sei" tem de ser distinguível de "é zero".
    expect(porCiclo("", 12)).toBeNull();
    expect(porCiclo("0", 12)).toBeNull();
    expect(porCiclo(null, 12)).toBeNull();
  });

  it("ciclos inválidos não produzem número — nunca Infinity", () => {
    expect(porCiclo("1000", 0)).toBeNull();
    expect(porCiclo("1000", -5)).toBeNull();
    expect(porCiclo("1000", 1.5)).toBeNull();
  });

  it("orçamento pequeno demais para o número de ciclos devolve `null`", () => {
    // 1 wei dividido por 12 é zero — uma ordem que não compra nada.
    expect(porCiclo("0.000000000000000001", 12)).toBeNull();
  });

  it("valor grande não vira notação exponencial nem perde dígito", () => {
    // A cicatriz da ponte: acima de 2^53 o `Number` corrompe em silêncio.
    expect(porCiclo("123456789.123456789123456789", 3))
      .toBe("41152263.041152263041152263");
  });
});

describe("sobra — a poeira da divisão inteira, dita e não escondida", () => {
  it("divisão exata não sobra nada", () => {
    expect(sobra("1000", 4)).toBeNull();
  });

  it("divisão inexata devolve o resto, para a tela poder dizer", () => {
    // 1000 / 12 trunca; somar os 12 ciclos dá menos que o orçamento.
    expect(sobra("1000", 12)).toBe("0.000000000000000004");
  });

  it("trunca PARA BAIXO — nunca pede mais do que o dono autorizou", () => {
    const p = porCiclo("1000", 12)!;
    const total = Number(p) * 12;
    expect(total).toBeLessThanOrEqual(1000);
  });
});
