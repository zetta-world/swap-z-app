import { describe, it, expect } from "vitest";
import { assessTokenSafety, isNativeToken, nativeSafety } from "@/lib/swap/token-safety";

describe("assessTokenSafety — ausência de verificação NÃO é segurança", () => {
  it("sem resposta da API vira UNVERIFIED, nunca safe", () => {
    // A regra inteira deste arquivo. Um selo verde vindo de 'não checamos'
    // produz confiança sem produzir garantia — e o usuário assina em cima.
    const v = assessTokenSafety(null);
    expect(v.level).toBe("unverified");
    expect(v.level).not.toBe("safe");
    expect(v.message).toContain("NÃO significa que é seguro");
  });

  it("resposta sem score também é unverified", () => {
    expect(assessTokenSafety({ category: "safe" }).level).toBe("unverified");
  });

  it("unverified NÃO bloqueia — é desconhecido, não condenado", () => {
    // Bloquear o desconhecido tornaria a plataforma inútil sempre que a API
    // de terceiro oscilasse; avisar é a resposta proporcional.
    expect(assessTokenSafety(null).blocks).toBe(false);
  });
});

describe("perigo confirmado bloqueia", () => {
  it("honeypot bloqueia a execução", () => {
    const v = assessTokenSafety({ score: 85, category: "danger", signals: [{ label: "GoPlus honeypot flag" }] });
    expect(v.level).toBe("danger");
    expect(v.blocks).toBe(true);
    expect(v.message).toContain("honeypot");
  });

  it("'não consegue vender' bloqueia — perda de 100% do que entrar", () => {
    const v = assessTokenSafety({ score: 75, category: "danger", signals: [{ label: "Cannot sell all" }] });
    expect(v.blocks).toBe(true);
  });

  it("alto risco AVISA mas não bloqueia — a decisão continua do usuário", () => {
    const v = assessTokenSafety({ score: 50, category: "risky", signals: [{ label: "taxa de venda alta" }] });
    expect(v.level).toBe("risky");
    expect(v.blocks).toBe(false);
    expect(v.message).toContain("ALTO RISCO");
  });

  it("cautela é só leitura, sem atrito", () => {
    const v = assessTokenSafety({ score: 25, category: "caution", signals: [] });
    expect(v.level).toBe("caution");
    expect(v.blocks).toBe(false);
  });

  it("seguro não inventa mensagem", () => {
    const v = assessTokenSafety({ score: 5, category: "safe", signals: [] });
    expect(v.level).toBe("safe");
    expect(v.message).toBe("");
    expect(v.blocks).toBe(false);
  });
});

describe("token nativo", () => {
  it("reconhece o nativo", () => {
    expect(isNativeToken("native")).toBe(true);
    expect(isNativeToken("0xa0b8…")).toBe(false);
    expect(isNativeToken(undefined)).toBe(false);
  });

  it("nativo é seguro por natureza — não tem contrato para golpe", () => {
    const v = nativeSafety();
    expect(v.level).toBe("safe");
    expect(v.blocks).toBe(false);
  });
});

describe("sinais", () => {
  it("aceita sinal em texto ou em objeto", () => {
    const a = assessTokenSafety({ score: 80, category: "danger", signals: ["honeypot cru"] });
    const b = assessTokenSafety({ score: 80, category: "danger", signals: [{ label: "honeypot obj" }] });
    expect(a.signals[0]).toBe("honeypot cru");
    expect(b.signals[0]).toBe("honeypot obj");
  });

  it("limita a 4 sinais — lista longa vira ruído e ninguém lê", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `s${i}` }));
    expect(assessTokenSafety({ score: 80, category: "danger", signals: many }).signals).toHaveLength(4);
  });
});
