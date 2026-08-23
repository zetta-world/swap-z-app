import { describe, it, expect } from "vitest";
import { toBaseUnits, fromBaseUnits } from "@/lib/format";

/**
 * ⚠️ O QUE ESTES TESTES PROTEGEM (auditoria da ponte, 23/08).
 *
 * A conversão de quantia morava dentro do `SwapCard`, sem teste, e fazia
 * `amt.toString()` sobre um número JS. Os dois casos abaixo são os que a
 * auditoria reproduziu contra o código em produção — e o segundo passava em
 * TODAS as travas do caminho, cliente e servidor.
 */

describe("toBaseUnits — os dois defeitos que a auditoria achou", () => {
  it("NÃO produz notação exponencial abaixo de 0,000001", () => {
    // Antes: `0.0000001` virava "1e-7" no toString, e a quantia enviada era
    // "1e-7000000000000000000". O servidor rejeitava com 400 e o usuário via
    // um erro sem explicação ao tentar mover poeira.
    expect(toBaseUnits("0.0000001", 18)).toBe("100000000000");
    expect(toBaseUnits("0.00000001", 18)).toBe("10000000000");
    // 1 wei — o menor valor representável, o pior caso do exponencial.
    expect(toBaseUnits("0.000000000000000001", 18)).toBe("1");
  });

  it("NÃO perde precisão acima de 2^53 — o defeito que passava em tudo", () => {
    // ⚠️ ESTE É O CARO. Antes devolvia 1234567890123456800000…, ou seja, o
    // usuário assinava uma quantia DIFERENTE da que digitou — e o resultado
    // era só dígitos, então `validateAmount` e o `/^\d+$/` do servidor
    // aprovavam. Saldo de memecoin de 18 casas fica exatamente nessa ordem.
    expect(toBaseUnits("123456789012345678901", 0)).toBe("123456789012345678901");
    expect(toBaseUnits("123456789012345678901", 18))
      .toBe("123456789012345678901" + "0".repeat(18));
    // O dígito final tem de sobreviver: é ele que o `Number` comia.
    expect(toBaseUnits("9007199254740993", 0)).toBe("9007199254740993");
  });

  it("converte os casos comuns exatamente como antes", () => {
    expect(toBaseUnits("1.0", 18)).toBe("1000000000000000000");
    expect(toBaseUnits("0.5", 18)).toBe("500000000000000000");
    expect(toBaseUnits("0.1", 18)).toBe("100000000000000000");
    expect(toBaseUnits("1000000", 6)).toBe("1000000000000");
    expect(toBaseUnits("1.005", 6)).toBe("1005000");
  });

  it("TRUNCA as casas excedentes, nunca arredonda para cima", () => {
    // ⚠️ Arredondar para cima faria o MAX pedir mais do que a carteira tem, e a
    // transação reverteria DEPOIS de o usuário já ter pago a aprovação.
    expect(toBaseUnits("0.1234567", 6)).toBe("123456");   // não 123457
    expect(toBaseUnits("0.9999999", 6)).toBe("999999");   // não 1000000
  });

  it("entrada inválida vira '0' e nunca lança — isto roda a cada tecla", () => {
    for (const v of ["", ".", "abc", "1.2.3", "-1", "1e5", "0x10", "  ", null, undefined]) {
      expect(toBaseUnits(v as string, 18)).toBe("0");
    }
  });

  it("aceita separador de milhar e espaço vindos de colagem", () => {
    expect(toBaseUnits("1,000.5", 6)).toBe("1000500000");
    expect(toBaseUnits(" 2.5 ", 6)).toBe("2500000");
  });

  it("casos de borda de decimais", () => {
    expect(toBaseUnits("7", 0)).toBe("7");
    expect(toBaseUnits("0", 18)).toBe("0");
    expect(toBaseUnits("0.0", 18)).toBe("0");
    expect(toBaseUnits("1", 37)).toBe("0");   // fora da faixa aceita
  });
});

describe("fromBaseUnits — a volta, para o botão de porcentagem", () => {
  it("desfaz exatamente o que toBaseUnits fez", () => {
    for (const [v, d] of [["1.5", 18], ["0.0000001", 18], ["123456789012345678901", 18]] as const) {
      expect(fromBaseUnits(BigInt(toBaseUnits(v, d)), d)).toBe(v);
    }
  });

  it("corta zeros à direita mas preserva o inteiro", () => {
    expect(fromBaseUnits(1000000000000000000n, 18)).toBe("1");
    expect(fromBaseUnits(500000000000000000n, 18)).toBe("0.5");
    expect(fromBaseUnits(1n, 18)).toBe("0.000000000000000001");
    expect(fromBaseUnits(0n, 18)).toBe("0");
    expect(fromBaseUnits(7n, 0)).toBe("7");
  });

  /**
   * O caso que motivou a função: MAX numa carteira de memecoin.
   * `Number(saldo) * 1` arredondava; a divisão inteira não.
   */
  it("MAX devolve o saldo EXATO, dígito por dígito", () => {
    const saldo = 123456789012345678901234n;   // ~123 mil tokens de 18 casas
    const bps = 10_000n;
    const parte = (saldo * bps) / 10_000n;
    expect(parte).toBe(saldo);
    expect(toBaseUnits(fromBaseUnits(parte, 18), 18)).toBe(saldo.toString());
  });

  it("25% e 50% truncam para baixo — nunca pedem mais que o saldo", () => {
    const saldo = 999999999999999999n;   // ímpar de propósito
    for (const bps of [2_500n, 5_000n]) {
      const parte = (saldo * bps) / 10_000n;
      expect(parte).toBeLessThan(saldo);
      expect(parte * 10_000n / bps).toBeLessThanOrEqual(saldo);
    }
  });
});
