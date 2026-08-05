/**
 * VENUES EM OBSERVAÇÃO — a parte que dá para testar sem rede.
 *
 * Ver o cabeçalho de `cex-spot-extra.ts`. O resumo: o dono tem conta em ~19
 * corretoras e quis somar todas; a Kucoin de ontem mostrou que venue nova é
 * hipótese, não upgrade, então elas entram só na MEDIÇÃO.
 *
 * ⚠️ Estes adaptadores foram escritos ÀS CEGAS — o proxy do sandbox bloqueia as
 * CEX, e nenhum formato de resposta foi exercitado daqui. O que dá para testar
 * é a parte pura: a extração da base do par. É exatamente onde eles vão errar,
 * porque cada corretora escolheu um separador diferente, e o erro é SILENCIOSO:
 * sufixo mal casado não estoura, só devolve zero cotações — indistinguível de
 * "a venue não tem esses pares".
 */

import { describe, it, expect } from "vitest";
import { baseDe, OBSERVED_VENUES, DECLINED_VENUES } from "@/lib/api/cex-spot-extra";

describe("extração da base do par", () => {
  it("underscore — Poloniex e P2B", () => {
    expect(baseDe("BTC_USDT", ["_USDT", "USDT"])).toBe("BTC");
    expect(baseDe("SOL_USDT", ["_USDT", "USDT"])).toBe("SOL");
  });

  it("colado e minúsculo — HTX", () => {
    expect(baseDe("BTCUSDT", ["USDT"])).toBe("BTC");
    expect(baseDe("ETHUSDT", ["USDT"])).toBe("ETH");
  });

  it("hífen — Blockchain.com", () => {
    expect(baseDe("BTC-USDT", ["-USDT", "USDT"])).toBe("BTC");
  });

  it("barra — LATOKEN e Bit2Me", () => {
    expect(baseDe("BTC/USDT", ["/USDT", "USDT"])).toBe("BTC");
  });

  /**
   * O CASO QUE MAIS FÁCIL PASSARIA DESPERCEBIDO: a Bitfinex cota UST, não
   * USDT, e prefixa os pares com "t". Sem os dois tratamentos, ela entraria com
   * zero cotações e eu concluiria que "a Bitfinex não tem os nossos pares".
   */
  it("Bitfinex usa UST e prefixo t — tratado no adaptador", () => {
    // O prefixo `t` é removido no adaptador; aqui chega já sem ele.
    expect(baseDe("BTCUST", ["USD", "UST"])).toBe("BTC");
    expect(baseDe("ETHUSD", ["USD", "UST"])).toBe("ETH");
    // E a ordem dos sufixos importa: "USD" é testado antes de "UST", e um par
    // terminado em UST não pode ser cortado pelo sufixo errado.
    expect(baseDe("SOLUST", ["USD", "UST"])).toBe("SOL");
  });

  it("par que não termina no sufixo devolve null, não uma base torta", () => {
    expect(baseDe("BTC_BRL", ["_USDT", "USDT"])).toBeNull();
    expect(baseDe("BTCEUR", ["USDT"])).toBeNull();
  });

  it("sufixo sozinho não vira base vazia", () => {
    // "USDT" inteiro não pode virar base "" — entraria como símbolo fantasma.
    expect(baseDe("USDT", ["USDT"])).toBeNull();
  });

  it("limpa separador residual quando o sufixo veio sem ele", () => {
    // Se o sufixo casado for "USDT" e o par for "BTC-USDT", sobra "BTC-".
    expect(baseDe("BTC-USDT", ["USDT"])).toBe("BTC");
    expect(baseDe("BTC_USDT", ["USDT"])).toBe("BTC");
  });

  it("é case-insensitive — HTX devolve tudo minúsculo", () => {
    expect(baseDe("btcusdt", ["USDT"])).toBe("BTC");
  });
});

/**
 * O REGISTRO DAS RECUSADAS TEM QUE EXISTIR E TER MOTIVO.
 *
 * "Não adicionei" sem motivo escrito vira, semanas depois, "esqueci" — e o dono
 * citou essas corretoras explicitamente. Cada recusa é uma afirmação que ele
 * pode contestar com dado, e por isso precisa estar dita.
 */
describe("registro das venues", () => {
  it("as observadas são exatamente as que têm adaptador", () => {
    expect(OBSERVED_VENUES).toContain("poloniex");
    expect(OBSERVED_VENUES).toContain("bitfinex");
    expect(OBSERVED_VENUES).toContain("htx");
    expect(OBSERVED_VENUES.length).toBeGreaterThanOrEqual(8);
  });

  it("toda venue recusada tem MOTIVO escrito, não só ausência", () => {
    const recusadas = Object.entries(DECLINED_VENUES);
    expect(recusadas.length).toBeGreaterThan(0);
    for (const [nome, motivo] of recusadas) {
      expect(motivo.length, `${nome} sem motivo`).toBeGreaterThan(20);
    }
  });

  it("as citadas pelo dono estão OU observadas OU recusadas com motivo — nenhuma some", () => {
    // A lista que ele mandou, normalizada. As que já estão na casa
    // (binance/gateio/kucoin/okx/kraken/coinbase) não precisam de entrada aqui.
    const citadas = ["stormgain", "mercatox", "bithumb_global", "cointiger", "toobit"];
    for (const v of citadas) {
      expect(DECLINED_VENUES[v], `${v} citada e sem destino`).toBeTruthy();
    }
    for (const v of ["poloniex", "bitfinex", "bitmex", "latoken", "p2b", "bit2me", "blockchain"]) {
      expect(OBSERVED_VENUES).toContain(v as (typeof OBSERVED_VENUES)[number]);
    }
  });
});
