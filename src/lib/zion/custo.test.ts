import { describe, it, expect } from "vitest";
import {
  CUSTO_POR_PERNA_PCT, CUSTO_IDA_E_VOLTA_PCT, PERNAS_POR_CICLO,
  custoDePernas, FRONTEIRA_CUSTO_ISO,
} from "@/lib/zion/custo";

/**
 * ⚠️ O DEFEITO QUE ESTE MÓDULO FECHA (16/08).
 *
 * `BACKTEST_COST_PCT ?? 0.2` era lido em catorze lugares com dois significados
 * incompatíveis: "o ciclo inteiro custa 0,2%" em `paper/engine.ts`, no torneio
 * e no `cull.ts`; "cada perna custa 0,2%, logo o ciclo custa 0,4%" em
 * `lab/tendencia.ts` e `zion/benchmarks.ts`.
 *
 * A Gate.io decidiu quem estava certo: 0,2% POR ORDEM, mediana de 10 pares.
 * Uma ida e volta são duas ordens. A primeira família cobrava METADE.
 *
 * ⚠️ E NENHUM TESTE FALHAVA, porque cada arquivo conferia a própria cópia da
 * constante contra si mesma. `pnl-math.test.ts` tinha `const COST = 0.2` na
 * mão e oito asserções verdes em cima da conta errada.
 */
describe("custo — o primitivo e o ciclo", () => {
  it("uma ida e volta são DUAS pernas, e é isso que estava implícito", () => {
    expect(PERNAS_POR_CICLO).toBe(2);
    expect(CUSTO_IDA_E_VOLTA_PCT).toBeCloseTo(CUSTO_POR_PERNA_PCT * 2, 10);
  });

  it("o primitivo é a taxa MEDIDA da Gate.io, por ordem", () => {
    // 0,2% é a mediana publicada em 10 pares (lab_custo_cex, 15/08) — não é
    // chute. Se este número mudar, foi decisão, e o teste força a decisão a ser
    // consciente em vez de acidental.
    expect(CUSTO_POR_PERNA_PCT).toBeCloseTo(0.2, 10);
    expect(CUSTO_IDA_E_VOLTA_PCT).toBeCloseTo(0.4, 10);
  });

  /**
   * ⚠️ A ASSERÇÃO QUE TERIA PEGO O DEFEITO NO DIA. As duas convenções são
   * DIFERENTES, e por um fator exato. Um sistema onde `ida e volta == perna`
   * está cobrando meia taxa em algum lugar.
   */
  it("as duas convenções não podem colapsar numa só", () => {
    expect(CUSTO_IDA_E_VOLTA_PCT).not.toBeCloseTo(CUSTO_POR_PERNA_PCT, 6);
    expect(CUSTO_IDA_E_VOLTA_PCT / CUSTO_POR_PERNA_PCT).toBeCloseTo(2, 10);
  });
});

describe("custoDePernas — para quem não é ida-e-volta simples", () => {
  it("escala linearmente com o número de negociações", () => {
    expect(custoDePernas(1)).toBeCloseTo(CUSTO_POR_PERNA_PCT, 10);
    expect(custoDePernas(2)).toBeCloseTo(CUSTO_IDA_E_VOLTA_PCT, 10);
    expect(custoDePernas(4)).toBeCloseTo(CUSTO_POR_PERNA_PCT * 4, 10);
  });

  /**
   * ⚠️ Custo negativo criaria LUCRO DO NADA, e uma medição sem custo é
   * visivelmente boa demais — alguém estranha. Uma com custo invertido parece
   * plausível e passa despercebida, que é o pior dos dois mundos.
   */
  it("entrada absurda devolve zero, nunca custo negativo", () => {
    expect(custoDePernas(0)).toBe(0);
    expect(custoDePernas(-3)).toBe(0);
    expect(custoDePernas(NaN)).toBe(0);
    expect(custoDePernas(Infinity)).toBe(0);
  });
});

describe("a fronteira no ledger", () => {
  /**
   * ⚠️ `paper_positions.pnl_pct` é gravado LÍQUIDO no fechamento. As posições
   * fechadas antes de 16/08 carregam 0,2% pelo ciclo; as de depois, 0,4%. Nada
   * no banco distingue as duas — mesma coluna, mesmo tipo.
   *
   * A data existe como constante para que uma média longa possa cortar aqui, e
   * para que não viva só num comentário que ninguém lê antes de somar.
   */
  it("a data é legível por máquina, não só por humano", () => {
    const t = Date.parse(FRONTEIRA_CUSTO_ISO);
    expect(Number.isFinite(t)).toBe(true);
    expect(new Date(t).toISOString()).toBe(FRONTEIRA_CUSTO_ISO);
  });
});
