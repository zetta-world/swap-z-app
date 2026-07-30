import { describe, it, expect } from "vitest";
import { scoreFindings, type AuditFinding } from "@/lib/admin/audit";

const f = (over: Partial<AuditFinding>): AuditFinding => ({
  id: "x", name: "check", category: "config", severity: "medium",
  pass: true, detail: "", whyRuntime: "", ...over,
});

describe("scoreFindings — a nota tem que ser difícil de falsificar", () => {
  it("tudo aprovado → 10", () => {
    const r = scoreFindings([f({}), f({ id: "y", severity: "critical" })]);
    expect(r.score).toBe(10);
    expect(r.grade).toBe("A");
    expect(r.blocking).toHaveLength(0);
  });

  it("INCONCLUSIVO não conta como aprovado — é assim que auditoria mente sem mentir", () => {
    const r = scoreFindings([f({ id: "a", inconclusive: true, pass: false, severity: "critical" })]);
    // Nada foi medido, então não há nota a dar — e o veredito avisa do buraco.
    expect(r.inconclusive).toBe(1);
    expect(r.passed).toBe(0);
    expect(r.blocking).toHaveLength(0);      // não bloqueia (não foi reprovado)
    expect(r.verdict).toContain("não pôde");  // mas TAMBÉM não aprova
  });

  it("um CRÍTICO reprovado não é diluído por vários cosméticos aprovados", () => {
    const r = scoreFindings([
      f({ id: "crit", severity: "critical", pass: false }),
      ...Array.from({ length: 6 }, (_, i) => f({ id: `low${i}`, severity: "low", pass: true })),
    ]);
    // 6 pontos de 14 possíveis — reprovado, apesar de 6 de 7 checks passarem.
    expect(r.score).toBeLessThan(5);
    expect(r.grade).toBe("F");
    expect(r.blocking).toHaveLength(1);
  });

  it("crítico e alto bloqueiam; médio e baixo não", () => {
    const r = scoreFindings([
      f({ id: "c", severity: "critical", pass: false }),
      f({ id: "h", severity: "high", pass: false }),
      f({ id: "m", severity: "medium", pass: false }),
      f({ id: "l", severity: "low", pass: false }),
    ]);
    expect(r.blocking.map((b) => b.id).sort()).toEqual(["c", "h"]);
  });

  it("bloqueante manda no veredito e diz que NÃO está pronta", () => {
    const r = scoreFindings([f({ id: "c", severity: "critical", pass: false })]);
    expect(r.verdict).toContain("🔴");
    expect(r.verdict).toContain("NÃO está pronta");
  });

  it("sem bloqueante e sem buraco → verde", () => {
    const r = scoreFindings([f({ severity: "high" }), f({ id: "z", severity: "critical" })]);
    expect(r.verdict).toContain("🟢");
  });

  it("um inconclusivo impede o verde mesmo com todo o resto passando", () => {
    const r = scoreFindings([
      f({ id: "ok", severity: "critical", pass: true }),
      f({ id: "hole", severity: "high", pass: false, inconclusive: true }),
    ]);
    expect(r.score).toBe(10);              // do que foi medido, tudo passou
    expect(r.verdict).toContain("🟡");     // mas a cobertura está incompleta
    expect(r.verdict).toContain("não aprovação");
  });

  it("conjunto vazio não inventa nota", () => {
    expect(scoreFindings([]).score).toBe(0);
  });
});
