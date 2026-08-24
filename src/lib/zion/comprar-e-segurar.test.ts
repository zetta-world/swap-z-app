import { describe, it, expect } from "vitest";
import {
  retornoDeSegurar, confrontar, converterPontas, lerPontas,
  MARE_MINIMA_PCT, type PontaDePreco,
} from "@/lib/zion/comprar-e-segurar";

/**
 * A RÉGUA QUE FALTAVA — e o número que a exigiu.
 *
 * ⚠️ Nos sete dias até 20/08 as carteiras fecharam no positivo: SKAÐI +$14,92,
 * radar +$14,00, GERI +$13,98, VÖLUNDR +$9,96, com 29, 14, 18 e 17 posições
 * fechadas. Dinheiro de verdade, não anedota.
 *
 * No MESMO período BTC fez +15,03%, ETH +23,34%, SOL +14,92%. Os mesmos $1.000
 * parados em BTC dariam +$150 — dez vezes a melhor mesa. O painel não tinha como
 * mostrar isso, e sem isso "estamos lucrando" e "estamos lucrando mais do que
 * parados" pareciam a mesma frase.
 */

describe("o retorno de segurar", () => {
  /**
   * ⚠️ PESO IGUAL, e o teste usa símbolos com retornos MUITO diferentes de
   * propósito: +15,03 e +23,34 têm média 19,185. Se alguém trocar por soma, por
   * ponderação ou pelo primeiro símbolo, o número muda e o caso quebra.
   */
  it("é a média simples dos símbolos, em partes iguais", () => {
    const r = retornoDeSegurar([
      { simbolo: "BTC", inicio: 63486.5, fim: 73028.2 },
      { simbolo: "ETH", inicio: 1886.56, fim: 2326.79 },
    ]);
    expect(r.retornoPct).toBeCloseTo((15.0295 + 23.3345) / 2, 2);
    expect(r.usados).toEqual(["BTC", "ETH"]);
    expect(r.ignorados).toEqual([]);
  });

  /**
   * ⚠️⚠️ SÍMBOLO SEM PREÇO SAI DA CONTA, NÃO ENTRA COMO ZERO. Tratá-lo como 0%
   * puxaria a referência para BAIXO e faria a mesa parecer melhor — um erro de
   * leitura viraria elogio, que é o pior modo de falha possível numa régua.
   *
   * Aqui: com o SOL quebrado, a referência é a média de BTC e ETH (19,18). Se
   * o SOL entrasse como zero, cairia para 12,79 — e a diferença é enorme.
   */
  it("preço ilegível é excluído e aparece, em vez de virar zero", () => {
    const r = retornoDeSegurar([
      { simbolo: "BTC", inicio: 63486.5, fim: 73028.2 },
      { simbolo: "ETH", inicio: 1886.56, fim: 2326.79 },
      { simbolo: "SOL", inicio: 0, fim: 87.65 },
    ]);
    expect(r.usados).toEqual(["BTC", "ETH"]);
    expect(r.ignorados).toEqual(["SOL"]);
    expect(r.retornoPct).toBeCloseTo(19.182, 2);
    expect(r.retornoPct).not.toBeCloseTo(12.79, 1);   // o que zerar daria
    expect(r.porque).toContain("1 fora por falta de preço");
  });

  it("sem nenhum preço não inventa referência", () => {
    const r = retornoDeSegurar([{ simbolo: "X", inicio: 0, fim: 0 }]);
    expect(r.retornoPct).toBeNull();
    expect(r.porque).toContain("sem referência não há comparação");
    expect(retornoDeSegurar([]).retornoPct).toBeNull();
  });

  it("mercado em queda dá referência negativa", () => {
    const r = retornoDeSegurar([{ simbolo: "BTC", inicio: 100, fim: 80 }]);
    expect(r.retornoPct).toBeCloseTo(-20, 9);
  });
});

describe("o confronto", () => {
  const alta = retornoDeSegurar([
    { simbolo: "BTC", inicio: 63486.5, fim: 73028.2 },   // +15,03%
  ]);

  /**
   * ⚠️⚠️ O CASO REAL DE 20/08. A mesa fez +1,49% enquanto segurar dava +15,03%.
   * Ela LUCROU — e capturou 10% da maré. As duas frases são verdadeiras ao mesmo
   * tempo, e antes desta coluna o painel só sabia dizer a primeira.
   */
  it("mesa positiva pode estar bem abaixo de segurar", () => {
    const c = confrontar(1.49, alta);
    expect(c.mesaPct).toBe(1.49);
    expect(c.referenciaPct).toBeCloseTo(15.03, 1);
    expect(c.diferencaPp).toBeCloseTo(1.49 - 15.0295, 2);
    expect(c.fatiaDaMare).toBeCloseTo(0.099, 2);
    expect(c.veredito).toContain("capturou 10%");
  });

  it("mesa que bate segurar diz isso", () => {
    const c = confrontar(20, alta);
    expect(c.diferencaPp).toBeGreaterThan(0);
    expect(c.veredito).toContain("bateu segurar");
  });

  /**
   * ⚠️⚠️ MERCADO DE LADO NÃO PRODUZ `fatiaDaMare`. Dividir por um denominador
   * minúsculo daria "capturou 4.000% da maré", que se lê como façanha e
   * significa apenas que o mercado não andou. Uma janela em que a pergunta não
   * se aplica tem de DIZER isso, não devolver um número.
   */
  it("mercado parado recusa a conta de fatia", () => {
    const deLado = retornoDeSegurar([{ simbolo: "BTC", inicio: 100, fim: 100.05 }]);
    const c = confrontar(2, deLado);
    expect(c.referenciaPct).toBeCloseTo(0.05, 4);
    expect(c.fatiaDaMare).toBeNull();
    expect(c.veredito).toContain("de lado");
    // A diferença em pontos continua fazendo sentido e é entregue.
    expect(c.diferencaPp).toBeCloseTo(1.95, 4);
    expect(Math.abs(0.05)).toBeLessThan(MARE_MINIMA_PCT);
  });

  it("sem referência, o confronto não inventa veredito", () => {
    const c = confrontar(5, retornoDeSegurar([]));
    expect(c.referenciaPct).toBeNull();
    expect(c.diferencaPp).toBeNull();
    expect(c.veredito).toContain("sem referência");
  });
});

describe("a leitura das velas", () => {
  /**
   * ⚠️ O FECHAMENTO É O ÍNDICE 5 na vela da Gate.io. Pegar o 2 ou o 4
   * devolveria volume ou máxima com cara de preço, e a referência inteira
   * ficaria errada sem nenhum erro aparecer na tela.
   */
  it("pega o fechamento, não o volume nem a máxima", () => {
    const velas = [
      ["1700000000", "999", "111", "222", "333", "100.5"],
      ["1700086400", "888", "444", "555", "666", "120.6"],
    ];
    const p = converterPontas("BTC", velas);
    expect(p.inicio).toBeCloseTo(100.5, 9);
    expect(p.fim).toBeCloseTo(120.6, 9);
  });

  it("resposta curta ou ilegível devolve pontas zeradas", () => {
    expect(converterPontas("BTC", null)).toEqual({ simbolo: "BTC", inicio: 0, fim: 0 });
    expect(converterPontas("BTC", [["1", "2", "3", "4", "5", "6"]]))
      .toEqual({ simbolo: "BTC", inicio: 0, fim: 0 });
  });

  /**
   * ⚠️ REDE CAÍDA NÃO DERRUBA A REFERÊNCIA INTEIRA. O símbolo volta zerado,
   * `retornoDeSegurar` o joga em `ignorados`, e os outros seguem valendo.
   */
  it("rede caída zera só aquele símbolo", async () => {
    const quebrado = async () => { throw new Error("timeout"); };
    const p = await lerPontas("BTC", 7, quebrado);
    expect(p).toEqual({ simbolo: "BTC", inicio: 0, fim: 0 });

    const r = retornoDeSegurar([p, { simbolo: "ETH", inicio: 100, fim: 110 }]);
    expect(r.retornoPct).toBeCloseTo(10, 9);
    expect(r.ignorados).toEqual(["BTC"]);
  });

  it("pede o par e a janela certos", async () => {
    let pedido = "";
    await lerPontas("btc", 7, async (u) => { pedido = u; return []; });
    expect(pedido).toContain("currency_pair=BTC_USDT");
    expect(pedido).toContain("interval=1d");
    expect(pedido).toContain("limit=8");
  });
});
