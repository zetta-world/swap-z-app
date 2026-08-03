import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TODA CLASSE USADA TEM QUE EXISTIR NO CSS.
 *
 * ⚠️ POR QUE ISTO É UM TESTE (04/08).
 *
 * `adm-btn` era usada por SETE botões em cinco painéis — rodar backtest, varrer
 * calibragem, conferir preços ao vivo, devolver capital às carteiras, zerar
 * ledger — e a regra nunca foi escrita no CSS. Eles renderizavam como `<button>`
 * cru: texto grande, sem borda, sem fundo, sem cursor.
 *
 * O dono descreveu o sintoma sem saber a causa: "nem parece algo clicável". E o
 * estrago não foi estético — ele passou dias achando que tinha rodado varreduras
 * que nunca disparou, porque os três botões pareciam uma frase só.
 *
 * Um controle que não parece controle é pior que um escondido: o operador acha
 * que agiu. E isso é indetectável por `tsc`, por lint e por teste de unidade —
 * classe inexistente é string válida em toda parte.
 */

function arquivos(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.tsx$/.test(nome)) out.push(p);
  }
  return out;
}

describe("classes adm-* usadas nos painéis existem no CSS", () => {
  const css = readFileSync("src/app/admin/admin.css", "utf8");

  it("nenhuma classe adm-* é usada sem regra correspondente", () => {
    const usadas = new Set<string>();
    for (const f of arquivos("src/components/admin").concat(arquivos("src/app/admin"))) {
      const src = readFileSync(f, "utf8");
      // className="adm-x adm-y" e className={`adm-x ${...}`}
      for (const m of src.matchAll(/className=[{"`]([^"`}]*)/g)) {
        for (const cls of m[1].split(/[\s${}]+/)) {
          if (/^adm-[a-z0-9-]+$/.test(cls)) usadas.add(cls);
        }
      }
    }

    const semRegra = [...usadas].filter((c) => !new RegExp(`\\.${c}[\\s,:{]`).test(css));
    expect(semRegra, [
      "",
      "Estas classes são usadas nos painéis e NÃO existem no CSS.",
      "O elemento renderiza sem estilo nenhum — e isso passa por tsc, lint e",
      "teste de unidade, porque classe inexistente é string válida em toda parte.",
      "",
    ].join("\n")).toEqual([]);
  });

  it("o scanner realmente enxerga as classes — não passa por varrer nada", () => {
    // Sem isto, um erro de caminho ou de regex faria o teste passar por vazio,
    // que é a pior forma de um teste mentir.
    const src = readFileSync("src/components/admin/panels/PlaybookBacktestPanel.tsx", "utf8");
    expect(src).toContain("adm-btn");
    expect(css).toContain(".adm-btn");
  });
});
