import { describe, it, expect } from "vitest";
import { extractSuggestion, resolveOne, extractCards } from "@/lib/zion/backtest";
import type { ActionCard } from "@/lib/zion/parse";
import type { ZionSuggestionRow } from "@/lib/supabase/types";

/** Minimal valid card factory — only the fields the extractor reads. */
function card(over: Partial<ActionCard>): ActionCard {
  return {
    kind: "buy_limit", title: "t", summary: "s", chain: "solana",
    from: { symbol: "USDT", address: "" }, to: { symbol: "SOL", address: "" },
    entryPrice: "100", exits: [{ label: "TP1", profitPct: "3", price:"103" }], stopLoss: "98", probability: "70",
    ...over,
  } as ActionCard;
}

const refs = new Map([["SOL", 100], ["BTC", 64000]]);
const regimes = new Map([["SOL", "TRENDING_UP"]]);

describe("extractSuggestion — money-in gate", () => {
  it("accepts a well-formed buy_limit and maps every field", () => {
    const r = extractSuggestion(card({}), refs, regimes);
    expect(r).not.toBeNull();
    expect(r!.symbol).toBe("SOL");
    expect(r!.side).toBe("buy");
    expect(r!.ref_price).toBe(100);
    expect(r!.entry_price).toBe(100);
    expect(r!.target_price).toBe(103);
    expect(r!.stop_price).toBe(98);
    expect(r!.regime).toBe("TRENDING_UP");
  });

  it("rejects a mis-scaled hallucination (the 1000x LINK bug)", () => {
    // Entry 1000x off the real ref_price — internally consistent geometry, but garbage.
    const r = extractSuggestion(card({ entryPrice: "100000", exits: [{ label: "TP1", profitPct: "3", price:"103000" }], stopLoss: "98000" }), refs, regimes);
    expect(r).toBeNull();
  });

  it("rejects reward:risk < 1 (negative EV by construction)", () => {
    // reward = 1, risk = 3 → R:R 0.33
    const r = extractSuggestion(card({ exits: [{ label: "TP1", profitPct: "3", price:"101" }], stopLoss: "97" }), refs, regimes);
    expect(r).toBeNull();
  });

  it("rejects target essentially AT entry (the 0.01% AVAX bug)", () => {
    const r = extractSuggestion(card({ exits: [{ label: "TP1", profitPct: "3", price:"100.01" }], stopLoss: "99" }), refs, regimes);
    expect(r).toBeNull();
  });

  it("rejects an absurdly-far target (Grok's 500%+ number corruption)", () => {
    // entry ~100 (in-scale), but target 600 = 500% away → un-hittable garbage
    const r = extractSuggestion(card({ entryPrice: "100", exits: [{ label: "TP1", profitPct: "500", price:"600" }], stopLoss: "98" }), refs, regimes);
    expect(r).toBeNull();
  });

  it("keeps a realistic ~10% target (just under the cap)", () => {
    const r = extractSuggestion(card({ entryPrice: "100", exits: [{ label: "TP1", profitPct: "10", price:"110" }], stopLoss: "96" }), refs, regimes);
    expect(r).not.toBeNull();
    expect(r!.target_price).toBe(110);
  });

  it("rejects target on the wrong side of entry", () => {
    // buy with target BELOW entry
    const r = extractSuggestion(card({ exits: [{ label: "TP1", profitPct: "3", price:"97" }], stopLoss: "94" }), refs, regimes);
    expect(r).toBeNull();
  });

  it("maps swap direction: stable→asset = buy, asset→stable = sell", () => {
    // No regime read here — direction mapping is what's under test, and a
    // sell against SOL's TRENDING_UP would (correctly) die at the regime gate.
    const noRegime = new Map<string, string>();
    const buy = extractSuggestion(card({ kind: "swap", from: { symbol: "USDT", address: "" }, to: { symbol: "SOL", address: "" }, entryPrice: "", exits: undefined, stopLoss: "" }), refs, noRegime);
    expect(buy?.side).toBe("buy");
    const sell = extractSuggestion(card({ kind: "swap", from: { symbol: "SOL", address: "" }, to: { symbol: "USDT", address: "" }, entryPrice: "", exits: undefined, stopLoss: "" }), refs, noRegime);
    expect(sell?.side).toBe("sell");
    expect(sell?.symbol).toBe("SOL");
  });

  it("regime gate: rejects any card on a RANGING symbol (chop pays to play)", () => {
    const chop = new Map([["SOL", "RANGING"]]);
    expect(extractSuggestion(card({}), refs, chop)).toBeNull();
    const sell = card({ kind: "sell_safe", from: { symbol: "SOL", address: "" }, to: { symbol: "USDT", address: "" }, exits: [{ label: "TP1", profitPct: "3", price: "97" }], stopLoss: "102" });
    expect(extractSuggestion(sell, refs, chop)).toBeNull();
  });

  it("regime gate: rejects counter-trend, keeps with-trend (symmetric)", () => {
    const sell = card({ kind: "sell_safe", from: { symbol: "SOL", address: "" }, to: { symbol: "USDT", address: "" }, exits: [{ label: "TP1", profitPct: "3", price: "97" }], stopLoss: "102" });
    // Confirmed uptrend: sell dies, buy lives.
    expect(extractSuggestion(sell, refs, regimes)).toBeNull();
    expect(extractSuggestion(card({}), refs, regimes)).not.toBeNull();
    // Confirmed downtrend: buy dies, sell lives.
    const down = new Map([["SOL", "TRENDING_DOWN"]]);
    expect(extractSuggestion(card({}), refs, down)).toBeNull();
    expect(extractSuggestion(sell, refs, down)).not.toBeNull();
  });

  it("regime gate: TRANSITIONING and missing regime pass both sides", () => {
    const trans = new Map([["SOL", "TRANSITIONING"]]);
    expect(extractSuggestion(card({}), refs, trans)).not.toBeNull();
    expect(extractSuggestion(card({}), refs, new Map())).not.toBeNull();
  });

  it("skips a symbol with no real reference price (never trusts the card's own price)", () => {
    const r = extractSuggestion(card({ to: { symbol: "FAKECOIN", address: "" } }), refs, regimes);
    expect(r).toBeNull();
  });

  it("accepts a directional call without target/stop (resolves at horizon)", () => {
    const r = extractSuggestion(card({ entryPrice: "", exits: undefined, stopLoss: "" }), refs, regimes);
    expect(r).not.toBeNull();
    expect(r!.target_price).toBeNull();
    expect(r!.stop_price).toBeNull();
  });
});

// ─── resolveOne — path replay ────────────────────────────────────────────────

const T0 = Date.parse("2026-07-01T00:00:00Z");
const H = 3_600_000;

function row(over: Partial<ZionSuggestionRow>): ZionSuggestionRow {
  return {
    id: "x", symbol: "SOL", kind: "buy_limit", side: "buy", ref_price: 100,
    entry_price: 100, target_price: 103, stop_price: 98, probability: 70,
    regime: null, source: "test", horizon_hours: 72, status: "open",
    outcome_pct: null, resolved_price: null,
    created_at: new Date(T0).toISOString(), resolved_at: null,
    ...over,
  };
}
const k = (t: number, high: number, low: number, close: number) => ({ t, high, low, close });

describe("resolveOne — first-touch replay", () => {
  it("marks hit_target when the target is touched first", () => {
    const v = resolveOne(row({}), [k(T0 + H, 104, 99, 102)], undefined, T0 + 2 * H);
    expect(v?.status).toBe("hit_target");
    expect(v?.outcomePct).toBeCloseTo(3);
  });

  it("assumes STOP first when one candle straddles both levels (pessimistic)", () => {
    const v = resolveOne(row({}), [k(T0 + H, 104, 97, 102)], undefined, T0 + 2 * H);
    expect(v?.status).toBe("hit_stop");
    expect(v?.outcomePct).toBeCloseTo(-2);
  });

  it("ignores pre-entry candles (no phantom touch before creation)", () => {
    // Target touched BEFORE the suggestion existed; nothing after → in-flight.
    const v = resolveOne(row({}), [k(T0 - H, 105, 99, 101), k(T0 + H, 101, 99.5, 100.5)], undefined, T0 + 2 * H);
    expect(v).toBeNull();
  });

  it("returns EXPIRED (not win/loss) when the horizon elapses with no touch", () => {
    const v = resolveOne(row({}), [k(T0 + H, 102, 99, 101.5)], undefined, T0 + 73 * H);
    expect(v?.status).toBe("expired");
    expect(v?.outcomePct).toBeCloseTo(1.5); // drift credited to expectancy, not to win-rate
  });

  it("sell side inverts the outcome sign", () => {
    const v = resolveOne(
      row({ side: "sell", target_price: 97, stop_price: 102 }),
      [k(T0 + H, 98, 96.5, 97.5)], undefined, T0 + 2 * H,
    );
    expect(v?.status).toBe("hit_target");
    expect(v?.outcomePct).toBeCloseTo(3); // price fell 3% and we were short
  });

  it("falls back to a spot check when no candles are available", () => {
    const hit = resolveOne(row({}), [], 103.5, T0 + 2 * H);
    expect(hit?.status).toBe("hit_target");
    const inflight = resolveOne(row({}), [], 101, T0 + 2 * H);
    expect(inflight).toBeNull();
    const expired = resolveOne(row({}), [], 101, T0 + 73 * H);
    expect(expired?.status).toBe("expired");
  });
});

// ─── extractCards — triple-fallback output parsing (R1.1) ────────────────────

describe("extractCards", () => {
  const cardJson = { kind: "buy_limit", title: "t", summary: "s", chain: "solana", from: { symbol: "USDT", address: "" }, to: { symbol: "SOL", address: "" }, entryPrice: "100", exits: [{ label: "TP1", price: "103", profitPct: "3" }], stopLoss: "98", probability: "70" };

  it("parses the new pure-JSON contract", () => {
    const cards = extractCards(JSON.stringify({ cards: [cardJson] }));
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("buy_limit");
  });

  it("recovers JSON embedded in prose (chatty compat providers)", () => {
    const text = `Here is my analysis:\n${JSON.stringify({ cards: [cardJson, cardJson] })}\nHope this helps!`;
    expect(extractCards(text)).toHaveLength(2);
  });

  it("still understands the legacy [[ACTION]] block format", () => {
    const text = `prose before\n[[ACTION]]${JSON.stringify(cardJson)}[[/ACTION]]\nprose after`;
    const cards = extractCards(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].to?.symbol).toBe("SOL");
  });

  it("returns an empty array for a valid-but-empty response and for garbage", () => {
    expect(extractCards('{"cards": []}')).toHaveLength(0);
    expect(extractCards("no cards here at all")).toHaveLength(0);
  });
});
