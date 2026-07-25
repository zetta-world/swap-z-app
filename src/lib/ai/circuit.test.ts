import { describe, it, expect } from "vitest";
import { diagnoseFailure } from "@/lib/ai/circuit";

describe("diagnoseFailure — the breaker alert must name the real action", () => {
  it("classifies the retired-model 400 as CONFIG, not as a key problem", () => {
    // The exact 25/07 DeepSeek payload that made the alert say "fix the key".
    const real = 'upstream 400: {"error":{"message":"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed deepseek-chat.","type":"invalid_request_error"}}';
    const out = diagnoseFailure(real);
    expect(out).toContain("MODELO INVÁLIDO");
    expect(out).toContain("Não é a chave");
  });

  it("classifies auth, quota and upstream failures distinctly", () => {
    expect(diagnoseFailure("upstream 401: unauthorized")).toContain("AUTH");
    expect(diagnoseFailure("upstream 429: rate limit exceeded")).toContain("COTA");
    expect(diagnoseFailure("Insufficient Balance")).toContain("COTA");
    expect(diagnoseFailure("upstream 503: service unavailable")).toContain("UPSTREAM");
    expect(diagnoseFailure("request timed out after 40000ms")).toContain("UPSTREAM");
  });

  it("never pretends to know what it doesn't", () => {
    expect(diagnoseFailure(undefined)).toContain("Sem detalhe");
    expect(diagnoseFailure("something weird happened")).toContain("não classificada");
  });
});
