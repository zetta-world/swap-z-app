import { describe, it, expect } from "vitest";
import {
  colher, portao, anualizar, converterSerie, lerSerieDeFunding,
  CUSTO_DO_CICLO_PCT, PERNAS_DO_CICLO, PERIODOS_POR_DIA,
  MINIMO_DE_PERIODOS, TETO_SEQUENCIA_NEGATIVA, type PeriodoDeFunding,
} from "@/lib/celeiro/funding-colheita";
import { taxaPorPerna } from "@/lib/celeiro/taxas";

/** Série de N períodos com a mesma taxa. */
function serie(n: number, taxaPct: number): PeriodoDeFunding[] {
  return Array.from({ length: n }, (_, i) => ({ taxaPct, emMs: i * 8 * 3_600_000 }));
}

describe("a colheita", () => {
  /**
   * ⚠️ QUATRO PERNAS, NÃO DUAS. Spot entra, spot sai, perp entra, perp sai.
   * Contar duas foi o que fez a arbitragem parecer viável por semanas — o ciclo
   * completo custa o DOBRO do que a conta ingênua diz.
   */
  /**
   * ⚠️⚠️ ESTE TESTE FIXAVA 0,45 — o valor de `4 × 0,1125` — e quebrou quando a
   * taxa ganhou praça (23/08). Ele estava testando a CONSTANTE, não a regra:
   * qualquer mudança de tabela o derrubava sem nenhum defeito existir.
   *
   * Agora ele afirma o que realmente importa e não muda com a tabela: são
   * QUATRO pernas, e elas se dividem entre DUAS praças com preços diferentes.
   */
  it("o ciclo custa quatro pernas, duas de cada praça", () => {
    expect(PERNAS_DO_CICLO).toBe(4);
    expect(CUSTO_DO_CICLO_PCT).toBeCloseTo(
      2 * taxaPorPerna("spot_gate", "maker") + 2 * taxaPorPerna("futuros_gate", "maker"), 9);

    /** ⚠️ E segue custando MAIS que a conta ingênua de duas pernas. */
    expect(CUSTO_DO_CICLO_PCT).toBeGreaterThan(2 * taxaPorPerna("spot_gate", "maker"));
  });

  /**
   * ⚠️ SOMA, NÃO COMPOSIÇÃO. Compor assumiria reinvestir o funding a cada 8h,
   * o que exige aumentar as DUAS pernas e pagar corretagem de novo. Com 100
   * períodos de 0,01%, a soma dá 1,00% e a composição daria 1,005% — o teste
   * usa precisão suficiente para separar os dois.
   */
  it("soma os períodos em vez de compor", () => {
    const c = colher(serie(100, 0.01));
    expect(c.brutoPct).toBeCloseTo(1.0, 9);
    expect(c.liquidoPct).toBeCloseTo(1.0 - CUSTO_DO_CICLO_PCT, 9);
  });

  /**
   * ⚠️ O NÚMERO QUE VALIDA A TESE INTEIRA. Funding de 0,01% por período, 3
   * períodos ao dia = 0,03%/dia. Custo de 0,45% ÷ 0,03 = **15 dias**. Com a
   * taxa mais fraca de 0,0036%/período o equilíbrio vai para os ~42 dias
   * medidos em 04/08. Se alguém trocar `PERIODOS_POR_DIA` de 3 para 1, este
   * número triplica e o teste quebra.
   */
  it("calcula o ponto de equilíbrio em dias", () => {
    /** ⚠️ Derivado do custo, não fixado: é o custo dividido pelo que entra por dia. */
    const equilibrio = (taxaPct: number) => CUSTO_DO_CICLO_PCT / (taxaPct * PERIODOS_POR_DIA);
    expect(colher(serie(90, 0.01)).equilibrioEmDias).toBeCloseTo(equilibrio(0.01), 6);
    expect(colher(serie(90, 0.0036)).equilibrioEmDias).toBeCloseTo(equilibrio(0.0036), 6);
    expect(PERIODOS_POR_DIA).toBe(3);

    /** ⚠️ E o sentido continua travado: funding menor demora MAIS para pagar. */
    expect(equilibrio(0.0036)).toBeGreaterThan(equilibrio(0.01));
  });

  /**
   * ⚠️ FUNDING NÃO POSITIVO DEVOLVE `null`, NÃO UM NÚMERO ENORME. "Paga em
   * 40.000 dias" a tela arredonda e alguém lê como "paga". Não pagar NUNCA é
   * uma resposta diferente de pagar devagar.
   */
  it("funding médio não positivo não tem equilíbrio", () => {
    expect(colher(serie(90, -0.01)).equilibrioEmDias).toBeNull();
    expect(colher(serie(90, 0)).equilibrioEmDias).toBeNull();
    expect(colher([]).equilibrioEmDias).toBeNull();
  });

  /** Série vazia já nasce devendo o ciclo — não é neutra. */
  it("série vazia devolve o custo do ciclo como prejuízo", () => {
    expect(colher([]).liquidoPct).toBeCloseTo(-CUSTO_DO_CICLO_PCT, 9);
  });

  /**
   * ⚠️ A PIOR SEQUÊNCIA, NÃO A CONTAGEM. Dez negativos espalhados são ruído;
   * dez SEGUIDOS são a posição sangrando por três dias antes de virar. A série
   * abaixo tem 6 negativos no total mas nunca mais de 2 em fila — se alguém
   * trocar a sequência pela contagem, o número vira 6 e o teste quebra.
   */
  it("mede a pior sequência negativa, não quantos negativos existem", () => {
    const mista: PeriodoDeFunding[] = [
      0.01, -0.01, -0.01, 0.02, -0.01, 0.03, -0.01, -0.01, 0.01, -0.01,
    ].map((taxaPct, i) => ({ taxaPct, emMs: i }));
    const c = colher(mista);
    expect(c.piorSequenciaNegativa).toBe(2);
    expect(c.fatiaNegativa).toBeCloseTo(6 / 10, 9);
  });
});

describe("a anualização", () => {
  /**
   * ⚠️ POR QUE O `liquidoPct` CRU NÃO COMPARA. Ele confronta funding acumulado
   * NA JANELA com um custo pago UMA VEZ — numa janela de 30 dias o custo fixo
   * esmaga um funding que ainda nem somou. Foi assim que "mediana líquida
   * −0,22%" foi lida como "funding não paga", quando dizia "trinta dias não
   * pagam a entrada".
   *
   * Aqui: 0,03%/dia × 30 dias = 0,90% bruto. Cru dá +0,45%. Anualizado dá
   * 10,95% − 0,45% = 10,50%/ano. Os dois números descrevem a mesma série.
   */
  it("independe da janela, e o líquido cru não", () => {
    const c = colher(serie(90, 0.01));
    expect(c.brutoPct).toBeCloseTo(0.9, 9);
    /** ⚠️ O líquido é o bruto MENOS o ciclo — a relação, não o número. */
    expect(c.liquidoPct).toBeCloseTo(0.9 - CUSTO_DO_CICLO_PCT, 9);
    expect(anualizar(c, 30)).toBeCloseTo(0.9 * 365 / 30 - CUSTO_DO_CICLO_PCT, 6);
  });

  it("janela inválida devolve zero em vez de infinito", () => {
    expect(anualizar(colher(serie(90, 0.01)), 0)).toBe(0);
    expect(anualizar(colher([]), 30)).toBe(0);
  });
});

describe("o portão de entrada", () => {
  const JANELA = 30;

  /**
   * ⚠️⚠️ COMPARA COM O CONTROLE, NUNCA COM ZERO. Funding positivo não basta:
   * render menos que o Aluguel de Ocioso significa montar duas pernas e correr
   * risco de liquidação para ganhar menos do que emprestar o USDT parado.
   *
   * A série abaixo rende 10,50%/ano — positiva, e o portão ainda assim FECHA
   * contra um controle de 12%. Se alguém trocar a comparação por `> 0`, este
   * caso passa e o teste quebra.
   */
  it("fecha quando o funding rende menos que o controle, mesmo sendo positivo", () => {
    const c = colher(serie(90, 0.01));
    expect(anualizar(c, JANELA)).toBeCloseTo(0.9 * 365 / JANELA - CUSTO_DO_CICLO_PCT, 6);

    const contraControleAlto = portao(c, 12, JANELA);
    expect(contraControleAlto.entra).toBe(false);
    expect(contraControleAlto.porque).toContain("Aluguel de Ocioso");

    const contraControleBaixo = portao(c, 6, JANELA);
    expect(contraControleBaixo.entra).toBe(true);
  });

  /**
   * ⚠️ AMOSTRA CURTA REPROVA MESMO COM TAXA ÓTIMA. 89 períodos de funding
   * gordo seriam aprovados por qualquer regra que olhasse só o retorno — e
   * seriam o "+7,04% com amostra pequena" outra vez, de roupa nova.
   */
  it("série curta reprova por amostra, não por retorno", () => {
    const gorda = colher(serie(MINIMO_DE_PERIODOS - 1, 0.05));
    expect(anualizar(gorda, JANELA)).toBeGreaterThan(50);
    const p = portao(gorda, 6, JANELA);
    expect(p.entra).toBe(false);
    expect(p.porque).toContain("períodos");
  });

  /**
   * ⚠️ SEQUÊNCIA NEGATIVA LONGA REPROVA MESMO COM MÉDIA BOA. A média esconde a
   * dor: dias seguidos pagando funding podem estourar a margem antes de a média
   * se realizar. Aqui a série tem média claramente positiva e ainda assim fecha.
   */
  it("sangria longa reprova mesmo com média positiva", () => {
    const longa: PeriodoDeFunding[] = [];
    for (let i = 0; i < MINIMO_DE_PERIODOS; i++) {
      // Um bloco de negativos maior que o teto, no meio de uma série boa.
      const dentroDoBloco = i >= 20 && i < 20 + TETO_SEQUENCIA_NEGATIVA + 1;
      longa.push({ taxaPct: dentroDoBloco ? -0.01 : 0.05, emMs: i });
    }
    const c = colher(longa);
    expect(c.piorSequenciaNegativa).toBe(TETO_SEQUENCIA_NEGATIVA + 1);
    expect(anualizar(c, JANELA)).toBeGreaterThan(0);

    const p = portao(c, 6, JANELA);
    expect(p.entra).toBe(false);
    expect(p.porque).toContain("seguidos");
  });

  it("funding que nunca se paga reprova", () => {
    const p = portao(colher(serie(MINIMO_DE_PERIODOS, -0.01)), 6, JANELA);
    expect(p.entra).toBe(false);
    expect(p.porque).toContain("nunca se paga");
  });
});

describe("a leitura na Gate.io", () => {
  /**
   * ⚠️ A CONVERSÃO DE UNIDADE, FIXADA. A Gate.io devolve `r` como FRAÇÃO
   * (0.0001 = 0,01%) e `t` em SEGUNDOS. Deixar a fração passar por percentual
   * dividiria a receita por 100 e o portão fecharia em tudo, para sempre.
   */
  it("converte fração para percentual e segundos para ms", () => {
    const s = converterSerie([{ r: "0.0001", t: 1_700_000_000 }]);
    expect(s?.[0].taxaPct).toBeCloseTo(0.01, 9);
    expect(s?.[0].emMs).toBe(1_700_000_000_000);
  });

  /**
   * ⚠️ FALHA DEVOLVE `null`, NUNCA LISTA VAZIA. Lista vazia passaria por "série
   * sem funding" e o portão a leria como DADO em vez de ausência —
   * `inconclusivo ≠ aprovado`, aplicado à leitura.
   */
  it("corpo inútil devolve null, não lista vazia", () => {
    expect(converterSerie(null)).toBeNull();
    expect(converterSerie({})).toBeNull();
    expect(converterSerie([])).toBeNull();
    expect(converterSerie([{ r: "abacaxi", t: 1 }])).toBeNull();
  });

  it("rede caída devolve null e não lança", async () => {
    const quebrado = async () => { throw new Error("timeout"); };
    await expect(lerSerieDeFunding("BTC", 10, quebrado)).resolves.toBeNull();
  });

  it("pede o contrato certo à Gate.io", async () => {
    let pedido = "";
    await lerSerieDeFunding("btc", 50, async (u) => { pedido = u; return [{ r: "0.0001", t: 1 }]; });
    expect(pedido).toContain("contract=BTC_USDT");
    expect(pedido).toContain("limit=50");
  });
});
