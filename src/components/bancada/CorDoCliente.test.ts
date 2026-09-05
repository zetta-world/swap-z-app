/**
 * ⚠️ A REGRA ATRAVESSA DO ADMIN; O CSS NÃO. Este teste guarda os dois lados:
 * que a classificação continua sendo a do admin, e que a cor é da paleta do
 * cliente — `var(--adm-*)` não existe nesta árvore e sairia transparente numa
 * tela em que a cor É a mensagem.
 */
import { describe, it, expect } from "vitest";
import { COR_DO_CLIENTE, corDoNumero } from "@/components/bancada/CorDoCliente";
import { classificarResultado } from "@/lib/admin/cor-resultado";
import { NAV_ITEMS } from "@/components/layout/nav-items";

describe("a cor do resultado na tela do cliente", () => {
  it("⚠️ nenhuma cor é variável do admin", () => {
    for (const [classe, cor] of Object.entries(COR_DO_CLIENTE)) {
      expect(cor, classe).not.toMatch(/--adm-/);
      expect(cor, classe).toMatch(/^text-/);
    }
  });

  it("⚠️ perdeu dinheiro é VERMELHO mesmo tendo batido o competidor", () => {
    // A cicatriz: a grade perdeu 51% e saiu VERDE porque segurar perdeu 66%.
    const classe = classificarResultado(-51.46, +15.45);
    expect(classe).toBe("perdeu");
    expect(COR_DO_CLIENTE[classe]).toBe("text-red");
  });

  it("⚠️ ganhou mas perdeu do índice é ÂMBAR — o caso que um booleano não diz", () => {
    const classe = classificarResultado(+0.73, -0.4);
    expect(classe).toBe("so_perdeu_menos");
    expect(COR_DO_CLIENTE[classe]).toBe("text-gold");
  });

  it("⚠️ ausência é CINZA, nunca vermelho", () => {
    expect(COR_DO_CLIENTE[classificarResultado(null)]).toBe("text-ink-3");
  });

  it("⚠️ amostra fraca não ganha cor de veredito — nem a de 'sem dado'", () => {
    // Ela fica visível E desqualificada: é a única forma de dizer "ainda não
    // sei" sem mentir para nenhum dos dois lados.
    expect(corDoNumero("ganhou", false)).toBe("text-ink-2");
    expect(corDoNumero("perdeu", false)).toBe("text-ink-2");
    expect(corDoNumero("ganhou", true)).toBe("text-green");
  });
});

describe("a bancada não é uma rota órfã", () => {
  it("⚠️ tem entrada na fonte única de navegação", () => {
    // `nav-items.ts` alimenta sidebar, mobile e ⌘K. Uma rota sem entrada aqui
    // só é alcançável por quem souber a URL — foi o que aconteceu com `/plans`.
    const item = NAV_ITEMS.find((i) => i.href === "/laboratorio");
    expect(item).toBeDefined();
    expect(item!.labelKey).toBe("nav.laboratorio");
  });
});
