import { describe, it, expect } from "vitest";
import {
  diagnoseFailure, classificarFalha, CLASSES_PERMANENTES,
} from "@/lib/ai/circuit";

/**
 * ⚠️⚠️ A MISTRAL, EM 29/08 — a mesma cicatriz a um sinônimo de distância.
 *
 * O ramo de MODELO nasceu em 25/07 porque o "conserte a chave" genérico mandou o
 * dono caçar credencial quando a DeepSeek tinha só aposentado o nome do modelo.
 * Ele procura `not found`, `not supported`, `invalid`, `deprecated`, `retired`.
 *
 * A Mistral respondeu **"not available"** — que não está na lista. A linha caiu
 * no ramo de AUTH por causa do 403, e o alerta mandou GERAR OUTRA CHAVE. A chave
 * é aceita; o que é recusado é o modelo, por direito de plano. Seguir o conselho
 * não conserta nada.
 *
 * A string abaixo é a REAL, copiada de `platform_events` em 29/08 03:30.
 */
const MISTRAL_REAL = 'upstream 403: {"object":"error","message":"This model is '
  + 'not available in your subscription tier","type":"tier_not_allowed",'
  + '"param":null,"code":"1910","raw_status_code":403}';

describe("o erro real da Mistral vira PLANO, não AUTH", () => {
  it("⚠️ classifica como `plano`", () => {
    expect(classificarFalha(MISTRAL_REAL)).toBe("plano");
  });

  it("⚠️ e a ação NÃO manda gerar chave nova", () => {
    const out = diagnoseFailure(MISTRAL_REAL);
    expect(out).toContain("PLANO");
    expect(out).toContain("NÃO é a chave");
    expect(out).not.toContain("Gere outra");
  });

  it("o `tier_not_allowed` sozinho já basta, mesmo sem prosa", () => {
    expect(classificarFalha('{"type":"tier_not_allowed"}')).toBe("plano");
  });

  it("outras redações da mesma recusa também caem em `plano`", () => {
    for (const r of [
      "this model is not available in your plan",
      "upgrade your subscription to use this model",
      "modelo não disponível no seu plano",
      "your tier does not include this model — not allowed",
    ]) {
      expect(classificarFalha(r), r).toBe("plano");
    }
  });
});

describe("⚠️ o padrão exige DUAS condições — uma palavra solta engoliria o 503", () => {
  it("`503 service unavailable` continua UPSTREAM, não plano", () => {
    // "unavailable" aparece nos dois, mas aqui não há termo de PLANO. E a ação é
    // oposta: esperar, não trocar de modelo.
    expect(classificarFalha("upstream 503: service unavailable")).toBe("upstream");
    expect(diagnoseFailure("upstream 503: service unavailable")).toContain("UPSTREAM");
  });

  it("o modelo APOSENTADO da DeepSeek continua `modelo`", () => {
    const real = 'upstream 400: {"error":{"message":"The supported API model names are '
      + 'deepseek-v4-pro or deepseek-v4-flash, but you passed deepseek-chat.",'
      + '"type":"invalid_request_error"}}';
    expect(classificarFalha(real)).toBe("modelo");
  });

  it("401 sem menção a plano continua `auth` — chave nova É a ação certa ali", () => {
    expect(classificarFalha("upstream 401: unauthorized")).toBe("auth");
    expect(diagnoseFailure("upstream 401: unauthorized")).toContain("Gere outra");
  });

  it("cota e sem-detalhe seguem como eram", () => {
    expect(classificarFalha("upstream 429: rate limit exceeded")).toBe("cota");
    expect(classificarFalha("Insufficient Balance")).toBe("cota");
    expect(classificarFalha(undefined)).toBe("sem_detalhe");
    expect(classificarFalha("something weird happened")).toBe("desconhecida");
  });
});

describe("o que é permanente e o que passa sozinho", () => {
  it("⚠️ plano, modelo e auth NÃO se resolvem esperando", () => {
    for (const c of ["plano", "modelo", "auth"] as const) {
      expect(CLASSES_PERMANENTES.has(c), c).toBe(true);
    }
  });

  it("cota e upstream passam — e ali a repetição do alerta É a informação", () => {
    for (const c of ["cota", "upstream", "desconhecida", "sem_detalhe"] as const) {
      expect(CLASSES_PERMANENTES.has(c), c).toBe(false);
    }
  });

  it("⚠️ o caso da Mistral cai no lado permanente — era isso que gerava 1 alerta/hora", () => {
    expect(CLASSES_PERMANENTES.has(classificarFalha(MISTRAL_REAL))).toBe(true);
  });
});

describe("toda classe tem uma ação escrita", () => {
  it("nenhuma devolve texto vazio ou genérico demais", () => {
    const entradas = [
      undefined, MISTRAL_REAL, "upstream 401: unauthorized",
      "upstream 429: rate limit", "upstream 502", "model not found", "coisa estranha",
    ];
    for (const e of entradas) {
      const out = diagnoseFailure(e);
      expect(out.length, String(e)).toBeGreaterThan(20);
    }
  });
});
