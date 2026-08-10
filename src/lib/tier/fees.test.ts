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
  destinatarioDaTaxa, bpsEfetivos,
} from "@/lib/tier/fees";
import type { Tier } from "@/lib/tier/types";

const PLANOS: Tier[] = ["free", "pro", "trader", "pilot"];
const envOriginal = process.env.SWAP_FEE_RECIPIENT;
beforeEach(() => { process.env.SWAP_FEE_RECIPIENT = "0x00000000000000000000000000000000000000fe"; });
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

describe("a trava do destinatário", () => {
  /**
   * ⚠️ SEM DESTINATÁRIO, TAXA ZERO. Cobrar sem ter para onde mandar é pior que
   * não cobrar. O default do ambiente não configurado NÃO cobra do usuário.
   */
  it("sem SWAP_FEE_RECIPIENT ninguém é cobrado", () => {
    delete process.env.SWAP_FEE_RECIPIENT;
    expect(destinatarioDaTaxa()).toBeNull();
    for (const t of PLANOS) expect(bpsEfetivos(t), t).toBe(0);
  });

  it("endereço curto demais não conta como configurado", () => {
    process.env.SWAP_FEE_RECIPIENT = "0x1";
    expect(destinatarioDaTaxa()).toBeNull();
    expect(bpsEfetivos("free")).toBe(0);
  });

  it("com destinatário, os bps efetivos são os da escada", () => {
    for (const t of PLANOS) expect(bpsEfetivos(t), t).toBe(TIER_FEE_BPS[t]);
  });
});
