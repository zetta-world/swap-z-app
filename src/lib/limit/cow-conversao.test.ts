import { describe, it, expect } from "vitest";
import { toBaseUnits } from "@/lib/format";

/**
 * ⚠️ A CONVERSÃO QUE ENTRA NA ASSINATURA EIP-712 (auditoria de 24/08).
 *
 * `cow.ts` tinha um `toBaseUnits` próprio cujo comentário prometia
 * "BigInt-string arithmetic so we never lose precision" e cuja conta era
 * `BigInt(Math.round(amount * 10 ** decimals))` — float antes do BigInt.
 *
 * A deriva era poeira (~1e-16 relativo), não catástrofe. Estes testes fixam a
 * regra que importa: no caminho de dinheiro existe UMA convenção de conversão,
 * a de `lib/format.ts`, e ela não passa por `Number`.
 */

/** A conta ANTIGA, reproduzida para provar que a nova difere de verdade. */
function antigo(amount: number, decimals: number): string {
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}

describe("a venda converte a partir da STRING, não do Number", () => {
  it("preserva os dígitos que o usuário digitou", () => {
    expect(toBaseUnits("1234.5678", 18)).toBe("1234567800000000000000");
    // ⚠️ E a conta antiga NÃO preservava — a prova de que o teste morde.
    expect(antigo(1234.5678, 18)).toBe("1234567800000000032768");
  });

  it("18 casas cheias sobrevivem inteiras", () => {
    expect(toBaseUnits("0.123456789012345678", 18)).toBe("123456789012345678");
    expect(antigo(0.123456789012345678, 18)).toBe("123456789012345680");
  });

  it("valores grandes não perdem dígito", () => {
    expect(toBaseUnits("1000000", 18)).toBe("1000000000000000000000000");
    expect(antigo(1000000, 18)).toBe("999999999999999983222784");
  });

  it("separador de milhar colado não vira lixo", () => {
    expect(toBaseUnits("1,234.5678".replace(/[\s,_]/g, ""), 18)).toBe("1234567800000000000000");
  });

  it("stablecoin de 6 casas continua exata", () => {
    expect(toBaseUnits("1234.567891", 6)).toBe("1234567891");
    expect(toBaseUnits("0.000001", 6)).toBe("1");
  });

  it("valor pequeno demais para as casas do token devolve '0' — e o chamador lança", () => {
    // ⚠️ Não é `throw` aqui: `toBaseUnits` devolve "0" e quem chama decide.
    // O `buildCowOrder` transforma isso em erro com o valor na mensagem.
    expect(toBaseUnits("0.0000001", 6)).toBe("0");
  });

  it("notação exponencial é RECUSADA, não interpretada", () => {
    // Um "1e9" colado no campo não pode virar ordem de 1 bilhão calado.
    expect(toBaseUnits("1e9", 18)).toBe("0");
  });
});
