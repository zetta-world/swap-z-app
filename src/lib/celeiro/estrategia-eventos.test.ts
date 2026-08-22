import { describe, it, expect } from "vitest";
import { basePct, decidir, MARGEM_EXIGIDA_PP } from "@/lib/celeiro/base-convergencia";
import {
  portaoDeSobrevivencia, municaoDoDia, LIQUIDEZ_MINIMA_USD, type Pool,
} from "@/lib/celeiro/pool-novo";
import { CUSTO_DO_CICLO_PCT } from "@/lib/celeiro/funding-colheita";

/**
 * OS TRÊS AGENTES DE ESTRUTURA E EVENTO.
 *
 * ⚠️ O fio comum: nenhum deles pergunta "para onde vai o preço". Convergência
 * pergunta se duas pontas do mesmo ativo discordam; Maker pergunta se a série
 * volta à média; Pool pergunta se dá para sair da posição. Todas são perguntas
 * sobre o PRESENTE, com resposta verificável.
 */

describe("Convergência de Base", () => {
  /**
   * ⚠️ A BASE É ASSINADA, E O SINAL É A OPERAÇÃO. Usar valor absoluto perderia
   * QUAL ponta comprar — e o agente abriria a perna errada metade das vezes, o
   * que é indistinguível de uma aposta direcional.
   */
  it("o sinal da base diz qual perna abrir", () => {
    expect(basePct({ perp: 101, spot: 100 })).toBeCloseTo(1, 9);
    expect(basePct({ perp: 99, spot: 100 })).toBeCloseTo(-1, 9);
    expect(decidir({ perp: 101, spot: 100 }).lado).toBe("vender_perp");
    expect(decidir({ perp: 99, spot: 100 }).lado).toBe("comprar_perp");
  });

  /**
   * ⚠️ NÃO BASTA PAGAR O CUSTO — TEM DE PAGAR COM FOLGA. Uma base exatamente
   * igual ao custo é resultado zero carregando risco de execução, de liquidação
   * e de a base ABRIR mais antes de fechar. Operar no empate é pagar risco para
   * não ganhar nada.
   *
   * Base de 0,45% empata com as 4 pernas e é RECUSADA; 0,70% deixa 0,25pp e
   * passa a margem de 0,15pp. Trocar a comparação por "sobra > 0" faz o
   * primeiro caso passar e quebra o teste.
   */
  it("recusa a base que só empata com o custo", () => {
    const empate = decidir({ perp: 100 + CUSTO_DO_CICLO_PCT, spot: 100 });
    expect(empate.abre).toBe(false);
    expect(empate.sobraPct).toBeCloseTo(0, 6);
    expect(empate.porque).toContain("pagar risco por nada");

    const folgada = decidir({ perp: 100.7, spot: 100 });
    expect(folgada.abre).toBe(true);
    expect(folgada.sobraPct).toBeCloseTo(0.7 - CUSTO_DO_CICLO_PCT, 6);
    expect(folgada.sobraPct!).toBeGreaterThanOrEqual(MARGEM_EXIGIDA_PP);
  });

  /** Base negativa grande também abre — o agente não tem lado preferido. */
  it("base negativa larga abre a perna oposta", () => {
    const d = decidir({ perp: 99.3, spot: 100 });
    expect(d.abre).toBe(true);
    expect(d.lado).toBe("comprar_perp");
  });

  /**
   * ⚠️ LEITURA FALTANDO REPROVA, e não vira "base zero". Base zero é uma
   * afirmação sobre o mercado; leitura falha é ausência de afirmação.
   */
  it("pontas não lidas reprovam em vez de virar base zero", () => {
    const d = decidir(null);
    expect(d.abre).toBe(false);
    expect(d.basePct).toBeNull();
    expect(d.porque).toContain("não medido não é aprovado");
    expect(decidir({ perp: 100, spot: 0 }).abre).toBe(false);
  });
});

/**
 * ⚠️ O "MAKER DE FAIXA" FOI REMOVIDO DAQUI EM 22/08, junto com o mecanismo.
 *
 * Ele rodou 29 posições em produção e ficou NEGATIVO acertando 65,5%: preço
 * +3,1557 contra taxa −3,3750. O trade médio ganhava $0,1088 e pagava $0,1125
 * de pedágio — perdia por CONSTRUÇÃO, com alvo de 0,6% contra ida-e-volta de
 * 0,225%.
 *
 * ⚠️ E O MECANISMO FOI APAGADO, não ajustado. Subir o alvo para 1,35%
 * consertaria a aritmética e destruiria a tese: uma faixa em que o preço
 * percorre 1,35% para cada lado não é faixa estreita. Manter o módulo de pé
 * seria deixar pronto um caminho que a medição já reprovou — a mesma razão que
 * apagou o `anthropicChat` órfão.
 *
 * A cicatriz vive em `docs/PLANO-CELEIRO-AMBICIOSO.md`, com o extrato que o
 * matou. Código morto não é documentação.
 */

describe("Pool Novo", () => {
  const bom: Pool = {
    liquidezUsd: 50_000, liquidezTravada: true,
    concentracaoTop10: 0.3, vendaTestePassou: true, idadeMinutos: 30,
  };

  it("pool que passa em tudo entra", () => {
    const p = portaoDeSobrevivencia(bom);
    expect(p.entra).toBe(true);
    expect(p.recusas).toEqual([]);
  });

  /**
   * ⚠️⚠️ NÃO CONSEGUIR TESTAR A VENDA REPROVA — é o caso MAIS perigoso, porque
   * é exatamente o que um honeypot produz. Tratar "não sei" como
   * "provavelmente ok" custa a aposta inteira.
   */
  it("venda de teste impossível reprova, e não passa por dúvida", () => {
    const p = portaoDeSobrevivencia({ ...bom, vendaTestePassou: null });
    expect(p.entra).toBe(false);
    expect(p.recusas.join(" ")).toContain("honeypot");
  });

  /**
   * ⚠️ DEVOLVE TODAS AS RECUSAS, NÃO A PRIMEIRA. A diferença entre "quase
   * passou" e "é lixo em todos os eixos" muda se vale afrouxar algum limiar
   * depois — diagnóstico truncado vira ajuste às cegas.
   */
  it("lista todas as recusas de uma vez", () => {
    const ruim: Pool = {
      liquidezUsd: 100, liquidezTravada: false,
      concentracaoTop10: 0.95, vendaTestePassou: false, idadeMinutos: 1,
    };
    const p = portaoDeSobrevivencia(ruim);
    expect(p.entra).toBe(false);
    expect(p.recusas.length).toBe(5);
  });

  it("um único critério falho já reprova", () => {
    const soLiquidez = portaoDeSobrevivencia({ ...bom, liquidezUsd: LIQUIDEZ_MINIMA_USD - 1 });
    expect(soLiquidez.entra).toBe(false);
    expect(soLiquidez.recusas.length).toBe(1);
  });

  /**
   * ⚠️ TAMANHO FIXO, NUNCA PROPORCIONAL À CONVICÇÃO. A única medida de convicção
   * que tínhamos — a confiança declarada pelo modelo — foi medida como
   * INVERTIDA em 3.749 decisões: diz 47% e acerta 33,3%; diz 76% e acerta 7,7%.
   * Apostar mais onde a convicção é maior teria concentrado capital no pior.
   */
  it("a munição é contada e o tamanho não varia", () => {
    expect(municaoDoDia(0, 5, 50)).toMatchObject({ restam: 5, tamanhoUsd: 50 });
    expect(municaoDoDia(3, 5, 50)).toMatchObject({ restam: 2, tamanhoUsd: 50 });

    const esgotada = municaoDoDia(5, 5, 50);
    expect(esgotada.restam).toBe(0);
    expect(esgotada.tamanhoUsd).toBe(50);
    expect(esgotada.porque).toContain("fôlego para chegar ao evento raro");
  });

  it("contagem negativa ou acima do teto não vira munição extra", () => {
    expect(municaoDoDia(-3, 5, 50).restam).toBe(5);
    expect(municaoDoDia(99, 5, 50).restam).toBe(0);
  });
});
