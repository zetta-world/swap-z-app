/**
 * A RÉGUA DA COR — travada com os números reais que a quebraram.
 *
 * ⚠️ 12/08: o dono remediu o laboratório e disse "temos muitos números
 * negativos verdes". Estava certo. O veredito já dizia MORTA desde a
 * invariante nº 18; só a COR tinha ficado para trás, e o olho vai no número
 * grande colorido, não no parágrafo embaixo dele.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  classificarResultado, corDoResultado, legendaDoResultado, corDoPnl,
} from "@/lib/admin/cor-resultado";

const VERDE = "var(--adm-green)";
const VERM  = "var(--adm-red)";
const AMBAR = "var(--adm-amber)";
const CINZA = "var(--adm-ink-3)";

describe("perder dinheiro NUNCA é verde, por melhor que seja a comparação", () => {
  /**
   * ⚠️ O CASO EXATO DA RODADA DE 12/08 01:05. A grade perdeu 51,46% do capital
   * e o painel pintava de verde porque segurar perdeu 66,91%. A conta era
   * `totalPct > segurarPct` — comparação com o competidor, sem olhar se sobrou
   * dinheiro.
   */
  it("a grade a −51,46% contra segurar a −66,91% é VERMELHA", () => {
    const vantagem = -51.46 - -66.91;      // +15,45 pontos "a favor"
    expect(vantagem).toBeGreaterThan(0);
    expect(corDoResultado(-51.46, vantagem)).toBe(VERM);
    expect(classificarResultado(-51.46, vantagem)).toBe("perdeu");
  });

  /**
   * ⚠️ E O CASO DA `amm_lp` NA MESMA RODADA: a piscina rendeu ~−53,6% e a tela
   * pintava de VERDE a vantagem de +0,73 sobre segurar, que rendeu −54,33.
   */
  it("a piscina a −53,60% com vantagem de +0,73 é VERMELHA", () => {
    expect(corDoResultado(-53.60, 0.73)).toBe(VERM);
  });

  /** Ficar no lugar depois de correr risco e pagar custo não é ganho. */
  it("zero é perda, não neutro", () => {
    expect(classificarResultado(0, 10)).toBe("perdeu");
    expect(corDoResultado(0)).toBe(VERM);
  });

  /** E a legenda diz o que a cor sozinha esconderia. */
  it("quando perdeu MENOS que o competidor, a legenda conta as duas metades", () => {
    expect(legendaDoResultado(-51.46, 15.45)).toContain("perdeu dinheiro");
    expect(legendaDoResultado(-51.46, 15.45)).toContain("MENOS");
  });
});

describe("ganhar dinheiro e perder do índice é ÂMBAR — não verde, não vermelho", () => {
  /**
   * ⚠️ O ESTADO QUE UM BOOLEANO NÃO CONSEGUE DIZER. Você tem mais dinheiro
   * (não é derrota) e escolheu pior que não escolher (não é vitória). Verde
   * esconde a segunda metade; vermelho esconde a primeira.
   */
  it("rendeu +2% enquanto segurar rendeu +5%", () => {
    expect(corDoResultado(2, -3)).toBe(AMBAR);
    expect(classificarResultado(2, -3)).toBe("so_perdeu_menos");
    expect(legendaDoResultado(2, -3)).toContain("competidor rendeu mais");
  });

  it("empatar com o índice tendo lucro também é âmbar — não houve vantagem", () => {
    expect(corDoResultado(2, 0)).toBe(AMBAR);
  });
});

describe("ganhar dos dois é verde", () => {
  it("rendeu e bateu o competidor", () => {
    expect(corDoResultado(3.05, 1.2)).toBe(VERDE);
    expect(classificarResultado(3.05, 1.2)).toBe("ganhou");
    expect(legendaDoResultado(3.05, 1.2)).toBeNull();
  });

  /** Sem competidor declarado, ganhar dinheiro basta — e é honesto dizer isso. */
  it("sem vantagem informada, o absoluto positivo decide", () => {
    expect(corDoResultado(3.43)).toBe(VERDE);
    expect(corDoResultado(3.43, null)).toBe(VERDE);
  });
});

describe("ausência de dado NÃO é perda", () => {
  /**
   * ⚠️ MESMA FAMÍLIA DA FASE 10. "Não medimos" e "deu negativo" pintados da
   * mesma cor é a confusão que custou onze estratégias no registro. Cinza é o
   * estado de quem não tem o que dizer.
   */
  it("null e NaN saem cinza, nunca vermelho", () => {
    expect(corDoResultado(null)).toBe(CINZA);
    expect(corDoResultado(undefined)).toBe(CINZA);
    expect(corDoResultado(NaN)).toBe(CINZA);
    expect(classificarResultado(null)).toBe("sem_dado");
  });

  /** Vantagem quebrada não contamina um absoluto que existe. */
  it("absoluto bom com vantagem ausente continua verde", () => {
    expect(corDoResultado(5, NaN)).toBe(VERDE);
  });
});

describe("as quatro classes têm quatro cores distintas", () => {
  /** Duas classes com a mesma cor seriam uma classe com dois nomes. */
  it("nenhuma cor se repete", () => {
    const cores = [
      corDoResultado(5, 1), corDoResultado(-5, 1),
      corDoResultado(5, -1), corDoResultado(null),
    ];
    expect(new Set(cores).size).toBe(4);
  });
});

/**
 * ⚠️ E A RÉGUA SÓ VALE SE NINGUÉM PINTAR RESULTADO À MÃO.
 *
 * O defeito de 12/08 não foi uma função errada — foi um ternário escrito na
 * tela, `totalPct > segurarPct ? verde : vermelho`, num painel só. Uma régua
 * central que convive com ternários soltos protege exatamente os lugares que
 * já estavam certos.
 */
describe("nenhum painel pinta resultado com ternário à mão", () => {
  const dir = "src/components/admin/panels";
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it("existem painéis para varrer (o teste não passa por vazio)", () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  /**
   * Procura a assinatura do defeito: um número de RESULTADO decidindo verde
   * por conta própria. Nomes de campo do domínio — `vantagem`, `total`,
   * `liquid`, `retorno`, `mediana`, `pnl`, `lucro` — são o que distingue isto
   * de um verde legítimo de estado ("conectado", "ativo", "passou").
   */
  it("nenhum ternário de verde/vermelho sobre número de resultado", () => {
    const suspeitos: string[] = [];
    for (const nome of arquivos) {
      const src = readFileSync(join(dir, nome), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      const linhas = src.split("\n");
      linhas.forEach((l, i) => {
        if (!/\?\s*"var\(--adm-green\)"/.test(l)) return;
        if (!/vantagem|total|liquid|retorno|median|pnl|lucro|arrecad/i.test(l)) return;
        suspeitos.push(`${nome}:${i + 1}  ${l.trim().slice(0, 90)}`);
      });
    }
    expect(
      suspeitos,
      "use corDoResultado(absoluto, vantagem) — ternário à mão foi o que pintou −51,46% de verde",
    ).toEqual([]);
  });
});

/**
 * ⚠️ E O P&L TEM RÉGUA PRÓPRIA, porque zero ali significa outra coisa.
 *
 * O painel de operações mostrava "+$0" em VERDE em toda linha: a conta era
 * `n >= 0 ? verde : vermelho`, então zero E NULO saíam com cara de lucro.
 * "Não realizou resultado" e "não sabemos o resultado" ficavam iguais a
 * "deu lucro" — a mentira mais barata que uma tela consegue contar.
 */
describe("corDoPnl — zero não é lucro, e nulo muito menos", () => {
  it("zero é neutro, não verde", () => {
    expect(corDoPnl(0)).toBe(CINZA);
  });

  it("nulo e NaN são neutros, nunca verdes", () => {
    expect(corDoPnl(null)).toBe(CINZA);
    expect(corDoPnl(undefined)).toBe(CINZA);
    expect(corDoPnl(NaN)).toBe(CINZA);
  });

  it("lucro é verde e prejuízo é vermelho", () => {
    expect(corDoPnl(0.01)).toBe(VERDE);
    expect(corDoPnl(-0.01)).toBe(VERM);
  });

  /**
   * ⚠️ E ELA DIVERGE DE `corDoResultado` DE PROPÓSITO: uma estratégia que
   * rendeu 0% depois de risco e custo PERDEU; um P&L de operação em zero é
   * literalmente zero. Se as duas convergirem, uma das duas está errada.
   */
  it("zero de estratégia é perda; zero de P&L não é", () => {
    expect(corDoResultado(0)).toBe(VERM);
    expect(corDoPnl(0)).toBe(CINZA);
  });
});
