import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classificarResultado, corDoResultado, legendaDoResultado } from "@/lib/admin/cor-resultado";

/**
 * ⚠️⚠️ O GRÁFICO "A MESA CONTRA NÃO FAZER NADA" (29/08).
 *
 * A medição que motivou o gráfico: cinco de seis mesas PERDERAM para segurar os
 * próprios símbolos, por 3 a 21 pontos percentuais. A melhor fez +$42 de uma
 * oportunidade de +$194 na mesma janela — capturou 22% da maré assumindo risco
 * de timing.
 *
 * ⚠️ O RISCO QUE ESTE ARQUIVO SEGURA é a cor. `strat_mech` fez **+4,21%**, que é
 * positivo — e uma cor de dois estados a pinta de VERDE. Só que segurar deu
 * +19,42%: ela rendeu e escolheu pior que não escolher. É o terceiro estado que
 * `cor-resultado.ts` criou (ÂMBAR), e foi por não ter esse estado que o painel
 * do laboratório pintou de verde, em 12/08, uma grade que perdeu METADE do
 * capital só por perder menos que segurar.
 *
 * O primeiro rascunho deste gráfico usava `corDoPnl` (dois estados) e teria
 * repetido a cicatriz. Os testes abaixo existem para que isso não volte.
 */

const CAMINHO = "src/components/admin/panels/TournamentPanel.tsx";

describe("os números reais das mesas caem no estado certo", () => {
  it("⚠️ strat_mech: +4,21% com segurar a +19,42% é ÂMBAR, não verde", () => {
    const mesa = 4.21, diferenca = 4.21 - 19.42;
    expect(classificarResultado(mesa, diferenca)).toBe("so_perdeu_menos");
    expect(corDoResultado(mesa, diferenca)).toBe("var(--adm-amber)");
    expect(legendaDoResultado(mesa, diferenca)).toBe("rendeu, mas o competidor rendeu mais");
  });

  it("⚠️ strat_dex: perdeu dinheiro é VERMELHO mesmo BATENDO segurar", () => {
    // −0,99% da mesa contra −5,12% de segurar: bateu a régua e encolheu o capital.
    const mesa = -0.99, diferenca = -0.99 - (-5.12);
    expect(diferenca).toBeGreaterThan(0);          // bateu segurar
    expect(classificarResultado(mesa, diferenca)).toBe("perdeu");
    expect(corDoResultado(mesa, diferenca)).toBe("var(--adm-red)");
  });

  it("as outras quatro mesas medidas em 29/08 também não saem verdes", () => {
    const medidas: Array<[string, number, number]> = [
      ["strat_day",    4.04, 19.79],
      ["mistral_scan", 2.82, 19.81],
      ["radar",        0.70, 21.93],
      ["strat_ai",    -1.05,  1.98],
    ];
    for (const [nome, mesa, segurar] of medidas) {
      const cor = corDoResultado(mesa, mesa - segurar);
      expect(cor, nome).not.toBe("var(--adm-green)");
    }
  });

  it("uma mesa que ganhasse E batesse segurar seria verde — a régua não é só punitiva", () => {
    expect(corDoResultado(8, 8 - 3)).toBe("var(--adm-green)");
  });
});

/**
 * ⚠️ TRAVA TEXTUAL, e ela é deliberada.
 *
 * O componente é JSX e o vitest deste repo roda em `environment: "node"` — não
 * há renderizador para afirmar a cor de um `<rect>`. O que dá para garantir é
 * que a barra da mesa não volte à primitiva de dois estados. É frágil a
 * renomeação, e mesmo assim vale mais que nenhuma guarda sobre a cor que já
 * mentiu uma vez neste projeto.
 */
describe("a barra da mesa usa a primitiva de TRÊS estados", () => {
  const fonte = readFileSync(join(process.cwd(), CAMINHO), "utf8");

  it("o gráfico existe e está montado na tela", () => {
    expect(fonte).toMatch(/function ContraSegurar/);
    expect(fonte).toMatch(/<ContraSegurar\s+agentes=/);
  });

  it("⚠️ o `fill` da barra vem de `corDoResultado`, nunca de `corDoPnl`", () => {
    const fill = fonte.match(/fill=\{cor[A-Za-z]+\([^)]*\)\}/g) ?? [];
    expect(fill.length).toBeGreaterThan(0);
    for (const f of fill) expect(f).toContain("corDoResultado");
  });

  it("⚠️ a cor recebe a DIFERENÇA, não só o valor da mesa", () => {
    // Sem o segundo argumento, `corDoResultado` cai em dois estados e o âmbar
    // some — o mesmo defeito por outro caminho.
    expect(fonte).toMatch(/corDoResultado\(l\.c\.mesaPct,\s*l\.c\.diferencaPp\)/);
  });

  it("⚠️ o âmbar tem legenda na TELA, não só no tooltip", () => {
    expect(fonte).toMatch(/legendaDoResultado/);
    expect(fonte).toMatch(/rendeu, mas segurar teria rendido mais/);
  });

  it("a régua de segurar NÃO é colorida por resultado", () => {
    // A linha vertical da referência é sempre neutra: ela não é da mesa.
    expect(fonte).toMatch(/stroke="var\(--adm-ink-3\)"[^>]*\/>\s*<\/svg>/);
  });
});
