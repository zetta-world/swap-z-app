import { describe, it, expect } from "vitest";
import { basePct, decidir, MARGEM_EXIGIDA_PP } from "@/lib/celeiro/base-convergencia";
import {
  medirLateralidade, deveCotar, MULTIPLO_DO_ACASO,
  AMPLITUDE_MINIMA_PCT, AMPLITUDE_MAXIMA_PCT, type Fatia,
} from "@/lib/celeiro/faixa-maker";
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

describe("Maker de Faixa", () => {
  /** Série que oscila em torno de 100 — volta à média com frequência. */
  function oscilando(n: number, amplitude: number): Fatia[] {
    return Array.from({ length: n }, (_, i) => ({
      fechamento: 100 + (i % 2 === 0 ? amplitude : -amplitude),
    }));
  }
  /** Série que só sobe — nunca volta. */
  function subindo(n: number, passo: number): Fatia[] {
    return Array.from({ length: n }, (_, i) => ({ fechamento: 100 + i * passo }));
  }

  /**
   * ⚠️ AS DUAS SÉRIES ANDAM O MESMO TANTO E SÃO OPOSTAS. `oscilando(60,1)`
   * percorre 118 de caminho e termina a 2 de onde começou (eficiência 0,017);
   * `subindo(60, 0.05)` percorre 2,95 e chega a 2,95 (eficiência 1,000). Uma
   * medida de dispersão daria números parecidos para as duas — é por isso que
   * as duas estão aqui, e é por isso que a métrica anterior (contar passos que
   * voltam à média) foi trocada: ela dava ~50% para ambas.
   */
  it("separa faixa de tendência, que a variância não separaria", () => {
    const faixa = medirLateralidade(oscilando(60, 1))!;
    const tendencia = medirLateralidade(subindo(60, 0.05))!;

    expect(faixa.razaoDeEficiencia).toBeCloseTo(2 / 118, 6);
    expect(tendencia.razaoDeEficiencia).toBeCloseTo(1, 9);

    expect(deveCotar(faixa).cota).toBe(true);
    expect(deveCotar(tendencia).cota).toBe(false);
    expect(deveCotar(tendencia).porque).toContain("é tendência");
  });

  /**
   * ⚠️⚠️ O LIMIAR É MÚLTIPLO DO ACASO, NÃO VALOR ABSOLUTO. Num passeio
   * aleatório de n passos a eficiência já vem em ~1/√n sem tendência nenhuma —
   * com 60 fatias, ~0,130. Um teto fixo de 0,30 aprovaria metade dos passeios
   * aleatórios do mercado achando que achou faixa.
   *
   * Saber o número do acaso ANTES de escolher o limiar é exatamente o que
   * faltou na arena antiga: seis modelos ficaram abaixo do acaso por dois meses
   * porque ninguém tinha calculado qual era.
   */
  it("o acaso é calculado e o teto se mede contra ele", () => {
    const l = medirLateralidade(oscilando(60, 1))!;
    expect(l.acasoEsperado).toBeCloseTo(1 / Math.sqrt(59), 9);
    expect(l.acasoEsperado).toBeGreaterThan(0.12);

    // Apertar o múltiplo abaixo da eficiência medida faz a MESMA série reprovar.
    const apertado = deveCotar(l, l.razaoDeEficiencia / l.acasoEsperado * 0.5);
    expect(apertado.cota).toBe(false);
    expect(deveCotar(l, MULTIPLO_DO_ACASO).cota).toBe(true);
  });

  /**
   * ⚠️ O TETO DE AMPLITUDE É TÃO IMPORTANTE QUANTO O DE EFICIÊNCIA. Um par que
   * oscila 50% tem eficiência baixíssima — passa folgado no primeiro portão — e
   * mataria o agente: cotar os dois lados disso é vender opção de graça. Só o
   * portão de eficiência deixaria passar exatamente o pior caso.
   */
  it("amplitude enorme reprova, mesmo com eficiência ótima", () => {
    const selvagem = medirLateralidade(oscilando(60, 25))!;
    expect(selvagem.razaoDeEficiencia).toBeLessThan(selvagem.acasoEsperado);
    expect(selvagem.amplitudePct).toBeGreaterThan(AMPLITUDE_MAXIMA_PCT);

    const v = deveCotar(selvagem);
    expect(v.cota).toBe(false);
    expect(v.porque).toContain("vender opção de graça");
  });

  it("faixa estreita demais não paga a corretagem", () => {
    const estreita = medirLateralidade(oscilando(60, 0.1))!;
    expect(estreita.amplitudePct).toBeLessThan(AMPLITUDE_MINIMA_PCT);
    expect(deveCotar(estreita).cota).toBe(false);
    expect(deveCotar(estreita).porque).toContain("estreita demais");
  });

  it("série curta é ausência de medição, não faixa", () => {
    expect(medirLateralidade(oscilando(10, 1))).toBeNull();
    expect(deveCotar(null).cota).toBe(false);
    expect(deveCotar(null).porque).toContain("não medido não é aprovado");
  });
});

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
