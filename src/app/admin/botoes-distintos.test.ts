import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * DOIS BOTÕES DIFERENTES NÃO PODEM TER O MESMO RÓTULO.
 *
 * ⚠️ POR QUE ISTO É UM TESTE (04/08).
 *
 * Adicionei o painel "O QUE TERIA DADO LUCRO" com botões escritos
 * "⏮ 6 meses ANTES" e "⏮ 12 meses ANTES" — as MESMAS palavras dos botões do
 * backtest, dois painéis acima.
 *
 * O dono disse "rodei nas 3 janelas" e o que disparou foi o backtest, duas
 * vezes na janela de hoje. Dois painéis diferentes, botões idênticos, e nenhuma
 * forma — nem para ele, nem para mim olhando os eventos — de saber qual tinha
 * sido clicado.
 *
 * É o mesmo defeito do `adm-btn` sem CSS num degrau acima: lá o botão não
 * parecia clicável, aqui ele não diz o que faz. Os dois custam a mesma coisa —
 * o operador acha que agiu, e agiu em outro lugar.
 *
 * Rótulo é interface. Interface ambígua é bug.
 */

function paineis(): Array<{ arquivo: string; src: string }> {
  const dir = "src/components/admin/panels";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ arquivo: f, src: readFileSync(join(dir, f), "utf8") }));
}

/** O texto dentro de um <button className="adm-btn"> … </button>. */
function rotulos(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<button[^>]*adm-btn[^>]*>([\s\S]*?)<\/button>/g)) {
    const texto = m[1]
      .replace(/\{[^}]*\}/g, " ")      // expressões JSX
      .replace(/\{"[^"]*"\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (texto.length > 3) out.push(texto);
  }
  return out;
}

describe("os botões dos painéis se distinguem", () => {
  it("nenhum rótulo se repete em painéis DIFERENTES", () => {
    const vistos = new Map<string, string[]>();
    for (const { arquivo, src } of paineis()) {
      for (const r of rotulos(src)) {
        const lista = vistos.get(r) ?? [];
        if (!lista.includes(arquivo)) lista.push(arquivo);
        vistos.set(r, lista);
      }
    }
    const repetidos = [...vistos.entries()]
      .filter(([, arqs]) => arqs.length > 1)
      .map(([rotulo, arqs]) => `"${rotulo}" em ${arqs.join(" e ")}`);

    expect(repetidos, [
      "",
      "Estes rótulos aparecem em painéis diferentes.",
      "O operador não tem como saber qual botão apertou — e nem quem lê os",
      "eventos depois. Dê a cada um o nome do que ele FAZ, não só da janela.",
      "",
    ].join("\n")).toEqual([]);
  });

  it("o scanner enxerga os botões — não passa por varrer nada", () => {
    const todos = paineis().flatMap((p) => rotulos(p.src));
    expect(todos.length).toBeGreaterThan(5);
  });
});
