import { describe, expect, it } from "vitest";
import {
  FIXED_NOTIONAL_FUNDING_MODEL, planFundingReplay,
  type FundingPositionSnapshot, type FundingReplayInput,
} from "./funding-replay";
import { operacoesDistintas } from "./fluxo";

const H = 3_600_000;
const openedAtMs = Date.parse("2026-11-01T00:00:00Z");
const position: FundingPositionSnapshot = {
  model: FIXED_NOTIONAL_FUNDING_MODEL, id: "position-btc-1", symbol: "BTC",
  openedAtMs, notionalUsdt: 500, genomeVersion: 2,
};

function fixture(): FundingReplayInput {
  const expectedPeriods = [
    { settledAtMs: openedAtMs + 4 * H, intervalMs: 4 * H },
    { settledAtMs: openedAtMs + 12 * H, intervalMs: 8 * H },
    { settledAtMs: openedAtMs + 16 * H, intervalMs: 4 * H },
  ];
  return {
    position: { ...position }, throughMs: openedAtMs + 16 * H,
    observedAtMs: openedAtMs + 17 * H, expectedPeriods,
    settlements: expectedPeriods.map((p, i) => ({
      ...p, symbol: "BTC", ratePct: [0.1, 0, -0.2][i],
    })),
  };
}

describe("fixed-notional funding replay — prospective simulation only", () => {
  it("uses each historical signed rate, including zero, across changing intervals", () => {
    const input = fixture();
    const result = planFundingReplay(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.model).toBe(FIXED_NOTIONAL_FUNDING_MODEL);
    expect(result.receipts.map((r) => r.usdt)).toEqual([0.5, 0, -1]);
    expect(result.totalUsdt).toBeCloseTo(-0.5, 12);
    expect(result.receipts.map((r) => r.settledAtMs))
      .toEqual(input.expectedPeriods.map((p) => p.settledAtMs));
    expect(result.receipts.every((r) => r.genomeVersion === 2 && r.notionalUsdt === 500)).toBe(true);
  });

  it("replaying or reordering history gives identical receipts without mutating input", () => {
    const input = fixture();
    Object.freeze(input.position);
    input.expectedPeriods.forEach(Object.freeze);
    input.settlements.forEach(Object.freeze);
    Object.freeze(input.expectedPeriods);
    Object.freeze(input.settlements);
    const before = JSON.stringify(input);
    const result = planFundingReplay(input);
    expect(planFundingReplay(input)).toEqual(result);
    expect(planFundingReplay({ ...input, settlements: [...input.settlements].reverse() })).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps receipt identity per position/symbol and one operation across funding periods", () => {
    const first = planFundingReplay(fixture());
    const secondInput = fixture();
    secondInput.position = { ...position, id: "position-eth-1", symbol: "ETH" };
    secondInput.settlements = secondInput.settlements.map((s) => ({ ...s, symbol: "ETH" }));
    const second = planFundingReplay(secondInput);
    if (!first.ok || !second.ok) throw new Error("fixture rejected");
    expect(new Set([...first.receipts, ...second.receipts].map((r) => r.id)).size).toBe(6);
    expect(new Set(first.receipts.map((r) => r.operationRef)).size).toBe(1);
    expect(operacoesDistintas(first.receipts.map((r) => ({
      agente: "colheita_funding", causa: "funding", usdt: r.usdt,
      ocorreuEmMs: r.settledAtMs, ref: r.operationRef,
    })))).toBe(1);
  });

  it("keeps receipt IDs stable when a conflicting retry changes a payload", () => {
    const first = planFundingReplay(fixture());
    const changed = fixture();
    changed.settlements = changed.settlements.map((s, i) => ({ ...s, ratePct: i === 0 ? 0.2 : s.ratePct }));
    const second = planFundingReplay(changed);
    if (!first.ok || !second.ok) throw new Error("fixture rejected");
    expect(first.receipts[0].id).toBe(second.receipts[0].id);
    expect(first.receipts[0].usdt).not.toBe(second.receipts[0].usdt);
    // The future atomic RPC must reject this payload conflict, not silently skip it.
  });

  it("models full payment after opening during an interval, without claiming proration", () => {
    const input = fixture();
    input.position = { ...position, openedAtMs: openedAtMs + H };
    const result = planFundingReplay(input);
    if (!result.ok) throw new Error(result.reason);
    expect(result.receipts[0].usdt).toBe(0.5);
  });

  it("allows an explicit empty plan only at the opening boundary", () => {
    const input = { ...fixture(), throughMs: openedAtMs, expectedPeriods: [], settlements: [] };
    expect(planFundingReplay(input)).toMatchObject({ ok: true, receipts: [], totalUsdt: 0 });
    expect(planFundingReplay({ ...input, throughMs: openedAtMs + H }))
      .toEqual({ ok: false, reason: "incomplete_schedule" });
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid notional %s without a partial plan", (notionalUsdt) => {
    expect(planFundingReplay({ ...fixture(), position: { ...position, notionalUsdt } }))
      .toEqual({ ok: false, reason: "invalid_position" });
  });

  it.each([
    { id: "" }, { symbol: " BTC" }, { openedAtMs: NaN },
    { genomeVersion: 0 }, { genomeVersion: 1.5 },
  ])("rejects invalid snapshot fields %s", (changes) => {
    expect(planFundingReplay({ ...fixture(), position: { ...position, ...changes } }))
      .toEqual({ ok: false, reason: "invalid_position" });
  });

  it("rejects a real-quantity model instead of silently using a fixed notional", () => {
    const incompatible = { ...position, model: "real_perpetual" } as unknown as FundingPositionSnapshot;
    expect(planFundingReplay({ ...fixture(), position: incompatible }))
      .toEqual({ ok: false, reason: "invalid_position" });
  });

  it.each([
    { throughMs: openedAtMs - 1 }, { observedAtMs: openedAtMs + H },
    { throughMs: NaN }, { observedAtMs: Infinity },
  ])("rejects invalid replay boundaries %s", (changes) => {
    expect(planFundingReplay({ ...fixture(), ...changes }))
      .toEqual({ ok: false, reason: "invalid_range" });
  });

  it("rejects missing initial, intermediate and final schedule coverage", () => {
    const input = fixture();
    for (const expectedPeriods of [
      input.expectedPeriods.slice(1),
      [input.expectedPeriods[0], input.expectedPeriods[2]],
      input.expectedPeriods.slice(0, -1),
    ]) {
      expect(planFundingReplay({ ...input, expectedPeriods }))
        .toEqual({ ok: false, reason: "incomplete_schedule" });
    }
  });

  it("rejects overlapping, duplicate and reversed expected periods", () => {
    const input = fixture();
    expect(planFundingReplay({
      ...input,
      expectedPeriods: input.expectedPeriods.map((p, i) => ({ ...p, intervalMs: i === 1 ? 9 * H : p.intervalMs })),
    })).toEqual({ ok: false, reason: "incomplete_schedule" });
    for (const expectedPeriods of [
      [input.expectedPeriods[0], ...input.expectedPeriods],
      [input.expectedPeriods[0], input.expectedPeriods[1], input.expectedPeriods[0]],
    ]) {
      expect(planFundingReplay({ ...input, expectedPeriods }))
        .toEqual({ ok: false, reason: "invalid_schedule" });
    }
    // Reversing the entire schedule fails its opening coverage first. It must
    // still reject the whole plan; no valid-prefix receipts may escape.
    expect(planFundingReplay({ ...input, expectedPeriods: [...input.expectedPeriods].reverse() }))
      .toEqual({ ok: false, reason: "incomplete_schedule" });
  });

  it("rejects any missing historical settlement, including a zero period", () => {
    const input = fixture();
    for (let omit = 0; omit < input.settlements.length; omit++) {
      expect(planFundingReplay({ ...input, settlements: input.settlements.filter((_, i) => i !== omit) }))
        .toEqual({ ok: false, reason: "missing_settlement" });
    }
  });

  it.each([0.1, -9])("rejects duplicate history even when its rate is %s", (ratePct) => {
    const input = fixture();
    expect(planFundingReplay({
      ...input, settlements: [...input.settlements, { ...input.settlements[0], ratePct }],
    })).toEqual({ ok: false, reason: "duplicate_settlement" });
  });

  it.each([NaN, Infinity, -Infinity])("rejects invalid rates %s", (ratePct) => {
    const input = fixture();
    expect(planFundingReplay({
      ...input, settlements: input.settlements.map((s, i) => ({ ...s, ratePct: i === 2 ? ratePct : s.ratePct })),
    })).toEqual({ ok: false, reason: "invalid_settlement" });
  });

  it("rejects another symbol and inconsistent period metadata", () => {
    const input = fixture();
    expect(planFundingReplay({ ...input, settlements: [{ ...input.settlements[0], symbol: "ETH" }] }))
      .toEqual({ ok: false, reason: "invalid_settlement" });
    expect(planFundingReplay({ ...input, settlements: [{ ...input.settlements[0], intervalMs: 8 * H }] }))
      .toEqual({ ok: false, reason: "interval_mismatch" });
  });

  it("rejects history before/opening, after coverage and unscheduled extra rows", () => {
    const input = fixture();
    for (const settledAtMs of [openedAtMs - H, openedAtMs, input.throughMs + H]) {
      expect(planFundingReplay({
        ...input, settlements: [...input.settlements, { ...input.settlements[0], settledAtMs }],
      })).toEqual({ ok: false, reason: "out_of_range" });
    }
    expect(planFundingReplay({
      ...input, settlements: [...input.settlements, { ...input.settlements[0], settledAtMs: openedAtMs + 2 * H }],
    })).toEqual({ ok: false, reason: "unexpected_settlement" });
  });

  it("rejects numeric overflow without returning valid prefix receipts", () => {
    const input = fixture();
    input.position = { ...position, notionalUsdt: Number.MAX_VALUE };
    input.settlements = input.settlements.map((s, i) => ({ ...s, ratePct: i === 2 ? Number.MAX_VALUE : 0 }));
    expect(planFundingReplay(input)).toEqual({ ok: false, reason: "non_finite_amount" });
  });
});
