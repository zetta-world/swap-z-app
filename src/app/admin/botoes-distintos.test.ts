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

/**
 * OS CONTROLES QUE MEXEM EM DINHEIRO PRECISAM DE VERBOS DIFERENTES.
 *
 * ⚠️ POR QUE ISTO GANHOU TESTE PRÓPRIO (06/08).
 *
 * O `PaperPanel` passou a ter TRÊS controles que alteram capital:
 *
 *   ↺ devolver o capital às carteiras vivas   (reparo de vazamento)
 *   ⚖ RECAPITALIZAR … e arquivar a rodada     (capital por estratégia)
 *   ↺ devolver … (o mesmo, quando há déficit)
 *
 * O rótulo genérico já custou dias uma vez, com os dois botões de backtest. Em
 * dinheiro custa mais: "devolver" e "recapitalizar" fazem coisas diferentes e
 * uma delas ARQUIVA a rodada inteira.
 *
 * A regra: cada controle de capital começa com um VERBO distinto, e o rótulo
 * carrega a consequência quando ela é destrutiva.
 */
describe("controles de dinheiro no painel de carteiras", () => {
  const src = readFileSync("src/components/admin/panels/PaperPanel.tsx", "utf8");

  it("o botão de recapitalizar diz que ARQUIVA — a consequência está no rótulo", () => {
    expect(src).toMatch(/RECAPITALIZAR[^<]*arquivar a rodada/);
  });

  it("recapitalizar e devolver usam verbos DIFERENTES", () => {
    expect(src).toContain("devolver o capital às carteiras vivas");
    expect(src).toContain("RECAPITALIZAR");
    // Nenhum dos dois pode usar o verbo do outro, senão viram o mesmo botão
    // na cabeça de quem lê rápido.
    expect(src).not.toMatch(/RECAPITALIZAR[^<]*devolver/);
  });

  /**
   * O motivo é exigido em três camadas (rota, módulo, CHECK do banco). A UI é
   * a quarta e a mais importante: ela impede o clique em vez de reprovar
   * depois, e mostra o contador para o operador saber quanto falta.
   */
  it("o botão de recapitalizar fica DESABILITADO sem motivo escrito", () => {
    expect(src).toMatch(/disabled=\{recapando \|\| recapMotivo\.trim\(\)\.length < 15\}/);
    expect(src).toMatch(/escreva o motivo/);
  });

  it("a consequência destrutiva aparece ANTES do botão, não depois", () => {
    const avisoIdx = src.indexOf("ARQUIVA a rodada atual");
    const botaoIdx = src.indexOf("RECAPITALIZAR ${recap.plan.length}");

    /**
     * ⚠️ AS DUAS ÂNCORAS SÃO AFIRMADAS ANTES DA COMPARAÇÃO, e isso não é
     * preciosismo.
     *
     * A primeira versão deste teste era `toBeLessThan(botaoIdx > 0 ? botaoIdx
     * : src.length)`. Se alguém renomeasse o rótulo do botão, `indexOf`
     * devolveria −1, o fallback usaria o fim do arquivo, e a comparação
     * passaria SEMPRE — um teste que vira decoração no dia em que o código
     * muda, sem nunca ficar vermelho.
     *
     * É a mesma família do `n=0` aprovando no portão de lançamento: a
     * ausência de dado tratada como resposta.
     */
    expect(avisoIdx, "âncora do aviso sumiu — renomearam o texto?").toBeGreaterThan(0);
    expect(botaoIdx, "âncora do botão sumiu — renomearam o rótulo?").toBeGreaterThan(0);
    // Se o aviso vier depois do botão, o operador clica antes de ler.
    expect(avisoIdx).toBeLessThan(botaoIdx);
  });
});
