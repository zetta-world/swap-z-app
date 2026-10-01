/**
 * ⚠️⚠️ MULTI-PERNA NÃO É ATÔMICA — Cenários J e K do briefing, achados A103 e
 * a semântica de arbitragem.
 *
 *   Cenário J  trade externo na corretora → ACCOUNT_DRIFT / quarentena
 *   Cenário K  perna A executa, perna B falha → estado residual EXPLÍCITO,
 *              e nada pode declarar a operação "atomicamente concluída"
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  avaliarMultiPerna, compensacaoNecessaria, RESIDUO_TOLERADO_USD, TIMEOUT_DA_PERNA_MS,
  type PernaObservada,
} from "@/lib/cex/execucao/multi-perna";
import {
  detectarDeriva, conferirSaldo, TOLERANCIA_DE_SALDO_USD, type TradeObservado,
} from "@/lib/cex/execucao/deriva";

/**
 * ⚠️⚠️ `precoMedio` USA `=== undefined`, NÃO `??` — e isto quase custou dois
 * testes falsos.
 *
 * A primeira versão deste helper escrevia `precoMedio: o.precoMedio ?? 100`.
 * `??` trata `null` como ausência, então `precoMedio: null` — o caso "não
 * medido", que é justamente o que o teste queria exercitar — virava `100`
 * silenciosamente. Os dois testes sobre resíduo sem preço passavam medindo
 * outra coisa.
 *
 * É a mesma família de defeito que esta auditoria persegue, dentro do próprio
 * teste: ausência colapsada num default.
 */
const perna = (o: Partial<PernaObservada> & Pick<PernaObservada, "side" | "executado">): PernaObservada => ({
  id: o.id ?? "p", symbol: o.symbol ?? "BTC/USDT", base: o.base ?? "BTC",
  pedido: o.pedido ?? 1, emVoo: o.emVoo ?? false,
  precoMedio: o.precoMedio === undefined ? 100 : o.precoMedio,
  side: o.side, executado: o.executado,
});

describe("① Cenário K — perna A executa, perna B falha", () => {
  it("⚠️⚠️ o estado residual é EXPLÍCITO — e não é 'completo'", () => {
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 1, precoMedio: 100 }),
      perna({ side: "sell", executado: 0, precoMedio: null }),
    ]);
    expect(v.estado).toBe("SEM_HEDGE");
    expect(v.residual).toEqual([{ base: "BTC", quantidade: 1, usd: 100 }]);
  });

  it("⚠️⚠️ NADA declara a operação atomicamente concluída", () => {
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 1 }),
      perna({ side: "sell", executado: 0, precoMedio: null }),
    ]);
    expect(v.estado).not.toBe("COMPLETO");
    // ⚠️ E a palavra `atomic` não sobrou no vocabulário do módulo.
    const FONTE = readFileSync("src/lib/cex/execucao/multi-perna.ts", "utf8");
    const estados = FONTE.slice(FONTE.indexOf("export type EstadoMultiPerna"),
                                FONTE.indexOf("export interface PernaObservada"));
    expect(estados.toLowerCase()).not.toMatch(/\batomic|atomi[ck]a\b/);
  });

  it("⚠️ o gêmeo positivo: pernas que CASAM fecham como completo e neutro", () => {
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 1 }),
      perna({ side: "sell", executado: 1 }),
    ]);
    expect(v.estado).toBe("COMPLETO");
    expect(v.residual).toEqual([]);
  });

  it("⚠️ perna EM VOO impede qualquer conclusão", () => {
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 1 }),
      perna({ side: "sell", executado: 0, emVoo: true, precoMedio: null }),
    ]);
    expect(v.estado).toBe("PERNAS_EM_VOO");
  });

  it("⚠️⚠️ perna pendurada tempo demais vira QUARENTENA", () => {
    // Esperar para sempre por uma perna que não resolve é deixar uma exposição
    // sem dono — e sem alarme.
    const v = avaliarMultiPerna(
      [perna({ side: "buy", executado: 1 }), perna({ side: "sell", executado: 0, emVoo: true })],
      { idadeMs: TIMEOUT_DA_PERNA_MS + 1 });
    expect(v.estado).toBe("QUARENTENA");
  });

  it("⚠️⚠️ resíduo SEM PREÇO não cabe em tolerância nenhuma", () => {
    // "Não medido" não é "pequeno". O caminho de dinheiro falha fechado.
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 0.0001, precoMedio: null }),
    ]);
    expect(v.estado).toBe("COMPENSACAO_NECESSARIA");
  });

  it("resíduo pequeno e medido fica registrado, não compensado", () => {
    // Compensar centavos custa mais pedágio do que o risco que remove.
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 1, precoMedio: RESIDUO_TOLERADO_USD / 2 }),
    ]);
    expect(v.estado).toBe("HEDGE_PARCIAL");
  });

  it("⚠️⚠️ triangular: perna do meio falha, inventário preso é NOMEADO", () => {
    const v = avaliarMultiPerna([
      perna({ id: "l1", side: "buy", base: "BTC", executado: 1, precoMedio: 60000 }),
      perna({ id: "l2", side: "sell", base: "BTC", executado: 0, precoMedio: null }),
      perna({ id: "l3", side: "sell", base: "ETH", executado: 0, precoMedio: null }),
    ]);
    expect(v.estado).toBe("SEM_HEDGE");
    expect(v.residual.map((r) => r.base)).toEqual(["BTC"]);
  });
});

describe("② não existe rollback — existe COMPENSAÇÃO", () => {
  it("⚠️⚠️ o módulo não expõe nada chamado desfazer/rollback/reverter", () => {
    // Trade em corretora não desfaz. Um nome que promete isso faz quem lê
    // parar de procurar o resíduo.
    const FONTE = readFileSync("src/lib/cex/execucao/multi-perna.ts", "utf8");
    expect(FONTE).not.toMatch(/export function (desfazer|rollback|reverter)/);
    expect(FONTE).toMatch(/export function compensacaoNecessaria/);
  });

  it("comprado a mais é compensado VENDENDO a diferença", () => {
    const v = avaliarMultiPerna([perna({ side: "buy", executado: 2, precoMedio: 1000 })]);
    expect(compensacaoNecessaria(v)).toEqual([{ base: "BTC", side: "sell", quantidade: 2 }]);
  });

  it("vendido a mais é compensado COMPRANDO de volta", () => {
    const v = avaliarMultiPerna([perna({ side: "sell", executado: 2, precoMedio: 1000 })]);
    expect(compensacaoNecessaria(v)).toEqual([{ base: "BTC", side: "buy", quantidade: 2 }]);
  });

  it("⚠️ estado neutro não pede compensação nenhuma", () => {
    const v = avaliarMultiPerna([
      perna({ side: "buy", executado: 1 }), perna({ side: "sell", executado: 1 })]);
    expect(compensacaoNecessaria(v)).toEqual([]);
  });
});

describe("③ Cenário J — trade externo na corretora (A103)", () => {
  const t = (o: Partial<TradeObservado> & Pick<TradeObservado, "tradeId">): TradeObservado => ({
    // ⚠️ Mesmo cuidado: `null` aqui É o caso do teste, não ausência.
    orderId: o.orderId === undefined ? "ORD-X" : o.orderId,
    symbol: o.symbol ?? "BTC/USDT",
    qty: o.qty ?? 1, executedAtMs: o.executedAtMs ?? 2000, tradeId: o.tradeId,
  });

  it("⚠️⚠️ trade cuja ordem não é nossa: DERIVOU", () => {
    const v = detectarDeriva([t({ tradeId: "T-EXT", orderId: "ORD-DO-CLIENTE" })], {
      ordensConhecidas: new Set(["ORD-NOSSA"]),
      tradesNoLivro: new Set(), desdeMs: 1000,
    });
    expect(v.tipo).toBe("deriva");
    if (v.tipo === "deriva") expect(v.achado.motivo).toBe("trade_nao_atribuivel");
  });

  it("⚠️ o gêmeo positivo: trade da NOSSA ordem é ok", () => {
    const v = detectarDeriva([t({ tradeId: "T1", orderId: "ORD-NOSSA" })], {
      ordensConhecidas: new Set(["ORD-NOSSA"]),
      tradesNoLivro: new Set(), desdeMs: 1000,
    });
    expect(v.tipo).toBe("ok");
  });

  it("⚠️ trade ANTERIOR à janela é explicado — senão o alarme toca sempre", () => {
    const v = detectarDeriva([t({ tradeId: "T-VELHO", orderId: "X", executedAtMs: 500 })], {
      ordensConhecidas: new Set(), tradesNoLivro: new Set(), desdeMs: 1000,
    });
    expect(v.tipo).toBe("ok");
  });

  it("⚠️⚠️ trade SEM id de ordem não acusa NEM absolve: INDETERMINADO (A128)", () => {
    // Algumas venues não devolvem o id da ordem no histórico. Acusar por
    // ausência de campo é o alarme que ensina a ignorar alarme — mas o veredito
    // antigo ABSOLVIA (`derivou:false`), e um "sem drift" sobre um trade que
    // ninguém atribuiu é tão inventado quanto o alarme falso. O honesto é o
    // terceiro estado: indeterminado, com os trades não atribuídos nomeados.
    const v = detectarDeriva([t({ tradeId: "T-SEM", orderId: null })], {
      ordensConhecidas: new Set(), tradesNoLivro: new Set(), desdeMs: 1000,
    });
    expect(v.tipo).toBe("indeterminado");
    if (v.tipo === "indeterminado") {
      expect(v.naoAtribuidos.map((x) => x.tradeId)).toEqual(["T-SEM"]);
    }
  });

  it("trade já no nosso livro é explicado (orderId dispensado)", () => {
    const v = detectarDeriva([t({ tradeId: "T1", orderId: "DESCONHECIDA" })], {
      ordensConhecidas: new Set(), tradesNoLivro: new Set(["T1"]), desdeMs: 1000,
    });
    expect(v.tipo).toBe("ok");
  });
});

describe("④ o saldo que não fecha", () => {
  it("⚠️⚠️ diferença acima da tolerância DERIVA", () => {
    const v = conferirSaldo(10_000, 1_000);
    expect(v.derivou).toBe(true);
    if (v.derivou) expect(v.achado.motivo).toBe("saldo_divergente");
  });

  it("arredondamento e pedágio cabem na tolerância", () => {
    expect(conferirSaldo(1_000 + TOLERANCIA_DE_SALDO_USD - 0.01, 1_000).derivou).toBe(false);
  });

  it("⚠️⚠️ saldo NÃO MEDIDO não acusa nem absolve", () => {
    // Ausência de medida não pode virar veredito inventado nos dois sentidos.
    expect(conferirSaldo(null, 1_000).derivou).toBe(false);
    expect(conferirSaldo(1_000, null).derivou).toBe(false);
  });
});
