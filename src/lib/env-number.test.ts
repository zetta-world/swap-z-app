import { describe, it, expect } from "vitest";
import { envNumber } from "@/lib/env-number";

/**
 * A MINA: `Number(process.env.X ?? 15)`.
 *
 * O `??` só cai no padrão quando o valor é `null`/`undefined`. Variável CRIADA
 * E DEIXADA EM BRANCO vale `""`, o `??` não dispara, e `Number("")` é ZERO —
 * não `NaN`, que saltaria aos olhos, mas um zero silencioso e válido.
 *
 * Consequência real, antes desta correção: `IMPACT_BLOCK_PCT = 0` faz
 * `loss >= 0` ser sempre verdade e BLOQUEIA TODO SWAP. Apertar Save na Vercel
 * sem digitar o valor derrubava o produto, e nenhum log acusaria — do ponto de
 * vista do código, estava funcionando conforme configurado.
 */

describe("o caso que motivou o arquivo", () => {
  it("string vazia cai no padrão — NÃO vira zero", () => {
    expect(envNumber("", 15)).toBe(15);
  });

  it("o comportamento ANTIGO, para deixar a armadilha registrada", () => {
    // `process.env.X` é `string | undefined`; quando a Vercel guarda a variável
    // em branco, o valor é `""` e o `??` simplesmente não dispara.
    const daVercel: string | undefined = "";
    expect(Number(daVercel ?? 15)).toBe(0);   // ← era isto que quebrava tudo
    expect(envNumber(daVercel, 15)).toBe(15);
  });

  it("só espaços também cai no padrão", () => {
    // Copiar e colar um valor às vezes traz espaço junto.
    expect(envNumber("   ", 15)).toBe(15);
    expect(envNumber("\n", 15)).toBe(15);
  });

  it("ausente cai no padrão", () => {
    expect(envNumber(undefined, 15)).toBe(15);
    expect(envNumber(null, 15)).toBe(15);
  });

  it("lixo não-numérico cai no padrão em vez de virar NaN", () => {
    // NaN em comparação é sempre falso: `loss >= NaN` nunca bloqueia. Seria o
    // erro espelhado — o guard existiria e não guardaria nada.
    expect(envNumber("quinze", 15)).toBe(15);
    expect(envNumber("15%", 15)).toBe(15);
  });
});

describe("valor legítimo é respeitado", () => {
  it("número normal passa", () => {
    expect(envNumber("42", 15)).toBe(42);
    expect(envNumber("2.5", 15)).toBe(2.5);
  });

  it("espaço em volta não estraga um valor bom", () => {
    expect(envNumber(" 42 ", 15)).toBe(42);
  });

  it("zero EXPLÍCITO é respeitado quando faz sentido", () => {
    // Sem `positive`, quem escreveu "0" quis dizer zero.
    expect(envNumber("0", 15)).toBe(0);
  });
});

describe("modo positivo — para teto, cota e limite", () => {
  it("zero explícito cai no padrão: teto zero é sempre engano", () => {
    // `ZION_DAILY_MAX=0` significaria "nenhuma análise para ninguém, nunca".
    // Ninguém configura isso de propósito; quem quer parar usa o kill-switch.
    expect(envNumber("0", 20_000, { positive: true })).toBe(20_000);
  });

  it("negativo cai no padrão", () => {
    expect(envNumber("-5", 20_000, { positive: true })).toBe(20_000);
  });

  it("positivo passa normalmente", () => {
    expect(envNumber("500", 20_000, { positive: true })).toBe(500);
  });
});

describe("os valores reais que este helper protege", () => {
  it("um IMPACT_BLOCK_PCT em branco não bloqueia todo swap", () => {
    // loss >= 0 é sempre verdade. Era a falha mais cara das três.
    expect(envNumber("", 15, { positive: true })).toBe(15);
  });

  it("um ZION_DAILY_MAX em branco não zera a cota da plataforma", () => {
    expect(envNumber("", 20_000, { positive: true })).toBe(20_000);
  });

  it("um QUOTE_DAILY_MAX em branco não derruba as cotações", () => {
    // Sem cotação não há swap: seria a plataforma inteira parada.
    expect(envNumber("", 250_000, { positive: true })).toBe(250_000);
  });
});
