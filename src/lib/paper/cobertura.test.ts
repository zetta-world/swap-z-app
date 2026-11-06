import { describe, it, expect } from "vitest";
import { observeCandlePath, candleDurationMs, type ObservedCandle } from "./cobertura";
import { computeObservedExit } from "./saida";
import { resolveOne, CARENCIA_SEM_PRECO_MS } from "@/lib/zion/backtest";
import type { ZionSuggestionRow } from "@/lib/supabase/types";

const H = 3_600_000;
const p = { side: "buy", openedMs: 0, horizonMs: 3 * H, target: 110, stop: 95 };
const candle = (t: number, high = 104, low = 99, close = 102): ObservedCandle =>
  ({ t, high, low, close, durationMs: H });
const complete = [candle(0), candle(H), candle(2 * H)];

describe("observed candle coverage", () => {
  it("requires the exact expiry close and deducts the round-trip cost once", () => {
    const pos = { side: "buy", entry_price: 100, cost_usd: 1000, target_price: 110,
      stop_price: 95, opened_at: new Date(0).toISOString(), horizon_hours: 3 };
    const result = computeObservedExit(pos, complete, 20 * H, 0.5);
    expect(result.observation).toMatchObject({ status: "resolved", atMs: 3 * H });
    expect(result.verdict?.netPct).toBeCloseTo(1.5);
    expect(result.verdict?.pnlUsd).toBeCloseTo(15);
  });
  it("sorts reverse-ordered provider data without mutating input", () => {
    const rows = complete.slice().reverse();
    expect(observeCandlePath(p, rows, 4 * H)).toMatchObject({ reason: "expired", price: 102 });
    expect(rows[0].t).toBe(2 * H);
  });
  it.each([
    [candle(H, 112)], [candle(0), candle(2 * H, 112)],
  ])("does not award a target across a missing interval (%j)", (...rows) => {
    expect(observeCandlePath(p, rows as ObservedCandle[], 4 * H).status).toBe("unobserved");
  });
  it("does not expire on a truncated response", () => {
    expect(observeCandlePath(p, complete.slice(0, 2), 20 * H).status).toBe("unobserved");
  });
  it("does not read high/low from an unfinished candle", () => {
    expect(observeCandlePath(p, [candle(0, 120, 80)], H - 1).status).toBe("pending");
    expect(observeCandlePath(p, [candle(0, 120, 80)], H)).toMatchObject({ reason: "stop", price: 95 });
  });
  it("a proven first touch before a later gap is still resolved", () => {
    expect(observeCandlePath(p, [candle(0, 112), candle(2 * H)], 4 * H))
      .toMatchObject({ reason: "target", atMs: H });
  });
  it("treats a target in the partial entry candle as ambiguous", () => {
    expect(observeCandlePath({ ...p, openedMs: 1 }, [candle(0, 112)], 4 * H))
      .toMatchObject({ status: "unobserved", reason: "ambiguous_boundary_touch" });
  });
  it("can prove absence of touches in the partial entry candle", () => {
    expect(observeCandlePath({ ...p, openedMs: 1 }, [candle(0), candle(H, 112)], 4 * H))
      .toMatchObject({ reason: "target", price: 110 });
  });
  it("cannot price an expiry in the middle of a candle", () => {
    expect(observeCandlePath({ ...p, horizonMs: H + 1 }, complete, 4 * H).status).toBe("unobserved");
  });
  it("does not award touches after the horizon in its final partial candle", () => {
    expect(observeCandlePath({ ...p, horizonMs: H + 1 }, [candle(0), candle(H, 112)], 4 * H).status)
      .toBe("unobserved");
  });
  it("ignores a candle opening exactly at the horizon", () => {
    expect(observeCandlePath(p, [...complete, candle(3 * H, 120, 80)], 4 * H))
      .toMatchObject({ reason: "expired", price: 102 });
  });
  it("shorts use stop-first and the same observation rules", () => {
    expect(observeCandlePath({ ...p, side: "sell", target: 95, stop: 110 }, [candle(0, 120, 80)], H))
      .toMatchObject({ reason: "stop", price: 110 });
  });
  it("accepts identical duplicates but rejects conflicting duplicates before a win", () => {
    expect(observeCandlePath(p, [complete[0], ...complete], 4 * H).status).toBe("resolved");
    expect(observeCandlePath(p, [candle(0, 112), candle(0, 104)], 4 * H).status).toBe("unobserved");
  });
  it.each([NaN, Infinity, -1, 0])("rejects invalid OHLC %s", (value) => {
    expect(observeCandlePath(p, [{ ...candle(0), low: value }], H).status).toBe("unobserved");
  });
  it("does not infer a candle interval from missing data", () => {
    expect(observeCandlePath(p, [{ ...candle(0), durationMs: undefined }], H))
      .toMatchObject({ reason: "unknown_interval" });
    expect(candleDurationMs("15m")).toBe(900_000);
    expect(candleDurationMs("1M")).toBeNull();
  });
  it("tournament marks partial history unresolvable after grace, with null P&L", () => {
    const row = { side: "buy", ref_price: 100, target_price: 110, stop_price: 95,
      created_at: new Date(0).toISOString(), horizon_hours: 3 } as ZionSuggestionRow;
    expect(resolveOne(row, [candle(0)], 120, 3 * H + CARENCIA_SEM_PRECO_MS))
      .toEqual({ status: "unresolvable", outcomePct: null, price: null });
  });
});
