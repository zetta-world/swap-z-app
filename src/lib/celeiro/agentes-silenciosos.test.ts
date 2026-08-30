import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lerCandidato } from "@/lib/celeiro/pool-fonte";
import { decidir as decidirBase, MARGEM_EXIGIDA_PP } from "@/lib/celeiro/base-convergencia";
import { CUSTO_DO_CICLO_PCT } from "@/lib/celeiro/funding-colheita";

/**
 * ⚠️⚠️ TRÊS DE SETE AGENTES DO CELEIRO NUNCA PRODUZIRAM UM LANÇAMENTO (30/08).
 *
 * `convergencia_base`, `colheita_funding` e `pool_novo` rodavam a cada tick,
 * com genoma ativo, por dez dias, e o portão de nenhum abriu uma vez. Da tela
 * os três eram idênticos: "examinou, recusou". Medindo, eram três coisas
 * completamente diferentes — e só UMA era defeito.
 *
 *   convergencia_base   silêncio HONESTO, e é aritmética de taxa
 *   colheita_funding    silêncio HONESTO, e a régua é o próprio controle
 *   pool_novo           DEFEITO: nunca julgou nada, e parecia rigoroso
 *
 * Este arquivo segura as três leituras, porque a mais cara delas foi confundir
 * "recusou com razão" com "nunca chegou a decidir".
 */

describe("① convergencia_base — o silêncio é aritmético, não é bug", () => {
  /** As bases REAIS lidas no tick de 30/08 16:00. */
  const REAIS: Array<[string, number]> = [["BTC", -0.106], ["ETH", -0.126], ["SOL", -0.075]];

  it("⚠️ a base dos majors é 4× a 8× MENOR que o custo do ciclo", () => {
    // 4 pernas maker: 2×0,20% spot + 2×0,015% futuros = 0,43%.
    expect(CUSTO_DO_CICLO_PCT).toBeCloseTo(0.43, 6);
    for (const [sym, base] of REAIS) {
      expect(Math.abs(base), sym).toBeLessThan(CUSTO_DO_CICLO_PCT / 3);
    }
  });

  it("⚠️⚠️ e 93% do custo é a perna SPOT — o futuro é quase de graça", () => {
    // 0,40 de spot contra 0,03 de futuros. Nenhum ajuste no lado do perpétuo
    // resolve; o que exclui o agente é a tabela do spot da praça.
    const spot = 2 * 0.20, futuros = 2 * 0.015;
    expect(spot + futuros).toBeCloseTo(CUSTO_DO_CICLO_PCT, 6);
    expect(spot / (spot + futuros)).toBeGreaterThan(0.9);
  });

  it("as três recusas reais são corretas — nenhuma delas é defeito", () => {
    for (const [sym, base] of REAIS) {
      const d = decidirBase({ perp: 100 * (1 + base / 100), spot: 100 }, MARGEM_EXIGIDA_PP);
      expect(d.abre, sym).toBe(false);
      expect(d.sobraPct!, sym).toBeLessThan(0);
    }
  });

  it("⚠️ o limiar que ele precisa é 0,58% — a base teria de abrir 5× o normal", () => {
    const precisa = CUSTO_DO_CICLO_PCT + MARGEM_EXIGIDA_PP;
    expect(precisa).toBeCloseTo(0.58, 6);
    // Uma base assim existe; nos majors, quase nunca. Isto NÃO é motivo para
    // baixar o limiar: abaixo dele a operação perde dinheiro por construção.
    const d = decidirBase({ perp: 100.6, spot: 100 }, MARGEM_EXIGIDA_PP);
    expect(d.abre).toBe(true);
  });
});

describe("② colheita_funding — recusa porque o CONTROLE rende mais", () => {
  /** Os números reais do tick de 30/08 16:00, contra o piso de 4,50%/ano. */
  const REAIS = [
    { sym: "BTC", anual: 3.83, equilibrioDias: 37, fatiaNegativa: 0.14 },
    { sym: "ETH", anual: 3.40, equilibrioDias: 41, fatiaNegativa: 0.18 },
    { sym: "SOL", anual: 0.44, equilibrioDias: 180, fatiaNegativa: 0.51 },
  ];

  it("⚠️ os três rendem MENOS que emprestar o USDT parado", () => {
    const barra = 2.5 + 2;   // controle 2,5%/ano + margem 2pp
    for (const r of REAIS) expect(r.anual, r.sym).toBeLessThan(barra);
  });

  it("⚠️⚠️ e o controle medido bate com o que o Aluguel realmente rendeu", () => {
    // 0,074 USDT/dia sobre $1.000 = 2,70%/ano. O portão usa 2,5%. A régua não
    // é um número inventado — é o piso vivo, e é isso que a torna honesta.
    const medido = 0.074 * 365 / 1000 * 100;
    expect(medido).toBeGreaterThan(2.5);
    expect(medido).toBeLessThan(3.0);
  });

  it("o SOL é o caso claro: metade dos períodos negativos, equilíbrio em 180 dias", () => {
    const sol = REAIS[2];
    expect(sol.fatiaNegativa).toBeGreaterThan(0.5);
    expect(sol.equilibrioDias).toBeGreaterThan(90);
  });
});

describe("③ ⚠️⚠️ pool_novo — ESTE era defeito, e se disfarçava de rigor", () => {
  it("⚠️ candidato com token igual ao pool nem chega às fontes", async () => {
    // Era este o estado de TODOS os candidatos: `tokenAddress === poolAddress`,
    // porque o token era extraído do id do POOL. A GoPlus não devolve segurança
    // de um contrato de pool, então a leitura falhava sempre.
    const c = await lerCandidato("base", "0xPOOL", "0xpool", "PEPE / WETH");
    expect(c.pool).toBe(null);
    expect(c.porqueNaoLeu).toContain("montado errado");
    expect(c.porqueNaoLeu).not.toContain("não respondeu");   // não é falha de rede
  });

  it("⚠️ cadeia sem cobertura diz o que é, em vez de 'pool não lido'", async () => {
    const c = await lerCandidato("solana", "0xPOOL", "0xTOKEN", "X / Y");
    expect(c.pool).toBe(null);
    expect(c.porqueNaoLeu).toContain("não é coberta pela GoPlus");
  });

  it("⚠️⚠️ as quatro causas de 'não lido' deixam de ser a MESMA frase", async () => {
    const cadeia = await lerCandidato("solana", "0xA", "0xB", "n");
    const montagem = await lerCandidato("base", "0xA", "0xa", "n");
    expect(cadeia.porqueNaoLeu).not.toBe(montagem.porqueNaoLeu);
    // Com 100% das recusas iguais, ninguém via que NENHUMA era julgamento.
    for (const c of [cadeia, montagem]) expect(c.porqueNaoLeu!.length).toBeGreaterThan(20);
  });
});

/**
 * ⚠️ A TRAVA GERAL, e ela é o que sobra de lição.
 *
 * O relatório mostrava seis exames e seis recusas — a cara de um agente
 * trabalhando. Nenhum dos seis tinha chegado ao portão. "Examinou muito e
 * julgou zero" é indistinguível de "é rigoroso" até alguém somar as duas
 * colunas separadamente.
 */
describe("o relatório separa EXAMINADO de JULGADO", () => {
  const cron = readFileSync("src/app/api/celeiro/cron/route.ts", "utf8");

  it("⚠️ o tick publica quantos foram de fato julgados", () => {
    expect(cron).toMatch(/julgados/);
    expect(cron).toMatch(/naoLidos: examesPool\.length - julgados/);
  });

  it("⚠️ e cada exame carrega se chegou ao portão", () => {
    expect(cron).toMatch(/julgado: lido\.pool !== null/);
  });

  it("⚠️ a recusa por leitura diz a causa, não a frase genérica", () => {
    expect(cron).toMatch(/lido\.porqueNaoLeu \? \[lido\.porqueNaoLeu\] : portao\.recusas/);
  });
});
