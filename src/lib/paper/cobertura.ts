/** OHLC timestamps are OPEN times. Missing intervals are unknown, not flat. */
export interface ObservedCandle {
  t: number; high: number; low: number; close: number; durationMs?: number;
}

export type ObservedPath =
  | { status: "resolved"; price: number; reason: "target" | "stop" | "expired"; atMs: number }
  | { status: "pending" | "unobserved"; reason: string };

/** Interval must come from the provider request, never inferred from sparse rows. */
export function candleDurationMs(interval: string): number | null {
  const match = /^(\d+)(m|h|d)$/.exec(interval);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? n * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!) : null;
}

/** Replay only a continuous, closed, valid path. A boundary candle that touches
 * a bracket may have done so before entry/after expiry: do not invent ordering.
 * A non-aligned expiry needs a price at the actual deadline; a nearby close is
 * not that price. Keep it unobserved, including when a spot quote is available.
 * This is deliberately stricter than the historical point-timestamp simulator. */
export function observeCandlePath(
  p: { side: string; openedMs: number; horizonMs: number; target: number | null; stop: number | null },
  candles: readonly ObservedCandle[], nowMs: number,
): ObservedPath {
  const unknown = (reason: string): ObservedPath => ({ status: "unobserved", reason });
  if (![p.openedMs, p.horizonMs, nowMs].every(Number.isFinite) || p.horizonMs <= p.openedMs)
    return unknown("invalid_window");
  const rows = candles.filter(c => c.t <= Math.min(nowMs, p.horizonMs))
    .slice().sort((a, b) => a.t - b.t);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.t === b.t && (a.high !== b.high || a.low !== b.low || a.close !== b.close
        || a.durationMs !== b.durationMs)) return unknown("conflicting_duplicate");
  }
  let cursor = p.openedMs;
  let previous: ObservedCandle | undefined;
  for (const c of rows) {
    const duration = c.durationMs;
    if (duration == null || !Number.isFinite(duration) || duration <= 0)
      return unknown("unknown_interval");
    const end = c.t + duration;
    if (end <= p.openedMs) continue;
    if (c.t > cursor) return unknown("missing_interval");
    if (![c.t, c.high, c.low, c.close].every(Number.isFinite)
        || c.low <= 0 || c.high < c.low || c.close < c.low || c.close > c.high)
      return unknown("invalid_candle");
    if (previous && c.t === previous.t) {
      if (c.high === previous.high && c.low === previous.low && c.close === previous.close
          && duration === previous.durationMs) continue;
      return unknown("conflicting_duplicate");
    }
    if (previous && c.t !== cursor) return unknown("overlapping_intervals");
    if (end > nowMs) return { status: "pending", reason: "unfinished_candle" };
    const buy = p.side === "buy";
    const hitStop = p.stop != null && (buy ? c.low <= p.stop : c.high >= p.stop);
    const hitTarget = p.target != null && (buy ? c.high >= p.target : c.low <= p.target);
    if (c.t < p.openedMs || end > p.horizonMs) {
      if (hitStop || hitTarget) return unknown("ambiguous_boundary_touch");
      if (end > p.horizonMs) return unknown("missing_deadline_price");
    } else {
      if (hitStop) return { status: "resolved", price: p.stop!, reason: "stop", atMs: end };
      if (hitTarget) return { status: "resolved", price: p.target!, reason: "target", atMs: end };
    }
    cursor = end;
    previous = c;
    if (end === p.horizonMs)
      return { status: "resolved", price: c.close, reason: "expired", atMs: end };
  }
  return nowMs >= p.horizonMs ? unknown("missing_deadline_price")
    : { status: "pending", reason: "awaiting_candles" };
}
