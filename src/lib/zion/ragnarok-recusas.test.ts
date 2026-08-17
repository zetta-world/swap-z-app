import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { agruparRecusas } from "@/lib/zion/ragnarok";

/**
 * ⚠️⚠️ A CICATRIZ (16/08) — eu inventei uma causa porque o tick não deixava
 * rastro.
 *
 * A VÖLUNDR e a SKAÐI ficaram 15 horas sem emitir sinal. Fui ao ledger e não
 * havia NADA delas: nem "operei", nem "recusei", nem por quê. O `strat_ai_tick`
 * gravava `offered: 0`, e eu li aquele zero como *"as mesas de CEX pararam de
 * ver preço"* — afirmei isso ao dono, com tabela e tudo.
 *
 * Estava errado. O `market_data_cego` que subi no mesmo dia provou, no primeiro
 * tick com o código novo, que TODO símbolo tinha preço. A biblioteca estava
 * recusando, não cegando.
 *
 * ⚠️ E O `standAside` JÁ EXISTIA — calculado, com símbolo e motivo, devolvido a
 * um cron que descarta o retorno. Trabalho feito, resposta pronta, e nenhum
 * lugar onde ela pudesse ser lida depois.
 */
describe("agruparRecusas — o motivo tem de sobreviver ao tick", () => {
  it("conta por motivo, não por linha", () => {
    // 14 símbolos recusados pela MESMA regra é um diagnóstico; 14 linhas
    // repetidas é ruído que ninguém lê até o fim.
    const r = agruparRecusas([
      { symbol: "BTC", reason: "faca caindo" },
      { symbol: "ETH", reason: "faca caindo" },
      { symbol: "SOL", reason: "o bracket não paga o risco" },
    ]);
    expect(r).toEqual({ "faca caindo": 2, "o bracket não paga o risco": 1 });
  });

  /**
   * ⚠️ O TOTAL TEM DE FECHAR COM O QUE FOI RECUSADO. Se a soma das contagens
   * não bate com o tamanho da lista, o evento mente sobre a cobertura — e um
   * relatório de recusa que perde recusa é pior que nenhum, porque parece
   * completo.
   */
  it("a soma fecha com o número de símbolos recusados", () => {
    const lista = ["a", "b", "c", "d", "e"].map((s, i) => ({
      symbol: s, reason: i % 2 === 0 ? "sem volume" : "sem estrutura",
    }));
    const total = Object.values(agruparRecusas(lista)).reduce((x, y) => x + y, 0);
    expect(total).toBe(lista.length);
  });

  it("motivo vazio vira rótulo explícito, não chave vazia", () => {
    // Contagem sob chave "" some na leitura do JSON e o total deixa de fechar.
    const r = agruparRecusas([
      { symbol: "BTC", reason: "" },
      { symbol: "ETH", reason: "   " },
    ]);
    expect(r).toEqual({ "(sem motivo declarado)": 2 });
    expect(Object.keys(r)).not.toContain("");
  });

  it("lista vazia devolve objeto vazio — mesa que operou tudo não inventa recusa", () => {
    expect(agruparRecusas([])).toEqual({});
  });
});

describe("o tick mecânico GRAVA — não basta calcular", () => {
  const FONTE = readFileSync("src/lib/zion/ragnarok.ts", "utf8");

  /**
   * ⚠️ O DEFEITO ERA A AUSÊNCIA DE UMA CHAMADA, e teste de unidade não pega
   * chamada que não existe. `runStrategistScan` é async e toca o banco; o que
   * dá para afirmar sem subir infraestrutura é que o evento é EMITIDO.
   */
  it("runStrategistScan emite `strat_mech_tick`", () => {
    expect(FONTE).toContain('recordEvent("strat_mech_tick"');
  });

  it("o evento carrega os motivos E uma amostra com símbolo", () => {
    // Só o agregado esconde QUAL símbolo; só os exemplos escondem a escala.
    expect(FONTE).toContain("recusas: agruparRecusas(standAside)");
    expect(FONTE).toContain("exemplos: standAside.slice(0, 5)");
  });

  /**
   * ⚠️ A MESA AO LADO JÁ FAZIA CERTO desde sempre. Este teste existe para que
   * a assimetria não volte: se um dia o DEX perder o `skipped`, ou o mecânico
   * perder as `recusas`, a diferença aparece aqui em vez de aparecer daqui a
   * quinze horas, num diagnóstico errado meu.
   */
  it("o caminho DEX continua gravando o motivo dele — a lição não pode desviajar", () => {
    const dex = readFileSync("src/lib/zion/ragnarok-dex.ts", "utf8");
    expect(dex).toContain("skipped");
  });
});
