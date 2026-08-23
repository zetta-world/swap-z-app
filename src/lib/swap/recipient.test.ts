import { describe, it, expect } from "vitest";
import { isAddress } from "viem";
import { conferirDestinatario, familiaDaRede, destinatarioValido } from "@/lib/swap/recipient";

/**
 * ⚠️ O CAMINHO DE PERDA QUE ESTES TESTES FECHAM (auditoria da ponte, 23/08).
 *
 * Destino Solana + endereço Solana → trocar o destino para Base. A loja mantém
 * o endereço, o campo fica vermelho, o botão continua vivo, e o servidor aceita
 * porque não sabia a rede de destino. Cinco camadas, e a única que reclamava
 * era uma cor.
 */

const EVM_OK     = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL_OK     = "So11111111111111111111111111111111111111112";
const ZERO       = "0x0000000000000000000000000000000000000000";

describe("familiaDaRede", () => {
  it("só Solana é solana; todo o resto é EVM", () => {
    expect(familiaDaRede("solana")).toBe("solana");
    for (const c of ["ethereum", "base", "arbitrum", "bsc", null, undefined, "qualquer"]) {
      expect(familiaDaRede(c)).toBe("evm");
    }
  });
});

describe("família errada — o caso que custava dinheiro", () => {
  it("endereço SOLANA recusado quando o destino é EVM", () => {
    const v = conferirDestinatario(SOL_OK, "evm");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.motivo).toBe("familia");
  });

  it("endereço EVM recusado quando o destino é SOLANA", () => {
    const v = conferirDestinatario(EVM_OK, "solana");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.motivo).toBe("familia");
  });

  it("cada um na sua família passa", () => {
    expect(destinatarioValido(EVM_OK, "evm")).toBe(true);
    expect(destinatarioValido(SOL_OK, "solana")).toBe(true);
  });
});

describe("maiúsculas — endereço bom que era recusado", () => {
  const MAIUSCULO = "0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045";
  const MINUSCULO = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

  it("o viem REPROVA caixa única — é essa a origem do defeito", () => {
    // Não é asserção sobre o nosso código: documenta por que a regra existe.
    expect(isAddress(MAIUSCULO)).toBe(false);
  });

  it("nós aceitamos, porque caixa única não carrega checksum para conferir", () => {
    expect(destinatarioValido(MAIUSCULO, "evm")).toBe(true);
    expect(destinatarioValido(MINUSCULO, "evm")).toBe(true);
  });

  it("mas caixa MISTA tem checksum, e ele é exigido", () => {
    // Um dígito trocado de caixa quebra o EIP-55 — quase sempre é digitação.
    const quebrado = "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const v = conferirDestinatario(quebrado, "evm");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.motivo).toBe("checksum");
    // E o correto, também misto, passa.
    expect(destinatarioValido(EVM_OK, "evm")).toBe(true);
  });
});

describe("queima vem ANTES de família — a mensagem tem de ser a certa", () => {
  it("o endereço zero é recusado por QUEIMA, não por formato", () => {
    const v = conferirDestinatario(ZERO, "evm");
    expect(v.ok).toBe(false);
    // ⚠️ Antes desta rodada a tela dizia "Not a valid EVM address" para o
    // endereço zero — que É um endereço EVM válido em formato. Mensagem errada
    // ensina a coisa errada: o problema não é o formato, é o destino.
    expect(v.ok === false && v.motivo).toBe("queima");
  });

  it("0x…dEaD idem", () => {
    const v = conferirDestinatario("0x000000000000000000000000000000000000dEaD", "evm");
    expect(v.ok === false && v.motivo).toBe("queima");
  });
});

describe("vazio, lixo e espaços", () => {
  it("vazio é AUSÊNCIA, não erro — entrega na carteira conectada", () => {
    for (const v of ["", "   ", null, undefined]) {
      const r = conferirDestinatario(v as string, "evm");
      expect(r.ok === false && r.motivo).toBe("vazio");
    }
  });

  it("lixo é 'formato'", () => {
    for (const v of ["0x123", "não-endereço", "0xZZZZ"]) {
      const r = conferirDestinatario(v, "evm");
      expect(r.ok === false && r.motivo).toBe("formato");
    }
  });

  it("espaço de colagem não invalida", () => {
    expect(destinatarioValido(`  ${EVM_OK}  `, "evm")).toBe(true);
    expect(destinatarioValido(`\n${SOL_OK}\t`, "solana")).toBe(true);
  });

  it("devolve o endereço já aparado, para quem for usar", () => {
    const r = conferirDestinatario(`  ${EVM_OK}  `, "evm");
    expect(r.ok === true && r.endereco).toBe(EVM_OK);
  });
});
