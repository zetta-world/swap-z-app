import { describe, it, expect } from "vitest";
import { isAddress } from "viem";
import { isBurnAddress, validateAddress } from "@/lib/validate";

/**
 * ⚠️ O ENDEREÇO QUE PASSAVA EM TUDO (auditoria da ponte, 23/08).
 *
 * O campo de destinatário validava com `viem.isAddress`, o painel de carteiras
 * com uma regex, e o servidor com outra. As três aprovavam `0x000…000`, e a
 * interface pintava o campo de VERDE. O usuário via o selo de válido e a ponte
 * entregava para um endereço do qual ninguém tem a chave.
 */

const ZERO  = "0x0000000000000000000000000000000000000000";
const DEAD  = "0x000000000000000000000000000000000000dEaD";
const VIVO  = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("isBurnAddress", () => {
  it("o endereço zero é VÁLIDO em formato — é essa a armadilha", () => {
    // Não é asserção sobre o nosso código: é sobre a biblioteca em que o campo
    // confiava. Se um dia `isAddress` passar a recusar, este teste avisa que a
    // guarda virou redundante — o que também é informação.
    expect(isAddress(ZERO)).toBe(true);
    expect(validateAddress(ZERO)).not.toBeNull();
    // …e é justamente por isso que a guarda precisa existir por fora.
    expect(isBurnAddress(ZERO)).toBe(true);
  });

  it("pega o 0x…dEaD em qualquer caixa", () => {
    expect(isBurnAddress(DEAD)).toBe(true);
    expect(isBurnAddress(DEAD.toLowerCase())).toBe(true);
    expect(isBurnAddress(DEAD.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("pega os endereços de queima do Solana", () => {
    expect(isBurnAddress("11111111111111111111111111111111")).toBe(true);
    expect(isBurnAddress("1nc1nerator11111111111111111111111111111111")).toBe(true);
  });

  it("NÃO barra endereço legítimo — falso positivo aqui impede o usuário de usar o próprio dinheiro", () => {
    expect(isBurnAddress(VIVO)).toBe(false);
    expect(isBurnAddress("So11111111111111111111111111111111111111112")).toBe(false); // wSOL
  });

  it("tolera espaço de colagem e entrada vazia", () => {
    expect(isBurnAddress(`  ${ZERO}  `)).toBe(true);
    for (const v of ["", null, undefined, "0x", "abc"]) {
      expect(isBurnAddress(v as string)).toBe(false);
    }
  });
});

describe("validateAddress — o que o servidor aceita hoje", () => {
  it("normaliza EVM para minúsculas (e com isso descarta o checksum)", () => {
    // ⚠️ Registrado pela auditoria: o servidor joga fora a única proteção
    // contra corrupção em trânsito. Não foi alterado nesta rodada — o teste
    // documenta o comportamento REAL para a mudança futura ser deliberada.
    expect(validateAddress(VIVO)).toBe(VIVO.toLowerCase());
  });

  it("aceita base58 do Solana sem saber a rede de destino", () => {
    // ⚠️ Também registrado: o servidor aceitaria um endereço Solana como
    // destinatário de uma ponte EVM. Hoje o cliente barra; se ele regredir,
    // não há segunda linha. Este teste fixa o estado conhecido.
    expect(validateAddress("So11111111111111111111111111111111111111112"))
      .toBe("So11111111111111111111111111111111111111112");
  });

  it("recusa lixo", () => {
    for (const v of ["", "  ", "0x123", "não-endereço", null, undefined]) {
      expect(validateAddress(v as string)).toBeNull();
    }
  });
});
