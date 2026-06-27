/**
 * Model fallback chain (N1). ZION's primary model is a single point of failure:
 * Anthropic 529 "overloaded" spikes during volatile markets are exactly when
 * the autopilot/backtest crons run. This lets the unattended (non-streaming)
 * paths degrade to a backup model instead of failing the whole run.
 *
 * Configure via env: ZION_MODEL (primary) and ZION_FALLBACK_MODEL (backup).
 */
export function modelChain(): string[] {
  const primary  = process.env.ZION_MODEL          ?? "claude-sonnet-4-6";
  const fallback = process.env.ZION_FALLBACK_MODEL ?? "claude-haiku-4-5-20251001";
  return primary === fallback ? [primary] : [primary, fallback];
}

/** True for transient upstream conditions worth retrying on the next model. */
export function isRetryableModelError(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | undefined;
  const status = e?.status;
  if (status === 429 || status === 500 || status === 503 || status === 529) return true;
  const msg = (e?.message ?? String(err)).toLowerCase();
  return /overloaded|rate.?limit|timeout|temporarily|unavailable|\b529\b|\b503\b/.test(msg);
}
