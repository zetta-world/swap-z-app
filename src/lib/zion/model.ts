/**
 * Model fallback chain (N1). ZION's primary model is a single point of failure:
 * Anthropic 529 "overloaded" spikes during volatile markets are exactly when
 * the autopilot/backtest crons run. This lets the unattended (non-streaming)
 * paths degrade to a backup model instead of failing the whole run.
 *
 * Configure via env: ZION_MODEL (primary) and ZION_FALLBACK_MODEL (backup).
 */
export function modelChain(): string[] {
  /**
   * ⚠️ A PLATAFORMA SAIU DA ANTHROPIC (21/08) — decisão do dono. Os padrões
   * apontavam para `claude-sonnet-4-6` e `claude-haiku`, e com a chave da
   * Anthropic removida um padrão desses viraria 401 em vez de resposta.
   *
   * ⚠️ E A CADEIA FICA COM UM ELO SÓ por enquanto. Ela existe para degradar
   * quando o primário está sobrecarregado; encher com um segundo modelo Kimi
   * sem saber se ele existe daria uma falha diferente da que a cadeia previne.
   * `ZION_FALLBACK_MODEL` liga o segundo elo quando alguém confirmar qual é.
   */
  const primary  = process.env.ZION_MODEL          ?? "kimi-k2.6";
  const fallback = process.env.ZION_FALLBACK_MODEL ?? primary;
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
