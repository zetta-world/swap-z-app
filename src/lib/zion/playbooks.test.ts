import { describe, it, expect } from "vitest";
import {
  PLAYBOOKS, PLAYBOOK_GAPS, playbooksFor, candidatePlans, candidateAttempts,
} from "@/lib/zion/playbooks";
import type { SymbolIndicators } from "@/lib/api/market-indicators";

/**
 * A BIBLIOTECA — de três estratégias para dez.
 *
 * O dono citou "stop range, pull back, suporte resistência E ETC" como
 * EXEMPLOS. Implementei a lista literal e parei no "etc" — e com três opções a
 * mesa de IA não estava sendo testada, estava sendo enfeitada: escolher entre
 * três mal chega a ser escolher.
 *
 * Estes testes guardam duas coisas. A primeira é que cada playbook novo
 * reconhece o SEU setup e recusa os dos outros. A segunda, mais importante: que
 * as travas de disciplina não foram afrouxadas para caber mais trade.
 */

/**
 * Fixture com ATR COERENTE.
 *
 * `atrPct` tem de ser `atr14 / price`, senão o piso de volatilidade é calculado
 * sobre um número que não existe e o teste passa (ou falha) por motivo errado.
 * Foi o que aconteceu na primeira versão desta suíte: seis playbooks pareciam
 * quebrados quando na verdade os fixtures descreviam ativos impossíveis.
 */
function ind(over: Partial<SymbolIndicators> = {}): SymbolIndicators {
  const price = over.price ?? 100;
  const atr14 = over.atr14 ?? 2;
  const coerente = { atrPct: price > 0 ? (atr14 / price) * 100 : null };
  return {
    symbol: "TEST", price: 100, rsi14: 50, ema20: 100, ema50: 100, macd: null,
    atr14: 2, atrPct: 2, adx: 15, regime: "RANGING",
    trend: "neutral", htf4h: null, htf1d: null, htf1w: null, alignment: "mixed",
    obv: null, obvTrend: null, confidenceScore: null,
    relVol: null, divergence: null, supports: [], resistances: [], pivotLevels: null,
    rsiTrajectory: [], yearHigh: null, yearLow: null, rangePct: null, distFromYearHighPct: null,
    ...coerente,
    ...over,
  };
}

const ids = (i: SymbolIndicators) => candidatePlans(i).map((p) => p.playbook);

describe("o registro", () => {
  it("dez playbooks ativos — o triplo do que existia", () => {
    expect(PLAYBOOKS).toHaveLength(10);
  });

  it("todo playbook declara tese E quando falha", () => {
    // A contra-indicação é metade do valor: uma estratégia sem "quando isso
    // perde dinheiro" é fé, não regra.
    for (const p of PLAYBOOKS) {
      expect(p.thesis.length, p.id).toBeGreaterThan(20);
      expect(p.failsWhen.length, p.id).toBeGreaterThan(20);
      expect(p.regimes.length, p.id).toBeGreaterThan(0);
    }
  });

  it("nenhum id repetido", () => {
    expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
  });

  it("a prioridade dentro de um regime é única — a escolha tem de ser determinística", () => {
    for (const r of ["RANGING", "TRENDING_UP", "TRENDING_DOWN", "TRANSITIONING"] as const) {
      const ps = playbooksFor(r).map((p) => p.priority);
      expect(new Set(ps).size, `empate de prioridade em ${r}`).toBe(ps.length);
    }
  });
});

describe("rompimento de canal — o volume é a trava inteira", () => {
  const base = { regime: "RANGING" as const, price: 119, supports: [100], resistances: [120], atr14: 2 };

  it("COMPRA o rompimento com volume acima da média", () => {
    expect(ids(ind({ ...base, relVol: 2.0 }))).toContain("range_breakout");
  });

  it("RECUSA sem volume — rompimento fraco é o setup que mais engana", () => {
    expect(ids(ind({ ...base, relVol: 1.0 }))).not.toContain("range_breakout");
  });

  it("RECUSA no meio do canal — ali é expectativa, não rompimento", () => {
    expect(ids(ind({ ...base, price: 110, relVol: 3.0 }))).not.toContain("range_breakout");
  });
});

describe("volta ao pivô — o clássico de day trade", () => {
  // Espaçamento realista: o pivô tem de estar longe o bastante do S2 para o
  // trade pagar um stop que fica FORA do ruído.
  const pivot = { pp: 108, r1: 114, r2: 120, s1: 98, s2: 94 };

  it("COMPRA abaixo do pivô e acima do S2", () => {
    expect(ids(ind({ price: 97, pivotLevels: pivot, atr14: 2, atrPct: 2 }))).toContain("pivot_reversion");
  });

  it("RECUSA acima do pivô — ali não é zona de compra", () => {
    expect(ids(ind({ price: 106, pivotLevels: pivot }))).not.toContain("pivot_reversion");
  });

  it("RECUSA abaixo do S2 — perdeu a estrutura do dia", () => {
    expect(ids(ind({ price: 92, pivotLevels: pivot }))).not.toContain("pivot_reversion");
  });
});

describe("bandeira — volume SECANDO, não crescendo", () => {
  const base = {
    regime: "TRENDING_UP" as const, price: 110, ema20: 105, ema50: 95,
    alignment: "aligned_bull" as const, atr14: 2, supports: [98],
  };

  it("COMPRA a consolidação com volume abaixo da média", () => {
    expect(ids(ind({ ...base, relVol: 0.6 }))).toContain("trend_continuation");
  });

  it("RECUSA com volume ALTO — consolidação com volume é distribuição", () => {
    // Comprar aqui é comprar de quem está saindo. O desenho é o mesmo; a
    // diferença é exatamente o volume.
    expect(ids(ind({ ...base, relVol: 1.8 }))).not.toContain("trend_continuation");
  });

  it("RECUSA sem os prazos maiores alinhados — sem eles não é perna", () => {
    expect(ids(ind({ ...base, relVol: 0.6, alignment: "conflict" }))).not.toContain("trend_continuation");
  });
});

describe("reteste do rompimento — teto virou chão", () => {
  const base = {
    regime: "TRENDING_UP" as const, price: 100.5, supports: [100], resistances: [115],
    atr14: 2, ema20: 90, obvTrend: "rising" as const,
  };

  it("COMPRA colado no nível reconquistado", () => {
    expect(ids(ind(base))).toContain("breakout_retest");
  });

  it("RECUSA longe do nível — aí não é reteste, é só uma alta qualquer", () => {
    expect(ids(ind({ ...base, price: 108 }))).not.toContain("breakout_retest");
  });

  it("RECUSA com fluxo SAINDO no reteste — é armadilha", () => {
    expect(ids(ind({ ...base, obvTrend: "falling" }))).not.toContain("breakout_retest");
  });
});

describe("reversão por divergência — a média tem de estar acima", () => {
  const base = {
    // A média precisa estar LONGE: mean-reversion de perto não paga o risco, e
    // o bracket recusa — de propósito.
    regime: "RANGING" as const, price: 100, ema20: 112, divergence: "bullish_rsi" as const,
    rsiTrajectory: [28, 31, 35, 39], supports: [96], atr14: 2,
  };

  it("COMPRA com divergência E RSI já virando", () => {
    expect(ids(ind(base))).toContain("divergence_reversal");
  });

  it("RECUSA com o RSI ainda caindo — divergência sem confirmação", () => {
    expect(ids(ind({ ...base, rsiTrajectory: [39, 35, 31, 28] }))).not.toContain("divergence_reversal");
  });

  it("RECUSA sem espaço até a média — não há para onde voltar", () => {
    expect(ids(ind({ ...base, ema20: 95 }))).not.toContain("divergence_reversal");
  });
});

describe("absorção — volume alto com o preço parado", () => {
  const base = {
    regime: "RANGING" as const, price: 100, relVol: 2.0, obvTrend: "rising" as const,
    atr14: 1.5, supports: [97], resistances: [110],
  };

  it("COMPRA quando o OBV sobe e o preço não anda", () => {
    expect(ids(ind(base))).toContain("absorption");
  });

  it("RECUSA com o preço andando — aí não está sendo absorvido, está subindo", () => {
    expect(ids(ind({ ...base, atr14: 6, atrPct: 6 }))).not.toContain("absorption");
  });

  it("RECUSA com fluxo saindo — o mesmo desenho aparece na DISTRIBUIÇÃO", () => {
    // É o risco central deste playbook: comprar de quem está saindo.
    expect(ids(ind({ ...base, obvTrend: "falling" }))).not.toContain("absorption");
  });
});

describe("acumulação no suporte", () => {
  const base = {
    regime: "RANGING" as const, price: 100.5, supports: [100], resistances: [112],
    obvTrend: "rising" as const, rsi14: 45, atr14: 2,
  };

  it("COMPRA colado no suporte com fluxo comprador", () => {
    expect(ids(ind(base))).toContain("support_accumulation");
  });

  it("RECUSA com o RSI já esticado — acumulação é antes do movimento", () => {
    expect(ids(ind({ ...base, rsi14: 72 }))).not.toContain("support_accumulation");
  });

  it("RECUSA longe do suporte", () => {
    expect(ids(ind({ ...base, price: 107 }))).not.toContain("support_accumulation");
  });
});

describe("o caminho NÃO tomado é registrado", () => {
  it("candidateAttempts devolve todo playbook do regime, com plano ou motivo", () => {
    // Sem isto, um agente que escolhe o pior de três candidatos bons parece
    // idêntico a um que escolhe bem entre três ruins.
    const attempts = candidateAttempts(ind({ regime: "RANGING", price: 101, supports: [100], resistances: [125], atr14: 2, atrPct: 2 }));
    expect(attempts.length).toBe(playbooksFor("RANGING").length);
    for (const a of attempts) {
      // Ou tem plano, ou tem motivo. Nunca os dois, nunca nenhum.
      expect(!!a.plan !== !!a.reason, a.def.id).toBe(true);
    }
  });

  it("todo motivo de recusa é uma frase útil, não um código", () => {
    const attempts = candidateAttempts(ind({ regime: "RANGING", price: 100 }));
    for (const a of attempts) {
      if (a.reason) expect(a.reason.length, a.def.id).toBeGreaterThan(8);
    }
  });
});

describe("os buracos declarados", () => {
  it("os playbooks que dependem de dado inexistente estão LISTADOS, não aproximados", () => {
    // Playbook com proxy ruim é pior que playbook ausente: ele opera, entra no
    // ledger, e envenena a medição de todos os outros — com a mesma aparência
    // dos que funcionam.
    expect(PLAYBOOK_GAPS.map((g) => g.id)).toEqual(
      expect.arrayContaining(["failed_breakout", "volatility_squeeze", "vwap_reversion", "opening_range"]),
    );
  });

  it("cada buraco diz QUAL dado falta", () => {
    for (const g of PLAYBOOK_GAPS) expect(g.blockedBy.length, g.id).toBeGreaterThan(30);
  });

  it("nenhum buraco foi implementado às escondidas", () => {
    const activos = new Set<string>(PLAYBOOKS.map((p) => p.id));
    for (const g of PLAYBOOK_GAPS) expect(activos.has(g.id), g.id).toBe(false);
  });
});
