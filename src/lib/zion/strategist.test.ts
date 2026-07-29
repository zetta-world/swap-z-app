import { describe, it, expect } from "vitest";
import {
  selectPlaybook, selectPlans, buildLongBracket, stopFloorPct, isPlan,
  type StrategyDecision,
} from "@/lib/zion/strategist";
import type { SymbolIndicators } from "@/lib/api/market-indicators";

/** Indicador mínimo viável — cada teste sobrescreve só o que importa. */
function ind(over: Partial<SymbolIndicators> = {}): SymbolIndicators {
  return {
    symbol: "TEST", price: 100, rsi14: 50, ema20: 100, ema50: 100, macd: null,
    atr14: 2, atrPct: 2, adx: 15, regime: "RANGING",
    trend: "neutral", htf4h: null, htf1d: null, htf1w: null, alignment: "mixed",
    obv: null, obvTrend: null, confidenceScore: null,
    relVol: null, divergence: null, supports: [], resistances: [], pivotLevels: null,
    rsiTrajectory: [], yearHigh: null, yearLow: null, rangePct: null, distFromYearHighPct: null,
    ...over,
  };
}

const reason = (d: StrategyDecision) => (isPlan(d) ? "" : d.reason);

describe("stopFloorPct — o stop tem que ficar fora do ruído", () => {
  it("usa o ATR quando ele é maior que o piso absoluto", () => {
    expect(stopFloorPct(4)).toBeCloseTo(6); // 4% × 1.5
  });
  it("cai no piso absoluto quando o ATR é minúsculo", () => {
    expect(stopFloorPct(0.1)).toBeCloseTo(1.2);
  });
  it("sem ATR, ainda exige o piso absoluto", () => {
    expect(stopFloorPct(null)).toBeCloseTo(1.2);
  });
});

describe("buildLongBracket — geometria long-only", () => {
  it("aceita um bracket long saudável", () => {
    const p = buildLongBracket("BTC", "range_reversion", 100, 110, 95, 2, 48, "ok");
    expect(p).not.toBeNull();
    expect(p!.side).toBe("buy");
    expect(p!.rr).toBeCloseTo(2); // 10 de ganho / 5 de risco
  });

  it("REJEITA stop acima da entrada (isso seria um short)", () => {
    expect(buildLongBracket("BTC", "range_reversion", 100, 110, 105, 2, 48, "x")).toBeNull();
  });

  it("REJEITA alvo abaixo da entrada (venda a descoberto disfarçada)", () => {
    expect(buildLongBracket("BTC", "range_reversion", 100, 90, 95, 2, 48, "x")).toBeNull();
  });

  it("REJEITA RR abaixo do mínimo", () => {
    // ganho 5, risco 5 → RR 1.0, abaixo de 1.8
    expect(buildLongBracket("BTC", "range_reversion", 100, 105, 95, 2, 48, "x")).toBeNull();
  });

  it("REJEITA stop dentro da banda de ruído (morre de clima)", () => {
    // ATR 4% → piso 6%; stop de 1% não passa, mesmo com RR ótimo
    expect(buildLongBracket("BTC", "range_reversion", 100, 130, 99, 4, 48, "x")).toBeNull();
  });

  it("REJEITA alvo em escala absurda (card corrompido)", () => {
    expect(buildLongBracket("BTC", "range_reversion", 100, 600, 95, 2, 48, "x")).toBeNull();
  });
});

describe("range_reversion — o unlock: mercado lateral vira alvo, não lixo", () => {
  it("COMPRA perto do suporte num range (o que o funil antigo descartava)", () => {
    const d = selectPlaybook(ind({
      regime: "RANGING", adx: 14, price: 102,
      supports: [100], resistances: [120], atr14: 2, atrPct: 2,
    }));
    expect(isPlan(d)).toBe(true);
    if (!isPlan(d)) return;
    expect(d.playbook).toBe("range_reversion");
    expect(d.side).toBe("buy");
    expect(d.entry).toBe(102);
    expect(d.stop).toBeLessThan(100);      // abaixo do suporte
    expect(d.target).toBeLessThan(120);    // realiza ANTES da resistência
    expect(d.target).toBeGreaterThan(102);
  });

  it("fica FORA quando o preço está caro no range (metade de cima)", () => {
    const d = selectPlaybook(ind({
      regime: "RANGING", price: 118, supports: [100], resistances: [120],
    }));
    expect(isPlan(d)).toBe(false);
    expect(reason(d)).toContain("caro no range");
  });

  it("fica FORA quando o range não tem S/R definido", () => {
    const d = selectPlaybook(ind({ regime: "RANGING", supports: [], resistances: [] }));
    expect(reason(d)).toContain("S/R");
  });

  it("fica FORA quando o canal é estreito demais para pagar o RR", () => {
    // canal de 100→103 com ATR 2: alvo perto demais do stop
    const d = selectPlaybook(ind({
      regime: "RANGING", price: 100.5, supports: [100], resistances: [103], atr14: 2, atrPct: 2,
    }));
    expect(isPlan(d)).toBe(false);
  });
});

describe("trend_pullback — compra o recuo, não o rompimento", () => {
  it("COMPRA quando o preço recuou até perto da EMA20 numa alta", () => {
    const d = selectPlaybook(ind({
      regime: "TRENDING_UP", adx: 30, price: 100, ema20: 99.5,
      supports: [96], resistances: [112], atr14: 2, atrPct: 2, alignment: "aligned_bull",
    }));
    expect(isPlan(d)).toBe(true);
    if (!isPlan(d)) return;
    expect(d.playbook).toBe("trend_pullback");
    expect(d.side).toBe("buy");
    expect(d.stop).toBeLessThan(96); // abaixo do suporte estrutural
  });

  it("fica FORA quando o preço está esticado acima da EMA20 (comprar caro)", () => {
    const d = selectPlaybook(ind({
      regime: "TRENDING_UP", price: 110, ema20: 100, atr14: 2, atrPct: 2,
      supports: [96], resistances: [130],
    }));
    expect(isPlan(d)).toBe(false);
    expect(reason(d)).toContain("esticado");
  });

  it("usa continuação em ATR quando não há resistência acima", () => {
    const d = selectPlaybook(ind({
      regime: "TRENDING_UP", price: 100, ema20: 99.8, supports: [98],
      resistances: [], atr14: 2, atrPct: 2,
    }));
    expect(isPlan(d)).toBe(true);
    if (!isPlan(d)) return;
    expect(d.target).toBeCloseTo(108); // 100 + 4 ATR (caminho limpo)
    expect(d.stop).toBeCloseTo(96);    // um ATR abaixo do suporte
  });
});

describe("capitulation_reversal — o único long em queda, com trava dupla", () => {
  it("COMPRA só com divergência de alta E perto do fundo do ciclo", () => {
    const d = selectPlaybook(ind({
      regime: "TRENDING_DOWN", price: 100, divergence: "bullish_rsi", rangePct: 12,
      atr14: 3, atrPct: 3, resistances: [118],
    }));
    expect(isPlan(d)).toBe(true);
    if (!isPlan(d)) return;
    expect(d.playbook).toBe("capitulation_reversal");
    expect(d.side).toBe("buy");
  });

  it("fica FORA em queda sem divergência (faca caindo)", () => {
    const d = selectPlaybook(ind({
      regime: "TRENDING_DOWN", price: 100, divergence: null, rangePct: 12,
    }));
    expect(isPlan(d)).toBe(false);
    expect(reason(d)).toContain("faca caindo");
  });

  it("fica FORA em queda longe do fundo do ciclo, mesmo com divergência", () => {
    const d = selectPlaybook(ind({
      regime: "TRENDING_DOWN", price: 100, divergence: "bullish_rsi", rangePct: 70,
    }));
    expect(isPlan(d)).toBe(false);
    expect(reason(d)).toContain("fundo do ciclo");
  });
});

describe("invariantes do mandato", () => {
  it("NENHUM playbook jamais emite um short — acumular USDT é só comprar barato", () => {
    const universo = [
      ind({ regime: "RANGING", price: 101, supports: [100], resistances: [125], atr14: 2, atrPct: 2 }),
      ind({ regime: "TRENDING_UP", price: 100, ema20: 99.5, supports: [95], resistances: [115], atr14: 2, atrPct: 2 }),
      ind({ regime: "TRENDING_DOWN", price: 100, divergence: "bullish_rsi", rangePct: 10, atr14: 3, atrPct: 3, resistances: [120] }),
      ind({ regime: "TRENDING_DOWN", price: 100 }),
      ind({ regime: "TRANSITIONING", price: 100 }),
    ];
    for (const plan of selectPlans(universo)) {
      expect(plan.side).toBe("buy");
      expect(plan.stop).toBeLessThan(plan.entry);   // stop sempre abaixo
      expect(plan.target).toBeGreaterThan(plan.entry); // alvo sempre acima
    }
  });

  it("fica fora em regime indefinido (não trair a disciplina por volume)", () => {
    const d = selectPlaybook(ind({ regime: "TRANSITIONING" }));
    expect(reason(d)).toContain("transição");
  });

  it("sem preço não há trade (fail-closed)", () => {
    const d = selectPlaybook(ind({ price: null }));
    expect(reason(d)).toContain("sem preço");
  });

  it("selectPlans devolve só os planos, descartando os stand_aside", () => {
    const plans = selectPlans([
      ind({ symbol: "OK", regime: "RANGING", price: 102, supports: [100], resistances: [125], atr14: 2, atrPct: 2 }),
      ind({ symbol: "FORA", regime: "TRANSITIONING" }),
    ]);
    expect(plans.map((p) => p.symbol)).toEqual(["OK"]);
  });
});
