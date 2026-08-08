import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * TODA TABELA QUE RANQUEIA MOSTRA A AMOSTRA — E NA ORDEM DA RÉGUA QUE JULGA.
 *
 * ⚠️ POR QUE ISTO É UM TESTE (06/08).
 *
 * O dono olhou um print do painel de funding e perguntou: "será que você vem
 * cometendo o mesmo erro em todas as mesas?". A varredura respondeu que sim,
 * três vezes, e as três com a MESMA forma:
 *
 *  · FUNDING — a tabela ordenava por `netPct`, a régua APOSENTADA em 04/08,
 *    enquanto a coluna que decide (`netAnnualizedPct`) era a primeira e em
 *    negrito. Descia embaralhada: 6,8 · 3,1 · 5,7 · 5,7 · 5,1. E os três
 *    símbolos que o veredito EXCLUIU por janela curta estavam na tabela — VET
 *    (+9,9%/ano em 30 dias) e RUNE (+7,9%) eram os DOIS MAIORES números da tela.
 *
 *  · O QUE FUNCIONOU — `avgTrades` era calculado na rota, chegava tipado ao
 *    painel e não era desenhado. Uma estratégia com 2 trades e +40% ficava no
 *    topo ao lado de uma com 200.
 *
 *  · CARTEIRAS PAPER — a tabela dá MEDALHA por retorno, e `closedTrades` só
 *    aparecia ao expandir a linha. 🥇 numa mesa de 2 trades.
 *
 * Ordem é afirmação: uma tabela ordenada diz "o de cima é o melhor". Se ela
 * ordena pela régua errada, ou esconde o `n`, ela afirma uma coisa que a
 * medição não sustenta — e o leitor não tem como saber.
 *
 * A regra nº 5 do laboratório já dizia "AMOSTRA SEMPRE VISÍVEL". Ela existia em
 * comentário, e comentário não reprova pull request.
 */

function painel(nome: string): string {
  return readFileSync(join("src/components/admin/panels", `${nome}.tsx`), "utf8");
}

/**
 * As tabelas que RANQUEIAM: cada linha é um competidor e a ordem afirma quem é
 * melhor. Tabela de inventário (eventos, logs, carteiras admin) não entra —
 * ali a ordem é cronológica e não afirma mérito.
 */
const RANQUEIAM: Array<{ painel: string; amostra: string; porque: string }> = [
  {
    painel: "FundingPanel",
    amostra: "DIAS",
    porque: "cada linha é um símbolo e a ordem afirma qual funding paga mais; "
      + "a janela entregue é o n, e ela varia de 30 a 188 dias entre linhas",
  },
  {
    painel: "WhatWorkedPanel",
    amostra: "TRADES",
    porque: "cada linha é uma estratégia rankeada por mediana de retorno; sem o "
      + "número de trades, 2 acertos e 200 acertos ficam iguais",
  },
  {
    painel: "PaperPanel",
    amostra: "FECH.",
    porque: "a tabela dá medalha 🥇🥈🥉 por retorno — medalha é a afirmação mais "
      + "forte que uma tabela faz, e sem os fechados ela premia sorte",
  },
  {
    painel: "TournamentPanel",
    amostra: "DEC",
    porque: "ranking de agentes por líquido/trade; DEC é a amostra decidida",
  },
];

describe("tabela que ranqueia mostra o n", () => {
  for (const { painel: nome, amostra, porque } of RANQUEIAM) {
    it(`${nome} carrega a coluna de amostra (${amostra})`, () => {
      const src = painel(nome);
      const temCabecalho = new RegExp(`<th[^>]*>\\s*${amostra.replace(".", "\\.")}\\s*<`).test(src)
        || src.includes(`>${amostra}<`);
      expect(temCabecalho, [
        "",
        `O painel ${nome} ranqueia e não mostra a amostra.`,
        porque,
        "",
        "Número sem `n` é opinião, e tabela ordenada afirma mérito.",
        "",
      ].join("\n")).toBe(true);
    });
  }
});

/**
 * ⚠️ A TRAVA ESPECÍFICA DO FUNDING, porque ali o defeito tinha duas metades e
 * a segunda é a que enganava mais.
 */
describe("funding: a ordem e o piso", () => {
  const rota = readFileSync("src/app/admin/api/funding/route.ts", "utf8");
  const src = painel("FundingPanel");

  it("a rota ordena pela régua que JULGA, não pela aposentada", () => {
    expect(rota).toMatch(/\.sort\(\(a, b\) => b\.netAnnualizedPct - a\.netAnnualizedPct\)/);
    // E a antiga não pode voltar por engano.
    expect(rota).not.toMatch(/\.sort\(\(a, b\) => b\.netPct - a\.netPct\)/);
  });

  /**
   * VET (+9,9%/ano em 30 dias) era o maior número da tela e o veredito o tinha
   * jogado fora cinco linhas acima. Quem lê a tabela escolhe VET.
   */
  it("quem está abaixo do piso de dias NÃO entra na tabela ranqueada", () => {
    expect(src).toMatch(/const ranqueados = .*\.filter\(\(s\) => s\.days >= minDias\)/);
    expect(src).toMatch(/const curtos = .*\.filter\(\(s\) => s\.days < minDias\)/);
    expect(src).toContain("{ranqueados.slice(0, 30).map(");
  });

  /** Esconder o excluído é o defeito oposto. Ele aparece — fora do ranking. */
  it("os excluídos continuam VISÍVEIS, ditos como excluídos", () => {
    expect(src).toContain("FORA DO VEREDITO");
    expect(src).toMatch(/curtos\.map\(/);
  });

  it("o piso vem da rota, não é um 60 escrito na tela", () => {
    expect(rota).toMatch(/minDias: MIN_DIAS/);
    expect(src).toMatch(/d\?\.resumo\.minDias/);
  });
});
