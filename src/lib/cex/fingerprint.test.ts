/**
 * ⚠️ A120 — O FINGERPRINT DA CREDENCIAL, em unidade.
 *
 * O que se prova aqui é a MENSAGEM e a CONFERÊNCIA: HMAC-SHA256 sob
 * `CEX_RECOVERY_HMAC_KEY` de `exchange_canonica + NUL + apiKey` — com a apiKey
 * EXATA (case-sensitive), separação de domínio por exchange, env ausente como
 * erro de configuração (nunca fingerprint vazio) e comparação em tempo
 * constante com guarda de comprimento.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  canonicalizarExchange, impressaoDaCredencial, impressaoConfere,
} from "@/lib/cex/fingerprint";

const ENV = "chave-hmac-unitaria-a120";
const KEY = "AbCdefgh123456";

let salva: string | undefined;
beforeEach(() => {
  salva = process.env.CEX_RECOVERY_HMAC_KEY;
  process.env.CEX_RECOVERY_HMAC_KEY = ENV;
});
afterEach(() => {
  if (salva === undefined) delete process.env.CEX_RECOVERY_HMAC_KEY;
  else process.env.CEX_RECOVERY_HMAC_KEY = salva;
});

describe("A120 — impressaoDaCredencial", () => {
  it("é exatamente HMAC-SHA256(env, exchange_canonica + NUL + apiKey), hex", () => {
    // Vetor calculado por fora, com a mensagem montada à mão: se o formato da
    // mensagem mudar (separador, ordem, canonicalização), este teste quebra.
    const esperado = crypto.createHmac("sha256", ENV)
      .update("binance" + "\0" + KEY, "utf8").digest("hex");
    expect(impressaoDaCredencial("binance", KEY)).toBe(esperado);
    expect(impressaoDaCredencial("binance", KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a exchange é canonicalizada como nas rotas (BINANCE ≡ binance)", () => {
    expect(canonicalizarExchange("BINANCE")).toBe("binance");
    expect(impressaoDaCredencial("Binance", KEY))
      .toBe(impressaoDaCredencial("binance", KEY));
  });

  it("A120.8 ⚠️ separação de domínio: mesma key em OUTRA exchange → impressão diferente", () => {
    expect(impressaoDaCredencial("binance", KEY))
      .not.toBe(impressaoDaCredencial("gateio", KEY));
  });

  it("A120.9 ⚠️ a apiKey é EXATA: 'AbC…' ≠ 'abc…' (case-sensitive, zero normalização)", () => {
    expect(impressaoDaCredencial("binance", "AbCdefgh123456"))
      .not.toBe(impressaoDaCredencial("binance", "abcdefgh123456"));
    // E não é trim: espaço na chave é parte da chave.
    expect(impressaoDaCredencial("binance", KEY))
      .not.toBe(impressaoDaCredencial("binance", KEY + " "));
  });

  it("⚠️ env AUSENTE → throw server_configuration_error (nunca fingerprint vazio)", () => {
    delete process.env.CEX_RECOVERY_HMAC_KEY;
    expect(() => impressaoDaCredencial("binance", KEY))
      .toThrow(/server_configuration_error/);
  });

  it("⚠️ env VAZIA → idem", () => {
    process.env.CEX_RECOVERY_HMAC_KEY = "";
    expect(() => impressaoDaCredencial("binance", KEY))
      .toThrow(/server_configuration_error/);
  });
});

describe("A120 — impressaoConfere", () => {
  it("igual → true; diferente → false", () => {
    const f = impressaoDaCredencial("binance", KEY);
    expect(impressaoConfere(f, f)).toBe(true);
    expect(impressaoConfere(f, impressaoDaCredencial("binance", "outra-chave-1")))
      .toBe(false);
  });

  it("⚠️ guarda de comprimento: buffers de tamanhos diferentes → false SEM lançar", () => {
    // timingSafeEqual LANÇA com lengths diferentes — a guarda existe para que
    // uma impressão truncada/malformada vire 403, não 500.
    const f = impressaoDaCredencial("binance", KEY);
    expect(impressaoConfere(f.slice(0, 32), f)).toBe(false);
    expect(impressaoConfere(f, f + "00")).toBe(false);
    expect(impressaoConfere("", f)).toBe(false);
  });
});
