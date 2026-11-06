/**
 * Pure replay of a SIMULATED FIXED-NOTIONAL funding position.
 *
 * This is an accounting model, not a perpetual execution simulator: it does
 * not reconstruct contract quantities, mark-price notional, collateral,
 * liquidation, basis or fees. A position receives the full signed rate at
 * each settlement strictly after opening; there is no interval proration.
 *
 * The caller supplies the authoritative settlement schedule, including each
 * interval. Neither an eight-hour cadence nor provider response order is
 * assumed. `throughMs` is the last fully covered settlement boundary (or the
 * opening time when no period is due), not an arbitrary wall-clock cursor.
 * Schedule completeness outside that declared boundary is not established
 * here. A missing history point rejects the whole plan, including its prefix.
 *
 * INTEGRATION BLOCKED: do not pass these receipts to registrarFluxo in a loop.
 * A future migration/RPC must reserve capital and record opening fees together,
 * lock the position, validate its immutable snapshot, and atomically insert
 * UNIQUE(position_id, settlement_time) receipts plus nonzero money rows. Zero
 * receipts still count as processed; contradictory retries must fail. Any
 * cursor advances in that same transaction. Economic time is settledAtMs,
 * separate from insertion time. Entry gates must never suppress settlement.
 *
 * Legacy aggregate flows cannot establish positions or coverage. They need a
 * separate measurement round; balances, ranking and investigation must not mix
 * them with this model. operationRef is stable across periods so the existing
 * operation counter cannot mistake funding receipts for independent trades.
 */

export const FIXED_NOTIONAL_FUNDING_MODEL = "simulated_fixed_notional_v1" as const;

export interface FundingPositionSnapshot {
  model: typeof FIXED_NOTIONAL_FUNDING_MODEL;
  /** Immutable identity within the future measurement round. */
  id: string;
  /** Canonical symbol; history must match exactly. */
  symbol: string;
  openedAtMs: number;
  notionalUsdt: number;
  genomeVersion: number | null;
}

export interface ExpectedFundingPeriod {
  settledAtMs: number;
  /** The interval ends at settledAtMs; its start is settledAtMs - intervalMs. */
  intervalMs: number;
}

export interface HistoricalFundingSettlement extends ExpectedFundingPeriod {
  symbol: string;
  /** Signed percent, not a fraction: 0.01 means 0.01%. */
  ratePct: number;
}

export interface FundingReplayInput {
  position: Readonly<FundingPositionSnapshot>;
  throughMs: number;
  observedAtMs: number;
  /** Strict chronological order, consecutive intervals, ending at throughMs. */
  expectedPeriods: readonly Readonly<ExpectedFundingPeriod>[];
  /** Exactly the expected periods, in any order. Extra rows are rejected. */
  settlements: readonly Readonly<HistoricalFundingSettlement>[];
}

export interface FundingReplayReceipt extends HistoricalFundingSettlement {
  id: string;
  operationRef: string;
  positionId: string;
  model: typeof FIXED_NOTIONAL_FUNDING_MODEL;
  openedAtMs: number;
  notionalUsdt: number;
  genomeVersion: number | null;
  /** May be positive, zero or negative. No fees or currency rounding applied. */
  usdt: number;
}

export type FundingReplayFailure =
  | "invalid_position" | "invalid_range" | "invalid_schedule"
  | "incomplete_schedule" | "invalid_settlement" | "duplicate_settlement"
  | "out_of_range" | "unexpected_settlement" | "missing_settlement"
  | "interval_mismatch" | "non_finite_amount";

export type FundingReplayResult =
  | { ok: false; reason: FundingReplayFailure }
  | {
    ok: true;
    model: typeof FIXED_NOTIONAL_FUNDING_MODEL;
    position: FundingPositionSnapshot;
    throughMs: number;
    observedAtMs: number;
    receipts: FundingReplayReceipt[];
    totalUsdt: number;
  };

const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
const validLabel = (s: string) => typeof s === "string" && s.length > 0
  && s.length <= 200 && s.trim() === s;
const fail = (reason: FundingReplayFailure): FundingReplayResult => ({ ok: false, reason });

/** Plans every receipt since this position opened; no shared symbol cursor. */
export function planFundingReplay(input: FundingReplayInput): FundingReplayResult {
  const { position: p, throughMs, observedAtMs, expectedPeriods, settlements } = input;
  if (!p || p.model !== FIXED_NOTIONAL_FUNDING_MODEL
    || !validLabel(p.id) || !validLabel(p.symbol) || !validTime(p.openedAtMs)
    || !Number.isFinite(p.notionalUsdt) || p.notionalUsdt <= 0
    || !(p.genomeVersion === null
      || (Number.isSafeInteger(p.genomeVersion) && p.genomeVersion > 0))) {
    return fail("invalid_position");
  }
  if (!validTime(throughMs) || !validTime(observedAtMs)
    || throughMs < p.openedAtMs || observedAtMs < throughMs) return fail("invalid_range");
  if (!Array.isArray(expectedPeriods)) return fail("invalid_schedule");
  if (!Array.isArray(settlements)) return fail("invalid_settlement");

  const expected = new Map<number, ExpectedFundingPeriod>();
  let previous: number | null = null;
  for (const period of expectedPeriods) {
    if (!period || !validTime(period.settledAtMs)
      || !Number.isSafeInteger(period.intervalMs) || period.intervalMs <= 0
      || period.intervalMs > period.settledAtMs
      || period.settledAtMs <= p.openedAtMs || period.settledAtMs > throughMs
      || (previous !== null && period.settledAtMs <= previous)) return fail("invalid_schedule");
    const start = period.settledAtMs - period.intervalMs;
    if (previous === null ? start > p.openedAtMs : start !== previous) {
      return fail("incomplete_schedule");
    }
    expected.set(period.settledAtMs, period);
    previous = period.settledAtMs;
  }
  if ((previous ?? p.openedAtMs) !== throughMs) return fail("incomplete_schedule");

  const history = new Map<number, HistoricalFundingSettlement>();
  for (const settlement of settlements) {
    if (!settlement || settlement.symbol !== p.symbol
      || !validTime(settlement.settledAtMs)
      || !Number.isSafeInteger(settlement.intervalMs) || settlement.intervalMs <= 0
      || !Number.isFinite(settlement.ratePct)) return fail("invalid_settlement");
    if (settlement.settledAtMs <= p.openedAtMs || settlement.settledAtMs > throughMs) {
      return fail("out_of_range");
    }
    if (history.has(settlement.settledAtMs)) return fail("duplicate_settlement");
    const period = expected.get(settlement.settledAtMs);
    if (!period) return fail("unexpected_settlement");
    if (period.intervalMs !== settlement.intervalMs) return fail("interval_mismatch");
    history.set(settlement.settledAtMs, settlement);
  }
  if (history.size !== expected.size) return fail("missing_settlement");

  const receipts: FundingReplayReceipt[] = [];
  let totalUsdt = 0;
  for (const period of expectedPeriods) {
    const settlement = history.get(period.settledAtMs)!;
    const usdt = p.notionalUsdt * (settlement.ratePct / 100);
    totalUsdt += usdt;
    if (!Number.isFinite(usdt) || !Number.isFinite(totalUsdt)) return fail("non_finite_amount");
    receipts.push({
      id: `funding-fixed-notional-v1:${JSON.stringify([p.id, p.symbol, period.settledAtMs])}`,
      operationRef: `funding:${p.id}`,
      positionId: p.id, model: p.model, openedAtMs: p.openedAtMs,
      notionalUsdt: p.notionalUsdt, genomeVersion: p.genomeVersion,
      symbol: p.symbol, settledAtMs: period.settledAtMs, intervalMs: period.intervalMs,
      ratePct: settlement.ratePct, usdt: usdt === 0 ? 0 : usdt,
    });
  }
  return {
    ok: true, model: p.model, position: { ...p }, throughMs, observedAtMs,
    receipts, totalUsdt: totalUsdt === 0 ? 0 : totalUsdt,
  };
}
