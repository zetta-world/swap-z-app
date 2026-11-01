/**
 * R3 — travas de UI do Admin (estáticas: o repo não tem DOM de teste).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("R3 · UI do admin", () => {
  it("todo painel renderizado passa por FronteiraDePainel (um painel que lança não derruba a grade)", () => {
    expect(ler("src/components/admin/ModuleGrid.tsx")).toMatch(/<FronteiraDePainel id=\{id\}>\{panels\[id\]\}<\/FronteiraDePainel>/);
    expect(ler("src/components/admin/PainelSozinho.tsx")).toMatch(/<FronteiraDePainel id=\{id\}>\{conteudo\}<\/FronteiraDePainel>/);
    expect(ler("src/components/admin/FronteiraDePainel.tsx")).toMatch(/getDerivedStateFromError/);
  });

  it("a grade não estoura em 360 px", () => {
    const g = ler("src/components/admin/ModuleGrid.tsx");
    expect(g).toContain("minmax(min(400px, 100%), 1fr)");
    expect(g).not.toMatch(/minmax\(400px/);
  });

  it("confirmação: foco inicial no CANCELAR, nunca no destrutivo", () => {
    const c = ler("src/components/admin/useAdminConfirm.tsx");
    expect(c).toMatch(/onClick=\{\(\) => close\(false\)\} autoFocus/);
    expect(c).not.toMatch(/close\(true\)\}\s*autoFocus/);
  });

  it("⌘K navega para a tela do painel (Shift+Enter mantém o liga/desliga)", () => {
    const k = ler("src/components/admin/AdminCommandBar.tsx");
    expect(k).toContain("router.push(`/admin/area/${area}/${id}`)");
    expect(k).toMatch(/commit\(items\[activeIdx\]\.id, e\.shiftKey\)/);
    expect(k).toContain('aria-label="Buscar painel do admin"');
  });

  it("existe fronteira de rota do admin", () => {
    expect(ler("src/app/admin/error.tsx")).toMatch(/export default function/);
  });
});
