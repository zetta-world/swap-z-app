/**
 * AS TRAVAS DA ESCADA DE TAXAS.
 *
 * ⚠️ Esta é a primeira coisa do projeto que tira dinheiro do usuário no ato do
 * swap. O que estes testes protegem é que ela só cobre quando pode, que a
 * escada tenha a direção certa, e que o teto do dono seja o teto.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TIER_FEE_BPS, taxaPct, receitaUsd, equilibrioMensalUsd,
  destinatarioDaTaxa, bpsEfetivos, CARTEIRA_TAXA_EVM, CARTEIRA_TAXA_SOLANA, CONTA_TAXA_SOLANA, MOTIVOS_SOLANA_SEM_TAXA,
} from "@/lib/tier/fees";
import { getAddress, isAddress } from "viem";
import type { Tier } from "@/lib/tier/types";

const PLANOS: Tier[] = ["free", "pro", "trader", "pilot"];
const envOriginal = process.env.SWAP_FEE_RECIPIENT;
beforeEach(() => { delete process.env.SWAP_FEE_RECIPIENT; delete process.env.SWAP_FEE_ACCOUNT_SOLANA; });
afterEach(() => {
  if (envOriginal === undefined) delete process.env.SWAP_FEE_RECIPIENT;
  else process.env.SWAP_FEE_RECIPIENT = envOriginal;
});

describe("a escada", () => {
  /** ⚠️ O TETO É DECISÃO DO DONO: 1% no Free. Mudá-lo exige mudar este teste. */
  it("o Free paga 1%, o teto declarado", () => {
    expect(TIER_FEE_BPS.free).toBe(100);
    expect(taxaPct("free")).toBe(1);
  });

  /**
   * ⚠️ A DIREÇÃO É A REGRA. Se um plano mais caro cobrasse MAIS por trade, ele
   * cobraria duas vezes pela mesma coisa e empurraria o cliente de maior
   * volume para outro agregador.
   */
  it("quem paga mais assinatura paga MENOS por trade, sem empate", () => {
    for (let i = 1; i < PLANOS.length; i++) {
      expect(TIER_FEE_BPS[PLANOS[i]], PLANOS[i]).toBeLessThan(TIER_FEE_BPS[PLANOS[i - 1]]);
    }
  });

  it("nenhum plano passa do teto nem cobra negativo", () => {
    for (const t of PLANOS) {
      expect(TIER_FEE_BPS[t], t).toBeGreaterThan(0);
      expect(TIER_FEE_BPS[t], t).toBeLessThanOrEqual(TIER_FEE_BPS.free);
    }
  });
});

describe("a receita", () => {
  it("1% de $10.000 é $100", () => {
    expect(receitaUsd(10_000, "free")).toBe(100);
    expect(receitaUsd(10_000, "pilot")).toBe(10);
  });

  /** Volume inválido é ZERO receita — não é `null`, porque não houve volume. */
  it("volume inválido não inventa receita", () => {
    for (const v of [0, -5, NaN, Infinity]) expect(receitaUsd(v, "free")).toBe(0);
  });
});

describe("o equilíbrio do upgrade — o número que decide", () => {
  /** free 1% → pro 0,5%: economia de 50 bps. $20/mês se paga com $4.000. */
  it("diz em que volume mensal o upgrade se paga", () => {
    expect(equilibrioMensalUsd("free", "pro", 0, 20)).toBe(4_000);
  });

  /**
   * ⚠️ UPGRADE QUE NÃO BAIXA A TAXA NUNCA SE PAGA POR TAXA — e isso devolve
   * `null`, não um número grande. Número grande seria lido como "é só operar
   * mais", que é falso.
   */
  it("upgrade sem economia de taxa devolve null", () => {
    expect(equilibrioMensalUsd("pro", "pro", 20, 40)).toBeNull();
    expect(equilibrioMensalUsd("pilot", "free", 100, 0)).toBeNull();
  });

  it("upgrade mais barato se paga na hora", () => {
    expect(equilibrioMensalUsd("free", "pro", 50, 20)).toBe(0);
  });
});

describe("a carteira que recebe", () => {
  /**
   * ⚠️ CHECKSUM EIP-55, e este teste é caro de não ter. Um endereço com um
   * caractere trocado passa em quase toda validação e manda a taxa para um
   * lugar que ninguém controla — sem desfazer.
   */
  it("a carteira EVM tem checksum válido", () => {
    expect(isAddress(CARTEIRA_TAXA_EVM)).toBe(true);
    expect(getAddress(CARTEIRA_TAXA_EVM.toLowerCase())).toBe(CARTEIRA_TAXA_EVM);
  });

  it("EVM cobra por padrão, com a carteira do código", () => {
    expect(destinatarioDaTaxa("evm")).toBe(CARTEIRA_TAXA_EVM);
    for (const t of PLANOS) expect(bpsEfetivos(t, "evm"), t).toBe(TIER_FEE_BPS[t]);
  });

  it("o ambiente sobrescreve a carteira sem precisar de deploy", () => {
    process.env.SWAP_FEE_RECIPIENT = "0x00000000000000000000000000000000000000fe";
    expect(destinatarioDaTaxa("evm")).toBe("0x00000000000000000000000000000000000000fe");
  });

  /**
   * ⚠️ SOLANA FICA DESLIGADA. A Jupiter exige um `feeAccount` — CONTA DE TOKEN,
   * não carteira — e um endereço EVM ali não é "menos ideal", é inválido.
   * Aplicar a carteira de EVM na Solana seria inventar um destinatário.
   */
  /**
   * ⚠️ A CARTEIRA DA SOLANA ESTÁ REGISTRADA, e mesmo assim não se cobra —
   * porque a Jupiter pede CONTA DE TOKEN, não carteira. Separar os dois campos
   * é o que impede o erro fácil de mandar um no lugar do outro.
   */
  it("a carteira Solana está registrada e é válida", () => {
    expect(CARTEIRA_TAXA_SOLANA).toBe("EWPtaW726VUcs2DA7q73b9vAJyyXJLynE8pH6TZGvd5L");
    expect(CARTEIRA_TAXA_SOLANA.length).toBeGreaterThanOrEqual(32);
  });

  /**
   * ⚠️ A DECISÃO FICA ESCRITA, não implícita. "Solana sem taxa" tem que ser
   * legível como ESCOLHA com motivos, senão daqui a um mês alguém lê como
   * pendência e liga sem saber o que está desligando junto.
   */
  it("os motivos da Solana sem taxa estão registrados", () => {
    expect(MOTIVOS_SOLANA_SEM_TAXA.length).toBe(4);
    const juntos = MOTIVOS_SOLANA_SEM_TAXA.join(" ");
    expect(juntos).toContain("50 bps");     // o piso que quebra a escada
    expect(juntos).toContain("gás");        // o benefício que se perde
  });

  it("mas a CONTA de token ainda não existe, então Solana não cobra", () => {
    expect(CONTA_TAXA_SOLANA).toBeNull();
    expect(destinatarioDaTaxa("solana")).toBeNull();
    for (const t of PLANOS) expect(bpsEfetivos(t, "solana"), t).toBe(0);
  });

  /**
   * ⚠️ A TRAVA QUE A PERGUNTA DO DONO EXPÔS: a carteira NÃO pode virar o
   * destinatário da Solana por descuido. Uma carteira base58 passa em qualquer
   * validação por tamanho — quem decide é o CAMPO, não o formato.
   */
  it("a carteira Solana não vira feeAccount por descuido", () => {
    expect(destinatarioDaTaxa("solana")).not.toBe(CARTEIRA_TAXA_SOLANA);
  });

  it("e a carteira Solana não vaza para o lado EVM", () => {
    expect(destinatarioDaTaxa("evm")).toBe(CARTEIRA_TAXA_EVM);
    expect(destinatarioDaTaxa("evm")).not.toBe(CARTEIRA_TAXA_SOLANA);
  });

  it("a carteira de EVM NÃO vaza para o lado Solana", () => {
    process.env.SWAP_FEE_RECIPIENT = CARTEIRA_TAXA_EVM;
    expect(destinatarioDaTaxa("solana")).toBeNull();
    expect(bpsEfetivos("free", "solana")).toBe(0);
  });

  it("com conta Solana configurada, Solana passa a cobrar", () => {
    process.env.SWAP_FEE_ACCOUNT_SOLANA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    expect(destinatarioDaTaxa("solana")).toBeTruthy();
    expect(bpsEfetivos("free", "solana")).toBe(TIER_FEE_BPS.free);
  });

  it("endereço curto demais não conta como configurado", () => {
    process.env.SWAP_FEE_ACCOUNT_SOLANA = "abc";
    expect(destinatarioDaTaxa("solana")).toBeNull();
  });
});
