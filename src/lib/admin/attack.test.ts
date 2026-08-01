import { describe, it, expect } from "vitest";
import {
  selfTest, detectsReflection, detectsErrorLeak,
  detectsDangerousCors, detectsOpenRedirect, detectsDangerousMethod,
} from "@/lib/admin/attack";

const EVIL = "https://evil.example.com";

describe("canário — o teste do testador", () => {
  it("passa quando todos os detectores enxergam", () => {
    const r = selfTest();
    expect(r.pass).toBe(true);
    expect(r.severity).toBe("critical");
  });

  it("é CRÍTICO de propósito — detector cego torna todo verde da tela ficção", () => {
    expect(selfTest().severity).toBe("critical");
  });
});

describe("detectsReflection", () => {
  it("acusa carga LITERAL no corpo", () => {
    expect(detectsReflection("<div><zz></div>", "<zz>")).toBe(true);
  });
  it("NÃO acusa carga escapada — é a defesa funcionando", () => {
    expect(detectsReflection("<div>&lt;zz&gt;</div>", "<zz>")).toBe(false);
  });
});

describe("detectsErrorLeak", () => {
  it("acusa stack trace de servidor", () => {
    expect(detectsErrorLeak("Error\n    at h (/var/task/node_modules/pg/x.js:1)")).toBeTruthy();
  });
  it("acusa nome de variável de segredo", () => {
    expect(detectsErrorLeak("missing SUPABASE_SERVICE_ROLE_KEY")).toBeTruthy();
  });
  it("acusa chave de API vazada", () => {
    expect(detectsErrorLeak("key=sk-abcdefghij123")).toBeTruthy();
  });
  it("NÃO acusa erro de validação genérico", () => {
    // Alarme falso aqui treina o operador a ignorar o alarme verdadeiro.
    expect(detectsErrorLeak('{"ok":false,"error":"invalid_chain"}')).toBeNull();
    expect(detectsErrorLeak("Not Found")).toBeNull();
  });
});

describe("detectsDangerousCors", () => {
  it("acusa origem refletida COM credenciais", () => {
    expect(detectsDangerousCors(EVIL, "true", EVIL)).toBe(true);
  });
  it("acusa wildcard COM credenciais", () => {
    expect(detectsDangerousCors("*", "true", EVIL)).toBe(true);
  });
  it("NÃO acusa reflexão SEM credenciais — não dá pra agir como o usuário", () => {
    expect(detectsDangerousCors(EVIL, null, EVIL)).toBe(false);
  });
  it("NÃO acusa ausência de header", () => {
    expect(detectsDangerousCors(null, null, EVIL)).toBe(false);
  });
});

describe("detectsOpenRedirect", () => {
  it("acusa Location apontando para fora", () => {
    expect(detectsOpenRedirect(`${EVIL}/pwn`, EVIL)).toBe(true);
  });
  it("NÃO acusa redirect interno", () => {
    expect(detectsOpenRedirect("/dashboard", EVIL)).toBe(false);
    expect(detectsOpenRedirect(null, EVIL)).toBe(false);
  });
});

describe("detectsDangerousMethod", () => {
  it("acusa TRACE aceito", () => {
    expect(detectsDangerousMethod(200)).toBe(true);
  });
  it("NÃO acusa TRACE recusado", () => {
    expect(detectsDangerousMethod(405)).toBe(false);
    expect(detectsDangerousMethod(501)).toBe(false);
  });
});
