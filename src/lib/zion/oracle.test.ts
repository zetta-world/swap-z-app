import { describe, it, expect } from "vitest";
import { invalidationGate } from "@/lib/zion/oracle";
import { extractSuggestion } from "@/lib/zion/backtest";
import type { ActionCard } from "@/lib/zion/parse";

const THESIS = { minRR: 1.5, regimeFilter: false, minStopPct: 4 };
const refs = new Map([["SOL", 100]]);

function thesis(over: Partial<ActionCard>): ActionCard {
  return {
    kind: "buy_limit", title: "t", summary: "Tese. Invalida se: BTC perder 60k.", chain: "solana",
    from: { symbol: "USDT", address: "" }, to: { symbol: "SOL", address: "" },
    entryPrice: "100", exits: [{ label: "TP1", profitPct: "12", price: "112" }], stopLoss: "94", probability: "60",
    ...over,
  } as ActionCard;
}

describe("Oráculo — thesis profile gates", () => {
  it("invalidationGate: no 'Invalida se', no trade", () => {
    expect(invalidationGate("Alta provável. Invalida se: funding virar negativo.")).toBe(true);
    expect(invalidationGate("Alta provável, RSI baixo.")).toBe(false);
    expect(invalidationGate("")).toBe(false);
    expect(invalidationGate(null)).toBe(false);
  });

  it("accepts a counter-trend thesis (regime filter off by design)", () => {
    const down = new Map([["SOL", "TRENDING_DOWN"]]);
    // Reversal long against a confirmed downtrend: the scanner funnel kills
    // this; the thesis funnel is its habitat. reward 12 / risk 6 = RR 2.
    const r = extractSuggestion(thesis({}), refs, down, THESIS);
    expect(r).not.toBeNull();
    expect(r!.side).toBe("buy");
  });

  it("rejects a thesis with a stop inside the noise band (<4%)", () => {
    const r = extractSuggestion(thesis({ stopLoss: "98" }), refs, new Map(), THESIS);
    expect(r).toBeNull();
  });

  it("rejects a thesis without a full bracket (thesis = knows where it's wrong)", () => {
    expect(extractSuggestion(thesis({ stopLoss: "" }), refs, new Map(), THESIS)).toBeNull();
    expect(extractSuggestion(thesis({ exits: undefined }), refs, new Map(), THESIS)).toBeNull();
  });

  it("accepts RR 1.5 in thesis profile (scanner floor of 2 doesn't apply)", () => {
    // reward 9 / risk 6 = RR 1.5 — passes thesis, would fail the scanner's >=2.
    const r = extractSuggestion(thesis({ exits: [{ label: "TP1", profitPct: "9", price: "109" }] }), refs, new Map(), THESIS);
    expect(r).not.toBeNull();
    expect(extractSuggestion(thesis({ exits: [{ label: "TP1", profitPct: "9", price: "109" }] }), refs, new Map())).toBeNull();
  });
});
