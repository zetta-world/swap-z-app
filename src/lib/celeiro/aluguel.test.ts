import { describe, it, expect } from "vitest";
import {
  juroDoPeriodo, acumular, melhorTaxa, lerTaxaDeEmprestimo,
  MS_POR_ANO, TETO_POR_LANCAMENTO_MS, AGENTE,
} from "@/lib/celeiro/aluguel";

/**
 * O CONTROLE — os testes que protegem a RÉGUA.
 *
 * ⚠️ POR QUE ESTE ARQUIVO É MAIS SEVERO QUE OS OUTROS. Este agente é o piso
 * contra o qual todo o Celeiro é medido. Um erro aqui não erra um agente: erra
 * o julgamento de TODOS ao mesmo tempo, e na direção que ninguém percebe —
 * porque um piso inflado faz cada agente parecer ruim, e um piso deprimido faz
 * cada agente parecer bom.
 */

describe("o juro do período", () => {
  /**
   * ⚠️ O CASO QUE FIXA A UNIDADE. 1.000 USDT a 10%/ano por um ano = 100 USDT.
   * Se alguém trocar ano por dia, ou percentual por fração, este número muda de
   * ordem de grandeza. É a conta que `pnl-math.test.ts` não fez quando copiou a
   * constante que devia conferir.
   */
  it("um ano a 10% rende 10% do capital", () => {
    expect(juroDoPeriodo(1000, 10, MS_POR_ANO)).toBeCloseTo(100, 9);
  });

  /**
   * ⚠️ ESCALA LINEAR EM AMBOS OS EIXOS, com números que DISTINGUEM. Meio ano a
   * 10% = 50; um ano a 5% = 50 também — se o teste usasse só um deles, trocar
   * taxa por tempo passaria despercebido. Os dois juntos amarram a fórmula.
   */
  it("escala com o tempo e com a taxa, separadamente", () => {
    expect(juroDoPeriodo(1000, 10, MS_POR_ANO / 2)).toBeCloseTo(50, 9);
    expect(juroDoPeriodo(1000, 5, MS_POR_ANO)).toBeCloseTo(50, 9);
    expect(juroDoPeriodo(2000, 10, MS_POR_ANO / 4)).toBeCloseTo(50, 9);
  });

  /**
   * ⚠️ O CONTROLE NUNCA PERDE. Se ele pudesse ficar negativo deixaria de ser
   * piso, e o ranking passaria a medir contra um alvo móvel.
   */
  it("nunca devolve número negativo", () => {
    expect(juroDoPeriodo(-1000, 10, MS_POR_ANO)).toBe(0);
    expect(juroDoPeriodo(1000, -10, MS_POR_ANO)).toBe(0);
    expect(juroDoPeriodo(1000, 10, -1)).toBe(0);
    expect(juroDoPeriodo(Number.NaN, 10, MS_POR_ANO)).toBe(0);
    expect(juroDoPeriodo(1000, Number.POSITIVE_INFINITY, MS_POR_ANO)).toBe(0);
  });

  /** Juro SIMPLES: dois meios períodos somam exatamente um período inteiro. */
  it("é simples e não composto", () => {
    const meio = juroDoPeriodo(1000, 10, MS_POR_ANO / 2);
    expect(meio * 2).toBeCloseTo(juroDoPeriodo(1000, 10, MS_POR_ANO), 9);
  });
});

describe("o acúmulo entre ticks", () => {
  const AGORA = 1_800_000_000_000;

  /**
   * ⚠️⚠️ A INVARIANTE CENTRAL DESTE AGENTE. Rodar o cron duas vezes seguidas
   * não pode creditar duas vezes. O crédito é sempre `agora − ultimo`, nunca
   * "um tick de juro" — senão um cron nervoso dobra a régua de toda a arena.
   */
  it("rodar de novo no mesmo instante credita zero", () => {
    const uma = acumular(1000, 10, AGORA - 3_600_000, AGORA);
    expect(uma.usdt).toBeGreaterThan(0);

    const denovo = acumular(1000, 10, AGORA, AGORA);
    expect(denovo.usdt).toBe(0);
    expect(denovo.porque).toContain("nenhum tempo decorrido");
  });

  it("o primeiro tick só marca o relógio", () => {
    const a = acumular(1000, 10, null, AGORA);
    expect(a.usdt).toBe(0);
    expect(a.msCobertos).toBe(0);
    expect(a.porque).toContain("primeiro tick");
  });

  /**
   * ⚠️ O TETO É DETECTOR DE CRON MORTO. Vinte dias parados creditariam vinte
   * dias de juro a uma taxa que ninguém observou em dezenove deles. O gatilho
   * do volante da arena antiga ficou 20 dias morto sem ninguém notar — assumir
   * que não se repete seria ignorar a cicatriz.
   */
  it("cron parado credita só o teto, e diz que cortou", () => {
    const vinteDias = 20 * 24 * 3_600_000;
    const a = acumular(1000, 10, AGORA - vinteDias, AGORA);

    expect(a.cortadoPorTeto).toBe(true);
    expect(a.msCobertos).toBe(TETO_POR_LANCAMENTO_MS);
    expect(a.usdt).toBeCloseTo(juroDoPeriodo(1000, 10, TETO_POR_LANCAMENTO_MS), 9);
    expect(a.porque).toContain("teto aplicado");

    // E é MUITO menos que os 20 dias creditariam — o corte tem de importar.
    expect(a.usdt).toBeLessThan(juroDoPeriodo(1000, 10, vinteDias) / 50);
  });

  it("dentro do teto credita a janela inteira e não marca corte", () => {
    const a = acumular(1000, 10, AGORA - 3_600_000, AGORA);
    expect(a.cortadoPorTeto).toBe(false);
    expect(a.msCobertos).toBe(3_600_000);
    expect(a.porque).toContain("1.00h");
  });

  /**
   * ⚠️ SOMA DE PEDAÇOS = PEDAÇO INTEIRO. Se não fechasse, a frequência do cron
   * mudaria o rendimento do controle — e a régua passaria a depender de detalhe
   * de agendamento em vez de taxa de mercado.
   */
  it("a frequência do cron não altera o total", () => {
    const h = 3_600_000;
    const deUmaVez = acumular(1000, 10, AGORA - 4 * h, AGORA).usdt;
    let emPedacos = 0;
    for (let i = 4; i > 0; i--) emPedacos += acumular(1000, 10, AGORA - i * h, AGORA - (i - 1) * h).usdt;
    expect(emPedacos).toBeCloseTo(deUmaVez, 9);
  });
});

describe("a leitura da taxa na Gate.io", () => {
  /**
   * ⚠️ A CONVERSÃO DIÁRIA → ANUAL, FIXADA. A Gate.io publica `rate` AO DIA.
   * 0,0002/dia = 7,30%/ano. Deixar o número diário passar por anual encolheria
   * o piso em 365× e faria todo agente do Celeiro parecer excelente.
   */
  it("converte a taxa diária da Gate.io para anual", () => {
    const corpo = { rates: [{ rate: "0.0002" }] };
    expect(melhorTaxa(corpo)).toBeCloseTo(7.3, 9);
  });

  /**
   * ⚠️ PEGA A MENOR, NÃO A MAIOR. As pontas altas do livro são ofertas que
   * talvez ninguém tome. Piso honesto é piso conservador — inflá-lo faz todo
   * agente parecer pior do que é. Trocar `min` por `max` quebra aqui.
   */
  it("usa a menor taxa do livro, não a mais alta", () => {
    const corpo = { rates: [{ rate: "0.0009" }, { rate: "0.0002" }, { rate: "0.0005" }] };
    expect(melhorTaxa(corpo)).toBeCloseTo(7.3, 9);
  });

  it("aceita o corpo como lista solta", () => {
    expect(melhorTaxa([{ rate: "0.0002" }])).toBeCloseTo(7.3, 9);
  });

  /**
   * ⚠️ LEITURA RUIM DEVOLVE null, NUNCA UM PADRÃO. Um número inventado quando a
   * rede cai viraria juro que ninguém observou — e como este agente é a régua,
   * o erro contaminaria o julgamento de todos os outros.
   */
  it("corpo inútil devolve null em vez de um padrão", () => {
    expect(melhorTaxa(null)).toBeNull();
    expect(melhorTaxa({})).toBeNull();
    expect(melhorTaxa({ rates: [] })).toBeNull();
    expect(melhorTaxa({ rates: [{ rate: "0" }] })).toBeNull();
    expect(melhorTaxa({ rates: [{ rate: "abacaxi" }] })).toBeNull();
  });

  it("rede caída devolve null e não lança", async () => {
    const quebrado = async () => { throw new Error("timeout"); };
    await expect(lerTaxaDeEmprestimo(quebrado)).resolves.toBeNull();
  });

  it("leitura boa carrega a fonte para o extrato poder ser auditado", async () => {
    const ok = async () => ({ rates: [{ rate: "0.0002" }] });
    const t = await lerTaxaDeEmprestimo(ok, 123);
    expect(t?.taxaAnualPct).toBeCloseTo(7.3, 9);
    expect(t?.fonte).toContain("api.gateio.ws");
    expect(t?.lidoEmMs).toBe(123);
  });
});

describe("a identidade do agente", () => {
  /** O id vem do registro, não de uma string digitada aqui. */
  it("é o controle do registro", () => {
    expect(AGENTE).toBe("aluguel_ocioso");
  });
});
